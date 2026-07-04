# Planes y specs de implementación

- **`plans/`** — planes ejecutables. Nombre: `YYYY-MM-DD-<kebab-slug>.md`. Estado en metadata `Status` (Draft / Approved / In Progress / Done), nunca en el nombre del archivo.
- **`specs/`** — documentos de diseño/contexto que alimentan un plan.

Estructura de un plan: `# Plan: <título>`; metadata `Status` / `Date` / `Owner`; secciones **Context**, **Scope / Out of scope**, **Backend**, **Frontend**, **Verification**, **Decisions / Open questions**; tareas con checkboxes `- [ ]`.

Flujo: el agente redacta el plan aquí → el usuario lo edita → el usuario pasa la ruta del plan al agente → el agente lo ejecuta marcando los checkboxes.

Los planes y specs de features **ya implementadas se eliminan** una vez completados (la historia queda en git). El conocimiento durable vive en `docs/features/`, `docs/adr/` y `docs/patterns/`.
