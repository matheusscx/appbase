# Anti-patrones conocidos en este proyecto

Errores que **ya se cometieron aquí**. Es el único documento del setup que contiene
conocimiento que no se puede derivar leyendo el código correcto.

## Reglas de este archivo

1. **Solo entra lo que ya pasó.** Un anti-patrón especulativo es consejo de estilo
   disfrazado y no aporta nada que el modelo no sepa ya. Cada entrada nace de un bug
   real, un commit de corrección o una revisión que lo detectó.
2. **Cada entrada sale cuando se automatiza.** Si el patrón pasa a ser regla de ESLint
   o test, se borra de aquí y queda la referencia a la regla. Este archivo no crece
   indefinidamente.
3. **Tope: 20 entradas `### ❌`.** Si se llena, hay tres salidas en este orden: pasar a
   `### ✅` lo que ya esté automatizado (regla 2), **fusionar** entradas que sean caras del
   mismo error, y recién entonces eliminar la más antigua sin reincidencia. Borrar es la
   última porque cada entrada es un bug que ya se pagó.
   *Aplicado el 2026-08-11, que fue la primera vez: el tope estaba en 25 y nunca se había
   ejecutado. Se fusionaron las cinco de `vue-tsc` estricto en una, y la de Tailwind pasó a
   `✅` porque `check-design-tokens.mjs` ya la enforcea. Quedó en 20 sin perder una línea.*

   *Aplicado por segunda vez el 2026-08-22, desde 22: **dos fusiones y ningún borrado**, otra
   vez sin perder una línea. Se juntaron las dos caras del repo proxy de ADR-020 —congelar
   una referencia de método vs. omitir el `manager?`— porque son el mismo malentendido en
   direcciones opuestas, y "aserción que no puede fallar" pasó a ser el caso (d) de "test
   verde que no ejerce lo que dice probar", que ya coleccionaba caras.*

   ⚠️ **Lo que NO se pudo hacer, y conviene decirlo porque parecía la salida obvia:** pasar
   "campo que escribe estado derivado sin pasar por su choke point" a `✅` por su test de
   invariante. **La propia entrada documenta un hueco** —el test es una heurística de texto
   sobre SQL crudo y no vería una escritura vía el repositorio de TypeORM con la propiedad
   camelCase—, así que marcarla como automatizada sería sobreafirmar. La regla 2 pide que el
   patrón esté cerrado, no que tenga un test que cubre la mitad por la que se rompió.
4. Formato fijo: qué pasó → ❌ mal → ✅ bien → una línea de porqué.

---

## Backend

### ✅ Columna UUID sin `type: 'uuid'` explícito — AUTOMATIZADO

Ya enforced por test: `src/common/invariants/uuid-columns.invariant.spec.ts` recorre las
entities y falla si una columna `*_id` no declara `type: 'uuid'` (con allowlist para ids
externos como `google_id`). El porqué (JOINs raw fallan `varchar` vs `uuid`) vive en
[ADR-004](../adr/004-uuid-column-types.md). Regla movida del `.md` al test.

### ✅ Columna de fecha sin `type: 'timestamptz'` explícito — AUTOMATIZADO

Mismo molde que el de arriba, misma causa: sin `type`, TypeORM elige por vos y para fechas
elige `timestamp` **sin zona**. Llegó a 195 columnas partidas por accidente. Comparar una con
zona contra una sin zona no da error — Postgres castea con el `TimeZone` de la sesión que
compara, así que matchea 1 de 3 combinaciones y las otras 2 afectan 0 filas **en silencio**.

Enforced por dos tests: `src/common/invariants/timestamptz-columns.invariant.spec.ts` (mira
la metadata de TypeORM, no el texto — hay 5 entities que usan `@Column` a secas y un grep del
decorador no las ve) y `test/esquema.e2e-spec.ts` (mira `information_schema`, y va sobre
TODAS las columnas: `refresh_tokens.expires_at` se escapó del primero por no llamarse como
una columna de auditoría). El porqué vive en
[ADR-019](../adr/019-timestamptz-en-toda-columna-de-fecha.md).

**El corolario que sí es nuevo, y no lo caza ningún test:** un cast de zona horaria es una
respuesta al TIPO de la columna, no una verdad permanente. `items.service.ts` tenía
`NOW() AT TIME ZONE 'UTC'` puesto a propósito para tapar el mismatch; con la columna ya en
`timestamptz` ese mismo cast **reintroduce el bug que arreglaba** (medido: 4 horas de
corrimiento con la sesión en `America/Santiago`). Si cambiás el tipo de una columna, releé
los casts que la tocan en vez de conservarlos.

### ❌ `tenant_id` tomado del request

```ts
// MAL
const { tenant_id } = dto;

// BIEN — el payload JWT es camelCase (`tenantId`), no la columna DB (`tenant_id`)
const { tenantId } = req.user as { tenantId: string };
// o vía decorador: @CurrentUser() user: JwtUser  →  user.tenantId
```

Cualquier cliente puede enviar otro `tenant_id` en el body y leer o escribir datos
de otro tenant. Es una fuga multi-tenant, no un descuido de estilo. Ojo con el casing:
`req.user.tenant_id` es `undefined` — el campo decodificado es `tenantId`.

### ❌ Recurso indexado por usuario que una acción de un tenant borra en otro

El `tenant_id` puede salir del token, todas las lecturas pueden filtrar bien, y aun así la
acción de un tenant **destruir estado observable de otro** — si por el medio hay un recurso
cuya clave es el **usuario** y no el par usuario+tenant. Una persona existe en varios
tenants; sus tokens, preferencias y vínculos, no necesariamente.

```ts
// MAL — el criterio es (usuario, tipo): quema el alta pendiente que otro tenant
// le había emitido a la misma persona.
.where('usuario_id = :usuarioId AND tipo = :tipo AND usado_el IS NULL', { usuarioId, tipo })

// MAL, la otra cara — barrer "todos los tokens del usuario" cuando sólo se quería
// matar las credenciales: se lleva puestos los de otros tenants y otros propósitos.
invalidarTodos(usuarioId)

// BIEN — el par completo, y el tipo acotado a lo que la acción realmente invalida
.andWhere(`datos ->> 'tenantId' = :tenantId`, { tenantId })
.where('usuario_id = :u AND tipo IN (:...tipos)', { tipos: [INVITACION, RESET] })
```

**Lo caro no es el borrado: es que no deja rastro.** En el caso real (ago-2026, `tokens_acceso`)
la persona **desaparecía del roster del otro tenant** —la lista de pendientes exige
`usado_el IS NULL`— y su link dejaba de servir, sin ningún evento que lo explicara para
nadie. Y era accionable a repetición: cualquier admin podía mantener bloqueadas las altas
pendientes de un correo ajeno repitiendo la suya.

**Cómo se caza en una auditoría:** listar las tablas cuya PK o criterio de búsqueda es
`usuario_id` **sin** `tenant_id` al lado, y para cada una preguntar *¿puede una acción de un
tenant escribir acá?*. El grep por `tenant_id` no lo encuentra —justamente porque no está—,
así que se busca por la ausencia. Ojo también con los `invalidarTodos` / `deleteAll` /
`revokeAll` por usuario: el barrido total casi siempre es más ancho que la intención.

### ❌ `number` nativo para dinero o porcentajes

```ts
// MAL
const total = precio * 1.19;

// BIEN
const total = new Decimal(precio).mul(new Decimal(1).plus(tasa));
```

Y las tasas se guardan en decimal: `0.19`, nunca `19`. Un `19` interpretado como tasa
multiplica el impuesto por cien.
→ *Candidato a regla de lint sobre operadores aritméticos en campos de monto.*

### ❌ Redondear plata en el lugar equivocado — dos caras del mismo error

Usar `Decimal` no alcanza: importa **dónde** se aplica el redondeo. El frente de redondeo
de plata (2026-08) pagó las dos caras.

**(a) Demasiado pronto — redondear dentro del bucle de reglas en vez de al cerrar el paso.**

