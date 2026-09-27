# Compras, pieza 2: la unidad de compra por proveedor ("caja de 12")

**Fecha:** 2026-09-27 · **Tipo:** spec de diseño
**Frente:** *"Compras: carga manual, y el DTE del SII como atajo encima"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md). Es la **pieza 2 de 4**; la pieza 1 es
[`2026-09-18-compras-recepcion-design.md`](2026-09-18-compras-recepcion-design.md) y lo que hace
hoy está en [`features/compras.md`](../../features/compras.md).
**Investigaciones:** [`2026-09-18-compras.md`](../../agent/investigaciones/2026-09-18-compras.md)
§ 3 y § 5 (decisión 4b) y
[`2026-09-27-carga-stock-por-factura.md`](../../agent/investigaciones/2026-09-27-carga-stock-por-factura.md)
§ 3.

---

## 1. El problema que cierra

Andina manda la Coca-Cola en cajas de 12 y la factura dice "10 CJ a $9.600". Hoy la línea de la
compra solo conoce las unidades del catálogo global (kg, g, l, unidad…), así que el encargado
tiene que calcular a mano **120 unidades a $800**. Si tipea "10" donde iba "120", el stock y el
costo quedan mal y el sistema no avisa. La decisión 4b del owner (2026-09-18) pide que la primera
vez se guarde *"a este proveedor la Coca-Cola le viene en caja de 12"* y que desde ahí se tipee en
cajas.

Además es **la dependencia más dura de la lectura del XML del DTE** (investigación del
2026-09-27, § 3). El XML trae la cantidad como la tipeó el proveedor ("3 CJ"), y sin esta pieza
pre-llenar desde la factura no ahorra nada.

## 2. Decisiones

**Heredadas, sin re-litigar:**

- **4b (owner, 2026-09-18):** es una tabla por **(proveedor, producto)**. Se descartaron *"latas
  calculadas a mano"* y *"una equivalencia por ítem"*, que se rompe cuando otro proveedor la trae
  en pack de 6. No cabe en el catálogo de unidades, que es global y solo tiene medidas físicas.
- **El precio de la línea es por unidad tipeada** (pieza 1): "10 cajas a $9.600". El costo por
  unidad base lo deriva `costearLineas`, sin cambios.

**Tomadas en esta sesión** (owner, 2026-09-27, eligiendo en un selector de opciones con el costo
de cada una; en las cuatro eligió la opción recomendada):

| Pregunta | Decisión | Descartado |
|---|---|---|
| ¿Dónde se anota "caja de 12" la primera vez? | **En la misma línea de la compra**, con "+ Nueva presentación…" en el selector de unidad | *Pantalla aparte* (con el camión esperando, obliga a salir de la compra); *las dos* |
| ¿Qué pasa si Andina también manda pack de 6, o cambia la caja? | **Varias presentaciones por (proveedor, producto)**. La que ya no sirve se retira | *Una sola que se edita* (5 cajas de 12 y 3 packs de 6 en la misma factura no se pueden expresar) |
| ¿El código del proveedor ("CC350-12") entra ahora? | **No: llega con la pieza del XML**, que lo aprende de la primera asociación sin que nadie lo tipee | *Ahora, opcional* (se tipea a mano, no sirve hasta el XML y puede no calzar letra por letra con el XML) |
| ¿Dónde se corrige una "Caja (24)" mal cargada? | **Desde la línea**: un lápiz junto al selector, con *Guardar* y *Retirar* | *Una lista aparte en Compras* (se puede sumar en la pieza del XML, donde también mostraría los códigos); *las dos* |

**Tomadas en el diseño y aprobadas por el owner con cada sección** (2026-09-27):

- **Lote sí, serie no.** Una presentación admite productos por cantidad y por lote (10 cajas de
  yogurt del lote L123 = 120 al lote). No admite productos por serie: igual hay que tipear cada
  serie, así que la caja no ahorra nada.
- **La línea confirmada congela su presentación.** Una compra confirmada con "Caja (12)" usa ese
  12 para siempre, aunque mañana la caja pase a 6. Un borrador usa la presentación como esté el
  día que se confirma.
- **Permiso: Compras · Crear** para crear, editar y retirar. La crea el encargado en plena carga,
  así que es operación del módulo y no configuración del admin del tenant.
- ⚠️ Esto cambia **de dónde sale la cantidad que entra a `movimientos_inventario`** y, por lo
  tanto, el costo por unidad. Por CLAUDE.md se consultó, y el owner aprobó la sección 1 del
  diseño sabiéndolo. La cuenta (`costearLineas`, `registrarMovimiento`, el CPP y § 4.3 de la
  pieza 1) no cambia.

