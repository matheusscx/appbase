# Plan: Lo que está en pausa no se aplica ni se ofrece

**Status:** Implementado 2026-08-03. Los dos E2E que habían quedado abiertos se cerraron el
2026-08-09 — ver sus checkboxes más abajo y `docs/agent/resueltos.md`
**Date:** 2026-08-03
**Owner:** Cesar Matheus
**Relacionado:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § Media —
"Un descuento, recargo o impuesto desactivado sigue aplicándose"

⛔ **Toca el motor de cálculo de precios.**

---

## La regla (owner, 2026-08-03)

> Cualquier cosa que se habilite y deshabilite: si está deshabilitada, **se ignora** y **no
> sale en los selectores** que la aplican.

Y **desactivar no es eliminar**:

| | Qué significa | Qué hace hoy |
|---|---|---|
| **Eliminar** | La entidad se va. Reversible solo por la papelera. | ✅ Funciona: `eliminado_el` vía `@DeleteDateColumn`, TypeORM la excluye de toda lectura, se restaura desde la papelera. |
| **Desactivar** | **Pausar.** Sigue existiendo, con sus asociaciones intactas, y reactivarla la devuelve exactamente como estaba. | ⚠️ Depende de la entidad — ver el cuadro de abajo. |

Pausar **nunca** toca las tablas puente. Borrar N filas de `item_descuentos` y no poder
devolverlas es eliminar las asociaciones con otro nombre. (Esa forma estaba anotada en el
backlog el 2026-07-30 y queda **sustituida** por este plan.)

---

## Alcance real del interruptor — medido el 2026-08-03

Trece tablas del esquema tienen columna `activo`. No están todas en el mismo estado:

**Ya cumplen la regla** (el backend la respeta y el selector la esconde): `causas_merma`,
`motivo_diferencia_caja`, `motivo_diferencia_inventario`, `tipos_documento_tributario`,
`tipos_regla`, `cajones`. Sirven de patrón: en varias el filtro vive en el endpoint de
catálogo, no en un `.filter()` del `.vue`.

**El selector esconde, el backend igual la usa:** `descuentos`, `recargos`, `impuestos`
(solo los personalizados del tenant — el IVA no entra, ver su sección), `categorias`,
`terceros`.

**Nadie la respeta:** `items`, `metodos_pago`.

Pero la regla no significa lo mismo para todas, y conviene no aplanarlas:

- **Las que se APLICAN a un cálculo** (`descuentos`, `recargos`, `impuestos`): pausada = no
  entra en el total. Es el caso que dispara este plan.
- **Las que se REFERENCIAN** (`categorias`, `terceros`, `items`): pausada = no se puede
  elegir de nuevo, pero lo ya asignado no se rompe. Un ítem no pierde su categoría porque la
  categoría se haya pausado. Acá "ignorar" se traduce en **rechazar la asignación nueva**, no
  en borrar el vínculo existente.

---

## Los tres agujeros

### 1. Reglas de precio: el motor no mira `activo`

En todo el backend `activo` **solo se escribe, nunca se lee** para descuentos, recargos e
impuestos (`descuentos.service.ts:157`, `recargos.service.ts:157`, `impuestos.service.ts:118`,
las tres poniéndolo en `true` al crear).

- [`calculo-precios.service.ts:52-57`](../../../backend/src/modules/calculo-precios/calculo-precios.service.ts)
  carga los catálogos con `findAll(tenantId)`, que no filtra `activo` — y **está bien que no
  lo haga**: `findAll` también alimenta la pantalla de administración, que tiene que seguir
  viendo las reglas pausadas para poder reactivarlas.
- [`indexarReglas`](../../../backend/src/modules/calculo-precios/calculo-precios.service.ts)
  arma el mapa y **ni siquiera copia el campo `activo`**. Ahí está el agujero.

### 2. Un ítem inactivo se vende igual (más grave, y no estaba en el radar)

Verificado línea por línea el 2026-08-03:

- `salones.service.ts:1348` (`getItemVendibleOrThrow`) **sí** exige `AND i.activo = true` al
  agregar o editar una línea de una cuenta de mesa.
- [`cargarBasePorIds`](../../../backend/src/modules/items/items.service.ts), el camino que
  usan `ventas.service.ts` (POS) y `online.service.ts` (tienda), filtra **solo**
  `eliminado_el IS NULL`.
- Ninguno de los tres catálogos del front (`pos.vue:126`, `tienda/index.vue:25`,
  `salones/index.vue:302`) filtra por `activo`.

