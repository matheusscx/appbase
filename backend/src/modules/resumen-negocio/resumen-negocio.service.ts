import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
import { saldoDeVentaSql } from '../ventas/saldo-venta';
import {
  bordeFechaSql,
  bordeHastaSql,
  diaNegocioEnZona,
  diaNegocioTenant,
  empujarDiaNegocio,
  fechaMenosDias,
} from '../../common/utils/rango-fecha.util';
import {
  AnulacionesReporteService,
  type ResumenAnulaciones,
} from '../salones/anulaciones-reporte.service';
import { MermasService, type ResumenMermas } from '../mermas/mermas.service';

export interface Comparado<T = string> {
  hoy: T;
  semanaPasada: T;
  /** `(hoy − semanaPasada) / semanaPasada`, `toFixed(4)`; `null` si semanaPasada ≤ 0. */
  variacion: string | null;
}

export interface VentasHoy {
  /** NETO de notas de crédito: `vendidoDesglose.bruto − vendidoDesglose.notasCredito` en `hoy`. */
  vendido: Comparado;
  /** De hoy: lo vendido sin descontar, y lo que restaron las notas de crédito de hoy (positivo). */
  vendidoDesglose: { bruto: string; notasCredito: string };
  /** NETO de lo devuelto: `cobradoDesglose.cobrado − cobradoDesglose.devuelto` en `hoy`. */
  cobrado: Comparado;
  /** De hoy: lo cobrado sin descontar, y lo devuelto hoy (efectivo de las correcciones + REFUND aprobados), positivo. */
  cobradoDesglose: { cobrado: string; devuelto: string };
  cantidad: Comparado<number>;
  /** `null` cuando esa cantidad es 0 o el neto no es positivo: no hay ticket que promediar. */
  ticketPromedio: Comparado<string | null>;
  /** Vendido de HOY por canal, no comparado contra la semana pasada. */
  porCanal: { fisico: string; online: string };
}

export interface PorCobrar {
  cantidad: number;
  saldo: string;
}

export interface PerdidasHoy {
  /** `porTipo` tal cual lo devuelve `AnulacionesReporteService.resumen`. */
  anulaciones: ResumenAnulaciones['porTipo'];
  mermas: ResumenMermas;
  // No hay "total de pérdidas": sumar los dos bloques contaría dos veces un
  // plato quemado en mesa (anulación tipo merma Y merma de cocina a la vez),
  // y los costos vienen en más de una moneda (spec § 4.4).
}

export interface MasVendidoItem {
  itemId: string;
  itemNombre: string;
  /**
   * Neto, en unidad base: Σ `venta_detalles.cantidad` de lo vendido hoy menos
   * la de las líneas de las correcciones de hoy, sin la línea de ajuste.
   */
  cantidad: string;
  /**
   * Neto: Σ `venta_detalles.total_linea` de lo vendido hoy menos la de las
   * líneas de las correcciones de hoy, sin la línea de ajuste.
   */
  monto: string;
}

export interface ResumenNegocioHoy {
  /** `YYYY-MM-DD`, día local del tenant. */
  fecha: string;
  ventas: VentasHoy;
  porCobrar: PorCobrar;
  perdidas: PerdidasHoy;
  /** Hasta 5, `ORDER BY monto DESC, itemId`; solo entran ítems con neto > 0. */
  masVendidos: MasVendidoItem[];
}

interface VentasRow {
  bruto_hoy: string;
  notas_hoy: string;
  neto_hoy: string;
  vendido_semana_pasada: string;
  cantidad_hoy: number;
  cantidad_semana_pasada: number;
  vendido_fisico_hoy: string;
  vendido_online_hoy: string;
}

interface CobradoRow {
  cobrado_hoy: string;
  cobrado_semana_pasada: string;
  efectivo_hoy: string;
  efectivo_semana_pasada: string;
  pasarela_hoy: string;
  pasarela_semana_pasada: string;
}

interface PorCobrarRow {
  cantidad: number;
  saldo: string;
}