```ts
// MAL — cuantiza regla por regla: el error se COMPONE
for (const regla of reglas) acumulado = cuantizar(aplicar(regla, acumulado));

// BIEN — fino adentro del paso, cuantizado al cerrarlo
for (const regla of reglas) acumulado = aplicar(regla, acumulado);
acumulado = cuantizar(acumulado);
```

Es el caso del **Vancouver Stock Exchange**: un índice que perdió la mitad de su valor en
dos años porque redondeaba en cada operación en vez de al final. Acá el equivalente medido
fue el piso en cero: cuantizar las trazas al volver del bucle daba
`descuentoAplicado = 101` sobre un neto de 100, y una línea en **−1**.

**(b) Demasiado tarde y por separado — cuantizar un total por su cuenta en vez de derivarlo
de sus componentes.**

```ts
// MAL — cinco cuantizaciones independientes; la identidad se rompe
totalFinal = cuantizar(neto.minus(desc).plus(rec).plus(iva));

// BIEN — el total ES la suma de los componentes ya cuantizados
totalFinal = netoQ.minus(descQ).plus(recQ).plus(ivaQ);
```

Rompe `MntTotal = MntNeto − Desc + Rec + IVA`, que es lo que un documento tributario tiene
que cumplir. **Medido: 3.965 de 10.000** carritos generados quedaban descuadrados.

Un total nunca se cuantiza aparte: se **deriva** de partes que ya lo están. Y si el residuo
tiene que ir a algún lado, se decide a quién —en el desbruteo lo absorbe el IVA— en vez de
dejarlo repartido en el último decimal de cada componente.

### ❌ Borrado físico de filas

El proyecto es mayormente SQL raw, así que el fallo real es una query nueva sin el
filtro, o un `DELETE` físico crudo:

```sql
-- MAL — borra la fila
DELETE FROM ventas WHERE venta_id = $1;
-- MAL — lectura nueva sin filtrar borrados
SELECT * FROM ventas WHERE tenant_id = $1;

-- BIEN — marcar
UPDATE ventas SET eliminado_el = NOW() WHERE venta_id = $1 AND tenant_id = $2;
-- BIEN — toda lectura filtra
SELECT * FROM ventas WHERE tenant_id = $1 AND eliminado_el IS NULL;
```

En los pocos caminos por repositorio de TypeORM, el equivalente es `repo.softDelete(id)`
en vez de `repo.delete(id)`. Omitir el filtro en una query nueva hace reaparecer
registros borrados en listados y reportes.

⚠️ **Hay excepciones, y por eso la regla NO se aplica con un grep.** Una lectura sin el
filtro puede ser deliberada; **lo que la distingue de un olvido es que el porqué está
escrito en la propia consulta**. Ése es el criterio, y es lo único que hay que recordar.

⛔ **Y por eso la lista de abajo NO es exhaustiva, ni pretende serlo.** Una primera versión
de esta sección decía *"las dos que existen hoy"* y nombraba dos; grepeando por conducta
aparecieron **al menos seis**. La revisión independiente lo cazó el 2026-08-25 y tenía
razón en el argumento, no solo en el número: **una lista que se presenta como completa y
omite las excepciones caras es peor que no tener lista**, porque el que audita consulta la
lista, no la encuentra, aplica la regla literal y "arregla" algo que costaba plata.

Familias que existen hoy, como muestra de las FORMAS que toma, no como inventario:

| Familia | Por qué no filtra |
|---|---|
| El hecho **histórico** ya ocurrido: kardex (`inventario.service.ts`), mermas (`mermas.service.ts`) | *"lo que está en el kardex queda en el kardex"*: dar de baja el producto después no puede borrar el movimiento del informe ni bajar el total sin avisar. Y en el kardex, filtrarlo haría que anular una venta de un ítem borrado dejara de reponer |
| Lo que **ya está en curso**: líneas de comanda (`salones.service.ts`) | esas líneas ya están en la cuenta; si el ítem se borró del catálogo después, filtrarlo las haría desaparecer del ticket de cocina |
| La **autoría** del borrado: el `leftJoin` a `usuarios` de los `findAll` con `incluirEliminados` (ejemplo concreto: `categorias.service.ts → findAll`) | quién borró es un hecho histórico: filtrarlo dejaría la columna vacía justo en las filas que se están mirando |
| La **papelera** entera (`withDeleted()`) | su razón de ser es mostrar lo borrado |
| `obtenerUso` de descuentos y recargos | el guard del cambio de nivel **cuenta** las filas puente de ítems en la papelera —tiene que contarlas, `remove` no toca las tablas puente— así que listar solo los vivos dejaba al admin leyendo *"1 ítem todavía lo tiene"* sin forma de saber cuál. Devuelve los borrados **marcados** y cada consumidor decide (decisión del owner, 2026-08-25) |

📌 **Antes de "arreglar" una lectura sin filtro, buscá ese comentario.** Si no está, es un
bug; si está, restaurar el filtro rompe algo que alguien ya midió. La última de la tabla
además está protegida por un test que afirma sobre la cláusula exacta, no sobre la palabra
`eliminado_el` suelta.

### ❌ N+1 — una query por iteración sobre un resultado

```ts
// MAL — 1 query para la lista + 1 query por fila (N+1)
const rows = await this.db.query(`SELECT ... FROM items WHERE ...`, [p]);
const data = await Promise.all(
  rows.map(async (r) => ({
    ...this.mapRow(r),
    disponible: await this.calcularDisponible(tenantId, r.id), // query por fila
  })),
);

// BIEN — resolver el dato derivado para todas las filas en una sola query
const ids = rows.map((r) => r.id);
const dispRows = await this.db.query(
  `SELECT item_id, ... FROM ... WHERE item_id = ANY($1) AND eliminado_el IS NULL
   GROUP BY item_id`,
  [ids],
);
const byId = new Map(dispRows.map((d) => [d.item_id, d]));
const data = rows.map((r) => ({ ...this.mapRow(r), disponible: byId.get(r.id) ?? null }));
```

Un `map(async … query)` o un `for` con `await query` dentro escala lineal con las
filas: un listado de 50 items dispara 50+ queries. Resolver siempre en una query con
`JOIN`/agregación, o batch-fetch con `WHERE id = ANY($1)` y mapear en memoria. Aplica
igual a `Promise.all` sobre queries: sigue siendo N round-trips.
→ *Instancia real (deuda viva, aún sin corregir): `items.service.ts` `findAll` llama
`calcularDisponibleReceta`/`Combo` por fila. Difícil de detectar por lint → se revisa en
el cierre con el sub-agente independiente de `verify-feature`.*

⚠️ **Matiz post-ADR-020: dentro de una transacción, `Promise.all` de lecturas deja de
paralelizar.** Todas resuelven contra el mismo `EntityManager` del contexto ALS — un único
`pg.Client` — así que `node-postgres` las encola en vez de correrlas en paralelo (y emite
`DeprecationWarning: Calling client.query() when the client is already executing a query`).
No es un N+1 nuevo ni el resultado cambia, pero el `Promise.all` deja de comprar el
paralelismo que parece prometer una vez que corre en transacción. Instancia real:
`calculo-precios.service.ts`, dos sitios — ver `docs/agent/pendientes.md` § "Necesita que
el owner conteste" (toca el motor de cálculo de precios, requiere autorización del owner).

**Tres variantes que cuestan más que el N+1 de manual** (las dos primeras encontradas en
jul-2026 en el camino caliente del POS, corregidas en la auditoría de `ventas`+`pagos`):

1. **Traer de más y descartarlo.** `crearEnTransaccion` llamaba `itemsService.findOne` por
   línea del carrito. Cada `findOne` abre 4-8 queries construyendo impuestos, recargos,
   descuentos, ingredientes, componentes y grupos… de los que la venta **no lee ninguno**:
   solo usa campos del row base. Antes de batchear, preguntar *qué campos usa realmente el
   llamador*: a veces el arreglo no es "N queries → 1", es "N×8 queries → 1".
