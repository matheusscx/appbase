# Producto — SaaS POS Multi-tenant

> Documento vivo. Describe lo que se quiere construir.
> Las secciones marcadas con `[ PENDIENTE ]` requieren decisión antes de implementar.

---

## Qué es

Sistema SaaS de punto de venta y facturación **multi-tenant**. Cada tenant (empresa) opera
de forma completamente aislada: su propio catálogo, monedas, impuestos, usuarios, roles y
ventas. Un mismo usuario puede pertenecer a varios tenants y cambiar de contexto.

Base de datos: **PostgreSQL**. Esquema en `startup-pos.sql`.

**Aritmética financiera:** toda operación con dinero y porcentajes usa **Decimal.js** —
sin `number` nativo de JS para evitar errores de punto flotante. Los valores se persisten
en la BD como `NUMERIC(18,4)` y se operan como `Decimal` en la capa de negocio.

---

## Alcance de interfaz — anchos soportados

**Escritorio (1280px) y tablet (768px) soportados.** Móvil (~375px) está **fuera de
alcance declarado**, no es deuda pendiente.

Por qué: a 375px este sistema no tiene un problema de layout — es otra interfaz. Las
tablas de muchas columnas, el drawer lateral y la grilla de ítems compitiendo con el
carrito no se resuelven angostando CSS; requieren un rediseño de navegación e
interacción propio (colapsar columnas, reemplazar el drawer por otra jerarquía, decidir
qué hace el carrito cuando no cabe junto al catálogo). Eso es un proyecto de producto,
no un ajuste de este documento.

Vigilancia: `frontend/e2e/layout/desborde.spec.ts` corre en CI contra los dos anchos
soportados, en 4 rutas representativas de cada arquetipo de layout de la app. Falla si la
página gana scroll horizontal, o si un texto truncado (`white-space: nowrap` +
`overflow: hidden` computados) fuerza a su ítem flex/grid ancestro a desbordar su propio
contenedor — la forma de bug concreta documentada en `docs/patterns/frontend.md` §16, no
"cualquier elemento que desborde por cualquier razón": una tabla con scroll horizontal
propio (`overflow-x: auto`), por ejemplo, es intencional y el spec no la marca.

---

## Modelo de datos central

Tres entidades que no deben confundirse:

| Concepto | Tabla | Descripción |
|---|---|---|
| **Tenant** | `tenants` | Empresa que contrata el SaaS. Dueña de todos los datos de negocio. |
| **Usuario** | `usuarios` | Persona que opera el sistema. Puede pertenecer a N tenants. |
| **Customer** | `venta_customer` | Comprador final en una transacción. No tiene login. |

Casi toda tabla de negocio tiene `tenant_id` como parte de su clave o como FK obligatoria.

### Unicidad de nombre — case-insensitive (decisión del owner, 2026-08-01)

Donde un catálogo exige nombre único por tenant, **"Extras" y "extras" son el
mismo nombre**. La razón es de uso, no de esquema: en una lista que alguien elige
a ojo —un cajero, un mesero— dos entradas que solo difieren en mayúsculas son un
error de tipeo, no dos cosas distintas.

Aplica a los ocho catálogos que hoy tienen la regla: `descuentos`, `recargos`,
`turnos`, `cajones`, `causas_merma`, `motivo_diferencia_caja`,
`motivo_diferencia_inventario`, `grupos_modificadores`. Los ocho la enforcean
igual: índice único parcial sobre `(tenant_id, lower(nombre))` con
`WHERE eliminado_el IS NULL` —parcial para que borrar y volver a crear con el
mismo nombre funcione—, más una validación en código que compara igual y da el
mensaje amable. Un catálogo nuevo con nombre único sigue esa forma.

Nada obliga a que un catálogo tenga la regla: siete recursos (`items`,
`categorias`, `impuestos`, `terceros`, `salones`, `mesas`, `impresoras`) admiten
nombres repetidos a propósito.

---

## Funcionalidades

### 1. Autenticación ✅ *ya implementada en la nueva app*

- Login con `nombre_usuario` + contraseña → devuelve `access_token` + `refresh_token`
- Refresh de access token
- Cambio de contraseña
- Validación de token

**Reglas:**
- Dos secretos JWT distintos: uno para access (~15 min), uno para refresh (~7 días)
- Contraseña hasheada (bcrypt)
- **Los refresh sí se persisten** (`refresh_tokens`): rotan en cada uso, dejan lápida
  (`usado_el`) para detectar reuso, y se pueden revocar. El access token sigue siendo
  stateless — se valida por firma, no contra la base.

✅ **Contestado (2026-08-22): la revocación real existe**, y no solo en el logout —
`POST /auth/logout` borra ese refresh; el reuso de un token ya rotado revoca todos los del
usuario; y cambiar la contraseña o de tenant también revoca. Ver la regla de sesión en §2.

---

### 2. Perfil y contexto multi-tenant

El usuario opera en **un solo tenant por sesión** — selecciona uno al entrar y todo el contexto gira en torno a ese tenant hasta que cambie.

Flujo modular en dos pasos:

1. **GET /perfil** — devuelve datos del usuario + lista de tenants a los que pertenece (solo id y nombre, para mostrar el selector)
2. **GET /perfil/:tenant_id** — al seleccionar un tenant, carga el detalle completo: rol, módulos accesibles, permisos, monedas configuradas, razones sociales, sub-tenants

**La sesión es de la cuenta, no del tenant** (decisión del owner, 2026-08-22). Una persona
que pertenece a varios tenants tiene **una sola vida de sesión**: cambiar de tenant activo
—o cambiar su contraseña— revoca sus refresh tokens **en todos los tenants y en todos sus
dispositivos**, y tiene que volver a entrar.

**No son sesiones paralelas por tenant, y no hacen falta.** Técnicamente podrían acotarse
—`refresh_tokens.active_tenant_id` sabe de qué tenant era cada sesión—, pero el owner
decidió que no: una credencial es de la persona, no del tenant, así que la revocación
también. Quien opera en dos empresas cambia de contexto y vuelve a entrar.

ℹ️ Salió de la auditoría del 2026-08-22 como pregunta abierta, no como bug: **nadie ajeno
puede provocarlo** —solo la propia persona, actuando sobre su propia cuenta—. Se documenta
acá para que no se vuelva a levantar como hallazgo.

⚠️ **Si algún día se revierte esta decisión, la trampa está medida:** un filtro
`WHERE active_tenant_id = :tenantId` **no** alcanza. Las sesiones recién logueadas nacen con
`active_tenant_id = null` —todavía no eligieron tenant— así que ese filtro las dejaría vivas
en otros dispositivos, que es justo lo contrario de lo que buscaría el acotamiento. Lo
detectó la revisión independiente del 2026-08-22 al verificar el docblock de `switchTenant`.

---

### 3. Control de acceso (RBAC)

Modelo: `rol → módulo contratado → permisos`

**Dos niveles de actor:**

