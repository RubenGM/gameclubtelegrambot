# Goal: completar la feature de Prestamos

## Contexto actual

El inventario operativo marca `Prestamos` como `operativo parcial`.

Ya esta implementado:

- Crear prestamos desde botones del detalle/listado de catalogo.
- Devolver prestamos desde botones.
- Consultar prestamos activos propios.
- Editar notas y fecha prevista de devolucion.
- Publicar eventos de prestamo/devolucion a grupos de noticias por categoria.
- Mantener la restriccion persistente de un prestamo activo por item.

Pendiente segun `docs/feature-status.md`:

- Recordatorios de prestamos cuando se acerca o vence la fecha prevista.
- Flujo admin dedicado para ver todos los prestamos activos como dashboard.

El objetivo principal debe ser cerrar los recordatorios, porque es el motivo explicito por el que la feature aparece como parcial en el resumen ejecutivo. El dashboard admin es deseable, pero no deberia bloquear el cierre del goal si los recordatorios quedan completos, probados y documentados.

## Resultado esperado

Un prestamo con `dueAt` debe generar mensajes privados al usuario prestatario cuando entre en la ventana de recordatorio configurada, sin duplicar mensajes aunque el bot reinicie o el worker se ejecute varias veces.

Comportamiento esperado:

- Solo se consideran prestamos activos: `returnedAt === null`.
- Solo se consideran prestamos con fecha prevista de devolucion: `dueAt !== null`.
- Si `dueAt` esta dentro de la ventana de aviso, se envia un mensaje privado al `borrowerTelegramUserId`.
- Si `dueAt` ya vencio, se envia un recordatorio de vencimiento si todavia no se envio para ese prestamo.
- Si el envio falla, no se marca como enviado para permitir reintento posterior.
- Si el prestamo se devuelve antes de la siguiente pasada, deja de generar recordatorios.
- Si el mismo prestamo ya tiene registrado el recordatorio para ese tipo/antelacion, se omite.
- El texto debe estar localizado en catalan, castellano e ingles, siguiendo el estilo actual de los recordatorios de agenda y compras conjuntas.

Mensaje sugerido:

- ES previo: `Recordatorio: {item} debe devolverse el {date}.`
- ES vencido: `Recordatorio: {item} tenia prevista la devolucion el {date}.`
- CA previo: `Recordatori: {item} s'ha de tornar el {date}.`
- CA vencido: `Recordatori: {item} tenia prevista la devolucio el {date}.`
- EN previo: `Reminder: {item} is due back on {date}.`
- EN vencido: `Reminder: {item} was due back on {date}.`

El nombre del item debe salir del catalogo, no solo del id del prestamo.

## Diseno tecnico propuesto

Seguir el patron existente de agenda y compras conjuntas:

- `src/schedule/schedule-reminders.ts`
- `src/schedule/schedule-reminder-store.ts`
- `src/schedule/schedule-reminder-worker.ts`
- `src/group-purchases/group-purchase-reminders.ts`
- `src/group-purchases/group-purchase-reminder-store.ts`
- wiring actual en `src/bootstrap/create-app.ts`

### 1. Modelo de persistencia de recordatorios

Crear una tabla nueva para idempotencia, por ejemplo `catalog_loan_reminders`.

Campos recomendados:

- `id`
- `loan_id` con referencia a `catalog_loans.id`
- `borrower_telegram_user_id`
- `reminder_kind`, con valores iniciales `due_soon` y `overdue`
- `lead_hours`, nullable para vencidos o fijo para previos
- `sent_at`
- `created_at`

Indices recomendados:

- Unico por `(loan_id, borrower_telegram_user_id, reminder_kind, lead_hours)`.
- Indice por `loan_id`.
- Indice por `borrower_telegram_user_id`.

Actualizar:

- `src/infrastructure/database/schema.ts`
- migracion generada con `npm run db:generate:checked` o el flujo establecido del repo
- tests de migracion/estado si el repo los exige

### 2. Repositorio de recordatorios

Crear `src/catalog/catalog-loan-reminder-store.ts`.

Interfaz recomendada:

```ts
export type CatalogLoanReminderKind = 'due_soon' | 'overdue';

export interface CatalogLoanReminderRepository {
  hasReminderBeenSent(input: {
    loanId: number;
    borrowerTelegramUserId: number;
    reminderKind: CatalogLoanReminderKind;
    leadHours: number | null;
  }): Promise<boolean>;

  recordReminderSent(input: {
    loanId: number;
    borrowerTelegramUserId: number;
    reminderKind: CatalogLoanReminderKind;
    leadHours: number | null;
    sentAt: string;
  }): Promise<void>;
}
```

