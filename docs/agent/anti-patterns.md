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

   *Aplicado por tercera vez el 2026-09-19, desde 24: **cuatro fusiones y ningún borrado**, otra
   vez sin perder una línea. Se juntaron el id sin validar con el frente cerrado barriendo un
   solo mecanismo (eran del mismo día y del mismo bug, y la segunda lo decía en su primera
   frase); las dos formas de romper el aislamiento multi-tenant —el `tenant_id` que entra del
   cliente y la clave que no lo tiene—; `Decimal` con el lugar del redondeo, que ya abría
   diciendo que la primera no alcanza; y las tres de afirmar sin medir —nunca se midió, se
   midió y envejeció, se leyó el resumen en vez del exit code—. El patrón que motivó la pasada
   —fecha local armada con `toISOString()`— **nació `✅`**, no `❌`: se escribió
   `frontend/app/invariants/fecha-local.invariant.spec.ts` en el mismo commit, así que no
   consume tope. Quedó en **19 ❌**.*

   ⚠️ **Lo que NO se pudo hacer esta vez, y también parecía la salida obvia:** pasar las
   fricciones de `vue-tsc` estricto a `✅` por `typecheck:ratchet`. El ratchet **no detecta el
   patrón**, detecta que el conteo por archivo no suba, y su propio encabezado declara el
   hueco: *"si en un mismo archivo se corrige un error y se introduce otro (neto 0), no lo
   detecta"*. Además lo que la entrada enseña es **el arreglo** de cada fricción, que ningún
   gate provee. Mismo criterio que la nota de abajo: la regla 2 pide que el patrón esté
   cerrado, no que haya un comando que se ponga rojo a veces.

   ⚠️ **Lo que NO se pudo hacer, y conviene decirlo porque parecía la salida obvia:** pasar
   "campo que escribe estado derivado sin pasar por su choke point" a `✅` por su test de
   invariante. **La propia entrada documenta un hueco** —el test es una heurística de texto
   sobre SQL crudo y no vería una escritura vía el repositorio de TypeORM con la propiedad
   camelCase—, así que marcarla como automatizada sería sobreafirmar. La regla 2 pide que el
   patrón esté cerrado, no que tenga un test que cubre la mitad por la que se rompió.
4. Formato fijo: qué pasó → ❌ mal → ✅ bien → una línea de porqué.
5. **Presupuesto: 30 líneas por entrada.** Puesto el 2026-09-19, cuando el owner midió que 24
   entradas ocupaban 1.205 líneas —41 de promedio, 15 por encima de 30— o sea que la mitad del
   archivo no cumplía su propia regla 4. El excedente **no se borra**: se muda a
   [`resueltos.md`](resueltos.md) § *Detalle movido desde `anti-patterns.md`*, que es el archivo
   de la historia, y la entrada queda con el enlace. La poda llevó el archivo de 1.298 a 662
   líneas sin perder una lección.

   📌 **El tope de entradas y el presupuesto de líneas son dos cosas distintas, y la regla 3
   sólo aprieta la primera.** Fusionar "sin perder una línea" deja el conteo de entradas bien y
   el largo igual o peor: la consolidación del 2026-09-19 bajó de 24 a 20 entradas y **subió** el
   archivo de 1.205 a 1.298 líneas. Por eso hacen falta las dos reglas.

---

## Índice

Una línea por entrada. **Es un atajo, no la fuente**: la lección vive en la entrada, no acá.
Se regenera con `grep -n "^### " docs/agent/anti-patterns.md`, que es también cómo se verifica
que no haya envejecido.

**Backend** — ✅ columna UUID sin `type: 'uuid'` · ❌ id sin validar, y el frente cerrado
barriendo un solo mecanismo · ✅ columna de fecha sin `timestamptz` · ❌ aislamiento
multi-tenant roto · ❌ dinero: el tipo y el lugar del redondeo · ❌ borrado físico de filas ·
❌ N+1 · ❌ `FOR UPDATE` en un orden que decide el cliente · ✅ llamada repo-bound en una
transacción (deadlock del pool) · ❌ suponer qué conexión resuelve el repo proxy · ❌ campo
que escribe estado derivado sin pasar por su choke point

**Frontend** — ❌ mutar y luego recargar la lista · ❌ leer una respuesta asíncrona sin
comprobar que corresponde al estado actual · ✅ Tailwind hardcoded en vez de tokens · ❌
función de formato dentro de un `.vue` · ✅ fecha local armada con `toISOString()` · ❌
fricciones de `vue-tsc` estricto · ❌ dependencia nueva sin `optimizeDeps.include` · ❌
control con permiso propio anidado bajo el `v-if` de otro

