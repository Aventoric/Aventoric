(() => {
    const $ = id => document.getElementById(id);
    const ETIQ = { nueva: 'Nueva', analisis: 'En análisis', conexion: 'Conexión', propuesta: 'Propuesta', negociacion: 'Negociación', acuerdo: 'Acuerdo', seguimiento: 'Seguimiento', descartada: 'Descartada' };
    const PRIO = { baja: 'Baja', media: 'Media', alta: 'Alta' };
    let meta = null, data = [], view = 'lista', openId = null, timer = null;

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

    async function api(path, opts = {}) {
        const r = await fetch('/api/admin/' + path, {
            credentials: 'same-origin',
            ...opts,
            headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
            body: opts.body ? JSON.stringify(opts.body) : undefined
        });
        if (r.status === 401 && path !== 'login') { showLogin(); throw new Error('401'); }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Error ' + r.status);
        return j;
    }

    /* ---------- sesión ---------- */
    function showLogin() { clearInterval(timer); $('app-view').hidden = true; $('login-view').hidden = false; $('password').focus(); }
    async function start() {
        try { meta = await api('session'); } catch { showLogin(); return; }
        $('login-view').hidden = true; $('app-view').hidden = false;
        fillFilters(); await load();
        clearInterval(timer); timer = setInterval(() => load(true), 30000);
    }
    $('login-form').addEventListener('submit', async e => {
        e.preventDefault(); $('login-error').textContent = '';
        try { await api('login', { method: 'POST', body: { password: $('password').value } }); $('password').value = ''; start(); }
        catch (err) { $('login-error').textContent = err.message; }
    });
    $('logout-btn').addEventListener('click', async () => { await api('logout', { method: 'POST', body: {} }).catch(() => {}); data = []; showLogin(); });

    /* ---------- datos ---------- */
    async function load(silent) {
        try {
            const prevCount = data.length;
            data = await api('solicitudes');
            $('last-sync').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            if (silent && data.length > prevCount) toast(`${data.length - prevCount} solicitud(es) nueva(s)`);
            render();
            if (openId) { const s = data.find(x => x.id === openId); if (s && $('drawer').hidden === false && !drawerBusy()) fillDrawer(s); }
        } catch (e) { if (e.message !== '401') toast(e.message); }
    }
    const drawerBusy = () => document.activeElement && ['d-responsable', 'note-text'].includes(document.activeElement.id);

    function fillFilters() {
        const add = (sel, entries) => { if (sel.options.length > 1) return; entries.forEach(([v, t]) => sel.append(el('option', { value: v, text: t }))); };
        add($('f-estado'), Object.entries(ETIQ));
        add($('f-tipo'), Object.entries(meta.tipos));
        add($('f-prioridad'), Object.entries(PRIO));
        if (!$('d-estado').options.length) Object.entries(ETIQ).forEach(([v, t]) => $('d-estado').append(el('option', { value: v, text: t })));
        if (!$('d-prioridad').options.length) Object.entries(PRIO).forEach(([v, t]) => $('d-prioridad').append(el('option', { value: v, text: t })));
    }

    function filtered() {
        const q = $('f-q').value.trim().toLowerCase(), e = $('f-estado').value, t = $('f-tipo').value, p = $('f-prioridad').value;
        return data.filter(s =>
            (!e || s.estado === e) && (!t || s.tipo === t) && (!p || s.prioridad === p) &&
            (!q || [s.nombre, s.empresa, s.correo, s.ref, s.detalle, s.responsable, s.telefono].join(' ').toLowerCase().includes(q)));
    }

    /* ---------- render ---------- */
    function render() {
        // KPIs
        const count = f => data.filter(f).length;
        const enGestion = count(s => ['analisis', 'conexion', 'propuesta', 'negociacion', 'seguimiento'].includes(s.estado));
        const semana = count(s => Date.now() - new Date(s.creada) < 7 * 864e5);
        const k = $('kpis'); k.replaceChildren(
            ...[['Total', data.length, ''], ['Nuevas', count(s => s.estado === 'nueva'), 'hot'], ['En gestión', enGestion, ''], ['Acuerdos', count(s => s.estado === 'acuerdo'), ''], ['Últimos 7 días', semana, '']]
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
            el('td', { text: meta.tipos[s.tipo] || s.tipo }),
            el('td', {}, el('div', { class: 'snip', text: s.detalle })),
            el('td', {}, pill(s.estado)), el('td', {}, prio(s.prioridad)),
            el('td', { text: s.responsable || '—' }), el('td', { text: fmtDay(s.creada) })));
        $('list-view').replaceChildren(el('table', {}, el('thead', {}, head), el('tbody', {}, rows)));
    }

    function renderBoard(list) {
        $('board-view').replaceChildren(...Object.entries(ETIQ).map(([key, label]) => {
            const items = list.filter(s => s.estado === key);
            return el('div', { class: 'col' },
                el('h4', {}, el('span', { text: label }), el('span', { text: String(items.length) })),
                items.map(s => el('div', { class: 'card', tabindex: '0', onclick: () => openDrawer(s.id), onkeydown: e => { if (e.key === 'Enter') openDrawer(s.id); } },
                    el('div', { class: 'name', text: s.nombre }), el('div', { class: 'sub', text: (s.empresa ? s.empresa + ' · ' : '') + (meta.tipos[s.tipo] || s.tipo) }),
                    el('div', { class: 'meta' }, prio(s.prioridad), el('span', { class: 'sub', text: fmtDay(s.creada) })))));
        }));
    }

    /* ---------- detalle ---------- */
    function openDrawer(id) {
        openId = id; const s = data.find(x => x.id === id); if (!s) return;
        fillDrawer(s); $('scrim').hidden = false; $('drawer').hidden = false; $('d-close').focus();
    }
    function closeDrawer() { openId = null; $('scrim').hidden = true; $('drawer').hidden = true; }
    $('d-close').addEventListener('click', closeDrawer); $('scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

    function fillDrawer(s) {
        $('d-ref').textContent = s.ref + ' · ' + fmt(s.creada);
        $('d-title').textContent = s.nombre + (s.empresa ? ' — ' + s.empresa : '');
        $('d-tipo').textContent = meta.tipos[s.tipo] || s.tipo;
        $('d-estado').value = s.estado; $('d-prioridad').value = s.prioridad; $('d-responsable').value = s.responsable;
        const phone = s.telefono.replace(/[^\d+]/g, '');
        $('d-facts').replaceChildren(
            el('dt', { text: 'Correo' }), el('dd', {}, el('a', { href: 'mailto:' + s.correo, text: s.correo })),
            el('dt', { text: 'Teléfono' }), el('dd', {}, s.telefono ? [el('a', { href: 'tel:' + phone, text: s.telefono }), ' · ', el('a', { href: 'https://wa.me/' + phone.replace('+', ''), target: '_blank', rel: 'noopener', text: 'WhatsApp' })] : '—'),
            el('dt', { text: 'Empresa' }), el('dd', { text: s.empresa || '—' }),
            el('dt', { text: 'Autorización' }), el('dd', { text: 'Datos autorizados el ' + fmt(s.consentimientoFecha) }));
        $('d-detalle').textContent = s.detalle;
        $('d-notas').replaceChildren(...[...s.notas].reverse().map(n => el('li', { class: n.tipo === 'sistema' ? 'sistema' : '' }, el('time', { text: fmt(n.fecha) }), el('div', { class: 'txt', text: n.texto }))));
    }

    async function patch(body) {
        try {
            const upd = await api('solicitudes/' + openId, { method: 'PATCH', body });
            data = data.map(s => s.id === upd.id ? upd : s); fillDrawer(upd); render(); toast('Cambios guardados');
        } catch (e) { toast(e.message); }
    }
    $('d-estado').addEventListener('change', e => patch({ estado: e.target.value }));
    $('d-prioridad').addEventListener('change', e => patch({ prioridad: e.target.value }));
    $('d-responsable').addEventListener('change', e => patch({ responsable: e.target.value }));
    $('note-form').addEventListener('submit', async e => {
        e.preventDefault(); const texto = $('note-text').value.trim(); if (!texto) return;
        try {
            const upd = await api('solicitudes/' + openId + '/notas', { method: 'POST', body: { texto } });
            data = data.map(s => s.id === upd.id ? upd : s); $('note-text').value = ''; fillDrawer(upd); render(); toast('Nota agregada');
        } catch (err) { toast(err.message); }
    });
    $('d-delete').addEventListener('click', async () => {
        const s = data.find(x => x.id === openId);
        if (!s || !confirm(`¿Eliminar la solicitud ${s.ref} de ${s.nombre}? Esta acción no se puede deshacer.`)) return;
        try { await api('solicitudes/' + openId, { method: 'DELETE' }); data = data.filter(x => x.id !== openId); closeDrawer(); render(); toast('Solicitud eliminada'); }
        catch (e) { toast(e.message); }
    });

    /* ---------- filtros y vistas ---------- */
    ['f-q', 'f-estado', 'f-tipo', 'f-prioridad'].forEach(id => $(id).addEventListener('input', render));
    const setView = v => { view = v; $('v-lista').classList.toggle('on', v === 'lista'); $('v-tablero').classList.toggle('on', v === 'tablero'); render(); };
    $('v-lista').addEventListener('click', () => setView('lista')); $('v-tablero').addEventListener('click', () => setView('tablero'));

    start();
})();