Debe comportarse como los repositorios de recordatorio existentes: comprobar primero, insertar solo tras envio correcto, y apoyarse en el indice unico para evitar duplicados.

### 3. Consulta de prestamos elegibles

Extender el repositorio de prestamos o crear una funcion de consulta especifica que devuelva prestamos activos con `dueAt` dentro de una ventana.

Opcion recomendada:

- Anadir a `CatalogLoanRepository` un metodo `listActiveLoansDueBefore(input: { dueAtTo: string; includeOverdue: boolean })`.
- Devolver tambien los datos minimos del item o crear una consulta de servicio que una `catalog_loans` con `catalog_items`.

El servicio necesita como minimo:

- `loan.id`
- `loan.borrowerTelegramUserId`
- `loan.dueAt`
- `item.displayName`
- `item.lifecycleStatus` solo si se decide omitir items desactivados

Decision de producto recomendada:

- Enviar recordatorios aunque el item este desactivado, si el prestamo sigue activo. La deuda existe por el prestamo, no por la visibilidad actual del catalogo.

### 4. Servicio de envio

Crear `src/catalog/catalog-loan-reminders.ts`.

Funcion recomendada:

```ts
export async function sendDueCatalogLoanReminders(...): Promise<CatalogLoanReminderRunResult>
```

Resultado recomendado:

- `consideredLoans`
- `sentReminders`
- `skippedReminders`
- `failedReminders`

Reglas:

- Usar `now` inyectable para tests.
- `due_soon`: entra si `dueAt >= now` y `dueAt <= now + leadHours`.
- `overdue`: entra si `dueAt < now`.
- No registrar nada si `sendPrivateMessage` falla.
- Fallos de un usuario no deben cortar el resto del lote.
- El formateo de fecha debe ser consistente con los recordatorios existentes.

### 5. Worker

Reutilizar `createScheduleReminderWorker` si basta con ejecutar mas tareas en el mismo tick, como ya ocurre con agenda y compras en `src/bootstrap/create-app.ts`.

Wiring recomendado:

- Importar `createDatabaseCatalogLoanRepository`.
- Importar `createDatabaseCatalogLoanReminderRepository`.
- Importar `sendDueCatalogLoanReminders`.
- Ejecutarlo dentro del `runOnce` actual, despues de agenda y compras o entre ambos.
- Usar `config.notifications.defaults.eventReminderLeadHours` como antelacion inicial para no ampliar config en el primer corte.
- Mantener `enabled: config.notifications.defaults.eventRemindersEnabled`, porque el repo ya usa ese toggle para recordatorios.

No crear un segundo intervalo salvo que haya una razon clara; el worker actual ya agrupa trabajos periodicos de recordatorio.

### 6. Configuracion

Primer corte recomendado:

- Reutilizar `notifications.defaults.eventRemindersEnabled`.
- Reutilizar `notifications.defaults.eventReminderLeadHours`.

Posible mejora posterior:

- Separar `loanRemindersEnabled` y `loanReminderLeadHours` si los operadores piden controlar prestamos aparte de agenda.

No bloquear el goal por esta separacion si no existe una necesidad operativa inmediata.

### 7. Dashboard admin

Si queda tiempo, anadir una vista admin de prestamos activos.

Alcance minimo:

- En la consola/admin existente, listar todos los prestamos activos.
- Mostrar item, prestatario, fecha de prestamo, fecha prevista y si esta vencido.
- Ordenar primero vencidos, luego los mas proximos a vencer.

Este dashboard no debe cambiar el estado de cierre del goal si los recordatorios quedan completos, porque el resumen ejecutivo senala el worker como carencia principal.

## Tests necesarios

Tests unitarios nuevos:

- `src/catalog/catalog-loan-reminders.test.ts`
  - envia `due_soon` dentro de la ventana.
  - no envia prestamos sin `dueAt`.
  - no envia prestamos devueltos.
  - envia `overdue` para prestamos vencidos.
  - omite recordatorios ya registrados.
  - no registra recordatorio si falla el DM.
  - un fallo no impide enviar al resto.

- `src/catalog/catalog-loan-reminder-store.test.ts`
  - `hasReminderBeenSent` devuelve `false` antes de registrar.
  - `recordReminderSent` persiste la entrega.
  - `hasReminderBeenSent` devuelve `true` tras registrar.
  - el criterio distingue `due_soon` y `overdue`.

Tests de wiring:

- Actualizar `src/bootstrap/create-app.test.ts` para comprobar que el worker arranca/parar sigue funcionando y que el `runOnce` invoca tambien recordatorios de prestamos.

Tests de repositorio:

- Si se anade `listActiveLoansDueBefore`, cubrir que:
  - incluye activos con fecha dentro de ventana.
  - excluye devueltos.
  - excluye sin fecha prevista.
  - incluye vencidos cuando corresponde.

