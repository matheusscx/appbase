import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { ESCALA_COSTO } from '../../common/constants/escalas';
import {
  bordeFechaSql,
  bordeHastaSql,
  instanteLocalEnZona,
  zonaHorariaTenant,
} from '../../common/utils/rango-fecha.util';

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

export interface ResumenNegocioHoy {
  /** `YYYY-MM-DD`, día local del tenant. */
  fecha: string;
  ventas: VentasHoy;
  porCobrar: PorCobrar;
  // Task 2 (spec 2026-09-18-dashboard-inicio § 5.1) agrega acá: perdidas, masVendidos.
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

/**
 * `fecha` (pura, `YYYY-MM-DD`) menos `dias`, en aritmética de CALENDARIO —no
 * de instante—: `Date.UTC` se usa acá como calculadora de fechas, nunca como
 * instante real. Restar sobre un `Date` construido desde la zona del PROCESO
 * (`new Date(fecha)` + `setDate`) movería el día en algún huso: mismo cuidado
 * que `bordeHastaSql` exige para el borde superior en SQL, llevado al lado
 * TypeScript. La resta se hace acá y no en cada query con `$n::date - 7`
 * porque el mismo valor hace falta como bind param en DOS consultas (ventas y
 * cobrado).
 */
function fechaMenosDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** `(hoy − semanaPasada) / semanaPasada`, `null` si `semanaPasada` es 0. */
function calcularVariacion(hoy: Decimal, semanaPasada: Decimal): string | null {
  if (semanaPasada.isZero()) return null;
  return hoy.minus(semanaPasada).dividedBy(semanaPasada).toFixed(ESCALA_COSTO);
}

@Injectable()
export class ResumenNegocioService {
  constructor(private readonly db: Db) {}

  async hoy(tenantId: string): Promise<ResumenNegocioHoy> {
    // La zona se resuelve UNA sola vez —una consulta— y de ahí salen `fecha` y
    // la fecha de hace 7 días, las dos en TypeScript sobre la fecha PURA (no
    // sobre un `Date` en UTC): mismo criterio que `instanteLocalEnZona`
    // documenta para no repetir el viaje a `tenants` por cada instante que hay
    // que colapsar. Llamar a `fechaLocalTenant` acá habría vuelto a consultar
    // la zona por su cuenta, y además esta ruta necesita la zona SUELTA para
    // pasarla como bind param de `bordeFechaSql`/`bordeHastaSql` en las dos
    // consultas de abajo.
    const zona = await zonaHorariaTenant(this.db, tenantId);
    const fecha = instanteLocalEnZona(zona, new Date()).fecha;
    const fechaSemanaPasada = fechaMenosDias(fecha, 7);

    // Posiciones de parámetro compartidas por las dos consultas de rango
    // (ventas y cobrado): mismo `[tenantId, fecha, zona, fechaSemanaPasada]`.
    const params: unknown[] = [tenantId, fecha, zona, fechaSemanaPasada];
    const IDX_FECHA_HOY = 2;
    const IDX_ZONA = 3;
    const IDX_FECHA_SEMANA_PASADA = 4;

    const condicion = (columna: string, idxFecha: number): string =>
      'TRUE' +
      bordeFechaSql(columna, '>=', fecha, idxFecha, IDX_ZONA) +
      bordeHastaSql(columna, fecha, idxFecha, IDX_ZONA);
    const condicionSemanaPasada = (columna: string, idxFecha: number): string =>
      'TRUE' +
      bordeFechaSql(columna, '>=', fechaSemanaPasada, idxFecha, IDX_ZONA) +
      bordeHastaSql(columna, fechaSemanaPasada, idxFecha, IDX_ZONA);

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
    };
  }
}
