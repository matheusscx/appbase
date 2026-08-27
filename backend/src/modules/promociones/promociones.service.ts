import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type EntityManager } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { traducirColisionDeNombre } from '../../common/utils/nombre-sugerido.util';
import { Promocion, type TipoPromocion } from './entities/promocion.entity';
import { PromocionScope } from './entities/promocion-scope.entity';
import { PromocionScopeItem } from './entities/promocion-scope-item.entity';
import { CreatePromocionDto, ScopePromoDto } from './dto/create-promocion.dto';
import { UpdatePromocionDto } from './dto/update-promocion.dto';

export type ScopeConItems = {
  id: string;
  slot: number;
  tipoScope: string;
  categoriaId: string | null;
  cantidad: number;
  itemIds: string[];
};

export type PromocionConScopes = Promocion & { scopes: ScopeConItems[] };

/**
 * Subconjunto de campos que decide la forma del beneficio (columnas que
 * `chk_promociones_valor_segun_tipo` exige llenar/vaciar según `tipo`).
 * Comparten `create` (el DTO entero) y `update` (el estado RESULTANTE de un
 * PATCH parcial, igual que `validarEstadoResultante` en descuentos).
 */
interface FormaSegunTipo {
  valorPorcentaje?: string | null;
  cadaN?: number | null;
  valorMonto?: string | null;
}

interface FechasYHorario {
  fechaInicio?: string | null;
  fechaFin?: string | null;
  horaInicio?: string | null;
  horaFin?: string | null;
}

@Injectable()
export class PromocionesService {
  constructor(
    private readonly db: Db,
    @InjectRepository(Promocion)
    private readonly promocionRepo: Repository<Promocion>,
    @InjectRepository(PromocionScope)
    private readonly scopeRepo: Repository<PromocionScope>,
    @InjectRepository(PromocionScopeItem)
    private readonly scopeItemRepo: Repository<PromocionScopeItem>,
  ) {}

  /** Promos vivas del tenant, con sus scopes (y los `itemIds` de cada uno). */
  async findAll(tenantId: string): Promise<PromocionConScopes[]> {
    const promos = await this.promocionRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
    const ids = promos.map((p) => p.id);

    const scopes = ids.length
      ? await this.scopeRepo.find({
          where: { promocionId: In(ids) },
          order: { slot: 'ASC' },
        })
      : [];
    const scopeIds = scopes.map((s) => s.id);
    const scopeItems = scopeIds.length
      ? await this.scopeItemRepo.find({ where: { scopeId: In(scopeIds) } })
      : [];

    return promos.map((p) => this.conScopes(p, scopes, scopeItems));
  }

