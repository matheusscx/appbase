# Feature: Salones y Mesas (Restaurante)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-09-01 (lo que la mesa pide queda apartado; pedir de más rebota al pedir)

---

## Identificación del garzón en cada acción

Abrir, cobrar, tomar y transferir una cuenta piden **elegir el garzón de una lista y
después su PIN** (antes se tecleaba el PIN a secas). Son cuatro acciones sobre **tres
rutas** —`POST /mesas/:id/cuentas`, `POST /cuentas/:id/cerrar` y
`POST /cuentas/:id/transferir`, que sirve tanto a "tomar" como a "transferir"— y las tres
llevan `garzonId` además de `pin` en el body. El motivo y la medición están en
[`garzones.md`](./garzones.md).

⚠️ **La transferencia es *pull*, no *push*:** el PIN lo teclea **quien se lleva** la cuenta,
no quien la entrega — la pantalla dice *"PIN para tomar esta cuenta"*. El traspaso al cerrar
turno usa **el mismo** mecanismo; lo único distinto es el dispositivo: el que se hace cargo
teclea su PIN en la tablet del que se va. No es una excepción a la regla *pull*.


## Overview

### ¿Qué es?

Vertical de restaurante sobre el POS. Tiene dos secciones:

- **Administración** — el tenant configura sus **salones** y las **mesas** de cada
  salón, ubicándolas en un plano mediante **drag & drop**.
- **Operación (garzón)** — se elige un salón, se ven las mesas gráficamente, se
  selecciona una mesa y se gestionan sus **cuentas**: crear una o varias cuentas por
  mesa, agregar productos (cuenta abierta = consumo pendiente) y **cerrar la cuenta**,
  lo que genera una **venta real** cobrada en la mesa con el flujo del POS.

### ¿Por qué existe?

En un restaurante el garzón lleva la cuenta de cada mesa y cobra en el lugar. Este
módulo modela esa operación reusando el motor de ventas/cobro existente.

### Scope

- Incluido: CRUD de salones y mesas, plano con posiciones libres `(x, y)`, forma
  (redonda/cuadrada/rectangular) y tamaño (pequeña/mediana/grande/extra grande) de
  mesa, múltiples cuentas abiertas por mesa, agregar/quitar/editar líneas, cancelar
  cuenta, cerrar cuenta → venta (canal `fisico`, requiere caja abierta).
- NO incluido (futuro): mover/unir cuentas entre mesas, capacidad (nº comensales),
  reservas.

---

## API Endpoints

