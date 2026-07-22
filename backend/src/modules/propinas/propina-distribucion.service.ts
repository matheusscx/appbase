import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { PropinaConfiguracion } from './entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from './entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from './entities/propina-grupo-peso-manual.entity';
import { CriterioDistribucion } from './enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from './enums/base-ventas-grupo.enum';
import { ManualModo } from './enums/manual-modo.enum';
import {
  GrupoDistribucionDto,
  UpdateDistribucionDto,
} from './dto/update-distribucion.dto';

export interface GrupoDistribucionPublico {
  id: string;
  tipoGarzon: TipoGarzon;
  nombre: string;
  porcentaje: string;
  criterio: CriterioDistribucion;
  baseVentas: BaseVentasGrupo;
  manualModo: ManualModo | null;
  activo: boolean;
  orden: number;
  pesos: { garzonId: string; peso: string }[];
}

export interface DistribucionPublica {
  id: string;
  version: number;
  porcentajeSugerido: string;
  actualizadoPor: string | null;
  actualizadoEl: Date;
  grupos: GrupoDistribucionPublico[];
}

@Injectable()
export class PropinaDistribucionService {
  constructor(
    @InjectRepository(PropinaConfiguracion)
    private readonly configRepo: Repository<PropinaConfiguracion>,
    @InjectRepository(PropinaGrupoDistribucion)
    private readonly grupoRepo: Repository<PropinaGrupoDistribucion>,
    @InjectRepository(PropinaGrupoPesoManual)
    private readonly pesoRepo: Repository<PropinaGrupoPesoManual>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async obtener(tenantId: string): Promise<DistribucionPublica> {
    await this.asegurarDefault(tenantId);
    return this.cargarPublica(tenantId);
  }

  async asegurarDefault(tenantId: string): Promise<PropinaConfiguracion> {
    const existente = await this.configRepo.findOne({
      where: { tenantId, eliminadoEl: IsNull() },
    });
    if (existente) return existente;

    return this.dataSource.transaction(async (manager) => {
      const race = await manager.findOne(PropinaConfiguracion, {
        where: { tenantId, eliminadoEl: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (race) return race;

      const config = await manager.save(
        PropinaConfiguracion,
        manager.create(PropinaConfiguracion, {
          tenantId,
          version: 1,
          porcentajeSugerido: '0.10',
          actualizadoPor: null,
        }),
      );
      await manager.save(
        PropinaGrupoDistribucion,
        manager.create(PropinaGrupoDistribucion, {
          tenantId,
          configuracionId: config.id,
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'Garzones',
          porcentaje: '1.000000',
          criterio: CriterioDistribucion.PARTES_IGUALES,
          baseVentas: BaseVentasGrupo.TOTAL_FINAL,
          manualModo: null,
          activo: true,
          orden: 0,
        }),
      );
      return config;
    });
  }

  async obtenerPorcentajeSugerido(
    tenantId: string,
  ): Promise<{ porcentajeSugerido: string }> {
    const config = await this.asegurarDefault(tenantId);
    return { porcentajeSugerido: config.porcentajeSugerido };
  }

  async reemplazar(
    tenantId: string,
    usuarioId: string,
    dto: UpdateDistribucionDto,
  ): Promise<DistribucionPublica> {
    this.validarPorcentajeSugerido(dto.porcentajeSugerido);
    this.validarGrupos(dto.grupos);

    return this.dataSource.transaction(async (manager) => {
      let config = await manager.findOne(PropinaConfiguracion, {
        where: { tenantId, eliminadoEl: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!config) {
        config = await manager.save(
          PropinaConfiguracion,
          manager.create(PropinaConfiguracion, {
            tenantId,
            version: 1,
            porcentajeSugerido: '0.10',
            actualizadoPor: null,
          }),
        );
      }

      config.porcentajeSugerido = new Decimal(dto.porcentajeSugerido).toFixed(
        6,
      );

      const gruposPrevios = await manager.find(PropinaGrupoDistribucion, {
        where: { tenantId, configuracionId: config.id, eliminadoEl: IsNull() },
      });
      const grupoIds = gruposPrevios.map((g) => g.id);
      if (grupoIds.length > 0) {
        await manager.softDelete(PropinaGrupoPesoManual, {
          grupoId: In(grupoIds),
        });
        await manager.softDelete(PropinaGrupoDistribucion, {
          id: In(grupoIds),
        });
      }

      for (const g of dto.grupos) {
        const activo = g.activo !== false;
        const grupo = await manager.save(
          PropinaGrupoDistribucion,
          manager.create(PropinaGrupoDistribucion, {
            tenantId,
            configuracionId: config.id,
            tipoGarzon: g.tipoGarzon,
            nombre: g.nombre,
            porcentaje: new Decimal(g.porcentaje).toFixed(6),
            criterio: g.criterio,
            baseVentas: g.baseVentas ?? BaseVentasGrupo.TOTAL_FINAL,
            manualModo:
              g.criterio === CriterioDistribucion.MANUAL
                ? (g.manualModo ?? null)
                : null,
            activo,
            orden: g.orden ?? 0,
          }),
        );

        if (
          g.criterio === CriterioDistribucion.MANUAL &&
          g.manualModo === ManualModo.PESOS &&
          g.pesos?.length
        ) {
          for (const p of g.pesos) {
            if (new Decimal(p.peso).lte(0)) {
              throw new BadRequestException('El peso debe ser mayor a cero');
            }
            await manager.save(
              PropinaGrupoPesoManual,
              manager.create(PropinaGrupoPesoManual, {
                tenantId,
                grupoId: grupo.id,
                garzonId: p.garzonId,
                peso: new Decimal(p.peso).toFixed(4),
              }),
            );
          }
        }
      }

      config.version = config.version + 1;
      config.actualizadoPor = usuarioId;
      await manager.save(PropinaConfiguracion, config);

      return this.cargarPublica(tenantId, manager);
    });
  }

  private validarPorcentajeSugerido(porcentajeSugerido: string): void {
    const pct = new Decimal(porcentajeSugerido);
    if (pct.lt(0) || pct.gt(1)) {
      throw new BadRequestException(
        'porcentajeSugerido debe ser decimal (0.10 = 10%), no porcentaje entero',
      );
    }
  }

  private validarGrupos(grupos: GrupoDistribucionDto[]): void {
    const activos = grupos.filter((g) => g.activo !== false);

    let suma = new Decimal(0);
    const tipos = new Set<string>();
    for (const g of activos) {
      if (tipos.has(g.tipoGarzon)) {
        throw new BadRequestException(
          `Ya hay un grupo activo para el tipo ${g.tipoGarzon}`,
        );
      }
      tipos.add(g.tipoGarzon);
      suma = suma.plus(g.porcentaje);
    }

    if (!suma.equals(1)) {
      throw new BadRequestException(
        `La suma de porcentajes de grupos activos debe ser 100% (recibido ${suma.times(100).toFixed(2)}%)`,
      );
    }

    for (const g of grupos) {
      if (g.criterio === CriterioDistribucion.MANUAL) {
        if (!g.manualModo) {
          throw new BadRequestException(
            'El criterio MANUAL exige manualModo (PESOS o MONTOS)',
          );
        }
        if (g.manualModo === ManualModo.MONTOS && g.pesos?.length) {
          throw new BadRequestException(
            'En modo MONTOS no se configuran pesos (se capturan en la liquidación)',
          );
        }
      } else if (g.manualModo != null) {
        throw new BadRequestException(
          'manualModo solo aplica cuando el criterio es MANUAL',
        );
      } else if (g.pesos?.length) {
        throw new BadRequestException(
          'Los pesos solo aplican con criterio MANUAL y modo PESOS',
        );
      }
    }
  }

  private async cargarPublica(
    tenantId: string,
    manager?: DataSource['manager'],
  ): Promise<DistribucionPublica> {
    const repoConfig = manager
      ? manager.getRepository(PropinaConfiguracion)
      : this.configRepo;
    const repoGrupo = manager
      ? manager.getRepository(PropinaGrupoDistribucion)
      : this.grupoRepo;
    const repoPeso = manager
      ? manager.getRepository(PropinaGrupoPesoManual)
      : this.pesoRepo;

    const config = await repoConfig.findOneOrFail({
      where: { tenantId, eliminadoEl: IsNull() },
    });
    const grupos = await repoGrupo.find({
      where: { tenantId, configuracionId: config.id, eliminadoEl: IsNull() },
      order: { orden: 'ASC', creadoEl: 'ASC' },
    });
    const grupoIds = grupos.map((g) => g.id);
    const pesos =
      grupoIds.length === 0
        ? []
        : await repoPeso.find({
            where: { grupoId: In(grupoIds), eliminadoEl: IsNull() },
          });
    const pesosByGrupo = new Map<
      string,
      { garzonId: string; peso: string }[]
    >();
    for (const p of pesos) {
      const list = pesosByGrupo.get(p.grupoId) ?? [];
      list.push({ garzonId: p.garzonId, peso: p.peso });
      pesosByGrupo.set(p.grupoId, list);
    }

    return {
      id: config.id,
      version: config.version,
      porcentajeSugerido: config.porcentajeSugerido,
      actualizadoPor: config.actualizadoPor,
      actualizadoEl: config.actualizadoEl,
      grupos: grupos.map((g) => ({
        id: g.id,
        tipoGarzon: g.tipoGarzon,
        nombre: g.nombre,
        porcentaje: g.porcentaje,
        criterio: g.criterio,
        baseVentas: g.baseVentas,
        manualModo: g.manualModo,
        activo: g.activo,
        orden: g.orden,
        pesos: pesosByGrupo.get(g.id) ?? [],
      })),
    };
  }
}
