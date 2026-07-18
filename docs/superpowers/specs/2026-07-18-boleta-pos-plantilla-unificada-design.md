# Diseño: Plantilla unificada de Boleta POS + Precuenta con propina

**Status:** Approved
**Date:** 2026-07-18
**Owner:** Cesar Matheus

---

## Context

El sistema ya tiene impresión térmica vía QZ Tray (ver
[`docs/features/impresion-termica.md`](../../features/impresion-termica.md)) con tres
builders puros en `frontend/app/utils/ticket-builder.ts`: `buildComandaTicket`,
`buildPrecuentaTicket`, `buildBoletaTicket`. La boleta actual es minimalista (nombre
del tenant, "BOLETA", ítems, totales agregados, pagos).

Dos documentos de diseño (`Diseno_Boletas_POS_Unificado.md` —versión buena— y
`Diseno_Completo_Boletas_POS.md` —borrador previo del mismo diseño—) describen una
boleta mucho más rica, con:

- Cabecera de emisor con **RUT** (nombre legal, dirección, teléfono).
- Bloque de tipo de documento condicional: **BOLETA ELECTRÓNICA** vs **DOCUMENTO
  INTERNO**.
- Metadata operativa condicional (cajero, caja, mesa, garzón, cliente, RUT cliente).
- Ítems con precio unitario y total.
- Desglose fiscal: **Neto + impuesto(s) con nombre y tasa reales**.
- Bloque de **propina** debajo de `TOTAL BOLETA`, sumando en `TOTAL A PAGAR`.
- Pie condicional: electrónico (folio + PDF417 + timbre SII) vs interno
  (`*** SIN VALIDEZ FISCAL ***`).
- Precuenta con **propina sugerida** (porcentaje del tenant).

### Decisiones tomadas en brainstorming

1. **Rama electrónica = slot condicional vacío.** No hay integración SII (no existen
   folios/CAF reales, ni timbre PDF417, ni firma). Se construye **solo la rama interna**
   (la que se usa hoy). La rama electrónica queda codificada pero **inalcanzable por
   datos**, sin construir folio/PDF417/timbre. Alineado con YAGNI y la regla fiscal de
   `CLAUDE.md` ("emisión al SII a futuro; diseñar compatible sin integrar").
2. **Emisor = razón social preferida.** Se usa la `razon_social` con `preferida=true`
   (tiene RUT real); fallback a primera `habilitada`, luego al nombre del tenant.
3. **Flag `facturacionElectronica` = constante `false` por ahora.** El builder recibe
   el booleano; hoy se pasa `false` fijo. Sin migración de BD.
4. **Ancho de ticket = 32 chars, ítem en 2 líneas.** Consistencia con comanda y
   hardware actual; no depende de papel 80mm.
5. **Impuestos con nombre y tasa reales del tenant** (no hardcodear "IVA 19%"). El
   dato ya existe en el cliente: el motor de precios devuelve por línea
   `trazas.impuestos: { id, nombre, monto, tasa }[]`.

---

## Scope

**Cambio 100% frontend. Sin backend, sin migración de BD.** Todos los datos ya están
disponibles en el cliente al momento de imprimir:

- Boleta e precuenta se arman desde `resultado.value` (salida del motor de precios
  `useCalculoPrecios`), no desde la venta persistida.
- El desglose por impuesto ya viene en `resultado.lineas[].trazas.impuestos`.
- El porcentaje de propina sugerida ya está cargado en salones (`propinaPorcentaje`).
- Falta solo cargar la razón social preferida (nuevo composable liviano).

### Incluido

- Reescritura de `buildBoletaTicket` con la nueva plantilla (32 chars).
- Enriquecimiento de `buildPrecuentaTicket` con el bloque de propina sugerida.
- Helper puro `agregarImpuestosVenta(resultado)` — agrega trazas de impuesto por venta.
- Helper puro de formateo de porcentaje (`0.19` → `19%`).
- Ampliación de firmas en `useImpresoras.ts` (`imprimirBoleta`, `imprimirPrecuenta`).
- Composable `useRazonSocialEmisor()`.
- Actualización de call sites: `pages/ventas/pos.vue` y `pages/salones/index.vue`.
- Tests Vitest (TDD).

