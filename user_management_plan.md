# Goal: mejorar Administrar usuarios

## Objetivo

Convertir la sección privada de admin `Administrar usuarios` / `/manage_users` en una pantalla real de gestión de usuarios, no solo en una lista para expulsar.

La experiencia esperada es:

- La lista de usuarios muestra cada persona con el nombre como enlace clicable al detalle del usuario.
- El `@username` sigue siendo clicable hacia Telegram cuando exista.
- La lista ya no muestra el texto `-> Expulsar`.
- El detalle de usuario resume estado, rol y actividad operativa relevante.
- Las acciones destructivas o de rol aparecen solo en el detalle, como botones de teclado.
- Se eliminan los botones inline de `Expulsar (usuario)` de la lista.

## Alcance funcional

### 1. Lista de usuarios gestionables

Cambiar `handleManageUsers` en `src/telegram/runtime-boundary-registration.ts` para que deje de depender de una lista "revocable" como concepto visible.

Comportamiento:

- La cabecera debe hablar de gestión de usuarios, no de expulsión.
- Cada línea debe incluir:
  - nombre visible como deep link al detalle, por ejemplo `tg://resolve?...` no aplica para ID, así que usar `https://t.me/<bot>?start=manage_user_<telegramUserId>` o callback si se decide mantener inline solo para navegación;
  - `@username` clicable hacia `https://t.me/<username>` cuando exista;
  - estado actual: aprobado, pendiente, bloqueado/revocado si entra en alcance;
  - rol: admin o socio.
- Quitar el sufijo actual `-> Expulsar`.
- Quitar los inline buttons actuales `Expulsar: ...`.

Decisión de implementación recomendada:

- Mantener inline callbacks solo para navegación al detalle si Telegram no permite una experiencia fiable con deep links privados en el contexto actual.
- Si se usan callbacks, el nombre del usuario debe ser el texto del botón o enlace HTML clicable, y el `@username` del cuerpo debe seguir siendo enlace HTML.
- Usar `parseMode: 'HTML'` y escapar etiquetas en nombres de usuario.

### 2. Detalle de usuario

Añadir una vista de detalle de usuario accesible desde la lista.

Debe mostrar, como mínimo:

- Identidad:
  - nombre visible;
  - `@username` clicable si existe;
  - Telegram user id;
  - estado de acceso;
  - rol admin/socio.
- Préstamos activos del catálogo:
  - usar `CatalogLoanRepository.listActiveLoansByBorrower(telegramUserId)`;
  - incluir nombre del item si el contrato actual no lo devuelve. Si hace falta, añadir método específico de lectura con join a `catalog_items` en vez de resolver item por item;
  - mostrar fecha de préstamo y fecha prevista de devolución si existe;
  - si no hay préstamos, mostrar una línea clara de "sin préstamos activos".
- Actividades futuras en las que está apuntado:
  - añadir método de repositorio o helper para listar eventos donde `schedule_event_participants.participant_telegram_user_id = userId` y `status = 'active'`;
  - filtrar `schedule_events.lifecycle_status = 'scheduled'` y `starts_at >= now`;
  - mostrar título, fecha/hora y si es organizador cuando aplique.
- Actividades recientes a las que ha ido:
  - listar eventos pasados con participante activo;
  - limitar a las últimas 5 o 10 para que el mensaje no sea demasiado largo;
  - mostrar título y fecha.
- Datos adicionales útiles si son baratos y ya existen:
  - fecha de alta/última actualización del usuario si el modelo `users` lo expone;
  - número total de actividades futuras y recientes si se recorta la lista;
  - número de préstamos activos.

### 3. Acciones desde el detalle con teclado

En el detalle, añadir reply keyboard con acciones:

- `Expulsar usuario`
- `Ascender a administrador`
- `Eliminar acceso de administrador`
- `Volver al inicio`

Comportamiento:

- `Expulsar usuario` inicia el flujo existente de revocación con motivo, reutilizando `membershipRevokeFlowKey`, pero debe permitir que el target venga del detalle y no desde un inline button.
- `Ascender a administrador` debe elevar al usuario seleccionado sin pedirle al usuario objetivo que ejecute `/elevate_admin`.
- `Eliminar acceso de administrador` debe revocar `isAdmin` del usuario seleccionado, sin revocar su acceso de socio.
- `Volver al inicio` cancela cualquier estado de gestión y muestra el menú admin normal.

