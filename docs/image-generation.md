# Generación de imágenes por Telegram (deprecada)

Estado: **deprecada y retirada desde el 9 de octubre de 2026**, por decisión del
usuario. No está disponible para socios ni administradores.

- Oculta en Inicio, menú de socios y menú Admin, incluida la gestión de permisos.
- `/imagegen` y `/imagegen_admin` ya no se anuncian en los comandos ni en ayuda.
- Los accesos antiguos (`/image`, `/imagegen`, etiquetas de teclado y enlaces de
  concesión/revocación) informan de la retirada sin invocar Codex, generar
  imágenes, descargar referencias ni cambiar permisos.
- Las sesiones antiguas de generación o permisos se cancelan al volver a
  interactuar con ellas y su teclado se sustituye por `Inicio`.
- No existe un interruptor operativo para reactivarla. El servicio auxiliar y
  los permisos históricos permanecen en el repositorio/base de datos, pero los
  handlers Telegram no los ejecutan. Los temporales antiguos no se borran al
  consumir una sesión heredada.

P-003 (validación real), P-008 (limpieza de temporales) y P-025 (historial y
Storage) quedan cerrados como **descartados por deprecación**. La generación real
con entrega por Telegram no llegó a validarse; la retirada no equivale a esa
validación ni a implementar las mejoras descartadas.

La impresión y las consultas de portadas del catálogo mediante Codex conservan
sus propias capacidades y permisos.

## Validación de retirada

Las regresiones comprueban accesos de administradores y socios, sesiones
persistidas, adjuntos, comandos antiguos y enlaces de permisos, verificando que
no se genera ni se entrega ninguna imagen y que no se modifica ningún permiso.

```bash
npm test
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```