## 3. Modelo de datos

### 3.1 `presentaciones_compra` (nueva)

| Columna | Tipo | Nota |
|---|---|---|
| `presentacion_compra_id` | `uuid` PK | |
| `tenant_id` | `uuid` NOT NULL | Del token, siempre |
| `proveedor_id` | `uuid` NOT NULL | Un `tercero` de tipo proveedor del tenant |
| `item_id` | `uuid` NOT NULL | `producto` o `ingrediente` con stock, por **cantidad o lote** |
| `nombre` | `varchar(40)` NOT NULL | "Caja", "Pack", "Saco". Se guarda sin bordes |
| `contenido` | `numeric(18,4)` NOT NULL | `> 0`. Cuánto trae: 12, 25, 1,5 |
| `unidad_codigo` | `text` NOT NULL | En qué: `unidad`, `kg`… Compatible con la unidad base del producto |
| `creado_el` / `actualizado_el` / `eliminado_el` | `timestamptz` | **Retirar es marcar `eliminado_el`**, nunca borrar |

- **Índice único parcial:** `(tenant_id, proveedor_id, item_id, lower(nombre))` **WHERE
  `eliminado_el IS NULL`**. Dos "Caja" vivas del mismo par no se distinguen en el selector, pero
  una retirada no bloquea el nombre. El índice va declarado **en la entidad**, porque el esquema
  sale de `synchronize` y no del `.sql`.
- **El contenido se guarda como se tipeó** ("25 kg"), no convertido. Así un saco de 25 kg sigue
  valiendo 25 kg aunque la unidad base del producto sea g. La conversión a la unidad base se
  hace al usarla, con el conversor del catálogo, igual que las unidades de la línea.
- La etiqueta que ve el encargado se arma, no se guarda: `Caja (12)` si la unidad es `unidad`, y
  `Saco (25 kg)` si no.

### 3.2 `compra_lineas` (cambia)

| Columna | Cambio | Nota |
|---|---|---|
| `presentacion_compra_id` | **nueva**, `uuid` NULL | La presentación elegida en el borrador |
| `unidad_codigo` | pasa a **NULL** | Null cuando la línea va en presentación |
| `presentacion_nombre` | **nueva**, `varchar(40)` NULL, congelada al confirmar | Para que el detalle de una confirmada diga "Caja" aunque después la renombren o la retiren |
| `contenido_base` | **nueva**, `numeric(18,4)` NULL, congelada al confirmar | Cuántas unidades base trae **una** presentación: el 12 |

- **CHECK: exactamente una de `unidad_codigo` o `presentacion_compra_id`.** Es a propósito que
  `unidad_codigo` quede null en vez de rellenarse con la unidad base. Todo el código de hoy hace
  `unidad_codigo === base ? cantidad : convertir(...)`, y con la unidad base rellenada un camino
  que se olvidara de la presentación leería **10 cajas como 10 unidades**, sin error. Con null,
  ese olvido revienta en la conversión: se ve en el test y no en el stock.
- **Congelar el nombre y el contenido** evita que el detalle de una compra confirmada tenga que
  leer una presentación retirada, que sería una lectura sin el filtro de `eliminado_el`.
- **Sin backfill:** no hay datos productivos. Se cambian las entidades, se registra la nueva en el
  array `entities` de `app.module.ts`, se actualizan el seeder y `startup-pos.sql` (como
  documentación) y se resetea.

## 4. Flujo

### 4.1 Borrador (`POST /compras`, `PATCH /compras/:id`)

Una línea trae **`unidadCodigo` o `presentacionId`, nunca las dos** (400 si trae las dos o
ninguna). Con `presentacionId`, al guardar se valida en **una** consulta por borrador (no una por
línea) que cada presentación:

- exista, esté viva y sea del tenant;
- sea **del proveedor de la compra** y **del producto de la línea**.

Si no se cumple, da 400. Un borrador que cambió de proveedor y conserva presentaciones del
anterior no se puede guardar. La pantalla lo evita (§ 6) y el backend lo exige.

### 4.2 Confirmar

Se agrega un solo paso, antes de convertir:

1. Leer las presentaciones de las líneas, **en una consulta**, junto con los locks que ya toma
   confirmar. Si alguna fue retirada desde que se guardó el borrador: 400 *"«Caja (24)» de
   Coca-Cola fue retirada: elegí otra unidad"*.
