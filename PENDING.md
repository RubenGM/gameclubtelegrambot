# Trabajo pendiente

Última revisión: 2026-10-09.

Backlog vivo del proyecto, iniciado tras contrastar código, documentación operativa
y planes históricos. Aquí se mantiene el trabajo por hacer; el inventario del
comportamiento disponible sigue siendo [docs/feature-status.md](docs/feature-status.md).
Una limitación de alcance no implica que una feature esté rota o incompleta.

## Cómo mantenerlo

- Conservar los identificadores `P-XXX`, aunque cambie el orden de las tareas.
- Estados: `pendiente`, `en curso`, `bloqueado`, `hecho` y `descartado`.
- Prioridades propuestas: `alta`, `media` y `baja`; no implican compromiso de ejecución.
- Al empezar, actualizar el estado y anotar el alcance concreto. Si se bloquea,
  indicar qué falta para continuar.
- Al terminar, registrar fecha, cambio y validación en el historial de cierre.
  Actualizar también el inventario y la guía especializada si cambia la feature.
- Las mejoras propuestas requieren decidir su alcance antes de implementarlas.
- Añadir nuevos pendientes aquí y enlazar la evidencia; no copiar sin contrastar
  las casillas abiertas de planes antiguos.

## Implementación y operación por cerrar

