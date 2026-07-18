# Plantilla unificada de Boleta POS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la boleta térmica del POS (cabecera de emisor con RUT, metadata condicional, desglose Neto + impuestos reales del tenant, propina → TOTAL A PAGAR, pie interno `SIN VALIDEZ FISCAL` con slot electrónico dormante) y enriquecer la precuenta con propina sugerida.

**Architecture:** Cambio 100% frontend. Los builders puros en `frontend/app/utils/ticket-builder.ts` reciben nuevos datos que ya existen en el cliente: el desglose por impuesto se **agrega** desde las trazas del motor de precios (`useCalculoPrecios`), la propina viene del cierre de cuenta, y el emisor de un nuevo composable `useRazonSocialEmisor`. No se toca backend ni BD.

**Tech Stack:** Nuxt 4 (Vue 3), TypeScript, Decimal.js, Vitest, QZ Tray (ESC/POS).

## Global Constraints

- Toda aritmética de dinero y porcentajes usa **Decimal.js**, nunca `number` nativo.
- Ancho de ticket fijo **32 caracteres**; ítem en 2 líneas.
- Porcentajes en **decimal** (`0.19` = 19%).
- Los builders devuelven `string[]` de líneas lógicas **sin `\n`** (el composable las une). No agregar `\n` dentro de los builders.
- Campos opcionales se **omiten** si vienen vacíos/nulos (no imprimir la línea).
- Rama electrónica (folio/PDF417/timbre SII) queda **codificada pero inalcanzable** (`facturacionElectronica` siempre `false` hoy). No generar PDF417 ni folios (YAGNI).
- Impuestos se muestran con **nombre y tasa reales del tenant**, nunca hardcode "IVA 19%".
- Comandos de test desde `frontend/`: `npx vitest run <archivo>`.

**Spec:** `docs/superpowers/specs/2026-07-18-boleta-pos-plantilla-unificada-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `frontend/app/utils/ticket-builder.ts` | Builders puros + helpers de agregación/formato/layout | Modificar |
| `frontend/app/utils/ticket-builder.spec.ts` | Tests Vitest de los builders | Modificar |
| `frontend/app/composables/useRazonSocialEmisor.ts` | Carga la razón social preferida como emisor | Crear |
| `frontend/app/composables/useRazonSocialEmisor.spec.ts` | Tests del composable | Crear |
| `frontend/app/composables/useImpresoras.ts` | Passthrough de nuevos campos a los builders | Modificar |
| `frontend/app/pages/ventas/pos.vue` | Call site boleta mostrador | Modificar |
| `frontend/app/pages/salones/index.vue` | Call sites boleta + precuenta de mesa | Modificar |
| `docs/features/impresion-termica.md`, `docs/ESTADO.md` | Documentación viva | Modificar |

---

## Task 1: Helpers de impuestos y porcentaje

**Files:**
- Modify: `frontend/app/utils/ticket-builder.ts`
- Test: `frontend/app/utils/ticket-builder.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `interface ImpuestoBoleta { nombre: string; tasa: string; monto: string }`
  - `function agregarImpuestosVenta(lineas: { trazas: { impuestos: { id: string; nombre: string; tasa: string; monto: string }[] } }[]): ImpuestoBoleta[]`
  - `function formatTasaPorcentaje(tasa: string): string`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `frontend/app/utils/ticket-builder.spec.ts`. Actualizar el `import` de la línea 2 para incluir los nuevos símbolos:

```ts
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  agregarImpuestosVenta,
  formatTasaPorcentaje,
} from './ticket-builder'
```

```ts
describe('agregarImpuestosVenta', () => {
  it('devuelve [] si ninguna línea tiene impuestos', () => {
    expect(agregarImpuestosVenta([{ trazas: { impuestos: [] } }])).toEqual([])
  })

  it('suma el mismo impuesto en varias líneas agrupando por id', () => {
    const r = agregarImpuestosVenta([
      { trazas: { impuestos: [{ id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '1900' }] } },
      { trazas: { impuestos: [{ id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '4008' }] } },
    ])
    expect(r).toEqual([{ nombre: 'IVA', tasa: '0.19', monto: '5908' }])
  })

  it('conserva múltiples impuestos en orden de primera aparición', () => {
    const r = agregarImpuestosVenta([
      { trazas: { impuestos: [
        { id: 'iva', nombre: 'IVA', tasa: '0.19', monto: '1900' },
        { id: 'ila', nombre: 'ILA', tasa: '0.10', monto: '1000' },
      ] } },
      { trazas: { impuestos: [{ id: 'ila', nombre: 'ILA', tasa: '0.10', monto: '500' }] } },
    ])
    expect(r).toEqual([
      { nombre: 'IVA', tasa: '0.19', monto: '1900' },
      { nombre: 'ILA', tasa: '0.10', monto: '1500' },
    ])
  })
})

describe('formatTasaPorcentaje', () => {
  it('convierte decimal a porcentaje sin decimales innecesarios', () => {
    expect(formatTasaPorcentaje('0.19')).toBe('19%')
  })
  it('mantiene decimales significativos con coma', () => {
    expect(formatTasaPorcentaje('0.195')).toBe('19,5%')
  })
  it('formatea cero', () => {
    expect(formatTasaPorcentaje('0')).toBe('0%')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: FAIL — `agregarImpuestosVenta is not a function` / `formatTasaPorcentaje is not a function`.

- [ ] **Step 3: Implementar los helpers**

En `frontend/app/utils/ticket-builder.ts`, tras el `import Decimal` (línea 1), agregar:

```ts
export interface ImpuestoBoleta {
  nombre: string
  tasa: string // decimal, ej. '0.19'
  monto: string
}

