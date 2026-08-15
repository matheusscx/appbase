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
Cinco pasadas medidas: sobre 39 commits de código recién escrito, 13 hallazgos
y 10 supervivientes (77%); sobre `ventas`+`pagos` —código maduro, con gates, e2e y
revisiones encima— 20 hallazgos y 15 supervivientes (75%); sobre `caja`+`propinas`, 25
hallazgos y 20 supervivientes (80%); sobre `items`+`calculo-precios` —el módulo más grande—
21 y 21 (100%); sobre `turnos`+`salones`, 24 y 22 (92%).

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

**La quinta pasada agregó una forma de aporte que las cuatro anteriores no habían mostrado:
el refutador encontró que un fix propio estaba a medias.** Las dos altas de
`turnos`+`salones` se corrigieron sacando un filtro de `armarDetalle`, y la revisión
independiente detectó que la MISMA consulta seguía filtrada en el camino de la comanda: el
fix movía el bug de la pantalla al ticket de cocina en vez de matarlo. Ninguna lente lo
vio, porque las lentes miran el código **antes** del fix. De ahí una regla operativa: la
revisión del cierre no es un trámite sobre un diff ya correcto — es donde se descubre que
la corrección cubrió una de dos mitades.

Corolario del mismo caso: **un fix puede introducir su propia regresión**. El lock nuevo
trajo un doble checkout de conexión que antes no existía (no había transacción), y hacer
visible una línea escondida hizo que el frontend mostrara un total de `$0`. Las dos las
encontró la revisión, no los gates.

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

## El brief puede estar mal, y la regla que lo salva

**Dos veces en la pasada de RBAC un buscador refutó al brief en vez de al código, y las dos
tenía razón.** Vale registrarlo porque el brief lo escribe el mismo que después refuta, y es el
único insumo que nadie audita.

1. **Una hipótesis mía, falsa.** El brief decía que sospechaba del pool de conexiones agotado
   *disfrazado* de 401. La lente lo midió: `jwt.strategy.ts` → `validate()` **no toca la base**,
   y ningún guard tiene `try/catch` que traduzca un error a 401. Un fallo de base ahí da 500. La
   hipótesis murió y en su lugar apareció la causa real, que era otra.
2. **Una cita mía a un documento que no dice eso.** El brief afirmaba que `usuarios`,
   `refresh_tokens` y `tokens_acceso` no tienen `eliminado_el`, citando la sección de
   `patterns/backend.md` que censa las tablas **sin `tenant_id`** — otra columna. Medido:
   `usuarios` y `tokens_acceso` **sí** la tienen. El agente no paró la pasada porque ya venía
   abriendo cada entidad antes de afirmar, así que la discrepancia no contaminó ningún hallazgo.

**La regla que convirtió las dos en anécdotas y no en hallazgos falsos es la misma:** *todo
hallazgo trae `archivo:línea` verificado abriendo el archivo*. Un buscador que tiene que abrir el
archivo descarta solo sus corazonadas **y también las del brief**. Aflojá esa regla y el brief
pasa de insumo a verdad.