2. **N+1 anidado dentro del método que ya parecía el problema.** El hallazgo reportado era
   "una resolución de personalización por línea". Al abrirlo, `resolverGruposDeItem` tenía
   adentro **una query por grupo de modificadores**, que multiplicaba a la anterior. El
   interno se arregla sin tocar firmas y beneficia a todos los llamadores; conviene
   cerrarlo antes de decidir si vale batchear el externo. Cuando el batch necesita un par
   de claves (acá `grupo ↔ item_grupo`, por el override), `= ANY($1)` sobre una sola trae
   filas cruzadas: van dos arrays paralelos con `unnest($1::uuid[], $2::uuid[])`.
3. **Cargar el catálogo "una vez por función" en un clúster que se llama entre sí.** El
   arreglo obvio —`const convertir = await crearConversor()` arriba de cada función que
   convertía dentro de un loop— no cierra nada si esas funciones se invocan mutuamente:
   `venderComponentesCombo` → `venderIngredientesReceta` → `venderOpcionesGrupos` → de
   vuelta a la receta. "Una vez por función" seguía siendo una lectura del catálogo **por
   componente**. El recurso cargado se crea en los **puntos de entrada** y **baja por
   parámetro** por todo el árbol; en las privadas va como parámetro **requerido**, para que
   una rama nueva no pueda olvidarse y volver a leer (jul-2026, `items.service.ts`).
   Se fija con un test que cuenta las cargas, no las conversiones:
   `expect(crearConversor).toHaveBeenCalledTimes(1)`. Sin él, el arreglo se revierte sin
   que falle nada — el resultado de la venta es idéntico, solo cambia cuántas queries hizo.

4. **N+1 sosteniendo un lock pesimista.** `fusionarCuentas` leía las líneas del destino
   una vez por línea de cada origen, **dentro de la transacción que ya tenía
   `pessimistic_write` sobre todas las cuentas de la mesa**. Ahí el costo no es latencia:
   es el tiempo que nadie más puede agregar líneas ni cerrar en esa mesa. Un N+1 en una
   lectura suelta se paga en milisegundos propios; adentro de un lock se lo cobra a todos
   los demás. Cuando el bucle vive dentro de una transacción con lock, la pregunta no es
   "¿cuántas queries?" sino "¿cuánto dura el lock?" (ago-2026, `salones.service.ts`).
   El batch necesita **mantener el índice al día**: la línea que se mueve al destino tiene
   que poder recibir la suma de una igual que venga de un origen posterior. Armar el mapa
   una vez y no actualizarlo duplica líneas en vez de acumularlas — es la conducta que la
   consulta repetida daba gratis.

5. **La misma query, con los mismos parámetros, repetida por unidad.** No hay iteración
   sobre filas distintas: `resolverPersonalizacionCombo` resolvía la elección de grupos por
   cada **(componente × unidad)** del combo, y cada llamada releía el catálogo entero del
   mismo item — dos consultas idénticas, tantas veces como unidades. Es el N+1 más fácil de
   no ver, porque el bucle no *parece* recorrer un resultado: recorre una cantidad. La
   pregunta que lo destapa es *"¿los parámetros de esta query cambian entre vueltas?"*. El
   arreglo separa **cargar el catálogo** de **resolver la elección**, y la carga se hace por
   lote para todos los items de una; el parámetro del catálogo entra **opcional y último**,
   así los llamadores que no batchean no se tocan (ago-2026, `items.service.ts`).
   De paso desapareció una tercera consulta —un `SELECT DISTINCT` que solo servía para saber
   *qué* items tenían grupos—: el propio lote ya lo contesta. Cuando batchees, revisá si
   alguna consulta previa existía únicamente para decidir a quién consultar.

**Medir el N+1 en las dos dimensiones, no en una.** Este tenía la forma "una lectura por
línea, dentro de una lectura por origen". Un test que varía solo las líneas pasa en verde
con el bucle por origen intacto: lo comprobamos midiendo el mutante, que sobrevivió. El
test cuenta lecturas variando **cada** dimensión por separado y las dos juntas.

**No todo bucle con `await` es un N+1.** Son tres cosas distintas y confundirlas costó dos
falsos positivos en la auditoría de jul-2026. Antes de tocar un bucle, clasificarlo:

| Forma | Qué es | Qué se hace |
|---|---|---|
| Una **query por fila** para derivar un dato | El N+1 de arriba | Sale siempre: `JOIN`, agregación o `= ANY($1)` |
| **N filas que hay que escribir** | No es un defecto de diseño: son N filas | Se batchea — un `save` con el array, no un `await` por fila |
| Escrituras con **orden de lock deliberado** | El orden ES la protección | **No se toca** sin analizar dónde se decide el lock (ver abajo) |

La segunda no es la misma falta que la primera, pero vale arreglarla igual: en
`crearEnTransaccion` las tres tablas de reglas se escribían con un `await save()` por traza
**en serie**, sobre un resultado que ya estaba entero en memoria (ago-2026, `a149e621`). La
tercera es el bucle de movimientos de inventario de esa misma función, y batchearlo
cambiaría la semántica de deadlock.

Un batch de escrituras **no puede mover ningún número**: mismas filas, mismos montos, misma
atribución, mismo orden. Se fija con un test que afirma sobre el array que recibe el `save`,
no sobre el resultado de la venta — que es idéntico antes y después.

### ❌ Tomar `FOR UPDATE` en un orden que decide el cliente (o el heap)

Dos transacciones que bloquean las mismas filas en orden distinto se esperan en cruz y
Postgres mata a una: la venta se cae con un error opaco, sin corrupción pero sin
explicación. El orden de bloqueo tiene que ser **una propiedad del sistema, no del
payload**.

```ts
// MAL — el orden lo pone el cliente al armar el carrito
for (const linea of dto.lineas) await registrarMovimiento(linea.itemId)
// MAL — el orden lo pone el heap de Postgres, y cambia solo con cada UPDATE
`SELECT ingrediente_item_id FROM receta_ingredientes WHERE receta_item_id = $1`
// BIEN — orden fijo por id, en la query y en memoria
`… WHERE receta_item_id = $1 ORDER BY ingrediente_item_id`
opciones.sort((a, b) => a.itemId.localeCompare(b.itemId))
```

**Este reapareció cuatro veces en el mismo camino de venta** (jul-2026), y ahí está la
lección: se arregló en `ventas.service.ts` (`ordenLocks`, orden de las líneas) y quedó
vivo **un nivel adentro**, en los ids expandidos que ese fix no ve — ingredientes de la
receta, componentes del combo, opciones de grupo (orden del snapshot) y extras del
snapshot concatenados detrás de una lista ya ordenada. Al arreglar un orden de bloqueo,
preguntar **qué se bloquea después de eso**: casi siempre hay una expansión más abajo.

Ordenar cada nivel **no cierra el ciclo global**: el orden resultante es *(orden de
línea) × (orden dentro de la línea)*, que no es ascendente global. Contraejemplo: A vende
`RecetaX(ing3, ing5)` → bloquea 3→5; B vende `[RecetaY(ing5), RecetaZ(ing3)]` → bloquea
5→3. Por eso el cierre real es **reintentar ante `40P01`**, que además cubre los ciclos
que nadie enumeró; el orden determinista reduce la frecuencia. Reintentar es seguro
porque el deadlock aborta la transacción entera —Postgres revierte todo antes de devolver
el error—, así que no hay nada que deduplicar. Solo `40P01`: reintentar un error de
negocio lo convierte en tres intentos silenciosos.

**Variante: el ciclo no es entre filas de una tabla, sino entre dos tablas.** Ordenar por
id no lo cubre — no hay un id que comparar. Pasó al cerrar la carrera de
`item_receta.costo_actual` (jul-2026): el `FOR UPDATE` se puso pegado a la lectura que
protege, sin mirar que en `update()` esa lectura ocurre **después** del `UPDATE items`.

```ts
// MAL — cada método toma los dos locks en el orden que le queda cómodo
update():          UPDATE items …            → SELECT item_receta FOR UPDATE
aplicarDesfases(): SELECT item_receta FOR UPDATE → UPDATE items SET precio_base
// BIEN — un orden entre tablas, igual en los dos caminos
update():          SELECT item_receta FOR UPDATE → UPDATE items …
```