  async create(
    tenantId: string,
    dto: CreatePromocionDto,
  ): Promise<PromocionConScopes> {
    this.validarFechas(dto);
    await this.validarNombreUnico(tenantId, dto.nombre);
    this.validarHorario(dto);
    this.validarFormaSegunTipo(dto.tipo, dto);
    this.validarScopes(dto.tipo, dto.scopes);

    const escritura = this.db.transaccion(async (manager) => {
      const promo = manager.create(Promocion, {
        tenantId,
        nombre: dto.nombre,
        descripcion: dto.descripcion ?? null,
        activo: dto.activo ?? true,
        fechaInicio: dto.fechaInicio,
        fechaFin: dto.fechaFin,
        horaInicio: dto.horaInicio ?? null,
        horaFin: dto.horaFin ?? null,
        diasSemana: dto.diasSemana ?? null,
        canal: dto.canal ?? null,
        tipo: dto.tipo,
        valorPorcentaje: dto.valorPorcentaje ?? null,
        cadaN: dto.cadaN ?? null,
        valorMonto: dto.valorMonto ?? null,
      });
      await manager.save(promo);

      const { scopes, scopeItems } = await this.crearHijos(
        manager,
        promo.id,
        dto.scopes,
      );

      return this.conScopes(promo, scopes, scopeItems);
    });
    return traducirColisionDeNombre(escritura, () =>
      this.validarNombreUnico(tenantId, dto.nombre),
    );
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdatePromocionDto,
  ): Promise<PromocionConScopes> {
    const promo = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException(`Promoción ${id} no encontrada`);

    // El estado CON EL QUE VA A QUEDAR la fila, no los campos que trajo el
    // PATCH — mismo principio que `validarEstadoResultante` en descuentos:
    // un PATCH parcial no reenvía necesariamente los campos hermanos que la
    // forma por tipo necesita mirar juntos.
    const tipoResultante: TipoPromocion = dto.tipo ?? promo.tipo;
    const forma: FormaSegunTipo = {
      valorPorcentaje:
        dto.valorPorcentaje !== undefined
          ? dto.valorPorcentaje
          : promo.valorPorcentaje,
      cadaN: dto.cadaN !== undefined ? dto.cadaN : promo.cadaN,
      valorMonto:
        dto.valorMonto !== undefined ? dto.valorMonto : promo.valorMonto,
    };
    const fechasYHorario: FechasYHorario = {
      fechaInicio:
        dto.fechaInicio !== undefined ? dto.fechaInicio : promo.fechaInicio,
      fechaFin: dto.fechaFin !== undefined ? dto.fechaFin : promo.fechaFin,
      horaInicio:
        dto.horaInicio !== undefined ? dto.horaInicio : promo.horaInicio,
      horaFin: dto.horaFin !== undefined ? dto.horaFin : promo.horaFin,
    };

    await this.validarNombreUnico(tenantId, dto.nombre ?? promo.nombre, id);
    this.validarFechas(fechasYHorario);
    this.validarHorario(fechasYHorario);
    this.validarFormaSegunTipo(tipoResultante, forma);
    if (dto.scopes !== undefined) {
      this.validarScopes(tipoResultante, dto.scopes);
    } else if (tipoResultante !== promo.tipo) {
      // El PATCH cambia `tipo` pero no reenvía `scopes`: los que ya están
      // guardados quedan TAL CUAL, y si el tipo nuevo exige otra
      // cardinalidad (`porcentaje`/`nxm` = exactamente 1) la fila queda en
      // un estado que `create()` nunca deja pasar — mismo principio que
      // `validarEstadoResultante` en descuentos releyendo los tramos
      // guardados cuando el PATCH no los trae.
      await this.validarCardinalidadDeScopesExistentes(tipoResultante, id);
    }

    const escritura = this.db.transaccion(async (manager) => {
      Object.assign(promo, dto);
      await manager.save(promo);

      // Los hijos que NO cambian: los del PATCH que no tocó `scopes`.
      let scopes = await this.scopeRepo.find({ where: { promocionId: id } });
      let scopeItems = scopes.length
        ? await this.scopeItemRepo.find({
            where: { scopeId: In(scopes.map((s) => s.id)) },
          })
        : [];

      // Reemplazo completo (delete-all → insert), igual que descuentos con
      // sus tramos/métodos: solo cuando el PATCH trae `scopes` explícito.
      if (dto.scopes !== undefined) {
        const scopeIdsViejos = scopes.map((s) => s.id);
        await manager.softDelete(PromocionScope, { promocionId: id });
        // La tabla puente también tiene que apagarse: `softDelete` sobre
        // `PromocionScope` NO toca `promocion_scope_items` (bridge propio,
        // sin cascada), así que sin esto los ítems del scope reemplazado
        // quedan huérfanos y VIVOS. Molde exacto de
        // `descuentos.service.ts` con `DescuentoMetodoPago`.
        if (scopeIdsViejos.length) {
          await manager.update(
            PromocionScopeItem,
            { scopeId: In(scopeIdsViejos) },
            { eliminadoEl: new Date() },
          );
        }
        const hijos = await this.crearHijos(manager, id, dto.scopes);
        scopes = hijos.scopes;
        scopeItems = hijos.scopeItems;
      }

      return this.conScopes(promo, scopes, scopeItems);
    });
    return traducirColisionDeNombre(escritura, () =>
      this.validarNombreUnico(tenantId, dto.nombre ?? promo.nombre, id),
    );
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const promo = await this.promocionRepo.findOne({ where: { id, tenantId } });
    if (!promo) throw new NotFoundException(`Promoción ${id} no encontrada`);
    // Soft delete de la promo solamente: los scopes/scope_items no se tocan,
    // igual que un descuento borrado no borra sus tramos (quedan huérfanos
    // pero inaccesibles vía la promo borrada — la papelera, si llega, decide
    // si los restituye).
    await this.promocionRepo.update(
      { id, tenantId },
      { eliminadoEl: new Date() },
    );
  }