**Entorno de desarrollo** — ✅ resguardo que valida una cosa y destruye otra

**Pruebas (unit)** — ❌ test verde que no ejerce lo que dice probar · ❌ leer el número de un
mutante sin leer por qué murió · ❌ cambiar un vocabulario compartido y actualizar solo el
módulo que tenés delante · ❌ escribir como medido algo que no se midió

**Pruebas E2E (API)** — ❌ tomar "el primero" de un listado que comparten todas las suites

---

## Backend

### ✅ Columna UUID sin `type: 'uuid'` explícito — AUTOMATIZADO

Ya enforced por test: `src/common/invariants/uuid-columns.invariant.spec.ts` recorre las
entities y falla si una columna `*_id` no declara `type: 'uuid'` (con allowlist para ids
externos como `google_id`). El porqué (JOINs raw fallan `varchar` vs `uuid`) vive en
[ADR-004](../adr/004-uuid-column-types.md). Regla movida del `.md` al test.

### ❌ Un id que entra sin validar, y el frente cerrado barriendo un solo mecanismo (2026-09-03)

Dos caras del mismo día y del mismo bug: **(a)** el defecto, **(b)** por qué darlo por cerrado
no alcanzó. La lección de (b) no es sobre UUIDs — se lee sola.

```ts
// ❌ (a) el string crudo llega al service, Postgres lo castea a uuid, revienta
//    con 22P02 y la excepción sin manejar sale como 500
@Get(':id') async findOne(@Param('id') id: string) {
// ✅
@Get(':id') async findOne(@Param('id', ParseUUIDPipe) id: string) {
```

Estaba en **148 de los 155 `@Param`**: era el estado por defecto. Lo peor no es el cliente mal
portado — `GET /api/ventas/tipos-documento` es un **path que no existe** y Express se lo
entrega al comodín `@Get(':id')`, así que **un 404 salía como 500** y disparaba alarma.

⚠️ **La excepción son los 7 `@Param('token')`**: son `randomBytes(32)`, no UUIDs, y el pipe
rompería invitaciones, verificación de correo y reset. El porqué está en esos controllers.

**(b)** Se grepeó `@Param`, se arreglaron los 148, el gate entero en verde, cerrado. **Faltaban
4.** Un id entra por **tres** puertas: `@Param`, campo `*Id` de un DTO, y **`@Query` crudo sin
DTO** — y era justo donde quedaba el agujero. La regla no es "acordarse de `@Query`": es
**enumerar los mecanismos por los que el dato entra y probar uno de cada uno** antes de declarar
cerrado un frente transversal, en vez de grepear el que originó el reporte.

📌 Ni `lint` ni `typecheck` ni los unitarios ven este hueco: sólo aparece pidiendo la ruta de
verdad. Lo fija `ventas.e2e-spec.ts`. Medidas y detalle: [`resueltos.md`](resueltos.md).

### ✅ Columna de fecha sin `type: 'timestamptz'` explícito — AUTOMATIZADO

Sin `type`, TypeORM elige por vos y para fechas elige `timestamp` **sin zona**. Llegó a 195
columnas partidas por accidente. Comparar una con zona contra una sin zona no da error —
Postgres castea con el `TimeZone` de la sesión, así que matchea 1 de 3 combinaciones y las
otras 2 afectan 0 filas **en silencio**. Enforced por
`src/common/invariants/timestamptz-columns.invariant.spec.ts` (mira la metadata, no el texto) y
`test/esquema.e2e-spec.ts` (mira `information_schema`, sobre TODAS las columnas). El porqué:
[ADR-019](../adr/019-timestamptz-en-toda-columna-de-fecha.md).

**Dos corolarios que no caza ningún test de esquema:**

1. **Un cast de zona es una respuesta al TIPO de la columna, no una verdad permanente.**
   `items.service.ts` tenía `NOW() AT TIME ZONE 'UTC'` para tapar el mismatch; con la columna ya
   en `timestamptz` ese mismo cast **reintroduce el bug que arreglaba** (medido: 4 horas de
   corrimiento). Si cambiás el tipo de una columna, releé los casts que la tocan.
2. **"El día" no sale de `CURRENT_DATE`.** `columna::date` y una fecha pura comparada cruda
   resuelven el día en el `TimeZone` de la **sesión** —UTC, nadie lo fija—, no del tenant: en
   Chile el día cortaba a las 21:00 y "hasta el 16" dejaba afuera el 16. Y cada tenant puede
   correr una `hora_corte`, así que tampoco alcanza medianoche local. Sale de
   `rango-fecha.util.ts`; lo enforca `common/invariants/dia-negocio.invariant.spec.ts`.

