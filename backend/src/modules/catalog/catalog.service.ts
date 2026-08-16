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
   * query (evita el N+1 de llamar `convertirUnidad` por cada fila).
   *
   * **Aísla fila por fila: una conversión imposible devuelve `null`, no tira el
   * lote.** Antes era un `.map` pelado, así que un solo ingrediente con la
   * unidad rota —una receta que pide gramos de algo que pasó a medirse en
   * litros— hacía fallar la llamada entera. Como el único llamador es
   * `calcularDisponibilidadBatch`, y ese cuelga de `findAll`, el efecto medido
   * era que **`GET /items` dejaba de responder para todo el tenant**, el menú
   * del POS incluido, hasta arreglar la fila a mano.
   *
   * Que sea tolerante importa más que el guard que evita el caso nuevo: protege
   * también contra las filas que ya puedan estar rotas hoy.
   */
  async convertirUnidades(
    conversiones: { cantidad: string; desde: string; hacia: string }[],
  ): Promise<(string | null)[]> {
    const codigos = [
      ...new Set(conversiones.flatMap((c) => [c.desde, c.hacia])),
    ];
    const unidades = codigos.length
      ? await this.unidadMedidaRepo.find({ where: { codigo: In(codigos) } })
      : [];
    const mapa = new Map(unidades.map((u) => [u.codigo, u]));
    return conversiones.map((c) => {
      try {
        return this.convertirConMapa(c.cantidad, c.desde, c.hacia, mapa);
      } catch (e) {
        // Acotado al error esperado —unidad desconocida, magnitud incompatible,
        // cantidad bajo la precisión— y no un `catch {}` pelado: un fallo
        // inesperado acá alimenta disponibilidad y costo, así que tiene que
        // seguir saliendo como 500 ruidoso en vez de disfrazarse de "unidad
        // rota" y devolver un dato de negocio equivocado en silencio.
        if (e instanceof BadRequestException) return null;
        throw e;
      }
    });
  }

  /**
   * Devuelve un conversor con el catálogo **ya cargado**: una query, y después
   * conversiones en memoria con la misma semántica de error que
   * `convertirUnidad`.
   *
   * Existe para los loops que validan fila por fila: `convertirUnidades` obliga
   * a resolver todas las conversiones **antes** del loop, lo que adelanta sus
   * errores por encima de las validaciones estructurales y cambia cuál de dos
   * 400 gana. Con el conversor, la conversión sigue ocurriendo en el mismo punto
   * del loop —mismo orden de errores— sin una query por iteración.
   */
  async crearConversor(): Promise<
    (cantidad: string, desde: string, hacia: string) => string
  > {
    const unidades = await this.unidadMedidaRepo.find();
    const mapa = new Map(unidades.map((u) => [u.codigo, u]));
    return (cantidad, desde, hacia) =>
      this.convertirConMapa(cantidad, desde, hacia, mapa);
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
