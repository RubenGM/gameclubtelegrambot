# Admin HTTP server del bot

El servidor HTTP forma part del mateix procés Node.js que el bot de Telegram.
No és una aplicació frontend ni un servei separat. La implementació principal és
`src/http/admin-http-server.ts` i el runtime l'arrenca juntament amb Telegram,
PostgreSQL i els workers del bot.

## Configuració runtime

El bloc opcional és:

```json
{
  "httpServer": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 8787,
    "feedbackFile": "data/feedback.jsonl"
  }
}
```

Defaults:

- `enabled`: `true`
- `host`: `127.0.0.1`
- `port`: `8787`
- `feedbackFile`: `data/feedback.jsonl`
- `sessionSecret`: clau aleatòria generada en arrencar si no s'indica

`feedbackFile` es resol relativament al directori de l'aplicació. En el
desplegament per defecte correspon a
`/opt/gameclubtelegrambot/data/feedback.jsonl`.

Mantén `host` a `127.0.0.1`. L'esquema accepta altres adreces, però el servidor
no està pensat per escoltar directament a Internet ni a la LAN. A producció s'ha
d'exposar mitjançant un reverse proxy HTTPS administrat.

La configuració Nginx i Certbot de la màquina actual no està versionada en aquest
repositori. Aquest document no prescriu directives que el codi no pugui
verificar. Qualsevol configuració externa ha de preservar, com a mínim:

- backend exclusiu a `127.0.0.1:8787`
- HTTPS a la cara pública
- accés a totes les rutes públiques, admin, assets i webhooks necessàries
- límits de cos compatibles amb els límits interns
- cap exposició directa del port `8787`

## Rutes públiques

El servidor implementa:

- `GET /`: portada
- `GET /club`: informació del club
- `GET /actividades`: activitats públiques futures
- `GET /catalogo`: catàleg públic amb cerca, filtres i paginació
- `GET /catalogo/<id>`: detall d'un article
- `GET /catalogo/media/<id>`: imatge de Storage associada al catàleg
- `GET /catalogo/bgg-image/<id>`: resolució de portada BoardGameGeek
- `GET /feedback` i `POST /feedback`: formulari públic de feedback
- `GET /alta` i `POST /alta`: sol·licitud d'alta de soci
- `GET /assets/<fitxer>`: assets pujats des del panell
- `GET /brand/<fitxer.svg>`: SVG de marca inclosos al projecte
- `POST /webhooks/notion/<secret>`: notificacions de fonts Notion de Rol

No hi ha un endpoint `/health` específic. Per a una comprovació de procés es fa
servir un `GET /`. No utilitzis `HEAD`: el router diferencia el mètode i no
implementa aquesta variant.

Les pàgines públiques de marca carreguen la configuració guardada a
`app_metadata`. Les activitats, el catàleg i les altes consulten PostgreSQL. El
feedback es desa al fitxer configurat, compartit amb el flux de feedback de
Telegram.

El webhook de Notion queda fora de la sessió admin. La ruta incorpora un secret
per font i les entregues posteriors a la verificació inicial validen la firma
HMAC SHA-256 sobre els bytes originals. La guia específica és
`docs/role-game-notion.md`.

## Panell admin

`GET /admin` redirigeix a `/admin/login` quan no hi ha una sessió vàlida. La
contrasenya és la mateixa credencial d'elevació administrativa definida a
`adminElevation.passwordHash`.

Les seccions principals són:

- `/admin`: dashboard
- `/admin/web`: marca, textos, enllaços i assets de la web pública
- `/admin/activities`: resum d'activitats
- `/admin/catalog`: resum de catàleg
- `/admin/storage`: navegació i gestió de Storage
- `/admin/users`: socis i usuaris
- `/admin/welcome`: plantilles de benvinguda
- `/admin/feedback`: feedback registrat
- `/admin/member-signups`: sol·licituds d'alta web
- `/admin/news`: feeds i subscripcions
- `/admin/backups`: creació, restauració i eliminació de backups
- `/admin/service`: estat, logs i control del servei
- `/admin/config`: estat runtime i canvi del token de Telegram
- `/admin/resources`: gestor avançat de recursos
- `/admin/resources/club_equipment`: alta, edició i desactivació de l'equipament reservable

El formulari personal d'alta d'activitats (`/actividad/nueva/:token`) permet
reservar una mesa i diversos elements d'equipament actius. La seva agenda del
dia detecta els solapaments que comparteixen qualsevol d'aquests recursos i els
avisa abans de guardar, però no bloqueja la creació.