interface MasVendidoRow {
  item_id: string;
  item_nombre: string;
  cantidad: string;
  monto: string;
}

/** `(hoy − semanaPasada) / semanaPasada`; `null` si `semanaPasada` ≤ 0: contra
 *  un día negativo o vacío el porcentaje no dice nada (D7). */
function calcularVariacion(hoy: Decimal, semanaPasada: Decimal): string | null {
  if (semanaPasada.lte(0)) return null;
  return hoy.minus(semanaPasada).dividedBy(semanaPasada).toFixed(ESCALA_COSTO);
}

@Injectable()
export class ResumenNegocioService {
  constructor(
    private readonly db: Db,
    private readonly anulacionesReporteService: AnulacionesReporteService,
    private readonly mermasService: MermasService,
  ) {}

  async hoy(tenantId: string): Promise<ResumenNegocioHoy> {
    // El día del negocio (zona + hora de corte) se resuelve UNA sola vez —una
    // consulta— y de ahí salen `fecha` y la fecha de hace 7 días, las dos en
    // TypeScript sobre la fecha PURA (no sobre un `Date` en UTC): mismo
    // criterio que `diaNegocioEnZona` documenta para no repetir el viaje a
    // `tenants` por cada instante que hay que colapsar. Llamar a
    // `fechaLocalTenant` acá habría vuelto a consultar la zona por su cuenta,
    // y además esta ruta necesita `dia` SUELTO para pasarlo como bind params
    // de `bordeFechaSql`/`bordeHastaSql` en las dos consultas de abajo.
    const dia = await diaNegocioTenant(this.db, tenantId);
    const fecha = diaNegocioEnZona(dia, new Date());
    const fechaSemanaPasada = fechaMenosDias(fecha, 7);

    // Posiciones de parámetro compartidas por las dos consultas de rango
    // (ventas y cobrado): mismo
    // `[tenantId, fecha, dia.zona, fechaSemanaPasada, dia.horaCorte]`.
    const params: unknown[] = [
      tenantId,
      fecha,
      dia.zona,
      fechaSemanaPasada,
      dia.horaCorte,
    ];
    const IDX_FECHA_HOY = 2;
    const IDX_DIA = { zona: 3, corte: 5 };
    const IDX_FECHA_SEMANA_PASADA = 4;

    const condicion = (columna: string, idxFecha: number): string =>
      'TRUE' +
      bordeFechaSql(columna, '>=', fecha, idxFecha, IDX_DIA) +
      bordeHastaSql(columna, fecha, idxFecha, IDX_DIA);
    const condicionSemanaPasada = (columna: string, idxFecha: number): string =>
      'TRUE' +
      bordeFechaSql(columna, '>=', fechaSemanaPasada, idxFecha, IDX_DIA) +
      bordeHastaSql(columna, fechaSemanaPasada, idxFecha, IDX_DIA);

    const condHoyVenta = condicion('v.fecha', IDX_FECHA_HOY);
    const condSemanaPasadaVenta = condicionSemanaPasada(
      'v.fecha',
      IDX_FECHA_SEMANA_PASADA,
    );

    // Una corrección (hoy, la nota de crédito) es la fila con
    // `venta_referencia_id`: resta en SU fecha, aunque la venta que corrige sea
    // de otro día (spec 2026-10-01-vendido-neto § 2 D1, § 3.1). Su total_final
    // es positivo: el signo lo pone esta consulta.
    const firmado =
      'CASE WHEN v.venta_referencia_id IS NULL THEN v.total_final ELSE -v.total_final END';

    // Vendido, cantidad y por canal: hoy y la semana pasada en UNA consulta
    // con `FILTER (WHERE …)`, sin importar cuántas ventas haya. La NC copia el
    // `canal` de la venta que corrige, así que resta en el mismo canal.
    const ventasRows: VentasRow[] = await this.db.query(
      `SELECT
          COALESCE(SUM(v.total_final)
            FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NULL), 0)::text
            AS bruto_hoy,
          COALESCE(SUM(v.total_final)
            FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NOT NULL), 0)::text
            AS notas_hoy,
          COALESCE(SUM(${firmado}) FILTER (WHERE ${condHoyVenta}), 0)::text
            AS neto_hoy,
          COALESCE(SUM(${firmado}) FILTER (WHERE ${condSemanaPasadaVenta}), 0)::text
            AS vendido_semana_pasada,
          COUNT(*) FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NULL)::int
            AS cantidad_hoy,
          COUNT(*) FILTER (WHERE ${condSemanaPasadaVenta} AND v.venta_referencia_id IS NULL)::int
            AS cantidad_semana_pasada,
          COALESCE(SUM(${firmado})
            FILTER (WHERE ${condHoyVenta} AND v.canal = 'fisico'), 0)::text
            AS vendido_fisico_hoy,
          COALESCE(SUM(${firmado})
            FILTER (WHERE ${condHoyVenta} AND v.canal = 'online'), 0)::text
            AS vendido_online_hoy
         FROM ventas v
        WHERE v.tenant_id = $1
          AND v.eliminado_el IS NULL
          AND v.estado <> 'cancelada'`,
      params,
    );

    const condHoyPago = condicion('p.creado_el', IDX_FECHA_HOY);
    const condSemanaPasadaPago = condicionSemanaPasada(
      'p.creado_el',
      IDX_FECHA_SEMANA_PASADA,
    );

    // Cobrado: `Σ pago_aplicaciones.monto` con `tipo = 'venta'` —no
    // `pagos.monto`, que trae también el vuelto—. Es la misma cuenta que usa
    // `VentasService.resumen` para el saldo pendiente, ahora en el sentido
    // contrario: acá se agrega por FECHA DEL PAGO, no por venta.
    //
    // **Step 1 (medido antes de escribir, 2026-09-18):** `crearNotaCredito`
    // (`ventas.service.ts` → `crearNotaCreditoEnTransaccion`, ~L1492-2000) NO
    // escribe `pagos` ni `pago_aplicaciones` en ningún camino —ni el manual ni
    // el del webhook de reembolso—: el único lugar del módulo que inserta en
    // `pago_aplicaciones` es `pagos.service.ts` (`registrar`/`registrarAbono`).
    // Y una venta CANCELADA no puede tener pagos por construcción:
    // `cancelarUnaVez` (`ventas.service.ts` ~L1300) rechaza la anulación con
    // 400 si `SELECT 1 FROM pagos WHERE venta_id = …` encuentra alguna fila.
    // O sea que, por el camino de la app, ninguna nota de crédito ni ninguna
    // venta cancelada puede aportarle nada a esta suma — no hace falta un
    // `JOIN` a `ventas` para excluirlas. Lo que la NC devuelve no sale de esa
    // suma: se resta aparte, en `e` y `r` (spec 2026-10-01-vendido-neto § 3.2).
    const condHoyMov = condicion('mc.fecha', IDX_FECHA_HOY);
    const condSemanaPasadaMov = condicionSemanaPasada(
      'mc.fecha',
      IDX_FECHA_SEMANA_PASADA,
    );
    const condHoyRefund = condicion('t.fecha_transaccion', IDX_FECHA_HOY);
    const condSemanaPasadaRefund = condicionSemanaPasada(
      't.fecha_transaccion',
      IDX_FECHA_SEMANA_PASADA,
    );

    // Tres agregados de una fila cada uno, cruzados: una sola consulta.
    const cobradoRows: CobradoRow[] = await this.db.query(
      `SELECT c.cobrado_hoy, c.cobrado_semana_pasada,
              e.efectivo_hoy, e.efectivo_semana_pasada,
              r.pasarela_hoy, r.pasarela_semana_pasada
         FROM (
           SELECT COALESCE(SUM(pa.monto) FILTER (WHERE ${condHoyPago}), 0)::text
                    AS cobrado_hoy,
                  COALESCE(SUM(pa.monto) FILTER (WHERE ${condSemanaPasadaPago}), 0)::text
                    AS cobrado_semana_pasada
             FROM pagos p
             JOIN pago_aplicaciones pa
               ON pa.pago_id = p.pago_id
              AND pa.tipo = 'venta'
              AND pa.eliminado_el IS NULL
            WHERE p.tenant_id = $1
              AND p.eliminado_el IS NULL
         ) c
         -- Efectivo devuelto: la salida de caja que lleva el venta_id de una
         -- corrección. Un retiro de caja no lleva venta_id y no entra. La caja
         -- no tiene tenant_id: el alcance va por la corrección.
         CROSS JOIN (
           SELECT COALESCE(SUM(mc.monto) FILTER (WHERE ${condHoyMov}), 0)::text
                    AS efectivo_hoy,
                  COALESCE(SUM(mc.monto) FILTER (WHERE ${condSemanaPasadaMov}), 0)::text
                    AS efectivo_semana_pasada
             FROM movimientos_caja mc
             JOIN ventas nc
               ON nc.venta_id = mc.venta_id
              AND nc.venta_referencia_id IS NOT NULL
              AND nc.tenant_id = $1
              AND nc.eliminado_el IS NULL
            WHERE mc.tipo = 'salida'
              AND mc.eliminado_el IS NULL
         ) e
         -- Reembolso por pasarela, con o sin NC (D6). Solo de órdenes con
         -- venta: el cobro de una orden sin venta nunca entró a pagos, así
         -- que su reembolso tampoco sale del cobrado. El reembolso del webhook
         -- no deja salida de caja (no pide devolver dinero), así que esto y lo
         -- de arriba no se pisan.
         CROSS JOIN (
           SELECT COALESCE(SUM(t.monto) FILTER (WHERE ${condHoyRefund}), 0)::text
                    AS pasarela_hoy,
                  COALESCE(SUM(t.monto) FILTER (WHERE ${condSemanaPasadaRefund}), 0)::text
                    AS pasarela_semana_pasada
             FROM pasarela_transacciones t
             JOIN pasarela_ordenes o
               ON o.orden_id = t.orden_id
              AND o.tenant_id = t.tenant_id
              AND o.venta_id IS NOT NULL
              AND o.eliminado_el IS NULL
            WHERE t.tenant_id = $1
              AND t.tipo = 'REFUND'
              AND t.estado = 'aprobada'
              AND t.eliminado_el IS NULL
         ) r`,
      params,
    );

    // Por cobrar: ventas pendientes o parcialmente pagadas, de CUALQUIER
    // fecha —es lo que se debe ahora, no lo que se vendió hoy—. El saldo por
    // venta es la expresión ÚNICA (`saldo-venta.ts`), la misma que usa
    // `saldo_pendiente` de `VentasService.resumen`. Las correcciones no entran
    // como filas (`venta_referencia_id IS NULL`): las "sin plata" restan del
    // saldo de la venta que corrigen.
    const porCobrarRows: PorCobrarRow[] = await this.db.query(
      `SELECT COUNT(*) FILTER (WHERE s.saldo > 0)::int AS cantidad,
              COALESCE(SUM(s.saldo), 0)::text AS saldo
         FROM (
           SELECT
             -- La expresión ÚNICA del saldo (\`saldo-venta.ts\`): total − lo aplicado −
             -- lo rebajado "sin plata", con piso 0. La misma que el saldo del
             -- listado y del detalle de ventas, \`/ventas/resumen\` y el tope del
             -- abono. Una corrección que devolvió plata (efectivo, tarjeta,
             -- pasarela) no cambia lo que se debe.
             ${saldoDeVentaSql('v')} AS saldo
             FROM ventas v
            WHERE v.tenant_id = $1
              AND v.eliminado_el IS NULL
              AND v.estado IN ('pendiente', 'pagada_parcial')
              AND v.venta_referencia_id IS NULL
         ) s`,
      [tenantId],
    );

    // Pérdidas (Task 2, spec § 4.4): dos reportes ajenos, reusados tal cual
    // con el rango de HOY, cada uno resolviendo su propia zona (mismo costo
    // que paga `AnulacionesReporteService.resumen` cuando lo llama su propio
    // controller). No se suman entre sí acá ni en ningún lado — ver el
    // docblock de `PerdidasHoy`.
    const anulacionesHoy = await this.anulacionesReporteService.resumen(
      tenantId,
      { desde: fecha, hasta: fecha },
    );
    const mermasHoy = await this.mermasService.resumen(tenantId, fecha, fecha);

    // Lo más vendido: los mismos filtros de venta que "vendido" arriba (sin
    // canceladas, rango de HOY), agregado por ítem y NETO de las correcciones:
    // una venta suma sus líneas y una nota de crédito (`venta_referencia_id`)
    // las resta, en la cantidad y en el monto. Un ítem cuyo neto del día no es
    // positivo no es "lo más vendido" y sale (`HAVING`).
    // `ORDER BY` sobre la expresión SUM y no sobre el alias `monto`: el alias
    // sale con `::text` (para no perder precisión de Decimal en el mapeo), y
    // ordenar por un texto compararía "9990000" antes que "500"
    // lexicográficamente.
    //
    // ⚠️ Lista de params PROPIA, no `params` compartido con ventas/cobrado
    // (medido 2026-09-19, `QueryFailedError 42P18: could not determine data
    // type of parameter $4`). Esta consulta solo necesita el rango de HOY:
    // nunca menciona `fechaSemanaPasada` (`$4` en la lista compartida). El
    // protocolo extendido de Postgres infiere el tipo de cada parámetro
    // mirando dónde se USA en el texto — un parámetro que la consulta no
    // menciona en ningún lado no tiene de dónde inferirlo, y falla, sea la
    // posición que sea (no solo "la más alta sin usar", como decía el
    // comentario que esto reemplaza). La regla no es "alcanzar la posición
    // más alta referenciada": es que CADA `$n` que se manda esté en el texto
    // y CADA `$n` del texto tenga con qué bindear. `bordeFechaSql`/
    // `bordeHastaSql` sí toleran huecos en el medio (ver su docblock), pero
    // eso es sobre los índices que ELLAS arman, no sobre qué le pasás vos a
    // `db.query` — acá el hueco lo abría `params` completo.
    const paramsMasVendidos: unknown[] = [tenantId, fecha];
    const idxDiaMasVendidos = empujarDiaNegocio(paramsMasVendidos, dia);
    const condHoyVentaMasVendidos =
      'TRUE' +
      bordeFechaSql('v.fecha', '>=', fecha, 2, idxDiaMasVendidos) +
      bordeHastaSql('v.fecha', fecha, 2, idxDiaMasVendidos);

    const masVendidosRows: MasVendidoRow[] = await this.db.query(
      `SELECT vd.item_id, i.nombre AS item_nombre,
              SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                       ELSE -vd.total_linea END)::text AS monto,
              SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.cantidad
                       ELSE -vd.cantidad END)::text AS cantidad
         FROM venta_detalles vd
         JOIN ventas v ON v.venta_id = vd.venta_id
         -- Nombre del ítem SIN filtro de borrado, a propósito: se vendió
         -- hoy, y darlo de baja después no lo saca de lo más vendido (spec
         -- 2026-09-18-dashboard-inicio § 4.4/§ 5.1).
         JOIN items i ON i.item_id = vd.item_id
        WHERE v.tenant_id = $1
          AND v.eliminado_el IS NULL
          AND vd.eliminado_el IS NULL
          AND v.estado <> 'cancelada'
          -- La línea "Ajuste" es la parte de una NC que no corresponde a
          -- ningún producto: resta del vendido, no de un ítem.
          AND i.es_ajuste_nota_credito = false
          AND ${condHoyVentaMasVendidos}
        GROUP BY vd.item_id, i.nombre
       HAVING SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                       ELSE -vd.total_linea END) > 0
        ORDER BY SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                          ELSE -vd.total_linea END) DESC, vd.item_id
        LIMIT 5`,
      paramsMasVendidos,
    );

    const vr = ventasRows[0];
    const cr = cobradoRows[0];
    const pc = porCobrarRows[0];

    const vendidoHoy = new Decimal(vr?.neto_hoy ?? '0');
    const vendidoSemanaPasada = new Decimal(vr?.vendido_semana_pasada ?? '0');
    // Neto de lo devuelto, hoy y la semana pasada. `pasarela_*` viene con la
    // escala de `pasarela_transacciones.monto` (6) y `pagos` con la suya (4):
    // lo derivado sale con `toFixed(ESCALA_COSTO)`.
    const cobradoBrutoHoy = new Decimal(cr?.cobrado_hoy ?? '0');
    const devueltoHoy = new Decimal(cr?.efectivo_hoy ?? '0').plus(
      cr?.pasarela_hoy ?? '0',
    );
    const devueltoSemanaPasada = new Decimal(
      cr?.efectivo_semana_pasada ?? '0',
    ).plus(cr?.pasarela_semana_pasada ?? '0');
    const cobradoHoy = cobradoBrutoHoy.minus(devueltoHoy);
    const cobradoSemanaPasada = new Decimal(
      cr?.cobrado_semana_pasada ?? '0',
    ).minus(devueltoSemanaPasada);
    const cantidadHoy = vr?.cantidad_hoy ?? 0;
    const cantidadSemanaPasada = vr?.cantidad_semana_pasada ?? 0;

    // Ticket: `neto / cantidad`, solo con cantidad > 0 Y neto > 0 (D8): un
    // neto ≤ 0 no es un ticket que mostrar.
    const ticketHoy =
      cantidadHoy > 0 && vendidoHoy.gt(0)
        ? vendidoHoy.dividedBy(cantidadHoy).toFixed(ESCALA_COSTO)
        : null;
    const ticketSemanaPasada =
      cantidadSemanaPasada > 0 && vendidoSemanaPasada.gt(0)
        ? vendidoSemanaPasada
            .dividedBy(cantidadSemanaPasada)
            .toFixed(ESCALA_COSTO)
        : null;

    return {
      fecha,
      ventas: {
        vendido: {
          hoy: vr?.neto_hoy ?? '0',
          semanaPasada: vr?.vendido_semana_pasada ?? '0',
          variacion: calcularVariacion(vendidoHoy, vendidoSemanaPasada),
        },
        vendidoDesglose: {
          bruto: vr?.bruto_hoy ?? '0',
          notasCredito: vr?.notas_hoy ?? '0',
        },
        cobrado: {
          hoy: cobradoHoy.toFixed(ESCALA_COSTO),
          semanaPasada: cobradoSemanaPasada.toFixed(ESCALA_COSTO),
          variacion: calcularVariacion(cobradoHoy, cobradoSemanaPasada),
        },
        cobradoDesglose: {
          cobrado: cr?.cobrado_hoy ?? '0',
          devuelto: devueltoHoy.toFixed(ESCALA_COSTO),
        },
        cantidad: {
          hoy: cantidadHoy,
          semanaPasada: cantidadSemanaPasada,
          variacion: calcularVariacion(
            new Decimal(cantidadHoy),
            new Decimal(cantidadSemanaPasada),
          ),
        },
        ticketPromedio: {
          hoy: ticketHoy,
          semanaPasada: ticketSemanaPasada,
          variacion:
            ticketHoy !== null && ticketSemanaPasada !== null
              ? calcularVariacion(
                  new Decimal(ticketHoy),
                  new Decimal(ticketSemanaPasada),
                )
              : null,
        },
        porCanal: {
          fisico: vr?.vendido_fisico_hoy ?? '0',
          online: vr?.vendido_online_hoy ?? '0',
        },
      },
      porCobrar: {
        cantidad: pc?.cantidad ?? 0,
        saldo: pc?.saldo ?? '0',
      },
      perdidas: {
        anulaciones: anulacionesHoy.porTipo,
        mermas: mermasHoy,
      },
      masVendidos: masVendidosRows.map((r) => ({
        itemId: r.item_id,
        itemNombre: r.item_nombre,
        cantidad: r.cantidad,
        monto: r.monto,
      })),
    };
  }
}
