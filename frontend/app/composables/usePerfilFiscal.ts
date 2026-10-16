/**
 * Lo que la pantalla de Boleta electrónica necesita y no es de la pantalla: los tipos de la
 * respuesta de `GET /dte/perfil` (espejo de `PerfilFiscal` en
 * `backend/src/modules/dte/perfil-fiscal.service.ts`), las etiquetas con que se le habla al
 * dueño del local y la lectura de un archivo a base64 para subirlo.
 */

export type AmbienteSii = 'certificacion' | 'produccion'
export type TipoBoleta = 39 | 41

export interface EmisorPerfil {
  razonSocialId: string
  nombre: string
  rut: string
  direccion: string | null
  giro: string | null
  comuna: string | null
  ambiente: AmbienteSii | null
  /** `YYYY-MM-DD`. */
  fechaResolucion: string | null
  numeroResolucion: number | null
}

export interface CertificadoPerfil {
  id: string
  rutFirmante: string
  nombreFirmante: string
  /** Instante ISO. */
  venceEl: string
}

export interface CafPerfil {
  id: string
  tipo: TipoBoleta
  ambiente: AmbienteSii
  desde: number
  hasta: number
  usados: number
  restantes: number
  /** `YYYY-MM-DD`. */
  fechaAutorizacion: string
  idk: number
  /** Solo un CAF sin ningún folio entregado se puede quitar. */
  borrable: boolean
}

export interface Observacion<C extends string = string> {
  codigo: C
  mensaje: string
}

export interface PerfilFiscal {
  emisor: EmisorPerfil | null
  certificado: CertificadoPerfil | null
  cafs: CafPerfil[]
  faltantes: Observacion[]
  avisos: Observacion[]
  /** El interruptor del tenant: ¿cada venta emite su boleta ante el SII? */
  emisionActiva: boolean
}

/** Quién arregla un error de emisión: el perfil de la empresa o esa boleta en particular. */
export type GrupoErrorEmision = 'perfil' | 'boleta'

/** Una fila de `GET /dte/boletas-sin-emitir`; `fecha` es un instante ISO y `monto` un string. */
export interface BoletaSinEmitir {
  ventaId: string
  fecha: string
  monto: string
  codigo: string
  mensaje: string
  grupo: GrupoErrorEmision
}

/**
 * Una fila de `GET /dte/boletas-con-problemas`. Las fechas llegan como instante ISO y el monto
 * como string decimal (nunca `number`); `ventaId`, `monto` y `motivo` pueden venir `null`.
 */
export interface BoletaConProblema {
  documentoId: string
  ventaId: string | null
  tipo: TipoBoleta
  folio: number
  emitidaEl: string
  monto: string | null
  motivo: string | null
}

/** Lo que responde `GET /dte/boletas-con-problemas`: un grupo por cada tipo de observación. */
export interface BoletasConProblemas {
  atrasadas: BoletaConProblema[]
  rechazadas: BoletaConProblema[]
  conReparos: BoletaConProblema[]
}

/** En qué quedó una boleta que el panel de soporte ve: sin acuse del SII todavía, o rechazada. */
export type GrupoProblemaSoporte = 'atrasada' | 'rechazada'

/**
 * Una fila de `GET /admin/dte/boletas-con-problemas` (panel de soporte, todos los locales). A
 * diferencia de `BoletaConProblema`, que es la vista de un local, trae el local y su ambiente.
 * `emitidaEl` es un instante ISO; `detalleSii` viene del SII sin validar, por eso `unknown`.
 */
export interface BoletaConProblemaSoporte {
  documentoId: string
  tenantId: string
  tenant: string
  razonSocial: string | null
  ambiente: string
  tipo: TipoBoleta
  folio: number
  emitidaEl: string
  grupo: GrupoProblemaSoporte
  intentos: number
  ultimoError: string | null
  detalleSii: unknown
  /** Del sobre en que viajó: el motivo de una atrasada `enviado` trabada vive acá, no en la boleta. */
  envioEstadoSii: string | null
  envioUltimoError: string | null
  /** El local se dio de baja, pero sus boletas se siguen enviando: por eso soporte las ve. */
  tenantDadoDeBaja: boolean
}

const ETIQUETA_GRUPO_SOPORTE: Record<GrupoProblemaSoporte, { label: string, color: 'warning' | 'error' }> = {
  atrasada: { label: 'Atrasada', color: 'warning' },
  rechazada: { label: 'Rechazada', color: 'error' },
}