2. `contenido_base = convertir(contenido, unidad_codigo, unidad base del producto)`.
3. `cantidad_base = cantidad × contenido_base`, con Decimal.js y cuantizada a la escala de
   cantidad del kardex (4).
4. Congelar `presentacion_nombre` y `contenido_base` en la línea.

Desde ahí todo sigue igual que en la pieza 1: `costearCompra` recibe `cantidad`, `precioUnitario`
y `cantidadBase`, y "10 cajas a $9.600" da **120 unidades a $800**. El reparto del descuento
sigue siendo por valor (`cantidad × precio`), que es el mismo con cajas o con latas.

**Un solo lugar calcula la cantidad base de una línea.** Hoy la conversión de unidad está escrita
en tres sitios de `compras.service.ts`: la validación del borrador, confirmar y corregir la
cantidad. Los tres pasan a llamar a un helper que resuelve unidad o presentación. Si quedara un
sitio con la conversión propia, ese sería el camino que lee cajas como unidades. (`recostear` no
convierte: trabaja sobre la `cantidad_base` ya congelada.) La validación del borrador también
tiene el guard *"serie o lote solo admiten su unidad base"*, y con presentación deja pasar el lote.

### 4.3 Compra confirmada

- **Corregir la cantidad** ("10 cajas → 8 cajas") usa el **`contenido_base` congelado**, nunca el
  vivo. Con la caja ya editada a 6, bajar a 8 cajas saca 24 unidades, no 12.
- **El historial** guarda la cantidad como se tipeó (8), y la pantalla la muestra con la
  presentación congelada: "10 → 8 Caja (12)".
- El costo por unidad, el descuento, la anulación y el recálculo de § 4.3 de la pieza 1 no
  cambian: trabajan sobre `cantidad_base` y `costo_unitario_base`.

### 4.4 Editar o retirar una presentación

- **Editar** (nombre, contenido, unidad) afecta a los borradores que la usan, que la toman al
  confirmar, y a las compras siguientes. Las confirmadas no cambian porque tienen su número
  congelado.
- **Retirar** la saca del selector. Un borrador que la usa falla al confirmar (§ 4.2) hasta que
  se elija otra unidad.
- Editar o retirar no escribe en el kardex ni en el costo.

## 5. API

Todas bajo `JwtAuthGuard + TenantGuard + PermisosGuard`, con el `tenant_id` del token, en
`ComprasController`. Van declaradas **antes** de `GET /compras/:id` para que `presentaciones` no
se lea como un id.

| Endpoint | Permiso | Qué hace |
|---|---|---|
| `GET /compras/presentaciones?proveedorId=` | Crear | Las vivas del proveedor, de todos sus productos, en una consulta. Cada una con `id`, `itemId`, `nombre`, `contenido`, `unidadCodigo` |
| `POST /compras/presentaciones` | Crear | `{ proveedorId, itemId, nombre, contenido, unidadCodigo }` |
| `PATCH /compras/presentaciones/:id` | Crear | `{ nombre?, contenido?, unidadCodigo? }`. Ausente es "no se toca"; `null` es 400 |
| `DELETE /compras/presentaciones/:id` | Crear | Retira (marca `eliminado_el`) |

**Validaciones de crear y editar (400):** proveedor que no es un proveedor vivo del tenant;
producto que no lleva stock, que va por serie o que está en la papelera; unidad desconocida o no
compatible con la base; contenido que no es `> 0` o que convertido a la base cae bajo la
precisión de stock; nombre vacío o de solo espacios; nombre repetido entre las vivas del par (el
índice único, mapeado a 400 y no a 500). Una presentación de otro tenant da 404.

`contenido` va como string decimal (`@IsNumberString` + `@IsDecimalPositivo`), igual que toda
cantidad de kardex.

**En el detalle de la compra**, cada línea suma `presentacion: { id, nombre, contenido,
unidadCodigo } | null`. En una confirmada, `nombre` y `contenido` salen de lo congelado
(`contenido` en unidad base y `unidadCodigo` la base). En un borrador, salen de la presentación
viva.

## 6. Pantalla

**Carga del borrador** (`pages/compras/[id].vue`):

- Al elegir el proveedor se piden sus presentaciones (una llamada). El selector **Unidad** de cada
  línea ofrece las unidades compatibles de hoy y, además, las presentaciones de ese proveedor
  para ese producto ("Caja (12)"). Al final va **"+ Nueva presentación…"**, deshabilitada hasta
  que haya proveedor y producto, y para productos por serie no aparece.
