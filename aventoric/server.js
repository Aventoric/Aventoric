/* ==========================================================================
   AVENTORIC — servidor (Node 18+, sin dependencias externas)
   - Sirve el sitio público (carpeta /public)
   - POST /api/solicitudes            -> recibe solicitudes del formulario (público)
   - /api/admin/*                      -> panel de gestión (requiere sesión)
   Variables de entorno:
     PORT             puerto (por defecto 3000)
     ADMIN_PASSWORD   contraseña del panel (si falta, se genera una y se imprime al iniciar)
     SESSION_SECRET   secreto para firmar sesiones (si falta, se genera uno en data/.secret)
     COOKIE_SECURE    "1" para marcar la cookie como Secure (obligatorio detrás de HTTPS)
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA, 'solicitudes.json');
const SECRET_FILE = path.join(DATA, '.secret');
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 horas

fs.mkdirSync(DATA, { recursive: true });

/* ---------- Secretos y contraseña ---------- */
let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
    if (fs.existsSync(SECRET_FILE)) SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
    else { SECRET = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }
}
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
let generated = false;
if (!ADMIN_PASSWORD) { ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url'); generated = true; }
const PW_SALT = crypto.randomBytes(16);
const PW_HASH = crypto.scryptSync(ADMIN_PASSWORD, PW_SALT, 32);
const checkPassword = pw => {
    const h = crypto.scryptSync(String(pw || ''), PW_SALT, 32);
    return crypto.timingSafeEqual(h, PW_HASH);
};

/* ---------- Sesiones firmadas (sin estado en servidor) ---------- */
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL })).toString('base64url');
    return payload + '.' + sign(payload);
}
function validToken(t) {
    if (!t || !t.includes('.')) return false;
    const [payload, sig] = t.split('.');
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
const getCookie = (req, name) => (req.headers.cookie || '').split(';').map(c => c.trim().split('=')).find(([k]) => k === name)?.[1];
const isAdmin = req => validToken(getCookie(req, 'av_session'));

/* ---------- Límite de tasa simple por IP ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600000)) hits.delete(k); }, 600000).unref();
const clientIp = req => req.socket.remoteAddress || 'x';

/* ---------- Almacenamiento (JSON con escritura atómica) ---------- */
let db = [];
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = []; }
let writing = Promise.resolve();
function save() {
    writing = writing.then(() => {
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, DB_FILE);
    });
    return writing;
}

const TIPOS = {
    comprar: 'Quiero comprar', vender: 'Quiero vender', proveedor: 'Busco un proveedor',
    representacion: 'Solicitar representación', aliado: 'Ofrecer una alianza',
    tecnologia: 'Requiero tecnología', oportunidad: 'Otro proyecto u oportunidad'
};
const ESTADOS = ['nueva', 'analisis', 'conexion', 'propuesta', 'negociacion', 'acuerdo', 'seguimiento', 'descartada'];
const PRIORIDADES = ['baja', 'media', 'alta'];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

