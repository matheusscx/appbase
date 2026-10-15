import type { EstadoDocumentoDte } from './entities/dte-documento.entity';
import type { EstadoEnvioSii } from './sii-boleta.cliente';

/**
 * Estados del envío con los que el SII ya no cambia de opinión (spec cola-envio-sii § 6). Es la
 * única fuente: el job la pasa a las consultas y a la anotación, y no la repite.
 */
export const ESTADOS_ENVIO_FINALES: readonly string[] = [
  'EPR',
  'RPR',
  'RCH',
  'RCO',
  'RFR',
  'RSC',
  'RCT',
  'VOF',
  'RPT',
];

/** El SII ya tenía este sobre: el envío termina, y las boletas no cambian de estado. */
export const ESTADO_ENVIO_REPETIDO = 'RPT';

/** Estados del envío que siguen en proceso: se vuelve a consultar y no hay nada que avisar. */
const EN_PROCESO = ['REC', 'SOK', 'FOK', 'CRT', 'PRD'];

/** Rechazos del sobre entero: ninguna de sus boletas se pudo ni leer. */
const RECHAZOS_DEL_SOBRE = ['RCH', 'RCO', 'RFR', 'RSC', 'RCT', 'VOF'];

export interface BoletaDelSobre {
  documentoId: string;
  tipo: number;
  folio: number;
}

export interface CambioBoleta {
  documentoId: string;
  estado: Extract<EstadoDocumentoDte, 'aceptado' | 'reparos' | 'rechazado'>;
  /** Lo que el SII dijo de esta boleta; null si la aceptó sin comentarios. */
  detalleSii: unknown;
}

type EntradaDetalle = NonNullable<EstadoEnvioSii['detalle_rep_rech']>[number];

export interface ResultadoReparto {
  final: boolean;
  cambios: CambioBoleta[];
  /**
   * Lo que el SII dijo y no se pudo repartir (un código que no es `RCH` ni `RPR`, o una entrada
   * que no calza con ninguna boleta del sobre), en palabras para el dueño del local. El job lo
   * deja en `ultimo_error` del envío para que no se pierda en silencio.
   */
  observaciones: string[];
}

/**
 * Reparte lo que el SII contestó sobre un sobre entre las boletas que llevaba. Pura: no toca la
 * base ni el reloj, así que cada fila de la tabla de la spec § 6 se prueba sin infraestructura.
 *
 * El reparto es por `(tipo, folio)`, nunca solo por folio: una boleta 39 y una 41 pueden llevar
 * el mismo folio. Una entrada con `folio` ausente o null (error de esquema o de firma) alcanza a
 * todas las boletas del sobre. La respuesta del SII llega sin validar, así que `folio` y `tipo`
 * pueden venir ausentes o como texto: se comparan como número.
 *
 * Por boleta: una entrada `RCH` la deja `rechazado` (gana sobre cualquier otra), una `RPR`
 * `reparos`, y ninguna `aceptado`. Una entrada con otro código NO es un reparo (reparos es
 * "aceptada con observaciones"): la boleta queda sin cambio, atrasada a la vista, y el código
 * sale en `observaciones` para revisión.
 *
 * `aceptado` por ausencia de entrada solo vale cuando TODAS las entradas calzaron con una
 * boleta y son `RCH` o `RPR`. Si hay cualquier observación (una entrada sin boleta, un código
 * desconocido, un `detalle_rep_rech` que no es una lista), el SII dijo algo que no sabemos
 * leer: callar no es aprobar, así que las boletas sin entrada propia quedan sin cambio. Las que
 * sí tienen una entrada `RCH`/`RPR` se reparten igual.
 *
 * Un código del sobre que no es ninguno de los que conocemos se sigue consultando, y avisa en
 * `observaciones` para no quedar en silencio.
 */