O sea: un ítem descontinuado se ofrece en el POS y en la tienda online y la API lo acepta,
pero la misma operación en una cuenta de salón la rechaza. La inconsistencia es el bug.

### 3. `metodos_pago.activo` no lo lee nadie

Aparece solo en la entidad (`metodo-pago.entity.ts:22`) y en el seed. El gate real —backend y
frontend— es `tenant_metodo_pago.habilitada`, otra tabla y otro campo. No es un selector
olvidado: es una columna sin ningún consumidor.

---

## La forma para las reglas de precio

`indexarReglas` copia `activo` al mapa, y la regla pausada se descarta **al resolver**, no al
cargar. Así el id sigue existiendo en el mapa —no hay 400— y la fila puente no se toca.

Descartada la alternativa de filtrar dentro de `findAll`: rompe la pantalla de administración
(la regla pausada desaparece junto con el toggle para reactivarla) y deja al motor con ids
ausentes del mapa, donde `requerir()` lanza `BadRequestException` — cada ítem asociado se
vuelve un 400 y el POS deja de vender.

Una regla pausada que igual venía referenciada **emite una advertencia**, siguiendo el
precedente ya documentado en el motor para el tope de descuento
([`calculo-precios.engine.ts:307`](../../../backend/src/modules/calculo-precios/calculo-precios.engine.ts)):
*"El tope no frena la venta: emite advertencia"*. La venta sale con el monto correcto y el
cajero se entera de por qué ese descuento no apareció. La infraestructura ya existe de punta a
punta (`AdvertenciaPrecio`, `advertencias`, `advertenciasVenta`, `AdvertenciasPrecio.vue`).

Un solo punto de arreglo cubre preview y venta real: `ventas.service.ts` consume
`CalculoPreciosService`, no reimplementa el motor.

---

## Scope

**Incluido:** los tres agujeros de arriba — reglas de precio (`descuentos`, `recargos`,
`impuestos` no-IVA), `items` en los caminos POS/tienda/salones, y la eliminación de
`metodos_pago.activo`.

**Fuera:**

- **Las tablas puente no se tocan.** Ni esquema ni filas.
- **IVA**: ver la sección propia más abajo. No se pausa: es afecto/exento.
- **`categorias` y `terceros`**: el front ya las esconde y el backend no valida la asignación.
  Es el mismo hueco pero sobre entidades que se referencian, no que se aplican; no cambia
  ningún monto. Va a `pendientes.md`, no a este plan.
- **Ventas ya emitidas**: el hecho fiscal está congelado en `ventas_descuentos` /
  `ventas_recargos` / `ventas_impuestos`. Pausar no reescribe el pasado.
- **Eliminar**: ya funciona vía papelera.
- **Vigencia** (`fecha_inicio` / `fecha_fin`): tampoco se evalúa —el seeder siembra un
  descuento con `fechaInicio: '2026-12-01'` que aplica hoy—, pero está documentado como
  diferido en [`descuentos-recargos.md`](../../features/descuentos-recargos.md) § Scope. Va en
  su propia entrada.

---

## El aviso al pausar (owner, 2026-08-03)

**Pausar avisa, y el aviso frena.** Antes de pausar, un modal con el
impacto y con la promesa explícita de que es reversible:

```
┌────────────────────────────────────────────┐
│  Pausar «Descuento fin de semana»          │
│                                            │
│  Deja de aplicarse en 34 ítems.            │
│  Las asociaciones se conservan: al         │
│  reactivarlo vuelve como estaba.           │
│                                            │
│            [ Cancelar ]  [ Pausar ]        │
└────────────────────────────────────────────┘
```

Consecuencias para la implementación:

- La consulta inversa regla → ítems pasa de opcional a **requisito**, y corre **antes** del
  toggle: el conteo alimenta el modal. Si el `GET` falla, el modal no se abre y el toggle no
  se mueve — no se pausa a ciegas.
- **Reactivar no pregunta.** Volver a activar no destruye nada; el modal solo aparece al
  pausar.
- **Con cero ítems asociados no hay modal**: pausar directo. Un diálogo que dice "deja de
  aplicarse en 0 ítems" es ruido, y el ruido es lo que enseña a confirmar sin leer.
- La segunda línea del modal ("las asociaciones se conservan") **es una afirmación
  falsable**: si alguna vez el código vuelve a limpiar asociaciones al pausar, el modal pasa
  a mentir. El test de pantalla la cubre.