Se dispara con un uso normal (un PATCH de receta con nombre + ingredientes contra un
"aplicar desfase con actualizar precio"), y no lo caza ningún test: los unit corren con un
solo manager mockeado y el e2e es secuencial. Lo cazó la revisión independiente.

**Regla:** agregar un `FOR UPDATE` **no es un cambio local**. Antes de ponerlo, listar qué
otros locks toma ese método —incluidos los implícitos de cada `UPDATE`— y en qué orden, y
cruzarlo con los demás métodos que tocan esas mismas tablas. La pregunta no es "¿qué
protege esta línea?" sino "¿en qué orden quedan **todos** los locks de este camino?".

### ✅ Llamada repo-bound adentro de una transacción — deadlock del pool — AUTOMATIZADO

Ya no es posible **por construcción**, no solo detectado. Hasta el 2026-08-18 este era el
riesgo #1 abierto del repo: adentro de un `dataSource.transaction`, una llamada que usara
el repositorio inyectado en vez del `manager` pedía una **segunda conexión del mismo pool**
mientras la transacción retenía la primera. Con tantas requests en vuelo como tamaño
tuviera el pool, todas retenían una conexión y esperaban una segunda que solo otra de ellas
podría soltar — **deadlock permanente**, no un timeout: no hay ciclo de locks de fila, así
que `deadlock_timeout` nunca dispara y Postgres no aborta a nadie. La API entera moría hasta
reiniciar el contenedor. Se reintrodujo en código nuevo el 2026-08-15 (`auth.service.ts` →
`refresh`), cuatro días después de documentarse la primera vez: documentar la causa no
bastó para evitar que volviera a pasar.

`TxContext` + la fachada `Db` + los repos como proxies context-aware
(`backend/src/common/db/`) cierran el mecanismo por construcción: un repositorio inyectado
resuelve **solo** el manager de la transacción activa, sin que el service lo enhebre a
mano. Ya no existe "llamar sin pasar el manager" — no hay manager que pasar. Una familia de
reglas de lint (`no-restricted-syntax`, `eslint.config.mjs`) cierra el chokepoint de
**inyección**: prohíbe `DataSource` directo fuera de la fachada, el seeder y `*.spec.ts`, y prohíbe
registrar repos con `TypeOrmModule.forFeature` en vez de `RepositoriosModule.forFeature`
(el registro es la otra mitad de la precondición — sin él, un módulo entero queda con repos
del pool aunque nadie inyecte `DataSource`). El experimento que midió el umbral (9 ok / 10
cuelga), la reincidencia y las alternativas descartadas antes de esta solución están en
[ADR-020](../adr/020-contexto-transaccional-als.md) y su cierre en
[`resueltos.md`](resueltos.md).

⚠️ **La cobertura del lint tiene límites propios, declarados en detalle en
[ADR-020](../adr/020-contexto-transaccional-als.md) § Límites conocidos:** es
*name-based* (un alias de importación como `DataSource as DS` lo esquiva, y lo mismo un
alias/namespace/acceso computado sobre `TypeOrmModule`) y ataca el chokepoint de
inyección/registro, no cada uso — un `DataSource` recibido por parámetro de una función
libre (fuera de DI de Nest) queda fuera por diseño: no pasa por el constructor que
resuelven los selectores, recibe el valor a mano desde quien la llama. **Cero instancias
del alias — dos reales de la función libre**, y son las que el propio ADR nombra:
`common/utils/nombre-sugerido.util.ts:188` (`ds: DataSource | Db`) y
`common/utils/rango-fecha.util.ts:79` (`db: DataSource | EntityManager | Db`). No son un
agujero nuevo: siguen protegidas porque quien las llama ya pasó por el chokepoint de
inyección (le entrega `Db`, no `DataSource`, salvo que decida lo contrario) — el límite es
que el lint no puede *forzar* esa elección en un parámetro de función libre como sí la
fuerza en un constructor.

Lo que sobrevive de este riesgo, y que el proxy no cierra, son dos vueltas de tuerca del
mismo mecanismo: guardar la referencia a un método de repo y llamarla después (el contexto
se pierde de más), y leer un `manager?` opcional como si omitirlo significara "fuera de la
transacción" (el contexto se aplica de más). Las dos entradas siguientes.

### ❌ Suponer qué conexión resuelve el repo proxy — dos caras del mismo error

Las dos salen de creer que se sabe qué conexión usa un repositorio inyectado. El proxy
context-aware de ADR-020 resuelve **en el acceso a la propiedad** y **contra la transacción
ambiente del contexto ALS**: quien no tiene esas dos cosas presentes se equivoca en
direcciones opuestas —una se queda con el pool creyendo estar en la transacción, la otra se
queda en la transacción creyendo estar afuera— y las dos reabren algo que el proxy había
cerrado.

**(a) Guardar una referencia a un método de repo y llamarla después.**

```ts
// MAL — el proxy resuelve el manager EN EL ACCESO A LA PROPIEDAD (`repo.find`), no en
// la invocación (`find(...)`). Guardar la referencia fuera de una transacción la
// congela con el repo del pool; llamarla adentro de una transacción usa ese repo
// congelado, no el de la transacción.
const find = this.itemsRepo.find;
await this.db.transaccion(async () => {
  const items = await find({ where: { tenantId } }); // repo del POOL, no de la tx
});

// BIEN — acceder a la propiedad DENTRO del contexto en que se usa
await this.db.transaccion(async () => {
  const items = await this.itemsRepo.find({ where: { tenantId } }); // repo de la tx
});
```

Reabre exactamente el deadlock del pool que el proxy de repos (entrada anterior, ADR-020)
cierra por construcción: la operación queda usando una conexión del pool mientras la
transacción que la envuelve retiene otra, dos conexiones a la vez. El proxy
(`backend/src/common/db/repositorios.module.ts`) resuelve `TxContext.managerActivo()` en
cada `get` de una propiedad — si la referencia se cachea antes de ese acceso (fuera de la
transacción, o en una transacción distinta), el manager que quedó atado es el de ese
momento, no el de cuando se invoca.

**Verificado el 2026-08-18, en la revisión de la Task 4: cero ocurrencias hoy** en
`backend/src` (tres greps distintos sobre el patrón `= this.<x>Repo.<método>` sin invocar).
Por eso esta entrada es prevención, no un arreglo — el patrón nunca se cometió en este
repo, pero el proxy lo hace posible y no hay ningún lint que lo cace (el `Proxy` es
indistinguible de un repo real para un analizador estático).

**(b) Omitir un `manager?` opcional creyendo que eso corre fuera de la transacción.**

```ts
// El idioma, en 8 sitios del repo (transacciones/tokens-acceso/propina-distribucion):
const repo = manager ? manager.getRepository(X) : this.repo;

// MAL — el llamador quiere que el rastro sobreviva al rollback y omite el manager
// creyendo que así toma una conexión propia. `this.repo` es el proxy context-aware:
// sin manager resuelve la transacción AMBIENTE del contexto ALS, así que el rollback
// se lleva puesta la fila de auditoría — justo lo contrario de lo que se pidió.
await this.db.transaccion(async (manager) => {
  await this.pasarela.cobrar(...);            // falla y hace rollback
  await this.transacciones.registrar(datos);  // sin manager → MISMA transacción
});

// BIEN — pedir el afuera explícitamente
await this.db.transaccion(async (manager) => {
  await this.pasarela.cobrar(...);
  await this.db.sinTransaccion(() => this.transacciones.registrar(datos));
});
```

**El contrato se dio vuelta y el código no cambió.** Antes de ADR-020 la rama `else` de ese
idioma era literalmente una conexión propia del pool —por eso existía: la auditoría de un
reembolso con timeout tenía que sobrevivir al rollback—. Con los repos convertidos en
proxies context-aware, `this.repo` pasó a ser "la transacción que haya en contexto". El
parámetro sigue ahí, con la misma firma y la misma pinta, significando lo contrario.

Gemelo exacto de la entrada anterior, por la puerta opuesta: allá el contexto se pierde de
más (referencia cacheada), acá se conserva de más. Ninguna de las dos la ve un lint, por el
mismo motivo — el `Proxy` es indistinguible de un repo real para un analizador estático.

