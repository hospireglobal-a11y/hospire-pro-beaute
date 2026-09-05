# .HOSPIRE PRO — Proyecto completo

App web (PWA) para restaurantes. Frontend + funciones serverless en **Vercel**, datos en **Supabase**,
redes/analítica vía proxy propio (`/api/hub`), emails con **Resend**, IA (**Hospi**) con **Anthropic**.

## Estructura de la carpeta (todo lo que se despliega)
```
index.html            La app (panel del cliente). Editable → Vercel republica.
reserver.html         Widget público de reservas (enlace + iframe).
manifest.json         PWA (app instalable).
sw.js                 Service worker (PWA).
vercel.json           Config: cron de recordatorios (/api/remind cada día 8:00).
favicon-64.png / apple-touch-icon.png / icon-192/512/maskable-512 / icon-1024   Iconos.
api/
  hub.js       Proxy redes sociales + analítica (Metricool oculto). /api/hub
  book.js      Reservas: disponibilidad, reserva atómica, grupos, emails. /api/book
  hospi.js     IA Hospi (captions, chat). /api/hospi
  site.js      Contenido público (carte/horaires/infos) que lee la web del cliente. /api/site
  admin.js     Gestión de clientes/accesos (solo admin). /api/admin
  remind.js    Recordatorios automáticos de reservas (lo llama el cron). /api/remind
_supabase/     Migraciones SQL (NO se ejecutan en Vercel; se corren una vez en Supabase).
_docs/         Documentación y material de referencia (NO se despliega):
  hospire-pro-v3-SOURCE.html   Copia del código fuente = idéntico a index.html (master).
  HOSPIRE-PRO-onboarding-cliente.md    Guía de alta de un cliente.
  HOSPIRE-PRO-backlog.md               Backlog / estado del proyecto.
  HOSPIRE-PRO-contexto-ventas-producto.md   Contexto para ventas/producto.
  313-web-sincronizar-menu.md          Cómo la web del cliente lee la carta desde /api/site.
  313-widget-reservas-modal.md         Notas del widget de reservas.
  bilan_preview.png                    Vista previa del Bilan PDF.
  _prototypes/                         Versiones antiguas (histórico, no usar).
```
> Las carpetas `_docs/` y `_supabase/` son solo archivo/referencia. No estorban al deploy
> (Vercel las ignora como código), pero si quieres mantenerlas fuera del repo público,
> añádelas a un `.gitignore`.

> ⚠️ Borra `api/metricool.js` si aún existe: es el nombre antiguo del proxy, ya no se usa
> (todo va por `/api/hub`). Dejarlo no rompe nada, pero mejor quitarlo.

## Variables de entorno (Vercel → Settings → Environment Variables)
Imprescindibles para que funcione (NO son archivos, viven en Vercel):

| Variable | Usada por | Para qué |
|---|---|---|
| `SUPABASE_URL` | book, site, admin, remind | Base de datos |
| `SUPABASE_SERVICE_KEY` | book, site, admin, remind | Acceso servidor a Supabase |
| `METRICOOL_TOKEN` | hub | Token de la API de redes/analítica |
| `METRICOOL_USER_ID` | hub | ID de usuario de esa API |
| `RESEND_API_KEY` | book, remind | Envío de emails |
| `RESEND_FROM` | book, remind | Remitente (ej. reservations@hospireclub.com) |
| `ANTHROPIC_API_KEY` | hospi | IA Hospi |
| `CRON_SECRET` | remind | Protege el cron de recordatorios |

## Migraciones SQL (carpeta `_supabase/`, ejecutar en Supabase → SQL Editor)
Orden recomendado (solo una vez, ya aplicadas en producción):
1. `HOSPIRE-supabase-setup.sql`         Base + funciones (hospire_blog, hospire_is_admin).
2. `HOSPIRE-supabase-branding.sql`      Contenido de marca / site_content.
3. `HOSPIRE-supabase-reservations.sql`  Mesas, config de reservas, anti-doble-booking.
4. `HOSPIRE-supabase-rappels.sql`       Soporte de recordatorios.
5. `313-horaires-reservas-brunch.sql`   (Específico 313) Horarios de brunch correctos.

## Notas
- Estados de reserva usados por la app: `pending`, `confirmed`, `arrived`, `no_show`, `cancelled`.
  (No requieren migración extra; van en el campo `status`.)
- El dominio de producción es `pro.hospireclub.com` (apuntado a Vercel).
- La web del cliente (gestionada aparte) lee su carta/horarios desde `GET /api/site?b=BLOGID`.
