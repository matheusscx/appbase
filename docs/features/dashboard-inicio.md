# Feature: Dashboard de inicio

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-01

---

## Overview

### What is it?

El dashboard de inicio (`pages/index.vue`) que ve el dueño al entrar: dos zonas, una
arriba de la otra.

`GET /api/resumen-negocio/hoy` es la plata del día — vendido y cobrado (netos de las
notas de crédito y de lo devuelto), cantidad de ventas, ticket promedio (cada uno con el
valor de hoy, el del mismo día de la semana pasada y la variación), vendido por canal
(físico/online), lo que hay por cobrar de cualquier fecha, las pérdidas del día
(anulaciones y mermas, cada una por su lado) y lo más vendido de hoy. La consume la zona **"Hoy"** del frontend, que carga una vez y se
refresca con un botón manual.

La zona **"Ahora"** es el turno en vivo — salón (mesas ocupadas, cuentas abiertas),
cajas (cajones con sesión abierta, sin montos) y cierres del día (cuántos, con
descuadre y el efectivo con signo) — con refresco periódico automático cada 60 s
mientras la pestaña está visible.

Ambas zonas ocultan su bloque sin aviso de error cuando el tenant no contrató el
módulo (403). El detalle de cada zona está más abajo, en "Frontend".

### Why does it exist?

El dueño, al final del día, quiere saber cómo le fue sin entrar a ningún reporte. Un
dashboard es para mirar de un vistazo, no para analizar: pocos números del día, sin
filtros — el detalle sigue viviendo en `/ventas`.

### Scope

- Incluido en Task 1: el módulo `resumen-negocio`, su permiso propio, y el bloque
  de ventas (vendido/cobrado/cantidad/ticket promedio/por canal) + por cobrar.
- Incluido en Task 2: `perdidas` (anulaciones, reusando `AnulacionesReporteService.resumen`,
  y mermas, con `MermasService.resumen` nuevo) y `masVendidos` (hasta 5 ítems).
- Incluido en Task 4: el frontend de la zona "Ahora" (el turno en vivo, con refresco
  periódico) — ver más abajo.
- Incluido en Task 5: el frontend de la zona "Hoy" (la plata del día, sin refresco
  periódico) — ver más abajo.
- Incluido el 2026-10-01 (frente propio, por ser fiscal): el vendido, el cobrado, por
  cobrar y lo más vendido restan las notas de crédito — ver "Las reglas de plata".
- NO incluido (fuera de alcance de la spec): plata de cuentas abiertas, un total de pérdidas
  (spec § 4.4 — ver más abajo), un reporte de mermas completo (`pendientes.md` § 3), y una
  biblioteca de gráficos (spec § 8). La hora de corte configurable, decidida como "fuera de
  alcance" al escribir esta spec, se construyó después (frente `hora-de-corte`, cerrado
  2026-09-19): `GET /resumen-negocio/hoy` ya calcula "hoy" con el corte del tenant
  (`resumen-negocio.service.ts`), ver `docs/agent/resueltos.md`.

---

## Las reglas de plata (spec § 4)

El vendido, el cobrado y lo que se debe son **netos de las notas de crédito** desde el
2026-10-01 ([spec](../superpowers/specs/2026-10-01-vendido-neto-de-notas-credito-design.md),
decisiones D1–D12). Lo que sigue es lo que cuenta cada número y el porqué.

- **Una corrección se reconoce por `ventas.venta_referencia_id IS NOT NULL`**, no por el
  tipo de documento ni por `es_nota_credito`. Hoy el único que escribe esa columna es la
  nota de crédito, así que el resultado es el mismo; la razón es que el frente de emisión
  suma la devolución interna (una corrección que no es documento tributario) y así resta
  sola, sin reescribir estas consultas. Por eso mismo ninguna de estas consultas cruza
  `tipos_documento_tributario`.
- **Vendido:** `Σ total_final` de las ventas de hoy **menos** `Σ total_final` de las
  correcciones con fecha de hoy, sin las canceladas. La corrección resta en **su** fecha,
  aunque la venta que corrige sea de otro día: es lo que le pasó al local hoy (owner,
  2026-09-30). Una venta `pendiente` o `pagada_parcial` SÍ cuenta. La semana pasada se
  calcula igual, para que la variación compare lo mismo. Un día de puras devoluciones da un
  vendido negativo y se muestra tal cual. La respuesta trae además `vendidoDesglose`
  (`bruto` y `notasCredito`, de hoy, ambos positivos) para que la pantalla muestre de dónde
  sale el neto.
- **Cantidad, ticket y canal:** la corrección **no es una venta**, así que la cantidad no
  la cuenta. El ticket promedio es el neto / la cantidad, y es `null` si la cantidad es 0 o
  el neto no es positivo (nadie "promedia" un día negativo), proyectado a 4 decimales
  (`ESCALA_COSTO`) porque nadie paga ese número. Local/online van en neto: la corrección
  hereda el canal de la venta que corrige y resta ahí, así que los dos suman el número
  grande.