**Verificado el 2026-08-19: cero llamadores vivos que dependan de esto.** El único caso real
(`cobros.service.ts`, el `catch` del timeout de reembolso) ya quedó *léxicamente* fuera del
callback de `db.transaccion`, así que el ALS lo deja solo en el pool sin pedirlo. La entrada
es prevención para el llamador siguiente, no un arreglo. Los tres archivos con el idioma llevan la
nota, cada uno declarando que vale para todas sus apariciones; la regla general
está en `docs/patterns/backend.md` §9.

### ❌ Campo que escribe estado derivado sin pasar por su choke point

`item_producto.costo_actual` y `item_producto.stock` son valores derivados del kardex
(`costo_actual`: promedio ponderado móvil, ver
[ADR-016](../adr/016-costeo-promedio-ponderado-movil.md); `stock`: saldo materializado de
`movimientos_inventario`) — su única puerta legítima es
`InventarioService.registrarMovimiento`. `PATCH /items/:id` aceptaba `dto.costo` y
después, por el mismo motivo, `dto.stock`, y los escribía directo en la columna, sin
generar ningún movimiento de inventario: el número quedaba corrompido sin rastro de quién
lo cambió ni por qué. Para `stock` pesaba más todavía: la feature de
[recuento de inventario](../features/recuento-inventario.md) existe precisamente para
reemplazar el seteo absoluto por una sesión auditada con causa tipificada, y este camino
la saltaba entera desde el formulario de item.

```ts
// MAL — escribe el campo derivado directo, sin movimiento de inventario
if (dto.costo !== undefined) {
  await repo.update(id, { costoActual: dto.costo });
}
if (dto.stock !== undefined) {
  await repo.update(id, { stock: dto.stock });
}

// BIEN — el campo se rechaza siempre, con un validador que siempre falla
@ValidatorConstraint({ name: 'costoNoEditable', async: false })
class CostoNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean { return false; }
  defaultMessage(): string {
    return 'El costo no se edita desde el item: usá Inventario → Ajuste de costo';
  }
}
@ValidatorConstraint({ name: 'stockNoEditable', async: false })
class StockNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean { return false; }
  defaultMessage(): string {
    return 'El stock no se edita desde el item: usá PATCH /items/:id/stock (ajuste con motivo) o un recuento de inventario';
  }
}
// @ValidateIf, no @IsOptional: @IsOptional también saltea la validación cuando
// el valor es `null` explícito, no solo cuando la propiedad falta — dejaría
// pasar `{ "costo": null }`/`{ "stock": null }` con 200. @ValidateIf solo
// saltea si falta.
@ValidateIf((o) => o.costo !== undefined)
@Validate(CostoNoEditableConstraint)
costo?: string;

@ValidateIf((o) => o.stock !== undefined)
@Validate(StockNoEditableConstraint)
stock?: string;
```

**La trampa del `ValidationPipe`:** el pipe global usa `whitelist: true` **sin**
`forbidNonWhitelisted` (`main.ts`). Si la solución es simplemente *borrar* el campo del
DTO, la propiedad no autorizada se **descarta en silencio** — el request devuelve **200**
sin haber cambiado nada, un fallo callado peor que el bug original. Hay que rechazarlo
**explícitamente** con un validador que siempre falla y un mensaje que diga dónde sí
hacerlo; activar `forbidNonWhitelisted` globalmente cambiaría el comportamiento de todos
los endpoints y es una decisión aparte, no el parche de un campo.

**Límite conocido del test de invariante que lo enforca**
(`backend/src/common/invariants/costo-stock-choke-point.invariant.spec.ts`): es una
heurística de texto sobre template literals SQL (busca `costo_actual\s*=\s*\$` y
`stock\s*=\s*\$` fuera de `inventario.service.ts`). **No detectaría** una escritura hecha
vía el `Repository<ItemProducto>` inyectado en `items.service.ts` (hoy sin uso) llamando a
`.save()`/`.update()` con la propiedad camelCase `costoActual`/`stock` — el texto literal
`costo_actual`/`stock` no aparece en un `.ts` que arma el UPDATE vía TypeORM en vez de SQL
crudo. El test frena el patrón de bug real (SQL directo, que es como se rompió antes) y el
copy-paste accidental de ese SQL; no es un parser que entienda TypeORM. Si alguna vez se
usa ese repositorio para escribir en `item_producto`, la revisión de código —no el test—
es quien tiene que atajarlo.

---

## Frontend

### ❌ Mutar y luego recargar la lista completa

```ts
// MAL
await $fetch('/ventas', { method: 'POST', body })
await cargar()

// BIEN
const creada = await $fetch('/ventas', { method: 'POST', body })
ventas.value.unshift(creada)
```

El backend devuelve la entidad o un patch mergeable. Recargar duplica el round-trip,
parpadea la UI y pierde el estado local (scroll, filtros, selección).
Detalle: `docs/patterns/frontend.md`.

### ❌ Leer una respuesta asíncrona sin comprobar que corresponde al estado actual

```ts
// MAL — el carrito cambió, la respuesta guardada es del carrito anterior
watch(lineas, () => { setTimeout(() => { resultado.value = await calcular(...) }, 300) })
// …y el template cruza por índice contra las líneas de AHORA
<AdvertenciasPrecio :advertencias="resultado?.lineas[index]?.advertencias ?? []" />
// …y el modal de cobro pide el total que salió de ahí
@cobrar="cobroOpen = true"

// BIEN — el resultado sabe a qué carrito pertenece
const { resultado, vigente, asegurarVigente } = useResultadoCalculado(() => input())
const calculoVigente = computed(() => vigente.value ? resultado.value : null)
async function abrirCobro() { if (await asegurarVigente()) cobroOpen.value = true }
```

Apareció en los tres carritos a la vez. El bug no es el cruce por índice —ese es el
correcto— sino que **nadie garantizaba que el par índice↔línea siguiera siendo el
mismo**: borrar la primera línea dibujaba su advertencia bajo la segunda, y hacer clic
en Cobrar dentro de la ventana del debounce abría el modal con el total anterior.

La regla general: si un dato se guarda desde un `await` y se cruza con estado que
pudo cambiar mientras tanto, guardar **junto al dato la identidad del estado que lo
produjo**. Un booleano "cargando" no alcanza: hay que poder responder *¿este
resultado es de esto que estoy mirando?*, no solo *¿hay algo en vuelo?*.
Detalle: `docs/patterns/frontend.md` §10.1.

### ✅ Tailwind hardcoded en vez de tokens semánticos — AUTOMATIZADO

```vue
<!-- MAL -->
<p class="text-gray-500 bg-white dark:bg-gray-900">

<!-- BIEN -->
<p class="text-muted bg-default">
```

Rompe el modo oscuro y el theming por tenant. Excepción única: colores financieros
(verde/rojo/azul) en el módulo Caja.
→ *AUTOMATIZADO: `frontend/scripts/check-design-tokens.mjs` (`npm run design:check` en el
gate; `--staged` en el pre-commit) falla si un `.vue` fuera de `app/components/caja/` usa
neutrales hardcodeados (`*-gray-N`, `bg-white/black`, `dark:` sobre neutrales). Los
colores de marca (`bg-primary-*`, `text-white` sobre marca) quedan fuera de alcance.*

### ❌ Función de formato definida dentro de un `.vue`

```ts
// MAL — dentro del componente
const formatMonto = (v: number) => `$${v.toLocaleString()}`

// BIEN
const { formatMonto } = useFormatters()
```

Cada copia local diverge en separadores, decimales y moneda. El formato de monto
depende de la moneda oficial del tenant, así que una copia local es un bug de datos,
no de estilo.

### ❌ Fricciones de `vue-tsc` estricto — cinco caras del mismo error

Eran cinco entradas sueltas hasta el 2026-08-11. Se fusionaron porque son **la misma
lección**: `vue-tsc` estricto rechaza cosas que `nuxt build` acepta, y **el fix es siempre
solo-de-tipo, cero runtime**. Lo cazó `typecheck:ratchet`, nunca el build.

#### `@click` con expresión que devuelve valor (TS2322)

