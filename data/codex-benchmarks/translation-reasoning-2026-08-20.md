# Benchmark de traducción del catálogo

Fecha: 2026-08-20

Datos completos: `translation-reasoning-2026-08-20T10-07-32-314Z.json`.

## Metodología

- Mismo prompt que la traducción productiva del catálogo.
- Un texto de tres párrafos con terminología de juego, roles ocultos y nombres y fechas históricas.
- Dos ejecuciones consecutivas por configuración.
- La calidad automática puntúa terminología, párrafos, ausencia de fugas evidentes de inglés y cumplimiento del formato de salida.
- La revisión humana comprueba además fidelidad: omisiones, adiciones y terminología sin traducir.
- Las muestras son pequeñas; las latencias sirven como comparación orientativa, no como SLA.

## Resultados

| Configuración | Media | Diferencia frente a 5.4/low | Calidad automática | Revisión humana |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.4/low` | 8,23 s | referencia | 97/100 | Una ejecución fiel; otra dejó tres roles en inglés. |
| `gpt-5.6-luna/low` | 9,14 s | +11 % | 97/100 | Una dejó tres roles en inglés; otra omitió una frase completa. |
| `gpt-5.6-luna/medium` | 8,89 s | +8 % | 97/100 | Una ejecución fiel; otra omitió una frase completa. |
| `gpt-5.6-luna/high` | 9,59 s | +16 % | 100/100 | Las dos añadieron consejos de juego inexistentes en el original. |
| `gpt-5.6-luna/xhigh` | 10,73 s | +30 % | 100/100 | Las dos omitieron una frase completa. |
| `gpt-5.6-luna/max` | 14,05 s | +71 % | 100/100 | Las dos fueron completas, naturales y fieles. |

## Lectura

- Ningún modo de Luna fue más rápido que el `gpt-5.4/low` actual en esta prueba.
- `Luna/max` ofreció la mejor consistencia de traducción, pero tardó aproximadamente un 71 % más.
- `Luna/high` no es recomendable para esta tarea: su puntuación automática ocultó adiciones no presentes en el original.
- `Luna/medium` quedó cerca de la latencia actual, pero no mejoró la fiabilidad de forma consistente.
- Con estos datos, no conviene cambiar el modelo productivo sólo por velocidad. Si se prioriza fidelidad sobre espera, `Luna/max` es el candidato; si se prioriza latencia, conviene mantener `gpt-5.4/low` y reforzar el prompt contra omisiones y adiciones antes de repetir el benchmark.

## Segunda tanda: prompt reforzado

Se cambió el prompt para enviar el original como un campo JSON considerado únicamente datos y exigir traducción frase a frase, sin omisiones, resúmenes ni añadidos. La versión compacta obtuvo:

| Configuración | Media | Revisión humana |
| --- | ---: | --- |
| `gpt-5.4/low` | 8,36 s | Dos traducciones completas y fieles. |
| `gpt-5.6-luna/medium` | 8,84 s | Dos traducciones completas y fieles. |
| `gpt-5.6-luna/high` | 10,22 s | Dos traducciones completas y fieles, sin los consejos inventados de la primera tanda. |
| `gpt-5.6-luna/xhigh` | 17,12 s | Dos traducciones completas y fieles, pero con una penalización de latencia clara. |

El prompt reforzado eliminó en estas muestras los fallos observados con todos los modos repetidos. La mejor decisión inmediata es desplegar el prompt nuevo manteniendo `gpt-5.4/low`: mejora la fidelidad sin un cambio material de latencia. `Luna/medium` queda como candidato para una prueba más amplia, ya que en esta tanda sólo añadió unos 0,5 segundos frente a `5.4/low`.