- **Superadmin del SaaS** — contrata módulos por tenant (`tenant_modulos`). El tenant no puede
  gestionar sus propios módulos.
  ⚠️ **Contrata, no desactiva** (medido el 2026-08-23): existe `POST /admin/tenants/:id/modules`
  y **ninguna baja** — `tenantModuloRepo` solo hace `create`/`save`/`find`. Dar de baja un
  módulo hoy es tocar la base a mano. Esta línea decía "contrata/desactiva" y era falsa.
  📌 **`MiCaja` y `Cajas` se venden juntos, y con `Ventas` presencial** (regla del owner,
  2026-08-22): no son dos productos sino dos alcances de permiso modelados como módulos —el
  cajero operando su turno, y la supervisión de las cajas ajenas—, y sueltos no sirven. Nada
  en el código sostiene la convención: el alta de tenant no contrata **ningún** módulo, así
  que un tenant con `MiCaja` y sin `Cajas` es construible por descuido, y ahí sus cajeros se
  ven la plata entre ellos ([`features/ventas.md`](features/ventas.md)).
- **Admin del tenant** — crea roles personalizados, les asigna módulos contratados y permisos, y los asigna a usuarios del tenant.

**Roles:**
- `admin` — rol fijo del sistema, acceso completo dentro del tenant. Se crea automáticamente al dar de alta un tenant.
- Roles personalizados — creados por el admin del tenant. Ejemplo: "cajero" con módulo Caja y permisos para crear ventas pero no eliminarlas.

**Multi-rol por usuario:** un usuario puede tener **varios roles** dentro de un mismo
tenant; sus permisos son la **unión** de todos sus roles. Esto permite roles granulares
y componibles (ej. "Caja" + "Reportes") en vez de obligar a crear un rol a medida por
usuario. La administración de roles y la asignación a usuarios se hace desde
**Configuración → Roles y permisos / Usuarios** (solo el admin del tenant).

**Superadmin:** contexto completamente separado. Flag `es_superadmin` en la tabla `usuarios`. Rutas `/admin/*` protegidas por un guard propio, independiente del RBAC de tenants. El superadmin no opera dentro de ningún tenant.

**Enforcement:** real en el backend (decisión B). Cada ruta valida rol + módulo contratado + permiso del usuario sobre el tenant activo.

**Un alta pendiente no es editable** (decisión del owner, 2026-08-22). Al dar de alta a
alguien, los roles elegidos quedan **congelados en el token de confirmación**
(`tokens_acceso.datos`) y la persona **no tiene fila en `usuarios_tenants`** hasta que
confirma: no es miembro por construcción, y por eso ninguna lectura de membresía necesita
conocer un estado intermedio. El admin que se equivocó de roles **repite el alta**: eso
invalida el link anterior y emite uno nuevo con los roles corregidos —dar de alta dos veces
deja **un** link válido, el último—.
Se eligió eso en vez de un endpoint que reescriba los roles del token vivo: el camino barato
ya deja el sistema consistente, y reemitir el link es además lo seguro, porque el mail viejo
—con los roles viejos congelados adentro— deja de servir. La pantalla de Usuarios muestra las
acciones de fila deshabilitadas para los pendientes, con el motivo escrito: **no es una
omisión de UI, es esta regla**.

---

### 4. Gestión de tenants y razones sociales

- Creación de tenants gestionada por el **superadmin** (no hay registro propio por ahora)
- CRUD de datos del tenant: nombre, correo único, teléfono, dirección, provincia
- CRUD de razones sociales del tenant: datos legales para emitir facturas (nombre legal, RUT, dirección)

**Sub-tenants:** funcionalidad futura — no entra en el alcance actual.

---

### 4b. Terceros

Directorio de entidades externas del tenant: proveedores, empresas compradoras y personas naturales recurrentes. No tienen acceso al sistema — son registros de referencia reutilizables.

**Datos:** nombre, RUT, tipo (`proveedor` | `empresa` | `persona_natural`), correo, teléfono, dirección, datos de facturación (nombre legal, RUT fiscal).

**Usos:**
- Al emitir una factura → seleccionar tercero y autocompletar datos de facturación
- Compradores frecuentes → no reingresar datos en cada venta
- Proveedores → referencia para compras y documentos

---

### 5. Catálogos base globales

Tablas sembradas por seeder, no editables por el usuario final:

- `pais` (nombre, ISO-2, zona horaria)
- `provincia` (FK país, zona horaria)
- `moneda` (nombre, ISO-3, símbolo, decimales, separador decimal, separador de miles)
- `modulos_app` (módulos disponibles en el SaaS)
- `permisos` (permisos disponibles por módulo)
- `metodos_pago` (catálogo global de métodos)

---

### 6. Configuración de monedas por tenant

- La **moneda oficial** del tenant la determina su país (`pais.moneda_oficial_id`) — no la elige el tenant. Es la moneda legal para facturación.
- El tenant puede **habilitar monedas adicionales** (USD, UF, etc.) para cobrar en ellas
- Puede marcar una moneda habilitada como **default** (preseleccionada en el UI)
- Registra la **tasa de cambio del día** (`valor_del_dia`) por moneda adicional, actualizable en cualquier momento
- El catálogo `moneda` define **separadores de presentación** (`separador_decimal`, `separador_miles`): Chile usa `,` y `.` (ej. `$ 1.000,50`); México usa `.` y `,` (ej. `$ 1,000.50`)
- Al procesar una venta en moneda no oficial → se convierte a la moneda oficial usando `valor_del_dia` vigente en ese instante
- Las facturas siempre se emiten en la moneda oficial del país

**Regla crítica:** `pais` debe tener su `moneda_oficial_id` configurado. Sin ella el tenant no puede operar.

**Fase posterior:** integración con proveedor externo para obtener tasas automáticamente.

---

### 7. Catálogos financieros por tenant

Cada tenant define sus propias reglas reutilizables:

**Categorías** — agrupan items (`aplica_a`: productos, servicios o ambos)

**Impuestos** — nombre + porcentaje (decimal) + activo + `tipo` (`iva` | `otro`, no expuesto en la API de escritura). Dos orígenes conviven en el mismo catálogo:
- **Oficiales por país** (`origen: 'sistema'`) — ej. IVA Chile 19%, compartido por todos los tenants de ese país. **No editables por el tenant** (solo lectura en la UI); se administran únicamente vía seeder — agregar un país nuevo es agregar su catálogo al seed, sin CRUD superadmin.
- **Personalizados por tenant** (`origen: 'personalizado'`) — el tenant puede crear/editar/eliminar los suyos, siempre con `tipo = 'otro'` (forzado en backend; `tipo = 'iva'` es exclusivo de las filas del sistema, para evitar que un tenant recree duplicados de IVA).

**Regla "exento" (clasificación tributaria del item):** un item puede marcarse `afecto` (default) o `exento`. `exento` suprime **únicamente** el IVA de esa línea; los impuestos adicionales (`item_impuestos`, siempre `tipo = 'otro'`) siempre se aplican, esté o no exento. La clasificación se **congela por línea de venta** (`venta_detalles.clasificacion_tributaria`) en el momento de vender — no se recalcula si el item cambia de clasificación después, y una nota de crédito hereda la clasificación congelada de la línea original, no la del item vigente.

**El IVA se deriva, nunca se asigna.** Un item `afecto` lleva el IVA del país sí o sí y no se le puede quitar; uno `exento` no lo lleva. `item_impuestos` guarda solo los impuestos **adicionales** que el usuario asoció — el IVA nunca es una fila ahí, lo agrega el motor de precios al resolver cada línea a partir de la clasificación. Mandarlo por payload (item o línea de venta) es 400 en cualquier endpoint. `tipo='ingrediente'` no tiene clasificación tributaria (`NULL`: no se vende, no aplica). Ver [ADR-018](./adr/018-iva-derivado-de-la-clasificacion.md), [ADR-011](./adr/011-catalogo-impuestos-sistema.md) y [features/impuestos.md](./features/impuestos.md).