```vue
<!-- MAL — la expresión devuelve el array/boolean → handler no es void (vue-tsc estricto) -->
<UButton @click="form.series = [...form.series, { serie: '', condicion: 'nuevo' }]" />
<UButton @click="form.series = form.series.filter((_, i) => i !== idx)" />

<!-- BIEN — extraer a función nombrada en <script setup> (devuelve void) -->
<UButton @click="addSerie" />
<UButton @click="removeSerie(idx)" />
```
```ts
function addSerie() {
  form.series.push({ serie: '', condicion: 'nuevo', garantiaHasta: '' })
}
function removeSerie(idx: number) {
  form.series.splice(idx, 1)
}
```

Un cierre de modal (`@click="drawerOpen = false"`) también devuelve valor (la asignación
evalúa a `boolean`). Ahí no hace falta función nombrada por un one-liner: arrow inline
`@click="() => { drawerOpen = false }"` (el bloque `{}` sin `return` es `void`) — patrón
ya usado en el repo para handlers de varias sentencias.

`nuxt build` no lo detecta; `typecheck:ratchet` sí. Además saca lógica del template.
Fue el patrón dominante de los errores de tipo del frontend (jul-2026): `items.vue`
solo tenía 38 (16 así + 22 del índice de abajo).

#### Acceso por índice sin guard en el template (TS2532)

```vue
<!-- MAL — con noUncheckedIndexedAccess, form.series[idx] es T | undefined -->
<UInput v-model="form.series[idx].serie" />

<!-- BIEN — el índice viene del mismo v-for, existe: aserción no-nula -->
<UInput v-model="form.series[idx]!.serie" />
```

Convención establecida en el repo para `v-model` sobre índice de un `v-for` de la misma
lista. No usar en accesos donde el índice sí puede no existir — ahí, guard real (`v-if`).

**Variante en `<script>` (TS2322, no TS2532):** el mismo `T | undefined` del índice se
propaga al hacer spread y reasignar la fila tras un `findIndex`:

```ts
// MAL — arr.value[idx] es T | undefined; con `saved` parcial el objeto resultante
// tiene todos los campos opcionales → no asignable a T
const idx = configs.value.findIndex(c => c.id === saved.id)
if (idx >= 0) configs.value[idx] = { ...configs.value[idx], ...saved }

// BIEN — el idx viene de findIndex y está guardado por `idx >= 0`: la fila existe
if (idx >= 0) configs.value[idx] = { ...configs.value[idx]!, ...saved }
```

Aserción no-nula sobre el spread source, no sobre `saved`. Solo aplica cuando `saved`
(el patch) es parcial; si trae el tipo completo, no falla (por eso `items.vue` no lo
tenía). Misma justificación que arriba: el índice existe, no es un acceso dudoso.

Igual criterio para índice/destructuring ya guardado en `<script>`/`.ts` (TS2532/18048):
`parts[1]!` tras `if (parts.length !== 3) return`, `list[0]!` dentro de `length === 1`,
`entero!` del `split('.')` de un `toFixed`, o `v-model="map[k]!.campo"` bajo `v-if="map[k]"`.
El `!` solo donde una guarda previa garantiza la existencia — nunca en el índice dudoso.

#### Estado `string | null` bindeado a prop/`v-model` de Nuxt UI (TS2322)

Los inputs de Nuxt UI aceptan `string | undefined`, no `null`. Un ref de error o un
campo de form tipado `| null` no es asignable:

```vue
<!-- MAL — nombreError es string | null; :error quiere string | boolean | undefined -->
<UFormField :error="nombreError" />
<!-- BIEN (una vía) — coerción ya usada en el repo (AppDateInput.vue) -->
<UFormField :error="nombreError ?? undefined" />
```
```ts
// MAL — v-model de dos vías sobre campo string | null (no se puede coercer inline)
const form = ref({ modo: 'porcentaje' as string | null })
// BIEN — el form nunca guarda null: tiparlo string y coercer al cargar
const form = ref({ modo: 'porcentaje' as string })
function abrirEditar(d: Regla) { form.value = { modo: d.modo ?? '', /* … */ } }
```

`?? ''` al cargar es el mismo patrón ya usado en el repo para tramos (desde el 2026-08-24, `t.minimoCantidad ?? t.minimoMonto ?? ''`).
Antes de aplicarlo verificar que el `null` no viaje al payload: en `descuentos`/`recargos`
el campo solo se manda cuando `cfg` lo habilita, y ahí el valor siempre es un string real,
así que la coerción es payload-neutral. Si el `null` sí llegara al body, es decisión de
negocio (limpiar vs omitir) — preguntar.

#### Mismatch de tipos con handlers/props de Nuxt UI · reka (TS2322/2345/2459)

Casos puntuales de vue-tsc estricto contra los tipos de `@nuxt/ui`/`reka-ui`. Todos con
fix **solo-de-tipo, cero runtime**:

- **Param del handler más estrecho que el emit** — `@update:model-value="(v: Criterio) => f(v)"`
  falla si el componente emite `string`. Ensanchar el param al tipo emitido y castear
  dentro: `(v: string) => f(v as Criterio)`.
- **`$event` de `USwitch`/`UCheckbox`** es `string | boolean` (por `indeterminate`).
  Si el handler quiere `boolean`: `f(id, $event as boolean)`.
- **Forma de `DateRange`** (reka) es `{ start: DateValue | undefined; end: DateValue | undefined }`.
  Un handler que declara `{ start: DateValue; end: DateValue }` no acepta el emit → alinear
  con `| undefined`.
- **Tipo no exportado por el subpath** — `MaskaDetail` no se exporta desde `maska/vue`
  pero sí desde `maska`. Importar el tipo desde la raíz: `import type { MaskaDetail } from 'maska'`.
- **Prop que no modela `style`** — el `content` de `UDrawer` (`DialogContentProps`) no
  declara `style` aunque reka lo reenvía en runtime. Castear a `DrawerProps['content']`
  (importado de `@nuxt/ui`, dep directa — nunca de `reka-ui` transitivo).

#### Tipado estricto en unit tests (vitest) — TS2321/2347/2532/2554

Al entrar los `.spec.ts` bajo vue-tsc estricto salieron cuatro fricciones, todas
solo-de-tipo:

- **Middleware Nuxt tipa `(to, from)`** — llamarlo con un solo arg en el test da TS2554.
  Pasar ambos (el middleware ignora `from`): `authMiddleware(ctx, ctx)`.
- **`require('vue')` es `any`** → `ref<T>(...)` da TS2347. Castear el require:
  `const { ref } = require('vue') as typeof import('vue')`.
- **`$fetch` global (rutas tipadas de Nuxt)** dispara TS2321 (recursión) en `vi.mocked`.
  Alias plano una vez: `const $fetchMock = vi.mocked($fetch as unknown as (...a: unknown[]) => Promise<unknown>)`.
- **Índice tras `expect(x).toHaveLength(n)`** sigue siendo `T | undefined` → `x[0]!.campo`
  (misma convención `!` del índice guardado).

### ❌ Dependencia nueva sin `optimizeDeps.include` en `nuxt.config.ts`

```ts
// Al importar un paquete nuevo (sobre todo CJS) desde un composable/componente,
// Vite lo descubre en runtime y fuerza un reload de página:
//   ℹ Vite discovered new dependencies at runtime: qz-tray ← ./app/composables/useImpresoras.ts

// BIEN — registrarlo en el pre-bundle en el mismo cambio que lo agrega
vite: {
  optimizeDeps: {
    include: ['@internationalized/date', 'decimal.js', 'maska/vue', 'qz-tray'],
  },
},
```

Si no se pre-bundlea, el dev server recarga la página la primera vez que se ejecuta
la ruta que lo importa (peor con paquetes CJS). Al `npm install` de una dependencia
nueva de runtime, sumarla a `include` en el mismo commit — no esperar a ver el warning.

### ❌ Control con permiso propio anidado bajo el `v-if` de otro permiso