- **Variación:** `(hoy − semanaPasada) / semanaPasada`, `toFixed(4)`, calculada por el
  backend con Decimal. `null` si la semana pasada es **cero o negativa**: contra un día
  vacío o negativo el porcentaje no dice nada. Vale para todas las comparaciones del bloque.
- **Cobrado:** `Σ pago_aplicaciones.monto` con `tipo = 'venta'` de los PAGOS registrados
  hoy (por `pagos.creado_el`), sean de ventas de hoy o de antes, **menos lo devuelto hoy**.
  Dejar el vuelto afuera es la misma cuenta que usa `GET /ventas/resumen`. Lo devuelto son
  dos cosas, y `cobradoDesglose` (`cobrado` y `devuelto`) las muestra juntas:
  - **el efectivo que salió de la caja por una corrección:** la `salida` de
    `movimientos_caja` cuyo `venta_id` es el de una corrección, por la fecha del movimiento.
    Un retiro de caja no lleva `venta_id` y no entra;
  - **los `REFUND` aprobados de la pasarela**, de órdenes que tienen venta, **con o sin**
    nota de crédito (owner, 2026-10-01).

  El porqué: la corrección nunca escribe `pagos`, y el efectivo devuelto ya resta en el
  arqueo, así que sin esto el cobrado y la caja del mismo día contaban la devolución al
  revés. Las dos partes no se pisan porque el reembolso del webhook no devuelve dinero por
  caja, no deja salida. El `REFUND` de una orden **sin** venta no resta: ese cobro nunca
  entró a `pagos`.
  Medido: ni una corrección escribe `pagos`/`pago_aplicaciones`, ni una venta cancelada
  puede tenerlos (`cancelarUnaVez` rechaza la anulación con 400 si hay algún pago). Por eso
  el cobrado bruto no necesita un `JOIN` a `ventas` para excluirlas; lo devuelto se resta
  aparte.
- **Por cobrar:** ventas `pendiente` o `pagada_parcial`, de **cualquier fecha** —es lo que
  se debe ahora, no lo que se vendió hoy—, sin las correcciones como filas. El saldo se
  calcula **por venta**: `total − correcciones de esa venta − (pagado − efectivo devuelto
  por ellas)`, con **piso en 0**, porque lo que queda a favor del cliente no es plata por
  cobrar. El caso es real: una nota de crédito manual solo exige que la venta esté
  `pagada` o `pagada_parcial`, y una venta de $100.000 con $40.000 pagados admite una por
  los $60.000 restantes, que antes seguía figurando como deuda. `cantidad` cuenta las
  ventas con saldo mayor que 0: una venta que la nota dejó en cero deja de ser deuda. Es la
  misma expresión que el "Saldo pendiente" de `/ventas`, escrita en las dos consultas
  (se extrae a la tercera copia).
  ⚠️ **Límite conocido (D10, D12):** los `REFUND` de pasarela **no** entran al saldo, porque
  el `REFUND` no guarda qué nota generó y desde la base no se distingue uno con nota de uno
  sin ella. Con nota alcanza: ya baja el saldo. Lo que sale mal es una venta pagada **en
  parte** por pasarela, con saldo vivo, `REFUND` y nota: con $100 de total, $60 pagados y
  $20 de `REFUND` y de nota, se deben $40 y el saldo da $20. Un `REFUND` sin nota tampoco
  baja el saldo. Los dos casos están en la entrada del reembolso sin nota de crédito
  ([`pendientes.md`](../agent/pendientes.md) § 6).
- **"Hoy" y "la semana pasada"** salen de `fechaLocalTenant`/`bordeFechaSql`/
  `bordeHastaSql` (`rango-fecha.util.ts`), con la zona de la PROVINCIA del tenant — el
  mismo corte a medianoche local que usan reportes y mermas. La zona se resuelve UNA
  sola consulta por request (`zonaHorariaTenant`); `fecha` y `fechaSemanaPasada` se
  derivan de ahí sin volver a consultarla.
- **Consultas fijas por request**, sin importar cuántas ventas haya: la zona; las ventas
  (vendido, cantidad y canal en una con `FILTER`); el cobrado (tres agregados cruzados:
  pagos, efectivo devuelto y `REFUND`); por cobrar (el saldo por venta va en subconsultas
  correlacionadas dentro de **una** agregada, no una por venta); y lo más vendido.

---

## Pérdidas y lo más vendido (Task 2, spec § 4.4)

