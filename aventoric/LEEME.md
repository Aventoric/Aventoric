# AVENTORIC — sitio + panel de gestión

Requiere Node.js 18 o superior. No necesita instalar paquetes.

## Iniciar
    ADMIN_PASSWORD="una-clave-larga-y-unica" node server.js

- Sitio:  http://localhost:3000
- Panel:  http://localhost:3000/admin/

Variables opcionales: PORT, SESSION_SECRET, COOKIE_SECURE=1 (obligatorio en producción con HTTPS).
Si no define ADMIN_PASSWORD, se genera una al azar y se imprime en la consola (cambia en cada reinicio).

## Estructura
- server.js          servidor, API y autenticación
- public/            sitio público (index, legal, estilos, script) y public/admin/ (panel)
- data/              solicitudes.json (se crea solo). Haga copias de seguridad de esta carpeta.
- public/media/      videos propios opcionales

## Producción
Ponga el servidor detrás de HTTPS (por ejemplo Nginx o Caddy como proxy inverso), active COOKIE_SECURE=1,
use una contraseña fuerte y respalde data/. El almacenamiento en JSON es adecuado para volumen bajo/medio;
si crece, migre a una base de datos (SQLite o PostgreSQL) sin cambiar el panel.