  // ── helpers privados ───────────────────────────────────────────────────

  /** Crea scopes + scope_items en la transacción, ya validados por el llamador. */
  private async crearHijos(
    manager: EntityManager,
    promocionId: string,
    scopesDto: ScopePromoDto[],
  ): Promise<{ scopes: PromocionScope[]; scopeItems: PromocionScopeItem[] }> {
    const scopes = scopesDto.map((s, i) =>
      manager.create(PromocionScope, {
        promocionId,
        slot: i,
        tipoScope: s.tipoScope,
        categoriaId: s.categoriaId ?? null,
        cantidad: s.cantidad ?? 1,
      }),
    );
    // Guarda ANTES de armar los scope_items: `scopes[i].id` recién existe
    // después de este `save` (TypeORM lo asigna sobre el mismo objeto).
    await manager.save(scopes);

    const scopeItems = scopesDto.flatMap((s, i) =>
      (s.itemIds ?? []).map((itemId) =>
        manager.create(PromocionScopeItem, { scopeId: scopes[i].id, itemId }),
      ),
    );
    if (scopeItems.length) await manager.save(scopeItems);

    return { scopes, scopeItems };
  }

  private conScopes(
    promo: Promocion,
    scopes: PromocionScope[],
    scopeItems: PromocionScopeItem[],
  ): PromocionConScopes {
    return {
      ...promo,
      scopes: scopes
        .filter((s) => s.promocionId === promo.id)
        .map((s) => ({
          id: s.id,
          slot: s.slot,
          tipoScope: s.tipoScope,
          categoriaId: s.categoriaId,
          cantidad: s.cantidad,
          itemIds: scopeItems
            .filter((si) => si.scopeId === s.id)
            .map((si) => si.itemId),
        })),
    };
  }

  /** Los dos NOT NULL: el guardarraíl heredado de eliminar `promocional`. */
  private validarFechas(dto: {
    fechaInicio?: string | null;
    fechaFin?: string | null;
  }): void {
    if (!dto.fechaInicio)
      throw new BadRequestException('Una promoción necesita fecha de inicio');
    if (!dto.fechaFin)
      throw new BadRequestException('Una promoción necesita fecha de término');
  }

  /** Espejo de `chk_promociones_horario_paridad`: las dos o ninguna. */
  private validarHorario(dto: {
    horaInicio?: string | null;
    horaFin?: string | null;
  }): void {
    if ((dto.horaInicio == null) !== (dto.horaFin == null))
      throw new BadRequestException(
        'horaInicio y horaFin deben venir juntos, o ninguno',
      );
  }

