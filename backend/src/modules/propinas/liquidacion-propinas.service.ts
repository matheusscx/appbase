import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { BaseVentasGrupo } from './enums/base-ventas-grupo.enum';
import { CriterioDistribucion } from './enums/criterio-distribucion.enum';
import { EstadoLiquidacion } from './enums/estado-liquidacion.enum';
import { ManualModo } from './enums/manual-modo.enum';
import { OrigenParticipante } from './enums/origen-participante.enum';
import { TipoEventoLiquidacion } from './enums/tipo-evento-liquidacion.enum';
import { LiquidacionPropinas } from './entities/liquidacion-propinas.entity';
import { LiquidacionPropinasEvento } from './entities/liquidacion-propinas-evento.entity';
import { LiquidacionPropinasFuente } from './entities/liquidacion-propinas-fuente.entity';
import { LiquidacionPropinasGrupo } from './entities/liquidacion-propinas-grupo.entity';
import { LiquidacionPropinasParticipante } from './entities/liquidacion-propinas-participante.entity';
import {
  DistribucionPublica,
  GrupoDistribucionPublico,
  PropinaDistribucionService,
} from './propina-distribucion.service';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { horasInterseccionHoras } from './utils/horas-interseccion';
import { repartirMayoresRestos } from './utils/mayores-restos';

interface MonedaOficialRow {
  moneda_id: string;
  decimales: number | string;
}

interface TipElegibleRow {
  venta_propina_id: string;
  garzon_id: string;
  tipo_garzon: TipoGarzon | null;
  turno_id: string | null;
  monto_pagado: string;
  venta_id: string;
  base_ventas_total_final: string;
  base_ventas_sin_impuestos: string;
}

interface SesionRow {
  sesion_garzon_id: string;
  garzon_id: string;
  tipo_garzon: TipoGarzon;
  turno_id: string;
  inicio_el: Date | string;
  fin_el: Date | string | null;
}

export interface LiquidacionResumen {
  id: string;
  estado: EstadoLiquidacion;
  fechaDesde: Date;
  fechaHasta: Date;
  poolTotal: string;
  configuracionVersion: number;
  creadoEl: Date;
}

export interface LiquidacionDetalle extends LiquidacionResumen {
  turnoIds: string[];
  monedaId: string;
  decimalesMoneda: number;
  creadoPor: string;
  confirmadoPor: string | null;
  confirmadoEl: Date | null;
  anuladoPor: string | null;
  anuladoEl: Date | null;
  motivoAnulacion: string | null;
  grupos: LiquidacionPropinasGrupo[];
  participantes: LiquidacionPropinasParticipante[];
  fuentes: LiquidacionPropinasFuente[];
  eventos: LiquidacionPropinasEvento[];
  advertencias: string[];
}

@Injectable()
export class LiquidacionPropinasService {
  constructor(
    @InjectRepository(LiquidacionPropinas)
    private readonly liquidacionRepo: Repository<LiquidacionPropinas>,
    @InjectRepository(LiquidacionPropinasGrupo)
    private readonly grupoRepo: Repository<LiquidacionPropinasGrupo>,
    @InjectRepository(LiquidacionPropinasParticipante)
    private readonly participanteRepo: Repository<LiquidacionPropinasParticipante>,
    @InjectRepository(LiquidacionPropinasFuente)
    private readonly fuenteRepo: Repository<LiquidacionPropinasFuente>,
    @InjectRepository(LiquidacionPropinasEvento)
    private readonly eventoRepo: Repository<LiquidacionPropinasEvento>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly distribucion: PropinaDistribucionService,
  ) {}

