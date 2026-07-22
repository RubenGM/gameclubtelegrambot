# Notion para campañas de Rol

La integración conecta una **conexión interna de Notion de sólo lectura** con el
material de una campaña. No edita Notion, no crea páginas y no envía contenido
automáticamente a jugadores.

## Preparación

1. Cada DM crea su propia integración interna en Notion, sólo con capacidades
   de lectura de contenido.
2. Comparte desde Notion la página raíz de su campaña con esa integración.
   Sólo las páginas alcanzables desde esa raíz pueden importarse en la campaña.
3. En `config/runtime.json`, activa:

   ```json
   { "notion": { "enabled": true } }
   ```

4. Genera una clave de cifrado local para el servidor y guárdala fuera del JSON:

   ```bash
   openssl rand -hex 32
   ```

   Úsala como `GAMECLUB_NOTION_CREDENTIAL_ENCRYPTION_KEY` en `config/.env`
   (ignorando por Git) y despliega con `./startup.sh`. El despliegue copia
   `config/runtime.json` y `config/.env` a `/etc/gameclubtelegrambot`; no
   configures la clave sólo en `/etc`, porque el siguiente despliegue la
   sustituirá.

El editor `npm run config:edit` muestra esta clave en la sección Notion. No es
un token de Notion: cifra los tokens por partida que los DM envían en el flujo
privado. El bot redacta ese mensaje en el journal y, después de guardarlo
cifrado localmente, intenta borrarlo de Telegram; el borrado sigue siendo
best-effort y no elimina la copia de tránsito de Telegram.

## Suscripción de webhook

En el portal de integraciones de Notion crea una suscripción con esta URL:

```text
https://cawa.hopto.org/webhooks/notion/<secreto-de-la-fuente-de-la-partida>
```

El secreto de ruta se genera por fuente y no debe compartirse. Activa los eventos de página relevantes (creación, modificación de contenido o
propiedades, movimiento, archivado y restauración). En el primer `POST`, Notion
entrega un `verification_token`: el bot lo guarda de forma privada y se lo envía
al DM que vinculó la fuente para pegarlo en el portal de Notion. Se conserva
cifrado y por fuente, no como configuración global del club.

Las entregas posteriores sólo se aceptan con la firma HMAC SHA-256 de Notion
sobre el cuerpo original. La URL incluye además el secreto de ruta. Rota ambos
secretos, sustituye la suscripción y reinicia el servicio si se sospecha una
exposición.

## Uso desde Telegram

El GM principal, coorganizadores y admins globales abren `Rol` → una partida →
`Materiales` → `Notion`. También existe `/notion <id-de-partida>` en privado.

1. `Vincular fuente`: envía el token en el paso privado, y después pega la URL
   o el ID de la página raíz y confirma. Se aceptan enlaces oficiales
   `notion.so`, `notion.site` y `app.notion.com`. El token se cifra localmente
   y no se vuelve a mostrar.
2. `Navegar contenido`: actualiza el árbol accesible y permite recorrer las
   subpáginas desde la raíz. Cada documento o carpeta es un enlace pulsable del
   propio mensaje; las páginas con hijas se muestran como carpetas. El teclado
   queda reservado para importar la página abierta, volver y paginar la lista.
   Un aviso `⚠️` indica que Notion notificó un
   cambio pendiente en esa página.
3. `Importar página`: se mantiene como alternativa para pegar la URL o ID de
   una página ya presente bajo la fuente. Ambos caminos muestran una
   previsualización antes de la confirmación.
4. Al confirmar, el texto y los adjuntos alojados por Notion se copian al topic
   interno `role_game_handouts` y se crean como material `gm_only`. Desde ahí se
   aplican las acciones existentes de Materiales para enviar o revelar a un
   jugador, con su auditoría normal.

La importación acepta los bloques de texto habituales, listas, citas, código,
callouts, toggles, divisores, tablas simples, subpáginas y archivos. Se indica
en la previsualización cualquier bloque no renderizable, contenido truncado o
adjunto externo; los adjuntos externos no se descargan. Los límites protegen el
servicio (1.000 bloques por página, profundidad 8 al indexar y 20 MiB por
archivo descargado).

## Cambios recibidos

Los eventos webhook se registran de forma idempotente y generan una entrada
pendiente por cada campaña afectada. La URL secreta de cada fuente también
asocia cambios de páginas nuevas que aún no se hayan indexado: al abrir
`Navegar contenido`, el árbol se refresca y esa página pasa a estar disponible.
Los GM reciben un aviso privado best-effort. En `Navegar contenido` ven el
aviso `⚠️` junto a cada página con cambio pendiente; al reimportarla se cierran
sus cambios pendientes, y `Descartar
cambios` permite cerrar explícitamente los que no deban convertirse en
material. Ninguna de estas acciones publica ni reenvía material por sí sola.

Al desvincular la fuente se elimina el vínculo, el índice y la cola de esa
campaña, pero los materiales ya importados se conservan como handouts internos.

## Diagnóstico

- `Notion no está configurado`: revisa `notion.enabled`, el token y reinicia.
- `La página no pertenece a la fuente`: comparte la raíz correcta con la
  integración y pulsa `Actualizar fuente` antes de importarla.
- `401` en webhook: comprueba la ruta secreta y el token de verificación; la
  firma se valida sobre bytes sin volver a serializar JSON.
- `Cambios pendientes` no implica envío: es una señal de revisión, no un
  sincronizador automático.