Corolario operativo: **pedirle explícitamente al buscador que reporte `BLOCKED` si un dato del
brief no cierra**, y decirle que un BLOCKED es señal, no fricción. Las dos veces que pasó, el
reporte llegó igual y con la corrección adentro.

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
| `turnos` + `salones` + `garzones` (backend completo + las 6 pantallas) | 2026-08-06 | 8 | 24 | 22 | Dos lentes independientes cayeron sobre el mismo bug de la línea que se cuela → se contó una vez. **Multi-tenant limpio ruta por ruta** en los 4 controllers, y **soft delete limpio: 0 sobre ~65 queries**. Solo 1 se cayó entero (un deadlock refutado por cómo lockea un `SELECT … IN (…) FOR UPDATE`), y **una fuerza bruta se refutó midiendo, no argumentando**: 14 días de CPU saturada. El refutador sumó el hallazgo más caro de la pasada — el fix de las dos altas **estaba a medias** y movía el bug al ticket de cocina. El hilo de `tipo_garzon` cerró con matiz: propinas ya bloquea el reparto corrupto, falta el aviso al editar |
| `inventario` + `recuentos` + `mermas` + conversión de unidades (backend + 5 pantallas + 3 composables) | 2026-08-15 | **12** | 20 | 16 | Primera pasada con 12 lentes. **Tres salieron limpias** —multi-tenant (21 rutas verbo por verbo, 17 DTOs), soft delete (~48 queries) y dinero/Decimal— y el chokepoint del kardex se verificó sólido por dos lentes independientes. **Dos lentes ciegas entre sí cayeron sobre el mismo bug** (reingresar al CPP de hoy y no al costo de salida): se contó una vez. El refutador **bajó 2 severidades** —el deadlock de los caminos inversos, porque su consecuencia peor ya estaba asumida por diseño en el docblock del registry de reembolsos; y la falta de reconciliación saldo↔kardex, que no tenía escenario reproducible— y **fusionó 3 hallazgos en 1** (serie/lote a medias). El hallazgo más caro: **la doc del recuento anticipó el doble conteo y lo dio por mitigado con un razonamiento que no cierra** |
| RBAC + `auth` + `tenants` (backend + middlewares y pantallas del frontend) | 2026-08-15 | 12 | 25 | 22 | **El eje más sensible y el único que ninguna pasada había tocado.** Se corrió en dos tandas de 6 tras morir entera la primera vez por límite de sesión. **Convergencias fuertes:** *tres* lentes ciegas cayeron sobre el mismo borde (módulos contratados sin enforcement consistente) y *dos* sobre el token de Google en la query string — una con la mitad que la otra no tenía. **El refutador bajó 4 severidades** (el `assignUser` de alta a media al ver que exige `TenantAdminGuard` y no cruza datos; los dos huecos de test de alta a media porque el código está bien y lo que falta es la red) y **reencuadró 1** (en `setPermissions` el titular no es la carrera sino que no es atómico: un solo request que falle deja el rol sin permisos). **Dos refutaciones fueron contra el brief, no contra el código** — ver abajo |

### Orden propuesto para lo que falta

Por riesgo, no por tamaño. Lo de arriba primero.

| Prioridad | Alcance | Por qué |
|---|---|---|
| ~~1~~ | ~~`ventas` (+ `pagos`)~~ | ✅ Hecho 2026-07-27 |
| ~~1~~ | ~~`caja` + `propinas`/liquidación~~ | ✅ Hecho 2026-07-27 |
| ~~1~~ | ~~`items` (motor de precios)~~ | ✅ Hecho 2026-07-28 |
| ~~2~~ | ~~`turnos` + `salones`~~ | ✅ Hecho 2026-08-06. ⚠️ **La razón que decía esta fila estaba vieja:** los cinco `LEFT JOIN garzones` ya llevaban `g.tenant_id` (con tests que lo asertan) desde una pasada intermedia; se verificó abriendo los archivos antes de lanzar. El hilo que sí seguía vivo era el de `tipo_garzon`, y cerró con matiz |
| ~~3~~ | ~~`inventario` fuera de lo ya auditado~~ | ✅ Hecho 2026-08-15. La razón de la fila se cumplió: kardex, mermas y conversión de unidades produjeron 4 de los 6 hallazgos altos |
| ~~4~~ | ~~RBAC, auth y tenants~~ | ✅ Hecho 2026-08-15. La razón de la fila se confirmó: 22 hallazgos, tres de ellos con impacto directo sobre credenciales |
| 5 | Catálogos y configuración | Bajo riesgo: CRUD admin-only con lectura abierta |

Cerrar cada pasada actualizando **las dos tablas**: la de cobertura con lo hecho, y esta
con lo que quede pendiente.

### ⏸ Programa pausado (2026-08-06) → ▶️ reanudado (2026-08-15)

