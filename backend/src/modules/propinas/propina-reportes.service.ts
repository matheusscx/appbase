import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  normalizarRangoReporte,
  QueryPropinaReporteDto,
  RangoReporteNormalizado,
} from './dto/query-propina-reporte.dto';
import { PropinaReporteResumen } from './propina-reportes.types';

type NumericValue = string | number | null;

interface CobranzaRow {
  cierres: NumericValue;
  con_propina: NumericValue;
  sin_propina: NumericValue;
  sugerencia_aceptada: NumericValue;
  monto_cobrado: string | null;
  monto_sugerido: string | null;
  promedio_con_propina: string | null;
  tasa_con_propina: string | null;
  tasa_sugerencia_aceptada: string | null;
  pendiente_libre_cantidad: NumericValue;
  pendiente_libre_monto: string | null;
  en_borrador_cantidad: NumericValue;
  en_borrador_monto: string | null;
  liquidada_cantidad: NumericValue;
  liquidada_monto: string | null;
}

interface AnulacionRow {
  liquidaciones: NumericValue;
  monto_liberado: string | null;
}

interface TendenciaRow {
  fecha: string;
  cierres: NumericValue;
  con_propina: NumericValue;
  monto_cobrado: string | null;
}

interface TurnoRow {
  turno_id: string | null;
  turno_nombre: string | null;
  cierres: NumericValue;
  con_propina: NumericValue;
  monto_cobrado: string | null;
}

interface TipoRow {
  tipo_garzon: PropinaReporteResumen['porTipo'][number]['tipoGarzon'];
  cierres: NumericValue;
  con_propina: NumericValue;
  monto_cobrado: string | null;
}

const count = (value: NumericValue): number => Number(value ?? 0);
const decimal = (value: string | null): string => value ?? '0';