**Una regla pausada pedida a mano no se aplica, y lo dice** (owner, 2026-08-03). La API acepta
ids de reglas explícitos (`descuentosVentaIds` a nivel venta, `descuentoIds` dentro de una
línea). Si alguno apunta a una regla pausada, la venta **sale igual**, con el monto correcto,
y la respuesta trae una `AdvertenciaPrecio` diciendo cuál no se aplicó y por qué.

Sigue el precedente que el motor ya tiene documentado en
[`calculo-precios.engine.ts:307`](../../../backend/src/modules/calculo-precios/calculo-precios.engine.ts)
—*"El tope no frena la venta: emite advertencia"*— y usa infraestructura que existe de punta a
punta (`AdvertenciaPrecio`, `advertencias`, `advertenciasVenta`, `AdvertenciasPrecio.vue`).

*Dato medido el 2026-08-03:* hoy **ninguna pantalla manda ninguno de los dos campos**. Existen
en el DTO del backend y en el tipo del composable, pero no hay un `.vue` que los complete. La
decisión no cambia ningún comportamiento actual: fija el contrato para cuando haya productor.
Descartado el 400 porque frena una venta en el mostrador por una pantalla desactualizada, y
descartado el descarte silencioso porque el cajero eligió algo que no pasó y el reclamo del
cliente llega después.

---

## Un ítem pausado se comporta distinto según el canal (owner, 2026-08-03)

La regla de fondo: **se bloquea donde todavía no pasó nada; no se bloquea donde el consumo ya
ocurrió en el mundo físico.**

| Canal | Qué pasa | Por qué |
|---|---|---|
| **Tienda online** | **Error en el checkout**, con mensaje amigable: *"El producto ya no se encuentra disponible"* | El cliente todavía no recibió nada. Cobrar algo que sacaste de venta es la peor salida. |
| **Salones** (cuenta abierta) | **Se cobra.** La línea ya cargada se paga normalmente | Lo más probable es que ya se haya consumido. No se le quita de la cuenta a alguien que ya se lo comió. |
| **POS** | **Advierte**, y la venta se puede cobrar igual | Mostrador cara a cara: el producto puede estar en la mano del cliente. El cajero decide con el dato a la vista. |

Detalles que caen de ahí:

- **El carrito online vive en el navegador** — no hay tabla `carrito` en el esquema. O sea que
  el ítem se puede pausar entre que el cliente lo agrega y que paga, y el checkout es el único
  punto donde se puede atajar. `prepararLineasCheckout`
  ([`online.service.ts:203`](../../../backend/src/modules/online/online.service.ts)) hoy no
  lanza ninguna excepción propia: hereda el 404 de `cargarBasePorIds`. El mensaje amigable es
  superficie nueva ahí, y tiene que nombrar **cuál** producto, no fallar en genérico con un
  carrito de ocho líneas.
- **Agregar una línea nueva con un ítem pausado sigue rechazándose en salones** (owner,
  confirmado 2026-08-03): "no se pueden agregar más". Es lo que ya hace
  `getItemVendibleOrThrow` hoy, así que esa validación no se toca. Cobrar lo ya consumido y
  dejar cargar más son dos cosas distintas.
- **La advertencia del POS es la misma maquinaria que la de las reglas pausadas**
  (`AdvertenciaPrecio`), así que no hay mecanismo nuevo que inventar.
- Que los tres catálogos escondan los ítems pausados sigue en pie: esto es la red por si igual
  llega, no el reemplazo del filtro.

---

## El IVA no se pausa: se es afecto o exento (owner, 2026-08-03)

El IVA no tiene interruptor. Lo que decide si se cobra es la `clasificacion_tributaria` del
ítem —afecto o exento— y nada más
([ADR-018](../../adr/018-iva-derivado-de-la-clasificacion.md)).

Eso ya se cumple hoy, y no por casualidad — medido el 2026-08-03:

- La fila del IVA es **del país, no del tenant** (`origen: 'sistema'`, `tenant_id` nulo,
  `pais_id` cargado).
- El front esconde el toggle para las filas de sistema
  ([`impuestos.vue:319`](../../../frontend/app/pages/configuracion/impuestos.vue)) y
  `toggleActivo` corta antes de llamar a la API para esas filas (`:159`).
- El backend tampoco podría: `update()` busca con `where: { id, tenantId }`, y una fila del
  país tiene `tenant_id` nulo — un PATCH de un tenant devuelve 404. La protección es
  estructural, no un `if`.
