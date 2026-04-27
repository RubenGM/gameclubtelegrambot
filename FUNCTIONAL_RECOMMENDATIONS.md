# Recomanacions funcionals del bot

Aquest document recull millores funcionals detectades durant la revisio del bot. Serveix com a backlog de producte per controlar estat, prioritat i implementacio.

## Llegenda d'estat

- `pendent`: encara no implementat.
- `en curs`: implementacio iniciada pero no tancada.
- `fet`: implementat, provat i desplegat.
- `descartat`: no es fara per decisio de producte.

## Backlog prioritzat

| ID | Recomanacio | Estat | Prioritat | Area | Notes |
| --- | --- | --- | --- | --- | --- |
| F-001 | Normalitzar navegacio global en tots els submenus principals | fet | alta | UX navegacio | Submenus principals revisats amb `Inici/Inicio/Start` i `Ajuda/Help`: Activitats, Taules admin, Cataleg admin, Compres conjuntes, Esdeveniments local i Emmagatzematge. |
| F-002 | Afegir sortida clara als fluxos interns | fet | alta | UX navegacio | Els fluxos actius d'emmagatzematge mostren `/cancel`; activitats, compres conjuntes, taules i cataleg ja tenien sortides visibles en els teclats interns revisats. |
| F-003 | Ajuda contextual per seccio | fet | alta | Ajuda | `Ajuda` explica la seccio activa quan l'usuari ve d'Activitats, Cataleg, Compres conjuntes o Emmagatzematge, i conserva l'ajuda general. |
| F-004 | Exposar `Calendari` o crear `Avui al club` | descartat | alta | Activitats | No es fara: exposar `Calendari` com a boto separat duplica `Activitats`. Es conserva la millora de dates llegibles al llistat d'activitats. |
| F-005 | Pantalla `Avui al club` | pendent | alta | Resum usuari | Resum amb activitats d'avui, taules, esdeveniments del local, compres amb deadline proper i prestecs propis. Bon candidat per al missatge d'`Inici`. |
| F-006 | Integrar disponibilitat de prestecs amb activitats | pendent | alta | Cataleg/Activitats | En crear una partida des d'un item del cataleg, avisar si el material esta prestat. |
| F-007 | Cerca guiada al cataleg | pendent | mitjana | Cataleg | Afegir boto `Cercar/Buscar` dins del cataleg per iniciar un flux de cerca sense recordar `/catalog_search`. |
| F-008 | Recordatoris d'activitats | pendent | mitjana | Notificacions | Enviar recordatori abans d'una activitat, configurable per defecte. |
| F-009 | Recordatoris de compres conjuntes | pendent | mitjana | Compres conjuntes | Avisar abans del deadline d'apuntar-se o confirmar-se. |
| F-010 | Recordatoris de prestecs | pendent | mitjana | Cataleg/Prestecs | Avisar quan s'apropa o passa la data prevista de retorn. |
| F-011 | Configuracio de grups de noticies amb botons | pendent | mitjana | Grups | Substituir o complementar `/news subscribe <categoria>` amb un flux de botons. |
| F-012 | Perfil d'usuari / `El meu espai` | pendent | mitjana | Usuari | Mostrar activitats on participa, prestecs actius, compres conjuntes, idioma i estat d'acces. |
| F-013 | Notificacions personals configurables | pendent | mitjana | Usuari | Permetre activar/desactivar recordatoris d'activitats, compres, prestecs i noticies. |
| F-014 | Dashboard admin al bot | pendent | mitjana | Admin | Resum amb sollicituds pendents, activitats proximes, compres obertes, prestecs actius i storage. |
| F-015 | Gestio de permisos des del bot | pendent | baixa | Admin/Permisos | El motor de permisos existeix, pero falta una UI admin per concedir/revocar permisos globals o per recurs. |
| F-016 | Agrupar menu admin per categories | pendent | baixa | UX admin | Si el menu admin creix, agrupar per Club, Activitat, Material i Comunicacio. |
| F-017 | Helpers compartits per teclats de submenus | pendent | baixa | Mantenibilitat | Evitar inconsistencies entre fluxos que construeixen teclats propis i el menu global. |

## Estat actual rellevant

- El bot ja te control d'acces, aprovacio d'usuaris i administradors.
- El menu principal canvia segons rol, context de xat i sessio activa.
- Hi ha activitats amb participants, taula opcional i avisos de conflicte.
- Hi ha gestio de taules, cataleg, prestecs, esdeveniments del local, compres conjuntes i emmagatzematge.
- Hi ha grups de noticies amb subscripcions per categoria.
- Hi ha suport d'idioma `ca`, `es` i `en`.
- Els textos visibles en catala i castella ja tenen accents.
- El submenu d'`Almacenamiento` ja recupera `Inicio` i `Ayuda`.

## Ordre recomanat d'implementacio

1. Normalitzar navegacio global en tots els submenus principals (`F-001`).
2. Afegir sortides clares als fluxos interns (`F-002`).
3. Exposar `Calendari` o construir `Avui al club` (`F-004`, `F-005`).
4. Afegir ajuda contextual per seccio (`F-003`).
5. Afegir cerca guiada al cataleg (`F-007`).
6. Integrar prestecs amb activitats (`F-006`).
7. Afegir recordatoris (`F-008`, `F-009`, `F-010`).
8. Millorar administracio i permisos (`F-014`, `F-015`, `F-016`).

## Riscos funcionals detectats

- Els botons de reply keyboard depenen de text localitzat. Canvis de text poden afectar el comportament si no hi ha tests especifics.
- Alguns fluxos construeixen teclats propis i altres usen el menu global. Aixo pot generar inconsistencies de navegacio.
- El menu admin pot quedar massa carregat a mesura que s'afegeixin funcionalitats.
- Algunes funcionalitats existeixen tecnicament, pero no son prou visibles al menu principal.

## Criteris de tancament per cada recomanacio

- Tests unitaris o d'integracio actualitzats.
- `npm run typecheck` passant.
- `npm run test` o suite rellevant passant.
- `./startup.sh` executat despres del canvi.
- Estat actualitzat en aquest document.
