# Compras: pre-llenar la compra con el XML de la factura electrónica (DTE)

**Fecha:** 2026-09-27 · **Tipo:** spec de diseño · **Status:** Draft (pendiente de aprobación del owner)
**Frente:** *"Compras: carga manual, y el DTE del SII como atajo encima"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md). Viene después de la pieza 1
([`2026-09-18-compras-recepcion-design.md`](2026-09-18-compras-recepcion-design.md)) y de la
pieza 2 ([`2026-09-27-compras-unidad-de-compra-design.md`](2026-09-27-compras-unidad-de-compra-design.md));
lo que hace hoy compras está en [`features/compras.md`](../../features/compras.md).
**Investigación:** [`2026-09-27-carga-stock-por-factura.md`](../../agent/investigaciones/2026-09-27-carga-stock-por-factura.md).
**Fuente primaria del formato:** SII, *Formato de Documentos Tributarios Electrónicos*, v2.5
2026-02 ([`formato_dte_202602.pdf`](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)),
citado abajo como "Formato DTE, pág. N".

---

## 1. El problema que cierra

Un cliente pidió "cargar el stock con la factura". El XML del DTE le llega al encargado por
correo, y hoy igual tiene que tipear la compra línea por línea. La investigación concluyó que
las líneas de producto **solo** están en el XML (el Registro de Compras del SII trae una
línea por documento), y que ningún sistema escribe stock directo desde la lectura: todos
paran en un borrador para revisar.

Esta pieza hace eso: **el encargado sube el XML y el formulario de compra de siempre queda
pre-llenado**. La primera vez asocia cada línea a un producto y a una unidad o presentación;
el sistema recuerda el código del proveedor y la próxima factura calza sola.

## 2. Decisiones

**Heredadas, sin re-litigar:**

- **Una sola recepción, dos formas de llenarla** (owner, 2026-09-03). El XML pre-llena el mismo
  borrador de la pieza 1; nunca un segundo flujo. La carga manual es el camino base.
- **Alcance: el encargado sube el archivo.** Conectarse al SII (Portal MIPYME, casilla de
  intercambio, credenciales, aceptar o reclamar) queda fuera (sesión orquestadora a pedido del
  owner, 2026-09-27).
- **El código del proveedor entra en esta pieza**, aprendido de la primera asociación
  (spec pieza 2, § 2, fila "¿El código del proveedor entra ahora?").
- ⛔ **Lo fiscal va solo** (CLAUDE.md, ADR-010): IVA no recuperable, ILA en el costo y la
  aceptación o reclamo del DTE (Ley 19.983) no entran. Leer montos para pre-llenar sí; decidir
  su tratamiento tributario no.

**Tomadas en esta sesión** (owner, 2026-09-27, eligiendo en un selector de opciones con una
escena, montos y el costo de cada opción; en las seis eligió la opción recomendada):

| Pregunta | Decisión | Descartado |
|---|---|---|
| Una línea del XML que el sistema no conoce (la Fanta, primera vez) | **Aparece como línea por asociar**, con el texto de la factura; el encargado elige producto y unidad ahí mismo | *Descartarla con aviso* (el stock queda corto sin que nadie lo note); *ofrecer crear el producto* (el encargado no tiene permiso de Ítems y quedarían productos sin precio de venta) |
| Una línea que no es stock (FLETE, garantía de envase) | **Se aparta como "no es mercadería" y se recuerda**: la próxima llega ya apartada, a la vista y con "Traer de vuelta" | *Quitarla a mano cada vez*; *no mostrarla nunca* (no se distingue de un producto nuevo) |
| El RUT del emisor no calza con ningún proveedor | **El encargado elige el proveedor y el RUT se guarda** si estaba vacío; si tiene otro RUT, se bloquea; si no existe, "pedile a quien tenga Terceros que lo cree" | *Elegir sin guardar* (pregunta cada vez); *crear el proveedor desde la factura* (duplicados, y compras crearía terceros) |
| El XML llega después de una compra ya confirmada sin precio | **Fuera de esta pieza.** Si el folio ya existe, "ya está cargada" y ofrece abrirla | *Completar precios de una confirmada desde el XML* (duplica el frente y pasa por el recálculo del CPP); *reemplazar líneas de un borrador* |
| Corregir una asociación mala ("FA350-12" → Sprite) | **En la línea**: dice por qué calzó y se cambia; al guardar reaprende | *Pantalla de códigos por proveedor* (se anota en el backlog) |
| Una factura grande a medio asociar | **Se asocia todo antes de guardar**; salir sin guardar pide confirmación | *Guardar líneas sin producto* (cambia la forma del borrador y el camino de confirmar) |

