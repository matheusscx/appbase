import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';
import { UnidadMedida } from './entities/unidad-medida.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(Pais)
    private readonly paisRepo: Repository<Pais>,
    @InjectRepository(Provincia)
    private readonly provinciaRepo: Repository<Provincia>,
    @InjectRepository(UnidadMedida)
    private readonly unidadMedidaRepo: Repository<UnidadMedida>,
  ) {}

  findAllModulos(): Promise<ModuloApp[]> {
    return this.moduloAppRepo.find();
  }

  findAllPermisos(): Promise<Permiso[]> {
    return this.permisoRepo.find();
  }

  findAllPaises(): Promise<Pais[]> {
    return this.paisRepo.find({
      order: { nombre: 'ASC' },
    });
  }

  findAllProvincias(paisId?: string): Promise<Provincia[]> {
    return this.provinciaRepo.find({
      where: paisId ? { paisId } : {},
      order: { nombre: 'ASC' },
    });
  }

  findAllUnidadesMedida(): Promise<UnidadMedida[]> {
    return this.unidadMedidaRepo.find({
      order: { magnitud: 'ASC', factorBase: 'ASC' },
    });
  }

  /**
   * Convierte una cantidad entre dos unidades de la misma magnitud.
   * Solo dentro de una magnitud: pasar de litros a kilos exigiría la densidad
   * del insumo, que el sistema no modela — fallar es más honesto que adivinar.
   */
  async convertirUnidad(
    cantidad: string,
    codigoDesde: string,
    codigoHacia: string,
  ): Promise<string> {
    if (codigoDesde === codigoHacia) return cantidad;

    const unidades = await this.unidadMedidaRepo.find({
      where: { codigo: In([codigoDesde, codigoHacia]) },
    });
    const mapa = new Map(unidades.map((u) => [u.codigo, u]));
    return this.convertirConMapa(cantidad, codigoDesde, codigoHacia, mapa);
  }

  /**
   * Versión batch: convierte muchas cantidades cargando las unidades en UNA sola
   * query (evita el N+1 de llamar `convertirUnidad` por cada fila). Preserva la
   * misma semántica de error, unidad por unidad.
   */
  async convertirUnidades(
    conversiones: { cantidad: string; desde: string; hacia: string }[],
  ): Promise<string[]> {
    const codigos = [
      ...new Set(conversiones.flatMap((c) => [c.desde, c.hacia])),
    ];
    const unidades = codigos.length
      ? await this.unidadMedidaRepo.find({ where: { codigo: In(codigos) } })
      : [];
    const mapa = new Map(unidades.map((u) => [u.codigo, u]));
    return conversiones.map((c) =>
      this.convertirConMapa(c.cantidad, c.desde, c.hacia, mapa),
    );
  }

  /** Cálculo puro de conversión sobre un mapa de unidades ya cargado. */
  private convertirConMapa(
    cantidad: string,
    codigoDesde: string,
    codigoHacia: string,
    unidades: Map<string, UnidadMedida>,
  ): string {
    if (codigoDesde === codigoHacia) return cantidad;

    const desde = unidades.get(codigoDesde);
    const hacia = unidades.get(codigoHacia);

    if (!desde) {
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigoDesde}`,
      );
    }
    if (!hacia) {
      throw new BadRequestException(
        `Unidad de medida no reconocida: ${codigoHacia}`,
      );
    }
    if (desde.magnitud !== hacia.magnitud) {
      throw new BadRequestException(
        `No se puede convertir de ${desde.magnitud} a ${hacia.magnitud}`,
      );
    }

    const factorDesde = new Decimal(desde.factorBase);
    const factorHacia = new Decimal(hacia.factorBase);
    if (
      factorDesde.lessThanOrEqualTo(0) ||
      factorHacia.lessThanOrEqualTo(0) ||
      factorDesde.isNaN() ||
      factorHacia.isNaN()
    ) {
      throw new BadRequestException(
        'El factor de conversión de la unidad debe ser mayor a 0',
      );
    }

    const original = new Decimal(cantidad);
    const convertida = original
      .mul(factorDesde)
      .div(factorHacia)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    if (convertida.isZero() && original.greaterThan(0)) {
      throw new BadRequestException(
        `La cantidad convertida (${original.toString()} ${codigoDesde} → ${codigoHacia}) es menor a la precisión de stock (4 decimales)`,
      );
    }

    return convertida.toString();
  }
}