/**
 * Agrega las trazas de impuesto de todas las líneas de una venta agrupando por id.
 * Conserva nombre/tasa de la primera aparición; suma montos con Decimal.
 */
export function agregarImpuestosVenta(
  lineas: { trazas: { impuestos: { id: string, nombre: string, tasa: string, monto: string }[] } }[],
): ImpuestoBoleta[] {
  const orden: string[] = []
  const acc = new Map<string, ImpuestoBoleta>()
  for (const linea of lineas) {
    for (const imp of linea.trazas.impuestos) {
      const prev = acc.get(imp.id)
      if (prev) {
        prev.monto = new Decimal(prev.monto).plus(imp.monto).toString()
      }
      else {
        orden.push(imp.id)
        acc.set(imp.id, { nombre: imp.nombre, tasa: imp.tasa, monto: new Decimal(imp.monto).toString() })
      }
    }
  }
  return orden.map(id => acc.get(id)!)
}

/** '0.19' -> '19%'; '0.195' -> '19,5%'. Sin decimales innecesarios, coma decimal es-CL. */
export function formatTasaPorcentaje(tasa: string): string {
  const pct = new Decimal(tasa).times(100).toDecimalPlaces(2)
  return `${pct.toString().replace('.', ',')}%`
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: PASS (los describe nuevos verdes; los de boleta previos podrían seguir verdes aún — se reescriben en Task 2).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/utils/ticket-builder.ts frontend/app/utils/ticket-builder.spec.ts
git commit -m "feat(boleta): helpers agregarImpuestosVenta y formatTasaPorcentaje"
```

---

## Task 2: Reescribir `buildBoletaTicket` con la nueva plantilla

**Files:**
- Modify: `frontend/app/utils/ticket-builder.ts`
- Test: `frontend/app/utils/ticket-builder.spec.ts` (reemplazar el `describe('buildBoletaTicket', ...)` completo)

**Interfaces:**
- Consumes: `ImpuestoBoleta`, `formatTasaPorcentaje`, `lineasNotaTicket`, `separador`, `TicketTotales`, `TicketItem`, `TicketPago` (mismo archivo).
- Produces:
  - `interface BoletaEmisor { nombre: string; rut?: string; direccion?: string; telefono?: string }`
  - `interface BoletaMetaOperativa { cajero?: string; caja?: string; mesa?: string; garzon?: string; pedido?: string; observaciones?: string }`
  - `interface BoletaCliente { nombre?: string; rut?: string; direccion?: string }`
  - `interface BoletaItem extends TicketItem { precioUnitario: string; totalLinea: string }`
  - `function buildBoletaTicket(input: { emisor: BoletaEmisor; facturacionElectronica: boolean; folio?: string | null; meta: BoletaMetaOperativa; cliente?: BoletaCliente; items: BoletaItem[]; totales: TicketTotales; impuestos: ImpuestoBoleta[]; propina?: { monto: string }; pagos: TicketPago[]; fecha: Date; formatMonto: (v: string) => string }): string[]`

> **Nota:** `fecha` va **top-level** (no dentro de `meta`) para conservar el patrón actual de `useImpresoras` (`buildBoletaTicket({ ...input, fecha: new Date() })`).

- [ ] **Step 1: Reescribir los tests de boleta (fallan)**

En `frontend/app/utils/ticket-builder.spec.ts`, **reemplazar todo el bloque** `describe('buildBoletaTicket', () => { ... })` (líneas ~117 hasta su cierre) por:

```ts
const EMISOR = { nombre: 'Comercial Paris SpA', rut: '76.123.456-7', direccion: 'Av. Providencia 1234', telefono: '+56 2 2345 6789' }
const TOTALES_BASE = { subtotalNeto: '37000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '5908', totalFinal: '37000' }
const ITEM = { nombre: 'Pisco Sour', cantidad: '1', precioUnitario: '5000', totalLinea: '5000' }
const IVA = [{ nombre: 'IVA', tasa: '0.19', monto: '5908' }]

describe('buildBoletaTicket', () => {
  function boleta(over: Partial<Parameters<typeof buildBoletaTicket>[0]> = {}) {
    return buildBoletaTicket({
      emisor: EMISOR,
      facturacionElectronica: false,
      meta: { cajero: 'Juan Pérez' },
      items: [ITEM],
      totales: TOTALES_BASE,
      impuestos: IVA,
      pagos: [{ nombre: 'Efectivo', monto: '37000' }],
      fecha: FECHA,
      formatMonto,
      ...over,
    })
  }

  it('imprime la cabecera del emisor con RUT y dirección', () => {
    const lines = boleta()
    expect(lines.some(l => l.includes('Comercial Paris SpA'))).toBe(true)
    expect(lines.some(l => l.includes('RUT: 76.123.456-7'))).toBe(true)
    expect(lines.some(l => l.includes('Av. Providencia 1234'))).toBe(true)
  })

  it('omite RUT/dirección/teléfono cuando el emisor no los trae', () => {
    const lines = boleta({ emisor: { nombre: 'Kiosco Simple' } })
    expect(lines.some(l => l.includes('RUT:'))).toBe(false)
    expect(lines.some(l => l.startsWith('Tel:'))).toBe(false)
  })

  it('en modo interno imprime DOCUMENTO INTERNO y SIN VALIDEZ FISCAL, nunca SII', () => {
    const lines = boleta()
    expect(lines.some(l => l.includes('DOCUMENTO INTERNO'))).toBe(true)
    expect(lines.some(l => l.includes('SIN VALIDEZ FISCAL'))).toBe(true)
    expect(lines.some(l => l.includes('SII'))).toBe(false)
    expect(lines.some(l => l.includes('BOLETA ELECTRÓNICA'))).toBe(false)
  })

  it('en modo electrónico imprime BOLETA ELECTRÓNICA + folio + timbre SII, nunca SIN VALIDEZ', () => {
    const lines = boleta({ facturacionElectronica: true, folio: '00000123' })
    expect(lines.some(l => l.includes('BOLETA ELECTRÓNICA'))).toBe(true)
    expect(lines.some(l => l.includes('00000123'))).toBe(true)
    expect(lines.some(l => l.includes('Timbre Electrónico SII'))).toBe(true)
    expect(lines.some(l => l.includes('SIN VALIDEZ FISCAL'))).toBe(false)
  })

  it('imprime Neto y una línea por impuesto con nombre y tasa reales', () => {
    const lines = boleta()
    // Neto = totalFinal - totalImpuestos = 37000 - 5908 = 31092
    expect(lines.some(l => l.startsWith('Neto') && l.includes('$31092'))).toBe(true)
    expect(lines.some(l => l.startsWith('IVA (19%)') && l.includes('$5908'))).toBe(true)
    expect(lines.some(l => l.startsWith('TOTAL BOLETA') && l.includes('$37000'))).toBe(true)
  })

  it('omite la metadata operativa vacía y comparte línea mesa/garzón', () => {
    const soloMesa = boleta({ meta: { mesa: 'MESA-12', garzon: 'Carlos' } })
    expect(soloMesa.some(l => l.includes('MESA-12') && l.includes('Carlos'))).toBe(true)
    const sinMesa = boleta({ meta: { cajero: 'Juan Pérez' } })
    expect(sinMesa.some(l => l.startsWith('Mesa'))).toBe(false)
  })

  it('con propina > 0 imprime Propina y TOTAL A PAGAR = total + propina', () => {
    const lines = boleta({ propina: { monto: '3700' } })
    expect(lines.some(l => l.startsWith('Propina') && l.includes('$3700'))).toBe(true)
    expect(lines.some(l => l.startsWith('TOTAL A PAGAR') && l.includes('$40700'))).toBe(true)
  })

  it('sin propina no imprime bloque de propina ni TOTAL A PAGAR', () => {
    const lines = boleta()
    expect(lines.some(l => l.startsWith('Propina'))).toBe(false)
    expect(lines.some(l => l.startsWith('TOTAL A PAGAR'))).toBe(false)
  })

  it('imprime el ítem en 2 líneas (nombre + precio/total)', () => {
    const lines = boleta()
    const idx = lines.indexOf('1 x Pisco Sour')
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(lines[idx + 1]).toContain('$5000')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: FAIL — la firma vieja de `buildBoletaTicket` no acepta `emisor`/`impuestos`/`meta`; múltiples asserts rojos.

- [ ] **Step 3: Reescribir `buildBoletaTicket` e implementar los helpers de layout**

En `frontend/app/utils/ticket-builder.ts`:

3a. Junto a `separador` (línea ~58) agregar helpers de layout privados:

```ts
const WIDTH = 32

function center(text: string, width = WIDTH): string {
  if (text.length >= width) return text
  return ' '.repeat(Math.floor((width - text.length) / 2)) + text
}

/** Etiqueta a la izquierda, monto a la derecha, alineado al ancho. */
function padLR(left: string, right: string, width = WIDTH): string {
  const espacio = width - left.length - right.length
  return espacio < 1 ? `${left} ${right}` : left + ' '.repeat(espacio) + right
}
```

3b. Antes de `buildBoletaTicket` agregar las interfaces públicas:

```ts
export interface BoletaEmisor {
  nombre: string
  rut?: string
  direccion?: string
  telefono?: string
}

export interface BoletaMetaOperativa {
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
```

3c. Reemplazar la función `buildBoletaTicket` completa por:

```ts
/** Comprobante de venta (mesa o mostrador) — plantilla unificada interna/electrónica. */
export function buildBoletaTicket(input: {
  emisor: BoletaEmisor
  facturacionElectronica: boolean
  folio?: string | null
  meta: BoletaMetaOperativa
  cliente?: BoletaCliente
  items: BoletaItem[]
  totales: TicketTotales
  impuestos: ImpuestoBoleta[]
  propina?: { monto: string }
  pagos: TicketPago[]
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const { emisor, meta, cliente, formatMonto } = input
  const out: string[] = []

  // Cabecera emisor
  out.push(center(emisor.nombre))
  if (emisor.rut) out.push(center(`RUT: ${emisor.rut}`))
  if (emisor.direccion) out.push(center(emisor.direccion))
  if (emisor.telefono) out.push(center(`Tel: ${emisor.telefono}`))
  out.push(separador())

  // Tipo de documento
  if (input.facturacionElectronica) {
    out.push(center('BOLETA ELECTRÓNICA'))
    if (input.folio) out.push(center(`N° ${input.folio}`))
  }
  else {
    out.push(center('DOCUMENTO INTERNO'))
  }
  out.push(separador())

  // Metadata operativa (omitir vacíos)
  out.push(`Fecha : ${input.fecha.toLocaleString('es-CL')}`)
  if (meta.cajero) out.push(`Cajero: ${meta.cajero}`)
  if (meta.caja) out.push(`Caja  : ${meta.caja}`)
  if (meta.mesa || meta.garzon) {
    const mesa = meta.mesa ? `Mesa  : ${meta.mesa}` : ''
    const garzon = meta.garzon ? `Garzón: ${meta.garzon}` : ''
    out.push(mesa && garzon ? padLR(mesa, garzon) : mesa || garzon)
  }
  if (meta.pedido) out.push(`Pedido: ${meta.pedido}`)
  if (meta.observaciones) out.push(`Obs   : ${meta.observaciones}`)

  // Cliente (omitir si no hay datos)
  if (cliente && (cliente.nombre || cliente.rut || cliente.direccion)) {
    if (cliente.nombre) out.push(`Cliente: ${cliente.nombre}`)
    if (cliente.rut) out.push(`RUT Cli: ${cliente.rut}`)
    if (cliente.direccion) out.push(`Dir Cli: ${cliente.direccion}`)
  }
  out.push(separador())

  // Ítems en 2 líneas
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(...lineasNotaTicket(item))
    out.push(padLR(`  ${formatMonto(item.precioUnitario)}`, formatMonto(item.totalLinea)))
  }
  out.push(separador())

  // Totales: Subtotal, Descuento?, Recargo?, Neto, impuestos*, TOTAL BOLETA
  out.push(padLR('Subtotal', formatMonto(input.totales.subtotalNeto)))
  if (new Decimal(input.totales.totalDescuentos || '0').gt(0)) {
    out.push(padLR('Descuento', `-${formatMonto(input.totales.totalDescuentos)}`))
  }
  if (new Decimal(input.totales.totalRecargos || '0').gt(0)) {
    out.push(padLR('Recargo', `+${formatMonto(input.totales.totalRecargos)}`))
  }
  const neto = new Decimal(input.totales.totalFinal).minus(input.totales.totalImpuestos || '0').toString()
  out.push(padLR('Neto', formatMonto(neto)))
  for (const imp of input.impuestos) {
    out.push(padLR(`${imp.nombre} (${formatTasaPorcentaje(imp.tasa)})`, formatMonto(imp.monto)))
  }
  out.push(separador())
  out.push(padLR('TOTAL BOLETA', formatMonto(input.totales.totalFinal)))

  // Propina (solo si > 0) → TOTAL A PAGAR
  const propina = input.propina ? new Decimal(input.propina.monto || '0') : new Decimal(0)
  if (propina.gt(0)) {
    out.push(separador())
    out.push(padLR('Propina', formatMonto(propina.toString())))
    out.push(separador())
    out.push(padLR('TOTAL A PAGAR', formatMonto(new Decimal(input.totales.totalFinal).plus(propina).toString())))
  }
  out.push(separador())

  // Pagos
  for (const pago of input.pagos) {
    out.push(padLR(pago.nombre, formatMonto(pago.monto)))
  }

  // Pie condicional
  out.push('')
  if (input.facturacionElectronica) {
    out.push(center('Timbre Electrónico SII'))
    // TODO(SII futuro): renderizar el PDF417 real aquí cuando exista integración.
    out.push(center('Verifique en www.sii.cl'))
  }
  else {
    out.push(center('*** SIN VALIDEZ FISCAL ***'))
    out.push(center('No constituye documento tributario'))
  }
  out.push('')
  out.push('')
  return out
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: PASS (todos, incluidos comanda y precuenta previos).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/utils/ticket-builder.ts frontend/app/utils/ticket-builder.spec.ts
git commit -m "feat(boleta): plantilla unificada interna/electrónica con emisor, Neto+impuestos y propina"
```

---

## Task 3: Enriquecer `buildPrecuentaTicket` con propina sugerida

**Files:**
- Modify: `frontend/app/utils/ticket-builder.ts`
- Test: `frontend/app/utils/ticket-builder.spec.ts`

**Interfaces:**
- Consumes: `formatTasaPorcentaje`, `separador`, `padLR` (privado del módulo).
- Produces: firma ampliada (aditiva) de `buildPrecuentaTicket` con `propinaSugerida?: { porcentaje: string; monto: string }`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar dentro de `describe('buildPrecuentaTicket', ...)` en el spec:

```ts
  it('con propinaSugerida imprime el bloque sugerido y la leyenda voluntaria', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo', cantidad: '1', totalLinea: '45000' }],
      totales: { subtotalNeto: '45000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '0', totalFinal: '45000' },
      propinaSugerida: { porcentaje: '0.10', monto: '4500' },
      fecha: FECHA,
      formatMonto,
    })
    expect(lines.some(l => l.startsWith('Propina sugerida 10%') && l.includes('$4500'))).toBe(true)
    expect(lines.some(l => l.startsWith('Total sugerido') && l.includes('$49500'))).toBe(true)
    expect(lines.some(l => l.includes('aceptación voluntaria'))).toBe(true)
  })

  it('sin propinaSugerida no imprime bloque sugerido', () => {
    const lines = buildPrecuentaTicket({
      tenantNombre: 'Restaurante Paris',
      mesaNombre: 'Mesa 1',
      cuentaNumero: 2,
      items: [{ nombre: 'Lomo', cantidad: '1', totalLinea: '45000' }],
      totales: { subtotalNeto: '45000', totalDescuentos: '0', totalRecargos: '0', totalImpuestos: '0', totalFinal: '45000' },
      fecha: FECHA,
      formatMonto,
    })
    expect(lines.some(l => l.startsWith('Propina sugerida'))).toBe(false)
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: FAIL — `propinaSugerida` no reconocido / bloque ausente.

- [ ] **Step 3: Implementar**

En `buildPrecuentaTicket`, añadir el campo opcional a la firma:

```ts
export function buildPrecuentaTicket(input: {
  tenantNombre: string
  mesaNombre: string
  cuentaNumero: number
  items: (TicketItem & { totalLinea: string })[]
  totales: TicketTotales
  propinaSugerida?: { porcentaje: string, monto: string }
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
```

Y **antes** de los dos `out.push('')` finales, insertar:

```ts
  if (input.propinaSugerida) {
    out.push(separador())
    out.push(padLR(
      `Propina sugerida ${formatTasaPorcentaje(input.propinaSugerida.porcentaje)}`,
      input.formatMonto(input.propinaSugerida.monto),
    ))
    out.push(padLR(
      'Total sugerido',
      input.formatMonto(new Decimal(input.totales.totalFinal).plus(input.propinaSugerida.monto).toString()),
    ))
    out.push('* Propina sugerida, de aceptación voluntaria.')
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd frontend && npx vitest run app/utils/ticket-builder.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/utils/ticket-builder.ts frontend/app/utils/ticket-builder.spec.ts
git commit -m "feat(precuenta): bloque de propina sugerida"
```

---

## Task 4: Composable `useRazonSocialEmisor`

**Files:**
- Create: `frontend/app/composables/useRazonSocialEmisor.ts`
- Test: `frontend/app/composables/useRazonSocialEmisor.spec.ts`

**Interfaces:**
- Consumes: `BoletaEmisor` (de `~/utils/ticket-builder`), función pura `elegirEmisor`.
- Produces:
  - `function elegirEmisor(razones: RazonSocialRow[], tenantNombre: string): BoletaEmisor`
  - `interface RazonSocialRow { nombre: string; rut: string; direccion?: string | null; telefono?: string | null; habilitado?: boolean; preferida?: boolean }`
  - `function useRazonSocialEmisor(): { emisor: Ref<BoletaEmisor>; cargar: () => Promise<void> }`

> **Patrón:** aislar la lógica de selección en una función pura `elegirEmisor` (testeable sin mocks de fetch). El composable solo hace el fetch y delega.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/app/composables/useRazonSocialEmisor.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { elegirEmisor } from './useRazonSocialEmisor'

const A = { nombre: 'Razón Preferida', rut: '76.1-1', direccion: 'Calle 1', telefono: '111', habilitado: true, preferida: true }
const B = { nombre: 'Razón Habilitada', rut: '76.2-2', habilitado: true, preferida: false }

describe('elegirEmisor', () => {
  it('elige la razón preferida', () => {
    expect(elegirEmisor([B, A], 'Tenant X')).toEqual({
      nombre: 'Razón Preferida', rut: '76.1-1', direccion: 'Calle 1', telefono: '111',
    })
  })

  it('cae a la primera habilitada si no hay preferida', () => {
    expect(elegirEmisor([B], 'Tenant X')).toEqual({
      nombre: 'Razón Habilitada', rut: '76.2-2', direccion: undefined, telefono: undefined,
    })
  })

  it('cae al nombre del tenant si no hay razones', () => {
    expect(elegirEmisor([], 'Tenant X')).toEqual({ nombre: 'Tenant X' })
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd frontend && npx vitest run app/composables/useRazonSocialEmisor.spec.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar el composable**

Crear `frontend/app/composables/useRazonSocialEmisor.ts`:

```ts
import { ref, type Ref } from 'vue'
import type { BoletaEmisor } from '~/utils/ticket-builder'

export interface RazonSocialRow {
  nombre: string
  rut: string
  direccion?: string | null
  telefono?: string | null
  habilitado?: boolean
  preferida?: boolean
}

/** Selecciona el emisor: preferida → primera habilitada → nombre del tenant. */
export function elegirEmisor(razones: RazonSocialRow[], tenantNombre: string): BoletaEmisor {
  const elegida = razones.find(r => r.preferida) ?? razones.find(r => r.habilitado)
  if (!elegida) return { nombre: tenantNombre }
  return {
    nombre: elegida.nombre,
    rut: elegida.rut,
    direccion: elegida.direccion ?? undefined,
    telefono: elegida.telefono ?? undefined,
  }
}

export function useRazonSocialEmisor(): { emisor: Ref<BoletaEmisor>, cargar: () => Promise<void> } {
  const config = useRuntimeConfig()
  const tenantStore = useTenantStore()
  const emisor = ref<BoletaEmisor>({ nombre: '' })

  async function cargar(): Promise<void> {
    const tenantNombre = tenantStore.activeTenant?.nombre ?? ''
    try {
      const razones = await useApiFetch<RazonSocialRow[]>(`${config.public.apiUrl}/tenants/razones-sociales`)
      emisor.value = elegirEmisor(razones ?? [], tenantNombre)
    }
    catch {
      emisor.value = { nombre: tenantNombre }
    }
  }

  return { emisor, cargar }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd frontend && npx vitest run app/composables/useRazonSocialEmisor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useRazonSocialEmisor.ts frontend/app/composables/useRazonSocialEmisor.spec.ts
git commit -m "feat(boleta): composable useRazonSocialEmisor (razón social preferida)"
```

---

## Task 5: Passthrough de nuevos campos en `useImpresoras`

**Files:**
- Modify: `frontend/app/composables/useImpresoras.ts:214-239`

**Interfaces:**
- Consumes: `buildBoletaTicket`, `buildPrecuentaTicket` (firmas de Task 2 y 3), `BoletaEmisor`, `BoletaMetaOperativa`, `BoletaCliente`, `BoletaItem`, `ImpuestoBoleta`.
- Produces: `imprimirBoleta` / `imprimirPrecuenta` con firmas ampliadas (passthrough).

- [ ] **Step 1: Actualizar imports y firmas**

En `frontend/app/composables/useImpresoras.ts`, ampliar el import de `~/utils/ticket-builder` (líneas ~1-6) para incluir los nuevos tipos:

```ts
import {
  buildComandaTicket,
  buildPrecuentaTicket,
  buildBoletaTicket,
  type TicketItem,
  type TicketTotales,
  type TicketPago,
  type BoletaEmisor,
  type BoletaMetaOperativa,
  type BoletaCliente,
  type BoletaItem,
  type ImpuestoBoleta,
} from '~/utils/ticket-builder'
```

> Verificar los nombres ya importados en ese bloque y añadir solo los que falten (no duplicar).

Reemplazar `imprimirPrecuenta` e `imprimirBoleta` (líneas 214-239) por:

```ts
  async function imprimirPrecuenta(input: {
    tenantNombre: string
    mesaNombre: string
    cuentaNumero: number
    items: (TicketItem & { totalLinea: string })[]
    totales: TicketTotales
    propinaSugerida?: { porcentaje: string, monto: string }
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    if (!impresora) return
    const lineas = buildPrecuentaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas, apiUrl)
  }

  async function imprimirBoleta(input: {
    emisor: BoletaEmisor
    facturacionElectronica: boolean
    folio?: string | null
    meta: BoletaMetaOperativa
    cliente?: BoletaCliente
    items: BoletaItem[]
    totales: TicketTotales
    impuestos: ImpuestoBoleta[]
    propina?: { monto: string }
    pagos: TicketPago[]
    formatMonto: (v: string) => string
  }): Promise<void> {
    const impresora = await obtenerImpresoraBoleta()
    if (!impresora) return
    const lineas = buildBoletaTicket({ ...input, fecha: new Date() })
    await imprimirEn(impresora, lineas, apiUrl)
  }
```

- [ ] **Step 2: Verificar que no rompe la suite existente**

Run: `cd frontend && npx vitest run app/composables/useImpresoras.spec.ts`
Expected: PASS (o, si el spec construía boletas con la firma vieja, ajustarlo a la nueva firma en este mismo paso y volver a correr hasta PASS).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/useImpresoras.ts frontend/app/composables/useImpresoras.spec.ts
git commit -m "feat(impresoras): passthrough de emisor/impuestos/propina a los builders"
```

---

## Task 6: Call site boleta en `pos.vue` (mostrador)

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue` (script setup + bloque `imprimirBoleta` líneas ~239-258)

**Interfaces:**
- Consumes: `useRazonSocialEmisor`, `agregarImpuestosVenta`, `imprimirBoleta` (nueva firma), `useAuthStore`, `useCajaStore`, `resultado` (`ResultadoVenta` de `useCalculoPrecios`).
- Produces: boleta de mostrador con emisor, metadata y desglose de impuestos reales.

- [ ] **Step 1: Cablear emisor y auth en el script**

En `frontend/app/pages/ventas/pos.vue`, junto a los otros stores/composables (~líneas 23-29) agregar:

```ts
const authStore = useAuthStore()
const { emisor, cargar: cargarEmisor } = useRazonSocialEmisor()
```

Importar `agregarImpuestosVenta` desde `~/utils/ticket-builder` (agregar al import existente de utils o crear uno):

```ts
import { agregarImpuestosVenta } from '~/utils/ticket-builder'
```

Cargar el emisor en el `onMounted` existente de la página (donde ya se cargan catálogo/métodos/tiposDocumento). Si no hay `onMounted`, agregar:

```ts
onMounted(() => { void cargarEmisor() })
```

- [ ] **Step 2: Actualizar la llamada `imprimirBoleta`**

Reemplazar el objeto pasado a `impresorasApi.imprimirBoleta({ ... })` (líneas ~239-258) por:

```ts
        await impresorasApi.imprimirBoleta({
          emisor: emisor.value,
          facturacionElectronica: false,
          meta: {
            cajero: authStore.user?.nombre ?? undefined,
          },
          cliente: incluirCustomer
            ? { nombre: customer.value.nombre || undefined, rut: customer.value.rut || undefined, direccion: customer.value.direccion || undefined }
            : undefined,
          items: resultadoVenta.lineas.map((l, i) => {
            const ln = lineasVenta[i]
            return {
              nombre: ln?.item.nombre ?? '',
              cantidad: ln?.cantidadPresentacion && ln?.unidadCodigoPresentacion
                ? formatCantidadTicket(ln.cantidadPresentacion, ln.unidadCodigoPresentacion)
                : l.cantidad,
              precioUnitario: l.precioUnitario,
              totalLinea: l.totalLinea,
              ...(ln?.personalizacionResumen ? { nota: ln.personalizacionResumen } : {}),
            }
          }),
          totales: resultadoVenta.totales,
          impuestos: agregarImpuestosVenta(resultadoVenta.lineas),
          pagos: pagos.map((p) => ({
            nombre: metodos.value.find((m) => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
```

> `resultadoVenta.lineas[i].precioUnitario` existe en `ResultadoLinea`. `incluirCustomer` es la variable ya usada en el `body.customer` (líneas ~214-223).

- [ ] **Step 3: Verificar compilación y suite**

Run: `cd frontend && npx vitest run && npx nuxi typecheck`
Expected: tests PASS; typecheck sin errores en `pos.vue` (si `nuxi typecheck` no está disponible, usar `npm run build` y verificar que compila).

- [ ] **Step 4: Verificación manual (QZ Tray)**

1. `docker-compose up`; abrir QZ Tray.
2. `/ventas/pos` → cobrar una venta con un ítem que tenga impuesto configurado.
3. La boleta muestra: razón social + RUT centrados, `DOCUMENTO INTERNO`, `Cajero`, ítem en 2 líneas, `Neto` + `IVA (19%)` (o el impuesto real del tenant), `TOTAL BOLETA`, pago, `*** SIN VALIDEZ FISCAL ***`. Sin bloque de propina.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/ventas/pos.vue
git commit -m "feat(pos): boleta mostrador con emisor, metadata e impuestos reales"
```

---

## Task 7: Call sites boleta + precuenta en `salones/index.vue` (mesa)

**Files:**
- Modify: `frontend/app/pages/salones/index.vue` (`itemsParaTicket` ~730-746; `imprimirPrecuenta` ~748-767; `imprimirBoleta` en `cerrarCuentaConPin` ~823-839; script setup)

**Interfaces:**
- Consumes: `useRazonSocialEmisor`, `agregarImpuestosVenta`, `imprimirBoleta`/`imprimirPrecuenta` (nuevas firmas), `authStore`, `resultado`/`resultadoCerrado` (`ResultadoVenta`), `propinaPorcentaje`, `propinaMonto`, `selectedMesa`.
- Produces: boleta de mesa con emisor/mesa/propina y precuenta con propina sugerida.

- [ ] **Step 1: Cablear emisor, auth, impuestos en el script**

En `frontend/app/pages/salones/index.vue`, junto a los stores existentes:

```ts
const authStore = useAuthStore()
const { emisor, cargar: cargarEmisor } = useRazonSocialEmisor()
```

Importar `agregarImpuestosVenta`:

```ts
import { agregarImpuestosVenta } from '~/utils/ticket-builder'
```

Cargar el emisor en el `onMounted` existente:

```ts
onMounted(() => { void cargarEmisor() })
```

Añadir `precioUnitario` a la salida de `itemsParaTicket` (~línea 738-744). Localizar el objeto devuelto por línea y agregar `precioUnitario: l.precioUnitario` (la variable `l` es la línea del `resultado`, tipo `ResultadoLinea`, que expone `precioUnitario`):

```ts
    return {
      nombre: cl?.nombre ?? '',
      cantidad: cantidadTicket,
      precioUnitario: l.precioUnitario,
      totalLinea: l.totalLinea,
      ...(cl?.personalizacionTexto ? { nota: cl.personalizacionTexto } : {}),
    }
```

- [ ] **Step 2: Precuenta con propina sugerida**

En `imprimirPrecuenta` (~752-759), agregar `propinaSugerida` cuando el porcentaje del tenant sea > 0:

```ts
    await impresorasApi.imprimirPrecuenta({
      tenantNombre: tenantStore.activeTenant?.nombre ?? '',
      mesaNombre: selectedMesa.value.nombre,
      cuentaNumero: activeCuenta.value.numero,
      items: itemsParaTicket(activeCuenta.value, resultado.value),
      totales: resultado.value.totales,
      ...(new Decimal(propinaPorcentaje.value || '0').gt(0)
        ? { propinaSugerida: {
            porcentaje: propinaPorcentaje.value,
            monto: new Decimal(resultado.value.totales.totalFinal).times(propinaPorcentaje.value).toDecimalPlaces(0).toString(),
          } }
        : {}),
      formatMonto: (v: string) => formatMonto(v),
    })
```

> `propinaPorcentaje` ya está en el script (se usa en `cerrarCuenta`, línea ~814). `Decimal` ya está importado en el archivo.

- [ ] **Step 3: Boleta de mesa con emisor/mesa/propina**

En `cerrarCuentaConPin`, reemplazar la llamada `impresorasApi.imprimirBoleta({ ... })` (~825-834) por:

```ts
        await impresorasApi.imprimirBoleta({
          emisor: emisor.value,
          facturacionElectronica: false,
          meta: {
            cajero: authStore.user?.nombre ?? undefined,
            mesa: selectedMesa.value?.nombre,
          },
          items: itemsParaTicket(cuentaCerrada, resultadoCerrado),
          totales: resultadoCerrado.totales,
          impuestos: agregarImpuestosVenta(resultadoCerrado.lineas),
          ...(new Decimal(tipMonto).gt(0) ? { propina: { monto: tipMonto } } : {}),
          pagos: pagos.map(p => ({
            nombre: metodos.value.find(m => m.metodoPagoId === p.metodoPagoId)?.nombre ?? '',
            monto: p.monto,
          })),
          formatMonto: (v: string) => formatMonto(v),
        })
```

> `tipMonto` ya está calculado en `cerrarCuentaConPin` (línea ~805). `resultadoCerrado` es el `ResultadoVenta` capturado (línea ~804).

- [ ] **Step 4: Verificar compilación y suite**

Run: `cd frontend && npx vitest run && npx nuxi typecheck`
Expected: tests PASS; typecheck sin errores en `salones/index.vue` (fallback: `npm run build`).

- [ ] **Step 5: Verificación manual (QZ Tray)**

1. `/salones` → abrir cuenta, agregar ítems → "Imprimir precuenta": muestra `Propina sugerida 10%` (o el % del tenant) y `Total sugerido`.
2. Cerrar cuenta con propina > 0: la boleta muestra `Mesa`, `Propina` y `TOTAL A PAGAR` > `TOTAL BOLETA`, además del desglose Neto + impuesto real.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/pages/salones/index.vue
git commit -m "feat(salones): boleta con propina y precuenta con propina sugerida"
```

---

## Task 8: Documentación viva

**Files:**
- Modify: `docs/features/impresion-termica.md`
- Modify: `docs/ESTADO.md`

- [ ] **Step 1: Actualizar `impresion-termica.md`**

En la sección **Frontend** → "Formateo puro", reemplazar la descripción de `buildBoletaTicket`/`buildPrecuentaTicket` para reflejar: cabecera de emisor (razón social preferida con RUT), tipo de documento condicional (`DOCUMENTO INTERNO` / rama `BOLETA ELECTRÓNICA` dormante), desglose `Neto` + impuestos con nombre y tasa reales (`agregarImpuestosVenta`), bloque de propina → `TOTAL A PAGAR`, pie `SIN VALIDEZ FISCAL`, y precuenta con propina sugerida. Mencionar el composable `useRazonSocialEmisor`. Añadir link al spec `docs/superpowers/specs/2026-07-18-boleta-pos-plantilla-unificada-design.md` en "Decisiones".

Actualizar el comando de test unit frontend para incluir el nuevo spec:

```bash
cd frontend && npx vitest run app/utils/ticket-builder.spec.ts app/composables/useImpresoras.spec.ts app/composables/useRazonSocialEmisor.spec.ts
```

- [ ] **Step 2: Actualizar `ESTADO.md`**

Agregar una fila:

```
| Boleta POS — plantilla unificada (emisor con RUT, DOCUMENTO INTERNO / slot electrónico dormante, Neto+impuestos reales, propina → TOTAL A PAGAR) + precuenta con propina sugerida | ✅ Implementado (2026-07-18) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/impresion-termica.md docs/ESTADO.md
git commit -m "docs(boleta): actualizar impresion-termica y ESTADO con la plantilla unificada"
```

---

## Self-review (cobertura vs. spec)

- Emisor razón social preferida → Task 4 + Tasks 6/7. ✅
- `facturacionElectronica` constante false + rama dormante → Task 2 (layout electrónico codificado, call sites pasan `false`). ✅
- Ancho 32 / ítem 2 líneas → Task 2 (`WIDTH`, `padLR`). ✅
- Impuestos con nombre/tasa reales (no hardcode) → Task 1 (`agregarImpuestosVenta`, `formatTasaPorcentaje`) + Task 2 (render) + Tasks 6/7 (wiring). ✅
- Neto = totalFinal − totalImpuestos → Task 2. ✅
- Propina → TOTAL A PAGAR (solo si > 0) → Task 2 + Task 7. ✅
- Precuenta con propina sugerida → Task 3 + Task 7. ✅
- Campos opcionales omitidos → Task 2 (metadata/cliente), tests en Task 2. ✅
- `giro`/`sucursal` omitidos → no se pasan (fuera de `BoletaEmisor`/`BoletaMetaOperativa`). ✅
- Sin backend/migración → ninguna tarea toca backend. ✅
- Docs vivas → Task 8. ✅