### NO incluido (futuro)

- Generación real de PDF417 / folios / CAF / firma / timbre SII (rama electrónica
  dormante).
- Toggle de `facturacionElectronica` por tenant (hoy constante `false`).
- Campos `giro` y `sucursal`: no existen en el modelo → se omiten (regla de campos
  opcionales). Si más adelante se agregan al modelo, entran por el mismo mecanismo
  condicional sin rediseño.
- Ancho configurable 48 (papel 80mm): se mantiene 32 fijo.

---

## Backend

Ninguno. Explícitamente fuera de alcance.

---

## Frontend

### 1. Helpers puros nuevos (en `app/utils/ticket-builder.ts`)

```ts
export interface ImpuestoBoleta {
  nombre: string
  tasa: string   // decimal, ej. '0.19'
  monto: string
}

/**
 * Agrega las trazas de impuesto de todas las líneas de una ResultadoVenta,
 * agrupando por impuesto (id) y sumando montos con Decimal.
 * Devuelve [] si no hay impuestos. Orden estable por primera aparición.
 */
export function agregarImpuestosVenta(
  lineas: { trazas: { impuestos: { id: string; nombre: string; tasa: string; monto: string }[] } }[],
): ImpuestoBoleta[]

/** '0.19' -> '19%'. Sin decimales innecesarios ('0.195' -> '19,5%'). */
export function formatTasaPorcentaje(tasa: string): string
```

- `agregarImpuestosVenta` toma solo lo que necesita del `ResultadoVenta` (subset
  tipado) para ser 100% testeable sin fixtures pesados.
- Suma con `Decimal`, agrupa por `id`, conserva `nombre`/`tasa` de la primera
  aparición.

### 2. `buildBoletaTicket` — nueva entrada y layout

```ts
export interface BoletaEmisor {
  nombre: string
  rut?: string
  direccion?: string
  telefono?: string
}

export interface BoletaMeta {
  fecha: Date
  cajero?: string
  caja?: string
  mesa?: string
  garzon?: string
  pedido?: string
  observaciones?: string
}

export interface BoletaCliente {
  nombre?: string
  rut?: string
  direccion?: string
}

export interface BoletaItem extends TicketItem {
  precioUnitario: string
  totalLinea: string
}

export function buildBoletaTicket(input: {
  emisor: BoletaEmisor
  facturacionElectronica: boolean   // hoy siempre false
  folio?: string | null             // null hoy
  tipoDocumentoNombre?: string      // opcional (tipos_documento_tributario)
  meta: BoletaMeta
  cliente?: BoletaCliente
  items: BoletaItem[]
  totales: TicketTotales
  impuestos: ImpuestoBoleta[]       // desglose nombrado
  propina?: { monto: string }       // bloque solo si monto > 0
  pagos: TicketPago[]
  formatMonto: (v: string) => string
}): string[]
```

**Reglas de renderizado (todo campo opcional se omite si vacío/nulo):**

- Cabecera: `emisor.nombre` centrado; `RUT: <rut>` si existe; `direccion` si existe;
  `Tel: <telefono>` si existe.
- Tipo de documento (según `facturacionElectronica`):
  - `false` → línea `DOCUMENTO INTERNO`.
  - `true` → `BOLETA ELECTRÓNICA` + `N° <folio>` (dormante).
- Metadata: `Fecha`, `Cajero`, `Caja` una por línea si presentes; `Mesa` y `Garzón`
  comparten línea si caben. `Cliente`/`RUT`/`Dirección` cliente si presentes.