**Descuentos y Recargos** — comparten estructura:
- `modo`: `porcentaje` | `monto_fijo`
- `valor`
- `condicion_tipo`: `ninguna` | `customer` | `producto` | `categoria` | `fecha` | `metodo_pago` | `vencimiento`
- `condicion_valor`, `fecha_inicio`, `fecha_fin`

**El tipo y el modo son ejes independientes.** El *tipo* (`tipos_regla.codigo`)
dice **cuándo** se aplica la regla: `pronto_pago` (si paga antes), `metodo_pago`
(según el medio), `por_mayor` / `por_monto_venta` (por tramos), y `directo` — el
que no tiene otra condición que la fecha. El *modo* dice **cómo** se expresa el
importe: porcentaje o monto fijo. Cualquier tipo puede ir en cualquiera de los
dos modos, salvo `pronto_pago`, `interes_simple` e `interes_compuesto`, que el
backend fuerza a porcentaje. Que `directo` sea el más usado con monto fijo es
un accidente del catálogo de ejemplo, no la definición.

**Cualquier regla con `fecha_inicio`/`fecha_fin` vale solo entre esas fechas**
(ambos bordes inclusive, día local del tenant) — no es un tipo aparte: las
fechas son opcionales en cualquier tipo, y una regla sin ellas está vigente
siempre. El tipo `promocional` (fechas obligatorias) se eliminó: era la misma
capacidad con un nombre que iba a chocar con el futuro módulo de promociones —
ver `docs/superpowers/specs/2026-08-23-vigencia-por-fecha-design.md`. Una regla
fuera de vigencia no cobra y no avisa al vender; la pantalla de configuración
la marca "Vencida"/"Programada".

**Toda regla expresa su monto** (decisión del owner, 2026-08-01): un descuento
o recargo sin importe no descuenta ni recarga nada, así que no se puede guardar.
Se cumple de dos formas según el tipo — con un `valor` único, o con `tramos`
(`por_mayor`, `por_monto_venta`, donde cada tramo trae el suyo)—, y **la
validación mira el estado con el que la fila queda, no los campos que llegan en
el `PATCH`**. Esa distinción no es teórica: cambiar el *tipo* cambia qué campos
hacen falta, así que un `PATCH` que solo manda `tipoReglaId` puede dejar un
descuento sin importe sin haber tocado ningún campo de importe. Detalle de las
cuatro formas en que se llegaba a ese estado, todas verificadas abiertas contra
la API antes de cerrarlas: [`docs/agent/resueltos.md`](./agent/resueltos.md).

**Toda regla declara dónde se aplica** (decisión del owner, 2026-08-15): por **línea** o
por **venta**. Una de línea se asocia a ítems y se mide contra el subtotal de esa línea;
una de venta se elige al cobrar y se mide contra el acumulado de la venta. Hasta el
2026-08-25 la misma fila servía para las dos cosas, así que *"20% sobre compras de
$50.000"* podía usarse en los dos lados sin que nada lo dijera, midiendo cosas distintas.
Es **binario**: quien quiera la misma promo en los dos lugares crea dos reglas. El backend
rechaza usar una regla por la puerta que no le corresponde, y rechaza pasarla a nivel venta
mientras ítems la usen.

⚠️ **El nivel lo declara quien crea la regla; el tipo no lo deduce.** Un tipo "por monto de
venta" puede quedar en nivel línea, y ahí sus tramos se miden contra la línea — que es un
uso legítimo (*"llevando $50.000 de este vino, 10% en el vino"*) y también la forma de
equivocarse sin que nada avise. Lo que la columna garantiza es que la MISMA regla no sirva
para las dos cosas, no que el nivel sea el correcto.
Detalle en [`docs/features/descuentos-recargos.md`](./features/descuentos-recargos.md).

**[ PENDIENTE ]** ¿Se implementa la evaluación de condiciones (`condicion_tipo`, vigencia,
modo escalonado)? En el sistema original estas columnas existen pero la lógica no está
implementada.

**Regla producto-vs-promo** (decisión del owner, julio 2026, escrita el 2026-08-27 al
construirse el módulo de promociones): dos formas distintas de "cobrar menos por un
conjunto" conviven en el sistema — un **combo** (sección 8c, con grupos de modificadores si
hay elección) y una **promoción** (2x1/NxM, happy hour, combo a precio fijo por tiempo
limitado — ver [`features/motor-promociones.md`](./features/motor-promociones.md)). El
criterio para elegir cuál usar:

- **¿Está siempre en la carta, con su propio precio?** → **catálogo**: es un combo (item
  `tipo='combo'`, con grupos de modificadores si el customer elige entre opciones).
- **¿Aparece o desaparece según día, hora o cantidad pedida?** → **promoción**: el
  descuento tiene que vivir donde se **mide** como descuento (`ventas_promociones`), no
  mezclado en el precio de un item que existe todo el tiempo. Un "2x1 los martes de 18 a
  20" nunca es un combo con ese horario incrustado en su ficha — es una promoción sobre los
  ítems que ya están en la carta.

La distinción no es cosmética: un combo es un **item nuevo** que el catálogo vende como
unidad (una línea de venta, precio propio fijo, sin conocimiento de la vigencia); una
promoción es un **descuento sobre líneas que ya existen**, medible por separado de
`descuentos` y sin tocar el catálogo de items. Mezclarlos —por ejemplo, un combo cuyo precio
cambia según la hora— rompería la invariante de precio propio fijo del ADR-012 y dejaría el
descuento por horario sin medición propia.

**Métodos de pago** — catálogo global habilitado por tenant (`tenant_metodo_pago`)

---

### 8. Catálogo de items

Modelo: **tabla base + extensiones por tipo** — escala limpiamente cuando se agreguen nuevos tipos (combos, suscripciones, modificadores, etc.).

**`items` (base):** campos comunes a todos los tipos — tenant, nombre, descripción, precio base, moneda, categoría, activo, tipo, **clasificación tributaria** (`afecto` default | `exento` | `NULL` en `ingrediente` — ver regla en sección 7).

Extensiones actuales:
- **`item_producto`** — stock, unidad de medida, fecha elaboración, fecha vencimiento
- **`item_servicio`** — duración estimada, `requiere_cita` (flag informativo, sin agenda por ahora)
- **`item_suscripcion`** — `frecuencia` (`'semanal'` | `'quincenal'` | `'mensual'`). Representa un ítem de cobro recurrente (ver 10b); no fija día de cobro ni tarjeta — eso lo elige el customer al suscribirse.
- **`item_receta`** — producto compuesto sin stock propio; descuenta stock de sus ingredientes al venderse (ver `docs/features/recetas.md`).
- **`item_combo`** — paquete con precio propio fijo, sin stock propio; descuenta stock de sus componentes fijos al venderse (ver 8c).

Cada item:
- Puede tener N impuestos **adicionales** (nunca el IVA, que se deriva — ver sección 7), N descuentos, N recargos asociados
- El stock se descuenta **automáticamente** al procesar una venta, generando un movimiento de inventario (ver 8b) — **solo aplica a `producto`**; `servicio` y `suscripcion` no participan del tracking de inventario. `receta` y `combo` no tienen stock propio: descuentan el de sus ingredientes/componentes (ver 8c).