  /**
   * Espejo de `chk_promociones_valor_segun_tipo`: la correspondencia entre
   * `tipo` y las columnas de valor es regla entre hermanos — un decorador no
   * la lee, la valida acá (mismo precedente que `validarFormaDeImporte` en
   * descuentos).
   */
  private validarFormaSegunTipo(
    tipo: TipoPromocion,
    dto: FormaSegunTipo,
  ): void {
    if (tipo === 'porcentaje') {
      if (dto.valorPorcentaje == null)
        throw new BadRequestException(
          'El porcentaje es requerido para promociones de tipo porcentaje',
        );
      if (dto.cadaN != null)
        throw new BadRequestException(
          'cadaN no corresponde a una promoción de tipo porcentaje',
        );
      if (dto.valorMonto != null)
        throw new BadRequestException(
          'El importe va en valorPorcentaje para promociones de tipo porcentaje',
        );
    } else if (tipo === 'nxm') {
      if (dto.valorPorcentaje == null)
        throw new BadRequestException(
          'El porcentaje es requerido para promociones nxm',
        );
      if (dto.cadaN == null)
        throw new BadRequestException(
          'cadaN es requerido para promociones nxm',
        );
      if (dto.valorMonto != null)
        throw new BadRequestException(
          'valorMonto no corresponde a una promoción nxm',
        );
    } else {
      // precio_fijo
      if (dto.valorMonto == null)
        throw new BadRequestException(
          'El monto es requerido para promociones de precio fijo',
        );
      if (dto.valorPorcentaje != null)
        throw new BadRequestException(
          'El importe va en valorMonto para promociones de precio fijo',
        );
      if (dto.cadaN != null)
        throw new BadRequestException(
          'cadaN no corresponde a una promoción de precio fijo',
        );
    }
  }

  /**
   * `porcentaje`/`nxm`: exactamente 1 slot (a qué aplica la promo).
   * `precio_fijo`: 1..N slots, cada uno un componente del combo.
   * Regla entre tablas — la exige el service, no un CHECK (diseño §Modelo de
   * datos).
   */
  private validarScopes(tipo: TipoPromocion, scopes: ScopePromoDto[]): void {
    if (!scopes?.length)
      throw new BadRequestException('La promoción necesita al menos un scope');
    if ((tipo === 'porcentaje' || tipo === 'nxm') && scopes.length !== 1)
      throw new BadRequestException(
        'Este tipo de promoción admite exactamente un scope',
      );
    for (const scope of scopes) {
      if (scope.tipoScope === 'categoria' && !scope.categoriaId)
        throw new BadRequestException(
          'El scope de categoría necesita categoriaId',
        );
      if (scope.tipoScope === 'items' && !scope.itemIds?.length)
        throw new BadRequestException(
          'El scope de ítems necesita al menos un itemId',
        );
    }
  }

  /**
   * Cuenta los scopes VIVOS ya guardados (TypeORM excluye `eliminado_el` por
   * default vía `@DeleteDateColumn`, igual que el resto de los `find`/`count`
   * del proyecto) y revalida contra ellos la cardinalidad que
   * `validarScopes` exige por tipo — el mismo guard que corre en `create()`,
   * pero mirando la BD en vez del DTO porque acá no hay `scopes` nuevos que
   * mirar. `precio_fijo` admite 1..N y nunca puede bajar de 1 sin que
   * `dto.scopes` los toque, así que solo hace falta contar para
   * `porcentaje`/`nxm`.
   */
  private async validarCardinalidadDeScopesExistentes(
    tipo: TipoPromocion,
    promocionId: string,
  ): Promise<void> {
    if (tipo !== 'porcentaje' && tipo !== 'nxm') return;
    const cantidad = await this.scopeRepo.count({
      where: { promocionId },
    });
    if (cantidad !== 1)
      throw new BadRequestException(
        'Este tipo de promoción admite exactamente un scope',
      );
  }

  private async validarNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const qb = this.promocionRepo
      .createQueryBuilder('p')
      .where('p.tenant_id = :tenantId', { tenantId })
      // Case-insensitive, igual que descuentos: tiene que coincidir con el
      // índice único parcial sobre `lower(nombre)`.
      .andWhere('LOWER(p.nombre) = LOWER(:nombre)', { nombre })
      .andWhere('p.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('p.promocion_id != :excludeId', { excludeId });
    }
    const count = await qb.getCount();
    if (count > 0)
      throw new BadRequestException(
        `Ya existe una promoción con el nombre "${nombre}"`,
      );
  }
}