**Las pasadas 3, 4 y 5 estuvieron suspendidas desde el 2026-08-06 hasta bajar el backlog.**
No es que dejaran de importar: es la regla de este mismo método aplicada a sí misma —*"40
bugs sin plan de corrección son ansiedad, no información"*—. La pasada de `turnos`+`salones`
sumó **27 entradas** a `pendientes.md`, que pasó de 53 a 80 abiertas. Auditar más código
antes de corregir lo encontrado produce inventario, no confianza.

**El owner las reanuda el 2026-08-15, y lo que cambió no es el número sino la forma.**
`pendientes.md` quedó **reordenado por lo que hace falta para tomar cada entrada** en vez de
por la pasada que la encontró. Eso es lo que devuelve la condición de reanudación: de las 60
entradas, 13 son endurecimiento de producción (no corren hoy) y 4 son vigilancia (no son
trabajo), así que el backlog vivo es de **43** — y **8 de ellas son mecánicas**, tomables sin
preguntarle nada al owner. Un hallazgo nuevo ahora cae en una lista donde se ve dónde entra.

⚠️ **El total bajó menos de lo que sugiere el trabajo hecho, y conviene saber por qué:** se
archivó 1 entrada que ya estaba entregada y nadie había mudado, y se promovió a entrada 1
hueco de test que vivía como nota suelta dentro de un bloque de contexto. Reordenar no cierra
nada; lo que hace es que el tamaño real sea visible.

### ⏸ Pausado otra vez tras la pasada 4 (decisión del owner, 2026-08-15)

**Queda una sola pasada —la 5, catálogos y configuración— y NO se lanza todavía.** No es que
el umbral se haya cruzado: la pasada 4 sumó 22, bajo los ~25. Lo que se cruzó es otra cosa, y
el método no la tenía escrita: **`pendientes.md` llegó a 96 entradas, de las cuales 29 esperan
una decisión del owner** — más que cualquier otra sección del archivo.

Ahí está el cuello. Un hallazgo que espera respuesta no es trabajo pendiente: es trabajo que
**nadie puede tomar**, ni siquiera equivocándose. Auditar más código mientras ese montón crece
produce inventario, no confianza — que es la regla de este mismo método aplicada a sí misma.

➡️ **Condición de reanudación de la 5:** que la sección "Necesita que el owner conteste" baje
a un tamaño donde se pueda leer entera de una sentada. La 5 es además la de menor riesgo
declarado (*"CRUD admin-only con lectura abierta"*), así que es la que menos cuesta diferir.

✅ **CONDICIÓN CUMPLIDA el mismo día.** La sección de decisiones bajó de **29 a 1** en una tanda
del owner; la única que queda espera una investigación de mercado, no una respuesta. **La pasada
5 queda habilitada.**
⚠️ Pero el número que ahora manda es el otro: `pendientes.md` sigue en **96 entradas**, con 35
decididas esperando construcción y 24 mecánicas. **Antes de lanzar la 5 conviene mirar si
corresponde bajar ese stock primero** — la 5 es la de menor riesgo del programa y no hay
urgencia en ella. Decidirlo es del owner; lo que este archivo aporta es que el freno ya no es
el que había.

⚠️ **Lección para el umbral, que a partir de ahora se mide con dos números y no con uno:** el
tope de ~25 entradas por pasada no alcanza. Una pasada puede quedar cómodamente abajo y aun así
tapar el proceso, si lo que suma son **decisiones** en vez de correcciones. **Antes de lanzar
una pasada se miran los dos:** cuántas entradas sumó la anterior, y cuántas decisiones sin
contestar hay abiertas.

⚠️ **La condición original sigue vigente:** si una pasada vuelve a sumar ~25 entradas, el
programa se detiene igual. **La pasada 3 sumó 16** (`pendientes.md`
pasó de 60 a 76): por debajo del umbral, así que el programa sigue. Las pasadas 4 (RBAC/auth)
y 5 (catálogos) quedan habilitadas — pero el umbral se mide **antes** de lanzar la 5, no
después de las dos. El orden de arriba sigue siendo el
correcto: `inventario` primero por riesgo, y **RBAC/auth/tenants es el único eje sensible
que ninguna pasada tocó todavía**.