Extensiones futuras contempladas: combos con grupos de modificadores (elección, ej. "elige tu bebida"), items digitales.

**Alertas útiles:** stock bajo, productos próximos a vencer.

---

### 8b. Inventario (kardex de movimientos de stock)

Trazabilidad de stock para items tipo **producto**. Todo cambio de stock queda registrado como un movimiento auditable; el campo `item_producto.stock` es el **saldo materializado** para lectura rápida y alertas, y la tabla de movimientos es la **fuente de verdad**.

**`movimientos_inventario`:** tenant, item, `tipo` (`entrada` | `salida` | `ajuste`), `motivo` (`compra` | `venta` | `devolucion` | `merma` | `ajuste_manual` | `inventario_inicial` | `recuento`), cantidad (siempre positiva; el tipo define el signo), `stock_anterior`, `stock_resultante`, `venta_id` opcional, `usuario_id` (quién lo registró), comentario.

**Reglas:**
- Solo aplica a items `tipo = 'producto'` (los servicios no tienen stock).
- El movimiento y la actualización del saldo ocurren en **una sola transacción**; la `salida` valida stock suficiente (no se permite saldo negativo).
- **Ventas:** cada línea de una venta genera un movimiento `salida` / `motivo = 'venta'` con su `venta_id`, dentro de la transacción de la venta. Las notas de crédito / devoluciones generan `entrada` / `motivo = 'devolucion'`.
- **Ajustes manuales:** entrada/salida/ajuste con `motivo = 'ajuste_manual'` y comentario.
- `tenant_id` y `usuario_id` vienen del token, nunca del body.

**Costo de un producto: promedio ponderado móvil (CPP), no último costo.**
`item_producto.costo_actual` se recalcula **solo** con una entrada `motivo = 'compra'`
que trae `costoUnitario`: `(stock_anterior × costo_actual + cantidad × costo_compra) /
(stock_anterior + cantidad)`. Sin stock previo o sin costo previo, el costo de compra
manda tal cual (no hay masa que promediar). Ninguna otra entrada ni ninguna salida mueve
el costo — ni siquiera la devolución de venta, porque la unidad que vuelve ya salió con
un costo congelado y re-promediarla mezclaría costo de venta con costo de compra.

**Costo `0` y "sin costo" son estados distintos, y el sistema no los mezcla** (decisión
del owner, 2026-08-29). El `0` es un costo **conocido**: mercadería de donación o muestra
cuesta 0 de verdad, y como tal pesa en el promedio ponderado y valoriza sus mermas en
cero. `NULL` es "no sé cuánto costó": no mueve el promedio, deja las mermas sin valorizar
y es lo único que cae en la bandeja "Ítems sin costo" (`GET /items?sinCosto=true`, que
filtra por `IS NULL`). Se puede crear un ítem con `costo: '0'`, y **cualquier** movimiento manual puede traer
`costoUnitario: '0'`: en una entrada por `compra` o `devolucion` ese cero **recalcula** el
promedio; en las demás entradas y en las salidas solo se congela en el kardex. Lo que ningún
camino acepta es un costo **negativo**. La excepción
es el `ajuste_costo`, que exige `> 0`: ahí el cero no informaría un costo, anularía el
promedio.

Corregir un costo mal cargado (typo, migración) tiene una vía explícita y auditada: la
operación `ajuste_costo` (`tipo = 'ajuste'`), que exige un comentario y deja registrado
en el kardex el costo anterior y el nuevo. `PATCH /items/:id` **no** puede escribir el
costo directo — solo existe en la creación del item, como costo de apertura. El costo es
de gestión (margen, food-cost, valorización de mermas), no la valorización tributaria de
existencias: esa la produce el contador. Detalle y porqué: [ADR-016](./adr/016-costeo-promedio-ponderado-movil.md).

**El costo se carga al comprar o en el producto — nunca al mermar.** Una merma no tiene
campo de costo: se valoriza sola con el `costo_actual` vigente del ítem al momento de
mermar. Si el ítem no tiene costo cargado, la merma se registra igual, sin valorizar, y
**queda así para siempre** — no existe un camino que le ponga costo después a una merma
vieja. Es el mismo criterio que congela el precio de una venta ya emitida, y el mismo
principio que [ADR-010](./adr/010-preparacion-sii-datos-fiscales.md) aplica al hecho
fiscal: el número vale lo que valía cuando el hecho ocurrió, no lo que se sabe después.
Detalle: [`mermas-valorizadas.md`](./features/mermas-valorizadas.md).

**Lo que una mesa pide queda apartado desde que lo pide** (decisión del owner, 2026-09-01;
construido ese mismo día). Hasta entonces pedir en una mesa **no miraba el stock**: dos
mesas podían pedir la misma última unidad y el choque estallaba **al cobrar**, con la comida
ya servida y la línea imposible de sacar por estar despachada. La mesa quedaba trabada y la
única salida era un ajuste de inventario a mano. Ahora la segunda mesa se entera **al
pedir**, que es cuando todavía puede ofrecer otra cosa.

- **Dura mientras dure la cuenta**, sin vencimiento por tiempo. **Quitar la línea, bajarle la
  cantidad o cancelar la cuenta liberan** lo apartado — vuelve a estar disponible para otra
  mesa. ⚠️ **Cerrar la cuenta NO libera nada: convierte lo apartado en salida real**, porque
  ahí la venta descuenta el stock de verdad. Es la diferencia que más se presta a confusión, y
  el número que ve la otra mesa es el mismo antes y después de que la primera cobre. **Fusionar
  dos cuentas es neutro**: las líneas siguen vivas en una cuenta abierta, así que el
  comprometido no se mueve. Una cuenta **olvidada** inmoviliza stock hasta que alguien la cierre
  o la cancele: es un trade-off **aceptado a propósito** por el owner, no un descuido.
- **Un plato aparta sus ingredientes, no el plato.** Se expande la receta —o los componentes
  del combo, o la opción de grupo elegida— **modulada por la personalización de esa línea**,
  igual que lo hace la venta: la hamburguesa sin queso no aparta queso y la de doble
  proteína aparta el doble.
- **Lo no bloqueante suma pero no frena.** Un ingrediente no bloqueante ocupa lo que le toca
  y **no** impide pedir; por eso su disponible puede quedar **negativo**, y se muestra así a
  propósito: clamplearlo a cero escondería justo el número que el encargado necesita ver.
- **Nada se escribe.** No hay reserva guardada ni columna nueva: lo apartado es la suma de
  lo que consumirían las líneas vivas de las cuentas **abiertas**, calculada cuando se
  pregunta. La reserva **no toca `movimientos_inventario`** y el stock sigue saliendo recién
  al cerrar la cuenta ([`inventario-kardex.md`](./features/inventario-kardex.md)).

Dos reglas **nuevas desde el 2026-09-01**. La primera se siente en el local desde el primer
día; **la segunda todavía no**, y el porqué está en su propia viñeta:

