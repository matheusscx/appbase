import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
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
  /** `(hoy − semanaPasada) / semanaPasada`, `toFixed(4)`; `null` si semanaPasada = 0. */
  variacion: string | null;
}

export interface VentasHoy {
  vendido: Comparado;
  cobrado: Comparado;
  cantidad: Comparado<number>;
  /** `null` cuando esa cantidad es 0: no hay ticket que promediar. */
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
  /** Σ en unidad base, `venta_detalles.cantidad`. */
  cantidad: string;
  /** Σ `venta_detalles.total_linea`. */
  monto: string;
}

export interface ResumenNegocioHoy {
  /** `YYYY-MM-DD`, día local del tenant. */
  fecha: string;
  ventas: VentasHoy;
  porCobrar: PorCobrar;
  perdidas: PerdidasHoy;
  /** Hasta 5, `ORDER BY monto DESC, itemId`. */
  masVendidos: MasVendidoItem[];
}

interface VentasRow {
  vendido_hoy: string;
  vendido_semana_pasada: string;
  cantidad_hoy: number;
  cantidad_semana_pasada: number;
  vendido_fisico_hoy: string;
  vendido_online_hoy: string;
}

interface CobradoRow {
  cobrado_hoy: string;
  cobrado_semana_pasada: string;
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

/** `(hoy − semanaPasada) / semanaPasada`, `null` si `semanaPasada` es 0. */
function calcularVariacion(hoy: Decimal, semanaPasada: Decimal): string | null {
  if (semanaPasada.isZero()) return null;
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

    // Vendido, cantidad y por canal: hoy y la semana pasada en UNA consulta
    // con `FILTER (WHERE …)`, sin importar cuántas ventas haya.
    const ventasRows: VentasRow[] = await this.db.query(
      `SELECT
          COALESCE(SUM(v.total_final) FILTER (WHERE ${condHoyVenta}), 0)::text
            AS vendido_hoy,
          COALESCE(SUM(v.total_final) FILTER (WHERE ${condSemanaPasadaVenta}), 0)::text
            AS vendido_semana_pasada,
          COUNT(*) FILTER (WHERE ${condHoyVenta})::int AS cantidad_hoy,
          COUNT(*) FILTER (WHERE ${condSemanaPasadaVenta})::int
            AS cantidad_semana_pasada,
          COALESCE(SUM(v.total_final)
            FILTER (WHERE ${condHoyVenta} AND v.canal = 'fisico'), 0)::text
            AS vendido_fisico_hoy,
          COALESCE(SUM(v.total_final)
            FILTER (WHERE ${condHoyVenta} AND v.canal = 'online'), 0)::text
            AS vendido_online_hoy
         FROM ventas v
         -- Sin nota de crédito: mismo criterio que VentasService.resumen,
         -- pero por es_nota_credito del tipo de documento (no por comparar
         -- contra el id fijo de un país) — así no hace falta copiar
         -- tipoNotaCreditoDelTenant ni su trampa documentada (un
         -- IS DISTINCT FROM NULL que deja afuera las ventas sin tipo).
         --
         -- El JOIN va SIN td.eliminado_el IS NULL, a propósito: un tipo de
         -- documento dado de baja DESPUÉS no deja de marcar como nota de
         -- crédito a la venta que ya lo usó (spec 2026-09-18-dashboard-inicio
         -- § 4.1).
         LEFT JOIN tipos_documento_tributario td
           ON td.tipo_documento_id = v.tipo_documento_id
        WHERE v.tenant_id = $1
          AND v.eliminado_el IS NULL
          AND v.estado <> 'cancelada'
          AND COALESCE(td.es_nota_credito, false) = false`,
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
    // `JOIN` a `ventas` para excluirlas.
    const cobradoRows: CobradoRow[] = await this.db.query(
      `SELECT
          COALESCE(SUM(pa.monto) FILTER (WHERE ${condHoyPago}), 0)::text
            AS cobrado_hoy,
          COALESCE(SUM(pa.monto) FILTER (WHERE ${condSemanaPasadaPago}), 0)::text
            AS cobrado_semana_pasada
         FROM pagos p
         JOIN pago_aplicaciones pa
           ON pa.pago_id = p.pago_id
          AND pa.tipo = 'venta'
          AND pa.eliminado_el IS NULL
        WHERE p.tenant_id = $1
          AND p.eliminado_el IS NULL`,
      params,
    );

    // Por cobrar: ventas pendientes o parcialmente pagadas, de CUALQUIER
    // fecha —es lo que se debe ahora, no lo que se vendió hoy—. Misma forma
    // que `saldo_pendiente` de `VentasService.resumen`.
    const porCobrarRows: PorCobrarRow[] = await this.db.query(
      `SELECT COUNT(*)::int AS cantidad,
              COALESCE(SUM(
                v.total_final - COALESCE((
                  SELECT SUM(pa.monto)
                    FROM pagos p
                    JOIN pago_aplicaciones pa
                      ON pa.pago_id = p.pago_id
                     AND pa.eliminado_el IS NULL
                     AND pa.tipo = 'venta'
                   WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL
                ), 0)
              ), 0)::text AS saldo
         FROM ventas v
         -- El JOIN va SIN td.eliminado_el IS NULL, a propósito: mismo porqué
         -- que la consulta de vendido, de nuevo acá porque el porqué de una
         -- excepción vive en la CONSULTA que la tiene, no en otra 40 líneas
         -- más arriba — un tipo de documento dado de baja DESPUÉS no deja de
         -- marcar como nota de crédito a la venta que ya lo usó.
         --
         -- Nota: hoy este filtro es cinturón-y-tirantes acá. Una nota de
         -- crédito nace con estado = PAGADA
         -- (crearNotaCreditoEnTransaccion, ventas.service.ts ~L1958), así que
         -- nunca matchea el estado IN ('pendiente', 'pagada_parcial') de
         -- abajo, con o sin este JOIN. Se deja igual: es la misma forma que
         -- vendido y que VentasService.resumen, y si el día de mañana una
         -- NC pudiera nacer pendiente, esta línea es la que ya la protege.
         LEFT JOIN tipos_documento_tributario td
           ON td.tipo_documento_id = v.tipo_documento_id
        WHERE v.tenant_id = $1
          AND v.eliminado_el IS NULL
          AND v.estado IN ('pendiente', 'pagada_parcial')
          AND COALESCE(td.es_nota_credito, false) = false`,
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
    // canceladas, sin nota de crédito, rango de HOY), agregado por ítem.
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
              SUM(vd.total_linea)::text AS monto,
              SUM(vd.cantidad)::text AS cantidad
         FROM venta_detalles vd
         JOIN ventas v ON v.venta_id = vd.venta_id
         -- Mismo criterio que "vendido" (arriba): sin canceladas, sin nota de
         -- crédito, JOIN a td SIN eliminado_el por el mismo porqué (un tipo
         -- de documento dado de baja después no deja de marcar como NC a la
         -- venta que ya lo usó).
         LEFT JOIN tipos_documento_tributario td
           ON td.tipo_documento_id = v.tipo_documento_id
         -- Nombre del ítem SIN filtro de borrado, a propósito: se vendió
         -- hoy, y darlo de baja después no lo saca de lo más vendido (spec
         -- 2026-09-18-dashboard-inicio § 4.4/§ 5.1).
         JOIN items i ON i.item_id = vd.item_id
        WHERE v.tenant_id = $1
          AND v.eliminado_el IS NULL
          AND vd.eliminado_el IS NULL
          AND v.estado <> 'cancelada'
          AND COALESCE(td.es_nota_credito, false) = false
          AND ${condHoyVentaMasVendidos}
        GROUP BY vd.item_id, i.nombre
        ORDER BY SUM(vd.total_linea) DESC, vd.item_id
        LIMIT 5`,
      paramsMasVendidos,
    );

    const vr = ventasRows[0];
    const cr = cobradoRows[0];
    const pc = porCobrarRows[0];

    const vendidoHoy = new Decimal(vr?.vendido_hoy ?? '0');
    const vendidoSemanaPasada = new Decimal(vr?.vendido_semana_pasada ?? '0');
    const cobradoHoy = new Decimal(cr?.cobrado_hoy ?? '0');
    const cobradoSemanaPasada = new Decimal(cr?.cobrado_semana_pasada ?? '0');
    const cantidadHoy = vr?.cantidad_hoy ?? 0;
    const cantidadSemanaPasada = vr?.cantidad_semana_pasada ?? 0;

    const ticketHoy =
      cantidadHoy > 0
        ? vendidoHoy.dividedBy(cantidadHoy).toFixed(ESCALA_COSTO)
        : null;
    const ticketSemanaPasada =
      cantidadSemanaPasada > 0
        ? vendidoSemanaPasada
            .dividedBy(cantidadSemanaPasada)
            .toFixed(ESCALA_COSTO)
        : null;

    return {
      fecha,
      ventas: {
        vendido: {
          hoy: vr?.vendido_hoy ?? '0',
          semanaPasada: vr?.vendido_semana_pasada ?? '0',
          variacion: calcularVariacion(vendidoHoy, vendidoSemanaPasada),
        },
        cobrado: {
          hoy: cr?.cobrado_hoy ?? '0',
          semanaPasada: cr?.cobrado_semana_pasada ?? '0',
          variacion: calcularVariacion(cobradoHoy, cobradoSemanaPasada),
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
