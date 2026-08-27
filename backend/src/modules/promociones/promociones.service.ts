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
import type {
  PromoElegible,
  ScopePromoResuelto,
} from './promociones.evaluator';

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

/**
 * Una fila cruda del `LEFT JOIN` de `cargarVigentes`. Las columnas del scope
 * y del ítem son nullables **por el JOIN**, no por el modelo.
 */
interface FilaPromoVigente {
  promocion_id: string;
  nombre: string;
  tipo: TipoPromocion;
  valor_porcentaje: string | null;
  cada_n: number | null;
  valor_monto: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio: string | null;
  hora_fin: string | null;
  dias_semana: number[] | null;
  canal: string | null;
  scope_id: string | null;
  slot: number | null;
  tipo_scope: ScopePromoResuelto['tipoScope'] | null;
  categoria_id: string | null;
  cantidad: number | null;
  item_id: string | null;
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

  /**
   * Las promos que el motor tiene que **considerar** para una venta de este
   * día: vivas, no pausadas y con `fechaLocal` dentro de su rango.
   *
   * **Una sola consulta**, y por eso no reusa `findAll`: ahí son tres viajes
   * (promos → scopes → scope_items) porque el CRUD pagina y necesita las
   * entidades; acá el camino es el del cobro, corre en cada previsualización
   * del carrito y lo que hace falta es la forma que consume el evaluador. El
   * `LEFT JOIN` desnormaliza —una promo con 2 slots y 3 ítems llega en varias
   * filas— y el ensamblado las colapsa por `promocion_id`/`scope_id`.
   *
   * ⚠️ **Lo que NO se filtra acá: hora, día de semana y canal.** No es un
   * olvido — la ventana horaria se mide contra el instante de CADA LÍNEA
   * (`LineaPromo.instante`, decisión 4 del owner: vale cuándo se pidió, no
   * cuándo se cobra), así que una promo de happy hour tiene que llegar al
   * evaluador aunque ahora sean las 22:00: puede seguir aplicando a la línea
   * que se pidió a las 19:00. El canal lo descarta `evaluarPromos` de una vez
   * para toda la venta. Lo único que se filtra en SQL es lo que no depende de
   * la línea: tenant, borrado, pausa y rango de fechas.
   *
   * ⚠️ **`to_char` y no la columna cruda.** `fecha_*` es `date` y `hora_*` es
   * `time`: node-postgres las devuelve como `Date` y como `'HH:MM:SS'`, y el
   * evaluador compara STRINGS `'YYYY-MM-DD'`/`'HH:mm'` (ver
   * `instanteEnVentana`). Con `'18:00:00'` la comparación del borde exacto se
   * rompe —`'18:00' >= '18:00:00'` es `false` en orden lexicográfico— y la
   * promo no aplicaría en su primer minuto.
   */
  async cargarVigentes(
    tenantId: string,
    fechaLocal: string,
  ): Promise<PromoElegible[]> {
    const filas: FilaPromoVigente[] = await this.db.query(
      `SELECT p.promocion_id, p.nombre, p.tipo,
              p.valor_porcentaje, p.cada_n, p.valor_monto,
              to_char(p.fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio,
              to_char(p.fecha_fin, 'YYYY-MM-DD') AS fecha_fin,
              to_char(p.hora_inicio, 'HH24:MI') AS hora_inicio,
              to_char(p.hora_fin, 'HH24:MI') AS hora_fin,
              p.dias_semana, p.canal,
              s.scope_id, s.slot, s.tipo_scope, s.categoria_id, s.cantidad,
              si.item_id
         FROM promociones p
         LEFT JOIN promocion_scopes s
           ON s.promocion_id = p.promocion_id
          AND s.eliminado_el IS NULL
         LEFT JOIN promocion_scope_items si
           ON si.scope_id = s.scope_id
          AND si.eliminado_el IS NULL
        WHERE p.tenant_id = $1
          AND p.eliminado_el IS NULL
          AND p.activo = true
          AND p.fecha_inicio <= $2::date
          AND p.fecha_fin >= $2::date
        ORDER BY p.promocion_id, s.slot, si.item_id`,
      [tenantId, fechaLocal],
    );

    const porPromo = new Map<string, PromoElegible>();
    const porScope = new Map<string, ScopePromoResuelto>();

    for (const f of filas) {
      let promo = porPromo.get(f.promocion_id);
      if (!promo) {
        promo = {
          id: f.promocion_id,
          nombre: f.nombre,
          tipo: f.tipo,
          valorPorcentaje: f.valor_porcentaje,
          cadaN: f.cada_n,
          valorMonto: f.valor_monto,
          ventana: {
            fechaInicio: f.fecha_inicio,
            fechaFin: f.fecha_fin,
            horaInicio: f.hora_inicio,
            horaFin: f.hora_fin,
            diasSemana: f.dias_semana,
            canal: f.canal,
          },
          scopes: [],
        };
        porPromo.set(f.promocion_id, promo);
      }

      // Sin scope vivo el `LEFT JOIN` deja estas columnas en NULL. No es
      // alcanzable por catálogo (`validarScopes` exige al menos uno), pero
      // armar el scope igual le daría al evaluador un `tipoScope: null` que
      // `perteneceAScope` no sabe leer.
      if (f.scope_id == null) continue;

      let scope = porScope.get(f.scope_id);
      if (!scope) {
        scope = {
          slot: f.slot!,
          tipoScope: f.tipo_scope!,
          categoriaId: f.categoria_id,
          cantidad: f.cantidad!,
          itemIds: [],
        };
        porScope.set(f.scope_id, scope);
        promo.scopes.push(scope);
      }
      if (f.item_id != null) scope.itemIds.push(f.item_id);
    }

    return [...porPromo.values()].filter((p) => p.scopes.length > 0);
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
