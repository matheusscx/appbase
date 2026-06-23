# Patterns Playbook

**Léelo primero al planificar una feature nueva.** Estos documentos capturan los
patrones de-facto del proyecto (esqueleto de módulo, guards, entities, SQL raw,
seeding, páginas con update optimista, etc.) extraídos del código real más
reciente, para **evitar re-escanear el repo en cada plan**.

| Documento | Cubre |
|---|---|
| [backend.md](./backend.md) | Módulo NestJS: esqueleto, entity (PK simple/compuesta), DTO, controller + guards, service (SQL raw, transacción, upsert soft-delete), tests, seeding |
| [frontend.md](./frontend.md) | Pantalla Nuxt: `useApiFetch`, estado local, update optimista con revert, estrella "solo uno", modales CRUD, componentes `@nuxt/ui` |

## Mantenimiento

Son documentos vivos: cuando un patrón cambie o aparezca uno nuevo y reutilizable,
actualizar el archivo correspondiente en el mismo commit (igual que las demás docs
vivas). Las features de referencia actuales: `modules/monedas/`, `modules/tenants/`
y `app/pages/configuracion/razones-sociales.vue`.

Estos playbooks son el **"cómo se construye"**; complementan:
- `docs/ARCHITECTURE.md` — el "qué hay" (stack, estructura, flujos).
- `docs/CONVENTIONS.md` — convenciones de documentación.
- `docs/adr/` — el "por qué" de decisiones puntuales.