- **Anulaciones:** `perdidas.anulaciones` es el `porTipo` tal cual lo devuelve
  `AnulacionesReporteService.resumen(tenantId, { desde: fecha, hasta: fecha })` —sin
  reescribir su SQL—, con `fecha` = el día local de hoy en las dos puntas (`hasta` es
  inclusivo). Ese servicio resuelve su propia zona horaria, aparte de la que ya resolvió
  `ResumenNegocioService.hoy`: mismo costo que paga cualquier otro llamador de ese
  método.
- **Mermas:** `perdidas.mermas` sale de `MermasService.resumen(tenantId, desde, hasta)`,
  método nuevo de este módulo. UNA consulta agregada por `items.moneda_id` (mismo
  criterio que `AnulacionesReporteService.cargarCostosPorAnulacion`): cada fila aporta a
  `cantidad`; si tiene costo (`ROUND(cantidad * costo_unitario, 4)`, el mismo número que
  `costoPerdido`) suma a `costo` por moneda; si no, suma a `sinValorizar` y **no** a
  `costo` — regla 6 de la spec del costo sin tipear (`docs/agent/pendientes.md` § 3): un
  `SUM` que ignorara esas filas informaría menos pérdida que la real sin decirlo. Reusa
  **el mismo filtro de tipo** que excluye las cortesías del listado de Mermas (desde
  `2e1fad74`): un motivo en `motivo_baja` puede ser `merma`, `cortesia` o
  `no_elaborado`, y solo el primero es plata perdida de bodega. Esta entrada de
  `pendientes.md` NO se cierra con esto: sigue faltando un reporte de mermas completo
  (listado agregable, filtros propios) — esto es solo el bloque que el dashboard
  necesita.
- **No hay "total de pérdidas".** Un plato quemado en la mesa es a la vez una anulación
  de tipo `merma` y una merma de cocina (así lo define el reporte de anulaciones):
  sumar los dos bloques lo contaría dos veces. Los costos además vienen en más de una
  moneda. `PerdidasHoy` (el tipo TS) documenta esto mismo en su docblock para que nadie
  lo agregue por accidente.
- **Lo más vendido:** `masVendidos` agrupa `venta_detalles` por `item_id` y es **neto**:
  por ítem, lo vendido hoy menos las líneas de las correcciones de hoy, en `cantidad` y en
  `monto`. Una nota con líneas ("2 lomitos acreditados por $5.000") resta 2 y $5.000 de
  esa fila; las líneas ya salen valorizadas al precio de la venta original, así que lo que
  el ranking resta nunca supera lo que resta el vendido. Los filtros de venta son los de
  "vendido" (sin canceladas, rango de hoy) y además `venta_detalles.eliminado_el IS NULL`.
  - **La línea "Ajuste" nunca entra** (`items.es_ajuste_nota_credito`). Es la parte de una
    nota que no corresponde a ningún producto —la nota por monto libre es toda ajuste—:
    resta del vendido, no de un ítem.
  - **Solo salen ítems con neto mayor que 0** (`HAVING`): un ítem devuelto por completo no
    es "lo más vendido".
  - `cantidad` es `Σ cantidad` en unidad base (la columna ya viene congelada en esa unidad:
    no hace falta convertir). `ORDER BY` va sobre la expresión `SUM` numérica, no sobre el
    alias de texto: alfabéticamente "500" queda antes que "9990000". Hasta 5 filas.
  - El nombre del ítem (`items.nombre`) sale **sin filtro de borrado**, a propósito: se
    vendió hoy, y darlo de baja después no lo saca de lo más vendido.
- Ambos bloques agregan un número **fijo** de consultas (dos para anulaciones, una para
  mermas, una para más vendidos), sin importar cuántas filas haya en el rango.

---

## Por qué el permiso propio, y no `Ventas:Leer`

La cajera tiene `Ventas:Leer` para buscar una boleta y reimprimir la de su propia caja
abierta (owner, 2026-09-30 — `docs/agent/pendientes.md` § 3). Si el bloque de
plata del dashboard colgara de ese mismo permiso, la cajera vería también cuánto
factura el local — y no habría forma de darle una cosa sin la otra. Por eso el módulo
es propio, `Resumen del negocio`, con una sola acción (`Leer`, la que ya existe en el
catálogo). Se vende junto con `Ventas` (regla comercial, el código no lo obliga — mismo
patrón que `MiCaja` + `Cajas`). Detalle: [`roles-permisos.md`](./roles-permisos.md).

---

## API

### `GET /api/resumen-negocio/hoy`

Auth: JWT + tenant. Permiso: `Resumen del negocio:Leer`. Sin parámetros — `tenantId`
sale del token; un `?tenantId=<otro>` en la query se ignora.