### ❌ Aislamiento multi-tenant roto — dos caras

**(a)** El tenant entra por donde no debe. **(b)** El tenant no entra en ningún lado, porque la
clave del recurso no lo contempla. La (a) la tapa un guard; la (b) sólo se ve buscando por la
**ausencia**.

```ts
// ❌ (a) cualquier cliente puede mandar otro tenant en el body
const { tenant_id } = dto;
// ✅ el payload JWT es camelCase — `req.user.tenant_id` es `undefined`
const { tenantId } = req.user as { tenantId: string };

// ❌ (b) el criterio es (usuario, tipo): quema el alta pendiente que OTRO
//    tenant le había emitido a la misma persona
.where('usuario_id = :u AND tipo = :t AND usado_el IS NULL', { u, t })
// ✅ el par completo, y el tipo acotado a lo que la acción invalida
.andWhere(`datos ->> 'tenantId' = :tenantId`, { tenantId })
```

Una persona existe en varios tenants; sus tokens, preferencias y vínculos, no necesariamente.

**Lo caro de (b) no es el borrado: es que no deja rastro.** La persona **desaparecía del roster
del otro tenant** y su link dejaba de servir, sin ningún evento que lo explicara. Y era
accionable a repetición: cualquier admin podía mantener bloqueadas las altas de un correo ajeno
repitiendo la suya.

**Cómo se caza en una auditoría:** listar las tablas cuyo criterio de búsqueda es `usuario_id`
**sin** `tenant_id` al lado, y preguntar *¿puede una acción de un tenant escribir acá?*. El grep
por `tenant_id` no lo encuentra —justamente porque no está—. Ojo con los `invalidarTodos` /
`deleteAll` / `revokeAll`: el barrido total casi siempre es más ancho que la intención.

### ❌ Dinero: el tipo y el lugar del redondeo — tres caras

**(a)** es la precondición; **(b)** y **(c)** se cometen igual con `Decimal` bien puesto.
```ts
// ❌ (a) number nativo. Las tasas van en decimal: 0.19, nunca 19
const total = precio * 1.19;
// ✅
const total = new Decimal(precio).mul(new Decimal(1).plus(tasa));

// ❌ (b) cuantiza regla por regla: el error se COMPONE
for (const r of reglas) acumulado = cuantizar(aplicar(r, acumulado));
// ✅ fino adentro del paso, cuantizado al cerrarlo
for (const r of reglas) acumulado = aplicar(r, acumulado);
acumulado = cuantizar(acumulado);

// ❌ (c) cinco cuantizaciones independientes: la identidad se rompe
totalFinal = cuantizar(neto.minus(desc).plus(rec).plus(iva));
// ✅ el total ES la suma de los componentes ya cuantizados
totalFinal = netoQ.minus(descQ).plus(recQ).plus(ivaQ);
```

**(b)** es el caso del **Vancouver Stock Exchange** —un índice que perdió la mitad de su valor
por redondear en cada operación—; acá el equivalente medido fue `descuentoAplicado = 101` sobre
un neto de 100, y una línea en **−1**. **(c)** rompe `MntTotal = MntNeto − Desc + Rec + IVA`,
que es lo que un documento tributario tiene que cumplir: **3.965 de 10.000** carritos medidos
quedaban descuadrados.

📌 Un total nunca se cuantiza aparte: se **deriva** de partes que ya lo están. Y el residuo se
le asigna a alguien —en el desbruteo lo absorbe el IVA— en vez de quedar repartido en el último
decimal de cada componente.

### ❌ Borrado físico de filas

```sql
-- ❌ borra la fila / ❌ lectura nueva sin filtrar borrados
DELETE FROM ventas WHERE venta_id = $1;
SELECT * FROM ventas WHERE tenant_id = $1;
-- ✅ marcar, y toda lectura filtra
UPDATE ventas SET eliminado_el = NOW() WHERE venta_id = $1 AND tenant_id = $2;
SELECT * FROM ventas WHERE tenant_id = $1 AND eliminado_el IS NULL;
```

En TypeORM, `repo.softDelete(id)` en vez de `repo.delete(id)`.

⚠️ **Hay excepciones, y por eso la regla NO se aplica con un grep.** Una lectura sin el filtro
puede ser deliberada, y **lo que la distingue de un olvido es que el porqué está escrito en la
propia consulta**. Ése es el criterio y es lo único que hay que recordar.