```vue
<!-- MAL — "Aplicar" hereda el gate de readOnly, que es el permiso de CONTAR -->
<div v-if="!readOnly">
  <UButton @click="cancelar">Cancelar recuento</UButton>
  <UButton v-if="puedeAplicar">Aplicar</UButton>
</div>

<!-- BIEN — cada control con el permiso que exige SU endpoint -->
<div v-if="esBorrador && (puedeContar || puedeAplicar)">
  <UButton v-if="puedeContar" @click="cancelar">Cancelar recuento</UButton>
  <UButton v-if="puedeAplicar">Aplicar</UButton>
</div>
```

`readOnly` incluye `!puedeContar` (`Inventario/Crear`), pero aplicar exige
`Inventario/Actualizar`. Anidado, el rol aprobador —`Leer` + `Actualizar`, sin `Crear`—
se quedaba sin la acción que le corresponde, rompiendo la asimetría que el diseño existe
para sostener. Los dos computeds eran correctos por separado: el defecto vivía en el
anidamiento, así que ningún unit test de la lógica lo habría visto. Regla completa y
trampa: `docs/patterns/frontend.md` §1.1.

## Pruebas (unit)

### ❌ Test verde que no ejerce lo que dice probar

Cinco caras del mismo error, **ninguna descubierta leyendo el test**: cuatro apagando el fix a
mano, y la quinta —**(e)**— porque el bug volvió estando el test verde. Si con el fix apagado
sigue verde, no prueba lo que dice: son treinta segundos y es lo primero que hay que correr.

⚠️ **Pero apagar el fix no alcanza, y (e) es el contraejemplo:** ese test **moría** con el fix
apagado y aun así no probaba nada. El mutante confirma que el test *toca* el fix; no confirma
que mire **el efecto** del fix. Cuando la aserción es sobre la llamada, las dos cosas se
separan.

**(a) El mock ya trae la respuesta**, así que el branch del título nunca se ejerce.

```ts
// MAL — el branch que el título promete ("referenciado solo por un recuento") no corre
queryMock.mockResolvedValueOnce([{ existe: true }])
expect(sql).toContain('recuento_inventario_linea') // sobrevive aunque el WHERE esté roto

// BIEN — en unit, sólo lo que el mock NO decide…
expect(queryMock).toHaveBeenCalledTimes(2) // una query, no tres: sin N+1
// …y el branch real, contra la BD, en el e2e.
```

⚠️ **La variante peor: el mock precocina la condición que el código debería garantizar.**
(ago-2026, `refresh`) El test fijaba `reemplazadoPor: 'rt-nueva'` en la fila mockeada, o sea
daba por resuelto **el ordenamiento que fallaba**. El mutante "no escribir el puntero" moría
—el test sí probaba que se escribe— pero nadie probaba que se escribiera **a tiempo**, que
era la propiedad real. En producción el caso feliz ocurría 1 de cada 8 veces. Un mock que
establece un estado que el código tiene que producir convierte al test en una tautología.

**(b) Otra regla dispara antes** que la que se quería cubrir.

```ts
// MAL — "rechaza el método de pago no contratado": 400 verde… emitido por la regla del
// vuelto, porque 10000 supera el total de 5950. El gate del método nunca corrió.
// MAL — "rechaza un garzón de otro tenant" con un UUID inexistente: pasa por
// "garzón no encontrado" sin tocar el chequeo de tenant.
```

**(c) El fixture no puede aislar el criterio.** Con **dos** elementos, el ganador es a la vez
"el último", "el de id mayor" y "el de monto mayor": el test no distingue entre las tres
heurísticas. Hacen falta **tres**, con el caso correcto en el **medio** de cada dimensión que
podría confundirse. Y para una *elección* entre candidatos, un mutante no alcanza: hay que
enumerar todas las heurísticas alternativas que el fixture no descarta y correr una por cada
una.

**(d) La aserción no puede fallar**, porque lo que busca no puede aparecer.

```ts
// MAL — el servicio nunca emite ese SQL: todo el stock se mueve por
// registrarMovimiento, que en esta suite está mockeado.
const tocaStock = manager.query.mock.calls.find((c) =>
  String(c[0]).includes('UPDATE item_producto'),
)
expect(tocaStock).toBeUndefined()

// BIEN — asertar sobre el colaborador que haría el trabajo
expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled()
```

La misma aserción pasaba en verde sobre `aplicar()`, que **sí** mueve stock: buscaba un
string que el código bajo prueba no puede producir. Antes de asertar la ausencia de algo,
verificar que ese algo podría aparecer si el bug existiera.

**(e) La aserción mira la LLAMADA, no el estado que la llamada tenía que producir.** (Salió del
harness e2e, pero la forma no depende de eso.) Un espía prueba que pediste algo; no prueba que
haya pasado. Si entre el llamado y el efecto hay asincronía, el test queda verde con el sistema
roto — y encima **tapa** el bug, porque el próximo que lo lea va a creer que ese frente tiene
red.

```ts
// MAL — el `401` fantasma del e2e (ago-2026). El arreglo llamaba
// `app.listen(0, '127.0.0.1')`; el test afirmaba el llamado.
expect(espia).toHaveBeenCalledWith(0, '127.0.0.1')

// BIEN — afirmar el estado resultante
expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
```

`listen` con host resuelve por `dns.lookup` y **bindea asincrónicamente**: para cuando el
handle existía, supertest ya había bindeado el wildcard en el mismo tick y ganado. El llamado
siempre ocurrió; el bind nunca. El test estuvo verde los dos días que el arreglo no funcionó,
y el síntoma reapareció en cuatro specs distintos sin que nada se pusiera rojo.

⛔ **Y el mutante no lo habría salvado.** Sacando el parche, el espía veía `listen(0)` a secas
y el test se ponía rojo: la receta de "apagar el fix" daba verde-rojo correcto sobre un test
que no probaba nada. Lo que no se descubrió fue **por qué** se ponía rojo — porque cambiaba la
llamada, no porque cambiara el bind. De ahí la regla de arriba: leer qué afirma la aserción,
no solo si muere.

⚠️ **El olor a buscar:** el sujeto de la aserción es un espía, un mock o un contador, y el
título del test habla de un **resultado**. Si el título dice "queda atado a", "termina en",
"se guarda", "quedó cerrado" —un estado— y la aserción dice `toHaveBeenCalledWith`, no son la
misma afirmación. Preguntar qué API de abajo hace el trabajo y si es síncrona: cuando no lo
es, entre la llamada y el estado hay una carrera que el espía no puede ver.

**Regla:** construir el escenario de modo que **la regla bajo prueba sea la única que puede
fallar**, y aseverar el mensaje, no sólo el status. Dos tests con títulos distintos y setup
idéntico son un solo test.

### ❌ Leer el número de un mutante sin leer por qué murió

Un mutante da un número —cuántos tests se pusieron rojos— y ese número miente de tres
formas distintas. **Medirlo no alcanza: hay que leer el mensaje de cada fallo.**

**(a) Murió por `TypeError`, no por la aserción.**

```ts
// El test dice "rechaza propina negativa". Con el mutante puesto pasa de largo, sigue
// hasta `crearEnTransaccion` —que el mock deja en `undefined`— y muere en `.id`.
//   Received message: "Cannot read properties of undefined (reading 'id')"   ← falso rojo
//   Received promise resolved instead of rejected                            ← la propiedad
```

Da un **falso verde de cobertura**: el día que alguien complete ese mock, el test deja de
discriminar y nada avisa. El arreglo es que el camino feliz pueda completarse, y va **local
al test que lo necesita, no como default del harness**: con `manager.query` resolviendo `[]`
por default, el mutante que borra `getMesaOrThrow` pasó de cazado a **sobreviviente**, porque
un `if (!locked.length) throw` de más abajo tira la misma excepción. Un default de harness
apaga como red incidental todos los `if (!rows.length)` del service.

**(b) Mató más tests de los que su alcance explica** — y eso *es* el hallazgo. (2026-08-07)
Un mutante mató 2: el legítimo y uno sin relación. La causa era aislamiento, no cobertura —
los tests hacían `wrapper.unmount()` al final del cuerpo, así que el primero en fallar dejaba
diálogos viejos en `document.body`. Con `afterEach` da 1. **Si un test lee `document.body`
—modal, drawer, tooltip—, el desmontaje va en `afterEach`.** Primero se arregla el
aislamiento, después se leen los mutantes.