```
Response (200):
{
  "fecha": "2026-09-18",
  "ventas": {
    "vendido":        { "hoy": "184500.0000", "semanaPasada": "150000.0000", "variacion": "0.2300" },
    "vendidoDesglose": { "bruto": "204500.0000", "notasCredito": "20000.0000" },
    "cobrado":        { "hoy": "120000.0000", "semanaPasada": "150000.0000", "variacion": "-0.2000" },
    "cobradoDesglose": { "cobrado": "135000.0000", "devuelto": "15000.0000" },
    "cantidad":       { "hoy": 3, "semanaPasada": 3, "variacion": "0.0000" },
    "ticketPromedio": { "hoy": "61500.0000", "semanaPasada": "50000.0000", "variacion": "0.2300" },
    "porCanal":       { "fisico": "184500.0000", "online": "0" }
  },
  "porCobrar": { "cantidad": 2, "saldo": "64500.0000" },
  "perdidas": {
    "anulaciones": [
      {
        "tipo": "cortesia",
        "platos": "2.0000",
        "precioCarta": "5000.0000",
        "costo": [{ "monedaId": "…", "monto": "1200.0000" }],
        "sinValorizar": 0
      }
    ],
    "mermas": {
      "cantidad": 4,
      "costo": [{ "monedaId": "…", "monto": "900.0000" }],
      "sinValorizar": 1
    }
  },
  "masVendidos": [
    { "itemId": "…", "itemNombre": "Lomo a lo pobre", "cantidad": "3.0000", "monto": "29997000.0000" }
  ]
}
```

`vendido.hoy` y `cobrado.hoy` son los **netos**; los dos `*Desglose` traen de dónde salen
(de hoy, positivos). Un `vendido` negativo es válido, y `ticketPromedio` y las `variacion`
son `null` donde no hay con qué comparar (ver las reglas de plata).

No hay una clave de "total de pérdidas" — ver el porqué más arriba.

`403` sin el permiso (incluye el admin de un tenant que no contrató el módulo — el
backend trata el módulo contratado como borde duro también para `es_fijo`).

---

## Backend

- **Module**: `backend/src/modules/resumen-negocio/resumen-negocio.module.ts` — sin
  entidad propia, `Db` inyectado directo (como `cuenta-asignaciones.service.ts`); lee
  con SQL raw sobre tablas de otros módulos (`ventas`, `pagos`, `pago_aplicaciones`,
  `movimientos_caja`, `pasarela_transacciones`, `pasarela_ordenes`, `venta_detalles`,
  `items`). `movimientos_caja` tiene un índice por `venta_id` (`idx_movimientos_caja_venta`)
  porque el saldo por venta suma las salidas de las correcciones de cada una. Importa `SalonesModule` (para
  `AnulacionesReporteService`, ahora exportado) y `MermasModule` (para `MermasService`) —
  ninguno de los dos importa `ResumenNegocioModule`, así que no hay ciclo.
- **Controller**: `resumen-negocio.controller.ts` — valida el guard y delega.
- **Service**: `resumen-negocio.service.ts` — `ResumenNegocioService.hoy(tenantId)`,
  que además de sus consultas propias llama a `AnulacionesReporteService.resumen` y a
  `MermasService.resumen` (Task 2).
- **`MermasService.resumen(tenantId, desde, hasta): Promise<ResumenMermas>`**, método
  nuevo en `mermas.service.ts`: la condición que excluye las cortesías
  (`filtroTipoMerma()`) se extrajo a un método privado, reusado por `findAll` (Task 4,
  ya existente) y por `resumen` — no se copió.
- **Seed**: módulo "Resumen del negocio" (`seedModulosApp`), permiso `Leer`
  (`seedModuloAppPermisos`), contratado para Paris junto a Ventas
  (`seedTenantModulo`). El segundo tenant del seed NO lo contrata — es el caso de 403
  del e2e. Sin cambios en Task 2: no agrega seed nuevo.

---

## Frontend — la zona "Ahora" (Task 4)

`pages/index.vue` pasa a ser el dashboard: el saludo queda arriba, más chico, y debajo
la zona **"Ahora"** con tres bloques — Salón, Cajas y Cierres del día — cada uno un
componente propio en `app/components/inicio/`. La página **solo los ordena**: monta
cada bloque con `permissionsStore.esAdmin || permissionsStore.can(módulo, permiso)`
(`Salones`/`Ver todas` para Salón; `Cajas`/`Leer` para Cajas y Cierres) y no tiene
lógica propia. **Un bloque no montado no hace su llamada** — es UX, la seguridad la da
el guard de cada ruta (igual que el resto de la app).

### `useRefrescoPeriodico` (`app/composables/useRefrescoPeriodico.ts`)

El primer refresco periódico del sistema. Cada bloque lo usa así:

```ts
const { datos, actualizadoEl, sinConexion, oculto } = useRefrescoPeriodico(
  () => useApiFetch<T>(`${apiUrl}/…`),
)
```

