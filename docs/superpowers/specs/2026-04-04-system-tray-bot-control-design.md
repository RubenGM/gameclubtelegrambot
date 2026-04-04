# System Tray Bot Control Design

## Goal

Afegir una eina de safata per Debian que permeti veure si el bot s'esta executant i controlar-ne l'arrencada, aturada i reinici de manera fiable.

## Scope

La v1 cobreix nomes:

- un servei `systemd` de sistema per al bot
- una aplicacio de safata d'usuari per Debian
- lectura d'estat del servei
- accions `Start`, `Stop` i `Restart`
- consulta rapida dels logs recents
- permisos limitats via `polkit`

La v1 no cobreix:

- suport multiplataforma
- multiples instancies del bot
- edicio de configuracio des de la safata
- visor complet de logs
- gestio d'actualitzacions

## Current Project Context

El punt d'entrada principal actual es `src/main-program.ts`.

El comportament actual de startup es:

- resol l'estat inicial de la configuracio
- si el sistema es nou i hi ha TTY, executa el bootstrap interactiu
- si el sistema ja esta configurat, arrenca el servei directament

Aixo implica dues decisions importants per a la safata:

1. La safata no ha d'intentar substituir el bootstrap interactiu.
2. La safata nomes s'ha de considerar suportada quan el bot ja esta inicialitzat i preparat per executar-se com a servei no interactiu.

## Recommended Architecture

La solucio es divideix en quatre peces petites.

### 1. System Service

Fitxer nou de desplegament:

- `deploy/systemd/gameclubtelegrambot.service`

Responsabilitat:

- executar el bot com a servei de sistema
- arrencar-lo al boot si l'operador ho activa
- reiniciar-lo automticament en errors recuperables
- exposar un estat observable via `systemctl`

Propietats esperades de la unitat:

- `Type=simple`
- `WorkingDirectory=` apuntant al repo o directori desplegat
- `ExecStart=` executant el binari o comanda Node del bot
- `Restart=on-failure`
- `RestartSec=5`
- `Environment=` o `EnvironmentFile=` per definir `GAMECLUB_CONFIG_PATH` si cal

La unitat no ha de contenir logica d'instal.lacio ni bootstrap. Nomes ha d'executar un bot ja preparat.

### 2. Control CLI Layer

Fitxers nous previstos:

- `src/operations/service-control.ts`
- `src/operations/service-control.test.ts`
- opcionalment `src/scripts/service-control.ts`

Responsabilitat:

- encapsular totes les interaccions amb `systemctl` i `journalctl`
- oferir una API petita i estable per a la safata

API prevista:

- `getServiceStatus()`
- `startService()`
- `stopService()`
- `restartService()`
- `readRecentLogs({ lines })`

Model de sortida previst:

- `inactive`
- `activating`
- `active`
- `deactivating`
- `failed`
- `unknown`

Aquesta capa ha de ser l'unic lloc que coneix:

- el nom exacte del servei
- les comandes shell
- el parseig de la sortida de `systemctl`

La safata ha de dependre d'aquesta capa, no del shell directament.

### 3. Tray Application

Fitxers nous previstos:

- `src/tray/tray-app.ts`
- `src/tray/tray-app.test.ts`
- `src/tray/debian-tray-runtime.ts`

Responsabilitat:

- mostrar una icona persistent a la safata
- reflectir visualment l'estat del servei
- exposar les accions de control en un menu contextual
- mostrar errors operatius de forma simple

Comportament de la UI:

- estat `active`: icona verda o equivalent i text `Bot actiu`
- estat `inactive`: icona grisa i text `Bot aturat`
- estat `failed`: icona vermella i text `Bot en error`
- estat transitori: icona de carrega o text `Arrencant` / `Aturant`

Menu minim:

- `Status: ...`
- `Start`
- `Stop`
- `Restart`
- `View last logs`
- `Refresh`
- `Quit tray`

Regles de comportament:

- `Start` deshabilitat si el servei ja es actiu
- `Stop` deshabilitat si el servei ja es aturat
- `Restart` deshabilitat si el servei no es controlable en aquell estat
- despres de cada accio, refresc immediat d'estat
- polling periodic cada 5-10 segons mentre la safata estigui oberta

Logs a la v1:

- accio `View last logs` que obre un dialeg simple o finestra petita amb les ultimes N linies
- si la UI grafica dels logs complica massa la v1, es acceptable obrir una finestra textual simple gestionada per la mateixa app

### 4. Authorization via Polkit

Fitxers nous previstos:

