# Backend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-09-06

Patrón de referencia para construir un módulo de feature (NestJS + TypeORM),
extraído del código real (`modules/monedas/`, `modules/tenants/`). **Léelo antes de
planificar una feature**: cada sección condensa el patrón y apunta al archivo real
para copiar/adaptar.

> Convenciones transversales obligatorias (no repetidas en cada sección):
> - **Soft delete en todo**: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda
>   lectura filtra `eliminado_el IS NULL` (o `eliminadoEl: IsNull()`).
>   **Excepción deliberada:** el JOIN a `usuarios` de la papelera para mostrar quién
>   borró un registro no filtra el `eliminado_el` de `usuarios` — el autor de un
>   borrado es un hecho histórico que no debe desaparecer solo porque ese usuario se
>   dio de baja después. Ver `categorias.service.ts → findAll`.
>   ➕ **No es la única**: hay otras deliberadas (kardex, mermas, líneas de comanda…)
>   y lo que las distingue de un olvido es que **el porqué está escrito en la propia
>   consulta**. Formas que toman, con archivos:
>   [`docs/agent/anti-patterns.md`](../agent/anti-patterns.md).
> - **`type: 'uuid'` explícito** en toda columna PK/FK de UUID ([ADR-004](../adr/004-uuid-column-types.md)).
> - **`tenant_id` siempre del token** (`req.user.tenantId`), nunca del body.
> - **Decimal.js / `numeric`** para dinero y porcentajes; nunca `number` nativo.
>   Porcentajes en decimal (`0.19` = 19%).

---

## 1. Esqueleto de un módulo

```
backend/src/modules/<feature>/
├── entities/<feature>.entity.ts
├── dto/{create,update}-<feature>.dto.ts
├── <feature>.service.ts + <feature>.service.spec.ts   # tests junto al service (TDD)
├── <feature>.controller.ts
└── <feature>.module.ts
```

Registrar en `app.module.ts`: entities en el array `entities` del
`TypeOrmModule.forRoot` y `<Feature>Module` en `imports`.

---

## 2. Entity

- **PK simple:** ver `modules/tenants/entities/tenant.entity.ts` —
  `@PrimaryGeneratedColumn('uuid')` + `@CreateDateColumn({ name: 'creado_el' })`,
  `@UpdateDateColumn({ name: 'actualizado_el' })`, `@DeleteDateColumn({ name: 'eliminado_el' })`.
- **PK compuesta (tabla puente / por tenant):** ver
  `modules/monedas/entities/tenant-moneda.entity.ts` — dos `@PrimaryColumn({ type: 'uuid' })`.
- Nombres de columna DB en `snake_case` vía `name:`; propiedades en `camelCase`.
- `numeric` (`type: 'numeric', precision, scale`) se mapea a **`string`** en JS —
  no operar con `+`/`*`, usar Decimal.js. Tipar la propiedad `string | null`.

### Si la entidad lleva `activo`, hay que hacerlo cumplir (owner, 2026-08-03)

> Cualquier cosa que se habilite y deshabilite: si está deshabilitada, **se ignora** y **no
> sale en los selectores** que la aplican.

Un `activo` que solo se escribe es peor que no tenerlo: el admin ve un interruptor, lo apaga,
y el sistema sigue como si nada. Antes de agregar el campo, decidí quién lo lee — y escribí el
test que lo fija.

Dos significados según el rol de la entidad, y **no se aplanan**:

| La entidad… | Pausada significa | Cómo se enforcea |
|---|---|---|
| **se aplica** a un cálculo (`descuentos`, `recargos`, `impuestos`) | no entra en el total, y avisa | descartar **al aplicar**, no al cargar |
| **se referencia** (`categorias`, `terceros`, `items`) | no se puede elegir de nuevo | rechazar la **asignación nueva**; el vínculo existente no se rompe |

La fila de "se referencia" describía la regla **desde el 2026-08-03 y el backend no la
cumplía**: hasta el 2026-08-11 la sostenía solo el frontend (`items.vue` y
`ClienteForm.vue` filtran las listas), así que un POST directo asignaba igual. El
enforcement vive en un solo punto por entidad, que es donde hay que sumarse si aparece
otro camino de asignación: `validarCategoria` (`items.service.ts`, la usan `create` y
`update`) y `validarTercero` (`ventas.service.ts`). Los dos leen `activo` y lo evalúan
aparte del `WHERE`, para que "no es de este tenant" y "está pausada" sean errores
distintos.

Tres trampas ya pisadas, todas documentadas en
[`resueltos.md`](../agent/resueltos.md) § *Lo que está en pausa no se aplica ni se ofrece*:

1. **No filtres `activo` en el `findAll` del catálogo.** Lo comparte la pantalla de
   administración, que necesita ver la fila pausada para poder reactivarla — si desaparece de
   la lista, el toggle se va con ella.
2. **No saques la fila del mapa que consume el motor.** `requerir()` tira 400 ante un id
   ausente: cada ítem asociado se vuelve un error y el POS deja de vender.
3. **Si el campo entra a un tipo del motor, va requerido, no opcional.** Un `activo?: boolean`
   que alguien olvide mapear revive el bug en silencio; requerido, lo caza el typecheck.

Pausar **no** es eliminar: nunca toca tablas puente ni borra asociaciones. Y una excepción
fiscal a no olvidar: el **IVA no se pausa**, lo gobierna afecto/exento
([impuestos.md](../features/impuestos.md)).

---

## 3. DTO

`class-validator` con `ValidationPipe` global (`main.ts`). Campos opcionales en
update con `@IsOptional()`. Campos `numeric` con `@IsNumberString()`.

> **Contrato con el frontend:** `@IsNumberString` exige un **string** (`"10.50"`), no
> un `number`. El cliente lo maneja string de punta a punta con `UInput`
> `inputmode="decimal"` (nunca `type="number"`) — ver [frontend.md §7](./frontend.md).
> Mandar un `number` produce `400 "X must be a number string"`.

### 3.1 Plata que entra por API: la escala la valida el borde

`@IsNumberString` dice que es un número; **no** dice que quepa en la moneda. Medio peso
chileno pasa ese validador y no existe. Todo campo de plata se marca, y el handler que lo
recibe cuelga el pipe:

```ts
// dto — la marca dice QUÉ escala le toca
@EsMontoCobrado() monto: string;   // escala de la moneda oficial del tenant (CLP → 0)
@EsCosto()       precioBase: string; // ESCALA_COSTO = 4, no depende de la moneda

// controller — el pipe recorre el árbol del DTO y rechaza con 400
@Post() crear(@Body(EscalaMonedaPipe) dto: CreatePagoDto) { … }
```

**La distinción que hay que acertar antes de marcar**: `@EsMontoCobrado` es plata que
alguien **paga o recibe**; `@EsCosto` es una **tasa** —un precio unitario, un costo, un
extra— que después se multiplica y recién ahí cruza a monto cobrado. Marcar un precio de
lista como monto cobrado hace que la API rechace su propia sugerencia de precio.

Tres cosas que muerden y no se deducen del código:

1. **Cada módulo que use `@Body(EscalaMonedaPipe)` tiene que importar `MonedasModule`.**
   El lookup es por `moduleRef.injectables`, no por providers globales. Olvidarlo **tumba
   el arranque entero** del backend: typecheck y unit quedan verdes, solo lo ve el e2e.
2. **Un DTO anidado sin `@Type()` degrada a "no valida nada", en silencio.** El pipe baja
   por el árbol, así que la marca puede estar en un hijo (`PagoItemDto.monto`).
3. **La validación de escala existe SOLO en el borde HTTP.** Un `plainToInstance` +
   `validate()` no ejerce el pipe, y una llamada directa al service tampoco. Un spec de
   DTO que "prueba" la escala no está probando nada.

**El contrato de las pasarelas:** todo provider **valida en su borde y nunca redondea
ahí**. Un provider que redondee estaría cambiando lo que el documento dice que se cobró; la
escala del cable es de cada pasarela y vive en su adaptador, no en una columna del tenant.

⚠️ **Y la excepción, que es de criterio y no de implementación:** esto protege *la plata
que una **persona** ingresa*, que es una intención corregible. Un **callback de pasarela
informa un hecho consumado** —la plata ya se movió— y ahí rechazar no deshace nada, solo
pierde el evento: se cuantiza y se registra el valor original en la traza. Ver
[reembolsos-nota-credito.md](../features/reembolsos-nota-credito.md).

📌 El sistema sigue cuantizando **sus propios cálculos** en silencio (el CPP de inventario
produce más de 4 decimales y se recorta). No es incoherencia: la regla es sobre lo que
alguien escribe.

✅ **El punto ciego de descuentos y recargos se cerró el 2026-08-23.** Su `valor` no se
podía marcar —era monto fijo o porcentaje según el campo hermano `modo`, y ni el decorador
ni el pipe leen campos hermanos—, así que se **partió en dos columnas**: `valor_monto`
(marcada) y `valor_porcentaje` (que no es plata y conserva su regla de "0.10 = 10%"). La
lección general: **un campo cuyo significado depende de un hermano no es marcable, y el
arreglo es partir el campo, no enseñarle al pipe a leer hermanos.** Detalle en
[`features/descuentos-recargos.md`](../features/descuentos-recargos.md).

Implementación: `common/decorators/escala-moneda.decorator.ts` y
`common/pipes/escala-moneda.pipe.ts`.

---

## 4. Controller — guards y `tenantId` del token

`tenantId` siempre se extrae con `const user = req.user as { tenantId: string }` y
se pasa al service. Ejemplo completo: `monedas.controller.ts`.

**Guards disponibles** (`src/common/guards/`, exportados por `CommonModule` `@Global`
— no hay que importar nada extra):

| Guard | Verifica |
|---|---|
| `JwtAuthGuard` | token válido |
| `TenantGuard` | membresía en el tenant del token |
| `TenantAdminGuard` | rol admin (fijo) en el tenant |
| `PermisosGuard` | permiso RBAC granular (`rol → módulo contratado → permiso`) |

**Dos estándares según el tipo de pantalla:**

- **Catálogos de configuración financiera** (monedas, impuestos, descuentos,
  recargos, categorías, métodos-pago, tipos-regla, roles):
  `@UseGuards(JwtAuthGuard, TenantGuard)` en la clase + `TenantAdminGuard`
  por-handler en las mutaciones. Admin-only por producto, no son módulos RBAC.