- Carga al invocarse y después cada `intervaloMs` (default 60 s) — pero **solo si
  `document.visibilityState === 'visible'`**; un `visibilitychange` a visible dispara
  una carga extra, para no esperar hasta el próximo tick con la pestaña recién abierta.
- **Un fallo NO reintenta antes del próximo ciclo** (el owner no quiere reintentos
  automáticos): conserva el último `datos`, marca `sinConexion`, y la pantalla muestra
  "Sin conexión — se reintenta en el próximo ciclo" sin borrar el dato. Una carga
  exitosa la apaga y actualiza `actualizadoEl` (el "Actualizado HH:MM").
- **Un 403 marca `oculto` y DETIENE el intervalo**: spec § 6 midió que el admin de un
  tenant que no contrató el módulo pasa el `v-if` de la página (`esAdmin`) pero el
  backend igual responde 403 — el frontend no tiene cómo saber qué módulos contrató el
  tenant. Reintentar un 403 no lo iba a arreglar, así que el bloque se esconde en vez
  de mostrar un error. El status se lee como `useApiFetch`/`apiErrorMsg`:
  `err?.status ?? err?.response?.status`.
- `onScopeDispose` limpia el intervalo y el listener — no sobrevive al bloque que lo
  agendó. Sin dependencias nuevas: `@vueuse/core` no está en `package.json`.
- `formatHora` (`useFormatters.ts`) da el `HH:MM` de `actualizadoEl`.

### Los tres bloques

| Bloque | Fuente | Qué muestra | Link |
|---|---|---|---|
| `InicioSalon.vue` | `GET /salones/ocupacion` | "14 de 20 mesas ocupadas · 16 cuentas abiertas" | `/salones` |
| `InicioCajas.vue` | `GET /caja/cajones-estado` | Cajones **con sesión abierta**: nombre y quién la tiene, **sin montos** — el modo ciego ya decide quién ve el esperado, el dashboard no lo repite | `/cajas` (bandeja) |
| `InicioCierres.vue` | `GET /caja/resumen-descuadres-dia` | Cierres del día, cuántos con descuadre, y la suma con signo del efectivo (`formatMonto`, coloreado igual que `CajaPendientesRevision.vue`) | `/cajas` (bandeja) |

`InicioCajas` reusa el tipo `CajonEstado` de `~/stores/caja` (sin usar el store: no
tiene sentido pisar su `cajonesEstado` compartido desde un bloque de lectura del
dashboard). `InicioCierres` sí reusa `cajaStore.cargarResumenDescuadresDia()`, que ya
devolvía el dato sin tocar estado del store.

---

## Frontend — la zona "Hoy" (Task 5)

`~/types/resumen-negocio.ts` copia `ResumenNegocioHoy` campo por campo desde
`resumen-negocio.service.ts` (mismo criterio que `~/types/boleta.ts` mientras backend y
frontend no comparten workspace). `AnulacionPorTipo['tipo']` importa `TipoMotivoBaja`
de `useSalones.ts` en vez de duplicarlo una cuarta vez.

**`InicioHoy.vue`** es la zona completa: `index.vue` la monta con
`permissionsStore.esAdmin || permissionsStore.can('Resumen del negocio', 'Leer')`,
igual que los bloques de "Ahora", y no repite el chequeo. A diferencia de "Ahora", NO
usa `useRefrescoPeriodico` — carga UNA vez al invocarse (mismo criterio: sin
`onMounted`, se prueba con un spec plano) y tiene un botón "Actualizar" manual que
vuelve a llamar la misma función, sin `setInterval` (spec § 6, "'Hoy' carga una vez").
Un 403 esconde la zona ENTERA (`v-if="!oculto"`) sin aviso de error — mismo motivo que
"Ahora": el frontend no sabe qué módulos contrató el tenant. Un fallo que no es 403
muestra un toast (`apiErrorMsg`) y no oculta nada.

`InicioHoy` pasa `datos.ventas`/`datos.porCobrar`/`datos.perdidas`/`datos.masVendidos`
por props a cuatro bloques, todos con la misma UNA llamada:

| Bloque | Qué muestra | Link |
|---|---|---|
| `InicioVentas.vue` | Vendido y cobrado grandes, **netos**; debajo de cada uno, **solo si hay algo que restar**, su desglose: "bruto $X · notas de crédito −$Y" y "cobrado $X · devuelto −$Y" (el rótulo "antes de notas de crédito" ya no existe). Cantidad, ticket promedio y local/online chicos. Los montos llegan calculados: el componente no hace cuentas, solo decide si mostrar la línea. Cada comparado con "vs. `<día>` pasado" (`formatDiaSemana`, `useFormatters.ts` — la semana pasada cae en el mismo día de semana que hoy) y `formatPorcentaje(variacion, 0)`, que ya rinde `null` como "—" | `/ventas` (card-link) |
| `InicioPorCobrar.vue` | "N ventas · $X por cobrar" | `/ventas` (card-link) |
| `InicioPerdidas.vue` | Anulaciones por tipo (`tipoMotivoBajaLabel`, auto-importado de `useSalones.ts`) con platos, precio de carta y costo (`formatCostoPorMoneda`); mermas con su costo. **Cada uno** —cada tipo de anulación y el bloque de mermas— muestra "N sin costo cargado" si su propio `sinValorizar > 0` (regla 6 del costo sin tipear, `pendientes.md` § 3: `AnulacionPorTipo.sinValorizar` calla lo mismo que `ResumenMermas.sinValorizar` si no se muestra — fix round 1, 2026-09-18). **Sin total** (mismo porqué que el backend, spec § 4.4) | Dos `ULink` internos: "Ver anulaciones" → `/salones/anulaciones`, "Ver mermas" → `/mermas` — no es un card-link único porque tiene dos destinos |
| `InicioMasVendidos.vue` | Hasta 5 ítems, ya ordenados por el backend, con nombre/cantidad/monto | Sin link: no existe un reporte de ventas al que llevar (spec § 7) |

**Cards accesibles con teclado:** todas las tarjetas-link de las dos zonas —"Ahora"
(`InicioSalon`, `InicioCajas`, `InicioCierres`) y "Hoy" (`InicioVentas`,
`InicioPorCobrar`)— usan `<UCard as="a" href="…" @click.prevent="navigateTo('…')">`:
un `<a>` real, focuseable con Tab y activable con Enter (el navegador dispara
`click` sobre un `<a>` enfocado al presionar Enter, y el handler lo captura igual
que un click de mouse), con la navegación SPA client-side preservada por
`navigateTo`.

**Por qué no `as="NuxtLink"`:** `UCard` reenvía `as` sin resolver al `Primitive`
de `reka-ui`, que llama `h(props.as, attrs)` en crudo — sin pasar por
`resolveComponent`. Vue trata **cualquier** `type` string como una etiqueta HTML
literal (`createVNode`: `shapeFlag = isString(type) ? ELEMENT : …`), así que
`as="NuxtLink"` no resuelve al componente global `NuxtLink`: monta un
`<nuxtlink>` custom-element sin `href`, que no navega al hacer click y no es
focuseable de forma útil. Esto se usó en Task 5 y se creyó que producía un `<a>`
real —no se había verificado en el navegador—; quedó así hasta que la revisión de
rama lo detectó. `as="a"` sí funciona porque `"a"` es una etiqueta HTML válida:
el mismo `h()` crudo la monta como un `<a>` de verdad.

`InicioPerdidas` usa `ULink` (un componente de Nuxt UI con soporte nativo de
`to`/`href`, no `UCard` con `as`) para sus dos destinos — ese mecanismo sí
resuelve a un `<a>` real y no tiene este problema.

---

## Testing

### Unit (`resumen-negocio.service.spec.ts`)

`Db.query` mockeado por orden de llamada (zona, ventas, cobrado, por cobrar, más
vendidos). `AnulacionesReporteService`/`MermasService` se
mockean aparte (no son `Db.query`). Cubre: variación con semana pasada en 0 o negativa →
`null`; ticket con división no exacta y `null` con neto no positivo; el neto y los
desgloses que arma `hoy()` desde las filas; las cláusulas SQL que reconocen la corrección
por `venta_referencia_id` y excluyen canceladas (afirmando sobre la cláusula, no con un
`toContain` suelto); que el cobrado lee
`pago_aplicaciones.monto` con `tipo = 'venta'` y no `pagos.monto`; la zona — con
`zonaHorariaTenant` mockeada a `America/Santiago` y el reloj fijado a las ~22:00 de
Chile, `fecha` sale `2026-09-18` aunque el UTC ya esté en el `19`, y la semana pasada
sale `2026-09-11` —; y desde Task 2: que `hoy()` llama a
`AnulacionesReporteService.resumen(tenantId, { desde: fecha, hasta: fecha })` y devuelve
su `porTipo` tal cual; que llama a `MermasService.resumen(tenantId, fecha, fecha)` y
devuelve su resultado tal cual en `perdidas.mermas`; que `masVendidos` mapea
snake_case → camelCase; y que su SQL excluye canceladas y la línea de ajuste, resta las
correcciones, filtra `venta_detalles.eliminado_el`, descarta los netos no positivos y
ordena por el `SUM` numérico (no por el alias de texto). **Los unitarios no ven la forma
del SQL** (el mock ya trae la respuesta): quien la pone a prueba es el e2e.

### Unit (`mermas.service.spec.ts` → `describe('resumen')`, Task 2)

