import Decimal from 'decimal.js'

/**
 * El lector del XML de una factura electrónica del SII (spec compras-xml-dte
 * § 3–4.1). Puro: nada de Vue/Pinia — lo consume la pantalla de Nueva compra
 * (tarea 4), que lee el `File` con `arrayBuffer()` y le pasa los bytes.
 *
 * Nada del XML se guarda: al servidor viaja `bodyLectura(doc)`, un JSON
 * chico con las claves ya normalizadas (`POST /compras/dte/lectura`, tareas
 * 1–2). El costo de una línea lo sigue calculando el servidor al confirmar;
 * lo de acá es solo lo que trae el documento, para mostrar y para calzar.
 */

export const TAMANO_MAXIMO_DTE = 2 * 1024 * 1024

const NO_ES_DTE = 'Este archivo no es una factura electrónica del SII'
const ARCHIVO_MUY_GRANDE = 'El archivo pesa más de 2 MB: una factura electrónica no llega a eso'

export interface LineaDte {
  /** 'CODIGO:<TpoCodigo>:<VlrCodigo>' o 'NOMBRE:<NmbItem>', normalizada. */
  clave: string
  /** NmbItem, recortado a 80. */
  descripcion: string
  /** QtyItem; null si falta, no es un número o tiene más de 4 decimales. */
  cantidad: string | null
  /** UnmdItem ("CJ"), solo para mostrar — la unidad real sale de la asociación (§ 5). */
  unidadFactura: string | null
  /** PrcItem, para mostrar. */
  precioListado: string | null
  /** MontoItem ÷ QtyItem a 4 decimales; null si precios brutos o sin cantidad. */
  precioUnitario: string | null
  /** `DescuentoMonto` o `RecargoMonto` > 0 (Formato DTE pág. 41: `MontoItem =
   *  PrcItem×Qty − Descuento + Recargo`) — el precio unitario ya no es igual
   *  a `PrcItem` por alguno de los dos motivos. */
  conAjusteDeLinea: boolean
  /** MontoItem; null si no vino o no es un número (F1, ronda 1). */
  montoItem: string | null
  indExe: string | null
}

export interface DescuentoGlobalDte {
  tipoMov: 'D' | 'R'
  tipoValor: '$' | '%'
  valor: string
  indExeDR: string | null
}

export interface DocumentoDte {
  tipoDte: string
  folio: string
  fechaEmision: string
  emisorRut: string
  emisorRazonSocial: string
  receptorRut: string
  montoTotal: string | null
  preciosConIva: boolean
  lineas: LineaDte[]
  descuentosGlobales: DescuentoGlobalDte[]
}

export type ResultadoLecturaDte =
  | { ok: true, documentos: DocumentoDte[] }
  | { ok: false, error: string }

export type DestinoCodigo =
  | { itemId: string, presentacionId: string }
  | { itemId: string, unidadCodigo: string }
  | 'no_mercaderia'

export interface AsociacionDte {
  clave: string
  destino: DestinoCodigo | null
  nota?: string
}

/** Espejo de `LecturaDteRespuesta` del backend (`lectura-dte.service.ts`, tarea 1). */
export interface LecturaDteRespuesta {
  receptorEsDelTenant: boolean
  proveedor: { id: string, nombre: string } | null
  candidatos: { id: string, nombre: string }[]
  tipoDocumento: { id: string, nombre: string } | null
  compraExistente: { id: string, estado: 'borrador' | 'confirmada', confirmadoEl: string | null } | null
  asociaciones: AsociacionDte[]
}

