/**
 * Los documentos de una venta tal como los muestra la pantalla (spec
 * `2026-10-01-emision-por-venta`, § 3.4). Espejo de `DocumentoDetalle` del
 * backend (`venta-documentos.service.ts`): **la pantalla solo los muestra**.
 * Quién emitió cada uno, y si la venta se puede anular, lo decide el servidor.
 */

/** Quién emite lo cobrado con un medio (`tenant_metodo_pago.emisor`). */
export type EmisorMedio = 'sistema' | 'maquina' | 'nadie'
/** Un documento suma a los tres el `externo`: lo hizo el comercio en otro facturador. */
export type EmisorDocumento = EmisorMedio | 'externo'
/** Lo que la máquina de tarjeta emitió: el voucher o su propia boleta. */
export type ClaseDocumentoMaquina = 'voucher' | 'boleta'
/** Por qué un documento dejó de valer al anular la venta. */
export type DescarteDocumento = 'armado_sin_enviar' | 'afirmado_no_hecho'

/** Un borrado del número de un documento hecho por fuera: qué decía, quién lo borró y cuándo. */
export interface NumeroBorradoVenta {
  numeroAnterior: string
  borradoEl: string
  /** Puede faltar si la cuenta se dio de baja después. */
  borradoPorNombre: string | null
}

export interface DocumentoVenta {
  id: string
  /**
   * La venta **o la corrección** a la que pertenece el documento. Es el id de la
   * ruta del `PATCH`: el documento de una nota de crédito es de la nota, no de la
   * venta original que se está mirando.
   */
  ventaId: string
  emisor: EmisorDocumento
  tipoDocumento: { id: string, codigo: string | null, nombre: string } | null
  claseMaquina: ClaseDocumentoMaquina | null
  numero: string | null
  estadoEnvio: 'armado' | 'enviado' | null
  monto: string
  pagoId: string | null
  documentoCorregidoId: string | null
  esDuplicado: boolean
  descarte: DescarteDocumento | null
  descartadoEl: string | null
  descartadoPorNombre: string | null
  /** Cada borrado del número, el más nuevo primero; vacío si nunca se borró. */
  numerosBorrados: NumeroBorradoVenta[]
}

/** Mismo tope que `numeroDocumento` en los DTO de cobro y que `numero` del `PATCH`. */
export const NUMERO_DOCUMENTO_MAX = 40

/** Las dos clases que la máquina puede emitir, como las ofrece el selector. */
export const CLASES_MAQUINA_ITEMS: { label: string, value: ClaseDocumentoMaquina }[] = [
  { label: 'Es voucher', value: 'voucher' },
  { label: 'Es boleta de la máquina', value: 'boleta' },
]

const ETIQUETA_EMISOR: Record<EmisorDocumento, string> = {
  sistema: 'El sistema',
  maquina: 'La máquina',
  externo: 'Hecho por fuera',
  nadie: 'Nadie',
}

const ETIQUETA_CLASE: Record<ClaseDocumentoMaquina, string> = {
  voucher: 'Voucher',
  boleta: 'Boleta de la máquina',
}

/** Quién lo emitió. Un valor que este front no conoce se muestra crudo, no rompe. */
export function etiquetaEmisor(emisor: string): string {
  return (ETIQUETA_EMISOR as Record<string, string | undefined>)[emisor] ?? emisor
}

/** La clase de lo que emitió la máquina; `null` si el cajero no la indicó. */
export function etiquetaClase(clase: string | null): string | null {
  if (!clase) return null
  return (ETIQUETA_CLASE as Record<string, string | undefined>)[clase] ?? clase
}

/**
 * El tipo o la clase del documento: con la máquina es la clase (si se indicó),
 * con el sistema o por fuera es el tipo del catálogo (boleta, factura, nota de
 * crédito). Una fila `nadie` no es un documento: es la constancia de que no hay.
 */
export function etiquetaTipo(doc: DocumentoVenta): string {
  // La fila `nadie` de una corrección es la devolución interna: la constancia de
  // que se devolvió sin documento tributario.
  if (doc.emisor === 'nadie') return doc.documentoCorregidoId ? 'Devolución interna' : 'Sin documento'
  if (doc.emisor === 'maquina') return etiquetaClase(doc.claseMaquina) ?? 'Comprobante'
  return doc.tipoDocumento?.nombre ?? 'Documento'
}