- **Módulos de negocio** (Caja, Ventas, Pagos, Inventario, Items, Terceros, Tienda
  Online, Suscripciones): `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a
  nivel de controller + `@RequiresPermiso('<Modulo>', '<Permiso>')` por handler
  (ej.: `caja.controller.ts`). Un rol `es_fijo` (admin) tiene acceso total vía
  short-circuit en `RbacService.userHasPermiso`.

> **Una ruta puede aceptar MÁS DE UN módulo** (`@RequiresAlgunPermiso`, 2026-08-22): alcanza
> con tener la acción en **uno** de los declarados. Es para lo que de verdad comparten dos
> módulos, y el caso que lo trajo es el garzón — lo crea el alta de todo tenant, atiende mesas
> en `Salones` y cobra propinas en `Propinas`—, no para esquivar la decisión de a qué módulo
> pertenece una ruta: si la duda es cuál de los dos corresponde, la respuesta es **elegir**.
> Cada alternativa es una consulta más a RBAC (corta en la primera que da), y la lista la fija
> el decorador, nunca los datos.
>
> **Excepción — política dentro de un módulo operativo:** una acción concreta puede ser
> admin-only (`TenantAdminGuard`) aunque su módulo sea RBAC, cuando es una **política** que un
> rol operativo no debería poder cambiarse a sí mismo (ej. `PUT /caja/arqueo-ciego`: apagar el
> arqueo ciego). Criterio, prueba y ejes de rol en `docs/features/roles-permisos.md`, sección
> "Admin-only vs permiso de módulo".

> Al agregar un módulo de negocio nuevo: registrar el `modulo_app` y sus
> `modulo_app_permisos` (CRUD estándar Leer/Crear/Actualizar/Eliminar/Ver todas)
> en `seeder.service.ts`, luego aplicar `PermisosGuard` + `@RequiresPermiso(...)`.
> Ocultar el link en el sidebar (`can(modulo, permiso)`) es complementario, no un
> sustituto del enforcement en el backend.

### Todo id que entre del cliente y sea un UUID se valida como UUID (2026-09-03)

```ts
@Get(':id')
@RequiresPermiso('Ventas', 'Leer')
async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
```

**Por qué.** Sin el pipe, el string del path llega al service y de ahí a Postgres,
que intenta castearlo a `uuid`, falla con `22P02` y la excepción sin manejar sale
como **500**. Un request mal formado tiene que ser 400: el 500 dice "se cayó la
app" y ensucia el monitoreo con una alarma que no corresponde a ninguna falla.

El caso que lo trajo es el más incómodo de todos, porque **ni siquiera hace falta
un cliente mal portado**: `GET /api/ventas/tipos-documento` es un path que no
existe —la ruta de verdad es `/api/tipos-documento`— y Express se lo entrega al
comodín `@Get(':id')`. O sea que **un 404 se disfrazaba de 500**.

**No era un bug de ventas.** Medido el 2026-09-03 sobre 26 rutas `GET :id` con un
id no-UUID: **14 devolvían 500**, repartidas en `items`, `caja`, `recuentos`,
`grupos-modificadores`, `descuentos`, `impuestos`, `recargos` y `cajones`. Las
otras 12 daban 404 por motivos mezclados —algunas manejadas, otras simplemente
porque *esa ruta no existía*—, así que 14 era un piso, no un techo. Por eso el
pipe se aplicó de una vez a los **148 `@Param` de UUID** de los 30 controllers,
en lugar de ruta por ruta.

⚠️ **Los 7 `@Param('token')` quedan afuera, y no es un olvido.** Esos tokens se
generan con `randomBytes(32).toString('base64url')`
(`auth/tokens-acceso.service.ts:51`): son base64url de 43 caracteres, **no son
UUID**. Ponerles el pipe devolvería 400 a *todos* los links válidos de
verificación de correo, invitación y reset de contraseña. Antes de agregar el
pipe a un `@Param` nuevo, la pregunta no es "¿es un id?" sino **"¿es un uuid?"**.

📌 El `lint`/`typecheck` **no** ve la ausencia del pipe, y el unitario tampoco: el
hueco solo aparece pidiendo la ruta de verdad. Lo fija
`ventas.e2e-spec.ts` › *"responde 400 —no 500— cuando el id no tiene forma de
UUID"*.

**Son TRES los mecanismos por los que un id entra, no uno.** El primer barrido
grepeó `@Param` y pareció exhaustivo; no lo era. El mapa completo, medido:

| Mecanismo | Cómo se valida | Estado al 2026-09-03 |
|---|---|---|
| `@Param('id')` | `ParseUUIDPipe` | 148 puestos, 7 `token` exentos |
| Campo `*Id` de un DTO (body o query) | `@IsUUID()` de `class-validator` | 121 de 124 ya lo tenían |
| `@Query('algo')` **crudo**, sin DTO | `new ParseUUIDPipe({ optional: true })` | 4 puestos: `excludeId` ×3 + `paisId` |

```ts
// El @Query crudo no pasa por ningún DTO, así que class-validator no lo ve.
// `optional: true` porque la pantalla de ALTA no manda excludeId.
@Query('excludeId', new ParseUUIDPipe({ optional: true })) excludeId?: string,
```

⚠️ **El tercero es el que se escapa**, porque no lo encuentra ni un grep de
`@Param` ni uno de DTOs. Son las rutas `nombre-disponible` de `descuentos`,
`impuestos` y `recargos`, más `GET /catalog/provincias`: las 4 **seguían en 500
después** del fix de `@Param`. Lo fija `ids-por-query.e2e-spec.ts`, que lleva el
control en 200 al lado de cada 400 —con y sin el parámetro—, porque un
`nombre-disponible` que contesta 400 siempre rompe la pantalla de edición sin que
ningún test lo note.

📌 Los 3 campos `*Id` de DTO sin `@IsUUID()` **no** son huecos, y se verificaron
uno por uno: `turnoIds` sí lo tiene (un `@Transform` en el medio lo escondía del
grep), los de `personalizacion-receta.dto.ts` son `interface` de snapshot y no un
DTO validado, y `googleId` es un id externo de Google que legítimamente no es un
UUID.

### Tablas sin `tenant_id`

**No todas las tablas lo llevan, y eso no es un olvido.**

**El censo, con su criterio declarado.** Sin el criterio el número no significa nada: contar
"menciona `tenant_id`" y contar "declara la columna" dan resultados distintos sobre las mismas
102 entidades, y esa diferencia ya produjo una cifra mal publicada acá. El criterio es
**declara la columna**, y el número es el que devuelve este comando — si algún día no coincide,
manda el comando:

```bash
grep -rLE "name: 'tenant_id'" --include='*.entity.ts' backend/src | wc -l   # → 39
```

Sobre 102 entidades: **63 declaran `tenant_id`, 39 no**. Esas 39 se reparten en **cuatro**
familias, y a la última la regla de abajo no le aplica:

| Familia | Ejemplos (nombre real de tabla) | Por qué no lo lleva |
|---|---|---|
| **Catálogo del sistema** | `pais`, `provincia`, `moneda`, `permisos`, `modulos_app`, `metodos_pago`, `unidades_medida`, `tipos_documento_tributario` | Son de **todos** los tenants a propósito. Ponerles `tenant_id` sería el error |
| **Extensión de `items` con PK compartida** | `item_producto`, `item_servicio`, `item_suscripcion`, `item_combo`, `item_receta` | La **PK es la FK**: la fila no puede existir sin su padre. El tenant vive en `items` |
| **Hijo de una cabecera** | `venta_detalles`, `ventas_impuestos`, `movimientos_caja`, `movimiento_inventario_detalle`, `descuento_tramos` | El tenant se hereda del encabezado |
| **Del usuario o del proceso** | `usuarios`, `refresh_tokens`, `tokens_acceso`, `cron_ejecuciones` | **No tienen tenant que heredar.** Una persona pertenece a varios tenants (la relación vive en `usuarios_tenants`) y un job del sistema no pertenece a ninguno |

⚠️ **La cuarta familia existe porque la regla de abajo NO la cubre.** Si tu tabla nueva cae
ahí —no es catálogo, no cuelga de una cabecera con tenant, y su "padre" es `usuarios` o
nada— entonces el acote por `JOIN` no aplica y el aislamiento tiene que venir de otro lado
(el token, el `usuario_id`). Preguntá antes de asumir que alcanza.

**La regla, que es sobre las consultas y no sobre el esquema:** una tabla de las tres
primeras familias se acota **por su padre**. Toda consulta que la alcance tiene que llegar
por un `JOIN` desde una tabla ya filtrada por el tenant del token. El riesgo no es que falte
la columna — es **llegar a la tabla directo por `id`**, porque ahí no hay nada que acotar.

Cuando un método recibe un id y va directo a la tabla hija, el acote se hace **con un
`JOIN` al padre en esa misma consulta**, no delegándolo en quien llama:

```sql
SELECT ip.stock, ip.modo_inventario
  FROM item_producto ip
  JOIN items i ON i.item_id = ip.item_id
 WHERE ip.item_id = $1 AND i.tenant_id = $2
 FOR UPDATE OF ip