⛔ **Y por eso no hay lista completa acá, ni la va a haber.** Una primera versión decía *"las
dos que existen hoy"*; grepeando por conducta aparecieron **al menos seis**. **Una lista que se
presenta como completa y omite las excepciones caras es peor que no tener lista**: el que
audita la consulta, no la encuentra, aplica la regla literal y "arregla" algo que costaba plata.

Las **formas** que toma: el hecho **histórico** ya ocurrido (kardex, mermas), lo que **ya está
en curso** (líneas de comanda), la **autoría** del borrado (el join a `usuarios` de los
`findAll` con `incluirEliminados`), la **papelera** entera, y el guard que **cuenta** filas
puente en la papelera porque tiene que contarlas. Cada una con su porqué:
[`resueltos.md`](resueltos.md).

📌 **Antes de "arreglar" una lectura sin filtro, buscá ese comentario.** Si no está, es un bug;
si está, restaurar el filtro rompe algo que alguien ya midió.

### ❌ N+1 — una query por iteración sobre un resultado

```ts
// MAL — 1 query para la lista + 1 por fila
const data = await Promise.all(rows.map(async (r) => (
  { ...this.mapRow(r), disponible: await this.calcularDisponible(tenantId, r.id) })));

// BIEN — el dato derivado para todas las filas en una query
const d = await this.db.query(`SELECT item_id, … WHERE item_id = ANY($1)
  AND eliminado_el IS NULL GROUP BY item_id`, [rows.map((r) => r.id)]);
const byId = new Map(d.map((x) => [x.item_id, x]));
const data = rows.map((r) => ({ ...this.mapRow(r), disponible: byId.get(r.id) ?? null }));
```

Un `map(async … query)`, un `for` con `await query` o un `Promise.all` de queries escalan
lineal con las filas. No lo caza el lint → se revisa en el cierre con el sub-agente de
`verify-feature`. **Pero no todo bucle con `await` es un N+1**, y confundirlos costó dos falsos
positivos:

| Forma | Qué se hace |
|---|---|
| Una **query por fila** para derivar un dato | Sale siempre: `JOIN`, agregación o `= ANY($1)` |
| **N filas que hay que escribir** | Se batchea: un `save` con el array |
| Escrituras con **orden de lock deliberado** | **No se toca** — el orden ES la protección |

📌 Cinco variantes reales que cuestan más que el N+1 de manual (traer de más y descartarlo,
N+1 anidado, el catálogo cargado "una vez por función" en un clúster recursivo, el N+1 que
sostiene un lock pesimista, la misma query repetida por unidad), el matiz post-ADR-020 de
`Promise.all` dentro de una transacción, y cómo medirlo en las dos dimensiones:
[`resueltos.md`](resueltos.md).

### ❌ Tomar `FOR UPDATE` en un orden que decide el cliente (o el heap)

Dos transacciones que bloquean las mismas filas en orden distinto se esperan en cruz y Postgres
mata a una. El orden de bloqueo tiene que ser **una propiedad del sistema, no del payload**.

```ts
// ❌ el orden lo pone el cliente al armar el carrito
for (const linea of dto.lineas) await registrarMovimiento(linea.itemId)
// ❌ el orden lo pone el heap, y cambia solo con cada UPDATE
`SELECT ingrediente_item_id FROM receta_ingredientes WHERE receta_item_id = $1`
// ✅ orden fijo por id, en la query y en memoria
`… WHERE receta_item_id = $1 ORDER BY ingrediente_item_id`
```

**Reapareció cuatro veces en el mismo camino de venta**: se arregló arriba y quedó vivo **un
nivel adentro**, en los ids expandidos que ese fix no ve (ingredientes, componentes, opciones,
extras). Al arreglar un orden de bloqueo, preguntar **qué se bloquea después de eso**.

Ordenar cada nivel **no cierra el ciclo global** —el resultante es *(orden de línea) × (orden
dentro de la línea)*—, así que el cierre real es **reintentar ante `40P01`**, que además cubre
los ciclos que nadie enumeró. Sólo `40P01`: reintentar un error de negocio lo vuelve tres
intentos silenciosos.

**Regla:** agregar un `FOR UPDATE` **no es un cambio local**. Antes de ponerlo, listar qué otros
locks toma ese método —incluidos los implícitos de cada `UPDATE`— y cruzarlo con los demás
métodos que tocan esas tablas. La pregunta no es "¿qué protege esta línea?" sino "¿en qué orden
quedan **todos** los locks de este camino?". Dos variantes más (el ciclo entre dos tablas, y el
lock ordenado que vuelve peligroso al vecino): [`resueltos.md`](resueltos.md).

### ✅ Llamada repo-bound adentro de una transacción — deadlock del pool — AUTOMATIZADO