Todos bajo `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)`. Módulo RBAC
**`Salones`**. Administración usa `Leer`/`Crear`/`Actualizar`/`Eliminar`; la operación
del garzón usa el permiso dedicado **`Operar`**.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/salones` | Leer | Salones con sus mesas (admin) |
| POST | `/salones` | Crear | Crear salón |
| PATCH | `/salones/:id` | Actualizar | Renombrar salón |
| DELETE | `/salones/:id` | Eliminar | Eliminar salón (y sus mesas) |
| POST | `/salones/:salonId/mesas` | Crear | Crear mesa en el salón |
| PATCH | `/salones/:salonId/layout` | Actualizar | Guardar posiciones (drag) en bloque |
| PATCH | `/mesas/:id` | Actualizar | Renombrar / reposicionar mesa |
| DELETE | `/mesas/:id` | Eliminar | Eliminar mesa |
| GET | `/salones/operacion` | Operar | Salones + mesas con flag `ocupada` |
| GET | `/mesas/:id/cuentas` | Operar | Cuentas abiertas de la mesa (con líneas) |
| POST | `/mesas/:id/cuentas` | Operar | Abrir cuenta (`FOR UPDATE` mesa + `numero` correlativo) |
| POST | `/mesas/:id/cuentas/fusionar` | Operar | Fusionar 2+ cuentas abiertas de la mesa en una |
| POST | `/cuentas/:id/lineas` | Operar | Agregar producto (merge por ítem) |
| PATCH | `/cuentas/:id/lineas/:lineaId` | Operar | Cambiar cantidad (canónica + opcional `cantidadPresentacion` / `unidadCodigoPresentacion`) |
| DELETE | `/cuentas/:id/lineas/:lineaId` | Operar | Quitar producto |
| POST | `/cuentas/:id/cancelar` | Operar | Anular cuenta (sin venta) |
| POST | `/cuentas/:id/cerrar` | Operar | Cerrar → genera venta (`FOR UPDATE` de cuenta) |
| POST | `/cuentas/:id/transferir` | Operar | Transferir responsable vigente por PIN (claim) |
| POST | `/cuentas/:id/transferir-admin` | Actualizar | Transferir responsable vigente (admin, sin PIN) |
| GET | `/cuentas/:id/asignaciones` | Leer | Historial auditable de asignaciones de la cuenta |

**Merge de líneas del mismo ítem** (misma personalización) — pasa en dos puertas, `POST
/cuentas/:id/lineas` y la fusión de cuentas, y las dos siguen la misma regla: la cantidad
**canónica se suma** y la de presentación se **reescribe en la unidad que esa línea ya
venía mostrando**, nunca se suma. Sumarlas daría un número sin unidad: la línea puede estar
en `g` y lo que entra venir en `kg`. Una línea en 200 g que recibe 0,3 kg queda en **500 g**,
no en 0,5 ni en 200. Una línea sin presentación no gana una por mergear.
Es la regla del diseño de presentación de carrito (2026-07-16), y la misma que el POS ya
aplicaba en el carrito local.

`POST /cuentas/:id/cerrar` body:
`{ pin, pagos?, tipoDocumentoId?, customer?, propinaMonto?, propinaSugerida?, propinaPorcentajeSugerido? }`
(reusa DTOs de ventas; `propina*` son `@IsNumberString` opcionales, y **los tres se
rechazan si vienen negativos** — `@IsNumberString` acepta el signo menos). Respuesta:
`{ cuenta: CuentaDetalle, ventaId }`.

**Propina en el cierre (subproyecto D):**
- La propina **no** entra en `total_final` ni en IVA; se persiste en `venta_propina`
  (siempre 1 fila por cierre de mesa, incluso tip `$0` → estado `sin_propina`).
- `garzon_id` de la propina = `garzon_responsable_id` vigente (400 si falta).
- Al cerrar se congela en `venta_propina`: `sesion_garzon_id`, `turno_id` y
  `tipo_garzon` de la **sesión abierta del responsable** (paridad: las tres columnas
  van juntas o son null en legado). `liquidacion_id` queda `NULL` hasta E3.
  Si el responsable ya no está en turno, el cierre falla con *"El garzón
  responsable de la cuenta ya no está en turno. Transferí la cuenta a alguien en
  turno para poder cobrarla."* — la salida es la transferencia, y el fin de turno
  la ofrece solo ([turnos-garzones.md](./turnos-garzones.md)).
- Cobro: Σ pagos == `total_final + propinaMonto`. El split tipado vive en
  `pago_aplicaciones` (`venta` | `propina`) con estrategia `NO_VUELTO` (tip primero
  a métodos sin vuelto).
- UI: `VentasCobroModal` con `modo-propina` sugiere 10% half-up a pesos enteros;
  editable; $0 permitido.
- Estado de la venta: solo Σ aplicaciones `tipo=venta` (la propina no afecta
  `pagada` / `pagada_parcial`).
- POS y ventas online **no** registran propina en esta fase.

`POST /cuentas/:id/transferir` body: `{ pin }` — el garzón destino reclama la cuenta
con su PIN (requiere sesión abierta). `POST /cuentas/:id/transferir-admin` body:
`{ garzonId }` — un usuario con permiso `Salones:Actualizar` fuerza la transferencia
(registra `actor_usuario_id` en el historial).

**Tres roles de garzón en la cuenta:**

| Campo | Rol | Comportamiento |
|---|---|---|
| `garzon_apertura_id` | Auditoría | Inmutable: quien abrió con PIN |
| `garzon_responsable_id` | Vigente | Cambia con transferencias; atribución de propina al cerrar |
| `garzon_cierre_id` | Auditoría | Solo al cerrar con PIN; puede diferir del responsable vigente |

**Identificación por garzón (PIN):** abrir (`POST /mesas/:id/cuentas`) y cerrar cuenta
requieren un `pin` de 6 dígitos. Al abrir se setean `garzon_apertura_id` y
`garzon_responsable_id` (ambos al mismo garzón) y se registra el primer tramo en
`cuenta_asignaciones`. Al cerrar solo se setea `garzon_cierre_id` (auditoría de quien
cobró); el responsable vigente queda congelado para atribución. Ver
[garzones.md](./garzones.md) y [turnos-garzones.md](./turnos-garzones.md).

`POST /mesas/:id/cuentas/fusionar` body: `{ cuentaIds: string[] }` (mínimo 2, deben
estar `abierta` y pertenecer a la mesa). Combina, por ejemplo, "1 y 3", "3 y 4" o
todas las de la mesa; ver detalle en Backend → Fusión de cuentas.

---

## Backend

- **Módulo**: `src/modules/salones/salones.module.ts` (importa `VentasModule`).
- **Controllers**: `salones.controller.ts` → `SalonesController` (`/salones`),
  `MesasController` (`/mesas`), `CuentasController` (`/cuentas`).
- **Services**: `salones.service.ts` → `SalonesService`;
  `cuenta-asignaciones.service.ts` → `CuentaAsignacionesService` (responsable vigente,
  transferencias e historial).

### Cierre de cuenta → venta (atómico)

`SalonesService.cerrarCuenta` abre una transacción con `FOR UPDATE` de la cuenta,
mapea las `cuenta_lineas` a
`LineaVentaDto[]`, arma un `CreateVentaDto` con `canal: 'fisico'` y llama a
**`VentasService.crearEnTransaccion(manager, tenantId, usuarioId, dto)`** dentro de la
misma transacción. Así la venta y el cambio de estado de la cuenta commitean juntos.
Requiere caja física abierta (lo valida `crearEnTransaccion`).

### Fusión de cuentas

`SalonesService.fusionarCuentas(tenantId, mesaId, { cuentaIds })` combina 2+ cuentas
`abierta` de la misma mesa (ej. "1 y 3", "3 y 4" o todas) en una transacción:

1. Valida que todas las `cuentaIds` existan, pertenezcan a la mesa/tenant y estén
   `abierta` (si falta alguna, `BadRequestException`).
2. La cuenta **destino** es la de menor `numero`; las demás son **origen**.
3. Mueve las `cuenta_lineas` de cada origen al destino, mergeando por `itemId`
   (misma lógica que `agregarLinea`: si el destino ya tiene el ítem, suma
   cantidades y hace soft-delete de la línea de origen; si no, reasigna la línea).
4. Cada cuenta origen queda `cancelada` (sin `ventaId`, absorbida por el destino).

Al quedar solo el destino abierta, la numeración por mesa sigue el mismo criterio
normal (se reinicia en 1 cuando esa cuenta también se cierre).

### Tablas

**`salones`**: `salon_id` PK, `tenant_id`, `nombre` + soft delete/timestamps.

**`mesas`**: `mesa_id` PK, `tenant_id`, `salon_id`, `nombre`, `pos_x`, `pos_y`
(`numeric`, fracción `0..1` del contenedor), `forma`
(`redonda|cuadrada|rectangular`, default `cuadrada`), `tamano`
(`pequeno|mediano|grande|extra_grande`, default `mediano`). El estado libre/ocupada es
**derivado** (cuentas abiertas), no se almacena.

**Solapamiento: se avisa en el frontend al soltar, y no se valida en el backend.**
Dos mesas pueden guardarse en la misma posición: no corrompe datos ni bloquea nada
—cada mesa sigue siendo direccionable por su id—, solo queda un plano confuso.

⚠️ **El servidor no puede evaluarlo.** La posición se persiste como fracción
`0..1` de un contenedor responsivo, pero el tamaño se dibuja en **píxeles fijos**
(`app/utils/mesa-dimensiones.ts`: 64/80/96/112, ×1,5 de ancho si es rectangular),
y el alto del plano lo redimensiona el usuario y se guarda en `localStorage`. Dos
mesas que no se pisan en 1920 px sí se pisan en 1024, así que el `PATCH :id/layout`
es justamente el único lugar donde **no** se puede resolver.

El chequeo vive en `SalonPlano.vue` (evento `solape`) y la pantalla muestra un
aviso: **avisa, no impide**, porque frenar el arrastre en un lienzo libre pelea
con el usuario por algo que no rompe nada. Dos mesas pegadas por el borde exacto
no cuentan como solape — es una distribución legítima y avisar ahí volvería el
aviso ruido.

**Limitación asumida:** el aviso depende del tamaño de pantalla de quien acomodó
el plano. La alternativa que la sacaría —guardar el tamaño también en fracciones—
se evaluó y se descartó por costo (toca esquema, render y editor).

**`cuentas`**: `cuenta_id` PK, `tenant_id`, `mesa_id`, `numero int` (correlativo por
**mesa**, calculado solo entre las cuentas actualmente `abierta` de esa mesa → se
reinicia en 1 cuando la mesa queda completamente libre, no es un correlativo
histórico), `estado` (`abierta|cerrada|cancelada`), `venta_id` (set al cerrar),
`garzon_apertura_id`, `garzon_responsable_id`, `garzon_cierre_id` (FK → `garzones`),
`abierta_el`, `cerrada_el`. Índice `idx_cuentas_responsable` sobre
`(tenant_id, garzon_responsable_id)`.

**`cuenta_asignaciones`**: timeline append-only del responsable vigente.
`cuenta_asignacion_id` PK, `tenant_id`, `cuenta_id`, `garzon_id` (responsable del
tramo), `desde_el`, `hasta_el` (`NULL` = tramo vigente), `motivo`
(`apertura|transferencia_pin|transferencia_admin`), `origen_garzon_id` (responsable
anterior; `NULL` en apertura), `actor_usuario_id` (solo en `transferencia_admin`),
más soft delete estándar (`creado_el` / `actualizado_el` / `eliminado_el`). En
práctica no se edita ni borra (append-only); las lecturas filtran
`eliminado_el IS NULL`. Índice parcial único: una sola fila con
`hasta_el IS NULL AND eliminado_el IS NULL` por cuenta. Al cerrar/cancelar/fusionar
(cuentas origen) se cierra el tramo vigente (`hasta_el = now()`); no se borran
filas.

**`cuenta_lineas`**: `cuenta_linea_id` PK, `tenant_id`, `cuenta_id`, `item_id`,
`cantidad numeric(18,4)`. El precio se resuelve al cerrar (igual que ventas).

### Responsable vigente y transferencias

`CuentaAsignacionesService` centraliza el ciclo de vida del responsable:

1. **Apertura:** `garzon_responsable_id = garzon_apertura_id` + fila `motivo='apertura'`.
2. **Transferencia (PIN o admin):** `FOR UPDATE` de la cuenta; cierra tramo vigente;
   inserta nuevo tramo; actualiza `garzon_responsable_id`. El destino debe tener
   sesión abierta. Rechaza si la cuenta no está `abierta` o si el destino ya es el
   responsable (`400`).
3. **Cerrar / cancelar / fusionar (origen):** cierra el tramo vigente sin cambiar
   `garzon_responsable_id` (queda congelado para atribución futura).

Backfill al arrancar: cuentas existentes sin responsable reciben
`garzon_responsable_id = garzon_apertura_id` y una fila `apertura` retroactiva.

### Concurrencia

- Apertura de cuenta: `FOR UPDATE` de la mesa antes de calcular `MAX(numero)+1`.
- Transferencia y cierre/cancelación: `FOR UPDATE` pesimista de la cuenta.
- **Agregar, editar y quitar líneas: `FOR UPDATE` de la cuenta, en la misma
  transacción que escribe.** No alcanza con leer el estado: un `SELECT` plano no
  espera al lock del cierre, así que veía la cuenta abierta durante todo
  `cerrarCuenta` —que arma la venta entera— y la línea se colaba en una cuenta que
  quedaba cerrada un instante después. Esa línea no se cobraba (la venta ya estaba
  armada sin ella) ni llegaba a cocina (`previewComanda`/`reclamarComanda` exigen
  `abierta`): quedaba invisible. El catálogo de unidades y la personalización se
  resuelven **fuera** del lock; lo que sí necesita leerse adentro va con el manager de
  la transacción, porque pedir una segunda conexión del pool sosteniendo el
  `FOR UPDATE` es un doble checkout que puede estancarse.
- Un solo tramo vigente por cuenta: índice parcial único en `cuenta_asignaciones`.

### Ítem eliminado con la cuenta abierta

Borrar del catálogo un ítem que está pedido en una cuenta abierta **está bloqueado**
(`GET /items/:id/uso` → clase `'cuenta'`, ver [recetas.md](./recetas.md)).

**La regla, en una línea: lo que una cuenta abierta ya pidió no se saca del catálogo**
—esté en `cuenta_lineas.item_id` o **adentro** de su `personalizacion`—. El motivo no es
integridad referencial: la precuenta y el cierre **re-tasan la línea contra el catálogo
vivo**, así que sacarle una pieza a algo ya pedido hace que esa línea no se pueda tasar y
la mesa quede **incobrable**, con un error que nadie ve hasta que el garzón intenta cobrar.
Cancelada o cerrada la cuenta, todo vuelve a ser borrable: el bloqueo es por **mesa viva**,
no un endurecimiento del catálogo.

Dónde está puesta hoy (2026-08-30) — **los cinco caminos que sacan algo del catálogo**:

| Camino | Estado |
|---|---|
| `DELETE /items/:id` del ítem de la línea | ✅ desde antes |
| `DELETE /items/:id` de un ingrediente pedido como **extra** | ✅ `dce84899` |
| `PATCH /items/:id` con `extrasPermitidos` | ✅ `d42a36e7` |
| `PATCH /grupos-modificadores/:id` sacando una opción | ✅ `bdc4d870` |
| `PATCH /items/:id` con `ingredientes` (un **omitido** que se va) | ✅ 2026-08-30 |
| `PATCH /items/:id` con `gruposModificadores` (grupo elegido que se desasocia) | ✅ 2026-08-30 |
| `DELETE /grupos-modificadores/:id` | ✅ de arrastre, **transitivo** (ver abajo) |

El arrastre del `DELETE` del grupo se apoya en tres guards, no en uno: ese borrado se
rechaza si el grupo está asociado a un ítem **vivo**, y para que siga asociado hacen falta
la desasociación bloqueada (fila de arriba) y que el ítem no se pueda borrar —rama
`'cuenta'` de `obtenerUsoItem` si es el ítem de la línea, rama `'combo'` si es un
componente—. Si alguno se afloja, el ✅ se cae.

Las cuatro ediciones comparan el **diff**: bloquean lo que *se saca*, no la lista que
cambia, así que reordenar, repreciar, cambiar min/max o agregar siguen pasando.

⚠️ **Cerrar los cinco no cierra la clase, y eso es lo que hay que saber antes de confiar en
esta tabla.** El cobro y la precuenta no solo re-precian: **re-validan** el snapshot contra
el catálogo de hoy, así que también rompen la mesa cosas que *no* sacan nada —asociar un
grupo con `min ≥ 1`, subir el `min` de uno ya asociado— y una que saca por otro campo:
quitar de un combo un componente que la línea personalizó. Las tres están medidas en
[`../agent/pendientes.md`](../agent/pendientes.md) § 3, junto con la decisión que las
cierra todas de una y que el owner ya tomó el 2026-08-30 —al cobrar manda lo que la mesa
pidió, con el precio de cuando lo pidió; re-tasar re-precia y deja de re-validar—, sin
construir todavía.

⚠️ **Dos cosas que no se ven desde acá.** La precuenta valida **menos** que el cierre
(`puedeCostar()` saltea el resolver cuando la línea solo tiene `omitidos`, así que ese caso
muestra precio normal y explota al cobrar); y no todo lo que rompe grita: un componente de
combo que se queda sin ningún grupo asociado hace desaparecer la opción elegida **del
precio**, sin error. Detalle y medición, en la misma entrada.

Para los
casos que ya existan, el detalle de la cuenta **muestra la línea marcada**
(`itemEliminado: true`) en vez de esconderla: el `JOIN` a `items` de `armarDetalle` no
filtra lo eliminado a propósito. Filtrarlo hacía desaparecer la línea de la pantalla
mientras `cerrarCuenta` —que lee las líneas crudas— la seguía contando, así que el
garzón veía una cuenta incompleta que no podía cobrar **ni corregir**, porque no tenía
el `lineaId` de algo que no se renderizaba. `cerrarCuenta` corta con un `400` que
nombra el ítem, en vez del `Item no encontrado` opaco que devolvía el motor de venta.

**La comanda tampoco lo filtra** (`sqlLineasComanda`, que alimenta `previewComanda` y
`reclamarComanda`). La regla es: **un plato ya pedido hay que cocinarlo**, lo haya
sacado o no el admin de la carta mientras tanto. Con el filtro puesto la línea
desaparecía del ticket de cocina sin ningún aviso —"Enviar a cocina" respondía OK y su
`cantidad_enviada` no avanzaba nunca—, que es el mismo bug de la pantalla movido de
lugar.

### El precio de la línea se congela al pedirla (2026-08-31)

**Decisión del owner (2026-08-30): lo pedido se cobra como se pidió.** *"¿Cuál carta? Si la
hamburguesa se pidió en 5 mil se paga en 5 mil."* `cuenta_lineas.precio_unitario` guarda,
al agregar la línea, `precioBase + Σ precioExtra` **ya convertido a la moneda oficial** del
tenant con su `modo_redondeo`. Repreciar el ítem con la mesa sentada ya no le mueve el
número a esa línea, y el detalle de la cuenta lo expone como `precioUnitario`.

**Y es lo que se cobra**: desde el 2026-08-31 `cerrarCuenta` ya no desarma la línea para que
el motor la re-resuelva — le pasa la foto entera (personalización, precio, tasa y reglas) por
un canal interno, y la venta se arma con eso: no se re-resuelve la personalización, no se
re-precia y no se re-leen los descuentos.

⚠️ **Lo que sí sigue saliendo del catálogo vivo** son los impuestos —fiscales, ADR-010— y
`precio_incluye_impuesto` del ítem, que decide cómo se interpreta el precio frente al
impuesto. Togglear ese flag con la mesa sentada mueve lo que paga aunque el precio congelado
no se mueva (medido).

Dos consecuencias que se ven en el local:

- **La mesa ya no puede quedar incobrable por un cambio de carta.** Los dos casos medidos
  —agregarle un grupo obligatorio al plato, sacarle a un combo el componente que la línea
  personalizó— antes devolvían `400` para la cuenta entera; ahora se cobran **y la precuenta
  también funciona**, que es lo que el garzón necesita: el cobro se abre desde la pantalla y
  la pantalla gatea en el cálculo. Cerrar solo el cierre habría dejado la mesa igual de
  trabada en el local.
- **La trazabilidad de la venta es coherente**: `venta_detalles` guarda el precio en la
  moneda del ítem, la tasa y el final, y los tres son los de cuando se pidió. Congelar solo
  el final los dejaba contradiciéndose (medido: se cobraba 9.500 y la venta declaraba
  "20 USD a tasa 950").

- **La precuenta se arma del lado del servidor.** `POST /calculo-precios/calcular` con
  `cuentaId` **ignora las líneas del body** y las relee de `cuenta_lineas`. Sin eso la
  pantalla previsualiza contra el catálogo vivo y el cierre cobra lo congelado: medido, 7.140
  contra 5.950 para la misma mesa, y el cajero cobrando el de la pantalla.

Plan completo:
[`../superpowers/plans/2026-08-30-lo-pedido-se-cobra-como-se-pidio.md`](../superpowers/plans/2026-08-30-lo-pedido-se-cobra-como-se-pidio.md).

**Los descuentos y recargos de catálogo también se congelan** (`reglas_congeladas`, jsonb):
la línea guarda cuáles regían sobre el ítem cuando se pidió, **resueltos y no por id** —
congelar el id dejaría pasar el cambio de un 20% a un 30%, que es justo lo que la decisión
evita—. **Los impuestos no**: son fiscales, se leen vivos al cobrar (ADR-010) y congelarlos
es otro frente.

📌 **Y esto cambió cuál es el instante que decide la vigencia por fecha.** Hasta el
2026-08-30 la de descuentos y recargos se resolvía contra `cuentas.abierta_el` —cuándo se
sentó la mesa— mientras la de las promos ya era por línea. Ahora las dos son lo mismo:
**cuándo se pidió**. Una cuenta abierta la semana pasada con una línea pedida hoy ya no
lleva la promo de la semana pasada. Detalle en
[`motor-promociones.md`](./motor-promociones.md).

**Dos líneas se juntan solo si comparten ítem, personalización, precio congelado Y reglas
congeladas.** Los tres últimos cubren tres formas distintas de que dos pedidos del mismo
plato sean dos hechos distintos:

| Cambia | Escena |
|---|---|
| la personalización | una con queso y otra sin |
| el precio | pedís, sube la carta, pedís otra |
| las reglas | pedís, sale un 20%, pedís otra — *"esa sí sale con el descuento"* (owner) |

El caso de las reglas es el que **no** se ve en el precio: el de lista no se movió, así que
sin ese término las dos se fusionaban y la segunda perdía su descuento.

⚠️ **El criterio vive en DOS lugares y tienen que moverse juntos**: `agregarLinea` y
`fusionarCuentas`. El segundo tenía su propia clave y quedó afuera cuando entró el precio —
medido: dos cuentas con el mismo ítem a `3000` y `4000` colapsaban en `2 × 3000`, perdiendo
$1.000. El que agregue un cuarto término, que lo agregue en los dos.

### Lo que la mesa pide queda apartado, y pedir de más rebota al pedir (2026-09-01)

**Decisión del owner (2026-09-01):** *lo que una mesa pide queda apartado desde que lo
pide*, y la segunda mesa que quiera lo mismo se entera **al pedir**, no al cobrar. La regla
de negocio completa —cuánto dura, qué aparta un plato, qué pasa con lo no bloqueante— vive
en [`PRODUCTO.md`](../PRODUCTO.md) § 8b. Acá va **dónde se hace cumplir**.

**La reserva no es un estado: es una consecuencia.** No hay tabla, columna ni entidad nueva.
Lo comprometido se **deduce** de las líneas vivas de las cuentas `abierta` del tenant
(`ItemsService.comprometidoPorItem`, una sola consulta y una sola llamada a
`consumoDeLineas`), así que **ningún camino que toca una línea necesitó código nuevo para que
el número quede bien** — los estados ya juegan a favor. Cada uno hace lo suyo solo:

| Camino | Qué le pasa a lo apartado |
|---|---|
| quitar la línea · bajarle la cantidad · cancelar la cuenta | **se libera** — vuelve a estar disponible |
| **cerrar la cuenta** | **NO se libera: se convierte en salida real.** La venta descuenta el stock, así que el disponible no se mueve (`stock` y `stockDisponible` quedan los dos en el mismo número) |
| fusionar dos cuentas | **neutro** — `fusionarCuentas` mueve o suma las líneas dentro de otra cuenta `abierta`, y la cantidad total se conserva |

Se descartó guardarla en una tabla o columna justamente por eso: sería otro saldo
materializado que puede derivar, y cada camino que toca una línea tendría que acordarse de
liberar. El porqué completo de los tres enfoques está en la
[spec](../superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md) § 3.

**Dos puertas crean compromiso, y las dos están topeadas** — `ItemsService.validarStockAlPedir`
es el único guard y lo llaman las dos:

| Camino | Qué valida |
|---|---|
| `POST /cuentas/:id/lineas` | lo que la línea nueva consumiría, contra `stock − comprometido` |
| `PATCH /cuentas/:id/lineas/:lineaId` | **solo si la cantidad sube**, y por la diferencia |

✅ **La segunda fila se alcanza desde `/salones` desde el 2026-09-02.** Hasta ese día no:
`patchLineaCantidad` clonaba el Proxy reactivo de un `ref` y tiraba `DataCloneError` **antes**
de mandar el `PATCH`, así que el request nunca salía de la pantalla y este guard —que está y
tiene sus e2e— solo se ejercía por API. El bug era anterior a este frente (`3c24b26b`,
2026-07-16) y se cerró junto con el rollback, que el mismo camino tenía roto y que solo se pudo
ver al encenderlo → [`../agent/resueltos.md`](../agent/resueltos.md). Su `400` ahora llega al
garzón como toast, y la cantidad vuelve a la que el servidor tiene.

El `400` **nombra el ingrediente que faltó** y con cuánto se quedó, no un "no hay stock"
genérico: en una receta de seis ingredientes eso manda al garzón a adivinar. Solo frena lo
**bloqueante**; lo no bloqueante suma al comprometido y sigue.

⚠️ **Lo bloqueante se cuenta POR OCURRENCIA, no por ítem** (corregido el 2026-09-02, revisión
final de rama). El mismo ingrediente puede entrar dos veces con distinto `bloqueante`: el caso
canónico es un **extra permitido que la receta ya lleva** —"extra queso" sobre una receta con
queso—, que nada impide configurar (`validarExtrasPermitidos` solo mira duplicados entre los
extras). Mientras el consumo llevó un solo flag por ítem, mergeado con AND, la porción del
extra apagaba el tope de la porción base: el pedido entraba con `201`, se despachaba y
reventaba **al cobrar** con *"Stock insuficiente para la salida"* — medido, con la línea ya
imposible de quitar por despachada. Era la mesa trabada de vuelta, por el camino que la tiene
que cerrar. Ahora `ConsumoDeItem` lleva **dos cantidades** (`cantidad`, que ocupa, y
`cantidadBloqueante`, que topea) y las dos cuentas —reservar y descontar— se hacen igual.

⚠️ **La comparación del `PATCH` es `consumo(nueva) − consumo(vieja)`, no `consumo(diferencia)`,
y no son lo mismo.** La conversión de unidades redondea a 4 decimales y **lanza** si lo
convertido cae bajo esa precisión: medido, una receta con 5 g de un insumo stockeado en kg
subida de 1 a 1,005 expandía el delta como `0,025 g → 0,0000 kg` y rebotaba con un 400 sobre
*"precisión de stock"* que no tiene nada que ver con lo que hizo el garzón. Expandiendo los
dos extremos da 0, que es la respuesta correcta.

**El orden de los tres pasos del guard es el contrato**, no un detalle de implementación:
expandir lo pedido → `SELECT … FOR UPDATE OF ip` sobre `item_producto` en un solo statement
y `ORDER BY item_id` → **recién ahí** leer el comprometido. Bajo READ COMMITTED, leerlo antes
haría que dos pedidos simultáneos del último vieran los dos *"queda 1"* y pasaran los dos,
que es exactamente el bug. Lo custodia un unitario (`items.service.spec.ts`); el e2e
concurrente prueba la propiedad de punta a punta pero **no** el mecanismo — ver la advertencia
de Testing más abajo.

📌 **Las dos puertas reintentan el `40P01`** (`agregarLinea` y `actualizarLinea`, con el mismo
bucle). Este guard mete un `FOR UPDATE` nuevo en el camino más frecuente del POS, que compite
con el mismo lock que toma la venta al descontar. Ordenar
por `item_id` baja la frecuencia del ciclo pero no lo cierra —el orden de la venta lo decide
el cliente, `docs/agent/anti-patterns.md`—, y sin el reintento el 500 caería del lado del
**cobro**, que es el modo de falla que este frente vino a eliminar. `esDeadlock` está
duplicado desde `ventas.service.ts` a propósito (segunda aparición; a la tercera se extrae),
con referencia cruzada en los dos docblocks.

**Lo que la pantalla muestra** es `stockDisponible` —lo que todavía se puede pedir— y cae a
`stock` cuando el backend no lo manda. `disponible` **no cambió de forma ni de significado**:
sigue siendo el entero *"cuántas porciones puedo armar"* de receta y combo, y por eso lo nuevo
viajó en un campo propio — son dos magnitudes distintas y meterlas en un solo campo era el
patrón de los dos nombres que compiten. ⚠️ **Pero su VALOR sí cambió, y hay que decirlo:** las
porciones se calculan sobre `stock − comprometido` de cada ingrediente o componente (el helper
`stockDisponible()` de `calcularDisponibilidadBatch`), así que **una receta también descuenta
lo que las mesas ya pidieron**. Lo que quedó igual es el nombre y el tipo, no el número. ⚠️ **El salón ya no descuenta
localmente lo que la cuenta pidió**: el servidor ya lo resta desde esta feature, y hacer las
dos cosas mostraba una receta con 4 porciones y 2 pedidas en **0** y gris. En POS y tienda el
descuento local se queda, porque ahí el carrito todavía no existe para el servidor.

**El drawer de personalización lee el mismo número desde el 2026-09-02.** Abre por
`GET /items/:id`, que hasta ese día devolvía el `stock` físico en sus filas anidadas: el
drawer ofrecía el ingrediente que otra mesa ya tenía apartado y lo rechazaba recién al
confirmar —el garzón armaba el plato entero para que se lo rebotaran al final—. Ahora ese
endpoint devuelve `stockDisponible` junto al `stock` en ingredientes, extras permitidos,
componentes y opciones de grupo, calculando el comprometido **una sola vez por respuesta**;
solo lo paga el ítem que tiene filas anidadas (receta o combo).

⚠️ **Lo que esto NO cierra**, y hay que saberlo antes de creer que la mesa trabada
desapareció: una merma, un recuento o un ajuste manual pueden dejar el stock por debajo de lo
ya comprometido y volver a trabar la mesa. **La salida con motivo sigue pendiente**
([`../agent/pendientes.md`](../agent/pendientes.md) § 3), y con ella este número compone solo: sacar la línea con
motivo baja el comprometido y baja el stock a la vez, neto cero.

### Lo ya despachado a cocina no se borra ni se reduce en silencio (2026-08-16)

**Decisión del owner (2026-08-08).** El plato ya se hizo, así que sacar la línea del
sistema lo **regala sin registro**: se sirvieron 2 y se cobra 1, y no queda rastro de que
había comanda despachada. Los dos caminos quedan bloqueados con un `400`:

| Camino | Regla |
|---|---|
| `DELETE /cuentas/:id/lineas/:lineaId` | rechaza si `cantidad_enviada > 0` |
| `PATCH /cuentas/:id/lineas/:lineaId` | rechaza si la cantidad nueva es **menor** que `cantidad_enviada` |

**Subir sigue libre, y bajar hasta lo despachado también** — ahí no se regala nada. El
operador es `<` y no `<=` a propósito, y hay un test que lo fija: con `<=` no se podría
dejar la línea en exactamente lo que salió, que es legítimo.

⚠️ `actualizarLinea` recibe un valor **absoluto**, no un delta, así que sin este guard
"2 → 1" sobre una línea con 2 despachados se veía igual que cualquier corrección de tipeo.
Y `quitarLinea` hasta el 2026-08-16 ni siquiera leía la fila: hacía `softDelete` por
criterio, así que borraba sin mirar nada.

**Lo que falta, y por qué esto no lo reemplaza:** para anular de verdad tiene que existir
un camino **con motivo** (merma o cortesía). Bloquear evita la pérdida silenciosa; no da
la salida legítima. Ese camino sigue en `docs/agent/pendientes.md` y ahí entra la
investigación de mercado.

**`cantidad_enviada` también sobrevive a la cuenta (2026-08-23).** La venta que sale del
cierre lo expone como `tieneLineasDespachadas` en `GET /ventas/:id`, y con eso el modal de
anulación **destilda** la reposición de stock: la comida que ya salió a cocina no vuelve al
inventario. Es el único lector de `cuentas.venta_id` —de ahí el índice `idx_cuentas_venta`—
y la regla completa vive en [`features/ventas.md`](ventas.md).

Para que la pantalla no ofrezca un tacho que termina en `400`, el detalle de la cuenta
ahora **expone `cantidadEnviada`** por línea. El backend ya lo emitía, pero solo dentro
del preview de comanda (`ComandaEstacion`), que es otro flujo: la línea que el garzón ve
no lo conocía.

En el frontend, una cuenta con una línea así **no se puede cotizar**: el motor de precios
resuelve los ítems contra el catálogo vivo y devuelve `404`. En vez de mostrar un total
de `$0` —que es peor que no mostrar nada—, el total aparece como `—`, un aviso explica
por qué, y "Cerrar y cobrar" e "Imprimir precuenta" quedan deshabilitados hasta que se
quite la línea. Las líneas **no** se filtran de la entrada del cálculo a propósito:
`AdvertenciasPrecio` indexa `resultado.lineas[i]` contra las líneas de la pantalla, así
que filtrar la entrada las desfasa.

---

## Frontend

### Pages

- `pages/salones/index.vue` — Operación del garzón: selector de salón → plano →
  drawer de la mesa (lista de cuentas / detalle de cuenta con catálogo, líneas, total
  en vivo, cancelar y cerrar+cobrar). Muestra responsable vigente; permite transferir
  por PIN (claim) o, con permiso `Actualizar`, forzar transferencia admin. Drawer de
  historial de asignaciones (`GET /cuentas/:id/asignaciones`). Con 2+ cuentas
  abiertas, "Fusionar cuentas" activa un modo de selección múltiple (checkbox por
  cuenta + botón "Todas") y fusiona las seleccionadas en la de menor número vía
  `POST /mesas/:id/cuentas/fusionar`.
- `pages/configuracion/salones.vue` — Administración (dentro de Configuración): CRUD
  de salones/mesas + editor de plano con drag & drop y "Guardar distribución".

#### Cambiar la cantidad de una línea: qué pasa si el garzón se va antes (2026-09-02)

La cantidad se pinta en el acto y el `PATCH` sale **300 ms después** (debounce: una ráfaga de
taps en el stepper es un solo request). De esa ventana se sale por siete puertas, y **las siete
manejan lo pendiente**. Todas guardan, y las tres **destructivas** —cancelar, fusionar, irse de la
pantalla— además **esperan**. Salir al listado y cerrar el drawer también sacan la cuenta de
escena y **no** esperan: volver al listado es instantáneo por decisión del owner (2026-09-02),
y ahí la cuenta sigue viva.

| El garzón… | Qué pasa con lo pendiente |
|---|---|
| toca *Enviar a cocina* | se manda y se **espera**, antes de imprimir la comanda |
| toca *Cerrar y cobrar* | se manda y se **espera**, pero recién al **confirmar el cobro** (después del modal y del PIN). El total que el modal muestra sale del pintado optimista, no de una respuesta del servidor |
| toca *Cuentas* o cambia de mesa | se manda **sin esperar**: volver al listado es instantáneo |
| **cierra el drawer** de la mesa (ESC, backdrop) | igual que *Cuentas*: se manda y la cuenta se suelta |
| **cancela la cuenta** | se manda y se **espera**, y recién entonces se cancela |
| **fusiona cuentas** | se manda y se **espera**, y recién entonces se fusiona |
| **navega fuera de `/salones`** | se manda y se **espera**: la navegación no ocurre hasta que termine |

✅ **Decisión del owner (2026-09-05): la acción destructiva espera.** Las tres últimas filas
salieron de ahí, pero **el síntoma no era el mismo en las tres**. En cancelar y fusionar el
`PATCH` aterrizaba **después** de que la cuenta dejara de estar abierta, así que el garzón leía
un toast rojo que nombraba una mesa y una cuenta que él acababa de hacer desaparecer; mandándolo
antes, la cuenta todavía está abierta y no hay rechazo que llegue tarde. Al **navegar fuera** la
cuenta sigue abierta y el `PATCH` se guarda bien: lo que estaba mal es que salía con la pantalla
ya desmontada, así que un rechazo por otra causa —el stock, por ejemplo— aparecía en otra
pantalla. Las dos primeras tienen su `:loading` en el botón: sin eso la espera se lee como que
la app se colgó.

⚠️ **Lo que cambió con cancelar, para que nadie lo lea como una regresión:** hasta el
2026-09-05 cancelar **descartaba** la edición, y ese descarte era una decisión del 2026-09-02
—con su test— que dejaba una ventana abierta: si el timer disparaba mientras viajaba el request
de cancelar, el `PATCH` ya había salido y no quedaba nada que tirar. Ahora se manda antes. El
costo, dicho: se guarda una cantidad en una cuenta que se va a anular igual — un request de
más, no plata. El descarte **sigue existiendo** para la edición que nazca *durante* el request
de cancelar, pero **acotado a esa cuenta**: vaciarlo entero se llevaba puesta la edición de
otra cuenta que el garzón hubiera abierto en el ínterin —se perdía en silencio, con la cantidad
pintada—, y lo mismo con volver al listado, que ahora solo pasa si sigue parado en la cuenta que
canceló.

⚠️ **La de navegar cubre la navegación dentro de la app, no cerrar la pestaña ni recargar**: es
un guard de ruta (`onBeforeRouteLeave`) y ahí no corre. Mismo límite que ya tenían las demás. Y
es la única que espera **sin indicador**: no hay botón donde ponerlo, y el tramo es el de un
request.

📌 **Corolario del que espera, y tiene DOS mitades que no se pueden confundir.** Todo lo que
la acción lee después de un `await` hay que decidirlo a mano, una sentencia por vez:

- **Lo que la acción USA se congela antes.** Fusionar manda las cuentas que estaban
  seleccionadas *al tocar el botón*, no las que queden seleccionadas cuando el request sale
  —durante la espera las tarjetas siguen clickeables y releerlas dejaba salir la fusión con una
  sola cuenta, que el backend rechaza—. Cancelar congela el id de su cuenta y el de la mesa: sin
  eso el `try` moría con un `TypeError` y **el cancelar no salía**. *Enviar a cocina* congela la
  cuenta entera y el nombre de la mesa (2026-09-05, la cuarta puerta de esta forma):
  su `await` es el mismo flush, y ahí el botón *Cuentas* sigue vivo. Con `null` el `catch`
  mostraba *"Error al enviar la comanda (¿QZ Tray está abierto?): Cannot read properties of null
  (reading 'id')"* —**le echaba la culpa a la impresora y la comanda no llegaba a cocina**, el
  peor de los cuatro, porque el garzón se va tranquilo—; parado en **otra** cuenta no había
  `TypeError` y el claim salía con el id de esa otra, que le avanza la `cantidad_enviada` sin
  que nadie haya pedido su comida. Por eso se congela la cuenta entera y no solo el id: el
  `numero` y el garzón se imprimen en el ticket. *Cerrar y cobrar* hace lo mismo
  (2026-09-05, la quinta): la cuenta y la mesa se
  congelan en `confirmarCobro`, **antes del PIN y antes del flush**, y viajan como argumentos
  a `cerrarCuentaConPin` en vez de leerse adentro. Ahí el agujero era el más caro de los
  cinco: releída después del flush, la cuenta podía ser `null` —y entonces el guard cortaba
  en seco, **sin venta y sin aviso, con el PIN ya tecleado**— o ser **otra**, y entonces se
  cobraba la que no era. La mesa importa por lo mismo y por una razón propia: es la que
  pierde una cuenta abierta, así que su contador va con la mesa congelada, y leerlo vivo
  dejaba **dos** mesas mal pintadas —una ocupada de más, la otra de menos— hasta que alguien
  recargara, porque `cargarSalones()` solo corre en el `onMounted`.
- **Lo que la acción PINTA se condiciona a dónde está parado el garzón, y la pregunta no es la
  misma en las dos.** Cancelar pregunta *"¿sigue en la cuenta que murió? entonces sacalo"*.
  Fusionar pregunta *"¿está en el listado, o en una de las que la fusión canceló? entonces
  llevalo a la fusionada"* — parado en **otra** cuenta viva no se lo toca, que sería una
  expulsión; parado en una muerta, dejarlo es peor: el listado ya no la tiene y todo lo que haga
  vuelve *"La cuenta no está abierta"*.
- **Y lo que la acción CIERRA: el cobro en curso sobre una cuenta que entró en la fusión**
  (decisión del owner, 2026-09-05). El modal se cierra solo, con aviso, y **los pagos que el
  garzón ya cargó se pierden** — se vuelven a tipear. Es el mismo trato que la cantidad a medio
  guardar del punto de abajo, y **por los dos mismos motivos según el lado**: si era una cuenta
  de **origen**, el *Confirmar* rebotaría con *"La cuenta no está abierta"* con el PIN ya
  tecleado; si era la **destino** —que sigue abierta— el total congelado del modal es el de
  antes de absorber las otras líneas, así que cobraría de menos. Se cae **solo si la cuenta de
  ese cobro entró en la fusión**: una fusión de otras cuentas no le toca el cobro a nadie. Y
  alcanza también al cobro que el garzón pidió y **todavía se está calculando**, que si no moría
  en silencio — o peor, en la mitad destino: como conserva su id, el guard de identidad de
  `abrirCobro` no cortaba y el modal abría con el total de antes de absorber las otras líneas. Lo
  que lo cierra ahí es que la fusión **anula la marca de ese cobro pedido** — no un id que cambie.

  ⚠️ **El aviso lo da la fusión, que sabe lo que pasó**, y no el guard de `abrirCobro`: las dos
  veces que se intentó deducirlo salió mal —*"la cuenta ya no está en el listado"* le decía
  *"se fusionó"* al garzón que acababa de **cancelarla él mismo**, y *"`cobroCuenta` apunta a
  algo"* avisaba de un cobro que el garzón ya había cerrado, porque ese ref no lo limpiaba nadie
  (ahora lo tira un `watch` cuando el modal cierra).

  📌 **Y desde el 2026-09-06 alcanza también al cobro que el garzón YA confirmó con su PIN y
  está en vuelo**, que es el tercer tramo del mismo reloj: entre el *Confirmar* y el `POST`
  hay dos esperas —el flush de lo pendiente y el cálculo— y basta con una edición de cantidad a
  medio guardar para que la primera sea de red. Ahí **no alcanza con avisar**, y eso está
  medido: en la cuenta de origen el cierre rebota y el garzón al menos lee un rechazo, pero en
  la **destino** no rebota nada —conserva su id y sigue abierta—, así que el cierre entra bien
  y la venta se arma con todas las líneas que la fusión le plegó contra los pagos del total de
  antes. Nadie valida que los pagos cubran el total (`pagada_parcial` es legítimo): **cobra de
  menos, en silencio y con toast verde**. Por eso ese cierre se **cancela antes de salir**. La
  marca que lo permite es `cobroEnVueloId`, que existe porque en ese tramo la cuenta vive solo en
  el argumento de `cerrarCuentaConPin` y nadie de afuera podía leerla.

  ⚠️ **Y acá el aviso NO lo da la fusión**, al revés que en el ⚠️ de arriba: en este tramo el
  cierre viaja en paralelo con ella, así que lo da el guard de `cerrarCuentaConPin`, el único
  punto donde se sabe que el `POST` no llegó a salir. Avisando desde la fusión, una respuesta que
  vuelve con el cierre ya despachado diría *"el cobro no salió"* con el cobro saliendo.

  ⚠️ **La ventana que queda:** una fusión que aterrice entre un cierre fallado y su reintento
  —el que ofrece el error de sesión de trabajo— no ve ningún cobro en vuelo que anular, así que
  ese reintento sale igual. **Y ese tramo no lo acota el modal de turno**: `abrirEntrarTurno`
  no abre nada si no hay turnos activos o si la carga falla, y la acción pendiente queda armada
  igual, con la pantalla entera usable — el garzón puede fusionar y entrar a turno después.
  ⚠️ **Y esa ventana tiene una segunda mitad que es conducta nueva:** si el garzón confirma un
  **segundo** cobro sobre otra cuenta mientras ese reintento está pendiente, el reintento pisa la
  marca con la cuenta vieja y el guard cancela **ese segundo cierre**, con un aviso que ahí es
  falso. Antes de este frente ese `POST` salía. Las dos mitades, con lo que falta medir para
  cerrarlas, en [`../agent/pendientes.md`](../agent/pendientes.md) § 2.
- **Lo que la acción DESCARTA mira de qué cuenta es cada edición**, no vacía todo: cancelar tira
  lo de su cuenta, fusionar lo de **todas** las que entraron a la fusión —incluida la destino, y
  también las líneas de la destino que la fusión no tocó: se descarta por cuenta, no por línea,
  y la pantalla vuelve a mostrar lo que el servidor tiene, así que la pérdida se ve—. Eso **pierde** la
  cantidad que el garzón haya tipeado ahí durante el vuelo, y es deliberado, por dos motivos
  distintos según el lado: en las de **origen** el `PATCH` saldría con una cuenta ya anulada y
  volvería *"La cuenta no está abierta"*; en la de **destino** —que sigue abierta— no rebota por la
  cuenta, y ahí `PATCH /lineas` escribe la cantidad **absoluta** sobre la suma que la fusión
  acaba de hacer. El garzón tipea mirando **lo de antes de fusionar**, así que ese número ya no
  significa lo que quiso decir, salga como salga: puede rebotar por abajo (el guard de cocina,
  que compara contra la `cantidad_enviada` ya sumada),
  rebotar por arriba (el tope de stock) o entrar y pisar en silencio lo que la fusión sumó.
  Medido: destino 2 con 2 despachadas + origen 3 con 0 = 5 con 2 despachadas, y tipear 3 pasa
  comiéndose 2 unidades.

📌 **Y una tercera cosa que decidir, que apareció en la quinta puerta: lo que la acción
CALCULA.** `asegurarVigente()` no devuelve el cálculo de una cuenta, devuelve el del carrito
**vivo**. De ahí salen los totales de la boleta y la proyección local de la caja, así que
llamarlo después del flush con el garzón ya metido en otra cuenta armaba la boleta con las
líneas de la cobrada y los totales de la otra. Va **condicionado a seguir parado en la cuenta
que se cobra**.

⚠️ **Y de ahí sale un corolario del corolario: lo que se congela y lo que se calcula tienen
que ser del MISMO instante.** Las líneas del ticket y su cálculo se cruzan **por índice**, y
el flush que corre antes **reemplaza el objeto de la cuenta**, así que armar el ticket con la
foto de antes del flush y el cálculo de después imprime una cantidad y cobra otra —basta con
que un `PATCH` rebote por stock y haga rollback—. Por eso la cuenta del **ticket** se relee
junto al cálculo, aunque el id que se cierra siga saliendo de la foto: son dos cosas distintas
que se llamaban igual. Lo levantó la revisión sobre el primer intento de este arreglo.

⚠️ **Sin cálculo, esa venta se queda sin boleta y no hay dónde reimprimirla** (ningún camino
reimprime una venta pasada: el ticket siempre se arma contra estado vivo). Se acepta porque el
otro platillo es peor —hoy el mismo gesto deja la venta **sin generar**— y porque es el camino
que el cálculo fallado ya tenía, con su aviso. La salida buena —recalcular la cuenta cobrada—
pide llamar al motor por fuera de la maquinaria de vigencia de `useResultadoCalculado`: frente
propio, anotado con el residuo que arrastra (sin cálculo, la proyección local de caja se infla
por el vuelto).

📌 **La familia tiene una segunda mitad, con la forma dada vuelta: lo que la acción
ESCRIBE** (2026-09-05, tres de ellas; **quedan miembros vivos**, ver
[`../agent/pendientes.md`](../agent/pendientes.md) § 2 y el barrido de
[`../agent/resueltos.md`](../agent/resueltos.md)). No es releer estado reactivo después del
`await`, es escribirlo encima:

- `syncCuenta` —la respuesta de agregar un producto, confirmar una receta o quitar una
  línea— hacía `activeCuenta.value = cuenta` sin preguntar, así que tocar *Cuentas* con el
  request en vuelo devolvía al garzón, solo, a la cuenta que acababa de soltar. Ahora delega
  en `aplicarCuentaActualizada`, el gemelo condicionado que ya existía cinco líneas más
  abajo: **la cuenta cambió, así que la respuesta entra a la lista igual; abrir el detalle
  es pintar y se condiciona**.
- `abrirCuentaConPin` congelaba bien el `mesaId` para la ocupación, pero hacía
  `cuentas.value.push()` y abría el detalle sin condicionar: cambiar de mesa durante el POST
  metía la cuenta de la mesa A en el listado de la mesa B.
- `cargarCuentas` asignaba la respuesta sin más, así que dos taps seguidos en el plano
  dejaban ganar **al que llegara último**. Va con **token de request**, como `refrescarItems`
  en este mismo archivo y `useResultadoCalculado`; un `if (mesaId === selectedMesa.value?.id)`
  no alcanza, porque
  pasar por la mesa B y volver a la A deja entrar la respuesta vieja de A.

📌 **Y una tercera cara, que ningún barrido de `ref`s podía ver: el MODAL que se abre después
del `await`** (2026-09-05). `abrirTransferenciaAdmin` validaba la cuenta, esperaba la lista de
garzones y abría el modal sin volver a preguntar, mientras `confirmarTransferenciaAdmin` relee
`activeCuenta` viva: tocar *Transferir* en la cuenta 9 e irse a la 10 mientras cargan los
garzones dejaba el modal —titulado igual, sin decir de qué cuenta habla— sobre la 10, y
confirmarlo **le cambiaba el responsable a la 10**. Va con guard de identidad **antes de abrir**, y además el modal **se lleva su cuenta adentro**
—la cuenta y la lista de garzones—. Esto último no estaba en el primer intento, que se apoyaba
en que *"nada puede cambiar la cuenta activa con el modal abierto"*: la revisión refutó esa
enumeración **dos veces**, midiendo. Primero faltaba `abrirCuentaConPin`, cuyo guard era por
mesa y no por cuenta (cerrado también del otro lado: a la cuenta nueva se entra solo si el
garzón sigue en el listado); después faltaba `fusionarSeleccionadas`, cuya continuación cambia
la cuenta activa cuando el garzón quedó parado en una de las fusionadas. **La salida no fue
enumerar mejor, fue dejar de depender de la enumeración.**

`abrirCobro` era la misma forma con plata adentro, y se cerró con el mismo gesto un día después
(2026-09-05): el modal se lleva su cuenta, su mesa y **su total**, y no se abre si el garzón ya
no está donde tocó *Cerrar y cobrar*. Los dos caminos que cobraban otra cuenta estaban medidos:
meterse en otra durante el cálculo —`asegurarVigente()` calcula el carrito **vivo**, así que le
devolvía a la 9 el total de la 10—, y la fusión que aterriza con el modal abierto, donde
congelar en el *Confirmar* congelaba la fusionada. `abrirHistorial`, `cargarPendientesTestigo`
y `abrirEntrarTurno` tienen la forma y **no** el bug, y ahí está escrito por qué.

`imprimirPrecuenta`, que sí lo tenía, se cerró el **2026-09-06**: su re-chequeo
preguntaba por **existencia** y no por identidad, así que cubría volver al listado y cambiar de mesa
pero no meterse en otra cuenta, donde salía la precuenta de esa otra; y cuando el cálculo de la
cuenta nueva no llegaba, el garzón leía un rojo que le echaba la culpa al cálculo de algo que no
falló — se había movido él—. Mismo orden que `abrirCobro`: guard por identidad, y el aviso detrás.

⚠️ **En un modal que cobra, el total también va en la foto.** Lo que muestra, el pago que
precarga y la propina que sugiere salen del mismo número: congelar la cuenta y dejar vivo el
monto es la misma ventana que no congelar nada — la lección de la lista de garzones de la
transferencia, otra vez y con plata. Y se toma **lo que devuelve `asegurarVigente()`**, no
releyendo el ref, que es la regla escrita del composable.

⚠️ **El guard va antes del aviso de error, no después.** El aviso de *"no se pudo calcular el
total de la cuenta"* nombra una cuenta que el garzón ya dejó, en una pantalla donde puede no
haber ninguna abierta. Es el mismo criterio del resto del archivo: lo que se pinta se condiciona
a seguir parado donde se pidió.

📌 **Y una fusión que aterriza tarde tiene TRES momentos**, que aparecieron en ese orden y cada
uno midiendo el anterior: con el **modal ya abierto** y con el cobro **todavía calculándose** —los
dos contestados por el owner el 2026-09-05—, y con el cobro **ya confirmado con PIN y en vuelo**,
cerrado el 2026-09-06. Los tres se deciden en el mismo lugar —ver el bullet *"lo que la acción
CIERRA"* más arriba—, y ese lugar es `fusionarSeleccionadas` y no el guard de `abrirCobro`: el guard
corta **mudo**, porque desde ahí *"por qué desapareció la cuenta"* hay que deducirlo, y la deducción
salió mal. El aviso es **del cobro, no de dónde está parado el garzón**: irse solo a otra cuenta no dispara
nada, pero si además la fusión se llevó la cuenta que él había mandado a cobrar, el aviso sale
igual —medido—.

⚠️ **El tercero se decide ahí pero NO avisa desde ahí**, y es la excepción que conviene tener
presente: en ese tramo el cierre ya viaja en paralelo con la fusión, así que el aviso lo da el
guard de `cerrarCuentaConPin`, que es el único punto donde se sabe que el `POST` **no llegó a
salir**. Avisando desde la fusión, una respuesta que vuelve con el cierre ya despachado le diría
*"el cobro no salió"* a alguien cuyo cobro salió.

⚠️ **Congelar de más también rompe:** esos tres —el Map de pendientes, el guard de "sigue en
la cuenta", el de "sigue en la mesa"— se leen **vivos a propósito**. La regla no es "congelar
todo", es "decidir cada lectura". Y decidirla **midiendo**: el primer intento de la quinta
puerta dejó vivas las refs de propina argumentando que el modal ya las había fijado, y la
revisión lo refutó tapeando *Cerrar y cobrar* durante la espera —ese botón todavía no
esperaba al cierre; el 2026-09-06 pasó a hacerlo, ver el 📌 de unas líneas más abajo— : el modal se reabre, su `watch(open)` reescribe `propinaMonto`, y el cobro
salía con una propina que el garzón nunca confirmó. Van en la foto. `propinaPorcentaje` y
`propinaHabilitada` no, que solo se escriben al montar.

📌 **El cobro confirmado bloquea el botón hasta que termina** (2026-09-06). `submitting` se prende
**también** en el *Confirmar*, y no solo adentro de `cerrarCuentaConPin`, que corre después del PIN
y del flush: en ese tramo el botón seguía habilitado y un tap alcanzaba para **confirmar el mismo cobro dos veces**
—en tablet personal, sin siquiera un teclado de PIN de por medio—. El segundo `POST` rebota contra
una cuenta ya cerrada y el garzón lee un error por algo que le salió bien. ⚠️ La trampa de prenderlo
antes del teclado: **cerrar el teclado sin tipear no pasa por `cerrarCuentaConPin`**, así que sin un
`onCancelar` que lo apague el drawer queda trabado y esa cuenta no se puede cobrar nunca más.

**Decisión del owner (2026-09-02):** salir guarda. Hasta ese día salir descartaba **en
silencio** —ni request ni aviso— y al volver a entrar el input mostraba la cantidad que nunca
se guardó.

⚠️ **Por eso el aviso de rechazo lleva la mesa y la cuenta adentro.** El tope de stock puede
rebotar el `PATCH` con la pantalla ya en otra cuenta, y ahí un *"no alcanza el stock"* sin
dueño no le dice al garzón a qué mesa volver. El contexto se **congela al empezar la edición**,
no se lee al fallar; con la cuenta todavía en pantalla se omite.

📌 **Corolario para quien toque esto.** Las funciones que pintan y deshacen la cantidad eligen
**sobre qué cuenta actuar por `cuentaId`**, nunca por `activeCuenta`: la respuesta puede llegar
cuando ya no hay ninguna activa, y ahí la versión vieja se iba en su primera línea y el
rollback no ocurría. `activeCuenta` se sigue consultando, pero solo para decidir **si además
hay que repintar lo que está en pantalla** (recalcular el total, omitir el contexto del toast)
— nunca para saber a qué cuenta pertenece el cambio.

### Components

- `components/salones/SalonPlano.vue` — Lienzo que posiciona las mesas por
  `pos_x/pos_y`. `editable` → drag con **pointer events nativos** (`@move`), guarda la
  distribución automáticamente al soltar la mesa (`@dragend`, solo si hubo movimiento
  real), abre la edición con doble click (`@edit`) y permite redimensionar el alto del
  plano arrastrando la esquina (`resize-y`, como un `<textarea>`, 220px–70vh); el alto
  elegido se persiste en `localStorage` (`salones-plano-alto`, preferencia de
  navegador, no por tenant/salón) vía `ResizeObserver`; operación → `@select(mesa)`.
- `components/salones/MesaNode.vue` — Caja de una mesa (nombre, ocupación). El
  `tamano` mapea a un ancho/alto en px (64/80/96/112) y `forma` a la clase visual
  (`redonda` → círculo, `rectangular` → 1.5× más ancha).

### Composable

- `composables/useSalones.ts` — wrappers `useApiFetch` de todos los endpoints +
  `cuentaToCalcularInput` (mapea la cuenta al motor de precios para el total en vivo,
  vía `useCalculoPrecios`).

### Reuso del POS

El detalle de cuenta reusa `VentasCatalogoGrid` (agregar productos), `useCalculoPrecios`
(total en vivo) y `VentasCobroModal` (cobro al cerrar). La operación del garzón se
navega desde `layouts/dashboard.vue` (`/salones`, gateada por `can('Salones','Operar')`);
la administración vive dentro de Configuración (`pages/configuracion.vue` →
`/configuracion/salones`, gateada por `can('Salones','Crear')`).

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/salones/salones.service.spec.ts \
  modules/salones/cuenta-asignaciones.service.spec.ts
```