  async crear(
    tenantId: string,
    usuarioId: string,
    dto: CreateLiquidacionDto,
  ): Promise<LiquidacionDetalle> {
    const fechaDesde = new Date(dto.fechaDesde);
    const fechaHasta = new Date(dto.fechaHasta);
    if (fechaHasta <= fechaDesde) {
      throw new BadRequestException('La fecha hasta debe ser posterior a desde');
    }

    const config = await this.distribucion.obtener(tenantId);
    const gruposConfig = config.grupos.filter((g) => g.activo);
    if (gruposConfig.length === 0) {
      throw new BadRequestException('No hay grupos activos para liquidar');
    }
    const turnoIds = dto.turnoIds ?? [];

    return this.dataSource.transaction(async (manager) => {
      const moneda = await this.resolverMonedaOficial(manager, tenantId);
      const tips = await this.buscarTipsElegibles(
        manager,
        tenantId,
        fechaDesde,
        fechaHasta,
        turnoIds,
      );
      const sesiones = await this.buscarSesionesPeriodo(
        manager,
        tenantId,
        fechaDesde,
        fechaHasta,
        turnoIds,
      );
      const poolTotal = tips
        .reduce((acc, t) => acc.plus(t.monto_pagado), new Decimal(0))
        .toFixed(4);

      const liquidacion = await manager.save(
        LiquidacionPropinas,
        manager.create(LiquidacionPropinas, {
          tenantId,
          fechaDesde,
          fechaHasta,
          turnoIds,
          estado: EstadoLiquidacion.BORRADOR,
          poolTotal,
          configuracionVersion: config.version,
          monedaId: moneda.monedaId,
          decimalesMoneda: moneda.decimales,
          creadoPor: usuarioId,
        }),
      );

      const grupos = await this.crearSnapshotGrupos(
        manager,
        tenantId,
        liquidacion.id,
        poolTotal,
        moneda.decimales,
        gruposConfig,
      );
      const fuentes = await this.crearFuentes(
        manager,
        tenantId,
        liquidacion.id,
        tips,
      );
      const participantes = await this.crearParticipantes(
        manager,
        tenantId,
        liquidacion.id,
        grupos,
        gruposConfig,
        tips,
        sesiones,
        fechaDesde,
        fechaHasta,
        moneda.decimales,
      );
      const advertencias = this.advertenciasSesionesAbiertas(sesiones);
      const evento = await manager.save(
        LiquidacionPropinasEvento,
        manager.create(LiquidacionPropinasEvento, {
          tenantId,
          liquidacionId: liquidacion.id,
          tipo: TipoEventoLiquidacion.CREADA,
          payload: {
            fuenteCount: fuentes.length,
            poolTotal,
            configuracionVersion: config.version,
          },
          usuarioId,
        }),
      );

      return this.toDetalle(liquidacion, {
        grupos,
        participantes,
        fuentes,
        eventos: [evento],
        advertencias,
      });
    });
  }

  async listar(tenantId: string): Promise<LiquidacionResumen[]> {
    const rows = await this.liquidacionRepo.find({
      where: { tenantId, eliminadoEl: IsNull() },
      order: { creadoEl: 'DESC' },
    });
    return rows.map((r) => this.toResumen(r));
  }

  async detalle(tenantId: string, id: string): Promise<LiquidacionDetalle> {
    const liquidacion = await this.liquidacionRepo.findOne({
      where: { id, tenantId, eliminadoEl: IsNull() },
    });
    if (!liquidacion) {
      throw new NotFoundException('Liquidación no encontrada');
    }

    const [grupos, participantes, fuentes, eventos] = await Promise.all([
      this.grupoRepo.find({
        where: { liquidacionId: id, eliminadoEl: IsNull() },
        order: { orden: 'ASC', creadoEl: 'ASC' },
      }),
      this.participanteRepo.find({
        where: { liquidacionId: id, eliminadoEl: IsNull() },
        order: { creadoEl: 'ASC' },
      }),
      this.fuenteRepo.find({
        where: { liquidacionId: id, eliminadoEl: IsNull() },
        order: { creadoEl: 'ASC' },
      }),
      this.eventoRepo.find({
        where: { liquidacionId: id, eliminadoEl: IsNull() },
        order: { creadoEl: 'ASC' },
      }),
    ]);

    return this.toDetalle(liquidacion, {
      grupos,
      participantes,
      fuentes,
      eventos,
      advertencias: [],
    });
  }

