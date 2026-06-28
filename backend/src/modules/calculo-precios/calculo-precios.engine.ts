import Decimal from 'decimal.js';

/**
 * Motor de cálculo de precios — núcleo PURO (sin BD, sin NestJS).
 *
 * Recibe una venta ya "resuelta" (ítems, reglas e impuestos cargados desde la
 * capa de servicio) y devuelve el desglose de precio respetando la
 * configuración financiera del tenant: orden de fórmula, base|compuesto,
 * escala de cálculo y modo de redondeo. Toda la aritmética usa Decimal.js.
 *
 * Reglas evaluadas en esta fase: valor plano (% o monto fijo), tramos
 * (`por_mayor` por cantidad, `por_monto_venta` por monto) y filtro por método
 * de pago. Las reglas por fecha/vencimiento quedan modeladas pero NO se
 * evalúan todavía (ver DIFERIDAS).
 */

// ── Tipos de entrada (estructura resuelta) ──────────────────────────────────

export type ModoRegla = 'porcentaje' | 'monto_fijo';

export interface ReglaResuelta {
  id: string;
  nombre: string;
  /** `tipos_regla.codigo` — determina la estrategia de evaluación. */
  codigo: string | null;
  modo: ModoRegla;
  /** Decimal en string; null cuando la regla usa tramos. */
  valor: string | null;
  tramos: { minimo: string; valor: string }[];
  metodoPagoIds: string[];
}

export interface ImpuestoResuelto {
  id: string;
  nombre: string;
  /** Porcentaje en decimal (0.19 = 19%). */
  porcentaje: string;
}

export interface LineaResuelta {
  itemId: string;
  cantidad: string;
  /** Precio unitario ya resuelto (override o precio_base del ítem). */
  precioUnitario: string;
  precioIncluyeImpuesto: boolean;
  descuentos: ReglaResuelta[];
  recargos: ReglaResuelta[];
  impuestos: ImpuestoResuelto[];
}

export interface ConfigCalculo {
  /** Orden de los tres pasos, p.ej. ['descuentos','recargos','impuestos']. */
  formula: string[];
  calculoDescuentos: string; // 'base' | 'compuesto'
  calculoRecargos: string; // 'base' | 'compuesto'
  escalaCalculo: number;
  modoRedondeo: string; // 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL'
}

export interface VentaResuelta {
  lineas: LineaResuelta[];
  metodoPagoId: string | null;
  descuentosVenta: ReglaResuelta[];
  recargosVenta: ReglaResuelta[];
  config: ConfigCalculo;
}

// ── Tipos de salida ─────────────────────────────────────────────────────────

export interface TrazaRegla {
  id: string;
  nombre: string;
  monto: string;
}
export interface TrazaImpuesto extends TrazaRegla {
  tasa: string;
}

export interface ResultadoLinea {
  itemId: string;
  cantidad: string;
  precioUnitario: string;
  subtotalNeto: string;
  descuentoAplicado: string;
  recargoAplicado: string;
  impuestoAplicado: string;
  totalLinea: string;
  trazas: {
    descuentos: TrazaRegla[];
    recargos: TrazaRegla[];
    impuestos: TrazaImpuesto[];
  };
}

