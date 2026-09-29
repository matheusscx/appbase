import Decimal from 'decimal.js';
import {
  cuantizar,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';

/**
 * El plazo de pago cuando el proveedor no tiene uno cargado (spec
 * compras-deuda-proveedor § 2, decisión 4). Es el default de la propia ley
 * (19.983, art. 2, texto de la ley 21.131): "se entenderá que debe ser
 * pagada dentro de los treinta días corridos siguientes a la recepción de
 * la factura".
 */
export const PLAZO_PAGO_DIAS_DEFAULT = 30;

/**
 * `fecha + días`, en aritmética de calendario (sin zona horaria: es una
 * fecha pura `YYYY-MM-DD`, no un instante). `Date.UTC` evita que la resta de
 * huso horario del entorno corra la fecha un día.
 */
export function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * El vencimiento de una compra (spec § 4.2): la fecha tipeada (o la del XML,
 * `FchVenc`) manda; si no hay, `fecha_documento + plazo` — el plazo del
 * proveedor, o `PLAZO_PAGO_DIAS_DEFAULT` si no tiene uno cargado.
 *
 * Por qué desde `fechaDocumento` y no desde la recepción: la compra no
 * guarda cuándo llegó la factura, y como la recepción nunca es anterior a la
 * emisión, el vencimiento calculado cae el mismo día o antes que el legal
 * (spec § 2, "Los 30 días, verificados contra el texto legal").
 */
export function vencimiento(
  fechaDocumento: string,
  plazoPagoDias: number | null,
  fechaTipeada?: string | null,
): string {
  if (fechaTipeada) return fechaTipeada;
  return sumarDias(fechaDocumento, plazoPagoDias ?? PLAZO_PAGO_DIAS_DEFAULT);
}

/**
 * El total de una compra `suma_lineas` (spec § 4.1 y § 14): Σ cantidad ×
 * precio − descuento, cuantizado UNA sola vez a la escala de la moneda
 * oficial del tenant, con `cuantizar` del motor de precios (importada, no
 * modificada) — es la única cuantización de esta pieza. `null` si no hay
 * líneas o falta el precio de alguna: ahí el total es desconocido.
 *
 * Los tipos `obligatorio`/`opcional` no pasan por acá: su total es el
 * transcrito (`compras.total_documento`), tal cual (decisión 10).
 */
export function totalCompra(
  lineas: { cantidad: string; precioUnitario: string | null }[],
  descuentoTotal: string | null,
  cfg: ConfigCalculo,
): string | null {
  if (!lineas.length || lineas.some((l) => l.precioUnitario == null)) {
    return null;
  }
  const bruto = lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(l.precioUnitario!)),
    new Decimal(0),
  );
  const neto = bruto.minus(descuentoTotal ?? 0);
  return cuantizar(neto, cfg).toString();
}

/** El saldo a favor de un pago vigente, disponible para fondear otro. */
export interface FuenteSaldo {
  pagoId: string;
  /** > 0: un pago sin saldo no se pasa acá. */
  disponible: string;
}

/** Lo que el reparto pidió para una compra (spec § 5.1). */
export interface AplicacionSolicitada {
  compraId: string;
  monto: string;
}

/**
 * Una porción de una aplicación, financiada por UN pago. Una aplicación del
 * request puede salir partida en varias partes si ninguna fuente sola la
 * cubre entera (spec § 3: "las aplicaciones no se editan" — cada parte es la
 * fila que se inserta en `pago_proveedor_aplicaciones`).
 */
export interface ParteAplicacion {
  compraId: string;
  pagoId: string;
  monto: string;
}

