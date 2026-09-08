# Convenciones de documentación

Convenciones para mantener `docs/` consistente. Las convenciones de **código** viven en `CLAUDE.md` (raíz) y `docs/patterns/`.

## Tipos de documento

| Tipo | Ubicación | Responde a | Cuándo crear |
|---|---|---|---|
| **ADR** | `docs/adr/NNN-titulo.md` | ¿Por qué elegimos esta tecnología/enfoque? | Decisiones de arquitectura, esquema de BD, auth, trade-offs. No para bugs ni refactors. |
| **Feature doc** | `docs/features/<nombre>.md` | ¿Cómo funciona esta feature end-to-end? | Toda feature con endpoint(s) + UI. Partir de `features/TEMPLATE.md`. |
| **Pattern** | `docs/patterns/` | ¿Cómo se construye X en este repo? | Patrón backend/frontend nuevo o cambiado. |
| **Plan / Spec** | `docs/superpowers/` | Pasos ejecutables / diseño previo | Ver `docs/superpowers/README.md`. Se eliminan al completarse. |

## Cómo documentar una feature nueva

1. `cp docs/features/TEMPLATE.md docs/features/mi-feature.md` y completar: overview, endpoints, backend (módulo, entities, DTOs), frontend (páginas, componentes, stores), data flow, testing, pendientes.
2. Si hubo una decisión técnica significativa → crear ADR (siguiente número libre) y agregarlo al índice `docs/adr/README.md`.
3. Agregar el link en `docs/README.md` y actualizar la tabla de estado en `docs/ESTADO.md`.

## Formato

- **Metadata al inicio** de features y ADRs: `**Status**`, `**Last Updated**` (YYYY-MM-DD). Actualizar la fecha en cada cambio relevante.
- **ADRs** siguen el template de Michael Nygard: Context / Decision / Consequences (ver template en `docs/adr/README.md`).
- **Links internos** con rutas relativas (`../adr/001-jwt-auth.md`); verificar que existan antes de commitear.
- **Tablas** para parámetros de API, variables de entorno y comparaciones; prosa para explicaciones.
- **Snippets** con la ruta del archivo como primer comentario. Diagramas simples en ASCII; complejos en Mermaid.
- Documentar el **por qué** y el **cómo de alto nivel** — no detalles de implementación (nombres de variables, firmas) que van en el código.

## Mantenimiento

- La doc se actualiza **en el mismo commit** que el código que la afecta (ver tabla "Documentación viva" en `CLAUDE.md`).
- Doc incorrecta u obsoleta: corregirla de inmediato y actualizar su `Last Updated`.
- Preferir actualizar un doc existente antes que crear uno nuevo.

## Citar un documento desde el código

Un comentario que cita **una sección, una decisión numerada o una tarea** de otro documento
tiene que **nombrar ese documento**. `spec § 4.2`, `diseño §Modelo de datos` o `Tarea 11` no
resuelven a nada: el repo tiene decenas de specs y **seis** de ellas tienen una sección `4.2`,
así que el número solo es ambiguo incluso mientras el documento existe.

- **Nombrar el documento con su ruta** — `` `docs/superpowers/specs/2026-09-01-…-design.md` § 4.2 ``.
  Si la ruta no entra en la línea, el nombre del archivo solo (`` `2026-09-01-…-design.md` ``)
  alcanza **cuando ese basename no se repite** — ⚠️ los de `docs/superpowers/plans/` y
  `docs/agent/investigaciones/` colisionan al menos dos veces (mismo frente, dos documentos),
  así que ahí va la ruta sí o sí. **No partir una cita en dos renglones** —ni la ruta, ni el
  `Tarea`/`Task`/`§` separado de su número—: la vuelve ingrepeable, y el barrido que venga
  después la deja viva creyendo que no está.
- **Alcanza con nombrarlo una vez por bloque de comentario.** Dentro del mismo bloque, o del
  docblock de cabecera del archivo, después se puede decir "esa spec".
- **Una tarea de un plan no se cita desde otro archivo** —ni `Tarea N` ni `Task N`: el repo
  escribe las dos, y un barrido en un solo idioma deja viva la mitad—. Planes y specs de features ya
  implementadas **se borran** (`docs/superpowers/README.md`), así que las dos clases de cita
  pueden quedar huérfanas — pero no cuestan lo mismo: una sección tiene un heading equivalente
  en la doc de la feature al que repuntarla, y una tarea no tiene nada. Nombrar el **frente**
  (*"el frente de bodegas y traslados"*, que resuelve a
  `docs/features/bodegas-y-traslados.md`) o directamente lo que cambió.
  **La excepción es el spec que se rotula a sí mismo**: `reserva-stock-mesa.e2e-spec.ts` titula
  sus `describe` con las tareas de su plan y lo nombra en su cabecera, así que sus `Tarea N`
  se refieren a bloques de ese mismo archivo. El día que el plan se borre siguen siendo
  nombres internos, no punteros rotos.
- **La unidad de trabajo no se cita a sí misma.** *"Antes de esta tarea"*, *"el hallazgo 3"*,
  *"la ronda 2"*, *"lo que pedía el brief"*: nada de eso resuelve para quien lee el código
  después, porque el informe de revisión y el brief nunca vivieron en el repo. Va **qué**
  cambió (*"antes de que el cierre pasara a hacerse en transacción"*), que no caduca, y no
  **cuándo** contra una unidad de trabajo que se borra. ⚠️ Quedan citas así —`hallazgo N`,
  `ronda N`—, medidas en [`agent/pendientes.md`](agent/pendientes.md) § 1: la regla vale para
  lo que se escriba de ahora en adelante.
- Si el documento se borra, sus citas se repuntan a la doc viva en **el mismo commit** que lo
  borra. Barrerlas después es más caro: hay que clasificar cada una por su contenido, porque
  el número solo no dice de qué documento era.
