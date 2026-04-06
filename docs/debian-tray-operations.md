# Debian Tray Operations

Aquest document descriu com instal·lar, arrencar i validar la safata Debian per operar `gameclubtelegrambot`.

## Què és exactament

La safata Debian d'aquest projecte no és un dashboard web separat.

És una aplicació de safata del sistema amb aquests components:

- entrypoint Node: `src/scripts/debian-tray.ts`
- artefacte compilat: `dist/scripts/debian-tray.js`
- runtime de safata: `src/tray/debian-tray-runtime.ts`
- lògica de menú i accions: `src/tray/tray-app.ts`
- host gràfic Python/AppIndicator: `scripts/debian-tray-host.py`
- autostart de sessió: `deploy/autostart/gameclubtelegrambot-tray.desktop`

El procés Node consulta l'estat del servei `systemd`, construeix el menú i llança el host Python, que és qui publica la icona `AyatanaAppIndicator` a la safata de Debian/GNOME.

## Prerequisits

Abans de configurar la safata cal tenir completat el desplegament del servei del sistema.

Consulta primer:

- `docs/debian-service-operations.md`

La safata assumeix:

- servei `gameclubtelegrambot.service` instal·lat
- regla `polkit` instal·lada
- usuari operador membre de `gameclubbot-operators`
- aplicació construïda a `/opt/gameclubtelegrambot/dist`
- sessió gràfica Debian amb system tray compatible
- `python3-gi` i `gir1.2-ayatanaappindicator3-0.1` disponibles

També és recomanable verificar explícitament que existeix l'entrypoint compilat:

```bash
ls -l /opt/gameclubtelegrambot/dist/scripts/debian-tray.js
```

## Preparació ràpida a GNOME Debian

Per habilitar ràpidament el suport de safata en un altre PC Debian amb GNOME, es pot fer servir:

```bash
./scripts/enable-debian-tray.sh --install-autostart --app-root /opt/gameclubtelegrambot
```

Aquest script:

- instal·la `gnome-shell-extension-appindicator` si falta
- instal·la `gir1.2-ayatanaappindicator3-0.1` per al host Python de la safata
- intenta habilitar l'extensió AppIndicator a GNOME
- opcionalment instal·la l'autostart de la safata per a l'usuari actual

També té mode simulació:

```bash
./scripts/enable-debian-tray.sh --dry-run --install-autostart --app-root /opt/gameclubtelegrambot
```

Si després d'executar-lo la icona encara no apareix, normalment cal tancar sessió i tornar a entrar a GNOME.

## Execució manual

Normalment no cal obrir la safata manualment si s'està utilitzant l'entrypoint central:

```bash
./startup.sh --config-source ./config/runtime.json --operator-user "$USER"
```

Aquest flux intenta obrir la safata abans d'arrencar o reiniciar el bot.
Abans d'obrir-la, `startup.sh` tanca qualsevol instància anterior del tray que ja estigui executant-se per al mateix `APP_ROOT`, per evitar icones duplicades a la sessió gràfica.
La mateixa arrencada obre la safata i mostra els menús operatius del bot directament des de la icona; ja no hi ha una finestra local separada de control.

Per provar la safata manualment des d'una sessió gràfica:

```bash
cd /opt/gameclubtelegrambot
node dist/scripts/debian-tray.js
```

Equivalent via `npm` si ja estàs al directori del projecte amb `dist/` generat:

```bash
npm run tray:debian
```

Per defecte, aquest launcher es desacobla del terminal i continua en background.

Si cal depurar-lo en foreground des del terminal actual:

```bash
GAMECLUB_TRAY_FOREGROUND=1 node dist/scripts/debian-tray.js
```

El procés Node llança internament `scripts/debian-tray-host.py`, que publica una icona `AyatanaAppIndicator` al `StatusNotifierWatcher`, com fan aplicacions com Remmina.

També es pot fer servir la variable opcional:

```bash
GAMECLUB_SERVICE_NAME=gameclubtelegrambot.service node dist/scripts/debian-tray.js
```

La variable `GAMECLUB_TRAY_POLL_MS` permet ajustar l'interval de refresc:

```bash
GAMECLUB_TRAY_POLL_MS=3000 node dist/scripts/debian-tray.js
```

## Autostart de sessió

La safata pot arrencar automàticament a cada login gràfic.

Fitxer inclòs al repo:

- `deploy/autostart/gameclubtelegrambot-tray.desktop`

Instal·lació recomanada per usuari:

```bash
install -d ~/.config/autostart
install -m 0644 deploy/autostart/gameclubtelegrambot-tray.desktop ~/.config/autostart/gameclubtelegrambot-tray.desktop
```

Si la ruta d'instal·lació del projecte no és `/opt/gameclubtelegrambot`, cal editar la propietat `Exec=` abans de copiar el fitxer.

L'entrada esperada és:

```ini
Exec=/usr/bin/node /opt/gameclubtelegrambot/dist/scripts/debian-tray.js
```

Si la instal·lació s'ha fet amb `./scripts/install-debian-stack.sh`, aquest ajust ja queda fet automàticament via `./scripts/enable-debian-tray.sh --install-autostart --app-root ...`.