El panell pot executar accions sensibles dins dels permisos del servei:
arrencar, aturar o reiniciar la unitat; crear o restaurar backups; canviar el
token de Telegram; editar dades; i fer determinats borrats definitius. Les
accions destructives rellevants afegeixen una confirmació textual, però el
panell continua sent una superfície administrativa d'alt privilegi.

## Model de sessió i CSRF

El comportament actual és:

- sessió guardada només en memòria del procés
- durada de vuit hores
- cookie `gameclub_admin_session` signada amb HMAC SHA-256
- flags de cookie `HttpOnly` i `SameSite=Lax`
- token CSRF aleatori a les accions `POST` autenticades
- logout amb comprovació de CSRF

Si `httpServer.sessionSecret` no està configurat, el procés genera una clau
aleatòria. Encara que es configuri una clau estable, les sessions no
sobreviuen a un reinici perquè el mapa de sessions és en memòria.

L'atribut `Secure` no s'afegeix actualment a la cookie. Per tant, HTTPS al
reverse proxy i la no exposició directa del backend són requisits operatius,
però no substitueixen aquest límit del codi. No descriguis la cookie actual com
una cookie `Secure`.

## Límit d'intents de login

Després de cinc intents fallits dins d'una finestra de quinze minuts, el login
respon amb `429`. La clau usada és `request.socket.remoteAddress`.

Això limita per adreça del peer TCP que veu Node, no necessàriament per IP
pública del client. Darrere d'un reverse proxy, diversos clients poden compartir
la mateixa adreça de loopback i, per tant, el mateix bloqueig. El servidor no
consumeix actualment `X-Forwarded-For` per a aquest càlcul. Aquesta limitació
s'ha de presentar com a protecció bàsica, no com un rate limit distribuït ni per
usuari final.

El mateix criteri de peer TCP es guarda com a `remoteAddress` a feedback i
sol·licituds d'alta.

## Límits de petició i fitxers

- cos normal màxim: 64 KiB
- asset de marca màxim: 2 MiB
- formats d'asset acceptats: PNG, JPEG, WEBP i GIF
- pàgina de catàleg públic: 24 articles
- noms d'assets validats abans de resoldre paths
- SVG públic limitat als assets de marca inclosos en allowlist

Les imatges pujades es desen a `data/http-assets/`. Les miniatures de catàleg i
Storage poden crear caches sota `data/http-cache/`.

`install-debian-stack.sh` desplega l'arbre amb `rsync --delete` i no exclou
`data/`. Per tant, `data/feedback.jsonl` i `data/http-assets/` creats només a
`/opt/gameclubtelegrambot` poden desaparèixer en un desplegament posterior si no
existeixen també a la font sincronitzada. El backup complet tampoc els inclou
actualment. Conserva'ls amb una còpia separada abans d'actualitzar i restaura'ls
després, tal com documenta `docs/backup-restore-recovery.md`.

`data/http-cache/` és regenerable i no s'ha de tractar com a dada durable.

## Operació i diagnòstic

Comprovació local després de `./startup.sh`:

```bash
systemctl is-active gameclubtelegrambot.service
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:8787/
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:8787/admin
./scripts/service-journal.sh -n 80
```

El resultat esperat és:

- servei `active`
- `GET /` amb codi `200`
- `GET /admin` sense sessió amb codi `303` cap a `/admin/login`
- línia `Admin HTTP server started` al journal, amb host i port

Per comprovar la publicació externa, usa també peticions `GET` sobre el domini
configurat i verifica el certificat amb les eines de la màquina. Aquest
repositori conté referències al domini actual, però no determina quin fitxer
Nginx ni quin certificat estan efectivament instal·lats. La validació local no
demostra per si sola que HTTPS o el reverse proxy siguin correctes.

Errors habituals:

- `connection refused` a `8787`: revisa `httpServer.enabled`, el servei i el
  journal
- redirecció absent a `/admin`: comprova que la petició sigui `GET` i que arribi
  al backend correcte
- sessió perduda després d'un restart: és el comportament esperat
- tots els admins bloquejats després d'intents d'un sol client: pot ser el límit
  compartit per l'adreça del reverse proxy
- assets o feedback absents després d'un deploy: revisa la còpia separada de
  `data/http-assets/` i `data/feedback.jsonl`
- webhook Notion amb `401`: comprova secret de ruta, token de verificació i
  signatura sense reserialitzar el cos

## Validació després de canvis

Quan es modifica el servidor HTTP o el seu comportament visible:

```bash
node --import tsx --test src/http/admin-http-server.test.ts
npm run typecheck
./scripts/feature-status-audit.sh
./startup.sh
```

Després comprova el servei, les rutes locals amb `GET`, el journal i, si el
canvi afecta la publicació, les rutes HTTPS reals.