- **Un ítem sin stock cargado ya no se puede pedir en una mesa.** El tope compara contra el
  stock, y un producto en `0` —o que nunca tuvo stock cargado— rechaza el pedido con `400`.
  Es coherente con lo que ya pasaba al cobrar (esa cuenta reventaba al cerrar), pero **lo
  siente cualquier tenant que nunca cargó inventario**: hasta ayer podía pedir igual. No se
  exceptúa el `0` a propósito — exceptuarlo sería incoherente con rechazar el cuarto pedido
  de un stock de 3. Los `servicio` y las `suscripcion` no se ven afectados (no consumen nada),
  y una receta cuyos ingredientes en cero sean todos **no bloqueantes** tampoco.
- **Subir la cantidad de una línea es un pedido nuevo por la diferencia, y se topea igual.**
  Pasar de 1 a 3 se mide como un pedido de 2 y puede rechazarse. **Bajarla solo libera y
  nunca se rechaza por stock** — soltar mercadería no puede sobrevender. (El guard de agosto
  sigue: no se puede bajar por debajo de lo ya enviado a cocina.)
  ⚠️ **Esta segunda regla todavía no se siente en el local, aunque el backend la haga cumplir:**
  el cambio de cantidad desde `/salones` **no llega al servidor** por un bug de la pantalla
  anterior a este frente, así que hoy solo se la alcanza por API. Entrada propia en
  [`agent/pendientes.md`](./agent/pendientes.md) § 3.

⚠️ **Esto achica el caso de la mesa trabada, no lo borra.** Una merma, un recuento o un
ajuste manual pueden dejar el stock por debajo de lo ya comprometido, y esa mesa vuelve a
quedar sin poder cobrar y sin poder sacar la línea. **La salida con motivo —merma o
cortesía— sigue sin existir** y sigue haciendo falta ([`agent/pendientes.md`](./agent/pendientes.md) § 3).

**Fuera de alcance (fases futuras):** bodegas/almacenes y stock por bodega, traspasos,
FIFO o método de costeo elegible por tenant. La **tienda online** tiene el mismo hueco por
otro camino —el carrito vive en el navegador y entre la orden de pasarela y el callback de
pago nadie retiene nada—: no se tocó, se anota para cuando se encare.

---

### 8c. Combos (paquetes con precio propio)

Un item `tipo='combo'` (ej. "Combo Clásico" = Hamburguesa Clásica + Papas) es un
paquete de venta con **componentes fijos** (`producto` | `receta` | `servicio`,
cada uno con cantidad y flag `bloqueante`). No tiene stock propio: al venderse,
descuenta el de cada componente según su tipo (producto → salida directa; receta
→ se expande a sus ingredientes; servicio → sin efecto de inventario).

**Reglas de negocio:**
- **Precio propio, no la suma de componentes.** El tenant fija `precio_base` del
  combo igual que cualquier item; no se deriva automáticamente del precio de sus
  piezas. Solo `item_combo.costo_actual` (para margen) sí es la suma de los
  costos de sus componentes.
- **Una sola línea de venta.** Un combo vendido genera **una** línea en
  `venta_detalles` al precio del combo — no se explota en N líneas por
  componente. El descuento de stock por componente ocurre por debajo, en la
  misma transacción de la venta, sin afectar el total cobrado ni el desglose
  visible al customer.
- **Disponibilidad conservadora.** `disponible` en el listado es el mínimo entre
  los componentes **bloqueantes** (los no bloqueantes no limitan la
  disponibilidad mostrada); un componente `servicio` se ignora en el cálculo.
  `null` si el combo no tiene componentes bloqueantes.
- **Bloqueante sin stock aborta; no bloqueante advierte.** Mismo criterio que
  recetas: un componente bloqueante sin stock suficiente aborta toda la venta;
  uno no bloqueante se omite y la venta continúa con una advertencia.
- **Sin combos anidados.** Un combo no puede ser componente de otro combo — solo
  producto/receta/servicio.

**Grupos de modificadores (elección del customer):** ver sección 8d — un combo
puede llevar, además o en vez de componentes fijos, grupos de modificadores
asociados (ej. "elige tu bebida"). **Además**, si un componente es una
**receta** que a su vez tiene su propio grupo (ej. "elige tu proteína"), esa
elección se ofrece automáticamente al vender el combo, **por unidad** del
componente — ver sección 8d, "Grupos anidados en combos".

---

### 8d. Grupos de modificadores reutilizables

Un **grupo de modificadores** es un conjunto de opciones definido **una vez a
nivel tenant** y asociable a **N combos o recetas distintos** (ej. el grupo
"Bebida" puede vivir en varios combos sin duplicar su catálogo de opciones).
Cada opción es un item existente (`producto | receta | servicio |
ingrediente`) con cantidad y recargo propios dentro del grupo. Al asociar un
grupo a un item se define cuántas **unidades totales** debe elegir el
customer (`min`/`max`).

**Reglas de negocio:**
- **Reutilizable, sin tipo declarado.** El grupo no dice de antemano "soy de
  ingredientes" o "soy de productos" — su **familia de efecto**
  (`ingrediente` | `vendible`) se **deriva** del tipo de sus opciones y se
  **verifica homogénea** al guardar (todas `ingrediente`, o todas
  `producto/receta/servicio` — nunca mezcladas). La familia no se persiste;
  se recalcula en cada lectura.
- **`min`/`max` en unidades totales, no en cantidad de opciones distintas.**
  Un grupo `min:1, max:1` exige elegir exactamente 1 unidad (de cualquier
  opción); `min:1, max:2` permite 2 unidades de la misma opción o 1+1 de dos
  distintas — se valida la **suma de unidades** elegidas, no cuántas opciones
  distintas se tocaron.
- **La cantidad y el recargo de una opción se definen por receta; el grupo es
  catálogo reutilizable con un default opcional** (2026-07-21). Cada opción
  del grupo tiene una `cantidad`/`unidadCodigo`/`precioExtra` **default**,
  pero cada receta o combo que usa el grupo puede **overridear** esos valores
  para su propio consumo, sin duplicar el grupo ni afectar a las demás
  recetas que lo comparten — el mismo grupo "Proteína" puede consumir 150 g
  en una receta y 250 g en otra. Si el default falta y ninguna receta lo
  overridea, la opción queda **pendiente** para esa receta (no se ofrece en
  el POS) hasta que se defina una cantidad, por override o por default del
  grupo. Ver `docs/features/grupos-modificadores.md` § "Cantidades de consumo
  por item" y ADR-014 (esto reemplaza el trade-off "sin override" de
  ADR-013(c), que solo cubría precio y obligaba a duplicar el grupo entero
  para variar un valor).
- **Opción siempre bloqueante.** A diferencia de los ingredientes fijos de una
  receta (que pueden marcarse no bloqueantes), una opción de grupo elegida
  explícitamente por el customer sin stock **aborta la venta** — no hay
  "elegí X pero se vendió sin X".
- **Combos: "≥1 componente" se relaja a "≥1 componente o grupo".** Un combo
  puede existir compuesto **solo** por grupos (sin componentes fijos); en ese
  caso su `costo_actual` es `0` hasta que se vende (el costo real se realiza
  vía el movimiento de inventario de la opción elegida).
- **Snapshot congelado, revalidado por el backend.** La elección del customer
  (grupo + opción + unidades) se congela en `personalizacion` de la línea de
  venta; el backend siempre revalida `min ≤ Σunidades ≤ max` y recalcula el
  precio contra el catálogo vivo — nunca confía en el precio que mande el
  frontend.
- **Bloqueo de borrado en ambos sentidos.** Un item que es opción viva de un
  grupo no puede eliminarse; un grupo asociado a items vivos no puede
  eliminarse.
