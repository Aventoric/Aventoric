/* ==========================================================================
   AVENTORIC — panel de administración (conectado a Supabase)
   Autenticación: Supabase Auth (correo + contraseña).
   Permisos: solo usuarios listados en la tabla "administradores".
   ========================================================================== */
(() => {
    const CFG = window.AVENTORIC_CONFIG;
    const $ = id => document.getElementById(id);
    const TIPOS = { comprar: 'Quiero comprar', vender: 'Quiero vender', proveedor: 'Busco un proveedor', representacion: 'Solicitar representación', aliado: 'Ofrecer una alianza', tecnologia: 'Requiero tecnología', oportunidad: 'Otro proyecto u oportunidad' };
    const ETIQ = { nueva: 'Nueva', analisis: 'En análisis', conexion: 'Conexión', propuesta: 'Propuesta', negociacion: 'Negociación', acuerdo: 'Acuerdo', seguimiento: 'Seguimiento', descartada: 'Descartada' };
    const PRIO = { baja: 'Baja', media: 'Media', alta: 'Alta' };
    const SELECT = 'select=*,notas(id,creada,tipo,texto)&order=creada.desc&limit=2000';
    const SESSION_KEY = 'aventoric_admin_session';
    let data = [], view = 'lista', openId = null, timer = null, session = null;

    /* ---------- utilidades ---------- */
    function el(tag, props = {}, ...kids) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
        }
        kids.flat().forEach(c => c != null && n.append(c));
        return n;
    }
    const fmt = iso => new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const fmtDay = iso => new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

    /* ---------- sesión (Supabase Auth) ---------- */
    const loadSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } };
    const storeSession = s => { session = s; try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch {} };

    async function authCall(path, body) {
        const r = await fetch(`${CFG.supabaseUrl}/auth/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseKey }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(r.status === 400 ? 'Correo o contraseña incorrectos.' : (j.msg || j.error_description || 'Error de autenticación'));
        return j;
    }
    const toSession = j => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 30) * 1000, email: j.user?.email });

    async function freshToken() {
        if (!session) throw new Error('401');
        if (Date.now() < session.expires_at) return session.access_token;
        try { storeSession(toSession(await authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token }))); }
        catch { storeSession(null); throw new Error('401'); }
        return session.access_token;
    }

    async function rest(path, { method = 'GET', body, prefer } = {}) {
        let token;
        try { token = await freshToken(); } catch { showLogin(); throw new Error('401'); }
        const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${path}`, {
            method,
            headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(prefer ? { Prefer: prefer } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        if (r.status === 401) { storeSession(null); showLogin(); throw new Error('401'); }
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || 'Error ' + r.status); }
        return r.status === 204 ? null : r.json().catch(() => null);
    }

    function showLogin() { clearInterval(timer); $('app-view').hidden = true; $('login-view').hidden = false; $('email').focus(); }

    async function start() {
        session = loadSession();
        if (!session) { showLogin(); return; }
        try {
            const admins = await rest('administradores?select=user_id');
            if (!admins || !admins.length) {
                storeSession(null); showLogin();
                $('login-error').textContent = 'Este usuario no tiene permisos de administrador.';
                return;
            }
        } catch (e) { if (e.message !== '401') { showLogin(); $('login-error').textContent = e.message; } return; }
        $('login-view').hidden = true; $('app-view').hidden = false;
        fillFilters(); await load();
        clearInterval(timer); timer = setInterval(() => load(true), 30000);
    }

    $('login-form').addEventListener('submit', async e => {
        e.preventDefault(); $('login-error').textContent = '';
        try {
            storeSession(toSession(await authCall('token?grant_type=password', { email: $('email').value.trim(), password: $('password').value })));
            $('password').value = ''; start();
        } catch (err) { $('login-error').textContent = err.message; }
    });
    $('logout-btn').addEventListener('click', async () => {
        try { if (session) await fetch(`${CFG.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: CFG.supabaseKey, Authorization: 'Bearer ' + session.access_token } }); } catch {}
        storeSession(null); data = []; closeDrawer(); showLogin();
    });

    /* ---------- datos ---------- */
    const sortNotas = s => { s.notas = (s.notas || []).sort((a, b) => new Date(a.creada) - new Date(b.creada)); return s; };

    async function load(silent) {
        try {
            const prev = data.length;
            data = (await rest('solicitudes?' + SELECT)).map(sortNotas);
            $('last-sync').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            if (silent && data.length > prev) toast(`${data.length - prev} solicitud(es) nueva(s)`);
            render();
            if (openId && !$('drawer').hidden && !drawerBusy()) { const s = data.find(x => x.id === openId); if (s) fillDrawer(s); }
        } catch (e) { if (e.message !== '401') toast(e.message); }
    }
    const drawerBusy = () => document.activeElement && ['d-responsable', 'note-text'].includes(document.activeElement.id);

    async function reloadOne(id) {
        const rows = await rest(`solicitudes?id=eq.${id}&select=*,notas(id,creada,tipo,texto)`);
        if (!rows.length) return null;
        const s = sortNotas(rows[0]); data = data.map(x => x.id === id ? s : x); return s;
    }

    function fillFilters() {
        const add = (sel, entries) => { if (sel.options.length > 1) return; entries.forEach(([v, t]) => sel.append(el('option', { value: v, text: t }))); };
        add($('f-estado'), Object.entries(ETIQ)); add($('f-tipo'), Object.entries(TIPOS)); add($('f-prioridad'), Object.entries(PRIO));
        if (!$('d-estado').options.length) Object.entries(ETIQ).forEach(([v, t]) => $('d-estado').append(el('option', { value: v, text: t })));
        if (!$('d-prioridad').options.length) Object.entries(PRIO).forEach(([v, t]) => $('d-prioridad').append(el('option', { value: v, text: t })));
    }

    function filtered() {
        const q = $('f-q').value.trim().toLowerCase(), e = $('f-estado').value, t = $('f-tipo').value, p = $('f-prioridad').value;
        return data.filter(s => (!e || s.estado === e) && (!t || s.tipo === t) && (!p || s.prioridad === p) &&
            (!q || [s.nombre, s.empresa, s.correo, s.ref, s.detalle, s.responsable, s.telefono].join(' ').toLowerCase().includes(q)));
    }

    /* ---------- render ---------- */
    function render() {
        const count = f => data.filter(f).length;
        const enGestion = count(s => ['analisis', 'conexion', 'propuesta', 'negociacion', 'seguimiento'].includes(s.estado));
        const semana = count(s => Date.now() - new Date(s.creada) < 7 * 864e5);
        $('kpis').replaceChildren(...[['Total', data.length, ''], ['Nuevas', count(s => s.estado === 'nueva'), 'hot'], ['En gestión', enGestion, ''], ['Acuerdos', count(s => s.estado === 'acuerdo'), ''], ['Últimos 7 días', semana, '']]
            .map(([l, n, c]) => el('div', { class: 'kpi ' + c }, el('b', { text: String(n) }), el('span', { text: l }))));
        const list = filtered();
        $('empty').hidden = list.length > 0;
        $('list-view').hidden = view !== 'lista' || !list.length;
        $('board-view').hidden = view !== 'tablero' || !list.length;
        if (view === 'lista') renderTable(list); else renderBoard(list);
    }
    const pill = e => el('span', { class: 'pill ' + e, text: ETIQ[e] });
    const prio = p => el('span', { class: 'prio ' + p, text: '● ' + PRIO[p] });

    function renderTable(list) {
        const head = el('tr', {}, ...['Ref.', 'Solicitante', 'Tipo', 'Detalle', 'Estado', 'Prioridad', 'Responsable', 'Fecha'].map(h => el('th', { text: h })));
        const rows = list.map(s => el('tr', { class: 'row', tabindex: '0', onclick: () => openDrawer(s.id), onkeydown: e => { if (e.key === 'Enter') openDrawer(s.id); } },
            el('td', {}, el('span', { class: 'ref', text: s.ref })),
            el('td', {}, el('div', { class: 'name', text: s.nombre }), el('div', { class: 'sub', text: s.empresa || s.correo })),
            el('td', { text: TIPOS[s.tipo] || s.tipo }),
            el('td', {}, el('div', { class: 'snip', text: s.detalle })),
            el('td', {}, pill(s.estado)), el('td', {}, prio(s.prioridad)),
            el('td', { text: s.responsable || '—' }), el('td', { text: fmtDay(s.creada) })));
        $('list-view').replaceChildren(el('table', {}, el('thead', {}, head), el('tbody', {}, rows)));
    }
    function renderBoard(list) {
        $('board-view').replaceChildren(...Object.entries(ETIQ).map(([key, label]) => {
            const items = list.filter(s => s.estado === key);
            return el('div', { class: 'col' }, el('h4', {}, el('span', { text: label }), el('span', { text: String(items.length) })),
                items.map(s => el('div', { class: 'card', tabindex: '0', onclick: () => openDrawer(s.id), onkeydown: e => { if (e.key === 'Enter') openDrawer(s.id); } },
                    el('div', { class: 'name', text: s.nombre }), el('div', { class: 'sub', text: (s.empresa ? s.empresa + ' · ' : '') + (TIPOS[s.tipo] || s.tipo) }),
                    el('div', { class: 'meta' }, prio(s.prioridad), el('span', { class: 'sub', text: fmtDay(s.creada) })))));
        }));
    }

    /* ---------- detalle ---------- */
    function openDrawer(id) { openId = id; const s = data.find(x => x.id === id); if (!s) return; fillDrawer(s); $('scrim').hidden = false; $('drawer').hidden = false; $('d-close').focus(); }
    function closeDrawer() { openId = null; $('scrim').hidden = true; $('drawer').hidden = true; }
    $('d-close').addEventListener('click', closeDrawer); $('scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

    function fillDrawer(s) {
        $('d-ref').textContent = s.ref + ' · ' + fmt(s.creada);
        $('d-title').textContent = s.nombre + (s.empresa ? ' — ' + s.empresa : '');
        $('d-tipo').textContent = TIPOS[s.tipo] || s.tipo;
        $('d-estado').value = s.estado; $('d-prioridad').value = s.prioridad; $('d-responsable').value = s.responsable;
        const phone = s.telefono.replace(/[^\d+]/g, '');
        $('d-facts').replaceChildren(
            el('dt', { text: 'Correo' }), el('dd', {}, el('a', { href: 'mailto:' + s.correo, text: s.correo })),
            el('dt', { text: 'Teléfono' }), el('dd', {}, s.telefono ? [el('a', { href: 'tel:' + phone, text: s.telefono }), ' · ', el('a', { href: 'https://wa.me/' + phone.replace('+', ''), target: '_blank', rel: 'noopener', text: 'WhatsApp' })] : '—'),
            el('dt', { text: 'Empresa' }), el('dd', { text: s.empresa || '—' }),
            el('dt', { text: 'Autorización' }), el('dd', { text: 'Datos autorizados el ' + fmt(s.consentimiento_fecha) }));
        $('d-detalle').textContent = s.detalle;
        $('d-notas').replaceChildren(...[...s.notas].reverse().map(n => el('li', { class: n.tipo === 'sistema' ? 'sistema' : '' }, el('time', { text: fmt(n.creada) }), el('div', { class: 'txt', text: n.texto }))));
    }

    async function patch(body) {
        try {
            await rest('solicitudes?id=eq.' + openId, { method: 'PATCH', body, prefer: 'return=minimal' });
            const s = await reloadOne(openId); if (s) fillDrawer(s); render(); toast('Cambios guardados');
        } catch (e) { if (e.message !== '401') toast(e.message); }
    }
    $('d-estado').addEventListener('change', e => patch({ estado: e.target.value }));
    $('d-prioridad').addEventListener('change', e => patch({ prioridad: e.target.value }));
    $('d-responsable').addEventListener('change', e => patch({ responsable: e.target.value.trim().slice(0, 80) }));
    $('note-form').addEventListener('submit', async e => {
        e.preventDefault(); const texto = $('note-text').value.trim(); if (!texto) return;
        try {
            await rest('notas', { method: 'POST', body: { solicitud_id: openId, texto: texto.slice(0, 2000), tipo: 'nota' }, prefer: 'return=minimal' });
            $('note-text').value = ''; const s = await reloadOne(openId); if (s) fillDrawer(s); render(); toast('Nota agregada');
        } catch (err) { if (err.message !== '401') toast(err.message); }
    });
    $('d-delete').addEventListener('click', async () => {
        const s = data.find(x => x.id === openId);
        if (!s || !confirm(`¿Eliminar la solicitud ${s.ref} de ${s.nombre}? Esta acción no se puede deshacer.`)) return;
        try { await rest('solicitudes?id=eq.' + openId, { method: 'DELETE', prefer: 'return=minimal' }); data = data.filter(x => x.id !== openId); closeDrawer(); render(); toast('Solicitud eliminada'); }
        catch (e) { if (e.message !== '401') toast(e.message); }
    });

    /* ---------- exportar CSV (en el navegador) ---------- */
    const csvCell = v => { let s = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    $('export-btn').addEventListener('click', () => {
        const cols = ['ref', 'creada', 'tipo', 'estado', 'prioridad', 'responsable', 'nombre', 'empresa', 'correo', 'telefono', 'detalle'];
        const rows = [cols.join(',')].concat(filtered().map(s => cols.map(c => csvCell(c === 'tipo' ? TIPOS[s.tipo] || s.tipo : s[c])).join(',')));
        const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = el('a', { href: URL.createObjectURL(blob), download: `aventoric-solicitudes-${new Date().toISOString().slice(0, 10)}.csv` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    /* ---------- filtros y vistas ---------- */
    ['f-q', 'f-estado', 'f-tipo', 'f-prioridad'].forEach(id => $(id).addEventListener('input', render));
    const setView = v => { view = v; $('v-lista').classList.toggle('on', v === 'lista'); $('v-tablero').classList.toggle('on', v === 'tablero'); render(); };
    $('v-lista').addEventListener('click', () => setView('lista')); $('v-tablero').addEventListener('click', () => setView('tablero'));

    start();
})();
