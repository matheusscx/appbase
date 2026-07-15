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
    const desde = unidades.find((u) => u.codigo === codigoDesde);
    const hacia = unidades.find((u) => u.codigo === codigoHacia);

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

    const original = new Decimal(cantidad);
    const convertida = original
      .mul(desde.factorBase)
      .div(hacia.factorBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

    if (convertida.isZero() && original.greaterThan(0)) {
      throw new BadRequestException(
        `La cantidad convertida (${original.toString()} ${codigoDesde} → ${codigoHacia}) es menor a la precisión de stock (4 decimales)`,
      );
    }

    return convertida.toString();
  }
}
