# Auditoría de código — método reutilizable

> ⛔ **Esto no es una lista de bugs.** La lista de bugs es `pendientes.md`. Este archivo
> es **el método** para buscarlos y **el mapa de qué se auditó y qué no**. Su producto no
> es "encontramos 40 cosas": es poder mirar una tabla y saber en qué partes del sistema
> confiamos y por qué. Un hallazgo confirmado se muda a `pendientes.md`; acá solo queda
> registrado que ese módulo pasó por la pasada, cuándo y con qué resultado.

**Cuándo se usa:** cuando querés **confianza en lo ya construido**, no cuando estás
cerrando una tarea. Para cerrar una tarea está `verify-feature`, que audita **el diff**.
Esta pasada audita **código que ya pasó los gates** — y por eso encuentra otra clase de
cosas: lo que ningún gate mira porque nadie lo miró nunca como un cuerpo entero.

---

## La arquitectura: buscadores baratos, refutador caro

**Sonnet busca, el agente principal refuta.** No al revés, y no el mismo modelo para las
dos cosas.

El motivo es empírico. Un agente al que le pedís bugs **encuentra bugs**, existan o no.
En la pasada de jul-2026 sobre 39 commits de código recién escrito: 13 hallazgos, 10
sobrevivieron a la refutación (77%). Sobre código maduro que ya pasó gates, e2e y
revisiones, la densidad real de bugs es mucho más baja **pero la tasa de hallazgos no
baja igual** — el ruido sube en proporción. Esperá algo como 40 hallazgos con 8 reales.

De ahí el reparto:

| Rol | Modelo | Por qué |
|---|---|---|
| **Buscador** (N en paralelo, uno por lente) | Sonnet | Recall barato y masivo. Que sobre-reporte es aceptable: para eso está el filtro |
| **Refutador** (uno por hallazgo) | El principal (Opus) | Precisión cara y selectiva. Su instrucción es **REFUTAR**, no confirmar. En duda → refutado |

Sin el refutador, la pasada entrega ruido con el mismo formato que la señal — y el owner
deja de leer el reporte. Ese paso no es opcional.

---

## Decomponer por invariante, no por archivo

"Leé todos los archivos" es la partición equivocada: gasta tokens en código trivial y
diluye la atención. Cada buscador lleva **una sola lente** y es ciego a las demás.

Lentes base (ajustar al módulo):

| Lente | Qué caza |
|---|---|
| **Dinero y Decimal** | aritmética con `number` nativo, redondeos inconsistentes, agregaciones SQL sin normalizar, signos sin validar, división por cero |
| **Multi-tenant y permisos** | `tenant_id` que no sale del token, guards faltantes, JOINs que cruzan tenants, permiso equivocado por ruta |
| **Soft delete y consultas** | `SELECT`/`JOIN` sin `eliminado_el IS NULL`, N+1, `SELECT *` en tablas anchas |
| **Concurrencia y transacciones** | check-then-act, lecturas sin `FOR UPDATE` que luego escriben, orden de locks no determinista, atomicidad rota |
| **Contratos back↔front** | campos que un lado consume y el otro no expone; `whitelist: true` sin `forbidNonWhitelisted` descarta en silencio (200, no 400) |
| **Tests que no prueban nada** | mocks que deciden el resultado, aserciones que no pueden fallar, comportamiento sin cobertura real |

Para módulos de dominio, sumar la lente específica: motor de precios e impuestos, kardex
y costeo, cuadratura de caja, ciclo de vida de la venta.

---

## Paso a paso

1. **Elegir el alcance** — un módulo, o un grupo que se toca entre sí (ventas+pagos).
   Nunca "todo el proyecto" de una: no se puede medir ni corregir.
2. **Armar el contexto conocido** — pasarle a cada buscador: las invariantes de
   `CLAUDE.md`, las entradas de `pendientes.md` que tocan ese módulo, y qué rangos ya se
   auditaron. **Sin esto redescubren lo que ya sabemos y pagamos por relearn.**
3. **Lanzar los buscadores en paralelo**, uno por lente, ciegos entre sí, con schema
   estructurado y tope de hallazgos por lente (6 es razonable).
4. **Refutar cada hallazgo** con un verificador independiente por hallazgo. Vías válidas
   de refutación: (a) hay un guard/lock aguas arriba que el buscador no vio; (b) el
   escenario es imposible por construcción; (c) es **preexistente y de otro alcance**;
   (d) es una decisión de diseño documentada.
5. **Triar los sobrevivientes**: los que son del alcance van a `pendientes.md`; los
   refutados por *preexistente* **también** — no eran falsos, eran de otro alcance. Esa
   distinción es la diferencia entre filtrar ruido y perder señal.
6. **Registrar la fila** en el mapa de abajo, con fecha y números reales.

---

## Reglas que hacen que funcione

- **Todo hallazgo trae escenario reproducible** (inputs/estado concretos → resultado
  incorrecto) y `archivo:línea` del código actual, verificado abriendo el archivo. Sin
  eso no entra al triaje.
- **Presupuesto por pasada, acordado antes.** Una pasada de 5 lentes sobre un módulo
  mediano costó ~1.4M tokens de subagentes. Si el número no se fija antes, la pasada
  crece hasta donde alcance.
- **Decidir qué se hace con el resultado ANTES de lanzarla.** 40 bugs sin plan de
  corrección son ansiedad, no información — y ya tenemos backlog sin cerrar.
- **Un módulo con 0 sobrevivientes es un resultado válido y bueno.** Anotarlo igual: esa
  fila es exactamente la confianza que la pasada vino a producir.

---

## Mapa de cobertura

Qué se auditó, cuándo, y con qué resultado. Una fila por pasada.

| Alcance | Fecha | Lentes | Hallazgos | Sobreviven | Notas |
|---|---|---|---|---|---|
| 39 commits: costeo CPP, recuentos, motivos de diferencia | 2026-07-27 | 5 | 13 | 10 | Multi-tenant/permisos salió limpio. 1 refutado por preexistente → `pendientes.md` |
| Los 2 commits de corrección de esa pasada | 2026-07-27 | 1 (`domain-reviewer`) | 2 | 2 | 1 bloqueante: regresión de UI del rol aprobador |

### Orden propuesto para lo que falta

Por riesgo, no por tamaño. Lo de arriba primero.

| Prioridad | Alcance | Por qué |
|---|---|---|
| 1 | `ventas` (+ `pagos`) | Núcleo transaccional: dinero, impuestos, inventario, caja y concurrencia a la vez |
| 2 | `caja` + `propinas`/liquidación | Dinero y cuadratura; la liquidación es de las más grandes del repo |
| 3 | `items` (motor de precios) | El más grande (3.5k LOC) y modula todo el cálculo |
| 4 | `inventario` fuera de lo ya auditado | Kardex, mermas, conversión de unidades |
| 5 | RBAC, auth y tenants | La invariante más cara si se rompe, aunque cambia poco |
| 6 | Catálogos y configuración | Bajo riesgo: CRUD admin-only con lectura abierta |

Cerrar cada pasada actualizando **las dos tablas**: la de cobertura con lo hecho, y esta
con lo que quede pendiente.