Ya no es posible **por construcción**. Hasta el 2026-08-18 era el riesgo #1 abierto del repo:
adentro de un `dataSource.transaction`, una llamada que usara el repositorio inyectado en vez
del `manager` pedía una **segunda conexión del mismo pool** mientras la transacción retenía la
primera. Con tantas requests en vuelo como tamaño tuviera el pool: **deadlock permanente**, no
un timeout — no hay ciclo de locks de fila, así que `deadlock_timeout` nunca dispara y nadie
aborta. La API entera moría hasta reiniciar el contenedor. **Se reintrodujo en código nuevo
cuatro días después de documentarse**: documentar la causa no bastó.

`TxContext` + la fachada `Db` + los repos como proxies context-aware (`backend/src/common/db/`)
cierran el mecanismo: ya no existe "llamar sin pasar el manager" — no hay manager que pasar. Una
familia de `no-restricted-syntax` cierra el chokepoint de **inyección** y el de **registro**
(`RepositoriosModule.forFeature`, sin el cual un módulo entero queda con repos del pool).

⚠️ **El lint es *name-based*** (un alias `DataSource as DS` lo esquiva) y ataca la inyección, no
cada uso: un `DataSource` recibido por parámetro de una función libre queda fuera por diseño.
Medido: **cero instancias del alias, dos reales de la función libre**, ambas protegidas porque
quien las llama ya pasó por el chokepoint. Límites y el experimento del umbral (9 ok / 10
cuelga): [ADR-020](../adr/020-contexto-transaccional-als.md) y [`resueltos.md`](resueltos.md).

Lo que sobrevive y el proxy no cierra son dos vueltas de tuerca: la entrada siguiente.

### ❌ Suponer qué conexión resuelve el repo proxy — dos caras del mismo error

El proxy context-aware de [ADR-020](../adr/020-contexto-transaccional-als.md) resuelve **en el
acceso a la propiedad** y **contra la transacción ambiente del ALS**. Quien no tiene esas dos
cosas presentes se equivoca en direcciones opuestas.

```ts
// ❌ (a) el proxy resuelve en `repo.find`, no en `find(...)`: guardar la
//    referencia afuera la congela con el repo del POOL → dos conexiones
const find = this.itemsRepo.find;
await this.db.transaccion(async () => { await find({ where: { tenantId } }); });

// ❌ (b) omitir el `manager?` creyendo que eso corre fuera: `this.repo` es el
//    proxy, sin manager resuelve la transacción AMBIENTE → el rollback se
//    lleva la fila de auditoría que se quería salvar
await this.db.transaccion(async (manager) => { await this.transacciones.registrar(d); });

// ✅ (a) acceder a la propiedad DENTRO del contexto en que se usa
// ✅ (b) pedir el afuera explícitamente
await this.db.sinTransaccion(() => this.transacciones.registrar(d));
```

**El contrato de (b) se dio vuelta y el código no cambió:** antes de ADR-020 la rama `else` de
`manager ? manager.getRepository(X) : this.repo` era literalmente una conexión propia del pool
—por eso existía—. Hoy significa lo contrario, con la misma firma y la misma pinta.

Ninguna la ve un lint: el `Proxy` es indistinguible de un repo real para un analizador
estático. Las dos son **prevención** — verificado cero ocurrencias de (a) y cero llamadores
vivos de (b). La regla general en `docs/patterns/backend.md` §9; las verificaciones y el caso
de `cobros.service.ts`: [`resueltos.md`](resueltos.md).

### ❌ Campo que escribe estado derivado sin pasar por su choke point

`item_producto.costo_actual` (y en su momento `stock`) son valores derivados del kardex: su
única puerta legítima es `InventarioService.registrarMovimiento`. `PATCH /items/:id` aceptaba
`dto.costo` y `dto.stock` y los escribía directo en la columna, sin generar movimiento — el
número quedaba corrompido sin rastro de quién ni por qué, y salteaba entera la feature de
[recuento de inventario](../features/recuento-inventario.md).

```ts
// ❌ escribe el campo derivado directo
if (dto.costo !== undefined) await repo.update(id, { costoActual: dto.costo });

// ✅ rechazarlo con un validador que siempre falla y dice dónde sí hacerlo
@ValidateIf((o) => o.costo !== undefined)   // NO @IsOptional: deja pasar `null` explícito
@Validate(CostoNoEditableConstraint)        // validate(): false + defaultMessage()
costo?: string;
```

⚠️ **La trampa del `ValidationPipe`:** es `whitelist: true` **sin** `forbidNonWhitelisted`, así
que *borrar* el campo del DTO lo descarta **en silencio** — 200 sin haber cambiado nada, un
fallo callado peor que el bug. Hay que rechazarlo explícitamente.

