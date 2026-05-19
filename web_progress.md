# Progreso: mejora de web integrada

Ultima actualizacion: 2026-05-19.

Este documento refleja el estado real del trabajo en la rama `web_upgrade`. Se
actualiza a medida que se completa cada punto del plan `web_integrada_plan.md`.

## Resumen

| Punto | Estado real | Evidencia |
| --- | --- | --- |
| Base de layout y temas | Hecho | `src/http/http-pages.ts`, `src/http/http-theme.ts`, tests `http-theme` |
| Marca CAWA y guidelines | Hecho | `docs/brand-guidelines.md`, defaults de marca en web settings |
| Logo, casco y favicon base | Hecho | `cawa_logo.svg`, `cawa_casco.svg`, rutas `/brand/cawa_logo.svg` y `/brand/cawa_casco.svg` |
| Configuracion de portada desde admin | Hecho | `/admin/web`, `web-settings-store`, uploads a `data/http-assets/` |
| Navegacion publica | Hecho | Portada enlaza a admin, feedback, actividades, catalogo, club y alta |
| Informacion del club | Hecho | `/club` configurable desde `/admin/web` |
| Horarios de actividades | Hecho | `/actividades` lista actividades futuras reales |
| Catalogo publico | Hecho | `/catalogo` con busqueda, filtro por tipo y paginacion |
| Alta web como socio | Hecho | `/alta`, tabla `member_signup_requests`, avisos privados a admins |
| Feed `nuevos_miembros` | Hecho | Categoria de noticias, aliases y panel `/admin/news` |
| Dashboard admin inicial | Hecho | `/admin` muestra estadisticas e informacion relevante |
| Secciones admin separadas | En curso | Hechas: web, feedback, altas, noticias, backups, servicio/logs, configuracion tecnica y recursos avanzados |
| Confirmaciones destructivas | Hecho | Restore/delete backup, stop service, cambio de token y hard delete requieren confirmacion textual |
| Seguridad admin | Hecho | Sesiones firmadas, CSRF en POST admin, login rate-limit, token pendiente no se imprime |
| Inventario de features | Hecho por corte | `docs/feature-status.md` actualizado en cada avance |
| Validacion runtime | Hecho por corte | Tests/typecheck/audit pasan; `./startup.sh` completado y `gameclubtelegrambot.service` activo |

## Pendiente

| Punto | Estado real | Siguiente accion |
| --- | --- | --- |
| Password admin runtime | Hecho local/deploy | `config/.env` y `config/runtime.local.json` validan `cawabotadmin`; login HTTP local devuelve 303 a `/admin` tras `./startup.sh` |
| Admin por dominios completos | Pendiente | Decidir si crear secciones admin dedicadas para actividades, catalogo y socios o enlazar a las superficies existentes |
| Revision de altas web | Pendiente opcional | Implementar cambio de estado/resolucion desde `/admin/member-signups` si se quiere gestionar el ciclo completo desde web |
| Revision de feedback | Pendiente opcional | Añadir estado revisado/pendiente si el club quiere bandeja de seguimiento |
| Comprobacion publica HTTPS | Pendiente | Verificar `https://cawa.hopto.org/`, `/admin` y nuevas rutas despues de `startup.sh` |
| Validacion final del plan | Pendiente | Ejecutar suite acordada, revisar docs y crear commit final de cierre |

## Validaciones recientes

- `node --import tsx --test src/http/admin-http-server.test.ts src/http/http-theme.test.ts src/http/web-settings-store.test.ts`: pasa.
- `npm run typecheck`: pasa.
- `./scripts/feature-status-audit.sh`: pasa.
- `./startup.sh`: pasa.
- `systemctl status gameclubtelegrambot.service --no-pager`: servicio activo.
- `POST /admin/login` con `cawabotadmin`: devuelve `303 Location: /admin`.
- `GET /brand/cawa_casco.svg`: devuelve `200 image/svg+xml`.
- `GET /`: devuelve `200` e incluye logo y favicon de marca por defecto.
