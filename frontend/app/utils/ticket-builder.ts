import Decimal from 'decimal.js'

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

// Boleta y precuenta usan papel de 80mm (48 caracteres a fuente normal ESC/POS Font A) —
// la comanda se mantiene a 32 (papel/fuente distinta, sin columnas de precio).
const BOLETA_WIDTH = 48
const COL_CANT = 5
const COL_MONTO = 9
const COL_DESC_BOLETA = 22 // CANT(5) + DESC(22) + P.UNIT(9) + TOTAL(9) + 3 separadores = 48
const COL_DESC_PRECUENTA = 32 // CANT(5) + DESC(32) + TOTAL(9) + 2 separadores = 48

interface Columna {
  texto: string
  ancho: number
  alinear: 'izq' | 'der'
}

function ajustarColumna(texto: string, ancho: number, alinear: 'izq' | 'der'): string {
  if (texto.length > ancho) {
    return alinear === 'izq' ? `${texto.slice(0, ancho - 1)}…` : texto.slice(texto.length - ancho)
  }
  const relleno = ' '.repeat(ancho - texto.length)
  return alinear === 'izq' ? texto + relleno : relleno + texto
}

/** Fila de columnas de ancho fijo separadas por un espacio (tabla CANT/DESCRIPCIÓN/P.UNIT/TOTAL). */
function filaColumnas(cols: Columna[]): string {
  return cols.map(c => ajustarColumna(c.texto, c.ancho, c.alinear)).join(' ')
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
  propinaSugerida?: { porcentaje: string, monto: string }
  fecha: Date
  formatMonto: (v: string) => string
}): string[] {
  const out: string[] = []
  out.push(center(input.tenantNombre, BOLETA_WIDTH))
  out.push(center('PRECUENTA (no válido como boleta)', BOLETA_WIDTH))
  out.push(`Mesa: ${input.mesaNombre}   Cuenta: ${input.cuentaNumero}`)
  out.push(input.fecha.toLocaleString('es-CL'))
  out.push(separador(BOLETA_WIDTH))
  out.push(filaColumnas([
    { texto: 'CANT', ancho: COL_CANT, alinear: 'izq' },
    { texto: 'DESCRIPCIÓN', ancho: COL_DESC_PRECUENTA, alinear: 'izq' },
    { texto: 'TOTAL', ancho: COL_MONTO, alinear: 'der' },
  ]))
  out.push(separador(BOLETA_WIDTH))
  for (const item of input.items) {
    out.push(filaColumnas([
      { texto: item.cantidad, ancho: COL_CANT, alinear: 'izq' },
      { texto: item.nombre, ancho: COL_DESC_PRECUENTA, alinear: 'izq' },
      { texto: input.formatMonto(item.totalLinea), ancho: COL_MONTO, alinear: 'der' },
    ]))
    out.push(...lineasNotaTicket(item))
  }
  out.push(separador(BOLETA_WIDTH))
  out.push(...buildTotalesLines(input.totales, input.formatMonto))
  if (input.propinaSugerida) {
    out.push(separador(BOLETA_WIDTH))
    out.push(padLR(
      `Propina sugerida ${formatTasaPorcentaje(input.propinaSugerida.porcentaje)}`,
      input.formatMonto(input.propinaSugerida.monto),
      BOLETA_WIDTH,
    ))
    out.push(padLR(
      'Total sugerido',
      input.formatMonto(new Decimal(input.totales.totalFinal).plus(input.propinaSugerida.monto).toString()),
      BOLETA_WIDTH,
    ))
    out.push('* Propina sugerida, de aceptación voluntaria.')
  }
  out.push('')
  out.push('')
  return out
}

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
  out.push(center(emisor.nombre, BOLETA_WIDTH))
  if (emisor.rut) out.push(center(`RUT: ${emisor.rut}`, BOLETA_WIDTH))
  if (emisor.direccion) out.push(center(emisor.direccion, BOLETA_WIDTH))
  if (emisor.telefono) out.push(center(`Tel: ${emisor.telefono}`, BOLETA_WIDTH))
  out.push(separador(BOLETA_WIDTH))

  // Tipo de documento
  if (input.facturacionElectronica) {
    out.push(center('BOLETA ELECTRÓNICA', BOLETA_WIDTH))
    if (input.folio) out.push(center(`N° ${input.folio}`, BOLETA_WIDTH))
  }
  else {
    out.push(center('DOCUMENTO INTERNO', BOLETA_WIDTH))
  }
  out.push(separador(BOLETA_WIDTH))

  // Metadata operativa (omitir vacíos)
  out.push(`Fecha : ${input.fecha.toLocaleString('es-CL')}`)
  if (meta.cajero) out.push(`Cajero: ${meta.cajero}`)
  if (meta.caja) out.push(`Caja  : ${meta.caja}`)
  if (meta.mesa || meta.garzon) {
    const mesa = meta.mesa ? `Mesa  : ${meta.mesa}` : ''
    const garzon = meta.garzon ? `Garzón: ${meta.garzon}` : ''
    out.push(mesa && garzon ? padLR(mesa, garzon, BOLETA_WIDTH) : mesa || garzon)
  }
  if (meta.pedido) out.push(`Pedido: ${meta.pedido}`)
  if (meta.observaciones) out.push(`Obs   : ${meta.observaciones}`)

  // Cliente (omitir si no hay datos)
  if (cliente && (cliente.nombre || cliente.rut || cliente.direccion)) {
    if (cliente.nombre) out.push(`Cliente: ${cliente.nombre}`)
    if (cliente.rut) out.push(`RUT Cli: ${cliente.rut}`)
    if (cliente.direccion) out.push(`Dir Cli: ${cliente.direccion}`)
  }
  out.push(separador(BOLETA_WIDTH))

  // Ítems en columnas: CANT / DESCRIPCIÓN / P.UNIT / TOTAL
  out.push(filaColumnas([
    { texto: 'CANT', ancho: COL_CANT, alinear: 'izq' },
    { texto: 'DESCRIPCIÓN', ancho: COL_DESC_BOLETA, alinear: 'izq' },
    { texto: 'P.UNIT', ancho: COL_MONTO, alinear: 'der' },
    { texto: 'TOTAL', ancho: COL_MONTO, alinear: 'der' },
  ]))
  out.push(separador(BOLETA_WIDTH))
  for (const item of input.items) {
    out.push(filaColumnas([
      { texto: item.cantidad, ancho: COL_CANT, alinear: 'izq' },
      { texto: item.nombre, ancho: COL_DESC_BOLETA, alinear: 'izq' },
      { texto: formatMonto(item.precioUnitario), ancho: COL_MONTO, alinear: 'der' },
      { texto: formatMonto(item.totalLinea), ancho: COL_MONTO, alinear: 'der' },
    ]))
    out.push(...lineasNotaTicket(item))
  }
  out.push(separador(BOLETA_WIDTH))

  // Totales: Subtotal, Descuento?, Recargo?, Neto, impuestos*, TOTAL BOLETA
  out.push(padLR('Subtotal', formatMonto(input.totales.subtotalNeto), BOLETA_WIDTH))
  if (new Decimal(input.totales.totalDescuentos || '0').gt(0)) {
    out.push(padLR('Descuento', `-${formatMonto(input.totales.totalDescuentos)}`, BOLETA_WIDTH))
  }
  if (new Decimal(input.totales.totalRecargos || '0').gt(0)) {
    out.push(padLR('Recargo', `+${formatMonto(input.totales.totalRecargos)}`, BOLETA_WIDTH))
  }
  const neto = new Decimal(input.totales.totalFinal).minus(input.totales.totalImpuestos || '0').toString()
  out.push(padLR('Neto', formatMonto(neto), BOLETA_WIDTH))
  for (const imp of input.impuestos) {
    out.push(padLR(`${imp.nombre} (${formatTasaPorcentaje(imp.tasa)})`, formatMonto(imp.monto), BOLETA_WIDTH))
  }
  out.push(separador(BOLETA_WIDTH))
  out.push(padLR('TOTAL BOLETA', formatMonto(input.totales.totalFinal), BOLETA_WIDTH))

  // Propina (solo si > 0) → TOTAL A PAGAR
  const propina = input.propina ? new Decimal(input.propina.monto || '0') : new Decimal(0)
  if (propina.gt(0)) {
    out.push(separador(BOLETA_WIDTH))
    out.push(padLR('Propina', formatMonto(propina.toString()), BOLETA_WIDTH))
    out.push(separador(BOLETA_WIDTH))
    out.push(padLR('TOTAL A PAGAR', formatMonto(new Decimal(input.totales.totalFinal).plus(propina).toString()), BOLETA_WIDTH))
  }
  out.push(separador(BOLETA_WIDTH))

  // Pagos
  for (const pago of input.pagos) {
    out.push(padLR(pago.nombre, formatMonto(pago.monto), BOLETA_WIDTH))
  }

  // Pie condicional
  out.push('')
  if (input.facturacionElectronica) {
    out.push(center('Timbre Electrónico SII', BOLETA_WIDTH))
    // TODO(SII futuro): renderizar el PDF417 real aquí cuando exista integración.
    out.push(center('Verifique en www.sii.cl', BOLETA_WIDTH))
  }
  else {
    out.push(center('*** SIN VALIDEZ FISCAL ***', BOLETA_WIDTH))
    out.push(center('No constituye documento tributario', BOLETA_WIDTH))
  }
  out.push('')
  out.push('')
  return out
}