📌 El test de invariante que lo enforca es una **heurística de texto sobre SQL crudo**: no
vería una escritura vía el `Repository<ItemProducto>` con la propiedad camelCase. Frena el
patrón de bug real, no es un parser de TypeORM — por eso la entrada sigue en ❌ y no en ✅.
Detalle: [`resueltos.md`](resueltos.md).

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

### ✅ Fecha local armada con `toISOString()` — AUTOMATIZADO

Enforced por `frontend/app/invariants/fecha-local.invariant.spec.ts` (corre en `npm test`, y
CI lo corre en `frontend · unit`): barre `app/**` (`.ts` y `.vue`), **ignora comentarios** y
rechaza `toISOString()`/`toJSON()` recortado a `YYYY-MM-DD` (`slice`/`substring`/`split('T')[0]`).
No cubre mandar un instante completo al backend, que es correcto; prohíbe quedarse con su parte
de **fecha**.

⚠️ **Límite medido, y va escrito porque el chequeo cierra el idioma, no el concepto:** exige que
el recorte esté **pegado** a la serialización. Partido en dos sentencias —`const iso =
d.toISOString()` y más abajo `iso.slice(0, 10)`— **pasa limpio**. Cerrarlo necesita seguir el
valor por la función, o sea un analizador, no un grep: ahí la red es la revisión, no el gate.
Por eso esto es un `✅` con su hueco declarado y no un frente dado por cerrado — mismo criterio
que la entrada de `timestamptz` y sus dos corolarios.

**Lo que el chequeo no encodea, y por eso queda escrito: los dos idiomas fallan en hemisferios
opuestos.** `new Date()` se corre un día **adelante** al oeste de Greenwich y sólo al final del
día; `new Date(y, m, 1)` (medianoche construida) se corre un día **atrás** al este y el día
entero — medido: Madrid UTC+2 da `2026-08-31`, Santiago UTC−4 da `2026-09-01`. Probar desde
Chile caza el primero y **nunca** el segundo, que es cómo `rangoMesActual` sobrevivió dos meses
de gate y CI.

⚠️ **Stripear comentarios es lo que lo hace discriminar, no cosmética:** los docblocks que
advierten contra el patrón citan el literal. Medido sobre el árbol corregido — 3 falsos
positivos sin stripear, 0 con.

📌 **El molde correcto vive en cinco lugares y cuatro nacieron bien** (medido con
`git log --follow`/`-S`): el bug existió **una sola vez** —en propinas— y se cazó **dos**
(`9364a63b`, `7a319150`). O sea que el problema nunca fue no saber el molde, sino que nada
obligaba a usarlo. El frente entero: [`resueltos.md`](resueltos.md).

### ❌ Fricciones de `vue-tsc` estricto — cinco caras del mismo error

`vue-tsc` estricto rechaza cosas que `nuxt build` acepta, y **el fix es siempre solo-de-tipo,
cero runtime**. Lo caza `typecheck:ratchet`, nunca el build.

```vue
<!-- ❌ la expresión devuelve valor → el handler no es void (TS2322) -->
<UButton @click="form.series = form.series.filter((_, i) => i !== idx)" />
<!-- ✅ función nombrada, o arrow con bloque para un one-liner -->
<UButton @click="removeSerie(idx)" />   <UButton @click="() => { open = false }" />

<!-- ❌ con noUncheckedIndexedAccess el índice es T | undefined (TS2532) -->
<UInput v-model="form.series[idx].serie" />
<!-- ✅ el índice viene del mismo v-for: aserción no-nula -->
<UInput v-model="form.series[idx]!.serie" />
```

El `!` **sólo** donde una guarda previa garantiza la existencia (`v-for` sobre la misma lista,
`findIndex` ya chequeado, `parts[1]!` tras un `length` validado) — nunca en el índice dudoso,
que lleva `v-if` real.

Las otras tres caras son coerciones de tipo contra `@nuxt/ui`/`reka-ui` y vitest: estado
`string | null` bindeado a un input que quiere `string | undefined` (`?? undefined`, o tipar el
form sin `null`), params de handler más estrechos que el emit, y cuatro fricciones de los
`.spec.ts` bajo vue-tsc. Las cinco con su código: [`resueltos.md`](resueltos.md).

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

## Entorno de desarrollo

### ✅ Un resguardo que valida una cosa y destruye otra — AUTOMATIZADO