/**
 * Reparte las aplicaciones pedidas entre las fuentes de plata disponibles, en
 * el orden que manda la spec § 5.1: **el saldo a favor primero** (sus pagos
 * más viejos primero — `saldoAFavor` ya viene en ese orden, el llamador lo
 * arma así), **y recién después el pago nuevo**. Las aplicaciones se procesan
 * en el orden en que vienen (la propuesta de la pantalla, la más vieja
 * primero — spec § 5.1), cada una consumiendo fuentes hasta completarse.
 *
 * Función PURA: no valida topes de negocio (que el total pedido no supere lo
 * disponible, que una aplicación no supere la deuda de su compra) — eso lo
 * hace el service ANTES de llamarla, con lo que lee de la base bajo lock.
 * Acá solo se sostiene la aritmética: si las fuentes no alcanzan para lo
 * pedido, revienta — señal de que el caller no validó, no un caso de negocio.
 */
export function fondear(
  aplicaciones: AplicacionSolicitada[],
  /** Más viejo primero. */
  saldoAFavor: FuenteSaldo[],
  montoNuevo: string,
  /** El id (pre-generado) del pago que se está creando; `sobranteNuevo` es lo que le queda a favor. */
  pagoNuevoId: string,
): { partes: ParteAplicacion[]; sobranteNuevo: string } {
  const fuentes = [
    ...saldoAFavor.map((f) => ({
      pagoId: f.pagoId,
      disponible: new Decimal(f.disponible),
    })),
    { pagoId: pagoNuevoId, disponible: new Decimal(montoNuevo) },
  ];

  const partes: ParteAplicacion[] = [];
  for (const aplicacion of aplicaciones) {
    let faltante = new Decimal(aplicacion.monto);
    for (const fuente of fuentes) {
      if (faltante.lte(0)) break;
      if (fuente.disponible.lte(0)) continue;
      const toma = Decimal.min(faltante, fuente.disponible);
      fuente.disponible = fuente.disponible.minus(toma);
      faltante = faltante.minus(toma);
      partes.push({
        compraId: aplicacion.compraId,
        pagoId: fuente.pagoId,
        monto: toma.toString(),
      });
    }
    if (faltante.gt(0)) {
      throw new Error(
        `fondear: falta ${faltante.toString()} para cubrir la aplicación de ${aplicacion.compraId} — el caller no validó el total disponible`,
      );
    }
  }

  const nuevo = fuentes[fuentes.length - 1];
  return { partes, sobranteNuevo: nuevo.disponible.toString() };
}

/** Una aplicación viva de un pago a la compra que se está recortando. */
export interface AplicacionViva {
  aplicacionId: string;
  pagoId: string;
  monto: string;
  /** Para ordenar "de la más nueva a la más vieja" (spec § 6). */
  creadoEl: Date;
}

/**
 * Lo que hay que escribir para dejar el aplicado de una compra en
 * `totalNuevo` (spec § 6). Nunca `UPDATE` del monto (Global Constraints,
 * plan): `aBorrar` son aplicaciones que se borran enteras, `aReducir` son
 * las que se borran y se reinsertan por el resto — el caller hace las dos
 * cosas con `eliminado_el` + `INSERT`, esta función solo decide los montos.
 */
export interface RecorteResultado {
  aBorrar: string[];
  aReducir: { aplicacionId: string; pagoId: string; montoNuevo: string }[];
}

/**
 * Recorta las aplicaciones vivas de una compra hasta que lo aplicado no
 * supere `totalNuevo` (spec § 6): de la MÁS NUEVA a la más vieja — la
 * primera pagada es la que menos se toca, porque es la que el proveedor
 * espera ver liquidada. El sobrante de cada aplicación tocada vuelve a su
 * pago como saldo a favor (decisiones 5 y 8): esta función no lo escribe
 * directamente, alcanza con dejar de contarlo como aplicado —
 * `saldoAFavorLockeado` ya lo calcula solo como `monto − aplicaciones vivas`.
 *
 * `anular` reusa esta misma función con `totalNuevo = '0'` (decisión 6b):
 * anular dice "esta compra no debe nada", y recortar hasta 0 es EXACTAMENTE
 * "toda aplicación viva se borra, todo vuelve a favor" — no hace falta un
 * camino aparte.
 *
 * Función PURA: no toca la base ni valida nada de negocio. Si el aplicado ya
 * no supera `totalNuevo` (el total subió, o nunca hubo pagos), no hay nada
 * que tocar y devuelve las dos listas vacías.
 */