```

⚠️ **`FOR UPDATE OF ip`, nunca `FOR UPDATE` a secas.** Sin el `OF`, Postgres lockea también
la fila de `items` que se usó solo para acotar: huella de locks nueva en el camino más
caliente del sistema. No es teórico — `mermas.service.ts` ya toma `FOR UPDATE OF i` sobre
`items` antes de llamar al kardex, así que un `FOR UPDATE` a secas acá haría que la venta
empiece a bloquear contra la merma. El orden de bloqueo entre caminos es donde el proyecto
ya tiene deadlocks: el de fila está descrito en el comentario de `ventas.service.ts` →
`crear()` (por eso ese método ordena por `itemId` y reintenta), y el orden entre las tablas
del catálogo, en § 15.

⚠️ **Este molde NO trae `eliminado_el IS NULL`, y es una decisión, no un olvido.** La
invariante del proyecto es que toda lectura lo filtra; acá el `JOIN` al padre existe **solo
para acotar el tenant**. Decisión del owner (2026-08-15): **lo que está en el kardex queda
en el kardex** — borrar un ítem no borra ni esconde sus movimientos, y anular una venta suya
tiene que poder reponer stock, así que el filtro rompería la conducta correcta.
**Si copiás este bloque para una lectura de catálogo, agregale el filtro:** la excepción vale
para el kardex, no para el molde.
> La otra mitad de esa decisión —qué movimientos **nuevos** acepta un ítem ya eliminado— está
> tomada y sin construir: solo los que deshacen algo (anulación, devolución); compra, merma,
> ajuste y recuento se rechazan. Ver `docs/agent/pendientes.md` § "Ya decidido, falta
> construir".

**Dónde ponerlo:** en el **chokepoint**, no en cada llamador. `InventarioService.registrarMovimiento`
es el ejemplo vivo — todo movimiento de stock del sistema pasa por ahí, así que un `JOIN` en
su consulta de lock cubre a sus 16 llamadores y al que se agregue mañana. Repartir la
defensa entre los llamadores funciona hasta que aparece el que se olvida.

> **Por qué algunas tablas del mismo `item_id` SÍ lo llevan, y no es incoherencia:**
> `item_unidad` e `item_lote` —las series y los lotes de un producto— declaran `tenant_id` y
> el código lo verifica (`moverSerie`/`moverLote`). El criterio es de **dónde viene el id**:
> esos `unidadIds`/`loteId` llegan del **body del cliente** y no pasan por la validación del
> ítem, así que necesitan su propio chequeo. El `itemId`, en cambio, siempre se resolvió
> antes contra el tenant. Un id que viene del cliente se verifica donde se usa; uno derivado
> se acota por el padre.

---

## 5. Module

`RepositoriosModule.forFeature([...])` (`src/common/db`) con las entities que el
service inyecta — **nunca `TypeOrmModule.forFeature`**: ese registra repos del
pool, sin los proxies context-aware que resuelven el manager de una transacción
activa (ADR-020), así que un service que los use adentro de `db.transaccion`
reabre el deadlock del pool. Prohibido por lint (`eslint.config.mjs`).
`exports: [<Feature>Service]` si otro módulo lo usa. No importar `RbacModule` ni
`CommonModule` (los guards son globales). Ej.: `monedas.module.ts`.

---

## 6. Service

- **Lectura con SQL raw (joins multi-tabla):** `this.db.query` (nunca
  `this.dataSource.query` — ver §9) con parámetros posicionales (`$1`), filtrando
  `eliminado_el IS NULL` **en cada join**, y mapeo de filas `snake_case` → objeto
  `camelCase`. Ver `monedas.service.ts → findMonedas`.
- **Mutación con transacción (regla "solo uno"):** dentro de
  `this.db.transaccion` (nunca `dataSource.transaction` — ver §9), limpiar el
  flag de todos (`UPDATE ... SET x = false WHERE tenant_id = $1 AND
  eliminado_el IS NULL`) y marcar el nuevo. Validar precondiciones antes.
  ⚠️ **Sin ejemplo vivo desde el 2026-08-21**: el que había (`setDefault` de
  `monedas.service.ts`) se eliminó con su columna, porque el flag competía con
  `pais.moneda_oficial_id` por el nombre "oficial" y terminó decidiendo plata
  (**ADR-021**). El patrón sigue siendo válido; la lección que dejó el caso es
  que un flag "el elegido" **no puede** gobernar una cuenta si ya hay otra
  fuente para lo mismo.
- **Upsert con restauración de soft-deleted:** buscar con `withDeleted: true`; si
  existe, `existing.eliminadoEl = null` (restaurar); si no, `manager.create(...)`.
- **Errores de negocio:** `BadRequestException` con mensaje en español (el frontend
  lo muestra tal cual desde `e.data.message`); `NotFoundException` cuando el recurso
  no aplica al tenant/país.
- **POST/PATCH sin refetch:** armar la respuesta con `RETURNING` + valores ya
  conocidos en la mutación (p. ej. `costoActual` recién costado). **No** llamar
  `findOne` después del write. Create → entidad para insertar en lista; update →
  patch mergeable (`{ id, ...camposTocados }`). El front hace
  `{ ...prev, ...saved }` sin otro GET.
- **Una regla de negocio que vale para dos módulos gemelos va a `common/utils/`,
  no copiada en los dos.** Descuentos y recargos son gemelos y tenían la
  validación del monto duplicada: la copia se mantuvo sincronizada, pero la
  decisión de **cuándo invocarla** vivía repetida en cuatro lugares (`create` y
  `update` × dos services) y en dos se omitió, dejando entrar tramos con un
  "50%" cargado como `50` (ago-2026, `3de96d28`). El costo de la duplicación no
  fue que las copias divergieran, sino que *nadie podía ver de un vistazo si
  todos los caminos la usaban*. Hoy: `common/utils/monto-regla.util.ts`.
- **`RETURNING` con `db.query` siempre pasa por `unwrap()`:** TypeORM +
  pg devuelve `INSERT/UPDATE ... RETURNING` como `[rows, rowCount]`, no como
  `rows` — tipar el resultado directo compila pero trae la forma equivocada en
  runtime. Usar `unwrap<T>(...)` de `common/utils/pg-returning.util.ts` sobre
  el resultado de toda query con `RETURNING`.

---

## 7. Tests (TDD, junto al service)

`<feature>.service.spec.ts` con mocks de repositorio + `Db`
(ver `auth.service.spec.ts`, `monedas.service.spec.ts`):
- `getRepositoryToken(Entity)` para cada repo. **Nunca `getDataSourceToken()`**: el
  service ya no inyecta `DataSource` (§9, ADR-020) — se mockea `Db` directo.
- `{ provide: Db, useValue: dbMock }` con `dbMock = { transaccion: jest.fn((cb) =>
  cb(managerMock)), query: jest.fn(), sinTransaccion: (fn) => fn() }`. `managerMock`
  lleva los métodos que el código bajo test use dentro de la transacción
  (`createQueryBuilder`, `save`, `update`, `getRepository`, …).
- Un test por regla de negocio (rechazos incluidos) + happy path del upsert.

Correr: `cd backend && npm test`. Antes de cerrar: `npm test`, `tsc` limpio, `npm run lint`.

### E2E de API: correr UNA suite, cuando el worktree se llama como el frente (2026-09-19)

El patrón de jest se matchea contra la **ruta absoluta**. En un worktree
`.claude/worktrees/<frente>/`, **toda** ruta contiene `<frente>`, así que filtrar por el nombre
del frente no filtra nada:

```bash
cd backend && npm run test:e2e -- <frente>.e2e-spec   # ✅ 1 suite
```

```bash
cd backend && npm run test:e2e -- <frente>            # ❌ corre las 85 (~6 min)
```

⚠️ **El síntoma engaña porque la suite igual pasa en verde**, solo tarda veinte veces más — es
fácil atribuirlo a "el e2e acá es lento" y convivir con ciclos de seis minutos todo un frente.
Comprobarlo cuesta nada y es instantáneo:

```bash
npx jest --config ./test/jest-e2e.json --listTests <patrón> | grep -c e2e-spec
```

Si ese número es igual al total sin filtro, el problema es la **ruta**, no el patrón. ⛔ Y el
gate de cierre igual corre la suite **entera**: esto es para el ciclo corto mientras se
desarrolla, nunca para cerrar.

---

### E2E de API: todo `.body` del que se saca un valor lleva su `expect(...status)` al lado

En `test/*.e2e-spec.ts`, **leer un campo de una respuesta sin haber afirmado su status
fabrica fallos que aparecen en otro lado.** El caso que lo enseñó fue el helper de login,
replicado en 29 de los 33 specs:

```ts
// ❌ MAL — si el login falla una vez, `token` queda `undefined` en silencio
const resLogin = await request(app.getHttpServer())
  .post('/api/auth/login')
  .send({ email, password });
const initialToken = (resLogin.body as TokenResponse).access_token;

// ✅ BIEN
const resLogin = await request(app.getHttpServer())
  .post('/api/auth/login')
  .send({ email, password });
expect(resLogin.status).toBe(200);
const initialToken = (resLogin.body as TokenResponse).access_token;
```

Sin el `expect`, todo el resto del `describe` manda `Authorization: Bearer undefined`, que
`JwtAuthGuard` rechaza con **401 en la siguiente ruta que se pida, no en la que falló**. Un
test rojo por corrida, siempre otra ruta, nunca reproducible: era la firma exacta del flaky
que se persiguió durante semanas. Con el `expect` puesto, el rojo cae en el login y dice qué
contestó.

⚠️ **`/auth/login` y `/auth/switch-tenant` devuelven 200, no 201**: los dos llevan
`@HttpCode(HttpStatus.OK)` explícito. **`/auth/register` también devuelve 200** desde el
2026-08-15: dejó de emitir sesión para poder responder igual exista o no el correo.

La regla es más ancha que el login —vale para cualquier `.body` del que se extrae un id o un
token para usarlo después—, pero el login es donde más caro sale, porque contamina todo el
archivo en vez de un test.

### E2E de API: el estado que es único por definición, el spec se lo crea (2026-09-18)

Las suites comparten los usuarios del seed y corren una detrás de otra (`maxWorkers: 1` en
`test/jest-e2e.json`: el choque es **secuencial**, no concurrente). Mientras un spec solo **lea**
o cree filas nuevas con `admin.paris@paris.cl`, compartirlo no cuesta nada. Lo que cuesta es
**el estado del que el sistema admite uno solo**: el spec que lo deja abierto le rompe al
siguiente, que pasa aislado y falla en la corrida completa, lejos de la causa.

| Estado único | Por qué choca | Precedente |
|---|---|---|
| Sesión de garzón | una sesión abierta por garzón | garzón propio con `POST /garzones`, que devuelve el PIN una sola vez — `caja-testigo` (`crearGarzon`), `salones-fusion`, `items-pausados` |
| Roles o permisos de un usuario | los hereda todo spec que se loguee con él | usuario propio con `POST /tenants/usuarios` — `permiso-operar-salon` |
| Algo del tenant entero (el último admin, una preferencia) | lo lee el spec que viene después | `tenantPropio` con `POST /admin/tenants` — `membresia-ultimo-admin` |

```ts
// ❌ MAL — Ana del seed (…440238): si el spec cae antes de cerrar, su sesión queda abierta
await request(app.getHttpServer())
  .post('/api/sesiones-garzon/iniciar')
  .set('Authorization', `Bearer ${token}`)
  .send({ turnoId, garzonId: '550e8400-e29b-41d4-a716-446655440238', pin });

// ✅ BIEN — garzón propio en el beforeAll; nadie más lo conoce
const garzon = await crearGarzon(`E2E ${Date.now()}`);
await abrirSesion(garzon.id, garzon.pin);
```

El cierre defensivo (`POST /sesiones-garzon/cerrar` antes de `iniciar`) **no** lo reemplaza:
tapa el choque en este spec y deja el estado cambiado para el siguiente.

⚠️ **La caja física es la excepción, por decisión del owner (2026-09-03):** es una por tenant +
usuario y **se comparte** —las suites la abren con el admin del seed—, pero siempre con
`abrirCaja`/`cerrarCaja` de `test/helpers/caja.ts`, y el `cerrarCaja` en el `afterAll`. El
helper hace las dos fases del cierre: con solo la primera, una caja que vendió en efectivo queda
`en_conciliacion` y el spec siguiente recibe un `409` al abrir.

**El caso que lo trajo:** al sumar `salones-comanda` (2026-08-09), `garzon-modo-personal` cayó con
`400 "El garzón ya tiene una sesión abierta"`; y la familia de rojos intermitentes que primero se
llamó *"el `401` fantasma"* —historia y medición en
[`pendientes.md` § Vigilancia](../agent/pendientes.md#vigilancia--evaluado-y-descartado-no-es-trabajo)—.
**Ante un e2e que falla solo en la corrida completa**, sospechar primero de un recurso del seed
que es único por definición, antes que del código.

---

## 8. Seeding

Dos lugares, ambos en el **mismo commit**:

1. **Al crear el tenant** (`tenants.service.ts → create()`, dentro de la transacción
   que ya siembra rol admin + fórmula de precio + caja virtual): agregar lo que todo
   tenant nuevo necesita.
2. **Seeder de desarrollo** (`modules/seeder/seeder.service.ts` — **fuente de
   verdad**, corre al arrancar): un método privado `seed<Entidad>()` idempotente,
   llamado en `onApplicationBootstrap` después de sus dependencias. IDs fijos
   `550e8400-e29b-41d4-a716-446655440XXX` (siguiente número libre); PKs compuestas
   no necesitan ID fijo. Registrar la entity en `seeder.module.ts` (`forFeature`).

   **Encontrar el siguiente número libre — un grep de literales no alcanza.**
   `grep -o "446655440[0-9]\{3\}"` solo ve strings fijos (`'550e8400-...-446655440XXX'`) y
   **no ve los IDs generados en runtime**: funciones `uuid(n)` locales a un método
   (`const uuid = (n) => \`550e8400-e29b-41d4-a716-44665544${String(n).padStart(4,
   '0')}\``) llamadas como `uuid(281)` sueltos, o dentro de un loop como
   `uuid(id++)` con `let id = 291`. Esos rangos son invisibles para el grep pero
   ocupan IDs igual. Ya causó una colisión real: el grep sugería 292 como libre,
   pero el máximo realmente ocupado (por dos rangos dinámicos: `uuid(id++)` de un
   loop de permisos y `uuid(N)` sueltos de otro método) era 315 — sembrar en 292
   habría chocado en runtime, no en compilación (ver
   `seeder.service.ts → seedMotivosDiferenciaInventario`, comentario en el código).

   Antes de fijar un rango nuevo:
   1. `grep -o "446655440[0-9]\{3\}" backend/src/modules/seeder/seeder.service.ts | sort -u | tail`
      da un piso, no el máximo real.
   2. Buscar además **todos** los generadores dinámicos: `grep -n "const uuid = "` y,
      por cada uno, leer el rango que cubre — el argumento de cada `uuid(N)` suelto
      y el valor inicial + cantidad de iteraciones de cada `uuid(id++)` en loop.
   3. El máximo real es el mayor de todos los anteriores. Empezar el rango nuevo ahí
      + 1, y dejar un comentario en el código (como el de
      `seedMotivosDiferenciaInventario`) explicando qué rangos dinámicos ya estaban
      ocupados, para que el próximo no repita el grep ingenuo.
   4. ⚠️ **El grep va contra el CÓDIGO, no contra `docs/`** (2026-09-19). Un plan o una spec
      que *planea* tomar unos IDs los nombra en prosa, así que incluir `docs/` los devuelve
      como "ocupados" y el resultado se lee al revés: un ID está tomado cuando lo usa el
      **seed**, no cuando lo menciona el documento que planea usarlo. El falso positivo
      empuja al siguiente rango y desperdicia el bloque reservado, en silencio.

      ```bash
      grep -rn "446655440[0-9]\{3\}" backend/src backend/test frontend/app
      ```

---

## 9. Contexto transaccional (ALS) — `Db`, nunca `DataSource` directo

Todo acceso a datos fuera de un repositorio pasa por `Db`
(`src/common/db/db.service.ts`), inyectado en el constructor como cualquier otro
provider. **Inyectar `DataSource` directo está prohibido por lint** en
`src/**/*.ts` (excepciones: la propia fachada, el seeder y `*.spec.ts`) — mismo
lint que prohíbe **registrar** un módulo con `TypeOrmModule.forFeature` en vez
de `RepositoriosModule.forFeature` (§5): ese registro es la precondición de
todo este mecanismo, sin ella el proxy de repos no aplica. El porqué completo,
con el deadlock que motivó esto y las alternativas descartadas, está en
[ADR-020](../adr/020-contexto-transaccional-als.md).

- **Transacciones: `db.transaccion(fn)`, nunca `dataSource.transaction(...)`.**
  Abre la transacción y ata su `EntityManager` al contexto (`AsyncLocalStorage`);
  todo repo inyectado (`@InjectRepository`) y todo `db.query(...)` que corra
  dentro de `fn` resuelve ese manager **automáticamente**, sin que el callback
  necesite pasarlo a mano. Si `fn` llama a otro service que a su vez abre
  `db.transaccion(...)`, esa segunda llamada **reusa** la transacción activa en
  vez de anidar — es lo que hace seguro envolver código preexistente en una
  transacción nueva, en vez de reabrir el deadlock que ADR-020 describe.
  ```ts
  await this.db.transaccion(async () => {
    await this.tenantMonedaRepo.update(...);   // mismo manager, sin pasarlo
    await this.catalogoService.algo(tenantId);  // idem, aunque no reciba manager
  });
  ```
- **Queries crudas: `db.query(sql, params)`, nunca `dataSource.query(...)`.**
  Usa el manager del contexto si hay una transacción activa, el pool si no.
  Mismas reglas de siempre: parámetros posicionales, `eliminado_el IS NULL` en
  cada join, `RETURNING` por `unwrap()` (§6).
- **`db.sinTransaccion(fn)` — salida explícita, para semántica deliberada de
  fuera-de-transacción.** Corre `fn` con el contexto vaciado: una conexión
  propia del pool aunque haya una transacción activa alrededor. Dos ejemplos
  reales de **por qué** se necesita, no solo de sintaxis:
  - **Auditoría que debe sobrevivir a un rollback** (`cobros.service.ts`): un
    registro que tiene que quedar escrito aunque la operación que audita
    termine deshaciéndose no puede compartir el manager de esa operación —si
    comparte transacción, el rollback se lo lleva puesto.
  - **Poda de housekeeping sin atadura de atomicidad** (`auth.service.ts`, la
    limpieza de refresh tokens vencidos tras rotar uno): no necesita ser
    atómica con la rotación del token —el resultado de la poda no afecta si la
    rotación tuvo éxito— así que alargar el lock de la transacción principal
    para incluirla sería costo sin beneficio.
  📌 **Primer uso real (2026-08-23): `CajaService.conRastroDeRechazo`** — el rastro
  de un intento de retiro rechazado, que tiene que quedar escrito aunque el
  `422` que lo produjo aborte la transacción. Y muestra la forma completa, que
  es **dos piezas, no una**:
  1. **El `catch` va en el BORDE, por fuera de `db.transaccion`.** Cuando corre,
     TypeORM ya hizo el rollback y ya devolvió la conexión al pool: la escritura
     no comparte nada con lo deshecho **y no toma una segunda conexión
     simultánea** — que es el deadlock de [ADR-020](../adr/020-contexto-transaccional-als.md).
     Escribir el rastro *adentro* del callback con `sinTransaccion` funciona,
     pero duplica conexiones justo en el camino que un atacante puede repetir.
  2. **`sinTransaccion` alrededor de la escritura, igual**, como red: si algún
     llamador envuelve la operación en una transacción PROPIA, `db.transaccion`
     la reusa en vez de anidar, el rollback no ocurre en ese nivel y el contexto
     ALS sigue activo cuando llega el `catch`. Sin `sinTransaccion` el repo
     resolvería ese manager y el rastro se perdería igual.
  ⚠️ **Y una consecuencia de esquema:** una tabla que se escribe fuera de la
  transacción que está muriendo **no puede declarar FK** a una fila que esa
  transacción retiene con `FOR UPDATE`. El FK pide `FOR KEY SHARE` sobre ella; se
  esperan mutuamente. `caja_intentos_rechazados` no declara relaciones a `cajas`
  ni a `usuarios` por esto.
- **El `manager: EntityManager` explícito en una firma preexistente sigue
  siendo válido — no migrar por migrar.** Donde ya se enhebra a mano
  (`calcularEsperadoEfectivo(cajaId, manager)` y similares) es correcto y el
  explícito gana: agrandar el diff sacándolo no aporta nada. El mecanismo de
  `Db` existe para el código que **no** enhebraba manager y por eso deadlockeaba
  (ADR-020) — no para reemplazar el enhebrado que ya funcionaba.
- **Un `manager?: EntityManager` OPCIONAL ya no significa "fuera de la
  transacción" si se omite.** El idioma
  `const repo = manager ? manager.getRepository(X) : this.repo` sobrevive en 8
  sitios y su contrato se dio vuelta: `this.repo` es el proxy context-aware, así
  que la rama sin `manager` participa de la transacción ambiente y el rollback
  se lleva lo escrito. Antes de ADR-020 esa rama era una conexión propia. Para
  correr deliberadamente fuera está `db.sinTransaccion`, y solo eso.
- **Guardar una referencia a un método de repo y llamarla después pierde el
  contexto.** Ver `docs/agent/anti-patterns.md` — el proxy resuelve el manager
  en el acceso a la propiedad, no en la invocación.

---

## 9b. Contexto de request (ALS) — nunca `@Inject(REQUEST)`

Un provider que necesita el usuario del token **no lo pide por inyección**: lo lee de
`RequestContext` (`src/common/context/request-context.ts`), un `AsyncLocalStorage`
sembrado por un interceptor global con `req.user`.

**El motivo es estructural, no de rendimiento.** `@Inject(REQUEST)` obliga al provider a
`Scope.REQUEST`, y Nest **propaga ese scope hacia arriba**: el controller anfitrión entero
pasa a instanciarse por request, incluidas sus rutas de lectura, que no tocan al provider.
Es un costo invisible que crece solo cada vez que alguien cuelga ese provider de un
controller nuevo, y la disciplina que lo contenía —*"colgalo del controller más chico"*—
no se puede verificar en una revisión.

- **Sembrar con `run`, no con `enterWith`.** Las dos funcionan (medido); `enterWith` no
  cierra el contexto al volver.
- **Interceptor, no middleware.** El middleware corre **antes** de los guards, así que
  todavía no hay `req.user` — lo pone Passport dentro de `JwtAuthGuard`.
- **El estado por request va en el store, no en el provider.** Un memo en la instancia de
  un singleton le serviría el dato del primer tenant a todos los demás. `EscalaMonedaPipe`
  memoiza ahí los decimales de la moneda: una consulta por request, y con la clave del
  tenant al lado.
- **Fuera de un request** (jobs, seeder, tests que no lo siembran) `actual()` devuelve
  `undefined`: quien lo use decide qué hacer, no asume que hay usuario.

⚠️ **Lo que NO justifica este patrón: un número de throughput.** La entrada que lo motivó
midió ~7% menos req/s con el pipe request-scoped, con dos rondas por brazo. Al migrar se
rehízo el A/B con **seis rondas por brazo** en la misma máquina y **los brazos se
superponen**: lo que domina la serie es el calentamiento. Si alguien va a citar un número
para justificar un cambio de scope, que lo mida con rondas suficientes — y que compare
tramos calientes, no la primera ronda.

Es el hermano de `TxContext` (§9): mismo mecanismo, otro contenido.

---

## 10. Paginación server-side

Para listados grandes (pagos, ventas, kardex):

- **DTO:** extender `common/dto/pagination-query.dto.ts` (`page` 1-based default 1,
  `pageSize` default 15 max 100) con los filtros del recurso.
- **Utils:** `common/utils/pagination.util.ts` — `resolvePagination(query)` →
  `{ page, pageSize, offset }`; `buildPaginationMeta(page, pageSize, total)`.
- **Respuesta:** `PaginatedResponse<T>` (`common/interfaces/`) = `{ data, meta }`.
- **Service (SQL raw):** `WHERE` compartido (tenant + soft delete + filtros) →
  `COUNT(*)` → `SELECT ... ORDER BY ... LIMIT $n OFFSET $m`.
- **Controller:** rutas estáticas (`/resumen`, `/preferencias`) **antes** de rutas
  con params. KPIs/agregados globales van en endpoint separado (`GET /pagos/resumen`),
  no en `data[]`.

---

## 10b. El día se arma en un solo lugar: `rango-fecha.util.ts`

`AppDateInput` emite **fecha pura** (`YYYY-MM-DD`) y los DTOs validan con
`@IsDateString()`, que también acepta un timestamp. Contra una columna
`timestamptz`, una fecha pura se castea a la **medianoche**, así que a qué rango
—y a qué **día**— pertenece es una decisión del backend, nunca de Postgres ni de
cada service por su cuenta.

**No es el día calendario, es el día del NEGOCIO.** Cada tenant tiene una
`hora_corte` (`tenants.hora_corte`, entero 0–6, default 0): la hora local en que
termina su día. Con corte 0 el día del negocio coincide con la medianoche de
siempre; con un corte mayor, una venta de la madrugada cuenta en el día anterior.
`diaNegocioTenant(db, tenantId)` trae `{ zona, horaCorte }` en una sola consulta
(la zona sale de la **provincia** del tenant, no del país); `empujarDiaNegocio(params,
dia)` empuja los dos al array de params del llamador y devuelve sus posiciones
(`IdxDiaNegocio { zona, corte }`) para pasarlas a los helpers de abajo.

| Borde | Helper | Fecha pura | Timestamp |
|---|---|---|---|
| Inferior (`desde`) | `bordeFechaSql(col, '>=', valor, idxValor, idx)` | `>= inicio del día del negocio` | `>= $n`, tal cual |
| Superior (`hasta`) | **`bordeHastaSql(col, valor, idxValor, idx)`** | `< inicio del día del negocio SIGUIENTE` — **inclusivo del día** | `<= $n`, tal cual |

`idx` es el `IdxDiaNegocio` de `empujarDiaNegocio` (`null` si ningún borde del
llamador es fecha pura, ver `requiereDiaNegocio` más abajo). Para colapsar un
**instante** a su día del negocio dentro del SQL (un `NOW()`, un `GROUP BY` de
serie diaria) está `diaNegocioDeSql(instanteSql, idx)` — la contraparte SQL de
`diaNegocioEnZona` (TypeScript, para un `Date` ya en memoria). Las dos siguen el
mismo orden: primero a hora LOCAL, recién ahí se resta el corte, porque restarlo
sobre el instante crudo aterriza en el día equivocado la noche del cambio de
horario (docblock de `diaNegocioEnZona`).

- **`hasta` es inclusivo del día** (decisión del owner, 2026-08-22): quien elige
  "16" ve el 16 completo. Se resuelve acá y no compensando en cada pantalla, para
  que la respuesta no dependa de qué llamador la arme. Antes era `<= hasta` y **se
  comía el día entero**.
- **Nunca `hasta 23:59:59`**: se come el último segundo y falla distinto según los
  decimales del `timestamptz`. La suma la hace Postgres (`::date + 1`), que además
  es DST-correcta sin librería de zonas.
- **Un timestamp explícito no se expande, en ninguno de los dos bordes.** Quien
  manda `T15:30:00Z` pidió ese instante; `::date` le comería la hora en silencio y
  el filtro se ensancharía sin avisar.
- **`requiereDiaNegocio(...)` antes de pushear zona/corte al array de params:** si
  ningún borde es fecha pura, el SQL no los nombra y Postgres **rechaza el bind**
  con un parámetro de más (*"bind message supplies N parameters"*) → 500. Cada
  consulta que este frente tocó (2026-09-19) lleva además un test que compara cada
  `$n` contra la posición real en `params`: un parámetro que la SQL no referencia
  compila y pasa lint igual, y solo lo caza Postgres real (e2e).

⚠️ **Invariante: nadie arma el día a mano.** Un `AT TIME ZONE $` o un
`CURRENT_DATE` sueltos, o un colapso con `Intl` (`instanteLocalEnZona` /
`instanteLocalTenant` / `fechaLocalTenant`) fuera de este archivo, reintroducen el
bug que la hora de corte existe para cerrar — en silencio, porque compilan y pasan
lint igual. `common/invariants/dia-negocio.invariant.spec.ts` barre todo
`src/modules` y lo rechaza, con una allowlist chica para lo que sí es hora de
RELOJ y no día de negocio: el motor de precios y las promociones (vigencia de una
regla por horario).

⚠️ **La otra convención que convive, y por qué no se unificó:** los reportes y la
liquidación de propinas usan un borde superior **exclusivo compensado por el
llamador** — `propina-reportes` recibe `hasta` y filtra `< hasta`, y la pantalla le
manda el primer día del mes siguiente (`rangoMesActual()`); la liquidación manda un
instante ya corrido. **Funciona y está fuera del alcance de la corrección de
2026-08-22**: tocar el backend sin tocar esos dos llamadores haría que el resumen
de agosto incluyera el 1° de septiembre. Los dos pasan igual por el corte del
tenant (`inicioDiaNegocioSql`/`diaNegocioDeSql`, 2026-09-19). Si algún día se
unifica con `bordeFechaSql`/`bordeHastaSql`, van juntos backend y llamador, y las
consultas de liquidación comparan **períodos guardados** (`fecha_desde`/
`fecha_hasta`), no eventos — es otro análisis.

---

## 10c. Dónde vive un reporte

Un reporte **de negocio** vive en `src/modules/reportes/<slug>/`, una carpeta por reporte. Un
listado filtrable que alguien usa mientras opera —buscar una boleta, ver qué se movió, aprobar un
cierre— **no es un reporte** y se queda en su módulo, aunque tenga filtro de fecha. El criterio
completo y la clasificación de los que ya existían: `docs/features/modulo-reportes.md`.

```
src/modules/reportes/
  reportes.module.ts              registra el controller y el service de cada reporte
  <slug>/{controller,service,dto/}