`reset-db.sh` comprobaba que el `DATABASE_URL` del `.env` "pareciera local" y después hacía
`down -v` sobre el **proyecto de compose**, que era **uno solo para todos los worktrees**
(`.env.example` fijaba `COMPOSE_PROJECT_NAME` y cada `.env` copió esa línea). El 2026-09-20 un
reset corrido en un worktree borró el volumen de todas las sesiones **informando éxito**.

```bash
# ❌ valida un proxy del objetivo (una URL) y destruye el objetivo (el proyecto)
case "$url" in *@postgres:*|*@localhost:*) ;; *) exit 1 ;; esac
compose down -v
# ✅ derivar el objetivo, pasarlo explícito, y exigir que lo declarado coincida
eval "$derivado"   # de: entorno.sh derivar
[ "$ENTORNO_PROYECTO_DECLARADO" = "$ENTORNO_PROYECTO" ] || exit 1
docker compose -p "$ENTORNO_PROYECTO" down -v
```

**Endurecer el proxy no cerraba nada**: el proyecto era compartido dijera lo que dijera el
`.env`, así que exigirle el puerto a la URL habría tapado el incidente dejando vivo el mecanismo.
La pregunta no era *"¿esta URL es local?"* sino ***"¿lo que estoy por destruir es mío?"***.

→ *AUTOMATIZADO: `scripts/check-aislamiento.mjs` (CI y pre-commit) falla si el compose vuelve a
clavar un puerto de host o un `container_name`, si `.env.example` vuelve a fijar el proyecto, o si
`reset-db.sh` nombra un contenedor compartido en código. Cuatro mutantes: exit 1 por su regla, 0 al revertir.*

📌 Lo que el chequeo no encodea: **antes de tocar un resguardo, escribir qué destruye la operación
y qué mira el chequeo. Si no son lo mismo, el arreglo es cambiar la pregunta, no agregarle un campo
al patrón.** Diseño: [`spec del frente`](../superpowers/specs/2026-09-20-stack-por-worktree-design.md).

## Pruebas (unit)

### ❌ Test verde que no ejerce lo que dice probar

Cinco caras, **ninguna descubierta leyendo el test**: cuatro apagando el fix a mano, y la
quinta porque el bug volvió estando el test verde. Si con el fix apagado sigue verde, no prueba
lo que dice — son treinta segundos y es lo primero que hay que correr.

⚠️ **Pero apagar el fix no alcanza.** El mutante confirma que el test *toca* el fix; no que mire
**el efecto** del fix. Cuando la aserción es sobre la llamada, las dos cosas se separan.

```ts
// ❌ el espía prueba que pediste algo, no que haya pasado
expect(espia).toHaveBeenCalledWith(0, '127.0.0.1')
// ✅ afirmar el estado resultante
expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
```

⚠️ **El olor a buscar:** el sujeto de la aserción es un espía, un mock o un contador, y el
título habla de un **resultado**. Si el título dice "queda atado a" / "se guarda" y la aserción
dice `toHaveBeenCalledWith`, no son la misma afirmación.

Las cinco caras: **(a)** el mock ya trae la respuesta, así que el branch del título nunca corre
—y su variante peor, el mock que precocina la condición que el código debía garantizar—;
**(b)** otra regla dispara antes; **(c)** el fixture no puede aislar el criterio (con dos
elementos el ganador es a la vez el último, el mayor y el de monto mayor: hacen falta **tres**,
con el correcto en el **medio**); **(d)** la aserción no puede fallar porque lo que busca no
puede aparecer; **(e)** la aserción mira la llamada, no el estado. Con su código y lo que costó
cada una: [`resueltos.md`](resueltos.md).

**Regla:** construir el escenario de modo que **la regla bajo prueba sea la única que puede
fallar**, y aseverar el mensaje, no sólo el status.

### ❌ Leer el número de un mutante sin leer por qué murió

Un mutante da un número —cuántos tests se pusieron rojos— y ese número miente de tres formas.
**Medirlo no alcanza: hay que leer el mensaje de cada fallo.**

**(a) Murió por `TypeError`, no por la aserción.** El test pasa de largo el chequeo, sigue hasta
un mock incompleto y muere en `.id` — *"Cannot read properties of undefined"* es un **falso
rojo**, y da un falso verde de cobertura: el día que alguien complete ese mock, el test deja de
discriminar y nada avisa. El arreglo va **local al test que lo necesita, no como default del
harness**: con `manager.query` resolviendo `[]` por default, un mutante pasó de cazado a
**sobreviviente**, porque un `if (!rows.length) throw` de más abajo tira la misma excepción.

