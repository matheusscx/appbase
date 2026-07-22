---
name: verify-feature
description: Verifica que una tarea o feature está realmente terminada antes de commitear. Ejecuta lint, tests, test:e2e de API y build del frontend, y revisa invariantes, alcance y documentación. Usar al cerrar cualquier tarea, antes de commitear a main, o cuando el usuario pida "verifica", "revisa si está listo" o "cierra la tarea".
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
cd backend  && npm test
cd backend  && npm run test:e2e
cd frontend && npm run build
```

Registrar el resultado real de cada comando. **No declarar que un paso pasó sin
haberlo ejecutado.** Si el stack no está levantado, usar `docker-compose up -d` antes
de `test:e2e`.

## 2. Invariantes

Revisar el diff (`git diff`) contra las invariantes de `CLAUDE.md`:

- [ ] `tenant_id` proviene del token, nunca del body/query/params
- [ ] Todo cálculo de dinero o porcentaje usa Decimal.js; porcentajes en decimal
- [ ] Sin `DELETE` físico; toda lectura nueva filtra `eliminado_el IS NULL`
- [ ] Columnas PK/FK UUID con `type: 'uuid'` explícito
- [ ] Sin cambios al sistema de tokens JWT
- [ ] "Exento" tratado como estado explícito, no como ausencia de impuesto
- [ ] Rutas nuevas con guard de permisos en el backend

Cualquier violación: **detener el cierre y reportar**, no corregir sobre la marcha.

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

## Reporte

Cerrar con este formato, sin adornos:

```
VERIFICACIÓN — <tarea>

Comandos
  backend lint      ✅ / ❌ <resumen del error>
  backend test      ✅ / ❌
  backend test:e2e  ✅ / ❌
  frontend build    ✅ / ❌

Invariantes      ✅ / ⚠️ <cuál>
Alcance          ✅ / ⚠️ <archivos fuera de alcance>
Anti-patrones    ✅ / ⚠️ <entrada>
Documentación    ✅ / ⚠️ <qué falta>
Limpieza         ✅ / ⚠️

RESULTADO: LISTO PARA COMMIT / BLOQUEADO
```

Si el resultado es BLOQUEADO, no commitear.
