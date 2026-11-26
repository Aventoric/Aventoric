/* ==========================================================================
   AVENTORIC — comportamiento del sitio
   ========================================================================== */

/* La configuración (Supabase, correo, teléfono) vive en config.js */
const AVENTORIC_CONFIG = window.AVENTORIC_CONFIG || {};

document.addEventListener('DOMContentLoaded', () => {

    /* 1. PRELOADER */
    const preloader = document.getElementById('preloader');
    const loadingBar = document.getElementById('loading-bar');
    let progress = 0;
    const interval = setInterval(() => {
        progress += 25;
        loadingBar.style.width = `${progress}%`;
        if (progress >= 100) {
            clearInterval(interval);
            setTimeout(() => preloader.classList.add('hidden'), 300);
        }
    }, 200);

    /* 1b. VIDEOS OPCIONALES: si el archivo no existe, se descarta y queda el fondo animado */
    document.querySelectorAll('video source').forEach(src => {
        src.addEventListener('error', () => src.parentElement.remove());
    });

    /* 2. CARRUSELES */
    document.querySelectorAll('.carousel-btn').forEach(button => {
        button.addEventListener('click', () => {
            const track = document.getElementById(button.dataset.target);
            const step = Math.max(320, track.clientWidth * 0.7);
            track.scrollBy({ left: button.classList.contains('next') ? step : -step, behavior: 'smooth' });
        });
    });

    /* 3. FAQ ACORDEÓN */
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const item = header.parentElement;
            const wasActive = item.classList.contains('active');
            document.querySelectorAll('.accordion-item').forEach(i => {
                i.classList.remove('active');
                i.querySelector('.accordion-body').style.maxHeight = null;
                i.querySelector('.icon').textContent = '+';
            });
            if (!wasActive) {
                item.classList.add('active');
                const body = item.querySelector('.accordion-body');
                body.style.maxHeight = body.scrollHeight + 'px';
                header.querySelector('.icon').textContent = '−';
            }
        });
    });

    /* 4. REVELADO AL HACER SCROLL */
    const revealTargets = document.querySelectorAll('.section-header, .pillar, .mvv, .card-item, .compact-item, .team-card, .steps li, .request-intro, .request-form, .faq-section h2, .accordion-item, .panel, .split-text');
    revealTargets.forEach(el => el.classList.add('reveal'));
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
        }, { threshold: 0.12 });
        revealTargets.forEach(el => io.observe(el));
    } else {
        revealTargets.forEach(el => el.classList.add('in'));
    }

    /* 5. FONDO ANIMADO: RED DE CONEXIONES */
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('canvas.hero-canvas, canvas.bg-canvas').forEach(canvas => initNetwork(canvas, reduce));

    function initNetwork(canvas, still) {
        const ctx = canvas.getContext('2d');
        const parent = canvas.parentElement;
        let w, h, nodes = [], raf, visible = true;
        const gold = '212,175,55';

        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            w = parent.clientWidth; h = parent.clientHeight;
            canvas.width = w * dpr; canvas.height = h * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const count = Math.round(Math.min(70, Math.max(24, (w * h) / 22000)));
            nodes = Array.from({ length: count }, () => ({
                x: Math.random() * w, y: Math.random() * h,
                vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
                r: Math.random() * 1.6 + .8, hub: Math.random() < .12
            }));
            draw();
        }

        function draw() {
            ctx.clearRect(0, 0, w, h);
            const g = ctx.createRadialGradient(w * .7, h * .35, 0, w * .7, h * .35, Math.max(w, h) * .8);
            g.addColorStop(0, '#16202f'); g.addColorStop(1, '#0a0c10');
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
            const maxD = Math.min(170, w / 5);
            for (let i = 0; i < nodes.length; i++) {
                const a = nodes[i];
                for (let j = i + 1; j < nodes.length; j++) {
                    const b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
                    if (d < maxD) {
                        ctx.strokeStyle = `rgba(${gold},${(1 - d / maxD) * (a.hub || b.hub ? .5 : .22)})`;
                        ctx.lineWidth = .8;
                        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                    }
                }
            }
            nodes.forEach(n => {
                ctx.fillStyle = n.hub ? `rgba(${gold},.95)` : 'rgba(255,255,255,.55)';
                ctx.beginPath(); ctx.arc(n.x, n.y, n.hub ? n.r + 1.6 : n.r, 0, 6.283); ctx.fill();
            });
        }

        function tick() {
            if (visible) {
                nodes.forEach(n => {
                    n.x += n.vx; n.y += n.vy;
                    if (n.x < 0 || n.x > w) n.vx *= -1;
                    if (n.y < 0 || n.y > h) n.vy *= -1;
                });
                draw();
            }
            raf = requestAnimationFrame(tick);
        }

        resize();
        window.addEventListener('resize', resize);
        if (!still) {
            if ('IntersectionObserver' in window) {
                new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(parent);
            }
            tick();
        }
    }

    /* 6. FORMULARIO SEGMENTADO */
    const form = document.getElementById('request-form');
    const tipo = document.getElementById('tipo');
    const label = document.getElementById('detalle-label');
    const status = document.getElementById('form-status');

    const etiquetas = {
        comprar: '¿Qué producto o servicio desea comprar? (cantidad, ciudad o país de entrega)',
        vender: '¿Qué producto o servicio ofrece? (categoría, capacidad, mercados de interés)',
        proveedor: '¿Qué proveedor o tipo de suministro busca? (especificaciones, volumen, plazos)',
        representacion: '¿Qué marca o línea desea representar o que le representemos? (territorio, canal)',
        aliado: '¿Qué tipo de alianza propone? (alcance, aporte de cada parte)',
        tecnologia: '¿Qué solución tecnológica requiere? (objetivo, procesos involucrados, plazos)',
        oportunidad: 'Describa su proyecto u oportunidad de negocio.'
    };
    tipo.addEventListener('change', () => { label.textContent = etiquetas[tipo.value]; });

    // Los servicios del carrusel preseleccionan el tipo de solicitud
    document.querySelectorAll('.compact-item[data-tipo]').forEach(a => {
        a.addEventListener('click', () => { tipo.value = a.dataset.tipo; tipo.dispatchEvent(new Event('change')); });
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        status.className = 'form-status';
        let ok = true;
        form.querySelectorAll('[required]').forEach(f => {
            const bad = f.type === 'checkbox' ? !f.checked : !f.value.trim() || (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(f.value));
            f.classList.toggle('invalid', bad);
            if (bad) ok = false;
        });
        if (!ok) { status.textContent = 'Revise los campos marcados y acepte el tratamiento de datos.'; status.classList.add('err'); return; }

        const data = Object.fromEntries(new FormData(form));
        data.consentimiento = form.elements.consentimiento.checked;
        data.tipoTexto = tipo.options[tipo.selectedIndex].text;

        // Campo trampa anti-spam: si un robot lo llena, se simula éxito sin enviar nada
        if (data.sitio_web) { status.textContent = 'Solicitud enviada. El equipo de AVENTORIC le responderá pronto.'; status.classList.add('ok'); form.reset(); return; }

        const btn = form.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const r = await fetch(`${AVENTORIC_CONFIG.supabaseUrl}/rest/v1/solicitudes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': AVENTORIC_CONFIG.supabaseKey, 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                    tipo: data.tipo, nombre: data.nombre.trim(), empresa: (data.empresa || '').trim(),
                    correo: data.correo.trim(), telefono: (data.telefono || '').trim(),
                    detalle: data.detalle.trim(), consentimiento: true
                })
            });
            if (!r.ok) throw new Error('http ' + r.status);
            status.textContent = 'Solicitud enviada. El equipo de AVENTORIC le responderá pronto.';
            status.classList.add('ok');
            form.reset(); tipo.dispatchEvent(new Event('change'));
        } catch (err) {
            status.textContent = 'No fue posible enviar la solicitud. Intente de nuevo en unos minutos.';
            status.classList.add('err');
        } finally {
            btn.disabled = false;
        }
    });

    /* 7. DATOS DE CONTACTO DESDE CONFIG */
    if (AVENTORIC_CONFIG.correo) document.querySelector('[data-contact="correo"]').innerHTML = `<a href="mailto:${AVENTORIC_CONFIG.correo}">${AVENTORIC_CONFIG.correo}</a>`;
    if (AVENTORIC_CONFIG.telefono) document.querySelector('[data-contact="telefono"]').textContent = AVENTORIC_CONFIG.telefono;
});