export interface ResultadoVenta {
  lineas: ResultadoLinea[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  trazasVenta: {
    descuentos: TrazaRegla[];
    recargos: TrazaRegla[];
  };
}

// ── Constantes de estrategia ────────────────────────────────────────────────

/** Reglas que requieren datos de venta/crédito aún inexistentes: no se evalúan. */
const DIFERIDAS = new Set(['promocional', 'mora', 'pronto_pago']);
const METODO_PAGO_CODIGOS = new Set(['metodo_pago', 'recargo_metodo_pago']);
const ZERO = new Decimal(0);

// ── Helpers de redondeo ─────────────────────────────────────────────────────

function modoToRounding(modo: string): Decimal.Rounding {
  switch (modo) {
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'FLOOR':
      return Decimal.ROUND_FLOOR;
    case 'CEIL':
      return Decimal.ROUND_CEIL;
    case 'HALF_UP':
    default:
      return Decimal.ROUND_HALF_UP;
  }
}

function redondear(d: Decimal, cfg: ConfigCalculo): Decimal {
  return d.toDecimalPlaces(cfg.escalaCalculo, modoToRounding(cfg.modoRedondeo));
}

function fmt(d: Decimal, cfg: ConfigCalculo): string {
  return d.toFixed(cfg.escalaCalculo);
}

// ── Evaluación de una regla individual ──────────────────────────────────────

interface ContextoRegla {
  /** Base sobre la que se calcula el porcentaje (neto o acumulado). */
  base: Decimal;
  /** Magnitud para tramos `por_mayor`. */
  cantidad: Decimal;
  /** Magnitud para tramos `por_monto_venta` (monto neto). */
  monto: Decimal;
  metodoPagoId: string | null;
}

function aplicarValor(
  modo: ModoRegla,
  valor: string | null,
  base: Decimal,
): Decimal {
  if (valor == null) return ZERO;
  const v = new Decimal(valor);
  // monto_fijo se aplica plano a la línea; porcentaje sobre la base.
  return modo === 'monto_fijo' ? v : base.times(v);
}

function seleccionarTramo(
  tramos: { minimo: string; valor: string }[],
  magnitud: Decimal,
): { minimo: string; valor: string } | null {
  let elegido: { minimo: string; valor: string } | null = null;
  let mejorMin = new Decimal(-1);
  for (const t of tramos) {
    const min = new Decimal(t.minimo);
    if (magnitud.greaterThanOrEqualTo(min) && min.greaterThan(mejorMin)) {
      elegido = t;
      mejorMin = min;
    }
  }
  return elegido;
}

function evaluarRegla(regla: ReglaResuelta, ctx: ContextoRegla): Decimal {
  const codigo = regla.codigo ?? '';
  if (DIFERIDAS.has(codigo)) return ZERO;

  if (METODO_PAGO_CODIGOS.has(codigo)) {
    if (!ctx.metodoPagoId || !regla.metodoPagoIds.includes(ctx.metodoPagoId)) {
      return ZERO;
    }
    return aplicarValor(regla.modo, regla.valor, ctx.base);
  }

  if (regla.tramos.length > 0) {
    const magnitud = codigo === 'por_mayor' ? ctx.cantidad : ctx.monto;
    const tramo = seleccionarTramo(regla.tramos, magnitud);
    if (!tramo) return ZERO;
    return aplicarValor(regla.modo, tramo.valor, ctx.base);
  }

  return aplicarValor(regla.modo, regla.valor, ctx.base);
}

// ── Procesamiento de un conjunto de descuentos/recargos ─────────────────────

interface ResultadoPaso {
  acc: Decimal;
  total: Decimal;
  trazas: TrazaRegla[];
}

/**
 * Aplica una lista de reglas (descuentos o recargos) sobre el acumulador.
 * `signo` = -1 para descuentos (restan), +1 para recargos (suman).
 * `modoCalculo` = 'base' (% sobre neto) | 'compuesto' (% sobre acumulado).
 */
function procesarReglas(
  reglas: ReglaResuelta[],
  params: {
    neto: Decimal;
    acc: Decimal;
    cantidad: Decimal;
    signo: -1 | 1;
    modoCalculo: string;
    metodoPagoId: string | null;
    cfg: ConfigCalculo;
  },
): ResultadoPaso {
  let { acc } = params;
  let total = ZERO;
  const trazas: TrazaRegla[] = [];

  for (const regla of reglas) {
    const base = params.modoCalculo === 'compuesto' ? acc : params.neto;
    let monto = evaluarRegla(regla, {
      base,
      cantidad: params.cantidad,
      monto: params.neto,
      metodoPagoId: params.metodoPagoId,
    });
    monto = redondear(monto, params.cfg);
    acc = acc.plus(monto.times(params.signo));
    total = total.plus(monto);
    trazas.push({
      id: regla.id,
      nombre: regla.nombre,
      monto: fmt(monto, params.cfg),
    });
  }

  return { acc, total, trazas };
}

// ── Cálculo por línea ───────────────────────────────────────────────────────

function calcularLinea(
  linea: LineaResuelta,
  metodoPagoId: string | null,
  cfg: ConfigCalculo,
): ResultadoLinea {
  const cantidad = new Decimal(linea.cantidad);
  const bruto = new Decimal(linea.precioUnitario);

  // Neto unitario: desbrutear si el precio ya incluye impuestos.
  let netoUnitario = bruto;
  if (linea.precioIncluyeImpuesto && linea.impuestos.length > 0) {
    const sumaTasas = linea.impuestos.reduce(
      (acc, imp) => acc.plus(imp.porcentaje),
      ZERO,
    );
    netoUnitario = bruto.dividedBy(new Decimal(1).plus(sumaTasas));
  }
  const subtotalNeto = redondear(netoUnitario.times(cantidad), cfg);

  let acc = subtotalNeto;
  let descuentoAplicado = ZERO;
  let recargoAplicado = ZERO;
  let impuestoAplicado = ZERO;
  const trazas = {
    descuentos: [] as TrazaRegla[],
    recargos: [] as TrazaRegla[],
    impuestos: [] as TrazaImpuesto[],
  };

  for (const paso of cfg.formula) {
    if (paso === 'descuentos') {
      const r = procesarReglas(linea.descuentos, {
        neto: subtotalNeto,
        acc,
        cantidad,
        signo: -1,
        modoCalculo: cfg.calculoDescuentos,
        metodoPagoId,
        cfg,
      });
      acc = r.acc;
      descuentoAplicado = r.total;
      trazas.descuentos = r.trazas;
    } else if (paso === 'recargos') {
      const r = procesarReglas(linea.recargos, {
        neto: subtotalNeto,
        acc,
        cantidad,
        signo: 1,
        modoCalculo: cfg.calculoRecargos,
        metodoPagoId,
        cfg,
      });
      acc = r.acc;
      recargoAplicado = r.total;
      trazas.recargos = r.trazas;
    } else if (paso === 'impuestos') {
      // Base imponible = acumulado al inicio del paso (no hay impuesto sobre impuesto).
      const baseImponible = acc;
      for (const imp of linea.impuestos) {
        const monto = redondear(baseImponible.times(imp.porcentaje), cfg);
        impuestoAplicado = impuestoAplicado.plus(monto);
        acc = acc.plus(monto);
        trazas.impuestos.push({
          id: imp.id,
          nombre: imp.nombre,
          tasa: imp.porcentaje,
          monto: fmt(monto, cfg),
        });
      }
    }
  }

  return {
    itemId: linea.itemId,
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    subtotalNeto: fmt(subtotalNeto, cfg),
    descuentoAplicado: fmt(descuentoAplicado, cfg),
    recargoAplicado: fmt(recargoAplicado, cfg),
    impuestoAplicado: fmt(impuestoAplicado, cfg),
    totalLinea: fmt(acc, cfg),
    trazas,
  };
}

// ── Cálculo de la venta completa ────────────────────────────────────────────

export function calcularVenta(venta: VentaResuelta): ResultadoVenta {
  const { config: cfg } = venta;

  const lineas = venta.lineas.map((l) =>
    calcularLinea(l, venta.metodoPagoId, cfg),
  );

  let subtotalNeto = ZERO;
  let totalDescuentos = ZERO;
  let totalRecargos = ZERO;
  let totalImpuestos = ZERO;
  let totalFinal = ZERO;
  let cantidadTotal = ZERO;

  for (const l of lineas) {
    subtotalNeto = subtotalNeto.plus(l.subtotalNeto);
    totalDescuentos = totalDescuentos.plus(l.descuentoAplicado);
    totalRecargos = totalRecargos.plus(l.recargoAplicado);
    totalImpuestos = totalImpuestos.plus(l.impuestoAplicado);
    totalFinal = totalFinal.plus(l.totalLinea);
    cantidadTotal = cantidadTotal.plus(l.cantidad);
  }

  // Reglas a nivel venta: aplican sobre el neto agregado, respetando el orden
  // de la fórmula del tenant (el paso `impuestos` no aplica a nivel venta).
  let accVenta = subtotalNeto;
  let dv: ResultadoPaso = { acc: accVenta, total: ZERO, trazas: [] };
  let rv: ResultadoPaso = { acc: accVenta, total: ZERO, trazas: [] };

  for (const paso of cfg.formula) {
    if (paso === 'descuentos') {
      dv = procesarReglas(venta.descuentosVenta, {
        neto: subtotalNeto,
        acc: accVenta,
        cantidad: cantidadTotal,
        signo: -1,
        modoCalculo: cfg.calculoDescuentos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
      });
      accVenta = dv.acc;
    } else if (paso === 'recargos') {
      rv = procesarReglas(venta.recargosVenta, {
        neto: subtotalNeto,
        acc: accVenta,
        cantidad: cantidadTotal,
        signo: 1,
        modoCalculo: cfg.calculoRecargos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
      });
      accVenta = rv.acc;
    }
  }

  totalDescuentos = totalDescuentos.plus(dv.total);
  totalRecargos = totalRecargos.plus(rv.total);
  totalFinal = totalFinal.minus(dv.total).plus(rv.total);

  return {
    lineas,
    totales: {
      subtotalNeto: fmt(subtotalNeto, cfg),
      totalDescuentos: fmt(totalDescuentos, cfg),
      totalRecargos: fmt(totalRecargos, cfg),
      totalImpuestos: fmt(totalImpuestos, cfg),
      totalFinal: fmt(totalFinal, cfg),
    },
    trazasVenta: { descuentos: dv.trazas, recargos: rv.trazas },
  };
}
