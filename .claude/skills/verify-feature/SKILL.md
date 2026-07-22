---
name: verify-feature
description: Verifica que una tarea o feature está realmente terminada antes de commitear. Ejecuta lint, tests, test:e2e de API y build del frontend; revisa invariantes, N+1/consultas, alcance y documentación; y cierra con una revisión independiente por sub-agente de contexto fresco. Usar al cerrar cualquier tarea, antes de commitear a main, o cuando el usuario pida "verifica", "revisa si está listo" o "cierra la tarea".
---

# verify-feature

Procedimiento de cierre. **No implementa ni corrige nada por su cuenta**: ejecuta,
revisa y reporta. Si algo falla, informar y esperar instrucciones.

Como el proyecto commitea directo a `main` sin PR, este es el único punto de control
antes de que un cambio quede en la rama principal.

## 1. Verificación ejecutable

Correr en orden y detenerse en el primer fallo:

```bash
cd backend  && npm run lint:check
cd backend  && npm run typecheck
cd backend  && npm test
cd backend  && npm run test:e2e
cd frontend && npm run build
cd frontend && npm run typecheck:ratchet
cd frontend && npm run design:check
```

Registrar el resultado real de cada comando. **No declarar que un paso pasó sin
haberlo ejecutado.** Si el stack no está levantado, usar `docker-compose up -d` antes
de `test:e2e`.

**`typecheck:ratchet`**: `nuxt build` NO tipa-chequea, así que el frontend arrastra una
deuda de errores de tipo (vue-tsc estricto) registrada en `frontend/typecheck-baseline.json`.
El ratchet falla solo si un archivo **empeora** respecto a la baseline — no bloquea por la
deuda preexistente, sí impide meter nuevos. Si quemaste errores en esta tarea (bajó el
total), apretá el ratchet: `npm run typecheck:ratchet -- --update` y commiteá la baseline
en el mismo commit. Tarda ~1-2 min; por eso vive acá y no en el pre-commit.

## 2. Invariantes

Revisar el diff (`git diff`) contra las invariantes de `CLAUDE.md`:

- [ ] `tenant_id` proviene del token, nunca del body/query/params
- [ ] Todo cálculo de dinero o porcentaje usa Decimal.js; porcentajes en decimal
- [ ] Sin `DELETE` físico; **toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`**
      (revisar cada query raw agregada en el diff, una por una — no asumir)
- [ ] Columnas PK/FK UUID con `type: 'uuid'` explícito
- [ ] Sin cambios al sistema de tokens JWT
- [ ] "Exento" tratado como estado explícito, no como ausencia de impuesto
- [ ] Rutas nuevas con guard de permisos en el backend

Cualquier violación: **detener el cierre y reportar**, no corregir sobre la marcha.

## 2b. Consultas y rendimiento

Errores recurrentes que ni el lint ni los tests atrapan — revisar el diff a mano:

- [ ] **Sin N+1.** Ningún `for`/`.map(async …)`/`Promise.all` que ejecute una query
      por iteración sobre un resultado. El dato derivado por fila se resuelve en una
      sola query (`JOIN`/agregación) o batch-fetch con `WHERE id = ANY($1)` + map en
      memoria. Ver `docs/agent/anti-patterns.md` → "N+1".
- [ ] Toda query raw nueva lleva su filtro `eliminado_el IS NULL` en cada tabla del
      `FROM`/`JOIN` (ligado al check de soft delete de arriba).
- [ ] Sin `SELECT *` en tablas anchas ni traer columnas que no se usan.

Si aparece un N+1 o una lectura sin filtro de borrado: **detener el cierre y reportar.**

## 3. Alcance

- [ ] El diff no contiene refactors ajenos a la tarea pedida
- [ ] No se crearon archivos nuevos que cabían en uno existente
- [ ] No se agregaron dependencias sin autorización explícita
- [ ] No se introdujo un patrón nuevo donde ya existía uno en el proyecto

Si el diff toca archivos que la tarea no mencionaba, listarlos y justificar cada uno.

## 4. Anti-patrones

Contrastar el diff con `docs/agent/anti-patterns.md`. Si aparece uno conocido,
señalarlo con la entrada correspondiente.

Si se detecta un patrón defectuoso **no listado** y se corrigió durante la tarea,
proponer al usuario agregarlo al archivo (una entrada, formato fijo, con el commit
de origen).

## 5. Documentación

Según la tabla de documentación viva de `CLAUDE.md`, verificar que en el mismo commit
se actualizó lo que corresponda:

- Feature nueva → `docs/features/<feature>.md` + link en `docs/README.md` + fila en `docs/ESTADO.md`
- Cambio de estado → `docs/ESTADO.md`
- Cambio estructural → `docs/ARCHITECTURE.md`
- Decisión técnica → ADR nuevo + índice
- Regla de negocio → `docs/PRODUCTO.md`
- Patrón nuevo → `docs/patterns/backend.md` o `frontend.md`

Si hay un plan activo en `docs/superpowers/plans/`, marcar los checkboxes completados
y actualizar `Status`.

## 6. Limpieza

- [ ] Sin `TODO` / `FIXME` nuevos
- [ ] Sin código comentado
- [ ] Sin código muerto ni imports sin usar
- [ ] Sin `console.log` de depuración

## 7. Revisión independiente — OBLIGATORIA, no self-review

Los pasos 2–6 son la auto-revisión del autor: débil por diseño: el mismo agente que
escribió el N+1 o se saltó el filtro de borrado es el que juzga si lo hizo, y racionaliza.
Este paso lo cierra un **par de ojos con contexto fresco**.

**Lanzar un sub-agente independiente** (Task/Agent, tipo `general-purpose`) que **solo ve
el diff**, no la conversación que lo produjo. Prompt exacto:

```
Sos un revisor independiente. NO escribas ni corrijas código: solo auditás.
Corré `git diff <base>..HEAD` (o `git diff --staged`) y revisá SOLO lo que cambió
contra estas reglas de startup-app. Para cada hallazgo cita archivo:línea.