Cubre: número de cuenta correlativo, agregar/merge/quitar líneas, cierre que invoca
`crearEnTransaccion` y marca la cuenta `cerrada` con `ventaId`, cancelar sin venta,
transferencias PIN/admin, cierre de tramos al cancelar/cerrar/fusionar, responsable
vigente en `CuentaDetalle`, aislamiento por tenant.

### El stock apartado (`backend/test/reserva-stock-mesa.e2e-spec.ts`)

Reproduce la sonda que abrió el frente —dos mesas del mismo salón sobre un producto con
`stock = 1`— y cubre la receta, el `PATCH` que sube y el que baja, el no bloqueante en
negativo, las **dos** formas de liberar (quitar la línea y cancelar la cuenta), el
**contra-caso** de cerrar —el test se llama *"cerrar la cuenta NO suelta nada"*, y es el que
distingue *"se soltó"* de *"se consumió"*— y la carrera de dos `POST` simultáneos.

El bloque *"Revisión final"* agrega el extra del **mismo** ingrediente que la receta ya lleva,
en dos mitades que no se pisan: la primera **revierte** el bug del flag mergeado (`400` donde
antes había `201`), la segunda es el control que descarta el arreglo fácil de invertir el
merge —la porción del extra sigue sin frenar, solo ocupa, que es la decisión 4 del owner—.

