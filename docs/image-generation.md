# Generación de imágenes por Telegram

La opción privada `Generación de imágenes` (también `/imagegen`) usa Codex con
`$imagegen` para crear una imagen y devolverla directamente al mismo chat.

## Acceso y administración

Sólo la ven y pueden abrirla los administradores o socios aprobados con el
permiso global `image_generation.use`. Este permiso es independiente de
`printing.use`: `Admin` -> `Imágenes IA` permite concederlo, revocarlo y listar
sus destinatarios. Los administradores siempre tienen acceso. El comando
privado `/imagegen_admin` abre esa misma gestión administrativa.

Un socio bloqueado, no aprobado o sin el permiso independiente no puede iniciar
el flujo. Autorizar impresión no autoriza imágenes, ni al revés.

## Flujo de usuario

El flujo sólo se admite por DM y ofrece:

- `Describir`: guarda una descripción directa, admite hasta cuatro imágenes de
  referencia y genera al tocar `Generar imagen`.
- `Guiado`: Codex prepara un prompt desde una petición general. El socio puede
  escribir cambios sucesivos, añadir referencias, generar o cancelar.

Las referencias aceptadas son fotos de Telegram o documentos cuyo MIME empiece
por `image/`. El bot admite hasta cuatro por petición. Su descarga solicita
explícitamente el Bot API local cuando está habilitado y conserva el fallback
cloud para archivos pequeños; consulta
`docs/telegram-local-bot-api-printing.md`.

## Ejecución y seguridad

Cada petición usa un directorio temporal aislado. El servicio invoca siempre
`GAMECLUB_CODEX_BIN` (con `./scripts/codex-cawa.sh` como valor por defecto), le
indica explícitamente la ruta exacta de salida y envía el PNG resultante como
foto mediante `sendMediaGroup`. No se debe invocar `codex` directamente desde el
servicio.

La optimización y la generación tienen un timeout interno de 180 segundos por
invocación. Tras un resultado o una cancelación se borra el directorio. Si la
generación falla, la sesión y el workspace se conservan para que el usuario
pueda reintentar o cancelar; el error visible no expone el prompt, las rutas ni
la salida de Codex.

Las tareas de optimización y generación muestran un mensaje de progreso
editable. La generación no forma parte del asistente general `/ask` ni concede
acceso a shell, base de datos, archivos del repositorio o acciones de negocio.

## Archivos y validación

Implementación principal:

- `src/image-generation/codex-image-generation-service.ts`
- `src/image-generation/image-generation-permissions.ts`
- `src/telegram/image-generation-flow.ts`
- `src/telegram/image-generation-admin-flow.ts`
- `src/telegram/i18n-image-generation.ts`

Validación local mínima:

```bash
node --import tsx --test src/telegram/image-generation-flow.test.ts src/printing/print-permissions.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```

Los tests, el typecheck y un despliegue correcto no demuestran por sí solos una
generación externa completa. Antes de declarar la feature verificada de extremo
a extremo hay que ejecutar una petición real, comprobar que Codex crea
`generated.png` y confirmar que `sendMediaGroup` termina y entrega la foto en
Telegram. El intento productivo registrado en julio de 2026 no confirmó esos
tres pasos, por lo que esta verificación real sigue pendiente.