- Ítems (2 líneas): `L1 = "<cant> x <nombre>"`, notas indentadas
  (`lineasNotaTicket`), `L2` con `precioUnitario` a la izquierda y `totalLinea`
  alineado a la derecha (ancho 32).
- Totales: `Subtotal`; `Descuento` (si > 0); `Recargo` (si > 0); `Neto`
  (= `totalFinal − totalImpuestos`); **una línea por impuesto**
  `"<nombre> (<tasa%>)   <monto>"`; separador; `TOTAL BOLETA` (= `totalFinal`).
- Propina (solo si `propina.monto > 0`): separador; `Propina  <monto>`; separador;
  `TOTAL A PAGAR` (= `totalFinal + propina`). Si no hay propina, se omiten **ambas**
  líneas (`Propina` y `TOTAL A PAGAR`): el monto final es `TOTAL BOLETA`.
- Pagos: una línea por pago (nombre + monto).
- Pie condicional:
  - `false` → `*** SIN VALIDEZ FISCAL ***` + `No constituye documento tributario`.
  - `true` → `Timbre Electrónico SII` + `Verifique en www.sii.cl`, con un slot
    comentado `// TODO PDF417` (sin generar barcode).

**Manejo de cero en propina:** si `propina` es `undefined` o su monto es `0`, se
oculta todo el bloque de propina; el total efectivo es `TOTAL BOLETA`.

### 3. `buildPrecuentaTicket` — bloque de propina sugerida

Se mantiene el ticket actual (encabezado, ítems, totales) y se **añade** al pie,
cuando se recibe config de propina sugerida:

```
Subtotal Consumo    $45.000
Propina sugerida 10% $4.500
Total sugerido      $49.500
* Propina sugerida, de aceptación voluntaria.
```

Nueva firma (aditiva, retrocompatible):

```ts
buildPrecuentaTicket(input: {
  ...actual,
  propinaSugerida?: { porcentaje: string; monto: string }  // omite el bloque si ausente
}): string[]
```

`monto` de la propina sugerida = `totalFinal * porcentaje`, calculado en el call site
(salones) con `Decimal` a partir de `propinaPorcentaje` ya cargado.

### 4. `useRazonSocialEmisor()` (nuevo composable)

```ts
// Devuelve el emisor para la boleta: razón social preferida del tenant.
export function useRazonSocialEmisor(): {
  cargar: () => Promise<void>
  emisor: Ref<BoletaEmisor>  // { nombre, rut?, direccion?, telefono? }
}
```

- `GET /tenants/razones-sociales`; elige `preferida === true`; fallback primera
  `habilitado === true`; fallback `{ nombre: tenantStore.activeTenant?.nombre ?? '' }`.
- Cacheable a nivel de página (se llama en `onMounted` de pos y salones).

### 5. `useImpresoras.ts` — firmas ampliadas

`imprimirBoleta` e `imprimirPrecuenta` propagan los nuevos campos al builder
(passthrough); mantienen el comportamiento de degradación ya existente (sin impresora
activa → no-op; timeout 5 s; corte ESC/POS; encoding CP850).

### 6. Call sites

- `pages/ventas/pos.vue` (mostrador): arma `emisor` (composable), `meta` (fecha, cajero
  = usuario actual, caja = caja abierta), `cliente` (si `incluirCustomer`), `items` con
  `precioUnitario`, `impuestos = agregarImpuestosVenta(resultado.lineas)`,
  `facturacionElectronica = false`, sin propina.
- `pages/salones/index.vue` (mesa): igual + `meta.mesa`/`meta.garzon`, `propina`
  (= `propinaMonto` del cierre si > 0). Precuenta pasa `propinaSugerida` con
  `propinaPorcentaje` ya cargado.

---

## Layout de referencia (32 chars, modo interno — el usado hoy)