- `deploy/polkit/rules.d/...gameclubtelegrambot.rules`
- documentacio d'instal.lacio associada

Responsabilitat:

- permetre a usuaris o grups concrets controlar nomes `gameclubtelegrambot.service`

Restriccio necessaria:

- la regla no ha de donar permis generic per gestionar qualsevol servei
- ha de quedar limitada al nom del servei del bot i, si es possible, al grup operatiu definit

Model recomanat:

- crear un grup tipus `gameclubbot-operators`
- la regla `polkit` permet `start`, `stop` i `restart` del servei nomes a membres d'aquest grup

## Data Flow

Flux de lectura d'estat:

1. La safata crida `getServiceStatus()`.
2. La capa de control executa `systemctl show` o `systemctl is-active` per al servei.
3. La capa normalitza el resultat a l'estat intern.
4. La safata actualitza icona, tooltip i items del menu.

Flux d'accio:

1. L'usuari prem `Restart`.
2. La safata crida `restartService()`.
3. La capa de control executa `systemctl restart gameclubtelegrambot.service`.
4. `polkit` valida permisos.
5. La safata marca l'estat com a transitori.
6. En acabar, es refresca l'estat real.

Flux de logs:

1. L'usuari prem `View last logs`.
2. La safata crida `readRecentLogs({ lines: 50 })`.
3. La capa de control executa `journalctl -u gameclubtelegrambot.service -n 50 --no-pager`.
4. La UI mostra el resultat o un error amigable.

## Failure Handling

Casos a cobrir:

- servei no instal.lat
- servei instal.lat pero no inicialitzat correctament
- usuari sense permisos `polkit`
- `systemctl` no disponible
- entorn grafic sense compatibilitat de safata

Resposta esperada:

- la capa de control retorna errors tipats o codis de fallada previsibles
- la safata mostra missatges curts i accionables

Exemples:

- `No s'ha trobat el servei gameclubtelegrambot.service.`
- `Aquest usuari no te permisos per reiniciar el bot.`
- `No s'ha pogut llegir l'estat del servei.`

La safata no ha de matar processos manualment ni intentar reparar el servei per fora de `systemd`.

## Packaging and Deployment

La v1 necessita com a minim:

- unitat `systemd`
- regla `polkit`
- fitxer `.desktop` per iniciar la safata a la sessio grafica de l'usuari
- documentacio Debian d'instal.lacio

Fitxers nous previstos:

- `deploy/systemd/gameclubtelegrambot.service`
- `deploy/polkit/...`
- `deploy/autostart/gameclubtelegrambot-tray.desktop`
- `docs/debian-tray-operations.md`

El document d'operacio ha d'explicar:

- com instal.lar el servei
- com habilitar-lo
- com crear el grup operador
- com instal.lar la regla `polkit`
- com arrencar la safata automaticament en login

## Testing Strategy

### Unit Tests

Cobrir la capa `service-control` amb tests per:

- mapatge d'estats de `systemctl`
- parseig d'errors i fallades
- lectura de logs
- generacio correcta de comandes

Cobrir la logica de la safata amb tests per:

- estat inicial
- habilitacio i deshabilitacio d'accions del menu
- refresc d'estat despres d'una accio
- renderitzat de missatges d'error

### Integration Checks

Fer comprovacions manuals a Debian per:

- servei actiu i visible com a tal a la safata
- servei aturat i arrencable des de la safata
- reinici funcional des de la safata
- error de permisos visible si l'usuari no esta autoritzat
- lectura de logs del servei real

## Implementation Notes

Per minimitzar risc, la implementacio s'ha de fer en aquest ordre:

1. capa `service-control`
2. tests d'estat i comandes
3. fitxer de servei `systemd`
4. regla `polkit`
5. safata minima amb lectura d'estat
6. accions `Start`, `Stop`, `Restart`
7. logs basics i autostart de sessio

## Explicit Decisions

- El proces real del bot el governa `systemd`, no la safata.
- La safata es nomes una UI d'operacio.
- La v1 es Debian-only.
- Els permisos es resolen amb `polkit`, no amb `sudo` ni `systemd --user`.
- La safata no gestiona bootstrap inicial del sistema.
- La seleccio d'estat ha de venir de `systemctl`, no de comprovacions de PID manual.

## Out of Scope Follow-ups

Possible feina futura, fora de la v1:

- actualitzacio de configuracio des de la safata
- obrir dashboard web de salut si n'hi ha
- multiples entorns o instancies
- suport Ubuntu GNOME, KDE i altres shells amb compatibilitat verificada
- alertes visuals o notificacions d'error del servei
