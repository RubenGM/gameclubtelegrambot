# Generación de imágenes por Telegram

La opción privada `Generación de imágenes` (también `/imagegen`) usa Codex con
`$imagegen` para crear una imagen y devolverla directamente al mismo chat.

Sólo la ven y pueden abrirla los administradores o socios aprobados con el
permiso global `image_generation.use`. Este permiso es independiente de
`printing.use`: `Admin` -> `Imágenes IA` permite concederlo, revocarlo y listar
sus destinatarios. Los administradores siempre tienen acceso.

El flujo sólo se admite por DM y ofrece:

- `Describir`: guarda una descripción directa, admite hasta cuatro imágenes de
  referencia y genera al tocar `Generar imagen`.
- `Guiado`: Codex prepara un prompt desde una petición general. El socio puede
  escribir cambios sucesivos, añadir referencias, generar o cancelar.

Cada petición usa un directorio temporal aislado. El servicio invoca siempre
`GAMECLUB_CODEX_BIN` (con `./scripts/codex-cawa.sh` como valor por defecto), le
indica explícitamente la ruta exacta de salida y envía el PNG resultante como
foto de Telegram. Tras un resultado o una cancelación se borra el directorio;
los fallos no exponen el prompt, las rutas ni la salida de Codex al usuario.

Las tareas de optimización y generación muestran un mensaje de progreso
editable. La generación no forma parte del asistente general `/ask` ni concede
acceso a shell, base de datos, archivos del repositorio o acciones de negocio.
