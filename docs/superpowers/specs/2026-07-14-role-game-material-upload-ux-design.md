# Diseño: subida y consulta de materiales de Rol

**Fecha:** 2026-07-14  
**Estado:** aprobado para planificación

## Objetivo

Hacer que la gestión de materiales de una partida de Rol siga el patrón de Storage: teclados persistentes, uno o varios adjuntos agrupados en un único material, nombre elegido por el uploader y entrega directa de los archivos al abrir el detalle.

## Decisiones de producto

- Las acciones normales se muestran en el teclado de respuesta persistente. No se añaden botones inline bajo los mensajes nuevos del flujo.
- Un material contiene uno o más adjuntos y corresponde a una única entrada interna de Storage.
- Un álbum de Telegram se incorpora como pack. El usuario también puede añadir archivos sucesivos antes de cerrar el pack.
- Después de recibir adjuntos, el bot pregunta al uploader si quiere añadir más o terminar.
- Al terminar los adjuntos, el bot solicita un nombre obligatorio para el material.
- El bot propone como nombre el primer caption útil, el primer nombre de archivo normalizado o un fallback localizado según el tipo de adjunto.
- El nombre sugerido se puede aceptar desde el teclado o sustituir escribiendo otro.
- Abrir un material siempre entrega directamente sus adjuntos al usuario autorizado, además del resumen textual.
- Los enlaces `role_material_<id>` se conservan como acceso al detalle, no como sustituto de los archivos.

## Flujo de subida

1. Un manager operativo abre `Materiales` y pulsa `Subir material` desde el teclado persistente.
2. El bot inicia una sesión `role-game-material-upload` y solicita el primer archivo, imagen, vídeo o audio.
3. Cada adjunto recibido se registra en el borrador con chat de origen, message ID, tipo, file IDs, caption, nombre, MIME, tamaño, media group y orden.
4. El bot mantiene un único recibo editable con el número de adjuntos recibidos. Ese recibo no lleva teclado.
5. Un mensaje de control separado muestra un teclado persistente con `Añadir más archivos`, `Terminar adjuntos` y `Cancelar`.
6. Si el usuario envía un álbum, todos los mensajes con el mismo `media_group_id` se incorporan al mismo borrador respetando el orden de llegada.
7. Al pulsar `Terminar adjuntos`, el bot solicita el nombre y muestra una acción localizada para aceptar el nombre sugerido.
8. Tras recibir o aceptar el nombre, el bot comienza un progreso editable: prepara Storage interno, copia todos los mensajes, crea una entrada Storage con todos los adjuntos y crea un único `role_game_materials` enlazado a esa entrada.
9. Si la categoría interna `role_game_handouts` no existe, se aprovisiona automáticamente en el supergrupo Storage por defecto antes de copiar el pack.
10. Al finalizar, el bot cancela la sesión, convierte el progreso en confirmación y restaura el teclado de materiales de la partida.

No se persiste parcialmente un `role_game_materials`: primero deben copiarse e indexarse todos los adjuntos. Si una copia o el alta en Storage falla, el flujo informa del error y no crea el material de Rol. Las copias ya realizadas quedan registradas en logs para limpieza operativa; esta mejora no introduce una transacción distribuida con Telegram.

## Detalle y entrega de adjuntos

Al abrir `/start role_material_<id>`:

1. El bot revalida aprobación, bloqueo, partida, membresía, visibilidad y permisos.
2. Envía el resumen con nombre, descripción si existe y estado de visibilidad.
3. Lee la entrada Storage interna enlazada.
4. Copia directamente al chat privado todos los mensajes del material, en orden.
5. Muestra el teclado persistente correspondiente.

Para managers, el teclado contiene `Enviar a jugadores`, `Enviar y revelar`, `Revelar sin enviar` y `Volver a materiales`. Para jugadores autorizados, sólo navegación de vuelta. Si la entrada Storage falta o no contiene mensajes, el bot informa del problema sin mostrar acciones que dependan de esos adjuntos.

La entrega masiva a jugadores reutiliza la entrada multiadjunto y copia todos sus mensajes a cada jugador confirmado. El resumen final cuenta destinatarios, no archivos.

## Navegación y compatibilidad

- `Materiales`, paginación, `Subir material`, acciones de detalle y vuelta usan reply keyboard persistente.
- Los callbacks inline existentes se mantienen temporalmente como adaptadores para mensajes antiguos, pero las respuestas nuevas ya no generan esos botones.
- Las selecciones de material mediante texto deben usar mapas session-safe; nunca se interpreta un ID escrito o una etiqueta que no aparezca en la sesión actual.
- Al terminar o cancelar, el flujo vuelve a la sección `Materiales` de la misma partida, no al menú raíz genérico de Rol.

## Modelo y Storage

No hace falta una migración. `role_game_materials.internal_storage_entry_id` ya representa un material y `storage_entry_messages` ya admite varios mensajes ordenados por entrada.

Los handouts siguen usando `categoryPurpose = 'role_game_handouts'` y permanecen excluidos de navegación, búsqueda, edición, impresión y borrado genéricos de Storage.

## Localización

Se añaden textos en catalán, español e inglés para:

- adjunto registrado y contador;
- añadir más y terminar adjuntos;
- solicitud de nombre;
- aceptación del nombre sugerido;
- errores de pack, copia o entrada Storage ausente;
- volver a materiales;
- acciones de envío y revelado desde teclado.

## Pruebas

La implementación debe cubrir al menos:

- un adjunto y nombre escrito;
- nombre sugerido aceptado;
- varios adjuntos enviados sucesivamente;
- álbum agrupado por `media_group_id`;
- orden estable de mensajes;
- cancelación sin crear Storage ni material;
- fallo durante copia sin crear `role_game_materials`;
- aprovisionamiento automático de handouts;
- detalle que copia una imagen y un documento al solicitante;
- material privado oculto a jugadores;
- detalle GM con reply keyboard y sin inline keyboard;
- callbacks antiguos todavía funcionales;
- envío multiadjunto a todos los jugadores confirmados;
- retorno a la sección `Materiales` tras completar o cancelar.

## Validación y despliegue

- Pruebas específicas de `role-game-flow` y teclados.
- Regresión de Storage para confirmar que los handouts siguen ocultos.
- `npm run typecheck`.
- `./scripts/feature-status-audit.sh` después de actualizar `docs/feature-status.md`.
- `./startup.sh`, servicio activo, Admin HTTP 200 y journal limpio del arranque.