**(b) Mató más tests de los que su alcance explica — y eso *es* el hallazgo.** Un mutante mató 2:
el legítimo y uno sin relación. La causa era **aislamiento**, no cobertura: los tests hacían
`wrapper.unmount()` al final del cuerpo, así que el primero en fallar dejaba diálogos viejos en
`document.body`. **Si un test lee `document.body`, el desmontaje va en `afterEach`.** Primero se
arregla el aislamiento, después se leen los mutantes.

**(c) Murió, pero probando una propiedad más débil que la del título.** El mutante "no escribir
el puntero" moría —el test sí probaba que se escribe— pero la propiedad real era que se
escribiera **a tiempo**, y de eso no había cobertura.

⚠️ **Y el mutante mismo puede estar mal aplicado.** Un `perl -0pi -e` **sin `/g`** reemplaza la
primera ocurrencia, que puede estar **en el docblock** en vez del código: dio un falso "test
decorativo" sobre un test bueno. Verificar que el fuente mutado sea el que se cree — y, con el
watcher de Docker corriendo, que el proceso haya tomado el revert y no sólo el archivo.

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

### ❌ Escribir como medido algo que no se midió — tres caras

**Una afirmación falsable publicada sin la medición que la sostiene.** Cambia sólo en qué
momento se rompe el vínculo: **(a)** nunca se midió, **(b)** se midió y envejeció, **(c)** se
midió pero se leyó la evidencia equivocada. Las tres las cazó la revisión independiente.

```bash
# ❌ la línea dice "passed" y el comando falló (4 unhandled rejections aparte)
npm test 2>&1 | grep -E "Tests "
# ✅ el exit code es el veredicto; la línea es un resumen
npm test; echo "EXIT: $?"
```

```markdown
❌ Los ocho casos: A, B, C…       ← envejece con el próximo `it`
✅ Cubre: A · B · C · D…          ← la enumeración ES el conteo
```

**Las tres reglas, de la más barata a la más cara:** una variable por experimento; si el script
murió la corrida **no vale**, ni las líneas que alcanzó a imprimir; y antes de escribir una
regla general, buscar el contraejemplo **dentro del repo**.

**La causa de (b) no es descuido, es orden de operaciones:** el número se escribe cuando es
cierto, después se agrega un test —muchas veces porque la revisión lo pidió— y nadie vuelve al
párrafo. **Agregar una fila a la tabla no es volver a medirla.** Duele más en `resueltos.md`,
que es archivo: un conteo falso queda congelado y el próximo lo cita como evidencia. Y cuando
la afirmación falsa ya circuló, **anotarla como refutada, no borrarla en silencio**. Los casos:
[`resueltos.md`](resueltos.md).

## Pruebas E2E (API)

### ❌ Tomar "el primero" de un listado que comparten todas las suites

```ts
// ❌ el listado trae lo que dejaron las otras suites, ordenado por nombre
const bodega = filas.find(u => u.tipo === 'bodega')!   // ¿cuál? la que ordene primero
// ✅ el spec crea la suya y no depende de nadie
const bodega = await post('/api/ubicaciones', { nombre: `Bodega X E2E ${Date.now()}`, tipo: 'bodega' })
```

**Lo que costó:** `stock-insuficiente-ubicacion.e2e-spec.ts` tomaba la primera bodega del
listado. `GET /ubicaciones` ordena `tipo ASC, nombre ASC` **e incluye las desactivadas**, y
`traslados.e2e-spec.ts` deja una *"Bodega apagada E2E"*. Cuando esa quedó primera, los cuatro
`POST /traslados` rebotaron con 400 *"está desactivada"* y los cuatro casos cayeron juntos.

⚠️ **Y el verde local no dice nada sobre el de CI:** jest reordena las suites con su caché de
tiempos, que CI no tiene, así que **qué suites corrieron antes —y qué dejaron en la base— es
distinto en cada máquina**. Se reprodujo plantando a mano una bodega inactiva que ordenara
primero: mismo 4-de-5 que CI.

📌 **La regla, más ancha que las bodegas:** un spec e2e **no lee del estado compartido lo que
puede crear**. Vale para cualquier catálogo que otra suite pueda ensuciar. Cuando hay que leer
sí o sí (el `local` del tenant, que es único y no se crea), el `find` tiene que ser por una
propiedad que **identifique**, no por posición.

## Pruebas E2E de navegador

*(Sección a poblar cuando exista la suite. Entradas previstas según el diseño acordado:
esperas fijas en lugar de aserciones web-first, tests que dependen del estado dejado
por otro test, y aserciones de montos copiadas de la salida del código en vez de
derivadas de `docs/features/`. No se documentan aquí hasta que ocurran de verdad.)*