⚠️ **El e2e concurrente prueba la propiedad, NO el mecanismo, y está medido.** Afirma que
nunca salen dos `201`, pero **no mata al mutante que invierte el orden** (leer el
comprometido antes del `FOR UPDATE`) **ni al que saca el `FOR UPDATE` entero**: 10 corridas
en verde con el lock quitado. Sin espera inyectada, la ventana entre leer y commitear es más
chica que el desfase con que llegan las dos requests. **La red real del orden y de la
presencia del lock es el unitario** *"toma el lock de stock ANTES de leer el comprometido"*
en `items.service.spec.ts`, que sí muere con los dos mutantes. Se prefirió documentarlo antes
que ensanchar la ventana con ganchos de test en el camino caliente del POS.

### Manual (Frontend)

1. `docker-compose up`. El seeder crea el módulo Salones y salones/mesas demo para el
   tenant Paris.
2. Con caja física abierta: en `/salones` elegir salón → mesa → nueva cuenta → agregar
   productos → "Cerrar y cobrar" → verificar la venta en `/ventas`.
3. **Tomar cuenta por PIN:** con sesión abierta de otro garzón, en el detalle de una
   cuenta abierta usar "Tomar cuenta" / transferir por PIN → la UI muestra el nuevo
   responsable vigente; `garzon_apertura_id` no cambia.