function decodificar(bytes: Uint8Array): string {
  // La cabecera es ASCII en cualquier encoding que use el SII.
  const cabecera = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Primer descendiente por nombre de tag (no NS: happy-dom no lo soporta con el xmlns del SII). */
function texto(el: Element, tag: string): string | null {
  const t = el.getElementsByTagName(tag)[0]?.textContent?.trim()
  return t ? t : null
}

function comoDecimal(valor: string | null): Decimal | null {
  if (!valor) return null
  try {
    return new Decimal(valor)
  } catch {
    return null
  }
}

export function normalizarClave(clave: string): string {
  return clave.trim().replace(/\s+/g, ' ').toUpperCase()
}

function leerLinea(el: Element, preciosConIva: boolean): LineaDte {
  const nombre = (texto(el, 'NmbItem') ?? '').slice(0, 80)
  const cdgItem = el.getElementsByTagName('CdgItem')[0]
  const clave = cdgItem
    ? normalizarClave(`CODIGO:${texto(cdgItem, 'TpoCodigo') ?? ''}:${texto(cdgItem, 'VlrCodigo') ?? ''}`)
    : normalizarClave(`NOMBRE:${nombre}`)

  const qty = comoDecimal(texto(el, 'QtyItem'))
  const cantidad = qty && qty.greaterThan(0) && qty.decimalPlaces() <= 4 ? qty : null

  // Guardado: un `MontoItem` que no es un número deja la línea sin precio,
  // nunca hace explotar la lectura del documento entero (F1, ronda 1).
  const montoItemDecimal = comoDecimal(texto(el, 'MontoItem'))
  const montoItem = montoItemDecimal ? montoItemDecimal.toString() : null
  const precioUnitario = !preciosConIva && cantidad && montoItemDecimal
    ? montoItemDecimal.div(cantidad).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()
    : null

  const descuentoMonto = comoDecimal(texto(el, 'DescuentoMonto'))
  const recargoMonto = comoDecimal(texto(el, 'RecargoMonto'))

  return {
    clave,
    descripcion: nombre,
    cantidad: cantidad ? cantidad.toString() : null,
    unidadFactura: texto(el, 'UnmdItem'),
    precioListado: texto(el, 'PrcItem'),
    precioUnitario,
    conAjusteDeLinea:
      (!!descuentoMonto && descuentoMonto.greaterThan(0))
      || (!!recargoMonto && recargoMonto.greaterThan(0)),
    montoItem,
    indExe: texto(el, 'IndExe'),
  }
}

function leerDescuentoGlobal(el: Element): DescuentoGlobalDte {
  return {
    tipoMov: texto(el, 'TpoMov') === 'R' ? 'R' : 'D',
    tipoValor: texto(el, 'TpoValor') === '%' ? '%' : '$',
    valor: texto(el, 'ValorDR') ?? '0',
    indExeDR: texto(el, 'IndExeDR'),
  }
}

/**
 * `Folio` y `FchEmis` se leen desde `IdDoc` (no del `Documento` entero): son
 * los únicos campos exigidos que también podrían calzar por nombre en otra
 * sección si se buscaran sueltos.
 */
function leerDocumento(documentoEl: Element): DocumentoDte | null {
  const encabezado = documentoEl.getElementsByTagName('Encabezado')[0]
  const idDoc = encabezado?.getElementsByTagName('IdDoc')[0]
  const emisorEl = encabezado?.getElementsByTagName('Emisor')[0]
  const receptorEl = encabezado?.getElementsByTagName('Receptor')[0]
  if (!encabezado || !idDoc || !emisorEl || !receptorEl) return null

  const tipoDte = texto(idDoc, 'TipoDTE')
  const folio = texto(idDoc, 'Folio')
  const emisorRut = texto(emisorEl, 'RUTEmisor')
  const receptorRut = texto(receptorEl, 'RUTRecep')
  if (!tipoDte || !folio || !emisorRut || !receptorRut) return null

  const preciosConIva = texto(encabezado, 'MntBruto') === '1'

  return {
    tipoDte,
    folio,
    fechaEmision: texto(idDoc, 'FchEmis') ?? '',
    emisorRut,
    emisorRazonSocial: texto(emisorEl, 'RznSoc') ?? '',
    receptorRut,
    montoTotal: texto(encabezado, 'MntTotal'),
    preciosConIva,
    lineas: [...documentoEl.getElementsByTagName('Detalle')].map(el => leerLinea(el, preciosConIva)),
    descuentosGlobales: [...documentoEl.getElementsByTagName('DscRcgGlobal')].map(leerDescuentoGlobal),
  }
}

export function leerDte(bytes: ArrayBuffer): ResultadoLecturaDte {
  if (bytes.byteLength > TAMANO_MAXIMO_DTE) {
    return { ok: false, error: ARCHIVO_MUY_GRANDE }
  }
  const xml = decodificar(new Uint8Array(bytes))
  // XXE y "billion laughs" entran solo por el DOCTYPE, que un DTE no lleva (spec § 4.1).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok: false, error: NO_ES_DTE }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return { ok: false, error: NO_ES_DTE }
  const raiz = doc.documentElement.localName
  if (raiz !== 'EnvioDTE' && raiz !== 'DTE') return { ok: false, error: NO_ES_DTE }
  const documentos = [...doc.getElementsByTagName('Documento')]
    .map(leerDocumento)
    .filter((d): d is DocumentoDte => d !== null)
  return documentos.length ? { ok: true, documentos } : { ok: false, error: NO_ES_DTE }
}

/** El body de `POST /compras/dte/lectura` (tareas 1–2). Campo por campo, nunca con spread:
 *  el `ValidationPipe` global rechaza con 400 cualquier clave de más (`forbidNonWhitelisted`). */
export function bodyLectura(doc: DocumentoDte, proveedorId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    emisorRut: doc.emisorRut,
    receptorRut: doc.receptorRut,
    tipoDte: doc.tipoDte,
    folio: doc.folio,
    claves: [...new Set(doc.lineas.map(l => l.clave))],
  }
  if (proveedorId) body.proveedorId = proveedorId
  return body
}