export function repartirResultado(
  estado: EstadoEnvioSii,
  boletas: BoletaDelSobre[],
): ResultadoReparto {
  const codigo = estado.estado;

  if (codigo === 'EPR' || codigo === 'RPR') {
    const detalle: unknown = estado.detalle_rep_rech;
    const entradas = Array.isArray(detalle)
      ? (detalle as EntradaDetalle[])
      : [];
    const observaciones = observar(entradas, boletas);
    // Presente pero no es una lista: no se puede leer, y no es lo mismo que "sin detalle".
    if (detalle !== undefined && detalle !== null && !Array.isArray(detalle))
      observaciones.push(
        'El SII mandó el detalle de las boletas en un formato que no se entiende; revisar',
      );
    const cambios: CambioBoleta[] = [];
    for (const b of boletas) {
      const cambio = cambioDe(
        b,
        entradas.filter((e) => calza(e, b)),
        observaciones.length > 0,
      );
      if (cambio) cambios.push(cambio);
    }
    return { final: true, cambios, observaciones };
  }

  if (RECHAZOS_DEL_SOBRE.includes(codigo)) {
    return {
      final: true,
      cambios: boletas.map((b) => ({
        documentoId: b.documentoId,
        estado: 'rechazado',
        detalleSii: {
          origen: 'sobre',
          estado: codigo,
          descripcion: descripcionDelSobre(estado),
        },
      })),
      observaciones: [],
    };
  }

  // `RPT` termina el envío sin tocar las boletas; `REC`, `SOK`, `FOK`, `CRT`, `PRD` y cualquier
  // código que no conocemos se vuelven a consultar: un código nuevo del SII no puede dar por
  // aceptada ni por rechazada una boleta. El desconocido, además, avisa.
  const conocido =
    codigo === ESTADO_ENVIO_REPETIDO || EN_PROCESO.includes(codigo);
  return {
    final: codigo === ESTADO_ENVIO_REPETIDO,
    cambios: [],
    observaciones: conocido
      ? []
      : [
          `El SII devolvió el código ${String(codigo).slice(0, 20)}; se sigue consultando`,
        ],
  };
}

/** Número, o null si el SII no lo mandó (ausente, null o vacío). Texto numérico vale como número. */
function numeroDe(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  return Number(valor);
}

function calza(e: EntradaDetalle, b: BoletaDelSobre): boolean {
  const folio = numeroDe(e.folio);
  if (folio === null) return true;
  const tipo = numeroDe(e.tipo);
  return folio === b.folio && (tipo === null || tipo === b.tipo);
}

/** `null` deja la boleta como está: las entradas que le tocan no son ni `RCH` ni `RPR`. */
function cambioDe(
  boleta: BoletaDelSobre,
  suyas: EntradaDetalle[],
  hayObservaciones: boolean,
): CambioBoleta | null {
  // Si hay más de una, manda la peor. El detalle completo queda en `respuesta_sii` del envío.
  const rechazo = suyas.find((e) => e.estado === 'RCH');
  const reparo = suyas.find((e) => e.estado === 'RPR');
  const entrada = rechazo ?? reparo;
  if (entrada)
    return {
      documentoId: boleta.documentoId,
      estado: rechazo ? 'rechazado' : 'reparos',
      detalleSii: entrada,
    };
  // Sin entrada propia, pero con algo que no se pudo leer en el resto: no se acepta por silencio.
  if (suyas.length > 0 || hayObservaciones) return null;
  return {
    documentoId: boleta.documentoId,
    estado: 'aceptado',
    detalleSii: null,
  };
}

function observar(
  entradas: EntradaDetalle[],
  boletas: BoletaDelSobre[],
): string[] {
  const observaciones: string[] = [];
  for (const e of entradas) {
    const de = `tipo ${String(e.tipo)}, folio ${String(e.folio)}`;
    if (e.estado !== 'RCH' && e.estado !== 'RPR')
      observaciones.push(
        `El SII devolvió un código desconocido (${String(e.estado)}) para la boleta ${de}; revisar`,
      );
    else if (!boletas.some((b) => calza(e, b)))
      observaciones.push(
        `El SII informó ${e.estado} para la boleta ${de}, que no está en el envío; revisar`,
      );
  }
  return observaciones;
}

/**
 * La glosa del rechazo, si el SII la manda junto al código. El tipo del cliente no la declara
 * (el OpenAPI no la garantiza), así que se lee sin suponerla: sin glosa queda solo el código.
 */
function descripcionDelSobre(
  estado: EstadoEnvioSii & { descripcion?: unknown },
): string | null {
  return typeof estado.descripcion === 'string' ? estado.descripcion : null;
}
