# Backend Patterns — Playbook

**Status**: Living
**Last Updated**: 2026-07-21

Patrón de referencia para construir un módulo de feature (NestJS + TypeORM),
extraído del código real (`modules/monedas/`, `modules/tenants/`). **Léelo antes de
planificar una feature**: cada sección condensa el patrón y apunta al archivo real
para copiar/adaptar.

> Convenciones transversales obligatorias (no repetidas en cada sección):
> - **Soft delete en todo**: `@DeleteDateColumn({ name: 'eliminado_el' })`; toda
>   lectura filtra `eliminado_el IS NULL` (o `eliminadoEl: IsNull()`). **Excepción
>   deliberada:** el JOIN a `usuarios` de la papelera para mostrar quién borró un
>   registro no filtra el `eliminado_el` de `usuarios` — el autor de un borrado es
>   un hecho histórico que no debe desaparecer solo porque ese usuario se dio de
>   baja después. Ver `categorias.service.ts → findAll`.
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

Punto ciego conocido, con entrada en [`agent/pendientes.md`](../agent/pendientes.md): el
`valor` de descuentos y recargos **no se puede marcar** — es monto fijo o porcentaje según
el campo hermano `modo`, y ni el decorador ni el pipe leen campos hermanos.

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
`crear()` (por eso ese método ordena por `itemId` y reintenta), y las tres entradas abiertas
del mismo molde están en `docs/agent/pendientes.md` § "Carreras de concurrencia".

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
  ⚠️ Auditado el 2026-08-18: ningún sitio de hoy **necesita** `sinTransaccion`
  para estar fuera de contexto — los dos ejemplos de arriba ya están
  lexicalmente fuera del callback de `db.transaccion`, así que el ALS los deja
  solos en el pool sin pedirlo. `sinTransaccion` existe para el día que el
  código fuera-de-transacción tenga que vivir **dentro** de un callback que
  por lo demás sí está en transacción.
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

## 10b. Bordes de rango por fecha en un listado

`AppDateInput` emite **fecha pura** (`YYYY-MM-DD`) y los DTOs validan con
`@IsDateString()`, que también acepta un timestamp. Contra una columna
`timestamptz`, una fecha pura se castea a la **medianoche**, y de ahí salen los dos
bordes — que **no son simétricos**:

| Borde | Helper | Fecha pura | Timestamp |
|---|---|---|---|
| Inferior (`desde`) | `bordeFechaSql(col, '>=', …)` | `>= medianoche local` | `>= $n`, tal cual |
| Superior (`hasta`) | **`bordeHastaSql(col, …)`** | `< (día + 1) local` — **inclusivo del día** | `<= $n`, tal cual |

Los dos helpers viven en `common/utils/rango-fecha.util.ts`, y la zona sale del
**país del tenant** (`zonaHorariaTenant`), no de una preferencia.

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
- **`requiereZonaTenant(...)` antes de pushear la zona al array de params:** si
  ningún borde es fecha pura, el SQL no la nombra y Postgres **rechaza el bind**
  con un parámetro de más (*"bind message supplies N parameters"*) → 500.

⚠️ **La otra convención que convive, y por qué no se unificó:** los reportes y la
liquidación de propinas usan un borde superior **exclusivo compensado por el
llamador** — `propina-reportes` recibe `hasta` y filtra `< hasta`, y la pantalla le
manda el primer día del mes siguiente (`rangoMesActual()`); la liquidación manda un
instante ya corrido (`finDiaExclusivoIso`). **Funciona y está fuera del alcance de
la corrección de 2026-08-22**: tocar el backend sin tocar esos dos llamadores haría
que el resumen de agosto incluyera el 1° de septiembre. Si algún día se unifica, van
juntos backend y llamador, y las consultas de liquidación comparan **períodos
guardados** (`fecha_desde`/`fecha_hasta`), no eventos — es otro análisis.

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
insert es más simple y suficiente) o si la llave de negocio no es estable
(ej. un texto libre editable) — ahí no hay forma de saber con certeza qué fila
entrante "es" cuál existente, y forzar el upsert arriesga más que soft-delete
+ insert.

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
| `aplicarDesfases` | dos `SELECT … ORDER BY item_id FOR UPDATE`, `item_receta` y después `item_combo`, antes de leer ingredientes; los `UPDATE items` del precio van después de los dos locks | `aplicar sobre N recetas hace lecturas CONSTANTES…` (afirma las dos tablas y sus `ORDER BY`), `aplicar sobre N combos hace lecturas CONSTANTES…`, `valida el tenant ANTES de tomar los locks` |
| `descartarDesfases` | dos pasadas ordenadas, sin locks explícitos | `descartar escribe item_receta ANTES que item_combo…`, `descartar ordena por item_id DENTRO de la pasada de recetas…` |
| `update()` de un ítem compuesto | `FOR UPDATE` sobre `item_receta`/`item_combo` **antes** del `UPDATE items`, bajo el mismo guard que el branch que después escribe esa tabla | `toma item_combo ANTES del UPDATE items — orden de locks contra aplicarDesfases` |

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

El porqué completo, con los ciclos que se cerraron y el que quedó abierto, en
[`agent/resueltos.md`](../agent/resueltos.md) § "El orden de bloqueo de filas de la
bandeja de desfases".

---

## 12. Docs vivas a tocar en el mismo commit

- `startup-pos.sql` — agregar las tablas nuevas.
- `docs/features/<feature>.md` (desde `docs/features/TEMPLATE.md`) + link en `docs/README.md`.
- `docs/ESTADO.md` — marcar ✅ / agregar la fila de la funcionalidad.
- ADR nuevo en `docs/adr/` (+ índice) si hubo una decisión arquitectónica.

Ver [frontend.md](./frontend.md) para la capa de UI.