**(c) Murió, pero probando una propiedad más débil que la del título.** (ago-2026, `refresh`)
El mutante "no escribir el puntero" moría, o sea que el test sí probaba que se escribe —
pero la propiedad real era que se escribiera **a tiempo**, y de eso no había cobertura. Ver
*Test verde que no ejerce lo que dice probar*, variante (a).

⚠️ **Y el mutante mismo puede estar mal aplicado.** Un `perl -0pi -e "s/…/…/"` **sin `/g`**
reemplaza la primera ocurrencia, que puede estar **en el docblock** en vez del código: dio
un falso "test decorativo" sobre un test que era bueno. Verificar siempre que el fuente
mutado sea el que se cree — y, con el watcher de Docker corriendo, que el proceso haya
tomado el revert y no sólo el archivo.

### ❌ Rotular "medido" algo que no se midió

La familia de arriba trata mutantes que mueren mal. Esta es la anterior en la cadena:
**la medición que nunca ocurrió y aun así se escribió como hecho.** Dos casos reales del
mismo día (ago-2026), los dos cazados por la revisión independiente y ninguno por el gate:

1. **Conclusión sacada de un experimento con dos variables cambiadas a la vez.** Un test
   de página fallaba; cambié el método de click *y* una opción de montaje, funcionó, y le
   atribuí el resultado al click. De ahí salió una regla general —"un `click()` nativo no
   dispara el handler de Vue sobre nodos teletransportados"— que era **falsa**, y que
   además contradecía a un spec del propio repo que venía haciendo exactamente eso.
2. **Celda de una tabla completada de memoria porque el script murió antes de imprimirla.**
   El probe crasheó con `RangeError` armando la línea de log del último caso; puse el
   resultado "obvio" en la tabla. El validador hacía lo contrario.

Por qué importa más que un comentario equivocado: en este repo esas afirmaciones migran.
`pendientes.md` se copia a `resueltos.md` al cerrar, y `resueltos.md` es **el archivo de lo
medido**; una regla falsa archivada ahí dirige mal el trabajo siguiente y pisa la
advertencia verdadera —y más angosta— que ya existía.

**Las tres reglas, en orden de lo barato que sale aplicarlas:**

- Una variable por experimento. Si cambiaste dos cosas y funcionó, todavía no sabés cuál.
- Si el script murió, la corrida **no vale**: ninguna línea, ni las que alcanzó a imprimir
  antes. Arreglar el script y correrlo de nuevo cuesta menos que el bloqueo.
- Antes de escribir una regla general, buscar el contraejemplo **dentro del repo**. En el
  caso 1 estaba a un `grep` de distancia.

Y cuando la afirmación falsa ya circuló: **anotarla como refutada, no borrarla en
silencio** — el lector que la vio necesita el desmentido, no un hueco.

### ❌ Cambiar un vocabulario compartido y actualizar solo los consumidores del módulo que tenés delante

Un valor de un enum, un motivo del kardex, un estado: viven en **más lugares que su
módulo**. Pasó dos veces en jul-2026, las dos con el mismo síntoma —el gate completo en
verde y la feature rota— y las dos las cazó la revisión independiente, no un test.

```
// Sacar `borrador` de EstadoVenta: se limpiaron pages/ventas y components/ventas…
// …y quedó vivo en pages/pagos/index.vue, que ofrecía el filtro y recibía 400.

// Agregar el motivo `anulacion` al kardex: se escribía bien, pero
// find-movimientos.dto.ts seguía con el whitelist viejo (@IsIn) →
// GET /inventario/movimientos?motivo=anulacion respondía 400.
```

**Antes de tocar un valor compartido, greapear el repo ENTERO** (no la carpeta del
módulo) y clasificar cada consumidor en dos grupos, porque no todos van:

- **Lectura** (filtros, whitelists de query, desplegables de consulta, mapas de
  color/etiqueta) → casi siempre hay que actualizarlos.
- **Escritura** (DTOs de creación manual, selectores de formulario) → a veces el valor
  nuevo **no corresponde**: `anulacion` no va en el ajuste manual de stock, porque nadie
  la elige a mano — la genera el flujo.

Un valor nuevo que se escribe pero no se puede consultar deja media feature invisible, y
la doc del mismo commit suele afirmar que funciona.

### ❌ Escribir un conteo en la doc y después agregar un test

**Qué pasó (2026-08-25, CUATRO veces en el mismo frente).** Un docblock decía *"los dos tests
son necesarios"* y había tres. Una tabla test↔mutante decía *"cada mutante mata solo a uno"* y
uno mataba dos. Un bullet de `resueltos.md` decía *"los tres tests, espejados"* con cuatro
escritos, y después *"los ocho casos"* con nueve. Las cuatro las cazó la revisión independiente
midiendo; ninguna se cayó por releerla.

**La causa no es descuido, es orden de operaciones.** El número se escribe cuando la afirmación
es cierta, y después se agrega un test —muchas veces *porque la revisión lo pidió*— y nadie
vuelve al párrafo. **Agregar una fila a la tabla no es volver a medirla.**

```markdown
❌ Los ocho casos: A, B, C…            ← envejece con el próximo `it`
❌ Los tres tests son necesarios        ← ídem
✅ Cubre: A · B · C · D…                ← la enumeración ES el conteo
✅ (si el número importa) medilo en el momento de escribirlo, con un comando
```

**Por qué duele más en `resueltos.md`.** Es archivo: nadie vuelve a medirlo. Un conteo falso
queda congelado y el próximo agente lo cita como evidencia — o peor, borra un test creyéndolo
redundante porque la tabla dice que otro lo cubre.

📌 **Corolario para las tablas de mutantes:** son la evidencia que autoriza a conservar o borrar
un test, así que envejecen peor que un comentario cualquiera. Si tocás el bloque de tests, se
vuelven a correr los mutantes o se saca la tabla.

### ❌ Leer el resultado de un test suite sin mirar el exit code

**Qué pasó (2026-08-07).** Cerrando la ronda de decisiones reporté el gate del frontend en
verde citando `Test Files 57 passed / Tests 619 passed`. El comando había salido con
**exit 1**: 4 *unhandled rejections* que vitest cuenta aparte, bajo `Errors`, y que no
aparecen en la línea de `Tests`. Grepear `"Tests "` filtraba justo la evidencia. Lo cazó la
revisión independiente.

```bash
# ❌ la línea dice "passed" y el comando falló
npm test 2>&1 | grep -E "Tests "

# ✅ el exit code es el veredicto; la línea es un resumen
npm test; echo "EXIT: $?"
```

**Por qué importa acá.** El gate de `CLAUDE.md` dice *"Ejecutar, no afirmar"*, y CI corre el
mismo comando: un exit 1 rompe el push aunque ningún test esté en rojo. El resumen humano de
una herramienta **no es** su valor de retorno.

⚠️ **Volvió a pasar el 2026-08-25, y esa vez la causa fue un test NUEVO**, no un arrastre:
un caso que cerraba el drawer con "Cancelar" disparaba la animación de salida de Reka UI
(`usePresence`) y jsdom tiraba `TypeError: Receiver must be an instance of class
CSSStyleDeclaration` como **rechazo no capturado**. La suite decía `839 passed` y salía en
**1**. Dos cosas que dejó:

- **Cerrar un overlay en un test de jsdom no es gratis.** Si el camino que necesitás pasa
  igual por el código que querés cubrir, elegí el que no anima: acá `abrirCrear` llamaba a
  `resetDrawer` igual que cerrar, y el mutante caía lo mismo.
- **El exit code lo cazó en el gate, no en la corrida del spec suelto.** Correr solo el
  archivo tocado daba verde y exit 0; el rechazo aparecía con la suite completa.

## Pruebas E2E de navegador

*(Sección a poblar cuando exista la suite. Entradas previstas según el diseño acordado:
esperas fijas en lugar de aserciones web-first, tests que dependen del estado dejado
por otro test, y aserciones de montos copiadas de la salida del código en vez de
derivadas de `docs/features/`. No se documentan aquí hasta que ocurran de verdad.)*