@Injectable()
export class PropinaReportesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resumen(
    tenantId: string,
    query: QueryPropinaReporteDto,
  ): Promise<PropinaReporteResumen> {
    const rango = normalizarRangoReporte(query);
    const zona = await this.zonaHoraria(tenantId);
    const [
      cobranza,
      anulaciones,
      tendencia,
      porTurno,
      porTipo,
      liquidacionesParcialmenteSolapadas,
    ] = await Promise.all([
      this.cobranzaYEstado(tenantId, rango, zona),
      this.anulaciones(tenantId, rango, zona),
      this.tendencia(tenantId, rango, zona),
      this.porTurno(tenantId, rango, zona),
      this.porTipo(tenantId, rango, zona),
      this.solapadas(tenantId, rango, zona),
    ]);

    return {
      periodo: { desde: rango.desde, hasta: rango.hasta },
      cobranza: {
        cierres: count(cobranza.cierres),
        conPropina: count(cobranza.con_propina),
        sinPropina: count(cobranza.sin_propina),
        sugerenciaAceptada: count(cobranza.sugerencia_aceptada),
        montoCobrado: decimal(cobranza.monto_cobrado),
        montoSugerido: decimal(cobranza.monto_sugerido),
        promedioConPropina: decimal(cobranza.promedio_con_propina),
        tasaConPropina: decimal(cobranza.tasa_con_propina),
        tasaSugerenciaAceptada: decimal(
          cobranza.tasa_sugerencia_aceptada,
        ),
      },
      estadoActual: {
        pendienteLibreCantidad: count(cobranza.pendiente_libre_cantidad),
        pendienteLibreMonto: decimal(cobranza.pendiente_libre_monto),
        enBorradorCantidad: count(cobranza.en_borrador_cantidad),
        enBorradorMonto: decimal(cobranza.en_borrador_monto),
        liquidadaCantidad: count(cobranza.liquidada_cantidad),
        liquidadaMonto: decimal(cobranza.liquidada_monto),
      },
      anulaciones: {
        liquidaciones: count(anulaciones.liquidaciones),
        montoLiberadoHistorico: decimal(anulaciones.monto_liberado),
      },
      tendencia: tendencia.map((row) => ({
        fecha: row.fecha,
        cierres: count(row.cierres),
        conPropina: count(row.con_propina),
        montoCobrado: decimal(row.monto_cobrado),
      })),
      porTurno: porTurno.map((row) => ({
        turnoId: row.turno_id,
        turnoNombre: row.turno_nombre ?? 'Sin turno',
        cierres: count(row.cierres),
        conPropina: count(row.con_propina),
        montoCobrado: decimal(row.monto_cobrado),
      })),
      porTipo: porTipo.map((row) => ({
        tipoGarzon: row.tipo_garzon,
        cierres: count(row.cierres),
        conPropina: count(row.con_propina),
        montoCobrado: decimal(row.monto_cobrado),
      })),
      advertencias: { liquidacionesParcialmenteSolapadas },
    };
  }

  private filtrosVenta(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zonaHoraria: string,
    alias = 'vp',
  ): { sql: string; params: unknown[] } {
    const params: unknown[] = [
      tenantId,
      rango.desde,
      rango.hasta,
      zonaHoraria,
    ];
    let sql = ` AND ${alias}.tenant_id = $1
      AND ${alias}.eliminado_el IS NULL
      AND ${alias}.creado_el >= ($2::date::timestamp AT TIME ZONE $4)
      AND ${alias}.creado_el < ($3::date::timestamp AT TIME ZONE $4)`;
    if (rango.turnoIds.length) {
      params.push(rango.turnoIds);
      sql += ` AND ${alias}.turno_id = ANY($${params.length}::uuid[])`;
    }
    if (rango.tipoGarzon) {
      params.push(rango.tipoGarzon);
      sql += ` AND ${alias}.tipo_garzon = $${params.length}`;
    }
    return { sql, params };
  }

  private async zonaHoraria(tenantId: string): Promise<string> {
    const rows = (await this.dataSource.query(
      `SELECT p.zona_horaria_principal AS zona_horaria
       FROM tenants t
       JOIN provincia pr
         ON pr.provincia_id = t.provincia_id
        AND pr.eliminado_el IS NULL
       JOIN pais p
         ON p.pais_id = pr.pais_id
        AND p.eliminado_el IS NULL
       WHERE t.tenant_id = $1
         AND t.eliminado_el IS NULL`,
      [tenantId],
    )) as Array<{ zona_horaria: string }>;
    if (!rows[0]?.zona_horaria) {
      throw new NotFoundException('No se encontró la zona horaria del tenant');
    }
    return rows[0].zona_horaria;
  }

  private async cobranzaYEstado(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<CobranzaRow> {
    const filtros = this.filtrosVenta(tenantId, rango, zona);
    const rows = (await this.dataSource.query(
      `WITH base AS (
         SELECT vp.*
         FROM venta_propina vp
         WHERE 1 = 1 ${filtros.sql}
       ),
       clasificada AS (
         SELECT b.*,
           EXISTS (
             SELECT 1
             FROM liquidacion_propinas_fuente f
             JOIN liquidacion_propinas l
               ON l.liquidacion_propinas_id = f.liquidacion_id
              AND l.tenant_id = $1
              AND l.estado = 'borrador'
              AND l.eliminado_el IS NULL
             WHERE f.tenant_id = $1
               AND f.venta_propina_id = b.venta_propina_id
               AND f.eliminado_el IS NULL
           ) AS en_borrador,
           EXISTS (
             SELECT 1
             FROM liquidacion_propinas l
             WHERE l.liquidacion_propinas_id = b.liquidacion_id
               AND l.tenant_id = $1
               AND l.estado = 'confirmada'
               AND l.eliminado_el IS NULL
           ) AS liquidada_confirmada
         FROM base b
       )
       SELECT
         COUNT(*)::text AS cierres,
         COUNT(*) FILTER (WHERE monto_pagado > 0)::text AS con_propina,
         COUNT(*) FILTER (WHERE monto_pagado = 0)::text AS sin_propina,
         COUNT(*) FILTER (
           WHERE monto_pagado > 0 AND monto_pagado = monto_sugerido
         )::text AS sugerencia_aceptada,
         COALESCE(SUM(monto_pagado), 0)::text AS monto_cobrado,
         COALESCE(SUM(monto_sugerido), 0)::text AS monto_sugerido,
         COALESCE(
           SUM(monto_pagado) FILTER (WHERE monto_pagado > 0)
             / NULLIF(COUNT(*) FILTER (WHERE monto_pagado > 0), 0),
           0
         )::text AS promedio_con_propina,
         COALESCE(
           COUNT(*) FILTER (WHERE monto_pagado > 0)::numeric
             / NULLIF(COUNT(*), 0),
           0
         )::text AS tasa_con_propina,
         COALESCE(
           COUNT(*) FILTER (
             WHERE monto_pagado > 0 AND monto_pagado = monto_sugerido
           )::numeric / NULLIF(COUNT(*) FILTER (WHERE monto_pagado > 0), 0),
           0
         )::text AS tasa_sugerencia_aceptada,
         COUNT(*) FILTER (
           WHERE monto_pagado > 0
             AND liquidacion_id IS NULL
             AND NOT en_borrador
         )::text AS pendiente_libre_cantidad,
         COALESCE(SUM(monto_pagado) FILTER (
           WHERE monto_pagado > 0
             AND liquidacion_id IS NULL
             AND NOT en_borrador
         ), 0)::text AS pendiente_libre_monto,
         COUNT(*) FILTER (
           WHERE monto_pagado > 0
             AND liquidacion_id IS NULL
             AND en_borrador
         )::text AS en_borrador_cantidad,
         COALESCE(SUM(monto_pagado) FILTER (
           WHERE monto_pagado > 0
             AND liquidacion_id IS NULL
             AND en_borrador
         ), 0)::text AS en_borrador_monto,
         COUNT(*) FILTER (
           WHERE monto_pagado > 0 AND liquidada_confirmada
         )::text AS liquidada_cantidad,
         COALESCE(SUM(monto_pagado) FILTER (
           WHERE monto_pagado > 0 AND liquidada_confirmada
         ), 0)::text AS liquidada_monto
       FROM clasificada`,
      filtros.params,
    )) as CobranzaRow[];
    return rows[0];
  }

  private async anulaciones(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<AnulacionRow> {
    const params: unknown[] = [tenantId, rango.desde, rango.hasta, zona];
    let filtroTurno = '';
    if (rango.turnoIds.length) {
      params.push(rango.turnoIds);
      filtroTurno = ` AND cardinality(l.turno_ids) > 0
        AND l.turno_ids <@ $${params.length}::uuid[]`;
    }
    const rows = (await this.dataSource.query(
      `SELECT
         COUNT(DISTINCT l.liquidacion_propinas_id)::text AS liquidaciones,
         COALESCE(SUM(f.monto_pagado), 0)::text AS monto_liberado
       FROM liquidacion_propinas l
       LEFT JOIN liquidacion_propinas_fuente f
         ON f.liquidacion_id = l.liquidacion_propinas_id
        AND f.tenant_id = $1
        AND f.eliminado_el IS NULL
       WHERE l.tenant_id = $1
         AND l.eliminado_el IS NULL
         AND l.estado = 'anulada'
         AND l.fecha_desde >= ($2::date::timestamp AT TIME ZONE $4)
         AND l.fecha_hasta <= ($3::date::timestamp AT TIME ZONE $4)
         ${filtroTurno}`,
      params,
    )) as AnulacionRow[];
    return rows[0];
  }

  private async tendencia(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<TendenciaRow[]> {
    const filtros = this.filtrosVenta(tenantId, rango, zona);
    return (await this.dataSource.query(
      `WITH dias AS (
         SELECT generate_series(
           $2::date,
           $3::date - 1,
           interval '1 day'
         )::date AS fecha
       ),
       agregado AS (
         SELECT
           (vp.creado_el AT TIME ZONE $4)::date AS fecha,
           COUNT(*) AS cierres,
           COUNT(*) FILTER (WHERE vp.monto_pagado > 0) AS con_propina,
           COALESCE(SUM(vp.monto_pagado), 0) AS monto_cobrado
         FROM venta_propina vp
         WHERE 1 = 1 ${filtros.sql}
         GROUP BY (vp.creado_el AT TIME ZONE $4)::date
       )
       SELECT
         to_char(d.fecha, 'YYYY-MM-DD') AS fecha,
         COALESCE(a.cierres, 0)::text AS cierres,
         COALESCE(a.con_propina, 0)::text AS con_propina,
         COALESCE(a.monto_cobrado, 0)::text AS monto_cobrado
       FROM dias d
       LEFT JOIN agregado a ON a.fecha = d.fecha
       ORDER BY d.fecha`,
      filtros.params,
    )) as TendenciaRow[];
  }

  private async porTurno(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<TurnoRow[]> {
    const filtros = this.filtrosVenta(tenantId, rango, zona);
    return (await this.dataSource.query(
      `SELECT
         vp.turno_id,
         MAX(t.nombre) AS turno_nombre,
         COUNT(*)::text AS cierres,
         COUNT(*) FILTER (WHERE vp.monto_pagado > 0)::text AS con_propina,
         COALESCE(SUM(vp.monto_pagado), 0)::text AS monto_cobrado
       FROM venta_propina vp
       LEFT JOIN turnos t
         ON t.turno_id = vp.turno_id
        AND t.tenant_id = $1
        AND t.eliminado_el IS NULL
       WHERE 1 = 1 ${filtros.sql}
       GROUP BY vp.turno_id
       ORDER BY monto_cobrado DESC, turno_nombre ASC NULLS LAST`,
      filtros.params,
    )) as TurnoRow[];
  }

  private async porTipo(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<TipoRow[]> {
    const filtros = this.filtrosVenta(tenantId, rango, zona);
    return (await this.dataSource.query(
      `SELECT
         vp.tipo_garzon,
         COUNT(*)::text AS cierres,
         COUNT(*) FILTER (WHERE vp.monto_pagado > 0)::text AS con_propina,
         COALESCE(SUM(vp.monto_pagado), 0)::text AS monto_cobrado
       FROM venta_propina vp
       WHERE 1 = 1 ${filtros.sql}
       GROUP BY vp.tipo_garzon
       ORDER BY monto_cobrado DESC, vp.tipo_garzon ASC NULLS LAST`,
      filtros.params,
    )) as TipoRow[];
  }

  private async solapadas(
    tenantId: string,
    rango: RangoReporteNormalizado,
    zona: string,
  ): Promise<number> {
    const params: unknown[] = [tenantId, rango.desde, rango.hasta, zona];
    let filtroTurno = '';
    if (rango.turnoIds.length) {
      params.push(rango.turnoIds);
      filtroTurno = ` AND cardinality(l.turno_ids) > 0
        AND l.turno_ids <@ $${params.length}::uuid[]`;
    }
    const rows = (await this.dataSource.query(
      `SELECT COUNT(*)::text AS cantidad
       FROM liquidacion_propinas l
       WHERE l.tenant_id = $1
         AND l.eliminado_el IS NULL
         AND l.estado IN ('confirmada', 'anulada')
         AND l.fecha_desde < ($3::date::timestamp AT TIME ZONE $4)
         AND l.fecha_hasta > ($2::date::timestamp AT TIME ZONE $4)
         AND NOT (
           l.fecha_desde >= ($2::date::timestamp AT TIME ZONE $4)
           AND l.fecha_hasta <= ($3::date::timestamp AT TIME ZONE $4)
         )
         ${filtroTurno}`,
      params,
    )) as Array<{ cantidad: NumericValue }>;
    return count(rows[0]?.cantidad);
  }
}