- **Lo que una mesa ya pidió no se saca del catálogo** (2026-08-30). La regla
  anterior mira el catálogo; ésta mira la **operación**: si una cuenta de salón
  **abierta** ya pidió un item —sea como la línea misma o **adentro** de su
  personalización—, ese item no se elimina. El motivo no es integridad
  referencial sino que el cobro re-tasa la línea contra el catálogo vivo:
  sacarle una pieza deja la mesa **incobrable**, con un error que nadie ve hasta
  que el garzón intenta cerrar la cuenta. Cerrada o cancelada la cuenta, el item
  vuelve a ser borrable — es un bloqueo por mesa viva, no un endurecimiento del
  catálogo.

  **Alcance hoy (2026-08-30):** la regla está puesta en los **cinco** caminos que
  sacan del catálogo algo ya pedido: el borrado (`DELETE /items/:id`), para el
  item de la línea y para el ingrediente pedido como extra; las tres ediciones de
  `PATCH /items/:id` —`ingredientes`, `extrasPermitidos` y `gruposModificadores`—;
  y `PATCH /grupos-modificadores/:id`. En las ediciones se compara el **diff**:
  bloquean lo que *se saca*, no la lista que cambia, así que reordenar, repreciar,
  cambiar min/max o agregar siguen pasando **por estos guards** — lo que no
  quiere decir que sean inocuos, ver la advertencia de abajo.

  ⚠️ **Sacar no es lo único que rompe la mesa** (medido el 2026-08-30, al cerrar
  el quinto camino). La re-tasación no solo re-precia: **re-valida** el snapshot
  congelado contra el catálogo vivo, así que también la rompen cosas que se
  *agregan* o se *endurecen* —asociar un grupo con `min ≥ 1`, subir el `min` de
  uno ya asociado— y una que sí es un "sacar" pero por otro campo: quitar de un
  combo un componente que la línea personalizó. Cerrar esos de a uno es la misma
  carrera; la alternativa de fondo —que re-tasar una línea ya pedida re-precie
  **sin** re-validar— es decisión de producto y está sin tomar.
  ✅ **DECIDIDO (owner, 2026-08-30) y CONSTRUIDO el 2026-08-31:** al cobrar **manda
  lo que la mesa ya pidió, no la carta de hoy**. Re-tasar una línea de una cuenta
  abierta pasa a **re-preciar sin re-validar** —la personalización congelada es un
  hecho, no una entrada del cliente que haya que volver a aprobar— y **el precio es
  el de cuando se pidió**: si el extra de queso valía $700 y sube a $1.200 con la
  mesa sentada, esa mesa paga $700. No reabre la regla de que **el precio de una
  línea lo calcula el servidor**: sigue calculándolo él, leyendo la foto que él
  mismo congeló. Es motor de cálculo, así que va como frente propio.
  La línea de cuenta congela al pedirse su precio (en la moneda del ítem, la tasa
  y el convertido) y sus descuentos y recargos resueltos; el cierre y la precuenta
  se arman con eso. Dos pedidos del mismo plato se juntan en una sola línea solo
  si comparten personalización, precio y reglas. Detalle:
  `docs/features/salones-mesas.md`.

  ⚠️ **Los impuestos siguen vivos**, y `precio_incluye_impuesto` del ítem también:
  son materia fiscal (ADR-010) y congelarlos es otro frente.

**Fuera de alcance (diferido, no un olvido):** la **impresión térmica** de la
opción elegida de un grupo en comanda/precuenta/boleta queda para un ticket
aparte (decisión confirmada por el usuario, 2026-07-20) — hoy la comanda
imprime el item por su nombre sin desglosar la opción elegida. El snapshot ya
congela todo lo necesario (`grupoNombre`, `itemNombre` de la opción,
`unidades`) para implementarlo después sin migración.

**Grupos anidados en combos, un nivel (2026-07-22).** Al vender un combo cuyo
componente es una receta con su propio grupo de modificadores, el customer
elige, **por cada unidad** de ese componente, la opción de cada uno de sus
grupos (ej. un combo con 2 hamburguesas pregunta la proteína dos veces,
pudiendo ser distinta en cada una). Reglas:
- **Automático, sin configuración del combo.** Cualquier componente receta
  con grupos los expone al vender el combo — no hace falta asociar nada al
  combo mismo ni curar qué grupos aplican.
- **Por unidad, elecciones independientes.** El snapshot y el descuento de
  stock trackean cada (componente, unidad) por separado.
- **Solo componentes receta.** Un componente `producto` puro no tiene grupos
  propios (los grupos solo se asocian a `receta` o `combo`).
- **Un nivel de profundidad.** Combo → componente receta → sus grupos; no se
  soporta un nivel adicional (un grupo cuya opción a su vez tenga grupos).
- El recargo de la opción elegida se suma al precio del combo (Decimal.js,
  igual canal que los grupos propios); el stock de la opción elegida se
  descuenta siempre bloqueante, por unidad, dentro de la misma venta.
- Dos combos idénticos con distinta elección por unidad **no se mergean** en
  la misma línea (Salones).

Detalle técnico completo: `docs/features/grupos-modificadores.md` §
"Grupos anidados en combos (un nivel)" y ADR-015.

---

### 8e. Recuento de inventario (conteo físico)

Una **sesión de conteo físico** con ciclo de vida (`borrador → aplicado | cancelado`)
sobre productos en `modo_inventario='cantidad'`: se eligen los productos a contar (congela
el stock del sistema de cada uno), se carga el conteo a lo largo del tiempo, y solo al
**aplicar** se mueve stock real — no es un ajuste inmediato.

**La diferencia se aplica como delta, no como valor absoluto.** Contar 11.800 unidades a
las 10:00 y aplicar a las 14:00 habiendo vendido 500 en el medio: si el recuento seteara
el stock al valor contado, pisaría esa venta y el stock quedaría inflado. La regla es
`delta = cantidad_contada − stock_sistema` (calculado y congelado al cargar el conteo);
al aplicar, ese delta se suma sobre el **stock vigente**, no sobre el contado. El faltante
o sobrante que descubrió el conteo es real independientemente de lo que se haya vendido
después — un POS de venta física sigue vendiendo mientras alguien cuenta, a diferencia de
un almacén que bloquea la ubicación durante el conteo.

**La causa de la diferencia usa un catálogo propio** (`motivo_diferencia_inventario`),
no `causas_merma`: un recuento puede dar **sobrante**, y ninguna causa de merma explica un
sobrante; además mezclar las dos ensuciaría el reporte de mermas. El movimiento del kardex
siempre lleva `motivo='recuento'` — la causa es un atributo (`motivo_diferencia_id`), no
reclasifica el movimiento. Hay una causa por defecto para toda la sesión, con override por
línea cuando una unidad puntual tiene explicación propia.

**Contar y aplicar exigen permisos distintos** (`Inventario/Crear` vs.
`Inventario/Actualizar`): aplicar mueve stock real, así que separa a quien cuenta de quien
aprueba a propósito — si contar exigiera el mismo permiso que aplicar, cualquiera que
pudiera contar podría también aplicar, y la separación se cae.

Es el insumo que le faltaba al reporte de varianza teórico-vs-real (AVT, patrón
Toast/xtraCHEF): recetas costeadas y mermas valorizadas ya existían; el conteo periódico
era la pieza que faltaba.