`Db.query` mockeado con DOS respuestas (zona, agregación). Cubre: tres mermas (dos CLP
—una valorizada, una sin costo— colapsadas por el `GROUP BY` en un solo grupo, y una
USD valorizada) → `cantidad` 3, `costo` con dos entradas, `sinValorizar` 1; un grupo
TODO sin valorizar no aporta a `costo` pero sí a `cantidad`/`sinValorizar`; sin mermas
en el rango, todo en cero; y que el SQL filtra `eliminado_el`, `motivo = 'merma'` y el
mismo `EXISTS` de tipo que `findAll`.

### E2E (`resumen-negocio.e2e-spec.ts`)

200 con el admin; 403 con un usuario propio que tiene `Ventas:Leer` pero no `Resumen
del negocio` (armado por API, rol propio — `vendedor.paris@paris.cl` es estado
compartido por ~20 specs y no se toca); 403 con el admin del segundo tenant, que no
contrató el módulo; el delta de crear una venta A pagada entera + una venta B
pendiente con abono parcial (usando un ítem propio de precio no redondo, y leyendo
`totalFinal` de la respuesta del servidor, nunca fijado en el test); que anular una
venta no mueve el vendido; que una nota de crédito de hoy sobre una venta de ayer resta del
vendido de hoy y no de ayer, y no cuenta como venta (y lo mismo una semana atrás); que el
efectivo devuelto por una nota resta del cobrado y un retiro de caja ajeno no; que un
`REFUND` aprobado resta del cobrado con o sin nota, **una sola vez**, y el de una orden sin
venta no; que por cobrar descuenta las notas con piso en 0 y vuelve a deber lo devuelto en
efectivo; que lo más vendido resta las líneas de una nota y no muestra la de ajuste; que
`?tenantId=<otro>` no cambia la respuesta; y, en
`describe('pérdidas y lo más vendido (delta)')` (Task 2, salón/mesa/garzón propios,
molde `salones-anular-linea.e2e-spec.ts`): anular un plato despachado como cortesía
mueve `perdidas.anulaciones` de tipo `cortesia`; registrar una merma sin costo cargado
(`POST /mermas`, molde `test/mermas.e2e-spec.ts`) sube `perdidas.mermas.sinValorizar`
en 1 sin mover `costo`; y una venta de un ítem propio con precio muy alto
(`'9990000'`) sale primera en `masVendidos`, con su `monto` igual al `totalFinal` de
la línea.

El `REFUND` no se alcanza por la app en el e2e (la pasarela demo no reembolsa; solo
`oneclick` y `webpay_plus` lo hacen, y hablan con Transbank): el test arma lo que deja el proveedor, la orden y su
`REFUND` aprobado, y de ahí en adelante usa el camino real.

```bash
cd backend && npm test -- resumen-negocio.service.spec.ts mermas.service.spec.ts
npm run test:e2e -- resumen-negocio.e2e-spec.ts
```

### Frontend — zona "Ahora" (Task 4)

**`useRefrescoPeriodico.spec.ts`**, con `vi.useFakeTimers()` y
`document.visibilityState` stubbeado: carga al inicio y otra vez a los 60 s; con la
pestaña oculta el tick no carga y al volver a visible carga una vez; un fallo conserva
`datos`, pone `sinConexion`, y NO reintenta hasta el próximo tick (contado por llamadas
del mock); un 403 pone `oculto`, detiene el intervalo, y ni un `visibilitychange`
posterior insiste; `intervaloMs` custom; `onScopeDispose` limpia intervalo y listener.

**`InicioAhora.nuxt.spec.ts`** (molde `pages/salones/anulaciones.nuxt.spec.ts`, monta
`pages/index.vue` completa — la página es la que gatea los tres bloques): sin
`Salones:Ver todas` no se pide `/salones/ocupacion`; sin `Cajas:Leer` no se piden las
de caja; sin ningún permiso, ninguna de las tres rutas se pide; con `Cajas:Leer` se
piden las dos rutas de caja; el texto de ocupación sale de la respuesta real; el
bloque de Cajas muestra el cajón abierto y quién lo tiene, sin sus montos; y el caso
403-con-`esAdmin` (spec § 6) oculta el bloque sin mostrar "Sin conexión". Los bodies
simulados tienen la forma real de cada ruta (copiada de `caja.service.ts` y
`salones.service.ts`), no una inventada.

```bash
cd frontend && npm test -- useRefrescoPeriodico.spec.ts InicioAhora.nuxt.spec.ts
```

### Frontend — zona "Hoy" (Task 5)

**`InicioHoy.nuxt.spec.ts`** (molde `InicioAhora.nuxt.spec.ts` y
`pages/salones/anulaciones.nuxt.spec.ts` — moneda oficial hidratada a mano tras
montar). El gate por permiso se prueba montando `pages/index.vue` completa (mismo
criterio que "Ahora": la página es la que decide si monta el bloque); el resto monta
`InicioHoy.vue` directo:

- Sin `Resumen del negocio:Leer` no se pide `/resumen-negocio/hoy`; con el permiso, se
  pide una vez.
- Al montar `InicioHoy` directo: UNA sola llamada; "Actualizar" (botón encontrado por
  texto, no por atributo) dispara una segunda.
- `variacion: null` (Cobrado, en el fixture) rinde "vs. viernes pasado: —", mientras
  que Vendido/Cantidad/Ticket promedio (con variaciones reales, todas distintas entre
  sí) rinden sus porcentajes — así un mutante que cruce dos campos se nota.
- `perdidas.mermas.sinValorizar`: aviso "2 sin costo cargado" con 2, ausente con 0. La
  misma regla, por tipo, en `perdidas.anulaciones`: `sinValorizar: 4` en `merma` (valor
  distinto del de mermas, 2, a propósito — un mutante que cruce los dos campos falla)
  muestra "4 sin costo cargado"; `sinValorizar: 0` en `cortesia` no agrega un tercer
  aviso. Con las dos fuentes en 0, ningún "sin costo cargado" en pantalla.
- Un 403 deja el `wrapper.text()` vacío y no dispara ningún toast.
- Las líneas de desglose ("bruto … · notas de crédito −…", "cobrado … · devuelto −…")
  aparecen solo cuando la nota o lo devuelto no es cero, y un vendido negativo se ve con
  su signo.

El body simulado (`RESUMEN_HOY`) tiene la forma exacta de `ResumenNegocioHoy` — el
mock de `useApiFetch` contesta 200 a lo que sea, así que un DTO inventado no se vería
en el test.

```bash
cd frontend && npm test -- InicioHoy.nuxt.spec.ts
```

### Navegador (`frontend/e2e/inicio/dashboard.spec.ts`, Playwright)

Lo que los tests de componente no ven, porque ahí `useApiFetch` y el router están
mockeados: con ellos en verde, las tarjetas de "Hoy" no navegaban. Corre con la sesión del
admin del seed (`auth.setup.ts`) y, para los otros casos, entra desde el test con el login
de la app:

- las dos zonas con sus datos; las tarjetas llevan a su detalle con un clic y con Enter;
- "Actualizar" vuelve a pedir el día del dueño, y trae una venta hecha después de abrir el
  inicio (caja, ítem y venta propios por API; la venta se anula y la caja se cierra al
  final — ningún garzón del seed);
- "Ahora" se refresca sola al minuto (`page.clock`); con la pestaña oculta no pide nada y
  al volver pide una vez; si el backend se corta, avisa "Sin conexión" y conserva el dato;
- `encargado.salon@paris.cl` ve "Ahora" y no "Hoy";
- el admin en "Demo Bodega", que no contrató el módulo, recibe 403 y "Hoy" no aparece, sin
  error en pantalla;
- quien tiene `Resumen del negocio: Leer` **sin ser admin** (un rol armado por API, no el
  admin del seed: con admin un 403 ajeno se tapa) ve en la tarjeta de ventas lo que restó
  una nota de crédito.

Las tarjetas-link también cambiaron el smoke `@smoke el dashboard carga`: buscaba el link
"Ventas" del menú sin nombre exacto y ahora también matchea las tarjetas, así que usa
`exact: true`.

```bash
cd frontend && npm run e2e   # necesita el stack levantado
```

---

## Related Features

- [`ventas.md`](./ventas.md) — de donde sale `total_final`, el saldo por venta y las
  notas de crédito; y `GET /ventas/resumen`, que usa el mismo neto y la misma expresión
  de saldo.
- [`pagos.md`](./pagos.md) — `pago_aplicaciones` y el criterio de excluir el vuelto.
- [`roles-permisos.md`](./roles-permisos.md) — el permiso `Resumen del negocio:Leer`.
- [`gestion-cajas.md`](./gestion-cajas.md) — `GET /caja/cajones-estado` y
  `GET /caja/resumen-descuadres-dia`, que reusa el bloque Cajas/Cierres.
- [`salones-mesas.md`](./salones-mesas.md) — el reporte de anulaciones que reusa
  `perdidas.anulaciones`, y el destino de `InicioPerdidas.vue`.
- [`mermas-valorizadas.md`](./mermas-valorizadas.md) — de donde sale
  `MermasService.resumen` y el criterio `sinValorizar`.
- `docs/patterns/frontend.md` § "Refresco periódico" — el contrato de
  `useRefrescoPeriodico`.
- `docs/superpowers/specs/2026-09-18-dashboard-inicio-design.md` — spec completa
  (zona "Ahora" del turno, pérdidas, más vendidos, frontend).