## Flux operatiu esperat

Quan la safata està activa:

- mostra el resum d'estat del servei al tooltip
- ofereix `Start`, `Stop`, `Restart`, `Rebuild and restart`, `View last logs`, `Refresh` i `Quit tray`
- refresca automàticament l'estat a l'interval configurat
- refresca immediatament després d'una acció manual
- el menú no opera el bot directament: opera `systemd`, i el servei del bot continua sent el procés real de producció

El control diari es fa des del menú de la safata. Si algun entorn GNOME/AppIndicator no refresca bé, el menú continua sent la font de veritat operativa i la interfície es reconstrueix en refrescar l'estat.

Semàntica de les accions de reinici:

- `Restart`: només executa el reinici del servei actual via `systemd`
- `Rebuild and restart`: executa `startup.sh --no-tray --skip-apt ...`, recompila/redesplega l'aplicació i després reinicia el servei

La segona acció és més lenta i pot requerir permisos operatius addicionals segons com s'hagi desplegat la màquina.

## Validació manual recomanada

### 1. Estat actiu

Preparació:

```bash
sudo systemctl start gameclubtelegrambot.service
```

Comprovacions:

- la safata mostra estat actiu
- `Start` queda deshabilitat
- `Stop` i `Restart` queden habilitats

### 2. Estat aturat

Preparació:

```bash
sudo systemctl stop gameclubtelegrambot.service
```

Comprovacions:

- la safata mostra estat aturat
- `Start` queda habilitat
- `Stop` queda deshabilitat

### 3. Reinici funcional

Acció:

- des de la safata, prémer `Restart`

Comprovacions:

- la safata entra en estat transitori
- el servei torna a estat actiu
- no cal `sudo` si l'usuari és al grup operador

### 4. Permís denegat

Preparació:

- iniciar sessió amb un usuari fora de `gameclubbot-operators`

Acció:

- intentar `Start` o `Restart` des de la safata

Comprovacions:

- l'acció falla
- la safata mostra un missatge breu i accionable
- l'estat torna a refrescar-se després de l'error

### 5. Servei inexistent o mal instal·lat

Preparació de laboratori:

- canviar temporalment `GAMECLUB_SERVICE_NAME` a un nom de servei fals

Comprovacions:

- la safata mostra estat desconegut o notificació d'error
- l'error indica que el servei no existeix

### 6. Lectura de logs

Acció:

- prémer `View last logs`

Comprovacions:

- s'obre el fitxer temporal de logs amb `xdg-open`
- el contingut inclou les últimes línies de `journalctl`

Comanda equivalent:

```bash
journalctl -u gameclubtelegrambot.service -n 50 --no-pager
```

## Incidències conegudes

- si no hi ha tray compatible a la sessió gràfica, la llibreria subjacent pot no mostrar la icona
- si `notify-send` no està disponible, els errors es mostren només via fallback mínim del sistema
- `View last logs` depèn de `xdg-open` i de l'associació de fitxers de text de l'entorn d'escriptori

## Checklist de diagnòstic ràpid

Si "no apareix el tray", comprova en aquest ordre:

1. que existeix `dist/scripts/debian-tray.js`
2. que la sessió és gràfica Debian/GNOME i admet AppIndicator
3. que estan instal·lats `python3-gi`, `gir1.2-ayatanaappindicator3-0.1` i `gnome-shell-extension-appindicator`
4. que l'extensió AppIndicator està habilitada a la sessió actual
5. que l'autostart `~/.config/autostart/gameclubtelegrambot-tray.desktop` existeix i apunta a la ruta correcta
6. que l'usuari operador pertany a `gameclubbot-operators`
7. que es pot arrencar manualment amb `cd /opt/gameclubtelegrambot && node dist/scripts/debian-tray.js`

Comandes útils:

```bash
id
ls -l ~/.config/autostart/gameclubtelegrambot-tray.desktop
grep '^Exec=' ~/.config/autostart/gameclubtelegrambot-tray.desktop
gnome-extensions list --enabled | grep -Ei 'appindicator|ayatana|kstatusnotifier'
python3 --version
node --version
```

Si l'entrypoint existeix però la icona no surt després d'instal·lar l'extensió, el cas més habitual és que calgui tancar sessió i tornar a entrar a GNOME.

## Relació amb altres peces del sistema

- la safata depèn de `src/operations/service-control.ts`
- l'entrada executable és `src/scripts/debian-tray.ts` i en producció `dist/scripts/debian-tray.js`
- el procés real del bot continua governat per `systemd`
- els permisos d'operació depenen de la regla `polkit` definida a `deploy/polkit/rules.d/50-gameclubtelegrambot.rules`

## Estat de validació

Aquest document defineix la validació manual que s'ha d'executar en un entorn Debian amb sessió gràfica real.

Des d'aquest entorn de desenvolupament s'han validat:

- `npm test`
- `npm run typecheck`
- `npm run build`

La comprovació manual final de safata gràfica, permisos `polkit` i operació real del servei s'ha de completar en una màquina Debian amb desktop abans de considerar el desplegament completament operatiu.