export function recortar(
  aplicacionesVivas: AplicacionViva[],
  totalNuevo: string,
): RecorteResultado {
  const total = new Decimal(totalNuevo);
  const ordenadas = [...aplicacionesVivas].sort(
    (a, b) => b.creadoEl.getTime() - a.creadoEl.getTime(),
  );
  let aplicado = ordenadas.reduce(
    (acc, a) => acc.plus(a.monto),
    new Decimal(0),
  );

  const aBorrar: string[] = [];
  const aReducir: {
    aplicacionId: string;
    pagoId: string;
    montoNuevo: string;
  }[] = [];
  for (const a of ordenadas) {
    if (aplicado.lte(total)) break;
    const exceso = aplicado.minus(total);
    const monto = new Decimal(a.monto);
    if (exceso.gte(monto)) {
      aBorrar.push(a.aplicacionId);
      aplicado = aplicado.minus(monto);
    } else {
      aReducir.push({
        aplicacionId: a.aplicacionId,
        pagoId: a.pagoId,
        montoNuevo: monto.minus(exceso).toString(),
      });
      aplicado = aplicado.minus(exceso);
    }
  }
  return { aBorrar, aReducir };
}

/** Spec § 4.1: los cinco estados derivados (nunca guardados). */
export type EstadoPagoCompra =
  | 'pagada'
  | 'parcial'
  | 'pendiente'
  | 'falta_total'
  | 'falta_precio';

export interface EstadoPagoResultado {
  estadoPago: EstadoPagoCompra;
  /** `total − aplicado`, nunca negativa; `null` si el total es desconocido. */
  deuda: string | null;
  /** Con deuda (o total desconocido) Y `fechaVencimiento < hoy` (spec § 4.1). */
  vencida: boolean;
}

/**
 * El estado de pago de UNA compra confirmada (spec § 4.1): `pagada` (deuda
 * 0), `parcial` (aplicado > 0 y deuda > 0), `pendiente` (sin aplicado); con
 * total desconocido, `falta_total` (`obligatorio`/`opcional` sin transcribir)
 * o `falta_precio` (`suma_lineas` con alguna línea sin precio) — encima,
 * `vencida` si queda deuda (o el total ni se sabe) y ya pasó el vencimiento.
 *
 * `hoy` y `fechaVencimiento` llegan como fecha pura (`YYYY-MM-DD`): comparar
 * como STRING alcanza porque el formato es fijo-ancho y ordena igual que la
 * fecha (mismo truco que el resto del módulo evita reimplementar con `Date`).
 *
 * Función PURA: el llamador ya filtró que la compra esté `confirmada` (spec
 * § 4.1: "solo cuentan las compras confirmada") y ya resolvió `hoy` con la
 * zona del tenant (`rango-fecha.util.ts`).
 */
export function estadoPagoCompra(params: {
  total: string | null;
  aplicado: string;
  fechaVencimiento: string | null;
  hoy: string;
  /** `false` en un tipo `obligatorio`/`opcional` (decisión 10). */
  esSumaLineas: boolean;
}): EstadoPagoResultado {
  const yaVencio =
    params.fechaVencimiento != null && params.fechaVencimiento < params.hoy;

  if (params.total == null) {
    return {
      estadoPago: params.esSumaLineas ? 'falta_precio' : 'falta_total',
      deuda: null,
      vencida: yaVencio,
    };
  }

  const deuda = Decimal.max(
    0,
    new Decimal(params.total).minus(params.aplicado),
  );
  const estadoPago: EstadoPagoCompra = deuda.isZero()
    ? 'pagada'
    : new Decimal(params.aplicado).gt(0)
      ? 'parcial'
      : 'pendiente';
  return {
    estadoPago,
    deuda: deuda.toString(),
    vencida: deuda.gt(0) && yaVencio,
  };
}