/* ---------- Utilidades HTTP ---------- */
function send(res, status, body, headers = {}) {
    const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, {
        'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers
    });
    res.end(isObj ? JSON.stringify(body) : body);
}
function readJson(req, limit = 20000) {
    return new Promise((resolve, reject) => {
        if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(Object.assign(new Error('Content-Type'), { status: 415 }));
        let size = 0; const chunks = [];
        req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Demasiado grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); } });
        req.on('error', reject);
    });
}
const csvCell = v => {
    let s = String(v ?? '').replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s; // evita inyección de fórmulas en Excel
    return '"' + s.replace(/"/g, '""') + '"';
};

/* ---------- API pública ---------- */
async function crearSolicitud(req, res) {
    if (limited('post:' + clientIp(req), 8, 3600000)) return send(res, 429, { error: 'Demasiadas solicitudes. Intente más tarde.' });
    const b = await readJson(req);
    if (b.sitio_web) return send(res, 201, { ok: true }); // honeypot: responde "ok" sin guardar
    const tipo = clean(b.tipo, 30);
    const s = {
        id: crypto.randomUUID(),
        ref: 'AV-' + String(Date.now()).slice(-6) + crypto.randomInt(10, 99),
        creada: new Date().toISOString(),
        actualizada: new Date().toISOString(),
        tipo,
        nombre: clean(b.nombre, 120), empresa: clean(b.empresa, 120),
        correo: clean(b.correo, 160), telefono: clean(b.telefono, 40),
        detalle: clean(b.detalle, 4000),
        consentimiento: b.consentimiento === 'on' || b.consentimiento === true,
        consentimientoFecha: new Date().toISOString(),
        estado: 'nueva', prioridad: 'media', responsable: '', notas: []
    };
    if (!TIPOS[tipo] || !s.nombre || !/^\S+@\S+\.\S+$/.test(s.correo) || !s.detalle || !s.consentimiento)
        return send(res, 400, { error: 'Datos incompletos o inválidos.' });
    db.unshift(s);
    await save();
    send(res, 201, { ok: true, ref: s.ref });
}

/* ---------- API de administración ---------- */
async function admin(req, res, url) {
    const p = url.pathname;

    if (p === '/api/admin/login' && req.method === 'POST') {
        if (limited('login:' + clientIp(req), 6, 15 * 60000)) return send(res, 429, { error: 'Demasiados intentos. Espere 15 minutos.' });
        const b = await readJson(req, 2000);
        if (!checkPassword(b.password)) return send(res, 401, { error: 'Contraseña incorrecta.' });
        return send(res, 200, { ok: true }, {
            'Set-Cookie': `av_session=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${COOKIE_SECURE ? '; Secure' : ''}`
        });
    }
    if (p === '/api/admin/logout' && req.method === 'POST')
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'av_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });

    if (!isAdmin(req)) return send(res, 401, { error: 'No autorizado.' });

    if (p === '/api/admin/session') return send(res, 200, { ok: true, tipos: TIPOS, estados: ESTADOS, prioridades: PRIORIDADES });

    if (p === '/api/admin/solicitudes' && req.method === 'GET') return send(res, 200, db);

    if (p === '/api/admin/export.csv' && req.method === 'GET') {
        const cols = ['ref', 'creada', 'tipo', 'estado', 'prioridad', 'responsable', 'nombre', 'empresa', 'correo', 'telefono', 'detalle'];
        const rows = [cols.join(',')].concat(db.map(s => cols.map(c => csvCell(c === 'tipo' ? TIPOS[s.tipo] || s.tipo : s[c])).join(',')));
        return send(res, 200, '﻿' + rows.join('\r\n'), {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="aventoric-solicitudes-${new Date().toISOString().slice(0, 10)}.csv"`
        });
    }

    const m = p.match(/^\/api\/admin\/solicitudes\/([\w-]+)(\/notas)?$/);
    if (m) {
        const item = db.find(s => s.id === m[1]);
        if (!item) return send(res, 404, { error: 'No encontrada.' });

        if (m[2] && req.method === 'POST') {
            const b = await readJson(req);
            const texto = clean(b.texto, 2000);
            if (!texto) return send(res, 400, { error: 'La nota está vacía.' });
            item.notas.push({ fecha: new Date().toISOString(), texto, tipo: 'nota' });
            item.actualizada = new Date().toISOString();
            await save();
            return send(res, 200, item);
        }
        if (!m[2] && req.method === 'PATCH') {
            const b = await readJson(req);
            const log = [];
            if (b.estado !== undefined) {
                if (!ESTADOS.includes(b.estado)) return send(res, 400, { error: 'Estado inválido.' });
                if (b.estado !== item.estado) { log.push(`Estado: ${item.estado} → ${b.estado}`); item.estado = b.estado; }
            }
            if (b.prioridad !== undefined) {
                if (!PRIORIDADES.includes(b.prioridad)) return send(res, 400, { error: 'Prioridad inválida.' });
                if (b.prioridad !== item.prioridad) { log.push(`Prioridad: ${item.prioridad} → ${b.prioridad}`); item.prioridad = b.prioridad; }
            }
            if (b.responsable !== undefined) {
                const r = clean(b.responsable, 80);
                if (r !== item.responsable) { log.push(`Responsable: ${item.responsable || '—'} → ${r || '—'}`); item.responsable = r; }
            }
            log.forEach(texto => item.notas.push({ fecha: new Date().toISOString(), texto, tipo: 'sistema' }));
            if (log.length) item.actualizada = new Date().toISOString();
            await save();
            return send(res, 200, item);
        }
        if (!m[2] && req.method === 'DELETE') {
            db = db.filter(s => s.id !== item.id);
            await save();
            return send(res, 200, { ok: true });
        }
    }
    send(res, 404, { error: 'Ruta no encontrada.' });
}

/* ---------- Archivos estáticos ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
};
function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Prohibido');
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
            if (!path.extname(rel) && fs.existsSync(path.join(file, 'index.html'))) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
            return send(res, 404, 'No encontrado');
        }
        const ext = path.extname(file).toLowerCase();
        const headers = { ...SEC_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' };
        if (rel.startsWith('/admin')) headers['Cache-Control'] = 'no-store';
        if (ext === '.mp4' && req.headers.range) {
            const [a, b] = req.headers.range.replace('bytes=', '').split('-');
            const start = parseInt(a, 10) || 0, end = b ? parseInt(b, 10) : st.size - 1;
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
            return fs.createReadStream(file, { start, end }).pipe(res);
        }
        res.writeHead(200, headers);
        fs.createReadStream(file).pipe(res);
    });
}

/* ---------- Enrutador ---------- */
http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/api/solicitudes' && req.method === 'POST') return await crearSolicitud(req, res);
        if (url.pathname.startsWith('/api/admin/')) return await admin(req, res, url);
        if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Ruta no encontrada.' });
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
        serveStatic(req, res, url);
    } catch (e) {
        if (e.status) return send(res, e.status, { error: e.message });
        console.error(e);
        send(res, 500, { error: 'Error interno.' });
    }
}).listen(PORT, () => {
    console.log(`\nAVENTORIC en http://localhost:${PORT}`);
    console.log(`Panel:   http://localhost:${PORT}/admin/`);
    if (generated) console.log(`\nContraseña de administrador (generada para esta ejecución): ${ADMIN_PASSWORD}\nDefina ADMIN_PASSWORD para fijarla.\n`);
});