Tests de integracion, si hay base local disponible:

- La migracion crea `catalog_loan_reminders`.
- El indice unico impide duplicar la misma entrega.

## Validacion manual y comandos

Ejecutar durante el desarrollo:

```bash
npm run typecheck
npm run test:unit
```

Ejecutar tests enfocados si se quiere iterar mas rapido:

```bash
node --import tsx --test src/catalog/catalog-loan-reminders.test.ts
node --import tsx --test src/catalog/catalog-loan-reminder-store.test.ts
node --import tsx --test src/bootstrap/create-app.test.ts
```

Validar inventario:

```bash
./scripts/feature-status-audit.sh
```

Cuando haya cambios que deban compilar y ejecutarse en el bot real:

```bash
./startup.sh
```

Si `./startup.sh` falla o el bot arranca pero no envia recordatorios:

```bash
./scripts/service-journal.sh -n 200
./scripts/service-journal.sh --since "YYYY-MM-DD HH:MM:SS" --until "YYYY-MM-DD HH:MM:SS"
```

Preferir `./scripts/service-journal.sh` a `journalctl` directo.

## Prueba manual en Telegram

Caso recomendado:

1. Crear o localizar un item de catalogo prestable.
2. Crear un prestamo activo para un usuario que tenga chat privado abierto con el bot.
3. Editar la fecha prevista de devolucion a una hora dentro de la ventana de recordatorio.
4. Reiniciar con `./startup.sh`.
5. Esperar al tick del worker o forzar una ventana cercana.
6. Confirmar que el usuario recibe un mensaje privado con el item y la fecha.
7. Confirmar en base de datos que existe una fila en `catalog_loan_reminders`.
8. Reiniciar otra vez con `./startup.sh`.
9. Confirmar que no se duplica el mismo recordatorio.
10. Marcar el prestamo como devuelto.
11. Confirmar que ya no se generan recordatorios para ese prestamo.

Caso vencido:

1. Crear un prestamo activo con `dueAt` anterior a `now`.
2. Ejecutar/reiniciar el bot.
3. Confirmar que se envia un recordatorio de vencimiento.
4. Confirmar que no se duplica tras otro tick/reinicio.

Caso fallo de envio:

1. Usar un prestatario al que el bot no pueda escribir o simular fallo en test.
2. Confirmar que el recordatorio no queda registrado como enviado.
3. Confirmar que un prestamo de otro usuario del mismo lote si se envia.

## Actualizacion del inventario

Actualizar `docs/feature-status.md` cuando el worker este terminado.

Cambios esperados:

- En `Resumen ejecutivo`, cambiar `Prestamos` de `operativo parcial` a `operativo` si los recordatorios quedan implementados y validados.
- En la seccion `## Prestamos`, mover `Recordatorios de prestamos cuando se acerca o vence la fecha prevista` de `Pendiente` a `Implementado`.
- En `Pendientes transversales mas relevantes`, eliminar o ajustar la fila `Recordatorios de prestamos`.
- Si el dashboard admin no se implementa, dejarlo como pendiente separado sin impedir el estado operativo, siempre que el flujo principal y los recordatorios esten completos.
- Mantener el bloque `Resumen ejecutivo` como tabla de texto ancho fijo dentro de bloque Markdown `text`, no convertirlo a tabla Markdown simple.

Despues de actualizar el inventario:

```bash
./scripts/feature-status-audit.sh
./startup.sh
```

## Criterio de cierre del goal

El goal puede darse por completado cuando se cumpla todo esto:

- El bot compila: `npm run typecheck` pasa.
- Los tests unitarios relevantes pasan, especialmente catalogo/prestamos, recordatorios y bootstrap.
- `./scripts/feature-status-audit.sh` no detecta problemas de formato o bloques minimos pendientes.
- `./startup.sh` termina correctamente y deja el servicio arrancado.
- `./scripts/service-journal.sh -n 200` no muestra errores nuevos relacionados con migraciones, worker de recordatorios, Telegram o base de datos.
- Un prestamo activo con fecha cercana genera un DM privado al prestatario.
- El mismo recordatorio no se duplica tras otro tick o reinicio.
- Un prestamo vencido genera el aviso de vencimiento una sola vez.
- Un prestamo devuelto no genera recordatorios.
- `docs/feature-status.md` refleja el nuevo estado y no conserva el pendiente de recordatorios si ya esta resuelto.

Si el dashboard admin no entra en este corte, dejar documentado en `docs/feature-status.md` como mejora pendiente, pero no mantener `Prestamos` en parcial solo por eso si el flujo usuario + worker de recordatorios ya esta operativo.
