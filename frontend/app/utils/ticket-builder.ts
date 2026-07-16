import Decimal from 'decimal.js'

export interface TicketItem {
  nombre: string
  cantidad: string
  /**
   * Personalización / comentario (comanda, precuenta, boleta).
   * Puede venir como string unido con ` · ` o como partes ya separadas.
   */
  nota?: string
  notas?: string[]
}

/** Líneas indentadas: Sin (−), Extra (+), y al final `comentario: …` si hay texto libre. */
export function lineasNotaTicket(item: Pick<TicketItem, 'nota' | 'notas'>): string[] {
  const partes = item.notas?.length
    ? item.notas.map(p => p.trim()).filter(Boolean)
    : (item.nota ?? '')
        .split(' · ')
        .map(p => p.trim())
        .filter(Boolean)

  const omitidos: string[] = []
  const extras: string[] = []
  const comentarios: string[] = []

  for (const p of partes) {
    // Prefijos canónicos de textoComandaPersonalizacion / resumenPersonalizacion.
    // Case-sensitive para no tragar comentarios libres tipo "sin sal".
    if (p.startsWith('Sin ')) omitidos.push(p)
    else if (p.startsWith('Extra ')) extras.push(p)
    else comentarios.push(p)
  }

  return [
    ...omitidos.map(p => `  - ${p}`),
    ...extras.map(p => `  + ${p}`),
    ...comentarios.map(p => `comentario: ${p}`),
  ]
}

export interface TicketTotales {
  subtotalNeto: string
  totalDescuentos: string
  totalRecargos: string
  totalImpuestos: string
  totalFinal: string
}

export interface TicketPago {
  nombre: string
  monto: string
}

// Todos los builders devuelven un array de líneas LÓGICAS (sin '\n'). El composable
// (useImpresoras) las une con '\n' antes de mandarlas a QZ Tray. No agregar '\n' aquí:
// rompería los tests de membresía de array (`expect(lines).toContain('...')`).
function separador(width = 32): string {
  return '-'.repeat(width)
}

function buildTotalesLines(
  totales: TicketTotales,
  formatMonto: (v: string) => string,
): string[] {
  const out: string[] = []
  out.push(`Subtotal: ${formatMonto(totales.subtotalNeto)}`)
  if (new Decimal(totales.totalDescuentos || '0').gt(0)) {
    out.push(`Descuentos: -${formatMonto(totales.totalDescuentos)}`)
  }
  if (new Decimal(totales.totalRecargos || '0').gt(0)) {
    out.push(`Recargos: +${formatMonto(totales.totalRecargos)}`)
  }
  if (new Decimal(totales.totalImpuestos || '0').gt(0)) {
    out.push(`Impuestos: ${formatMonto(totales.totalImpuestos)}`)
  }
  out.push(`TOTAL: ${formatMonto(totales.totalFinal)}`)
  return out
}

/** Ticket de comanda para una estación (cocina/barra) — solo los ítems nuevos. */
export function buildComandaTicket(input: {
  estacionNombre: string
  mesaNombre: string
  cuentaNumero: number
  garzonNombre: string | null
  items: TicketItem[]
  fecha: Date
}): string[] {
  const out: string[] = []
  out.push(`*** ${input.estacionNombre.toUpperCase()} ***`)
  out.push(`Mesa: ${input.mesaNombre}   Cuenta: ${input.cuentaNumero}`)
  if (input.garzonNombre) out.push(`Garzón: ${input.garzonNombre}`)
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(...lineasNotaTicket(item))
  }
  out.push('')
  out.push('')
  return out
}

/** Resumen no fiscal del consumo actual de una cuenta, antes de cobrar. */
export function buildPrecuentaTicket(input: {
  tenantNombre: string
  mesaNombre: string
  cuentaNumero: number
  items: (TicketItem & { totalLinea: string })[]
  totales: TicketTotales
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const out: string[] = []
  out.push(input.tenantNombre)
  out.push('PRECUENTA (no válido como boleta)')
  out.push(`Mesa: ${input.mesaNombre}   Cuenta: ${input.cuentaNumero}`)
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(...lineasNotaTicket(item))
    out.push(`  ${input.formatMonto(item.totalLinea)}`)
  }
  out.push(separador())
  out.push(...buildTotalesLines(input.totales, input.formatMonto))
  out.push('')
  out.push('')
  return out
}

/** Comprobante de venta (mesa o mostrador) con el desglose de pagos. */
export function buildBoletaTicket(input: {
  tenantNombre: string
  items: (TicketItem & { totalLinea: string })[]
  totales: TicketTotales
  pagos: TicketPago[]
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const out: string[] = []
  out.push(input.tenantNombre)
  out.push('BOLETA')
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador())
  for (const item of input.items) {
    out.push(`${item.cantidad} x ${item.nombre}`)
    out.push(...lineasNotaTicket(item))
    out.push(`  ${input.formatMonto(item.totalLinea)}`)
  }
  out.push(separador())
  out.push(...buildTotalesLines(input.totales, input.formatMonto))
  out.push(separador())
  for (const pago of input.pagos) {
    out.push(`${pago.nombre}: ${input.formatMonto(pago.monto)}`)
  }
  out.push('')
  out.push('¡Gracias por su compra!')
  out.push('')
  out.push('')
  return out
}