/**
 * El número solo existe para lo que emite alguien de afuera (la máquina o el otro
 * facturador). El sistema todavía no folia, y una fila `nadie` no tiene.
 */
export function llevaNumero(doc: DocumentoVenta): boolean {
  return doc.emisor === 'maquina' || doc.emisor === 'externo'
}

/**
 * La línea de estado de un documento que ya no vale o que todavía no salió. Un
 * descartado manda sobre cualquier otro estado.
 */
export function estadoDocumento(doc: DocumentoVenta): string | null {
  if (doc.descarte) return 'Descartado al anular'
  if (doc.emisor === 'sistema') {
    return doc.estadoEnvio === 'enviado' ? 'Enviado al SII' : 'Armado, sin enviar al SII'
  }
  return null
}

/**
 * Quién afirmó que no estaba hecho (E10): el único registro de esa respuesta.
 * `fecha` llega ya formateada; el nombre puede faltar si la cuenta se borró.
 */
export function leyendaDescarte(doc: DocumentoVenta, fecha: string): string | null {
  if (doc.descarte !== 'afirmado_no_hecho') return null
  return `${doc.descartadoPorNombre ?? 'Alguien'} dijo que no estaba hecho, ${fecha}`
}

/**
 * ¿Ofrece "Completar número"? Los de la máquina y los hechos por fuera que no
 * lo tienen y siguen vigentes (el backend responde 404 a uno descartado). El
 * voucher duplicado del abono también: es de la máquina.
 *
 * Es el único lugar que lo decide. Borrar un número ya anotado es otra acción
 * (`puedeBorrarNumero`, con su propio permiso).
 */
export function puedeCompletarNumero(doc: DocumentoVenta): boolean {
  return llevaNumero(doc) && doc.descarte === null && !doc.numero
}

/**
 * ¿Ofrece "Borrar número"? Solo el documento hecho por fuera que tiene número y
 * sigue vigente: es lo que el backend acepta (404 con cualquier otro, 400 sin
 * número). El permiso (`Ventas:Anular`) lo agrega quien lo pinta.
 *
 * Un número en blanco no cuenta como número: es el mismo criterio con el que el
 * backend decide si anular pregunta o va por nota de crédito.
 */
export function puedeBorrarNumero(doc: DocumentoVenta): boolean {
  return doc.emisor === 'externo' && doc.descarte === null && !!doc.numero?.trim()
}

/** "Ana Torres borró el número F-4471, 2 oct 2026": el registro de un borrado. `fecha` llega formateada. */
export function leyendaNumeroBorrado(borrado: NumeroBorradoVenta, fecha: string): string {
  return `${borrado.borradoPorNombre ?? 'Alguien'} borró el número ${borrado.numeroAnterior}, ${fecha}`
}

/** El body que el `PATCH` espera: la `clase` solo viaja con la máquina y si se eligió. */
export function cuerpoCompletarNumero(
  doc: DocumentoVenta,
  numero: string,
  clase: ClaseDocumentoMaquina | null | undefined,
): { numero: string, clase?: ClaseDocumentoMaquina } {
  return {
    numero: numero.trim(),
    ...(doc.emisor === 'maquina' && clase ? { clase } : {}),
  }
}

/**
 * Lo que un pago agrega al body del cobro: el número y la clase **solo si el
 * medio emite con la máquina** y el cajero los tipeó. Un número tipeado antes de
 * cambiar de medio no viaja: quedaría pegado a un pago que ninguna máquina emite.
 * Ausente es "sin número" (en el cobro no se manda vacío).
 */
export function comprobanteDelPago(
  emisor: EmisorMedio | undefined,
  numeroDocumento: string | undefined,
  claseDocumento: ClaseDocumentoMaquina | undefined,
): { numeroDocumento?: string, claseDocumento?: ClaseDocumentoMaquina } {
  if (emisor !== 'maquina') return {}
  const numero = numeroDocumento?.trim()
  return {
    ...(numero ? { numeroDocumento: numero } : {}),
    ...(claseDocumento ? { claseDocumento } : {}),
  }
}