Y, a pedido del owner, la entrada en [`DIFERENCIADORES.md`](../../DIFERENCIADORES.md) (📐).

**Tomadas en el diseño y aprobadas por el owner sección por sección** (2026-09-27, en el chat):

- **El XML se lee en el navegador** (`DOMParser`, § 4.1), no en el servidor. Sin dependencia
  nueva y sin endpoint de subida de archivos. Descartado: subirlo y leerlo con
  `fast-xml-parser` (dependencia nueva y primer upload del sistema, sin ganancia de
  seguridad: ver § 4.2).
- **Los códigos van en una tabla propia**, `codigos_proveedor`, no en la presentación como
  anticipaba la spec de la pieza 2 § 9. Motivo: un código también apunta a un producto en su
  unidad base ("HARINA KG" → Harina en kg) y a "no es mercadería", y ninguno tiene
  presentación donde colgarse.
- El precio, el descuento y el aprendizaje, como están en § 3 y § 5.

## 3. Qué se lee y cómo se pre-llena

Campos del DTE: Formato DTE, pág. 11–16 (encabezado) y pág. 35–42 (detalle).

### 3.1 Encabezado

| Del XML | Al formulario | Regla |
|---|---|---|
| `RUTEmisor` | Proveedor | Se compara normalizado (sin puntos, `K` mayúscula, con guion) contra `rut` y `rut_fiscal` de los proveedores vivos del tenant. Uno solo → elegido. Ninguno o más de uno → "¿Qué proveedor es?" (§ 6) |
| `TipoDTE` | Documento | Por `tipos_documento_compra.codigo` del país del tenant. **61 (nota de crédito) y 56 (nota de débito) se rechazan**: "Las notas de crédito y débito no se cargan acá" (son fiscal y deuda, frentes aparte). Un código sin fila → "Este tipo de documento no se carga como compra" |
| `Folio` | Folio | Tal cual |
| `FchEmis` | Fecha del documento | Tal cual |
| `RUTRecep` | — | Tiene que ser el RUT de una razón social viva del tenant. Si no: "Esta factura es para el RUT 77.111.222-3, que no es una razón social de tu empresa", y no se pre-llena nada |
| — | Entra a | La elige el encargado, igual que hoy |

**Folio ya cargado:** una compra viva, no anulada, del mismo proveedor, tipo y folio (la
misma unicidad de la pieza 1) → "Esta factura ya está cargada (confirmada el 22/09)", con un
botón para abrirla; no se pre-llena nada. Si el proveedor se eligió a mano, se verifica
después de elegirlo.

### 3.2 Líneas (`Detalle`, hasta 60, Formato DTE pág. 35)

- **Cantidad:** `QtyItem` (hasta 6 decimales en el formato). Con más de 4 decimales (la escala
  del kardex) o ausente, la línea llega **sin cantidad** y marcada.