- Un tenant tampoco puede fabricarse un IVA propio: `tipo` no está expuesto en
  `CreateImpuestoDto` ni en `UpdateImpuestoDto` y su default es `'otro'`.

**Lo que este plan tiene que blindar:** cuando el motor empiece a respetar `activo` en
impuestos, esa regla debe **excluir explícitamente `tipo='iva'`**. Si no, una fila de IVA con
`activo = false` —sembrada, o puesta por SQL directo— dejaría de cobrar IVA en silencio. Eso
es un problema fiscal, no un descuento mal aplicado. El filtro de `activo` en impuestos aplica
solo a los personalizados del tenant, que son justo los que el tenant puede pausar.

**Y una corrección de comentario, no de comportamiento:** `items.vue:807` calcula el chip de
IVA sin filtrar `activo`, y el comentario de arriba lo justifica diciendo *"el motor tampoco
filtra por `activo`"*. Cuando el motor pase a filtrar, ese razonamiento deja de ser cierto
aunque el comportamiento siga siendo el correcto — el chip debe seguir sin filtrar, pero
porque **el IVA no se gobierna con `activo`**, no porque el motor sea permisivo. Hay que
reescribir la justificación o queda mintiendo.

---

## `metodos_pago.activo` se elimina (owner, 2026-08-03)

No lo lee nadie y el gate real es `tenant_metodo_pago.habilitada`, que además es por tenant —
`activo` sería global, y en un SaaS multi-tenant lo global casi nunca es lo que se quiere. Dos
campos para la misma idea es ambigüedad que después se cobra sola.

Como el proyecto no tiene datos productivos, esto es cambiar el esquema, actualizar el seeder
y resetear: no hay migración incremental ni deprecación que diseñar.

---

## Tareas

### Backend — reglas de precio

- [x] `indexarReglas` copia `activo` al mapa (hoy lo descarta)
- [x] Al resolver la línea, las reglas pausadas se descartan en vez de aplicarse. **Sin
      sacarlas del mapa:** `requerir()` lanza 400 ante un id ausente y eso frenaría la venta
- [x] Mismo trato para las que llegan por DTO (`descuentosVentaIds` y `descuentoIds` de
      línea): no se aplican y emiten advertencia. La advertencia de una regla a nivel venta va
      además en `advertenciasVenta`, que es la lista de las que no pertenecen a ninguna línea
- [x] Cada regla pausada descartada emite una `AdvertenciaPrecio` con la forma partida
      (título / detalle) que usan las advertencias existentes
- [x] El filtro de `activo` en impuestos **excluye `tipo='iva'`**: el IVA lo gobierna
      afecto/exento, no el interruptor
- [x] Unit del motor: una regla pausada no altera el total y sí aparece en `advertencias`; la
      misma regla activa sí lo altera
- [x] Unit del motor: un ítem **afecto** paga IVA aunque la fila de IVA tenga `activo = false`.
      Es el test que impide que un cambio futuro deje de cobrar IVA en silencio
- [x] Unit: el mutante que prueba que el test toca la línea nueva **revierte** al
      comportamiento anterior (aplicar la regla pausada), no solo rompe la compilación
- [x] E2E de API (`backend/test/*.e2e-spec.ts` — el sufijo importa, `jest-e2e.json` matchea
      `.e2e-spec.ts$`): activa aplica; pausada da el total sin descuento **y no devuelve
      400**; reactivada vuelve a aplicar sin haber tocado ninguna asociación