Reglas de seguridad:

- Solo admins en chat privado pueden abrir detalles y ejecutar acciones.
- No permitir que un admin se expulse a sí mismo desde esta UI.
- No permitir que un admin elimine su propio acceso admin si eso deja el bot sin admins, salvo que se implemente una comprobación explícita de admins restantes y se decida permitirlo.
- No mostrar `Ascender a administrador` si el usuario ya es admin.
- No mostrar `Eliminar acceso de administrador` si el usuario no es admin.
- No mostrar `Expulsar usuario` para admins mientras no exista una decisión explícita sobre expulsión de admins; si se permite, primero debe degradarse o confirmarse de forma separada.

### 4. Persistencia y dominio de roles

El flujo actual de ascenso está pensado para auto-elevación con contraseña en `src/membership/admin-elevation.ts` y `src/membership/admin-elevation-store.ts`.

Añadir un caso de uso administrativo separado:

- `grantAdminRoleToUser({ repository, targetTelegramUserId, adminTelegramUserId, reason })`
- `revokeAdminRoleFromUser({ repository, targetTelegramUserId, adminTelegramUserId, reason })`

Repositorio:

- Extender o crear un repositorio de roles de usuario que actualice `users.is_admin`.
- Registrar auditoría en:
  - `user_permission_audit_log` con `permission_key = 'role.admin'`;
  - `audit_log` con acciones como `membership.admin-granted` y `membership.admin-revoked`.
- Mantener compatibilidad con `elevateApprovedUserToAdmin` para `/elevate_admin`, o hacer que ambos usen una función interna común.

### 5. Callback, deep link y sesión

Añadir una forma estable de transportar el usuario seleccionado:

- callback recomendado: `membership_user:detail:<telegramUserId>`;
- session data recomendada para acciones de teclado:
  - `flowKey: 'membership-user-management'`;
  - `stepKey: 'detail' | 'revoke-reason' | 'confirm-revoke' | 'confirm-admin-grant' | 'confirm-admin-revoke'`;
  - `targetTelegramUserId`.

Evitar depender del texto visible del usuario para identificar targets.

### 6. Textos e i18n

Actualizar los textos comunes en `src/telegram/i18n-common.ts` o el fichero i18n correspondiente:

- cabecera de gestión de usuarios;
- etiquetas de estado y rol;
- secciones del detalle;
- mensajes de listas vacías;
- botones de teclado;
- confirmaciones de ascenso/degradación;
- errores de seguridad.

Mantener el estilo claro para novatos y consistente con el idioma activo (`ca`, `es`, `en`).

## Cambios técnicos esperados

Archivos probables:

- `src/telegram/runtime-boundary-registration.ts`
- `src/telegram/i18n-common.ts`
- `src/membership/access-flow.ts`
- `src/membership/access-flow-store.ts`
- `src/membership/admin-elevation.ts`
- `src/membership/admin-elevation-store.ts`
- `src/schedule/schedule-catalog.ts`
- `src/schedule/schedule-catalog-store.ts`
- `src/catalog/catalog-model.ts`
- `src/catalog/catalog-loan-store.ts`
- `src/infrastructure/database/schema.ts` solo si falta algún campo o índice, preferiblemente no necesario
- tests unitarios/flujo existentes en `src/membership/*test.ts`, `src/telegram/runtime-boundary.test.ts`, `src/schedule/*test.ts`, `src/catalog/*test.ts`
- `docs/feature-status.md`

## Plan de ejecución

1. Inventariar el flujo actual.
   - Confirmar cómo se registra `/manage_users`.
   - Confirmar callbacks actuales de revocación.
   - Confirmar el menú admin y los textos i18n.
   - Confirmar qué datos de usuario ya devuelve `MembershipAccessRepository`.

2. Ampliar lectura de usuarios.
   - Renombrar mentalmente el caso de uso de "revocables" a "gestionables".
   - Añadir método de repositorio si hace falta para listar usuarios aprobados, admins y no admins.
   - Mantener orden estable por nombre o fecha de alta.