- **Unidad de la factura** (`UnmdItem`, 4 caracteres): solo se muestra como referencia ("3
  CJ"). La unidad real sale de la asociación (§ 5).
- **Precio unitario:** `MontoItem ÷ QtyItem`, a escala de costo (4 decimales). `MontoItem` es
  *"(Precio Unitario × Cantidad) – Monto Descuento + Monto Recargo"* (Formato DTE, pág. 41),
  así que ya trae el descuento de esa línea: 10 CJ a $9.600 con $4.800 de descuento →
  $91.200 ÷ 10 = **$9.120 c/u**, y la línea lo dice ("incluye el descuento de la línea de la
  factura"). Sin descuento da igual a `PrcItem`.
- ⛔ **`MntBruto = 1`** (precios con IVA incluido, Formato DTE pág. 12, campo 10): **los precios
  quedan vacíos**, con el aviso "Esta factura trae los precios con IVA incluido: tipeá el
  neto". Sacar el IVA es decidir tratamiento tributario: frente fiscal. El costo sigue siendo
  "lo que dice la línea del documento" (pieza 1), neto.
- **La clave de la línea** (para aprender, § 5): el primer par `TpoCodigo` + `VlrCodigo` de
  `CdgItem` ("INT1 · CC350-12"), en mayúsculas y sin bordes. `CdgItem` es opcional (hasta 5
  pares, Formato DTE pág. 35); sin código, la clave es **el texto** `NmbItem` normalizado
  (mayúsculas, espacios colapsados). Costo del texto: si el proveedor cambia una letra, deja
  de calzar y vuelve a preguntar; nunca calza mal.

### 3.3 Descuento de la factura (`DscRcgGlobal`, hasta 20, Formato DTE pág. 43)

- **En $**: al descuento de la compra (`descuentoTotal`) tal cual. **En %**: % × la suma de
  `MontoItem` de las líneas a las que aplica según el SII (afectas; exentas si trae
  `IndExeDR = 1`; no facturables si `IndExeDR = 2`), redondeado a la moneda. Varios se suman.
- **Un recargo global** no se carga (la compra no tiene recargos): aviso con el monto.
- **Con una línea apartada como "no es mercadería"**, el descuento entra igual por el monto de
  la factura y cae entero sobre la mercadería: 2% sobre $100.000 de mercadería + $5.000 de
  flete = **$2.100**, no $2.000. Es visible y el encargado lo corrige; repartirlo exacto es
  decidir cómo se trata un descuento sobre un gasto, que es la pieza 4.
- **Si alguna línea queda sin precio** (IVA incluido, cantidad rara), el descuento no se carga
  y se avisa: la pieza 1 exige todas las líneas con precio para cargarlo.

### 3.4 Lo que no se lee

La firma (`Signature`) y el timbre (`TED`) no se verifican (§ 4.2). Referencias, impuestos
adicionales, retenciones y montos en otra moneda se ignoran. Nada del XML se guarda.

## 4. Dónde se lee, y la seguridad

### 4.1 En el navegador

La pantalla lee el archivo con `DOMParser` y lo convierte en datos planos (§ 3). Al servidor
viaja **ese JSON**, no el archivo. Probado el 2026-09-27 contra happy-dom (el entorno de
`npm test`): parsea el XML con el namespace del SII si se busca por nombre de tag
(`getElementsByTagName`); `getElementsByTagNameNS('*', …)` no encuentra nada ahí, así que no
se usa.

- **Tamaño:** hasta 2 MB (una factura de 60 líneas con su firma pesa del orden de 50 KB).
- **Encoding:** los XML del SII declaran `ISO-8859-1`. Se lee el archivo como bytes y se
  decodifica con el encoding que declara la cabecera (`TextDecoder`); leído como UTF-8, "CAFÉ"
  se rompe.
- **XXE y "billion laughs":** un DTE no lleva `<!DOCTYPE>`, que es la única puerta de las dos.
  **Todo archivo con `<!DOCTYPE` o `<!ENTITY` se rechaza antes de parsear**, sin depender de
  las defensas del parser del navegador.
- **Que sea un DTE:** raíz `EnvioDTE` (con uno o más `DTE`) o `DTE` suelto, con
  `Documento/Encabezado/IdDoc/TipoDTE`. Si no: "Este archivo no es una factura electrónica
  del SII".
- **Varios documentos en un envío:** una lista corta (tipo, folio, emisor, total) para elegir
  uno.

### 4.2 Qué garantiza y qué no

**El borrador sale tan confiable como tipeado a mano, y pasa por las mismas validaciones de
`POST /compras`.** El servidor no puede confiar en el XML de ninguna forma, porque no
verificamos la firma digital del SII (frente propio, si alguna vez hace falta). Por eso el
chequeo "la factura es para tu empresa" es **un resguardo contra errores, no un control de
seguridad**, y leer en el servidor no daría más garantía. Las claves y el RUT que se aprenden
son datos que declara el cliente, igual que un producto tipeado, acotados al tenant del token
y al proveedor validado.

**Costo aceptado:** si algún día existe una ingesta automática desde la casilla de intercambio
(del lado del servidor), el lector se reescribe en el backend.

## 5. Qué se aprende, dónde y cuándo

### 5.1 `codigos_proveedor` (nueva)

| Columna | Tipo | Nota |
|---|---|---|
| `codigo_proveedor_id` | `uuid` PK | |
| `tenant_id` | `uuid` NOT NULL | Del token |
| `proveedor_id` | `uuid` NOT NULL | Un `tercero` proveedor vivo del tenant |
| `clave` | `varchar(160)` NOT NULL | § 3.2. 160 alcanza para `TpoCodigo` (10) + `VlrCodigo` (35) y para `NmbItem` (80) |
| `descripcion` | `varchar(80)` NOT NULL | El `NmbItem` de cuando se aprendió, para mostrar qué calzó |
| `no_mercaderia` | `boolean` NOT NULL default false | |
| `item_id` | `uuid` NULL | |
| `presentacion_compra_id` | `uuid` NULL | |
| `unidad_codigo` | `text` NULL | |
| `creado_el` / `actualizado_el` / `eliminado_el` | `timestamptz` | |

- **CHECK:** o `no_mercaderia` y los tres destinos en null, o `item_id` con **exactamente una**
  de `presentacion_compra_id` / `unidad_codigo` (el mismo "una u otra" de la línea, pieza 2).
- **Índice único parcial** `(tenant_id, proveedor_id, clave) WHERE eliminado_el IS NULL`: una
  sola viva por clave. Sin función en la expresión, así que va en la entidad.
- **Reaprender no pisa:** marca la anterior con `eliminado_el` e inserta la nueva. Queda la
  historia de a qué apuntaba (el owner pide reversibilidad).

### 5.2 Cuándo se aprende: al guardar el borrador

En `POST /compras` y `PATCH /compras/:id`, en la misma transacción:

- **Cada línea que vino del XML** trae `claveProveedor` (y `descripcionProveedor`). Si la clave
  no tiene fila viva, o la tiene con otro destino, se aprende el destino de la línea (producto +
  presentación o unidad). Con el mismo destino, no se escribe nada.
- **El body trae `apartadas: [{ clave, descripcion }]`**: las líneas marcadas "no es
  mercadería". Se aprenden igual, con `no_mercaderia = true`.
- **`rutProveedor`** (cuando el proveedor se eligió a mano, § 3.1): si el proveedor tiene `rut`
  y `rut_fiscal` vacíos, se guarda en `rut_fiscal` (es el RUT del emisor legal del
  documento). Si tiene alguno y ninguno coincide, **400**.
- **Una línea tipeada a mano** no trae clave y no toca la tabla.

Por qué al guardar y no al confirmar: con "se asocia todo antes de guardar", guardar es el
primer momento en que todo está decidido, y evita persistir líneas a medio leer. Costo: un
borrador que después se borra ya enseñó; queda a la vista y se corrige en la línea.

⚠️ **Confirmar, el kardex y el CPP no cambian.** El borrador guardado es el mismo de siempre.

### 5.3 Cuándo se usa: al leer

`POST /compras/dte/lectura` (§ 7) resuelve todas las claves de la factura **en una consulta**
(`clave = ANY($1)`, vivas, con el producto y la presentación vivos por `JOIN`). Si el destino
se retiró o se borró después, la línea llega **por asociar** con una nota genérica ("la
presentación a la que apuntaba fue retirada" / "el producto al que apuntaba ya no está"): nunca
pre-llena algo que ya no existe. La nota **no nombra** la presentación retirada a propósito:
nombrarla obligaría a leer una fila borrada, una lectura sin el filtro de `eliminado_el`
(invariante 3) para un texto de ayuda (corregido al planificar, 2026-09-27).

## 6. Pantalla

**Dónde:** solo en **Nueva compra** (`/compras/nueva`), con un botón **"Cargar desde la
factura (XML)"** en el encabezado. Si ya se tipeó algo, pregunta "reemplaza lo cargado"
antes de leer.

**El modal** (`components/compras/CargarDteModal.vue`): elegir el archivo, los rechazos de
§ 4.1, elegir documento si el envío trae varios, y los bloqueos de § 3.1 (receptor, notas,
ya cargada con su botón para abrirla). **"¿Qué proveedor es?"** también va acá, con la lista de
proveedores, antes de pre-llenar.

**El formulario pre-llenado** es el de siempre, más:

- una franja arriba: *"Cargado desde la factura 33 N° 123 · Distribuidora Andina · Aceptar o
  reclamar esta factura se sigue haciendo en el SII"*, y los avisos de § 3 debajo;
- en cada línea del XML, sobre el producto, el texto de la factura (*"COCA COLA 350ML CJ12 ·
  10 CJ · $9.600"*) y una insignia: **"calzó por código"** (neutra) o **"por asociar"**
  (advertencia, producto y unidad vacíos, cantidad y precio llenos);
- un botón **"No es mercadería"** en cada línea del XML, que la manda a una sección plegable
  **"No se cargan (no es mercadería)"** con el texto, el monto y **"Traer de vuelta"**. Las ya
  aprendidas llegan ahí;
- **Guardar** deshabilitado con *"Faltan 2 líneas por asociar"* mientras alguna no tenga
  producto y unidad;
- **salir sin guardar** después de leer un XML pide confirmación (`onBeforeRouteLeave`, con el
  precedente de `pages/salones/index.vue`, más `beforeunload` al cerrar la pestaña). Solo en ese
  caso: la carga manual queda como hoy.

**Dónde vive la lógica** (`docs/patterns/frontend.md`, las páginas no llevan lógica de negocio):
el lector (bytes → documento, § 3 y § 4.1) y la aplicación de lo que devolvió el servidor a las
líneas del formulario son funciones puras en `composables/useDte.ts`. La página solo las
cablea.

**No cambia:** el listado, la confirmada, corregir, anular. Guardada, la compra no guarda que
vino del XML.

## 7. API

Bajo `JwtAuthGuard + TenantGuard + PermisosGuard`, `tenant_id` del token, en
`ComprasController`, declarada antes de `GET /compras/:id`.

**`POST /compras/dte/lectura`** · permiso **Compras · Crear** (el mismo de guardar el
borrador). Es una lectura; va por POST por el tamaño del body.

```
body: {
  emisorRut, receptorRut, tipoDte, folio,  // la razón social no viaja: el servidor no la usa
  proveedorId?,                          // cuando el encargado lo eligió a mano
  claves: string[]                       // hasta 60, cada una ≤ 160
}
respuesta: {
  receptorEsDelTenant: boolean,
  proveedor: { id, nombre } | null,
  candidatos: { id, nombre }[],          // si hay más de uno con ese RUT
  tipoDocumento: { id, nombre } | null,  // null → no se carga (incluye 61 y 56)
  compraExistente: { id, estado, confirmadoEl } | null,
  asociaciones: {
    clave,
    destino: { itemId, presentacionId | unidadCodigo } | 'no_mercaderia' | null,
    nota?: string                        // "la presentación a la que apuntaba fue retirada"
  }[]
}
```

Sin proveedor resuelto, `asociaciones` sale vacía: la pantalla vuelve a llamar con el
`proveedorId` elegido. **Con `proveedorId`**, si ese proveedor tiene un RUT y no es el del
emisor → **400**, el mismo bloqueo que al guardar (§ 5.2); también si no es un proveedor vivo
del tenant.

Consultas acotadas y fijas (ninguna por línea): razones sociales, proveedor por RUT, tipo por
código, compra existente, claves con `ANY`. Todas filtran `eliminado_el IS NULL`.

**`POST /compras` · `PATCH /compras/:id`** suman, opcionales:

- en la línea: `claveProveedor` (≤ 160), `descripcionProveedor` (≤ 80);
- en el body: `apartadas: [{ clave, descripcion }]` (≤ 60) y `rutProveedor`.

⚠️ **El front manda exactamente lo que el DTO declara.** Se va a prender `forbidNonWhitelisted`
(aviso de la sesión orquestadora, 2026-09-27): un campo que el DTO no declare pasa a ser 400 en
vez de borrarse en silencio. El documento leído tiene muchos más campos que los que viajan
(cantidades, precios, textos de cada línea): `useDte.ts` arma el body de la lectura con **solo**
los campos de arriba, nunca esparciendo el documento, y los specs de componente verifican ese
body contra el DTO (el mock de `useApiFetch` contesta 200 a cualquier cosa). Los e2e nuevos usan
`validacionGlobal()` de `src/common/pipes/validacion-global.pipe`, no un `ValidationPipe`
propio.

## 8. Pruebas

Con valores que discriminen: ni factor 1 ni divisiones exactas.

**Lector (front, puro, con XML de fixture en `frontend/test/fixtures/dte/`):** tildes en
ISO-8859-1; envío con 3 documentos y DTE suelto; `<!DOCTYPE` y un archivo que no es DTE,
rechazados; precio con el descuento de la línea (**$9.120**, no $9.600); `MntBruto=1` sin
precios; cantidad con 6 decimales; descuento global en $ y en % (2% de $105.000 = **$2.100**);
recargo → aviso; línea sin código → clave por texto.

**API (e2e):** proveedor por `rut` y por `rut_fiscal`, con y sin puntos; desconocido y dos con
el mismo RUT → pregunta; receptor de otra empresa → bloqueado, segunda razón social del mismo
tenant → pasa; nota de crédito → sin tipo; folio en borrador y en confirmada → ya cargada, en
anulada → libre; código hacia presentación retirada → por asociar con nota. Aprender:
reaprender deja la anterior con `eliminado_el`; RUT guardado solo si estaba vacío, otro RUT →
400; línea manual no enseña. **Aislamiento** (códigos de otro tenant no se ven) y **permisos**
(403 sin Crear).

**Mutantes que revierten, no solo rompen:** aprender pisando en vez de marcar; leer claves sin
el filtro de `eliminado_el`; calzar el proveedor solo por `rut`.

**Navegador, como `encargado.compras`:** el XML de Andina → asociar la Fanta, apartar el
FLETE, guardar y confirmar (120 unidades). Otra factura de otro folio llega **toda calzada**,
con el FLETE apartado. Y el caso "ya está cargada".

⚠️ **Choque del seed:** el RUT de Distribuidora Andina (`76.123.456-7`) es el mismo de la razón
social del tenant demo, así que toda factura de fixture se leería "para sí misma". Andina
recibe un RUT propio (sin datos productivos: se cambia el seed y se resetea).

## 9. Tareas

Cada una con su commit y su cierre (gate completo, `verify-feature` con revisión
independiente y aviso a la sesión orquestadora):

1. **Backend: la tabla y la lectura.** `codigos_proveedor` (entidad, registrada en
   `app.module.ts`), `POST /compras/dte/lectura`, el RUT propio de Andina y
   `startup-pos.sql`.
2. **Backend: aprender al guardar.** Las claves, las apartadas y `rutProveedor` en el DTO y en
   el guardado del borrador.
3. **Frontend: el lector.** `useDte.ts` con sus fixtures. Función pura, sin pantalla.
4. **Frontend: la pantalla y el cierre.** Modal, pre-llenado, líneas por asociar y apartadas,
   el aviso de salir, Playwright, y los docs: `features/compras.md`, `ESTADO.md`,
   `PRODUCTO.md`, `DIFERENCIADORES.md` (📐 → ✅) y `pendientes.md` → `resueltos.md` en la parte
   de esta pieza.

Cada estado intermedio es seguro: los endpoints y el lector existen antes de que alguien los
use.

## 10. Fuera de esta pieza (van al backlog)

- **Completar los precios de una compra ya confirmada con el XML** (decisión 4).
- **Una pantalla de códigos por proveedor** (decisión 5; la spec de la pieza 2 § 9 también la
  dejaba para acá).
- **Traer el XML desde el SII** (casilla de intercambio, Portal MIPYME) y **aceptar o reclamar**
  el DTE (Ley 19.983).
- **Verificar la firma digital del DTE.**
- **Notas de crédito y débito del proveedor** (61, 56): fiscal y deuda.
- ⛔ **Todo lo fiscal:** IVA incluido (`MntBruto`), IVA no recuperable, ILA.