```

⚠️ **No hay —todavía— un DTO base compartido de rango.** Con un solo reporte no tendría
consumidores, y un `extends` que nadie usa es código muerto. Cuando exista el segundo, `desde`/
`hasta` suben a `reportes/dto/`; hasta entonces cada reporte los declara con las reglas de abajo.

| Aspecto | La regla | De dónde sale |
|---|---|---|
| Rutas | `GET /reportes/<slug>` (listado paginado) y `/reportes/<slug>/resumen` (agregados, sin paginar) | § 10 |
| Permiso | un `modulo_app` **propio por reporte** (`url: '/reportes/<slug>'`) con permiso `Leer` | `Resumen del negocio` |
| El día | `diaNegocioTenant` → `requiereDiaNegocio` → `empujarDiaNegocio` → `bordeFechaSql`/**`bordeHastaSql`** | § 10b |
| Rango | **opcional** en el listado (pagina); **obligatorio con tope de 366 días** en el resumen, que corre sin `LIMIT` | `FindAnulacionesDto` vs `ResumenAnulacionesDto` |
| Paginación | `PaginationQueryDto` → `resolvePagination` → `COUNT(*)` → `LIMIT/OFFSET` → `PaginatedResponse<T>` | § 10 |
| Plata | `SUM(ROUND(cantidad * costo_unitario, 4))` agrupado por `items.moneda_id`, **nunca convertida**, con `bool_or(costo_unitario IS NULL)` | `anulaciones-reporte.service.ts` |
| Módulo Nest | sin entidad ni `forFeature`: los reportes solo **leen** tablas de otros módulos. `Db` y `RbacService` son globales | `ResumenNegocioModule` |

⛔ **Un `modulo_app` sin su fila en `tenant_modulos` da 403 hasta al admin del tenant**
(`RbacService.userHasPermiso` mira los módulos contratados también para el rol fijo). Es el paso
que más fácil se olvida al agregar un reporte, y el síntoma —*"no me deja entrar a mí, que soy el
dueño"*— no apunta al seed. Sembrar un reporte son **cuatro** lugares en `seeder.service.ts`:
`seedModulosApp`, `seedModuloAppPermisos`, `seedTenantModulo` y el rol que lo va a usar.

⛔ **Lo que ordena o filtra la página tiene que calcularse EN la consulta que pagina.** Un reporte
que ordena por plata perdida, o que esconde las filas sin diferencia, no puede resolver ese número
en una segunda consulta sobre las filas ya elegidas: eso ordena *dentro* de la página y filtra
después de contar. El modo de falla es silencioso —la pantalla se ve perfectamente ordenada—, y el
`COUNT` miente distinto que el `LIMIT`. La forma que resolvió esto en varianza: la agregación de
grupos va a una subconsulta y el número colgado de un `LEFT JOIN LATERAL`, con el `ORDER BY` y el
`WHERE` ahí.

⚠️ **El precio, que conviene saber antes de elegir ese orden.** El `ORDER BY` queda por encima del
`LIMIT`, así que se evalúan **todos** los grupos del rango, no los 15 de la página: no se puede
saber cuáles son los 15 más caros sin calcularlos todos. La pregunta no es cómo evitarlo sino si el
reporte lo aguanta al escalar. Con filtro, el `COUNT` agrega su propio barrido: dos por request.

⛔ **Y la forma se elige midiendo con la tabla GRANDE y en el caso SIN filtros.** En varianza se
probaron las dos —`LATERAL` correlacionado contra agregación de conjunto (`CTE` + `GROUP BY`)— con
el kardex inflado a 198.293 movimientos: sin filtros, la de conjunto da **36,9 ms** (`Seq Scan` de
la tabla entera) contra **7,3 ms** del `LATERAL`; filtrando un solo producto, la de conjunto da
**0,5 ms**, porque ahí el planner sí empuja la clave al índice. No es que una forma no pueda usar
índices: es que **la de conjunto cambia de plan según cuántos grupos sobrevivan**, y la vista por
defecto de un reporte es la de muchos grupos. Dos trampas de medición, entonces: medir con datos de
seed (la tabla chica hace barato el `Seq Scan`) y medir con el filtro puesto (esconde el caso que
la pantalla abre primero).

⚠️ Esos milisegundos son **de una máquina y un caché**, no una constante: al remedir van a salir
otros dígitos. Lo que tiene que reproducir es la **forma del plan** —índice contra `Seq Scan`— y el
orden de magnitud entre las dos formas. Si aparece un `Seq Scan` donde había índice, eso sí es una
regresión.

⚠️ **Y si ese número queda calculado en dos consultas, va a una constante compartida.** Dos textos
SQL iguales hoy derivan mañana, y entonces la fila muestra un número y la página se ordenó por
otro: ninguno de los dos test falla, porque cada uno por separado está bien.

⚠️ **Un permiso por reporte, no un `Reportes:Leer` común.** El guard solo sabe hacer **O**, nunca
**Y** (`requires-permiso.decorator.ts`), así que cada ruta elige un par. Con un permiso compartido,
el reporte que se agregue dentro de seis meses le aparece a todo el que tenga los de hoy sin que
nadie lo decida.

---

## 11. Preferencias de usuario

Preferencias **personales** (UX), distintas de las financieras del tenant.
Columna `usuarios.preferencias JSONB NOT NULL DEFAULT '{}'`
(shape `{ ui?: { colorMode?, pageSize? } }`); utils en
`common/utils/usuario-preferencias.util.ts` (`normalize`/`merge`).
API: `GET /auth/me` incluye `preferencias`; `PATCH /me/preferencias` hace merge
parcial validado con DTO anidado. Defaults en código: `colorMode: 'light'`,
`pageSize: 15`. Alcance **usuario**, no tenant.

---

## 13. Callback desacoplado entre módulos (registry + `onModuleInit`)

Cuando un módulo "core" debe notificar a uno de negocio **sin importarlo** (p. ej.
`pasarela` NO importa `online`/`ventas`): el core define una interfaz de handler y
un **registry singleton** (`register(h)` / `get()`) que **exporta**; el módulo de
negocio importa el core y declara un provider que implementa la interfaz y se
registra en `onModuleInit`. El borde se cruza en una sola dirección (negocio → core).
Implementación de referencia: `modules/pasarela` (`PagoCallbackRegistry` +
`OnlineCallbackHandler`).

Claves: el dispatcher hace `registry.get()?.onOrdenResuelta(orden)` con `await`
(monolito) o POST fire-and-forget (destinos externos); el handler debe ser
**idempotente**; un fallo del callback no rompe el flujo del core (`try/catch` + log).

---

## 14. Upsert-preservando UUID por llave de negocio

Cuando un flujo de "reemplazo total" (`PATCH` que recibe la lista completa de
hijos y reemplaza lo existente) tiene **otra tabla que referencia el UUID del
hijo** (un override, una tabla puente, un snapshot), el patrón habitual
**soft-delete todo lo vivo + insertar todo lo nuevo** rompe esa referencia: el
hijo recibe un UUID nuevo en cada guardado, y cualquier fila que apuntaba al
UUID viejo queda huérfana (apunta a algo ya soft-deleted).

**Patrón: upsert-preservando por llave de negocio.**
1. Cargar los hijos vivos actuales con su UUID.
2. Por cada hijo entrante, resolver su **llave de negocio** estable (no el
   UUID) — ej. `itemId` de una opción de grupo, `grupoModificadorId` de una
   asociación item↔grupo. Si coincide con uno vivo existente: `UPDATE` sobre
   ese mismo UUID (preserva la fila, y por lo tanto todo lo que la referencia).
   Si no coincide con ninguno: `INSERT` con UUID nuevo.
3. Los vivos que ya no vinieron en la lista entrante: `soft-delete`.
4. **Cascada**: si el hijo soft-deleted tiene sus propios overrides/hijos en
   otra tabla, soft-deletearlos también en la misma pasada (`WHERE
   <fk_del_padre> = ANY($1::uuid[])`) — para que no queden vivos apuntando a
   un padre eliminado.

Ejemplo real: `GruposModificadoresService.update` (opciones de un grupo,
llave de negocio `itemId` → preserva `grupo_opcion_id`) y el análogo en
`ItemsService` para `item_grupos_modificadores` (llave de negocio
`grupoModificadorId` → preserva `item_grupo_id`) — ambos con cascada de
soft-delete a `item_grupo_modificador_opciones` (los overrides por receta,
llavados por `item_grupo_id` + `grupo_opcion_id`, los dos UUIDs preservados).
Ver `docs/features/grupos-modificadores.md` § "Cantidades de consumo por
item" y [ADR-014](../adr/014-cantidades-consumo-por-item.md).

**Cuándo NO hace falta:** si nada referencia el UUID del hijo (soft-delete +
insert es más simple y suficiente, **salvo el caso de §14b**) o si la llave de
negocio no es estable (ej. un texto libre editable) — ahí no hay forma de saber
con certeza qué fila entrante "es" cuál existente, y forzar el upsert arriesga
más que soft-delete + insert.

### 14b. La puente con PK compuesta se revive, no se reinserta (2026-09-01)

La excepción al párrafo de arriba, y costó plata. Cuando el hijo **no tiene UUID
propio** sino PK compuesta `(padre_id, referencia_id)` —las puentes
`descuento_metodo_pago`, `recargo_metodo_pago`—, soft-delete + insert no alcanza
porque **no hay fila nueva que insertar**: la que corresponde ya existe, apagada.

`manager.save()` no avisa de eso, y su conducta es contraintuitiva: TypeORM carga
los subjects **con** los borrados (`withDeleted: true`, en
`SubjectDatabaseEntityLoader`), así que encuentra la fila apagada por su PK y
resuelve el save como `UPDATE` en vez de `INSERT`; y como la entidad recién
creada trae `eliminadoEl: undefined`, el computador de columnas cambiadas la
saltea —`undefined` significa "no cambió"— y `eliminado_el` nunca se limpia. La
fila queda muerta, la asociación desaparece y la respuesta es 200.

❌ **Mal**

```ts
await manager.update(
  DescuentoMetodoPago,
  { descuentoId: id },
  { eliminadoEl: new Date() },
);
await manager.save(
  ids.map((mid) =>
    manager.create(DescuentoMetodoPago, { descuentoId: id, metodoPagoId: mid }),
  ),
);
```

✅ **Bien** — una sola sentencia para los N, y revive lo apagado:

```ts
await manager.query(
  `INSERT INTO descuento_metodo_pago (descuento_id, metodo_pago_id, creado_el, actualizado_el)
   VALUES ${ids.map((_, i) => `($1, $${i + 2}, NOW(), NOW())`).join(', ')}
   ON CONFLICT (descuento_id, metodo_pago_id)
   DO UPDATE SET eliminado_el = NULL, actualizado_el = NOW()`,
  [id, ...ids],
);
```

Mismo molde que `roles.service.ts` con `roles_usuarios` y `tenants.service.ts`.

⚠️ **La lista entrante tiene que venir sin repetidos, y eso lo pide el DTO**
(`@ArrayUnique()`, como las listas de ids de `propinas` y `recuentos`): `ON
CONFLICT DO UPDATE` no puede tocar la misma fila dos veces en una sentencia
(Postgres 21000). Deduplicar dentro del service en vez de validar en el borde
deja la respuesta haciendo eco de una lista que no es la que se guardó.

**Para UNA fila** hay respuesta tipada y no hace falta bajar a SQL cruda:
`metodos-pago.service.ts` (`upsertRow`, sobre `tenant_metodo_pago`, que también
es PK compuesta con soft delete) hace `findOne({ withDeleted: true })` →
`eliminadoEl = null` → `save`. El `ON CONFLICT` gana cuando son N y no se quiere
una query por id.

⚠️ **Por qué pasó inadvertido tanto tiempo:** el método que *nunca* estuvo en la
lista sí entra —no tiene fila previa que lo bloquee—, así que **reemplazar la
lista entera por otra distinta funciona** y lo que se rompe es agregarle uno a la
que ya está, o devolver uno que se sacó. La cara peor es la lista que se achica:
ahí ninguna fila es nueva y la regla queda **sin ningún método**, que para una
regla por método de pago significa que deja de aplicarse. Medido por API el
2026-09-01 y fijado en `backend/test/reglas-valor.e2e-spec.ts`.

📌 **El seeder todavía tiene la forma ❌** (`seedDescuentoMetodosPago` /
`seedRecargoMetodosPago`: `findOne` —que excluye borrados— → `save`). No se tocó
porque es dev-only, pero el escenario no es teórico: las filas sembradas cuelgan
de reglas de tenant **editables desde la pantalla** —"Descuento pago en efectivo
3%", de Paris, es una—, así que un `PATCH` local que les cambie el método las
deja apagadas, el re-seed las "recrea" muertas y el síntoma va a parecer
contaminación de la base.

---

## 15. Orden de bloqueo de filas en ítems compuestos

Toda transacción que escriba más de una de estas tablas las toma **en este orden**,
y dentro de cada tabla pide las filas **ordenadas por `item_id`**:

```
item_receta  →  item_combo  →  items
```

Un camino puede **saltear** tablas (un lote de solo combos no escribe ninguna fila
de `item_receta`); lo que no puede es **invertirlas**.

**Por qué.** Dos transacciones que piden las mismas filas al revés se abrazan, y
Postgres mata a una con `40P01`. El usuario ve un 500: nada queda corrupto —la
transacción víctima se revierte entera— pero su operación no se hizo, y acá nadie
reintenta el `40P01` (a diferencia de `ventas.crear()` y `recuentos.service.ts` §
`aplicar()`, que sí reintentan una vez). El orden **entre** tablas
no alcanza por sí solo: dos lotes que traigan las mismas dos recetas en sentidos
opuestos cierran el mismo ciclo **dentro** de una tabla. Por eso el orden por
`item_id` es parte de la regla, no un detalle del `ORDER BY`.

**El `ORDER BY` de un `SELECT … FOR UPDATE` SÍ decide el orden de adquisición** —no es
decorativo ni "una ayuda al plan"—. Medido el 2026-09-07 sobre el statement de
`TrasladosService`: el `EXPLAIN` pone el nodo `LockRows` **arriba** del `Sort`, así que las
filas se bloquean ya ordenadas. Comprobado además de afuera, con tres sesiones: con `X < Y`,
una retiene `X`, otra corre el `SELECT … item_id = ANY(ARRAY[Y, X]) … FOR UPDATE` y una
tercera prueba `SELECT … Y … FOR UPDATE NOWAIT`. Con `ORDER BY item_id` la segunda se encola
en `X` **sin** haber tomado `Y`; con `ORDER BY item_id DESC` toma `Y` y después se encola.
El orden del array **no** interviene en ningún caso.

**Y por eso el `ORDER BY` es lo que hace que la garantía sea del código.** Si se lo saca, el
orden pasa a salir del plan (un hash join sobre el heap, en la medición) — que hoy también es
igual para las dos transacciones, así que el deadlock tampoco aparece: **ningún test de
conducta puede cazar su ausencia**. Lo que sí la caza es un unitario que afirme sobre el SQL
del statement, y por eso existen (`items.service.spec.ts` para `aplicarDesfases`,
`traslados.service.spec.ts` para el traslado). Si escribís un camino nuevo con locks
ordenados, el `ORDER BY` va con su unitario o no queda fijado por nada.

**Un `UPDATE` cuenta como lock.** No hace falta un `FOR UPDATE` explícito para
participar del orden: el `UPDATE` toma el lock de la fila cuando se ejecuta, así
que el orden de bloqueo de un camino sin locks explícitos es simplemente el orden
en que itera. `descartarDesfases` es exactamente ese caso —no toma un solo
`FOR UPDATE`— y aun así tiene que respetar la regla: la cumple partiendo el lote
en dos pasadas, recetas primero, cada una ordenada por `item_id`.

**El alta no participa.** Un `INSERT` de filas nuevas no compite con nadie: nadie
más puede tener ni pedir una fila que todavía no existe, y la fila padre de `items`
la insertó la misma transacción. Por eso `create()` inserta `items` antes que
`item_receta`/`item_combo` sin violar nada.

**Dónde se fija** (todo en `backend/src/modules/items/`):

| Camino | Cómo toma el orden | Test que lo fija (`items.service.spec.ts`) |
|---|---|---|
| `aplicarDesfases` | dos `SELECT … ORDER BY item_id FOR UPDATE`, `item_receta` y después `item_combo`, antes de leer ingredientes; si el lote actualiza precios, un tercero sobre esas filas de `items`, también `ORDER BY item_id`; los `UPDATE items` del precio van después de los tres | `aplicar sobre N recetas hace lecturas CONSTANTES…` (afirma las dos tablas y sus `ORDER BY`), `aplicar sobre N combos hace lecturas CONSTANTES…`, `valida el tenant ANTES de tomar los locks`, `toma FOR UPDATE ordenado sobre los items cuyo precio actualiza…` |
| `descartarDesfases` | dos pasadas ordenadas, sin locks explícitos | `descartar escribe item_receta ANTES que item_combo…`, `descartar ordena por item_id DENTRO de la pasada de recetas…` |
| `update()` de un ítem compuesto | `FOR UPDATE` sobre `item_receta`/`item_combo` **antes** del `UPDATE items`, bajo el mismo guard que el branch que después escribe esa tabla; y en todo `update()`, `FOR KEY SHARE` sobre el propio ítem vivo **después** de ese lock y antes del `UPDATE items` (el par del `FOR UPDATE` de `remove()`, 2026-09-15) | `toma item_combo ANTES del UPDATE items — orden de locks contra aplicarDesfases`, «toma `FOR KEY SHARE` sobre `items` después del lock de `item_receta` y antes del `UPDATE items`» |

**Fuera de estas tres tablas, el mismo criterio con la asociación receta↔grupo** (2026-09-15):
`GruposModificadoresService.aplicarOverrides` toma las asociaciones que valida
`ORDER BY item_grupo_id FOR SHARE`, y `ItemsService.asociarGruposModificadores`, al quitar un grupo,
soft-borra la asociación **antes** que sus overrides. Con el orden invertido, el `UPDATE` de los
overrides corre sin esperar, no ve el override de aplicar mientras aplicar no commitea, y lo deja vivo. Lo fijan
las carreras 12 y 13 de `backend/test/borrado-item-concurrente.e2e-spec.ts` y un unitario por lado.

**El orden es el de adquisición del lock, no el de la escritura.** En un lote mixto
`aplicarDesfases` hace el `UPDATE items` del precio de una receta **antes** del
`UPDATE item_combo` de un combo del mismo lote, y no viola nada: la fila de
`item_combo` ya quedó bloqueada por el `FOR UPDATE` del principio, y un lock que ya
se tiene no se vuelve a pedir. Lo que la regla ordena es el momento en que cada fila
se **toma** por primera vez. De ahí que un camino que no tome locks explícitos
—`descartarDesfases`— tenga que ordenar sus `UPDATE`: ahí el momento de la escritura
**es** el momento de la toma.

Y un reproductor de deadlock real, `backend/test/orden-locks-desfases.e2e-spec.ts`:
dos requests HTTP con el mismo par receta/combo en órdenes opuestos, con el
interleaving forzado por una compuerta. **Su alcance es angosto y su encabezado lo
declara:** cubre `descartar` contra `descartar` y `descartar` contra `aplicar`, con
exactamente una receta y un combo. No dice nada del alta ni de la edición de ítems
compuestos, ni del orden intra-tabla. La edición y el orden intra-tabla los cubren los
unit tests de la tabla de arriba; **el alta no tiene test de orden de locks y no lo
necesita** —no participa del orden, por lo dicho más arriba—. Leer ese encabezado antes
de citarlo como evidencia de algo más ancho.

### Las reglas van antes que todo eso (2026-08-28)

La cadena completa, con las tablas de reglas al frente:

```
recargos  →  descuentos  →  item_receta  →  item_combo  →  items
```

`ItemsService.validarReglas` toma **`FOR SHARE`** sobre las filas de la regla —en el
mismo statement que lee `nivel`— antes de escribir la tabla puente, y lo hace en ese
orden entre las dos tablas en sus dos llamadores (`create` y `update`). El otro lado,
`validarCambioDeNivel` de `descuentos.service.ts` / `recargos.service.ts`, corre
**dentro** de `db.transaccion` y toma **`FOR UPDATE`** sobre la misma fila antes de
contar las filas puente.

**Por qué `FOR SHARE` de un lado y `FOR UPDATE` del otro.** Dos asociaciones de la
misma regla a ítems distintos no tienen por qué estorbarse; lo único que hay que
excluir es el cambio de nivel. Y el lock va en el mismo statement que lee `nivel`
porque, cuando la espera se resuelve, Postgres reevalúa la fila ya actualizada
(EvalPlanQual): el `nivel` que se compara es el de después del commit ajeno.

**Por qué el `COUNT` no alcanza sin el lock, y el lock no alcanza fuera de la
transacción.** Es el par. Afuera de `db.transaccion` el `FOR UPDATE` se suelta al
terminar su statement, así que el guard vuelve a ser un phantom sin que nada falle a
la vista — de ahí que los dos unit tests que lo fijan (uno por servicio) afirmen las
dos mitades: que el lock precede al `COUNT`, y que la transacción se abrió antes del
primer query. Bajo ADR-020 estar adentro no cuesta una conexión más (§ 9).

**Un solo statement con `ANY(...)` no necesita `ORDER BY`**: las filas se lockean en
orden de plan, igual para las dos transacciones. El `ORDER BY` hace falta cuando el
camino toma los locks en statements separados, que es el caso del resto de esta
sección.

⚠️ **Lo que este lock cuesta, para que no se descubra como sorpresa:** un lock se
sostiene hasta el commit, no hasta el final de su statement. `validarReglas` corre al
principio de `create()`/`update()` de un ítem, así que el `FOR SHARE` queda tomado
durante **toda** la transacción del ítem —que sigue con el costeo de receta/combo, los
`registrarMovimiento` y los inserts de tablas hijas—. Consecuencia: un
`PATCH /descuentos/:id` que **no** toca `nivel` —renombrar, pausar— también espera,
porque su `UPDATE` conflictúa con el `FOR SHARE`. Es catálogo/admin y no ruta de venta,
así que se aceptó; si alguna vez la transacción del ítem se alarga (o alguien la usa en
un lote), esto es lo primero que hay que volver a mirar.

El porqué completo, con los ciclos que se cerraron y el que quedó abierto, en
[`agent/resueltos.md`](../agent/resueltos.md) § "El orden de bloqueo de filas de la
bandeja de desfases".

### Borrar un ítem contra crear una referencia a él (2026-09-13)

`ItemsService.remove` decide si el ítem está en uso con una consulta (`obtenerUsoItem`), y esa
consulta sola es un check-then-act: bajo READ COMMITTED no ve la fila que otra transacción está
escribiendo, las dos commitean y queda una referencia viva a un ítem borrado. El cierre es un
**par de locks sobre la fila de `items`**, el mismo molde que `UbicacionesService.remove` contra
`TrasladosService`:

| Lado | Quién | Lock |
|---|---|---|
| Exclusivo | `ItemsService.remove`, antes de `obtenerUsoItem` | `FOR UPDATE` |
| Compartido | `ItemsService.filasValidacionPorIds` — ingredientes, extras y componentes, en el alta y la edición | `FOR SHARE`, `ORDER BY item_id` |
| Compartido | `GruposModificadoresService.validarYResolverOpciones` — opciones de grupo | `FOR SHARE`, `ORDER BY item_id` |
| Compartido | `SalonesService.agregarLinea` — el ítem de la línea y los ingredientes de sus extras | `FOR SHARE`, `ORDER BY item_id` |

**Un camino nuevo que escriba una fila apuntando a un ítem** —cualquier tabla que
`obtenerUsoItem` mire— entra en la parte compartida de esta tabla. Si no, el borrado vuelve a no
verlo, y ningún test existente se entera.

**Dónde va en el orden.** Los `FOR SHARE` son filas de `items`, así que van donde la cadena de
arriba dice `items`: después de `item_receta` e `item_combo`, y **antes de `item_producto`**.
`agregarLinea` lo toma entre el lock de la cuenta y el de stock (`validarStockAlPedir`), en el
mismo orden que `update()`, cuyo `UPDATE items` va antes del `FOR UPDATE` de `item_producto`.
`remove()` no escribe `item_receta` ni `item_combo`, así que su `FOR UPDATE` no participa de ese
tramo.

**Y dentro de `items`, en orden de id también del otro lado.** `aplicarDesfases` ya tomaba varias
filas de `items` —sus `UPDATE` del precio, recorriendo el lote en el orden del cliente—, pero ningún
otro camino lo hacía, y dos lotes se serializaban antes en `item_receta`/`item_combo`. Estos `FOR SHARE` son ese
otro camino, y con ellos el orden del cliente pasó a poder cerrar un ciclo: un
lote `[R2, R1]` contra un `FOR SHARE` de `[R1, R2]` se abrazaba: `40P01`, medido el 2026-09-13 con dos
sesiones contra Postgres, y levantado por la revisión independiente, no por el gate. Ahora toma esas
filas con `ORDER BY item_id FOR UPDATE` antes del primer `UPDATE` (tabla de arriba). La nota de
*"Las reglas van antes que todo eso"* —un solo statement con `ANY(...)` no necesita `ORDER BY`— vale
cuando el otro lado también toma sus filas en un solo statement; acá el otro lado escribía fila por
fila, y el orden lo tienen que compartir los dos.

**Donde además se lee el ítem, el lock va en su propio statement y la lectura en el siguiente.**
Es el caso de `filasValidacionPorIds` y de las opciones de grupo: sus lecturas unen `item_producto`
(y `item_receta`), y en el statement que lockea esas columnas saldrían del snapshot tomado antes de
la espera, la misma razón del saldo de stock en la sección de abajo. En `agregarLinea` el lock es
el chequeo mismo —solo pide `item_id`— y no hay lectura después.

**Qué lo fija.** `backend/test/borrado-item-concurrente.e2e-spec.ts` reproduce una carrera por
mecanismo con una compuerta determinista, y cuenta las sesiones esperando un lock antes de
soltarla. Los unitarios de los tres services afirman el SQL del lock y su posición. El
`ORDER BY` lo fija solo el unitario, por lo dicho al principio de esta sección.

### Borrar una ubicación contra escribir en ella (2026-09-18)

Mismo molde que el borrado de un ítem: un **par de locks sobre la fila de `ubicaciones`**.
`UbicacionesService.remove` cuenta saldo y recuentos abiertos antes de marcar `eliminado_el`, y
ese conteo solo es confiable si nadie puede estar escribiendo en la ubicación sin que el borrado
lo espere.

| Lado | Quién | Lock |
|---|---|---|
| Exclusivo | `UbicacionesService.remove`, antes de contar | `FOR UPDATE` |
| Compartido | `TrasladosService.crearEnTransaccion`, al leer origen y destino | `FOR SHARE` |
| Compartido | `InventarioService.registrarMovimiento`, antes del `FOR UPDATE OF ip` | `FOR SHARE` (`UbicacionesService.bloquearContraBorrado`) |
| Compartido | `RecuentosService.create`, antes de congelar las líneas | `FOR SHARE` (`bloquearContraBorrado`) |

**Un camino nuevo que escriba en una ubicación** —stock, o una fila que `remove()` cuente— entra
en la parte compartida. Si mueve stock, ya entra solo, porque pasa por `registrarMovimiento`.

**Dónde va en el orden:** `ubicaciones` antes que `item_producto`. No todo llamador lo cumple:
`ItemsService.ajustarStock`, cuando convierte unidades, toma `FOR UPDATE` sobre `item_producto`
antes de llamar a `registrarMovimiento`. No cierra un ciclo, porque los únicos que toman esta
fila en exclusivo son `remove()`, `update()` y `restaurar()` de ubicaciones, y ninguno toma
`item_producto`. Si alguno lo tomara algún día, esto es lo primero que hay que volver a mirar.

**Qué cuesta:** una consulta por PK por movimiento, y la venta retiene un `FOR SHARE` sobre la
fila del local hasta su commit. Mientras tanto, renombrar o desactivar el local espera.

**Qué lo fija:** `backend/test/ajuste-borrado-ubicacion-concurrente.e2e-spec.ts` (compuerta
determinista, repetición sin compuerta, y la bodega con un recuento abierto),
`traslado-borrado-ubicacion-concurrente.e2e-spec.ts` para el traslado, y los unitarios de
`inventario.service.spec.ts` (el lock va antes que el de `item_producto`) y de
`recuentos.service.spec.ts`.

### El lock de stock ancla en `item_producto`, nunca en `stock_ubicacion` (2026-09-06)

**El criterio, no la lista:** todo lo que lockea para leer o mover saldo de
`stock_ubicacion` toma el mismo `SELECT … FOR UPDATE OF ip` sobre `item_producto`, nunca
sobre `stock_ubicacion` directamente — es el contrato de esta sección, no una lista
cerrada de sitios. `InventarioService.registrarMovimiento` (el chokepoint de todo
movimiento de stock) y `ItemsService.validarStockAlPedir` son los dos que **leen** saldo
bajo ese lock; `TrasladosService.crearEnTransaccion` lo toma igual y además es el único
que antes encadena un `FOR SHARE` sobre `motivo_traslado`
(`MotivosTrasladoService.assertMotivoActivo`) para que el borrado del motivo lo espere.
Sumale los sitios preexistentes que ya tomaban `FOR UPDATE` directo sobre la fila de
`item_producto` para otro propósito —serializar con `registrarMovimiento` al cambiar
`modo_inventario`/`unidad_medida` (`ItemsService`, dos sitios)—: un nuevo escritor de
`stock_ubicacion` se suma a esta lista, no la reemplaza.

⛔ **Y el saldo se lee en un statement APARTE, emitido ya con el lock en la mano.**
Nunca en el mismo `SELECT` que toma el `FOR UPDATE`. No es estilo: es la diferencia
entre topear la sobreventa y no topearla, y se pagó una vez.

**Por qué el lock no se muda a `stock_ubicacion`.** Una fila de `stock_ubicacion`
puede no existir todavía —un producto que nunca se movió en esa ubicación— y
`FOR UPDATE` sobre una fila inexistente **no lockea nada**: dos primeros movimientos
concurrentes del mismo ítem en la misma ubicación correrían en carrera. La fila de
`item_producto` en cambio siempre existe desde que el ítem es un producto, así que es
el ancla que puede tomarse siempre. El upsert de escritura (`INSERT … ON CONFLICT
(item_id, ubicacion_id) DO UPDATE`) es el que crea la fila de `stock_ubicacion` la
primera vez que el ítem se mueve ahí.

**Por qué el saldo NO puede leerse en el statement del lock.** Bajo READ COMMITTED, el
snapshot de un statement se toma **antes** de que ese statement se encole en el lock.
Cuando despierta, Postgres re-evalúa la fila lockeada (EvalPlanQual) — **solo esa**, no
las demás filas del join. Mientras el saldo vivía en `item_producto.stock`, o sea en la
fila lockeada, se refrescaba solo y nadie tenía que saber esto. Desde que vive en otra
tabla, un `LEFT JOIN stock_ubicacion` dentro del `SELECT … FOR UPDATE` devuelve el saldo
**anterior** a lo que commiteó la transacción que acaba de soltar el lock. Medido: dos
salidas concurrentes de 6 sobre un stock de 10 **pasaban las dos** —el guard
`stockResultante < 0` nunca dispara— y el upsert de escritura, que escribe el saldo
absoluto y no `stock - $1`, dejaba 4 como si hubiera habido una sola salida. Toca además
el CPP (`calcularCostoPromedio` mezclaría una cantidad vieja con un costo fresco) y el
kardex (`stock_anterior` / `stock_resultante` mentirosos).

El segundo statement, emitido con el lock ya tomado, abre snapshot nuevo y ve lo
commiteado. Red: `backend/test/sobreventa-concurrente-ubicacion.e2e-spec.ts`.

⚠️ `FOR UPDATE OF ip, su` **no es la alternativa**: es ilegal sobre el lado nullable de
un outer join (`FOR UPDATE cannot be applied to the nullable side of an outer join`),
medido. Y sin el `LEFT JOIN` el ítem sin fila en esa ubicación desaparecería del
resultado. Partir en dos statements resuelve las dos cosas de una: la ausencia de fila en
el primero es "no es producto / es de otro tenant", y en el segundo es saldo **cero**.

**La consecuencia buena, para los traslados.** Como el ancla es una fila por
`item_id` —no por `(item_id, ubicacion_id)`—, un traslado que mueve un ítem entre dos
ubicaciones lockea **una sola fila** sin importar cuántas ubicaciones toque. Dos
traslados opuestos del mismo producto (A→B y B→A) piden la misma fila de
`item_producto`, nunca dos filas distintas de `stock_ubicacion` en orden cruzado: no
pueden hacer deadlock entre sí por esto.

---

## 16. Alcance de lectura por usuario: el eje `MiCaja`/`Cajas`

**Cuándo aplica:** un listado que devuelve plata o actividad **atribuible a una persona**, y
que hoy solo filtra por tenant.

El permiso del módulo (`Ventas:Leer`, `Pagos:Leer`) es el **piso** —dice si podés entrar—; el
que dice **cuánto ves** es un eje aparte:

```ts
const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
  u.id,
  u.tenantId!,
);
return this.service.listar(u.tenantId!, query, u.id, verTodas);
```

⚠️ **Hay DOS métodos y elegir mal rompe cosas distintas. Para un módulo que no es caja va
siempre `resolverAlcanceDerivadoDeCaja`:**

| Método | Para | Sin ninguno de los dos permisos |
|---|---|---|
| `resolverAlcanceCaja` | rutas de **caja** (el permiso es el piso) | **lanza `403`** |
| `resolverAlcanceDerivadoDeCaja` | **ventas, pagos**, y cualquier otro (el permiso es el acotador) | depende de si el tenant contrató el módulo `Cajas` |

⚠️ **El derivado mira UN solo permiso —`Cajas:Leer`— y UN solo módulo —`Cajas`.** `MiCaja` no
participa. Sus tres ramas:

1. **Con `Cajas:Leer`** → `true`, ve todo. Es el nivel de supervisión.
2. **Sin él, y el tenant NO contrató `Cajas`** → `true` igual. Ahí la supervisión **no existe
   como concepto**: `Cajas:Leer` es inobtenible, ni siquiera para el admin, porque
   `userHasPermiso` exige el módulo contratado incluso en el short-circuit del rol fijo.
   Acotar sería permanente y sin arreglo posible por configuración — una tienda solo online se
   quedaría sin ver su propia facturación. 📌 En la práctica es **solo** ese caso: `MiCaja` y
   `Cajas` se venden juntos (regla del owner, 2026-08-22), así que el tenant con `MiCaja` y sin
   `Cajas` no existe — y si aparece por un descuido al aprovisionar, sus cajeros se ven la plata
   entre ellos. La rama la **ejecuta** `visibilidad-tenant-sin-cajas.e2e-spec.ts` — ojo: fija que ese
   tenant **no queda bloqueado**, no que vea todo. Si la rama devolviera `false`, las rutas
   seguirían dando 200 (solo se agrega un `AND`) y el test seguiría verde. La conducta
   rama-por-rama la fija `rbac.service.spec.ts`.
3. **Sin él, y el tenant SÍ contrató `Cajas`** → `false`, se acota. Que al rol le falte el
   permiso es una decisión de configuración, no una ausencia del concepto.

O sea: el derivado **distingue las dos causas** por las que `userHasPermiso` puede dar `false`
—falta el permiso vs. no existe el módulo— y solo la primera acota.

⛔ **No metas `MiCaja:Leer` en la regla.** La primera versión lo hacía y tenía dos defectos: en
un tenant `MiCaja`-only dejaba al **admin** acotado a su propia caja para siempre, y —peor—
cuando la condición era "ninguno de los dos" resultaba **fail-open**. `abrir` y `movimientos`
piden `MiCaja:`**`Crear`**, y `conteo`/`cerrar` no llevan permiso de módulo, así que un admin
que le saca `MiCaja:Leer` al rol Vendedor —una acción que *parece* un endurecimiento— lo dejaba
operativo de punta a punta **y** le concedía todos los pagos del tenant. **Quitar un permiso no
puede conceder acceso.**

**Por qué el eje de caja gobierna ventas y pagos.** Ni `ventas` ni `pagos` guardan quién los
hizo: solo `caja_id`. La autoría **se deriva de la caja** (`venta.caja_id → cajas.usuario_id`),
y eso es exacto porque `ux_cajas_activa_por_usuario` garantiza que una caja abierta pertenece a
un solo usuario. El permiso que decide *"¿ves cajas ajenas?"* es entonces el mismo que debe
decidir *"¿ves ventas ajenas?"*: no son dos ejes parecidos, es **el mismo eje**.

**Cómo se escribe el filtro**, y las tres cosas que hay que respetar:

```sql
AND EXISTS (
  SELECT 1 FROM cajas c
   WHERE c.caja_id = p.caja_id
     AND c.tenant_id = p.tenant_id
     AND c.usuario_id = $n
     AND c.eliminado_el IS NULL
)
```

1. **`EXISTS`, no `JOIN`** — no cambia la multiplicidad de filas y entra igual en la query del
   `COUNT` y en la de las filas, que tienen `FROM` distintos.
2. **El mismo filtro en las DOS queries.** Si el `COUNT` no lo lleva, la paginación miente:
   `total` cuenta filas que el usuario no puede ver y la última página vuelve vacía.
3. **Sin `OR caja_id IS NULL`.** La columna es nullable; una fila sin caja **no es de nadie** y
   no puede caer en "lo mío" por omisión. El `EXISTS` con NULL da falso, que es lo correcto.

**El eje va primero y fuera de todo `if` de query:** es el alcance, no un filtro que el cliente
elige. Que siga existiendo un `?cajaId=` en el DTO no lo debilita — acota **dentro** de lo que
ya se puede ver.

⚠️ **Un detalle sale del alcance a propósito: la venta `canal='online'`.** Va siempre contra la
caja **virtual** del tenant (`findVirtual`), que no es de nadie, así que con la regla de arriba
sería invisible para todos los cajeros. Entra con un `OR v.canal = 'online'` porque **no puede
revelar el esperado de ningún cajón que alguien vaya a arquear**, que es lo único que el eje
protege.

⚠️ **En el detalle de un recurso ajeno se responde `404`, no `403`:** un `403` confirma que
existe.

**De dónde salió** (2026-08-22): un cajero con `Pagos:Leer` listaba **todos** los pagos del
tenant, y con eso reconstruía el esperado de **cualquier** caja. Medido después del arreglo: el
admin ve 87 pagos de 18 cajas, el cajero 3 de las 2 suyas.

⚠️ **Lo que este patrón NO da, y hay que saberlo antes de apoyarse en él:** el usuario sigue
viendo **lo suyo**, así que cualquier agregado que se derive de su propia actividad le sigue
siendo derivable. El eje acota **de quién**, no **qué**. Si lo que se quiere proteger es un
número que el propio usuario generó, este patrón no es la herramienta.
Diseño completo en
[`specs/2026-08-22-visibilidad-ventas-pagos-design.md`](../superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md).

---

## 17. Índices de FK y el `OR` que los apaga

**Las FK no traen índice.** TypeORM crea la PK y nada más: una columna `*_id` sin `@Index`
explícito se lee con seq scan. Medido el 2026-09-06 sobre el camino caliente de
`GET /ventas/:id`, con 60.000 ventas y 240.000 detalles sembrados:

| Consulta | Sin índice | Con índice |
|---|---|---|
| líneas de una venta (`venta_detalles.venta_id`) | 16,6 ms, seq scan | 0,08 ms |
| notas de crédito de una venta (`ventas.venta_referencia_id`) | 6,8 ms, seq scan | 0,11 ms |
| movimientos de una venta (`movimientos_inventario.venta_id`) | 2,9 ms, seq scan | 0,07 ms |

El mismo request lee por `venta_id` otras seis tablas, indexadas el mismo día. **Sueltas
parecen baratas y por eso quedaron para después; juntas suman**:

| Tabla (filas sembradas) | Sin índice | Con índice |
|---|---|---|
| `ventas_impuestos` (120.000) | 9,2 ms | 0,09 ms |
| `pagos` (60.000) | 5,3 ms | 0,07 ms |
| `ventas_descuentos` (20.000) | 1,8 ms | 0,07 ms |
| `venta_customer` (18.000) | 1,2 ms | 0,05 ms |
| `ventas_promociones` (12.000) | 1,1 ms | 0,07 ms |
| `ventas_recargos` (6.000) | 0,6 ms | 0,05 ms |
| **suma de las seis** | **19,2 ms** | **0,40 ms** |

(La columna *sin índice* va redondeada a la décima y la de *con índice* a la centésima; sin
redondear suman 19,31 y 0,40 ms. Es la suma de **estas seis**; el mismo request lee además las
tres de la primera tabla de esta sección, que desde el mismo día van por índice.)

📌 **Lo que se aprende de esa tabla no es el total sino qué manda:** el costo del seq scan es el
**tamaño en páginas** —filas × ancho de fila—, no el número de columnas ni las filas por venta.
`ventas_impuestos` sale primera porque sus 120.000 filas son muchas páginas, pero el par
`venta_customer` (18.000 filas en 205 páginas, 88 por página) y `ventas_promociones` (12.000 en
207, 58 por página) ocupa **las mismas páginas** con un 50% de diferencia en filas —y cuesta casi
igual, 1,2 contra 1,1 ms—: las de `ventas_promociones` son más anchas y entran menos por página.

En estas seis el orden por filas coincidió con el orden por tiempo, pero eso es del dataset y no
una ley: el par muestra que un 50% más de filas puede ocupar lo mismo. Lo que se compara son
páginas.

La medición del par la aportó la revisión independiente, y ojo con leerla como propiedad de las
tablas: `venta_customer` tiene cuatro TEXT nullables (`rut`, `direccion`, `telefono`, `email`)
que este seed casi no llena, así que con clientes reales el par se puede dar vuelta.

⚠️ **Y el criterio de "es chica, va después" falla:** estas seis se difirieron por parecer
baratas de a una, y `ventas_impuestos` sola son 9,2 ms — **más del triple** que los 2,9 ms de
`movimientos_inventario`, que sí se indexó en el frente anterior. Lo que engaña no es el tamaño
de cada una: es mirarlas de a una en un request que las lee a todas.

El índice va **en la entity** (`@Index('idx_<tabla>_<col>', ['prop'])`), que es lo que
`synchronize` crea; la convención de nombre es la de las entities de propinas. Y va **también**
en `startup-pos.sql`, que es el esquema documentado: si solo está en la entity, quien le
pregunte al `.sql` si esa FK tiene índice recibe la respuesta equivocada.

#### Entity o seeder: lo decide si el índice lleva una función

**Columnas peladas → `@Index` en la entity. Expresión → SQL cruda en el seeder.** No es
estilo: **TypeORM no sabe expresar una función en `@Index`**, así que un índice que tiene que
ser sobre `lower(nombre)` o `lower(btrim(serie))`, declarado en la entity, se crea sobre la
columna pelada — case-sensitive. Queda la regla escrita y **la equivocada vigente**, que es
peor que no tenerla: nadie vuelve a mirar un índice que existe.

Ya pasó dos veces, y las dos se arreglaron mudando el índice al seeder:
`seedGruposModificadores()` (nombres únicos, 2026-09) y `seedItemUnidadSerieIndex()` (la serie
de una unidad, 2026-09-20 — venía de un `@Index` de columnas peladas que dejaba entrar
`ABC123` y `abc123` como dos series distintas).

El molde es **el mayoritario** entre los índices únicos que crea el seeder, no una excepción;
para verlos sin confiar en una lista que envejece:

```bash
grep -A2 "CREATE UNIQUE INDEX IF NOT EXISTS" backend/src/modules/seeder/seeder.service.ts
```

⚠️ **Y la vuelta NO vale:** que un índice esté en el seeder no significa que lleve una función.
Ahí viven también algunos de **columnas peladas** —`uq_recuento_linea_item_vivo`,
`uq_garzones_usuario_tenant`, `uq_garzones_mostrador_tenant`— que podrían haber ido a la
entity y están ahí por su propia historia. O sea: la función **obliga** al seeder, pero el
seeder no implica función. Antes de mover uno, mirá el suyo.

⚠️ **La contrapartida del seeder, que se acepta a sabiendas:** en dev `synchronize` puede
dejar la tabla **sin** el índice hasta que el seeder lo recree, así que la red del lado de la
base pasa a depender de que el seeder corra y no falle. Y si el índice cambia de definición
manteniendo el nombre, `CREATE UNIQUE INDEX IF NOT EXISTS` **no lo reemplaza** —ve el nombre y
no hace nada—: hay que precederlo de un `DROP` condicional que dispare solo cuando el que
existe no es el nuevo (molde en las dos funciones citadas). Sin eso, las bases creadas antes
del cambio se quedan con la regla vieja sin que nada avise.

Y **el índice que crea el seeder va igual en `startup-pos.sql`**, con un comentario que diga
quién lo crea: por la misma razón que arriba, quien le pregunte al `.sql` merece la respuesta
correcta, incluida la de quién es el dueño.

⚠️ **No es "indexá toda FK".** El índice se paga en cada `INSERT`, y una tabla paga **solo el
suyo**: insertar 20.000 detalles pasa de 63–70 ms a 77–89 ms, o sea **~1 µs por fila** por
`idx_venta_detalles_venta` (medido por la revisión independiente, seis iteraciones alternando el
orden, tres corridas), y la misma medición sobre `pagos` da 71 ms → 90 ms, **0,95 µs por fila**.
Una venta de 15 líneas paga ~15 µs para ahorrar 16 ms de lectura, así que acá el canje es obvio;
en una FK que nadie consulta, no.

### El `OR` que apaga el índice

⚠️ **El índice no alcanza si la consulta lo apaga.** Tres consultas del mismo archivo filtraban
`venta_id = $1 OR venta_id IN (SELECT …)`, y con esa forma el planner **ignora el índice** y cae
a seq scan: el `EXPLAIN` muestra `Filter: (venta_id = '…' OR (hashed SubPlan 1))`, o sea que lo
que se rompe es el semi-join, porque la subconsulta no se puede aplanar contra la otra rama del
`OR`. **No es "cualquier `OR`"**: `venta_id = $1 OR venta_id = $2` sí usa el índice; el problema
es el `OR` **con una subconsulta de un lado**. Escrito como **una sola lista** —`venta_id IN
(SELECT … UNION ALL SELECT $1)`, que es equivalente— pasa a index scan:

| Consulta | Con `OR` | Con la lista única |
|---|---|---|
| remanente por porción (`disponibleNotaCredito`) | 19,4 ms, Parallel Seq Scan | 0,16 ms |
| contador de unidades comprometidas, nodo de movimientos | 3,8 ms, seq scan | 0,10 ms |
| composición de la NC (adentro de la transacción) | seq scan | index scan |

⚠️ **Los tiempos de una consulta compuesta dependen del seed, así que van con el suyo.** Los de
esta tabla son con 20% de filas `motivo = 'devolucion'`. Con un seed que marcaba el 99% —el
primero que se usó acá— el mismo par daba 5,2 → 0,4 ms: el orden de magnitud aguanta, el número
no. Las tres filas de la tabla de **las lecturas simples** —la primera de esta
sección— no dependen de eso: la revisión reprodujo su columna *sin índice* dentro de un 8%. La columna *con índice* son cifras de centésimas de
milisegundo, dominadas por planning y caché — ahí las reproducciones van de 0,03 a 0,3 ms, así
que sirven para decir *"index scan en vez de seq scan"* y no como referencia numérica.

La equivalencia es exacta y no depende del contenido: `IN` es semi-join, así que el duplicado
que el `UNION ALL` puede introducir no multiplica filas, y con la columna en `NULL` las dos
formas descartan la fila igual. La revisión la verificó sobre 6.003 casos, incluidos `docs`
vacío, NC borrada y `venta_id NULL`.

📌 **Y lo que parece la salida y no lo es:** un índice **parcial** por `motivo = 'devolucion'`
sobre `movimientos_inventario`. Con el `OR` puesto sí se usa y baja de 3,8 ms a 1,4–1,9 ms —con un
20% de filas `devolucion`—, o sea que "no sirve" sería falso; pero sacar el `OR` deja ese mismo
**nodo** en 0,10 ms con el índice completo —la consulta entera, en 0,35–0,42 ms— sin un segundo
índice que mantener.
⚠️ La primera versión de esta sección decía que el parcial "no cambia el plan", y era un
artefacto del seed: con el 99% de los movimientos marcados `devolucion`, un índice parcial por
`devolucion` no filtra nada. **La distribución del seed es parte de la medición.**

⚠️ **Medir con volumen sembrado.** La base de desarrollo tiene ~170 ventas y ahí **todo** da
seq scan igual —o casi—, así que un `EXPLAIN` sobre ella no distingue el plan bueno del malo.

---

## 18. Operación idempotente (un cobro por intento)

Todo endpoint que **cobra** —crea una venta, cierra una cuenta, registra un abono— exige
`Idempotency-Key` y corre su operación dentro de `IdempotenciaService.ejecutar`
([ADR-026](../adr/026-idempotencia-de-cobros.md)). El reintento del cajero después de un corte
reproduce la respuesta en vez de cobrar dos veces.

```ts
// controller
@Post()
@ApiHeader({ name: 'Idempotency-Key', required: true, description: '…' })
crear(@Req() req: Request, @Body(EscalaMonedaPipe) dto: XDto,
      @ClaveIdempotencia() clave: string) { … }