/**
 * Cómo se nombra el documento hecho por fuera en "¿Ya hiciste … en tu
 * facturador?": "esta factura", o "este documento" si el tipo de la venta es una
 * boleta. `esBoleta` lo manda el backend (`tipoDocumento.esBoleta` del detalle,
 * leído del catálogo): la pantalla no lo deduce del nombre ni del código.
 */
export function documentoPreguntado(esBoleta: boolean | null | undefined): string {
  return esBoleta === true ? 'este documento' : 'esta factura'
}

/**
 * Qué corrige una corrección (nota de crédito o devolución): el documento al que
 * apunta, dicho como se lista. Si el corregido no vino en la lista, se dice igual
 * que corrige otro.
 */
export function leyendaCorrige(doc: DocumentoVenta, todos: DocumentoVenta[]): string | null {
  if (!doc.documentoCorregidoId) return null
  const corregido = todos.find(d => d.id === doc.documentoCorregidoId)
  if (!corregido) return 'Corrige otro documento'
  const numero = corregido.numero ? ` · N° ${corregido.numero}` : ''
  return `Corrige: ${etiquetaEmisor(corregido.emisor)} · ${etiquetaTipo(corregido)}${numero}`
}

/**
 * Lo que una corrección deja registrado según el documento que corrige (spec
 * § 3.6). Espejo de `RegistroCorreccion` del backend: lo calcula el servidor.
 */
export type RegistroCorreccion
  = | 'nota_credito_sistema'
    | 'nota_maquina'
    | 'nota_externa'
    | 'devolucion_interna'
    | 'nota_credito'

/**
 * Una forma de devolver la plata, tal como la publica `GET /ventas/:id`
 * (`opcionesDevolucion`): una por pago que puede recibir la devolución, y "No
 * vuelve plata" (`sinPlata`) solo si la venta tiene saldo. **La pantalla no
 * decide qué documento corrige**: lo dice `registro`, que sale de la misma
 * resolución que usa el servidor al crear la nota.
 */
export interface OpcionDevolucion {
  /** El pago de la venta a corregir; `null` en "No vuelve plata". */
  pagoId: string | null
  sinPlata: boolean
  /** Nombre del medio de pago; `null` en "No vuelve plata". */
  metodo: string | null
  /** Lo que ese pago cubrió de la venta, o el saldo en "No vuelve plata". */
  monto: string
  /** La plata sale de la caja física (el pago fue en efectivo). */
  mueveCaja: boolean
  registro: RegistroCorreccion
}

/** La clave de una opción en el selector: el pago, o la de "No vuelve plata". */
export function claveOpcion(o: OpcionDevolucion): string {
  return o.sinPlata ? 'sin-plata' : (o.pagoId ?? '')
}

const REGISTRO_QUE_QUEDA: Record<RegistroCorreccion, string> = {
  nota_credito_sistema: 'Una nota de crédito, armada por el sistema.',
  nota_maquina: 'Una nota de crédito de la máquina: se hace en la máquina y se anota después.',
  nota_externa: 'Una nota de crédito hecha por fuera, en tu otro facturador: se anota después.',
  devolucion_interna: 'Una devolución interna: queda anotada en el sistema, sin documento tributario.',
  nota_credito: 'Una nota de crédito.',
}

/** "Va a quedar: …" — el registro que deja la opción elegida, en una línea. */
export function registroQueQueda(registro: string): string {
  return (REGISTRO_QUE_QUEDA as Record<string, string | undefined>)[registro] ?? 'Una corrección de la venta.'
}

/**
 * El `devolucion` del body de la nota: el pago, o "no vuelve plata". Es lo único
 * que el cliente manda sobre el documento: el servidor resuelve cuál corrige y
 * valida que el pago sea de esa venta.
 */
export function cuerpoDevolucion(o: OpcionDevolucion): { pagoId: string } | { sinPlata: true } {
  if (o.sinPlata) return { sinPlata: true }
  if (!o.pagoId) throw new Error('Una opción de devolución sin pago ni "no vuelve plata"')
  return { pagoId: o.pagoId }
}