**Fuera de alcance (fases futuras):** modos `serie` y `lote`, cycle count programado
(recordatorio de contar cada N días), conteo ciego, reporte de varianza (AVT) en sí.
Detalle completo: [`docs/features/recuento-inventario.md`](./features/recuento-inventario.md).

---

### 9. Motor de cálculo de precios

Cálculo puro (sin persistencia). Opera con **Decimal.js** y porcentajes siempre en decimal (decisiones E).

**Fórmula configurable por tenant (`tenant_formula_precio`):**

```
[fijo]   precioNeto      = precioBase sin impuesto
                           (si precio_incluye_impuesto → extraer:
                            neto = base / (1 + Σ tasas vigentes de la línea))
[paso 1] → aplicar descuentos  ┐
[paso 2] → aplicar recargos    ├ orden configurable por tenant
[paso 3] → aplicar impuestos   ┘
[fijo]   totalFinal      = resultado del último paso
```

Cada paso aplica sobre el resultado acumulado del paso anterior. El tenant puede reordenar los pasos intermedios según su modelo de negocio o requisito legal.

**Configuración por defecto** (sembrada al crear el tenant):
`precioNeto → descuentos → recargos → impuestos → totalFinal`

**Configuración adicional por tenant:**
- `calculo_descuentos`: `'base'` (todos sobre precioNeto) | `'compuesto'` (cada descuento sobre el resultado del anterior)

**Configuración por item:**
- `precio_incluye_impuesto: boolean` — si el precio ingresado ya incluye impuestos o no.
  **Incluye TODOS los impuestos que apliquen al ítem, no solo el IVA** (decisión del owner,
  2026-08-04): el precio de góndola de una botella con ILA ya trae IVA *e* ILA, y tratarlo
  como "IVA solamente" agregaría el ILA encima de un precio que ya lo tenía. Por eso el
  desbruteo divide por la **suma** de las tasas vigentes, no por una sola.
  **Si un impuesto incluido se pausa, la etiqueta manda:** el precio final no se mueve y lo
  que dejó de cobrarse pasa a ser neto. Es fiscalmente coherente —la boleta reporta más neto
  y menos impuesto, que es exactamente lo que ocurrió— y evita que lo cobrado deje de
  coincidir con el precio impreso en góndola. Ver
  [motor-calculo-precios.md](features/motor-calculo-precios.md).
  **La etiqueta manda cuando el cliente paga la etiqueta** (decisión del owner, 2026-08-21):
  lo que decide es la base, no si se aplicaron reglas. Un descuento y un recargo que se anulan
  dejan al cliente pagando el precio de góndola, y el documento tiene que declararlo — antes
  esa línea caía a la fórmula y el 16% de los precios cobraba ±1 peso contra su propia
  etiqueta. Las dos reglas se siguen imprimiendo en el ticket; lo que cambia es de dónde sale
  el impuesto.

**Conversión de moneda:**
- Si la moneda del item ≠ moneda oficial → `totalConvertido = totalFinal × valor_del_dia`
- Si la moneda del item = moneda oficial → sin conversión

---

### 10. Procesamiento de ventas (transaccional)

Dos canales diferenciados:
- **Físico** — requiere caja abierta manualmente por el usuario
- **Online** — pago inmediato, se asigna automáticamente a la caja virtual del tenant

La venta lleva un campo `canal` (`'fisico'` | `'online'`) que determina el flujo y permite filtrar reportes.

**Tipos de documento tributario:** tabla propia `tipos_documento_tributario` vinculada a `pais` — cada país define sus documentos legales. Ejemplos Chile: Boleta, Factura, Nota de Crédito, Nota de Débito. No es un enum fijo.

**Estados de la venta:**
- (sin `borrador`: la venta en construcción es la `cuenta` de salones)
- `pendiente` — confirmada, esperando pago (canal físico)
- `pagada` — pago recibido y confirmado. Las ventas online llegan directamente aquí.
- `cancelada` — anulada. **Solo desde `pendiente`, sin pagos y sin documento tributario**
  (`POST /ventas/:id/anular`, permiso propio `Ventas/Anular`, motivo obligatorio). Una
  venta cobrada o ya documentada no se anula: se revierte con nota de crédito, porque el
  SII no permite anular un DTE aceptado.
  Al anular se elige si el stock vuelve. La pantalla lo ofrece **tildado**, salvo que la
  venta venga de una cuenta de salón con **alguna** línea ya enviada a cocina: ahí nace
  **destildado**, porque reponer comida ya cocinada suma al inventario ingredientes que no
  existen. Es un default, no un bloqueo: el cajero lo tilda igual si la mercadería sigue
  vendible.

**Nota de crédito:** puede ser total (anula la venta completa) o parcial (anula parte). Referencia a la venta original mediante `venta_referencia_id` en la tabla `ventas`.

Registra una venta completa en una sola transacción atómica:

1. Cabecera (`ventas`): tenant, caja, canal, moneda, tipo documento, estado, totales, `venta_referencia_id` (para notas de crédito)
2. Líneas (`venta_detalles`): item, cantidad, precio origen, tasa de cambio, precio convertido, totales por línea
3. Reglas aplicadas (`ventas_descuentos`, `ventas_recargos`, `ventas_impuestos`): valor aplicado, porcentaje y si es por línea o global
4. Customer (`venta_customer`): datos del comprador si aplica
5. Pagos (`pagos`): método, monto en moneda oficial, caja

**Regla:** total por línea = valores unitarios × cantidad. Los descuentos/recargos/impuestos se calculan por unidad y se multiplican.

---

### 10b. Suscripciones (cobro recurrente)

Alta de compras recurrentes sobre items de tipo `suscripcion`, con **primer cobro inmediato** — no hay período de gracia ni facturación diferida.

**Flujo de negocio:**
1. El **admin** del tenant da de alta un item catálogo tipo `suscripcion` en Configuración → Items (nombre, precio por período, `frecuencia`). En este paso **no se cobra nada** — el item solo queda disponible para que un customer se suscriba.
2. El **customer** (usuario logueado, vía Tienda Online) elige un item suscribible, su **día de cobro** y su tarjeta guardada preferida, y confirma.
3. El **primer período se cobra de inmediato**, en el mismo momento del alta, a través de la pasarela dummy — igual que una compra online normal.
4. La venta del primer cobro y la fila de suscripción se crean en **una sola transacción atómica**: si el pago es rechazado, no queda ni venta ni suscripción huérfana (mismo patrón todo-o-nada del checkout online).

**Día de cobro (elegido por el customer, no por el admin):**
- `mensual`: día del mes, **1 a 28** (evita meses cortos).
- `quincenal`: día del mes, **1 a 13** — se cobra ese día **y** ese día + 15 dentro del mismo mes (dos cobros por mes).
- `semanal`: día de la semana, **0 a 6** (0 = domingo) — un solo cobro por semana.

**Snapshot al suscribirse:** la suscripción copia `frecuencia` del item al momento del alta. Si el admin cambia la `frecuencia` del item catálogo después, **no afecta** a las suscripciones ya activas — cada una conserva su propio snapshot.

**Estados y transiciones:**
- `activa` → `pausada` (acción `pausar`)
- `pausada` → `activa` (acción `reanudar`)
- `activa` | `pausada` → `cancelada` (acción `cancelar`, sin retorno)
- Cualquier otra transición (ej. reanudar una `cancelada`) es inválida y se rechaza.