/**
 * El descuento de la factura (spec § 3.3): en `$` tal cual, en `%` sobre la
 * suma de `montoItem` de las líneas con el mismo `indExe` que `indExeDR`
 * (ausente calza con ausente), cuantizado a la escala de la moneda. Un
 * recargo no se carga — se avisa con su monto.
 */
export function descuentoDeFactura(
  doc: DocumentoDte,
  decimalesMoneda: number,
): { monto: string | null, avisos: string[] } {
  const avisos: string[] = []
  let monto: Decimal | null = null

  for (const dg of doc.descuentosGlobales) {
    if (dg.tipoMov === 'R') {
      avisos.push(`Recargo de $${dg.valor} no se carga: la compra no tiene recargos`)
      continue
    }
    // Un `ValorDR` que no es un número se salta (con aviso), nunca hace
    // explotar el cálculo del resto de los descuentos (F1, ronda 1).
    const valor = comoDecimal(dg.valor)
    if (!valor) {
      avisos.push('La factura trae un descuento global que no se pudo leer')
      continue
    }
    const montoDescuento = dg.tipoValor === '$'
      ? valor
      : doc.lineas
          .filter(l => l.indExe === dg.indExeDR)
          .reduce((acc, l) => acc.plus(l.montoItem ?? 0), new Decimal(0))
          .times(valor)
          .div(100)
          .toDecimalPlaces(decimalesMoneda, Decimal.ROUND_HALF_UP)
    monto = (monto ?? new Decimal(0)).plus(montoDescuento)
  }

  return { monto: monto ? monto.toFixed() : null, avisos }
}

/** "COCA COLA 350ML CJ12 · 10 CJ · $9.600": lo que la línea muestra de la factura. */
export function textoLinea(linea: LineaDte, formatMonto: (v: string) => string): string {
  const partes = [linea.descripcion]
  // Sin cantidad ni unidad (la línea de FLETE, por ejemplo) no hay "·" colgando.
  if (linea.cantidad && linea.unidadFactura) partes.push(`${linea.cantidad} ${linea.unidadFactura}`)
  if (linea.precioListado) partes.push(formatMonto(linea.precioListado))
  return partes.join(' · ')
}

/**
 * Reparte las líneas de la factura según lo que ya se sabe de sus claves
 * (`asociaciones`, de `POST /compras/dte/lectura`): las marcadas "no es
 * mercadería" quedan apartadas; el resto lleva su destino si lo tiene, o
 * `null` si hay que preguntarle al encargado.
 */
export function repartirLineas(
  doc: DocumentoDte,
  asociaciones: AsociacionDte[],
): {
  lineas: { linea: LineaDte, destino: Exclude<DestinoCodigo, 'no_mercaderia'> | null, nota: string | null }[]
  apartadas: LineaDte[]
} {
  const porClave = new Map(asociaciones.map(a => [a.clave, a]))
  const lineas: { linea: LineaDte, destino: Exclude<DestinoCodigo, 'no_mercaderia'> | null, nota: string | null }[] = []
  const apartadas: LineaDte[] = []

  for (const linea of doc.lineas) {
    const asociacion = porClave.get(linea.clave)
    if (asociacion?.destino === 'no_mercaderia') {
      apartadas.push(linea)
      continue
    }
    lineas.push({
      linea,
      destino: asociacion?.destino ?? null,
      nota: asociacion?.nota ?? null,
    })
  }

  return { lineas, apartadas }
}