3. Crear consultas de estadísticas.
   - Préstamos activos por usuario con nombre del item.
   - Actividades futuras por usuario.
   - Actividades recientes por usuario.
   - Mantener límites para evitar mensajes enormes.

4. Crear render del detalle.
   - Función pura para formatear el perfil.
   - Usar HTML seguro para enlaces.
   - Incluir estados vacíos legibles.

5. Cambiar lista de gestión.
   - Quitar `-> Expulsar`.
   - Quitar inline buttons de expulsión.
   - Hacer nombre clicable hacia detalle.
   - Mantener `@username` clicable.

6. Añadir navegación al detalle.
   - Registrar callback o payload `/start manage_user_<id>`.
   - Validar permisos admin/private antes de responder.
   - Guardar `targetTelegramUserId` en sesión para las acciones de teclado.

7. Implementar acciones de teclado.
   - Volver al inicio.
   - Expulsar usuario reutilizando el flujo de motivo y confirmación.
   - Ascender a administrador con auditoría.
   - Eliminar acceso admin con auditoría.
   - Refrescar el detalle o volver al menú tras cada acción.

8. Tests.
   - Lista de usuarios no contiene `-> Expulsar`.
   - La lista mantiene `@username` como enlace.
   - El nombre abre detalle.
   - Detalle muestra préstamos activos.
   - Detalle muestra actividades futuras y recientes.
   - No se muestran acciones de rol inválidas según usuario admin/no admin.
   - Acciones de teclado solo funcionan en privado y con actor admin.
   - Ascender/degradar escribe auditoría.
   - Expulsar desde detalle reutiliza el flujo con motivo.

9. Actualizar inventario.
   - Actualizar `docs/feature-status.md` en `Acceso, usuarios y admins`.
   - Mantener el `Resumen ejecutivo` en tabla ASCII de ancho fijo.

10. Validación final.
    - Ejecutar tests focalizados.
    - Ejecutar `npm run lint`.
    - Ejecutar `npm run typecheck`.
    - Ejecutar `./scripts/feature-status-audit.sh`.
    - Ejecutar `./startup.sh` para validar el bot desplegable y sincronizar artefactos de despliegue.

## Criterios de aceptación

- Desde el menú admin privado, `Administrar usuarios` abre una lista de gestión, no una lista de expulsión.
- Ninguna línea de la lista muestra `-> Expulsar`.
- No aparecen botones inline `Expulsar: <usuario>` en la lista.
- Al tocar el nombre de un usuario se abre su detalle.
- Al tocar `@username` se abre el perfil de Telegram del usuario.
- El detalle muestra préstamos activos del catálogo o indica que no hay.
- El detalle muestra actividades futuras apuntadas o indica que no hay.
- El detalle muestra actividades recientes asistidas o indica que no hay.
- El detalle incluye teclado con acciones válidas para ese usuario y botón `Volver al inicio`.
- Expulsar desde el detalle pide motivo y confirmación antes de revocar acceso.
- Ascender y eliminar admin funcionan solo para admins, escriben auditoría y actualizan `users.is_admin`.
- No se permite auto-expulsión ni auto-degradación peligrosa.
- `docs/feature-status.md` refleja la mejora.
- Typecheck, lint, auditoría de features y `./startup.sh` pasan.

## Riesgos y decisiones abiertas

- Telegram no permite enlazar directamente a un usuario por ID si no hay username. Para el nombre clicable conviene usar callback inline o deep link al bot con payload, no `tg://user?id=...` como única vía.
- Si se usa deep link `/start manage_user_<id>`, hay que asegurar que no interfiera con onboarding y otros payloads existentes.
- El repositorio de agenda no tiene ahora una consulta directa "eventos por participante"; conviene añadirla para evitar cargar todos los eventos y participantes en memoria.
- El flujo actual de revocación bloquea admins. Si se quiere expulsar admins desde esta nueva pantalla, debe definirse si primero se degrada o si se mantiene prohibido.
- La eliminación de admin debe proteger al menos el caso de último admin.