- **"+ Nueva presentación…"** abre un modal chico: nombre, contenido y unidad (solo las
  compatibles; para un producto en `unidad` queda fija). Al guardar queda elegida en la línea.
- Con una presentación elegida aparece **el lápiz**: el mismo modal, con **Guardar** y
  **Retirar**. Retirar pide confirmación y deja la línea en la unidad base.
- **La cuenta a la vista**, debajo de la línea: *"10 × Caja (12) = 120 unidades · $800 c/u"*. El
  resumen de confirmar muestra la cantidad en unidades base.
- **Cambiar de proveedor** devuelve a la unidad base las líneas con presentación, con un aviso
  de cuántas cambiaron.
- La lógica de armar la etiqueta y la cuenta vive en `composables/useCompras.ts`, no en el
  `.vue`.

**Compra confirmada** (`CompraConfirmada.vue`): la línea se lee *"10 Caja (12) · 120
unidades"*. `CorregirLineaModal` pide la cantidad en cajas, y el historial la muestra así.

**No cambia:** el listado de compras, el descuento, la anulación ni el kardex. Inventario sigue
viendo 120 unidades.

## 7. Pruebas

Con valores que discriminen: ni factor 1 ni divisiones que siempre den exactas.

**Unitarias y e2e de la API:**

- 10 cajas × $9.600 con "Caja (12)" → **120 unidades a $800**, y el CPP lo refleja.
- 3 cajas × $10.000 → 36 unidades a **$833,3333**: la división no da exacta.
- "Saco (25 kg)" de un producto en g: 2 sacos → 50.000 g.
- **Lote:** 10 cajas del lote L123 → 120 en ese lote. Crear una presentación de un producto por
  serie → 400.
- **El borrador toma la caja del día:** creada con 24, editada a 12 antes de confirmar → entran
  120.
- **La confirmada no se mueve:** confirmada con 12, la caja pasa a 6 y bajar a 8 cajas saca 24
  unidades. Es el test que caza a quien use el contenido vivo.
- Retirada entre el borrador y confirmar → 400. Presentación de otro proveedor o de otro
  producto → 400. Las dos, `unidadCodigo` y `presentacionId`, o ninguna → 400. Nombre repetido
  vivo → 400; repetido con la anterior retirada → 201.
- **Aislamiento:** una presentación de otro tenant da 404 al editarla y 400 al usarla en una
  línea. **Permisos:** sin Crear → 403 en los cuatro endpoints.
- **Mutantes que revierten al código anterior, no solo rompen:** confirmar leyendo solo
  `unidad_codigo` (lo de hoy) y corregir con el contenido vivo tienen que caerse con estos tests.

**Front:** specs de componente del selector, del modal y de la cuenta, con el body que se manda
verificado contra el DTO (el mock de `useApiFetch` contesta 200 a cualquier cosa).
**Navegador:** `frontend/e2e/compras/` como **`encargado.compras`**, no como admin: crear "Caja
(12)" desde la línea, confirmar 10 cajas, ver 120 en el resumen, y corregir en cajas.

## 8. Tareas

Cada una con su commit y su cierre (gate completo, `verify-feature` con revisión independiente y
aviso a la sesión orquestadora):

1. **Backend: las presentaciones.** Entidad, índice, los cuatro endpoints, seed ("Caja" de
   Distribuidora Andina para un producto del demo) y `startup-pos.sql`. Deja endpoints que la
   pantalla todavía no usa, y ese estado intermedio es seguro.
2. **Backend: la línea con presentación.** DTO, validación del borrador, el helper único de
   cantidad base, confirmar con lo congelado, corregir la cantidad y el detalle.
3. **Frontend y cierre.** Selector, modal, lápiz, la cuenta, la confirmada, corregir en cajas y
   el spec de Playwright. Docs finales: la entrada de `pendientes.md` pasa a `resueltos.md` en la
   parte de la pieza 2.

Los docs van en el commit de cada tarea: `features/compras.md`, `ESTADO.md` y `PRODUCTO.md`.

## 9. Fuera de esta pieza

- **El código del proveedor y la lectura del XML del DTE:** son la pieza siguiente. La
  presentación es el lugar donde se va a guardar el código ("CC350-12" → Coca-Cola · Caja (12)).
- **Una lista de presentaciones por proveedor:** se puede sumar con el XML, donde también
  mostraría los códigos.
- **Presentaciones para productos por serie**, y en el ajuste manual de stock (`PATCH
  /items/:id/stock`): siguen solo con unidades del catálogo.
- ⛔ **Todo lo fiscal** (IVA no recuperable, ILA): frente aparte.