- [x] E2E: `POST /ventas` con un ítem asociado a una regla pausada no la congela en
      `ventas_descuentos` — **hecho el 2026-08-09** (`ventas.e2e-spec.ts` § "la venta congela
      la regla aplicada"). Cubre los dos caminos en una venta: heredada por asociación al ítem
      y pedida explícita por línea. Mutante medido: borrar la guarda `!regla.activo` del motor
      —o sea volver al comportamiento anterior— deja **2** filas donde el test espera 0

### Backend — la consulta de uso que alimenta el modal

- [x] Consulta inversa regla → ítems vivos que la usan, en espejo de
      [`obtenerUsoItem`](../../../backend/src/modules/items/items.service.ts): una sola
      query con `JOIN` a `items` acotando `tenant_id` y `eliminado_el IS NULL`, nunca una
      query por fila
- [x] Exponerla con el mismo guard que hoy protege la lectura del catálogo — verificar cuál
      es, no asumir
- [x] E2E: aislamiento multi-tenant del endpoint (un tenant no cuenta los ítems de otro)

### Backend — ítems

- [x] **Tienda online:** `prepararLineasCheckout` rechaza el checkout si alguna línea trae un
      ítem pausado, con un mensaje que nombra el producto. No agregar el filtro dentro de
      `cargarBasePorIds`: lo comparten los tres canales y cada uno necesita algo distinto
- [x] **POS:** un ítem pausado emite `AdvertenciaPrecio` y la venta se puede cobrar
- [x] **Salones:** no se toca el cobro de una cuenta con líneas ya cargadas, y se mantiene el
      rechazo al agregar líneas nuevas (`getItemVendibleOrThrow`, ya implementado)
- [x] E2E: checkout online con un ítem pausado devuelve el error amigable y **no** crea la
      orden ni descuenta stock
- [x] E2E: `POST /ventas` (POS) con un ítem pausado **sí** crea la venta, con la advertencia
      en la respuesta
- [x] E2E: una cuenta de salón con un ítem que se pausó después de cargarlo se cobra sin error
      — **hecho el 2026-08-09**, en `items-pausados.e2e-spec.ts`, que es el spec del ítem
      pausado **por canal** y al que le faltaba justamente este. La cuenta se arma en el
      `beforeAll` con el ítem todavía activo: montarla después probaría el otro caso. Lleva
      además el control de que agregar la línea AHORA sí da 404, para que el cobro no pase por
      la razón equivocada

### Backend — métodos de pago

- [x] Sacar `activo` de `metodos_pago`: columna en `startup-pos.sql`, campo en
      `metodo-pago.entity.ts:22` y lo que lo escriba en el seeder
- [x] Antes de borrar, un grep del repo entero por `metodos_pago.activo` y por el campo en el
      front: la auditoría dice que no lo lee nadie, pero borrar una columna se verifica sobre
      el repo, no sobre un reporte
- [x] `./scripts/reset-db.sh` y el gate completo: el esquema cambió

### Frontend

- [x] Los tres catálogos de venta (`pos.vue`, `tienda/index.vue`, `salones/index.vue`)
      esconden los ítems pausados
- [x] `toggleActivo` de `descuentos.vue`, `recargos.vue` e `impuestos.vue`: al pausar,
      consultar el uso y abrir el modal de confirmación con el conteo. Reusar el patrón de
      confirmación que la pantalla ya tiene (`confirmRestaurarId` y su modal), no introducir
      uno nuevo. Reactivar no abre nada
- [x] Con cero ítems asociados, pausar sin modal
- [x] Si el `GET` de uso falla, el toggle no se mueve y se avisa el error
- [x] Tests de pantalla (`*.nuxt.spec.ts` junto a la página, Vitest — **no** en
      `frontend/e2e/`, que es Playwright): el modal muestra el conteo real; cancelar deja la
      regla activa; confirmar la pausa **sin** tocar las asociaciones (la afirmación que el
      propio modal hace)

### Cierre

- [x] Smoke test en navegador contra el stack real: pausar un descuento asociado a un ítem,
      armar una venta con ese ítem, ver el total sin el descuento y la advertencia; reactivar
      y verlo volver. Ídem con un ítem pausado en el POS
- [x] `docs/features/descuentos-recargos.md`: qué significa `activo` y que pausar ≠ eliminar
- [x] Reescribir el comentario de `items.vue:802-806`: el chip de IVA sigue sin filtrar
      `activo`, pero porque el IVA no se gobierna con ese campo, no porque el motor sea
      permisivo
- [x] `docs/features/impuestos.md`: el IVA no se pausa, se es afecto o exento
- [x] `docs/CONVENTIONS.md` (o `docs/patterns/backend.md`): la regla general, para que la
      próxima entidad con `activo` nazca cumpliéndola
- [x] `docs/agent/pendientes.md`: mover la entrada a `resueltos.md` dejando registrado que la
      forma del 2026-07-30 fue sustituida y por qué; abrir la entrada de `categorias` /
      `terceros`
- [x] `docs/ESTADO.md` si cambia el estado de la feature

---

## Verification

```bash
./scripts/reset-db.sh
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Gate completo, no subset. Cierra con la revisión independiente del paso 7 de
`verify-feature` (el pre-commit la exige: el diff toca services de backend y `.vue` de
`pages`).