INVARIANTES (cualquier violación = BLOQUEA):
- tenant_id sale del token (req.user.tenantId), nunca del body/query/params.
- Dinero/porcentajes con Decimal.js; porcentajes en decimal (0.19).
- Sin DELETE físico; toda SELECT/JOIN nueva filtra `eliminado_el IS NULL` en cada tabla.
- Columnas PK/FK UUID con `type: 'uuid'` explícito.
- Sin cambios al sistema de tokens JWT. "Exento" es estado explícito.
- Rutas nuevas con guard de permisos en el backend.

CONSULTAS/RENDIMIENTO (bloquea):
- N+1: ningún for/.map(async)/Promise.all que ejecute una query por iteración sobre
  un resultado. Debe resolverse en una query (JOIN/agregación) o WHERE id = ANY($1).
- Sin SELECT * en tablas anchas.

ALCANCE: el diff no refactoriza nada ajeno a la tarea; no crea archivos que cabían en
uno existente; no agrega dependencias ni patrones nuevos donde ya había uno.

Ejemplos ❌/✅ de estos errores: docs/agent/anti-patterns.md.
Devolvé: lista de hallazgos (archivo:línea + regla + por qué), y un veredicto
final BLOQUEA / LIMPIO. Si dudás entre bloquear y pasar, bloqueá.
```

Reglas de este paso:
- **No sustituir la revisión independiente por la propia.** Si el sub-agente no se pudo
  lanzar, reportarlo y **no** declarar el paso como pasado.
- Los hallazgos del revisor **no se corrigen dentro de este skill**: se reportan al
  usuario. `verify-feature` audita, no arregla (ver encabezado).
- Un veredicto BLOQUEA del revisor ⇒ RESULTADO BLOQUEADO, sin importar los pasos 1–6.

## Reporte

Cerrar con este formato, sin adornos:

```
VERIFICACIÓN — <tarea>

Comandos
  backend lint:check  ✅ / ❌ <resumen del error>
  backend typecheck   ✅ / ❌ <error de tipo>
  backend test        ✅ / ❌
  backend test:e2e    ✅ / ❌
  frontend build      ✅ / ❌
  frontend typecheck  ✅ sin regresión / ❌ <archivo que empeoró>
  frontend design     ✅ / ❌ <neutral hardcodeado archivo:línea>

Invariantes      ✅ / ⚠️ <cuál>
Consultas        ✅ / ⚠️ <N+1 o lectura sin filtro de borrado>
Alcance          ✅ / ⚠️ <archivos fuera de alcance>
Anti-patrones    ✅ / ⚠️ <entrada>
Documentación    ✅ / ⚠️ <qué falta>
Limpieza         ✅ / ⚠️

Revisión independiente   ✅ LIMPIO / ❌ BLOQUEA <hallazgos archivo:línea> / ⚠️ no se pudo lanzar

RESULTADO: LISTO PARA COMMIT / BLOQUEADO
```

Si el resultado es BLOQUEADO, no commitear.
