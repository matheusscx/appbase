# Auditoría de código — método reutilizable

> ⛔ **Esto no es una lista de bugs.** La lista de bugs es `pendientes.md`. Este archivo
> es **el método** para buscarlos y **el mapa de qué se auditó y qué no**. Su producto no
> es "encontramos 40 cosas": es poder mirar una tabla y saber en qué partes del sistema
> confiamos y por qué. Un hallazgo confirmado se muda a `pendientes.md` —y de ahí, al
> corregirse, a `resueltos.md`—; acá solo queda registrado que ese módulo pasó por la
> pasada, cuándo y con qué resultado.

**Cuándo se usa:** cuando querés **confianza en lo ya construido**, no cuando estás
cerrando una tarea. Para cerrar una tarea está `verify-feature`, que audita **el diff**.
Esta pasada audita **código que ya pasó los gates** — y por eso encuentra otra clase de
cosas: lo que ningún gate mira porque nadie lo miró nunca como un cuerpo entero.

---

## La arquitectura: buscadores baratos, refutador caro

**Sonnet busca, el agente principal refuta.** No al revés, y no el mismo modelo para las
dos cosas.

El motivo es empírico. Un agente al que le pedís bugs **encuentra bugs**, existan o no.
Cuatro pasadas medidas en jul-2026: sobre 39 commits de código recién escrito, 13 hallazgos
y 10 supervivientes (77%); sobre `ventas`+`pagos` —código maduro, con gates, e2e y
revisiones encima— 20 hallazgos y 15 supervivientes (75%); sobre `caja`+`propinas`, 25
hallazgos y 20 supervivientes (80%); sobre `items`+`calculo-precios` —el módulo más grande—
21 y 21 (100%).

**El refutador filtra menos de lo que corrige, y esa es la razón de tenerlo.** En la tercera
pasada solo 2 hallazgos se cayeron enteros y en la cuarta ninguno; el trabajo real fue
**bajar severidades y arreglar el escenario**. Los buscadores marcaron "alta" casi todo. En
la tercera, tres afirmaciones no sobrevivieron a abrir el archivo: un monto negativo que "se
persistía" y que en realidad frena un `CHECK` de BD, y dos "N+1" que eran escrituras de N
filas. En la cuarta —con 0 muertes— el refutador igual cambió el resultado: **6 severidades
abajo**, tres afirmaciones que perdieron su mitad peor (una regla "desactivada o borrada"
que era solo desactivada, porque `@DeleteDateColumn` ya excluye lo borrado), un fix propuesto
que era incorrecto (agregar `ORDER BY` no resuelve un deadlock que se decide un nivel más
arriba), un escenario reemplazado por otro que sí se sostiene, y **1 hallazgo que ninguna
lente vio**. También descartó una hipótesis propia que habría sido un falso positivo grande:
leer un `.vue` por rangos sueltos sugería que tres ramas del `guardar()` eran inalcanzables;
abrir el archivo entero mostró que eran dos cadenas `if/else` distintas.

Si el refutador solo cuenta cuántos mató, va a creer que no hizo falta. **Una pasada con 100%
de supervivencia no es una pasada sin refutación: es una donde la refutación se gastó
entera en precisión.**

**La predicción de que el ruido subiría sobre código maduro no se cumplió**, y la razón
importa: la precisión no vino de que los buscadores acertaran más, sino de tres cosas del
prompt que hay que sostener en cada pasada. (1) Se les pasó **lo ya conocido** —las
entradas de `pendientes.md` del módulo, los barridos ya hechos— así que no gastaron
hallazgos en redescubrirlo. (2) Se les exigió **escenario reproducible con `archivo:línea`
verificado abriendo el archivo**; un buscador que tiene que abrir el archivo para citar la
línea descarta solo sus propias corazonadas. (3) Una lente por agente: sin superposición
no hay relleno para llegar al cupo. Aflojá cualquiera de las tres y la tasa se desploma.

Lo que sí cambia sobre código maduro es **la forma** del hallazgo: menos errores de
escritura reciente y más deuda estructural que ningún gate mira (una fórmula que quedó
vieja cuando llegó una feature nueva, una validación que solo existe en el cliente, una
rama que nunca tuvo test).

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
   ⚠️ Al **arreglar** lo que sobrevive, la revisión independiente del cierre se pide
   nombrando propiedades concretas, no "revisá el diff" — ver `verify-feature` paso 7.
   Esa diferencia produjo los cuatro únicos bloqueos de la tanda de jul-2026.
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
| `ventas` + `pagos` (backend completo + pantallas del módulo) | 2026-07-27 | 7 | 20 | 15 | **Soft delete salió limpio** (tabla por tabla, 0 hallazgos). 3 lentes independientes cayeron sobre el mismo bug del vuelto → se contó una vez. 3 hallazgos pasaron a decisión de owner por regla no documentada, no a la lista de bugs |
| `caja` + `propinas` (backend completo + pantallas de los dos módulos) | 2026-07-27 | 8 | 25 | 20 | 3 hallazgos los vieron dos lentes cada uno → se contaron una vez. **La máquina de estados de caja salió limpia** (12 transiciones, las 11 inválidas bloqueadas), igual que la inmutabilidad del arqueo congelado y el anti-doble-pago de liquidaciones. Los 2 hilos que dejó la pasada de `ventas` cerraron: defendidos en el endpoint HTTP, **no** en el método compartido ni en ningún test |
| `items` + `calculo-precios` (backend completo + las 2 pantallas del módulo) | 2026-07-28 | 8 | 21 | 21 | **Ninguno se cayó entero** — 6 bajaron de severidad, 3 perdieron la mitad de la afirmación, 2 se reclasificaron como decisión de owner, y el refutador sumó 1 que ninguna lente vio. **Soft delete limpio: 0 sobre 98 queries** revisadas una por una; multi-tenant limpio en los 63 JOIN (su único hallazgo es defensa en profundidad no explotable). El hilo que dejó la pasada de `ventas` cerró con un matiz: el N+1 de `findOne` sobrevivía **del lado del precio**, no del de la persistencia que `cargarBasePorIds` ya había resuelto |

### Orden propuesto para lo que falta

Por riesgo, no por tamaño. Lo de arriba primero.

| Prioridad | Alcance | Por qué |
|---|---|---|
| ~~1~~ | ~~`ventas` (+ `pagos`)~~ | ✅ Hecho 2026-07-27 |
| ~~1~~ | ~~`caja` + `propinas`/liquidación~~ | ✅ Hecho 2026-07-27 |
| ~~1~~ | ~~`items` (motor de precios)~~ | ✅ Hecho 2026-07-28 |
| 2 | `turnos` + `salones` | La pasada de ventas dejó tres `LEFT JOIN garzones` sin filtro de `tenant_id` esperando acá, y la de propinas dejó dos: el `tipo_garzon` de la sesión se congela al abrir turno pero `garzones.tipo` es editable, y `sesiones_garzon` alimenta el reparto |
| 3 | `inventario` fuera de lo ya auditado | Kardex, mermas, conversión de unidades |
| 4 | RBAC, auth y tenants | La invariante más cara si se rompe, aunque cambia poco |
| 5 | Catálogos y configuración | Bajo riesgo: CRUD admin-only con lectura abierta |

Cerrar cada pasada actualizando **las dos tablas**: la de cobertura con lo hecho, y esta
con lo que quede pendiente.
