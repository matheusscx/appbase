# Feature: Salones y Mesas (Restaurante)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-30 (lo que una cuenta abierta ya pidió no se saca del catálogo)

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
[`../agent/pendientes.md`](../agent/pendientes.md) § 4, junto con la decisión de fondo que
las cerraría todas de una: si re-tasar una línea ya pedida debe re-validar.

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