| ID | Prioridad | Estado | Pendiente y criterio de cierre |
| --- | --- | --- | --- |
| P-040 | Alta | hecho | **Modernización Telegram #32.** grammY actual, Node 24, concurrencia supervisada, fichas rich, streaming real Codex y Stop entregados. Calendario público refrescado y aprobado; Stop nativo confirmado por el usuario. Concurrencia validada técnicamente con dos sesiones, Codex real y Telegram API; sin prueba presencial con segunda cuenta. |
| P-001 | Alta | hecho | **Backup completo del estado en disco.** Incluir `data/feedback.jsonl` y `data/http-assets/` en backup y restore; comprobar recuperación de feedback y assets. Revisar además los archivos persistentes de las integraciones actuales para no limitar el análisis a esas dos rutas. |
| P-002 | Alta | pendiente | **Escrituras LLM declaradas sin ejecución.** Conectar `schedule.create`, `group_purchase.create` y `storage.entry.edit` a los flujos normales con prellenado y permisos, o dejar de ofrecerlas como ejecutables hasta entonces. Actualmente la confirmación termina en `unsupportedPrefill`. |
| P-003 | Alta | pendiente | **Validación real de generación de imágenes.** Registrar una petición que ejecute el wrapper Codex, cree `generated.png` y entregue la foto en Telegram. Los dobles de test no cierran esta validación. |
| P-004 | Media | pendiente | **Fuentes perdidas en Storage.** Añadir revisión Telegram de entradas `missing_source` y definir cómo reparar/reemplazar su fuente. Web/TUI permiten editar el estado, pero eso por sí solo no recupera el archivo. |
| P-005 | Media | pendiente | **Gestión general de permisos.** UI admin para consultar, conceder y revocar permisos globales o por recurso con auditoría. Reutilizar el motor existente y conservar las pantallas específicas. |
| P-006 | Media | pendiente | **Lecturas LLM extensas y ambiguas.** Mejorar el detalle largo en privado y la selección guiada cuando hay múltiples resultados, manteniendo enlaces y límites Telegram. |
| P-007 | Media | pendiente | **Paginación LFG.** Paginar anuncios activos de jugadores y grupos sin cargar/renderizar todo el listado. Aplicar la guía de paginación del repositorio. |
| P-008 | Media | pendiente | **Temporales abandonados de imágenes IA.** Definir limpieza de workspaces huérfanos por abandono o reinicio, conservando los necesarios para reintentar una sesión vigente. El fallo de generación mantiene deliberadamente la sesión. |
| P-009 | Media | hecho | **Rate limit admin detrás de Nginx (#10).** Proxy fiable explícito y clave por IP normalizada del cliente mediante `X-Real-IP`; aislamiento y cabeceras manipuladas probados en HTTP y en Nginx real. |
| P-010 | Media | pendiente | **Validación física de impresión.** Comprobar papel/tóner, ajuste A4, orientación y dúplex cuando la cola lo admita, registrando el resultado presencial. |
| P-011 | Baja | pendiente | **Contrato de `featureFlags`.** Decidir qué controla este mapa, conectar los flags necesarios o retirar la configuración que no tenga efecto. Existen interruptores específicos que sí funcionan. |
| P-012 | Baja | pendiente | **Cobertura de `/status`.** Cubrir de forma focalizada envío del inventario, documento ausente y runtime sin `sendDocument`, preferentemente ampliando pruebas existentes. |
| P-013 | Baja | pendiente | **Nombre y responsabilidades del importador de catálogo.** Revisar `wikipedia-boardgame-import-service.ts`, que también mezcla Open Library y BGG collection; separar sólo si reduce complejidad de mantenimiento. |

Fuentes: [inventario](docs/feature-status.md),
[flujo de escrituras LLM](src/telegram/llm-command-flow.ts),
[generación de imágenes](docs/image-generation.md),
[backup y recuperación](docs/backup-restore-recovery.md).

## Analítica UX por completar

El registro de menús y acciones y los informes CLI/TUI ya existen. Estas tareas
amplían esa base según [el plan de analítica](improvements/analytics_improvements.md).

| ID | Prioridad | Estado | Pendiente |
| --- | --- | --- | --- |
| P-014 | Media | pendiente | Vista de menús mostrados sin interacción y ranking de tasas de interacción por menú. |
| P-015 | Media | pendiente | Desglose por idioma y filtros por rol, menú y acción. |
| P-016 | Media | pendiente | Medición de inicio, pasos, cancelación, finalización y abandono de flujos largos. |
| P-017 | Baja | pendiente | Exportación JSON/CSV de los informes. |
| P-018 | Baja | pendiente | Cronología de eventos recientes para diagnóstico. |
| P-019 | Baja | pendiente | Etiquetas canónicas de reporting, conservando el texto localizado como contexto. |
| P-020 | Baja | pendiente | Mejoras TUI: selección de ventana temporal, filtros interactivos, detalle de acciones y refresco opcional. |

## Mejoras propuestas, con alcance por decidir

Estas carencias están documentadas, pero no bloquean el alcance actual. Su inclusión
no convierte una propuesta histórica en una feature comprometida.

| ID | Prioridad | Estado | Propuesta |
| --- | --- | --- | --- |
| P-021 | Media | pendiente | **Mi espacio.** Reunir actividades propias, préstamos, compras, idioma y estado de acceso. |
| P-022 | Media | pendiente | **Preferencias personales de notificaciones.** Activar/desactivar recordatorios por tipo sin alterar los controles operativos generales. |
| P-023 | Media | pendiente | **Seguimiento del feedback.** Estados de revisión, asignación y posible respuesta al remitente; decidir si JSONL sigue siendo suficiente y cómo responder al feedback anónimo. |
| P-024 | Baja | pendiente | **Dashboard admin en Telegram.** Resumen operativo conjunto. Ya existen dashboard web y vistas Telegram específicas; concretar qué información adicional aporta. |
| P-025 | Baja | pendiente | **Historial de imágenes IA y guardado en Storage.** Definir conservación, acceso y borrado antes de añadir persistencia. |
| P-026 | Baja | pendiente | **Impresión desde enlaces externos.** Decidir fuentes permitidas, descarga y validación. |
| P-027 | Baja | pendiente | **Opciones avanzadas de impresión de imágenes.** Márgenes, tamaño real, recorte, álbumes y varias imágenes por página. |
| P-028 | Baja | pendiente | **Cancelar trabajos CUPS desde el bot.** Definir permisos, confirmación y comportamiento cuando ya están imprimiéndose. |
| P-029 | Baja | pendiente | **Storage: indexado interno, OCR y antivirus.** Evaluar necesidades, formatos, coste y límites antes de ampliar la v1. |
| P-030 | Baja | pendiente | **Storage: operaciones físicas.** Evaluar borrado real de mensajes y movimiento entre topics; actualmente borrar/mover es lógico. |
| P-031 | Baja | pendiente | **Álbumes Storage interrumpidos.** Evaluar recuperación de la agrupación tras reinicios; actualmente puede hacer falta reenviarlos. |
| P-032 | Baja | pendiente | **Recordatorios por vencimiento de préstamos.** Ya hay avisos semanales desde el alta; decidir si añadir avisos específicos antes/después de la fecha prevista, propuesta distinta del comportamiento actual. |
| P-033 | Baja | pendiente | **Simulación de restore.** Evaluar preflight o ensayo obligatorio antes de restaurar, además del modo `--dry-run` y confirmaciones actuales. |
| P-034 | Baja | pendiente | **Cobros en compras conjuntas.** Decidir si se necesita integración de pagos; los estados de participantes no equivalen a cobrar realmente. |
| P-035 | Baja | pendiente | **Proveedor LLM alternativo.** Evaluar necesidad de fallback; el servicio operativo actual usa Codex. Las acciones admin de catálogo siguen separadas deliberadamente en `/adminai`. |
| P-036 | Baja | pendiente | **Refinamientos de `/news`.** Revisar copy o labels si aparece fricción; la configuración con botones ya está implementada. |

Fuentes: [inventario](docs/feature-status.md) y
[recomendaciones históricas](improvements/FUNCTIONAL_RECOMMENDATIONS.md).

## Pruebas y mantenimiento documental

| ID | Prioridad | Estado | Pendiente y criterio de cierre |
| --- | --- | --- | --- |
| P-037 | Media | pendiente | **Revisar y simplificar la suite de pruebas.** Detectar comprobaciones duplicadas entre capas, pruebas que reproducen la implementación y fixtures repetidos. Consolidar casos equivalentes conservando permisos, transiciones, persistencia, confirmaciones y regresiones conocidas. Registrar qué cobertura mantiene cada eliminación; no fijar un número objetivo arbitrario. |
| P-038 | Media | hecho | **Validación cotidiana por área.** `npm test` selecciona categorías y consumidores transitivos según Git; `--dry-run`, `--since`, `--category` y filtros por tipo permiten revisar el alcance. CI utiliza la misma selección. Se conservan checks obligatorios y suite completa explícita o por impacto transversal. |
| P-039 | Baja | pendiente | **Reconciliar documentación histórica.** Corregir referencias pendientes ya resueltas, fechas de revisión y enlaces obsoletos. En particular, `/news` con botones y el submenú Admin ya existen; los préstamos tienen recordatorios semanales. El plan de media del catálogo no describe el estado actual. El inventario referencia `improvements/storage_tui_management_plan.md`, que no existe actualmente. |

Referencia inicial de pruebas (2026-09-30): 1.232 casos unitarios ejecutados,
todos pasando, en unos 89 segundos. Hay 174 archivos `*.test.ts`, incluidos
los de integración. El conteo estático aproximado sitúa 727 declaraciones en
`src/telegram`; no equivale exactamente al conteo del runner. Los archivos con
más declaraciones son Rol (97), Storage (88), Agenda (74) y catálogo admin (69).
La suite de integración con PostgreSQL no se ejecutó en esta revisión.

## Condiciones actuales que no son tareas de implementación

- Telegram usa long polling; no hay un requisito actual de migrar a webhooks.
- Agenda, mesas y equipamiento avisan de solapes y permiten continuar. No se ha
  decidido convertirlos en reservas exclusivas.
- Equipamiento se da de alta según el material real del club; no requiere datos
  iniciales ficticios. La gestión de eventos del local es privada y admin.
- Recordatorios requieren sus workers y configuración operativos.
- Imágenes externas de catálogo y borrado de publicaciones de Avisos son
  best-effort; dependen de Telegram, configuración y permisos del destino.
- Archivos grandes de impresión requieren Bot API local. Storage conserva un
  fallback de selección manual de destino cuando falta el grupo por defecto.
- La generación externa depende de credenciales, disponibilidad y cuota de Codex.
- Los textos de botones Telegram participan en el routing: sus cambios necesitan
  validación de colisiones y navegación; esto explica parte de la cobertura UX.

## Historial de cierre

| ID | Fecha | Resultado y validación |
| --- | --- | --- |
| P-040 | 2026-10-09 | #32 y dependencias #9/#14/#24/#25 completados. Se conserva la evidencia ampliada anterior (1.319 unitarios y 8 PostgreSQL); esta revisión pasó 1.114 tests por impacto, typecheck, lint, docs, build, inventario y startup. El usuario confirmó Stop nativo; la prueba como `gameclubbot` mediante wrapper y supervisor `cawa` produjo 24 deltas reales, permitió a B completar una consulta Telegram antes de terminar A, canceló mediante la ruta nativa y ejecutó la siguiente acción de A después del cierre (259 ms desde Stop). No se enviaron mensajes a usuarios de prueba ni se usó una segunda cuenta real. Se añadieron eventos de ciclo de vida sin contenido sensible e idempotencia de Stop repetido. Runtime efectivo Node 24.21.0, grammY 1.46.0, runner 2.0.3, HTTPS público 200 y admin 303. |
| P-009 | 2026-10-09 | #10: `httpServer.trustedProxyAddresses` opcional, sin confianza implícita; `X-Real-IP` válido sólo desde proxies declarados, sin usar `X-Forwarded-For`, con normalización IPv6/IPv4 mapeada. Despliegue configurado para Nginx en `127.0.0.1`. Pasaron 1.075 tests seleccionados por impacto, pruebas HTTP obligatorias, typecheck, lint, docs y feature-status-audit; `./startup.sh` completado. En Nginx real, cinco fallos de un cliente generan 429 aunque cambie cabeceras; otro cliente sigue recibiendo 401 por contraseña incorrecta, sin bloqueo. Portada pública y protección admin verificadas. |
| P-001 | 2026-09-30 | ZIP v2 en `backup-full.sh`/`restore-full.sh` con feedback configurado, assets web y credenciales Google Calendar; inventario de payloads, restore compatible con v1 y permisos del servicio. El despliegue conserva `data/`. Revisión de persistencia de integraciones documentada en el runbook. Recuperación probada en directorio temporal con comparación de contenido, rutas personalizadas, exclusión de cachés, fuentes ausentes, payload incompleto y symlinks; flujo shell ZIP/dry-run probado. Validación: 265 tests seleccionados, typecheck, lint y docs. |
| P-038 | 2026-09-30 | Selector en `src/scripts/testing/`, comandos npm, CI y guía de agentes actualizados. 22 categorías; grafo probado con cambios entre dominios, ciclos, imports dinámicos, eliminaciones, recursos sin imports y fallback transversal. Suite unitaria de 1.236 casos, typecheck, lint, docs y diff pasando. Previsualización verificada: sólo docs selecciona 0 archivos; cambio en impresión selecciona 52/175 incluyendo consumidores; categoría explícita de impresión selecciona 7. |

Al cerrar una tarea, registrar ID, fecha, resultado, referencia al cambio y
validación realizada. Mantener la fila con estado `hecho` o `descartado`.