// service
const cobrar = () => this.db.transaccion(async (manager) => { /* la operación de siempre */ });
return this.idempotencia.ejecutar(
  { tenantId, usuarioId, clave, operacion: 'x.y', huella: huellaDe('x.y', { /* a mano */ }) },
  cobrar,
  (r) => r.ventaId,
);
```

- **El reclamo va PRIMERO.** `ejecutar` abre su `db.transaccion`, reclama la clave y recién
  ahí llama a `operar`, cuya transacción se suma a la misma (ADR-020). Nada de la operación
  —ni un `FOR UPDATE`, ni un chequeo de estado— puede ir antes: si el cierre de mesa chequeara
  *"La cuenta no está abierta"* antes de reclamar, el reintento rebotaría en vez de reproducir.
- **La credencial va ANTES del reclamo**, fuera de `ejecutar`: reproducir no es un atajo que
  saltee el PIN. **El estado va DESPUÉS**, dentro de `operar`, aunque sea una lectura sin
  lock: el turno abierto del garzón es condición para escribir, y un reintento que reproduce
  no escribe. Chequearlo afuera hace que el reintento rebote si el turno se cerró en el medio.
- **La huella se arma a mano, campo por campo, sin datos sensibles.** El PIN nunca entra: su
  hash se revierte por fuerza bruta. Un campo nuevo del DTO se decide en el llamador; no entra
  solo. Un DTO sin credenciales puede ir entero (`huellaDe('pago.abono', dto)`).
- **La operación agrega su valor a `OperacionIdempotente`** (`modules/idempotencia/huella.ts`).
- **Un llamador interno sin HTTP no pasa clave** (el callback de Webpay, las suscripciones):
  ya tienen su propia idempotencia o no hay nadie que reintente. Por eso el parámetro del
  service es opcional solo en `VentasService.crear`.
- **Tests:** el unitario mockea `ejecutar` como pasa-manos (`(_s, operar) => operar()`) y
  afirma sobre la solicitud que recibe (la huella, sin el PIN). Lo que importa de verdad
  —reclamo atómico, duplicado concurrente, rollback que suelta la clave— solo se prueba contra
  Postgres: `test/idempotencia-venta.e2e-spec.ts`. Todo `POST` de un e2e a estos endpoints
  lleva `.set('Idempotency-Key', randomUUID())`, una clave nueva por llamada.

---

## 19. La pantalla de un módulo lee de listas propias, no de las rutas de otro módulo

Una pantalla casi nunca se alimenta sola: la carga de una compra necesita productos,
proveedores y ubicaciones, que viven en **otros** módulos, con **sus** guards. Si la pantalla
pide `GET /items`, su usuario necesita `Inventario: Leer` —un permiso que no tiene nada que
ver con comprar— y sin él recibe **403 en una ruta que no es la suya**.

**La regla: el módulo publica su propia lista, bajo su propio permiso, con exactamente las
columnas que su pantalla usa.** Compras expone `GET /compras/productos` (permiso
`Compras: Crear`), `GET /compras/proveedores` y las unidades de una línea, en vez de mandar
al encargado a `/items` y `/terceros`.

```ts
// compras.controller.ts — la lista propia va ANTES del `@Get(':id')`,
// o "productos" entra como un id.
@Get('productos')
@RequiresPermiso('Compras', 'Crear')
productos(@Req() req: Request) {
  const { tenantId } = req.user as { tenantId: string };
  return this.comprasService.productos(tenantId);
}
```

- **Por qué no sumarle permisos al rol:** `Inventario: Leer` no abre una lista, abre el
  módulo entero —saldos, kardex, costos—. Comprar no es ver el inventario, y un rol que
  acumula permisos ajenos para que le ande una pantalla deja de describir un oficio.
- **Por qué no una ruta "compartida" sin guard:** sería una lectura del catálogo sin permiso,
  y la invariante 6 de `CLAUDE.md` es que el enforcement vive en el backend.
- **El costo que se acepta a cambio:** la misma tabla se lee desde dos lugares. Es
  deliberado, y por eso la lista propia **no es un `SELECT *` del otro módulo**: devuelve lo
  que la pantalla pinta y nada más, así que no se vuelve una segunda API del catálogo.
- **Cómo se detecta el problema, que es lo que más cuesta:** ninguna suite del módulo lo ve
  —todas pegan a rutas propias— y correrlas como admin lo tapa entero. **El e2e y el smoke de
  un módulo con permisos propios corren como el usuario de su rol** (en compras,
  `encargado.compras`). Listar cada `useApiFetch` de la pantalla con el guard de su ruta, al
  cerrar, es lo que lo encuentra antes que el usuario.

---

## 12. Docs vivas a tocar en el mismo commit

- `startup-pos.sql` — agregar las tablas nuevas.
- `docs/features/<feature>.md` (desde `docs/features/TEMPLATE.md`) + link en `docs/README.md`.
- `docs/ESTADO.md` — marcar ✅ / agregar la fila de la funcionalidad.
- ADR nuevo en `docs/adr/` (+ índice) si hubo una decisión arquitectónica.

Ver [frontend.md](./frontend.md) para la capa de UI.