4. **Transferir admin:** con permiso `Salones:Actualizar`, forzar transferencia a un
   garzón con sesión abierta (sin PIN) → responsable vigente actualizado y
   `actor_usuario_id` en el historial.
5. **Historial:** abrir el drawer de asignaciones de la cuenta y verificar timeline
   (`apertura` + `transferencia_pin` / `transferencia_admin`) con fechas y nombres.
6. En `/configuracion/salones` crear salón/mesa, arrastrar mesas y "Guardar distribución".

---

## Decisiones

- Un módulo RBAC `Salones` con permiso extra `Operar` (patrón de `Reembolsar` /
  `Nota de crédito`) para separar administrar estructura vs. operar cuentas.
- Cierre reusa `VentasService.crearEnTransaccion` (atomicidad; evita el doble commit
  de `crear()`).
- Estado de mesa derivado, no almacenado.
- Drag & drop con pointer events nativos, sin nueva dependencia.
- `pos_x/pos_y` como fracción `0..1` para plano responsivo.

## Related Features

- [ventas.md](./ventas.md) — motor de ventas y POS reusado en el cierre.
- [gestion-cajas.md](./gestion-cajas.md) — caja física requerida para cobrar.
- [roles-permisos.md](./roles-permisos.md) — módulo RBAC `Salones` y permiso `Operar`.
- [garzones.md](./garzones.md) — identificación por PIN.
- [turnos-garzones.md](./turnos-garzones.md) — sesión obligatoria para operar cuentas.
- [inventario-kardex.md](./inventario-kardex.md) — por qué lo apartado al pedir **no**
  aparece en el kardex, y quién sí escribe movimientos.