/** El estado de una boleta del panel de soporte: su palabra y el color del `UBadge`. */
export function etiquetaGrupoSoporte(grupo: GrupoProblemaSoporte): { label: string, color: 'warning' | 'error' } {
  return ETIQUETA_GRUPO_SOPORTE[grupo]
}

/** Lo que responde `POST /dte/emitir-pendientes`. */
export interface ResultadoEmitirPendientes {
  emitidas: number
  /** Cuántas siguen sin emitir al terminar, también las que esta llamada no alcanzó. */
  pendientes: number
  errores: { ventaId: string, codigo: string, mensaje: string }[]
}

/**
 * Lo que dice el interruptor cuando falta algo: el mismo texto que el servidor pone en el 400 al
 * prender con faltantes (`cambiarEmision`), para que la pantalla y el error no se contradigan.
 */
export function textoParaEmitir(faltantes: Observacion[]): string {
  return 'Para emitir falta: ' + faltantes.map(f => f.mensaje).join('; ')
}

/** Qué puede hacer el admin con una boleta sin emitir, según quién arregla el error. */
export function pistaDelGrupo(grupo: GrupoErrorEmision): string {
  return grupo === 'perfil'
    ? 'Se arregla en el perfil (o con soporte, si el motivo lo dice); después, emítelas con el botón.'
    : 'No se puede emitir.'
}

/** El aviso tras "Emitir pendientes": cuántas salieron y, si quedan, cuántas siguen sin emitir. */
export function resumenEmision(r: ResultadoEmitirPendientes): {
  titulo: string
  detalle: string | null
  color: 'success' | 'warning'
} {
  return {
    titulo: `${r.emitidas} ${r.emitidas === 1 ? 'emitida' : 'emitidas'}`,
    detalle: r.pendientes > 0 ? `Siguen sin emitir: ${r.pendientes}` : null,
    color: r.errores.length > 0 || r.pendientes > 0 ? 'warning' : 'success',
  }
}

const ETIQUETA_TIPO: Record<TipoBoleta, string> = {
  39: 'Boleta (39)',
  41: 'Boleta exenta (41)',
}

// Se llama `...Boleta` porque `etiquetaTipo` ya existe en `useDocumentosVenta` (otra cosa) y los
// dos se auto-importan: con el mismo nombre ganaba uno en silencio.
export function etiquetaTipoBoleta(tipo: TipoBoleta): string {
  return ETIQUETA_TIPO[tipo]
}

const ETIQUETA_TIPO_CORTA: Record<TipoBoleta, string> = {
  39: 'Afecta',
  41: 'Exenta',
}

/**
 * El tipo en una sola palabra, para la columna "Tipo" de una tabla de boletas ya identificadas por
 * su folio. Se distingue de `etiquetaTipoBoleta` ("Boleta (39)", "Boleta exenta (41)"), que nombra
 * el documento entero con su código del SII y sirve donde el tipo es el sujeto (folios, avisos).
 */
export function etiquetaTipoCorta(tipo: TipoBoleta): string {
  return ETIQUETA_TIPO_CORTA[tipo]
}

const ETIQUETA_AMBIENTE: Record<AmbienteSii, string> = {
  certificacion: 'Certificación (pruebas)',
  produccion: 'Producción',
}

export function etiquetaAmbiente(ambiente: AmbienteSii): string {
  return ETIQUETA_AMBIENTE[ambiente]
}

/**
 * `DD-MM-AAAA`. Un día sin hora (`2027-03-15`) solo se da vuelta: pasarlo por `Date` lo
 * correría de día según la zona. Un instante (el vencimiento del certificado) se muestra en
 * el día de Chile, que es el que ve el dueño en su calendario.
 */
export function formatoFecha(valor: string): string {
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (dia) return `${dia[3]}-${dia[2]}-${dia[1]}`
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(valor))
  const de = (tipo: string) => partes.find(p => p.type === tipo)?.value
  return `${de('day')}-${de('month')}-${de('year')}`
}

/** Trozo de `String.fromCharCode`: con miles de argumentos de una sola vez revienta la pila. */
const TROZO = 0x8000

/**
 * Los bytes del archivo en base64, sin decodificar texto. El CAF es ISO-8859-1: leerlo como
 * UTF-8 cambiaría la Ñ por U+FFFD y el backend rechaza el archivo (o, peor, firmaría otros
 * bytes que los del SII).
 */
export async function archivoABase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binario = ''
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO))
  }
  return btoa(binario)
}