**Vigencia tras cancelar (`activa_hasta`):** el período ya cobrado no se pierde.
Al cancelar se fija `activa_hasta = proximo_cobro` vigente en ese momento: la
suscripción queda usable hasta el **día anterior** a esa fecha y "se cancela ese
día a primera hora". Ej.: suscripción semanal de lunes cobrada un lunes y
cancelada ese mismo día → sigue válida martes a domingo y se cancela el lunes
siguiente a primera hora. Antes de confirmar la cancelación (cliente o admin) se
muestra un **modal informativo** con ambas fechas.

**Administración (admin del tenant) — módulo RBAC "Suscripciones":**
- Módulo contratable propio con permisos **Leer / Actualizar / Eliminar**,
  enforcement real en backend (`@RequiresPermiso`); el rol admin fijo del tenant
  tiene acceso total.
- Página "Suscripciones" (sidebar): lista **todas** las suscripciones del tenant
  con datos del cliente (nombre, email), estado, vigencia y filtro por estado.
- Acciones del admin sobre cualquier suscripción: pausar, reanudar, cancelar
  (mismo modal de vigencia) y **eliminar** (soft delete, **solo canceladas** —
  evita borrar contratos vigentes por accidente).
- La vista del customer pasa a llamarse **"Mis suscripciones"** y solo opera
  sobre las suscripciones propias.

**Fuera de alcance (fase futura):** cobro automático de los períodos siguientes al primero — hoy se persiste `proximo_cobro` pero no existe un job/cron que lo ejecute (la cancelación efectiva en `activa_hasta` también es informativa).

---

### 11. Consulta de ventas

- Lista las ventas de un tenant con todos sus detalles expandidos
- Distingue reglas aplicadas por línea vs globales (`aplicado_en`)
- CRUD básico por `venta_id + tenant_id`

---

### 12. Gestión de cajas

**Tipos de caja:**
- `fisica` — abierta manualmente por el usuario con saldo inicial en efectivo
- `virtual` — creada automáticamente por el sistema para el tenant, siempre abierta, recibe ventas online

**Operaciones (caja física):**
- **Abrir:** usuario registra el monto inicial de dinero entregado
- **Consultar caja activa:** una sola caja abierta por tenant+usuario en simultáneo
- **Movimientos manuales:** ingresos y egresos fuera de ventas (retiro de efectivo, fondo de cambio, gastos menores). Se registran en `movimientos_caja` con concepto y tipo (`entrada` | `salida`)
- **Cerrar:** el usuario ingresa el monto físico contado. El sistema calcula:
  - `saldo_esperado = saldo_inicial + entradas − salidas`
  - `diferencia = monto_fisico_contado − saldo_esperado`
  - Se persisten ambos valores para auditoría

**Umbral de descuadre al cierre (decisión del owner, 2026-08-23):** el tenant configura
**dos umbrales** de diferencia, y **ninguno de los dos frena el cierre**. Si la diferencia
de alguna línea del arqueo supera el de **aviso**, el cajero ve una advertencia, confirma y
cierra; si supera el **alto**, además el cierre le queda al encargado en una **bandeja de
pendientes de revisar** hasta que alguien lo marque visto. El cajero puede dejar una
**explicación de texto libre** de qué pasó, que la bandeja muestra al lado del monto.

⚠️ Esto **revierte** la decisión del 2026-08-11, que hacía el umbral bloqueante con
aprobación del encargado. La razón del cambio: frenar un cierre a las 2 de la mañana
porque no hay un encargado disponible detiene la operación. El costo asumido, dicho
explícito: el umbral **deja de ser un control preventivo y pasa a ser enteramente rastro**
— si el evento no queda o nadie lo mira, no queda nada.

El **cierre forzado** (el encargado cierra la caja de otro) pasa por el mismo umbral y
entra en la bandeja igual. Quien lo forzó puede marcarlo visto, y queda registrado que fue
él: ahí el control es el registro, no impedir.

Detalle: [`features/gestion-cajas.md`](features/gestion-cajas.md#umbral-de-descuadre-al-cierre--dos-niveles-ninguno-bloquea).

---

### 13. Registro de pagos

- Una venta puede tener **múltiples pagos** con distintos métodos (ej. parte efectivo + parte tarjeta)
- Cada pago: método de pago, monto en moneda oficial, caja
- El monto llega ya convertido a moneda oficial
- No hay integración con pasarela de cobro en esta fase: es registro contable
- El sistema calcula y registra el **vuelto** cuando la suma de pagos supera el total de la venta
- El vuelto solo aplica en métodos que lo permiten (`permite_vuelto = true` en `tenant_metodo_pago`)

---

## Decisiones pendientes (resumen)

| # | Decisión | Impacto |
|---|---|---|
| A | ~~¿Revocación real de tokens (logout)?~~ → Analizar sistema de tokens de la nueva app. Usa JWT estándar de la empresa: access token + refresh token con tiempos ya definidos. | — |
| B | ✅ Enforcement de permisos **real en el backend**. Cada ruta de la API valida que el usuario tiene el permiso correspondiente para el tenant activo. | Guards por ruta en la API |
| C | 🔜 Evaluación de condiciones en descuentos/recargos (`condicion_tipo`, vigencia, escalas). Estructura en BD lista. Requiere análisis especializado — se implementa en una fase posterior. Por ahora solo aplica `condicion_tipo = 'ninguna'`. | Motor de cálculo (fase posterior) |
| D | ✅ Tasa de cambio **manual en primera fase**, proveedor externo en fase posterior. Cada tenant registra su propio `valor_del_dia` por moneda habilitada (el mismo USD vale distinto para un tenant chileno que para uno argentino). La estructura actual en `tenant_moneda` ya soporta esto correctamente. | `tenant_moneda.valor_del_dia` |
| E | ✅ Porcentajes **siempre en decimal** — `0.19` = 19%, `0.05` = 5%. Sin interpretación dual. | Motor de cálculo |
| F | ✅ Apertura de caja **manual** — el usuario registra el monto inicial al abrir. Sin caja abierta no se puede vender (canal físico). **Ventas online:** se asignan a una **caja virtual por tenant**, creada automáticamente por el sistema, siempre abierta. El pago online es inmediato — no hay flujo de apertura/cierre manual. | Flujo de ventas + cajas |
| G | ✅ Creación de ventas pasa por el mismo guard de permisos del backend (resuelto por decisión B). | Backend guard en POST /ventas |

---

## Esquema de base de datos

Ver `startup-pos.sql`. Toda tabla incluye:
- `creado_el TIMESTAMPTZ`
- `actualizado_el TIMESTAMPTZ`
- `eliminado_el TIMESTAMPTZ` — **soft delete**; toda lectura filtra `eliminado_el IS NULL`

En 16 tablas de catálogo del negocio y config operativa, además:
- `eliminado_por UUID` (nullable) — quién borró la fila.

Esas 16 tienen **papelera**: se puede volver a listarlas con `incluirEliminados=true`
y revertir el borrado con `POST .../:id/restaurar`. No aplica a seguridad/acceso,
suscripciones/pasarela, medios de pago tokenizados, transaccional (`cuentas`) ni al
kardex (inmutable por diseño). Detalle: [`docs/features/papelera.md`](./features/papelera.md).