  private async resolverMonedaOficial(
    manager: EntityManager,
    tenantId: string,
  ): Promise<{ monedaId: string; decimales: number }> {
    const rows: MonedaOficialRow[] = await manager.query(
      `SELECT m.moneda_id, m.decimales
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN moneda m ON m.moneda_id = p.moneda_oficial_id
            AND m.eliminado_el IS NULL
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    if (rows.length === 0) {
      throw new BadRequestException('No se encontró moneda oficial del tenant');
    }
    return {
      monedaId: rows[0].moneda_id,
      decimales: Number(rows[0].decimales),
    };
  }

  private async buscarTipsElegibles(
    manager: EntityManager,
    tenantId: string,
    fechaDesde: Date,
    fechaHasta: Date,
    turnoIds: string[],
  ): Promise<TipElegibleRow[]> {
    return manager.query(
      `SELECT vp.venta_propina_id,
              vp.garzon_id,
              vp.tipo_garzon,
              vp.turno_id,
              vp.monto_pagado,
              vp.venta_id,
              v.base_ventas_total_final,
              v.base_ventas_sin_impuestos
       FROM venta_propina vp
       JOIN ventas v ON v.venta_id = vp.venta_id AND v.eliminado_el IS NULL
       WHERE vp.tenant_id = $1
         AND vp.eliminado_el IS NULL
         AND vp.liquidacion_id IS NULL
         AND vp.monto_pagado > 0
         AND vp.creado_el >= $2
         AND vp.creado_el < $3
         AND (cardinality($4::uuid[]) = 0 OR vp.turno_id = ANY($4::uuid[]))
       ORDER BY vp.creado_el ASC`,
      [tenantId, fechaDesde, fechaHasta, turnoIds],
    );
  }

  private async buscarSesionesPeriodo(
    manager: EntityManager,
    tenantId: string,
    fechaDesde: Date,
    fechaHasta: Date,
    turnoIds: string[],
  ): Promise<SesionRow[]> {
    return manager.query(
      `SELECT sesion_garzon_id, garzon_id, tipo_garzon, turno_id, inicio_el, fin_el
       FROM sesiones_garzon
       WHERE tenant_id = $1
         AND eliminado_el IS NULL
         AND inicio_el < $3
         AND COALESCE(fin_el, NOW()) > $2
         AND (cardinality($4::uuid[]) = 0 OR turno_id = ANY($4::uuid[]))
       ORDER BY inicio_el ASC`,
      [tenantId, fechaDesde, fechaHasta, turnoIds],
    );
  }

  private async crearSnapshotGrupos(
    manager: EntityManager,
    tenantId: string,
    liquidacionId: string,
    poolTotal: string,
    decimales: number,
    gruposConfig: GrupoDistribucionPublico[],
  ): Promise<LiquidacionPropinasGrupo[]> {
    const montosGrupo = new Map(
      repartirMayoresRestos(
        poolTotal,
        gruposConfig.map((g) => ({ id: g.id, peso: g.porcentaje })),
        decimales,
      ).map((r) => [r.id, new Decimal(r.monto).toFixed(4)] as const),
    );

    const grupos: LiquidacionPropinasGrupo[] = [];
    for (const g of gruposConfig) {
      const grupo = await manager.save(
        LiquidacionPropinasGrupo,
        manager.create(LiquidacionPropinasGrupo, {
          tenantId,
          liquidacionId,
          tipoGarzon: g.tipoGarzon,
          nombre: g.nombre,
          porcentaje: new Decimal(g.porcentaje).toFixed(6),
          criterio: g.criterio,
          baseVentas: g.baseVentas,
          manualModo: g.manualModo,
          montoGrupo: montosGrupo.get(g.id) ?? '0.0000',
          orden: g.orden,
        }),
      );
      grupos.push(grupo);
    }
    return grupos;
  }

  private async crearFuentes(
    manager: EntityManager,
    tenantId: string,
    liquidacionId: string,
    tips: TipElegibleRow[],
  ): Promise<LiquidacionPropinasFuente[]> {
    const fuentes: LiquidacionPropinasFuente[] = [];
    for (const tip of tips) {
      fuentes.push(
        await manager.save(
          LiquidacionPropinasFuente,
          manager.create(LiquidacionPropinasFuente, {
            tenantId,
            liquidacionId,
            ventaPropinaId: tip.venta_propina_id,
            montoPagado: new Decimal(tip.monto_pagado).toFixed(4),
          }),
        ),
      );
    }
    return fuentes;
  }

  private async crearParticipantes(
    manager: EntityManager,
    tenantId: string,
    liquidacionId: string,
    grupos: LiquidacionPropinasGrupo[],
    gruposConfig: GrupoDistribucionPublico[],
    tips: TipElegibleRow[],
    sesiones: SesionRow[],
    fechaDesde: Date,
    fechaHasta: Date,
    decimales: number,
  ): Promise<LiquidacionPropinasParticipante[]> {
    const participantes: LiquidacionPropinasParticipante[] = [];
    const gruposByTipo = new Map(grupos.map((g) => [g.tipoGarzon, g]));
    const configByTipo = new Map(gruposConfig.map((g) => [g.tipoGarzon, g]));

    for (const [tipo, grupo] of gruposByTipo.entries()) {
      const config = configByTipo.get(tipo);
      if (!config) continue;
      const garzonIds = this.garzonesGrupo(tipo, tips, sesiones);
      const borradores = garzonIds.map((garzonId) =>
        this.crearParticipanteData({
          tenantId,
          liquidacionId,
          grupo,
          config,
          garzonId,
          tips,
          sesiones,
          fechaDesde,
          fechaHasta,
        }),
      );
      const repartidos = this.repartirGrupo(grupo, config, borradores, decimales);

      for (const data of repartidos) {
        participantes.push(
          await manager.save(
            LiquidacionPropinasParticipante,
            manager.create(LiquidacionPropinasParticipante, data),
          ),
        );
      }
    }
    return participantes;
  }

  private garzonesGrupo(
    tipo: TipoGarzon,
    tips: TipElegibleRow[],
    sesiones: SesionRow[],
  ): string[] {
    return [
      ...new Set([
        ...tips
          .filter((t) => t.tipo_garzon === tipo)
          .map((t) => t.garzon_id),
        ...sesiones
          .filter((s) => s.tipo_garzon === tipo)
          .map((s) => s.garzon_id),
      ]),
    ].sort();
  }

  private crearParticipanteData(args: {
    tenantId: string;
    liquidacionId: string;
    grupo: LiquidacionPropinasGrupo;
    config: GrupoDistribucionPublico;
    garzonId: string;
    tips: TipElegibleRow[];
    sesiones: SesionRow[];
    fechaDesde: Date;
    fechaHasta: Date;
  }): Omit<
    LiquidacionPropinasParticipante,
    'id' | 'creadoEl' | 'actualizadoEl' | 'eliminadoEl'
  > {
    const tipsGarzon = args.tips.filter((t) => t.garzon_id === args.garzonId);
    const sesionesGarzon = args.sesiones.filter(
      (s) => s.garzon_id === args.garzonId && s.tipo_garzon === args.grupo.tipoGarzon,
    );
    const ventasBase = tipsGarzon.reduce((acc, tip) => {
      const base =
        args.grupo.baseVentas === BaseVentasGrupo.BASE_SIN_IMPUESTOS
          ? tip.base_ventas_sin_impuestos
          : tip.base_ventas_total_final;
      return acc.plus(base);
    }, new Decimal(0));
    const horas = sesionesGarzon.reduce((acc, sesion) => {
      const fin = sesion.fin_el ? new Date(sesion.fin_el) : new Date();
      return acc.plus(
        horasInterseccionHoras(
          new Date(sesion.inicio_el),
          fin,
          args.fechaDesde,
          args.fechaHasta,
        ),
      );
    }, new Decimal(0));
    const pesoConfig = args.config.pesos.find(
      (p) => p.garzonId === args.garzonId,
    )?.peso;

    return {
      tenantId: args.tenantId,
      liquidacionId: args.liquidacionId,
      grupoId: args.grupo.id,
      garzonId: args.garzonId,
      tipoGarzon: args.grupo.tipoGarzon,
      incluido: true,
      origen: OrigenParticipante.SUGERIDO,
      motivoAjuste: null,
      horas: horas.toFixed(4),
      ventasBase: ventasBase.toFixed(4),
      cuentas: new Decimal(tipsGarzon.length).toFixed(4),
      pesoManual:
        args.grupo.criterio === CriterioDistribucion.MANUAL &&
        args.grupo.manualModo === ManualModo.PESOS
          ? (pesoConfig ?? null)
          : null,
      monto: '0.0000',
      ajusteMotivoMonto: null,
    };
  }

  private repartirGrupo(
    grupo: LiquidacionPropinasGrupo,
    config: GrupoDistribucionPublico,
    participantes: Omit<
      LiquidacionPropinasParticipante,
      'id' | 'creadoEl' | 'actualizadoEl' | 'eliminadoEl'
    >[],
    decimales: number,
  ): Omit<
    LiquidacionPropinasParticipante,
    'id' | 'creadoEl' | 'actualizadoEl' | 'eliminadoEl'
  >[] {
    if (participantes.length === 0) return [];
    if (
      grupo.criterio === CriterioDistribucion.MANUAL &&
      grupo.manualModo === ManualModo.MONTOS
    ) {
      return participantes;
    }

    const pesos = participantes.map((p) => ({
      id: p.garzonId,
      peso: this.pesoParticipante(p, grupo.criterio, config.manualModo),
    }));
    const montos = new Map(
      repartirMayoresRestos(grupo.montoGrupo, pesos, decimales).map((r) => [
        r.id,
        new Decimal(r.monto).toFixed(4),
      ]),
    );
    return participantes.map((p) => ({
      ...p,
      monto: montos.get(p.garzonId) ?? '0.0000',
    }));
  }

  private pesoParticipante(
    participante: Pick<
      LiquidacionPropinasParticipante,
      'horas' | 'ventasBase' | 'cuentas' | 'pesoManual'
    >,
    criterio: CriterioDistribucion,
    manualModo: ManualModo | null,
  ): string {
    if (criterio === CriterioDistribucion.PARTES_IGUALES) return '1';
    if (criterio === CriterioDistribucion.VENTAS_NETAS) {
      return participante.ventasBase;
    }
    if (criterio === CriterioDistribucion.HORAS_TRABAJADAS) {
      return participante.horas;
    }
    if (criterio === CriterioDistribucion.CANTIDAD_CUENTAS) {
      return participante.cuentas;
    }
    if (criterio === CriterioDistribucion.MANUAL && manualModo === ManualModo.PESOS) {
      return participante.pesoManual ?? '0';
    }
    return '0';
  }

  private advertenciasSesionesAbiertas(sesiones: SesionRow[]): string[] {
    const abiertas = sesiones.filter((s) => s.fin_el == null);
    if (abiertas.length === 0) return [];
    return [
      `${abiertas.length} sesión(es) abierta(s) fueron calculadas hasta este momento`,
    ];
  }

  private toResumen(liquidacion: LiquidacionPropinas): LiquidacionResumen {
    return {
      id: liquidacion.id,
      estado: liquidacion.estado,
      fechaDesde: liquidacion.fechaDesde,
      fechaHasta: liquidacion.fechaHasta,
      poolTotal: liquidacion.poolTotal,
      configuracionVersion: liquidacion.configuracionVersion,
      creadoEl: liquidacion.creadoEl,
    };
  }

  private toDetalle(
    liquidacion: LiquidacionPropinas,
    detalle: Pick<
      LiquidacionDetalle,
      'grupos' | 'participantes' | 'fuentes' | 'eventos' | 'advertencias'
    >,
  ): LiquidacionDetalle {
    return {
      ...this.toResumen(liquidacion),
      turnoIds: liquidacion.turnoIds,
      monedaId: liquidacion.monedaId,
      decimalesMoneda: liquidacion.decimalesMoneda,
      creadoPor: liquidacion.creadoPor,
      confirmadoPor: liquidacion.confirmadoPor ?? null,
      confirmadoEl: liquidacion.confirmadoEl ?? null,
      anuladoPor: liquidacion.anuladoPor ?? null,
      anuladoEl: liquidacion.anuladoEl ?? null,
      motivoAnulacion: liquidacion.motivoAnulacion ?? null,
      grupos: detalle.grupos,
      participantes: detalle.participantes,
      fuentes: detalle.fuentes,
      eventos: detalle.eventos,
      advertencias: detalle.advertencias,
    };
  }
}
