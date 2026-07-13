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