```
        Comercial Paris SpA
       RUT: 76.123.456-7
 Av. Providencia 1234, Santiago
 Tel: +56 2 2345 6789
--------------------------------
        DOCUMENTO INTERNO
--------------------------------
Fecha : 18-07-2026 13:15
Cajero: Juan Pérez
Caja  : CAJA-01
Mesa  : MESA-12   Garzón: Carlos
--------------------------------
1 x Pisco Sour Catedral
   $5.000            $5.000
2 x Lomo Liso Término Medio
   $15.000          $30.000
--------------------------------
Subtotal            $37.000
Neto                $31.092
IVA (19%)            $5.908
--------------------------------
TOTAL BOLETA        $37.000
--------------------------------
Propina              $3.700
--------------------------------
TOTAL A PAGAR       $40.700
--------------------------------
Efectivo            $40.700
    *** SIN VALIDEZ FISCAL ***
 No constituye documento tributario
```

---

## Verification

### Unit (Vitest, TDD)

`app/utils/ticket-builder.spec.ts` — casos:

- `agregarImpuestosVenta`: sin impuestos → `[]`; un impuesto en varias líneas → suma
  agrupada; múltiples impuestos → orden estable, montos correctos (Decimal).
- `formatTasaPorcentaje`: `'0.19'` → `'19%'`; `'0.195'` → `'19,5%'`; `'0'` → `'0%'`.
- `buildBoletaTicket`:
  - Cabecera omite RUT/dirección/teléfono cuando faltan.
  - Modo interno imprime `DOCUMENTO INTERNO` + `SIN VALIDEZ FISCAL`, nunca folio/SII.
  - Modo electrónico imprime `BOLETA ELECTRÓNICA` + folio + `Timbre Electrónico SII`,
    nunca `SIN VALIDEZ FISCAL`.
  - Metadata condicional (mesa/garzón/cliente) se omite si vacía.
  - Ítems en 2 líneas con total alineado a la derecha a 32.
  - Desglose: `Neto` correcto (`totalFinal − totalImpuestos`); una línea por impuesto
    con nombre y tasa.
  - Con propina > 0: aparecen `Propina` y `TOTAL A PAGAR = totalFinal + propina`.
  - Sin propina: no aparece el bloque de propina.
- `buildPrecuentaTicket`: con `propinaSugerida` imprime las 3 líneas + leyenda; sin
  ella, ticket idéntico al actual.

`app/composables/useRazonSocialEmisor.spec.ts` — elige preferida; fallback habilitada;
fallback nombre tenant.

```bash
cd frontend && npx vitest run app/utils/ticket-builder.spec.ts app/composables/useRazonSocialEmisor.spec.ts
```

### Manual (QZ Tray)

1. `docker-compose up` con BD fresca (seeder idempotente).
2. En `/ventas/pos`: cobrar una venta con impuesto configurado → la boleta muestra
   cabecera con razón social + RUT, `DOCUMENTO INTERNO`, desglose Neto + impuesto real,
   `SIN VALIDEZ FISCAL`, sin bloque de propina.
3. En `/salones`: abrir cuenta, imprimir precuenta → muestra propina sugerida con el
   porcentaje del tenant. Cerrar con propina → la boleta muestra `Propina` y
   `TOTAL A PAGAR` mayor que `TOTAL BOLETA`.

---

## Decisions

- Frontend-only: el desglose por impuesto se **agrega en el cliente** desde las trazas
  del motor de precios; no se toca el backend ni se persiste nada nuevo.
- Rama electrónica dormante (sin PDF417/folio/timbre) por YAGNI (regla fiscal SII a futuro).
- Impuestos con nombre y tasa **reales del tenant** (`/configuracion/impuestos`), nunca
  hardcode "IVA 19%".
- `giro`/`sucursal` omitidos (no existen en el modelo).
- Ancho 32 fijo, ítem en 2 líneas.

## Documentación viva a actualizar (en el commit de implementación)

- `docs/features/impresion-termica.md` — nueva plantilla de boleta + precuenta con
  propina sugerida.
- `docs/ESTADO.md` — fila del cambio.
