import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { errorDeColisionNombre } from '../../common/utils/nombre-sugerido.util';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateRecargoDto } from './dto/create-recargo.dto';
import { UpdateRecargoDto } from './dto/update-recargo.dto';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const CLASE = 'recargo';

/**
 * Los 5 tipos de recargo expresan su monto con un `valor` único — ninguno usa
 * tramos. `create()` ya los exigía todos; la lista sube a nivel módulo para
 * que `update()` use la MISMA y no deje vaciar por `PATCH` lo que `create()`
 * exigió (un interés sin tasa es entrada del motor de precios).
 */
const TIPOS_CON_VALOR_UNICO = [
  'general',
  'mora',
  'recargo_metodo_pago',
  'interes_simple',
  'interes_compuesto',
];

/** Tipos que además exigen al menos un método de pago asociado. */
const TIPOS_CON_METODOS = ['recargo_metodo_pago'];

// ⚠️ No hay `TIPOS_CON_TRAMOS` acá a propósito: **ningún código de recargo usa
// tramos**. `validarSegunTipoCreate` tenía una lista local con `por_mayor` y
// `por_monto_venta` —códigos de DESCUENTO, copy-paste del módulo gemelo, que no
// podían matchear nunca—; ya no está. Lo que sigue en pie es la plomería de
// tramos en `create()`/`update()` y el chequeo de `validarSegunTipoUpdate`:
// alcanzables por API pero sin sentido de negocio, porque ningún tipo de
// recargo los pide. Sacarla es tema propio, anotado en docs/agent/pendientes.md.

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Recargo[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type RecargoConAuditoria = Recargo & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class RecargosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Recargo)
    private readonly recargoRepo: Repository<Recargo>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(RecargoTramo)
    private readonly tramoRepo: Repository<RecargoTramo>,
    @InjectRepository(RecargoMetodoPago)
    private readonly metodoPagoRepo: Repository<RecargoMetodoPago>,
  ) {}

  async findAll(tenantId: string, incluirEliminados = false) {
    let reglas: RecargoConAuditoria[];
    if (!incluirEliminados) {
      reglas = await this.recargoRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    } else {
      // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
      // los `addSelect` que no mapean a una columna de la entity, así que hay
      // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
      // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
      // documentada: el autor de un borrado es un hecho histórico).
      const { entities, raw } = await this.recargoRepo
        .createQueryBuilder('r')
        .leftJoin('usuarios', 'u', 'u.usuario_id = r.eliminado_por')
        .addSelect('u.nombre_usuario', 'r_eliminado_por_nombre')
        .where('r.tenant_id = :tenantId', { tenantId })
        // Solo lo que borró una persona: `eliminado_por IS NULL` es un
        // borrado del sistema (seeder, `remapImpuestosOficialesDuplicados`),
        // no restaurable ni visible — decisión del owner, docs/features/papelera.md.
        .andWhere('(r.eliminado_el IS NULL OR r.eliminado_por IS NOT NULL)')
        .withDeleted()
        .orderBy('r.nombre', 'ASC')
        .getRawAndEntities<{ r_eliminado_por_nombre: string | null }>();
      reglas = entities.map((r, i) => ({
        ...r,
        eliminadoPorNombre: raw[i].r_eliminado_por_nombre,
      }));
    }
    const ids = reglas.map((r) => r.id);

    const tramos = ids.length
      ? await this.tramoRepo.find({
          where: { recargoId: In(ids) },
          order: { orden: 'ASC' },
        })
      : [];

    const metodos = ids.length
      ? await this.metodoPagoRepo.find({
          where: { recargoId: In(ids) },
        })
      : [];

    const tipoIds = [...new Set(reglas.map((r) => r.tipoReglaId))];
    const tipos = tipoIds.length
      ? await this.tipoReglaRepo.find({ where: { id: In(tipoIds) } })
      : [];
    const tipoMap = new Map(tipos.map((t) => [t.id, t]));

    return reglas.map((r) => ({
      ...r,
      tipoRegla: tipoMap.get(r.tipoReglaId) ?? null,
      tramos: tramos
        .filter((t) => t.recargoId === r.id)
        .map((t) => ({ minimo: t.minimo, valor: t.valor })),
      metodoPagoIds: metodos
        .filter((m) => m.recargoId === r.id)
        .map((m) => m.metodoPagoId),
      diasVencimiento: r.condicionValor ? parseInt(r.condicionValor, 10) : null,
    }));
  }

  async create(tenantId: string, dto: CreateRecargoDto) {
    const tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    await this.validarNombreUnico(tenantId, dto.nombre);
    this.validarSegunTipoCreate(tipoRegla.codigo, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const condicionValor =
        dto.diasVencimiento != null ? String(dto.diasVencimiento) : null;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : (dto.modo as ModoRegla);

      const recargo = manager.create(Recargo, {
        tenantId,
        nombre: dto.nombre,
        tipoReglaId: dto.tipoReglaId,
        modo,
        valor: dto.valor ?? null,
        condicionTipo,
        condicionValor,
        fechaInicio: dto.fechaInicio ?? null,
        fechaFin: dto.fechaFin ?? null,
        activo: dto.activo ?? true,
      });
      await manager.save(recargo);

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(RecargoTramo, {
            recargoId: recargo.id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(RecargoMetodoPago, {
            recargoId: recargo.id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return this.toListItem(recargo, tipoRegla, {
        tramos: (dto.tramos ?? []).map((t) => ({
          minimo: t.minimo,
          valor: t.valor,
        })),
        metodoPagoIds: dto.metodoPagoIds ?? [],
        diasVencimiento: dto.diasVencimiento ?? null,
      });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRecargoDto) {
    const recargo = await this.recargoRepo.findOne({ where: { id, tenantId } });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);

    let tipoRegla: TipoRegla;
    if (dto.tipoReglaId) {
      tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    } else {
      const tipo = await this.tipoReglaRepo.findOne({
        where: { id: recargo.tipoReglaId },
      });
      if (!tipo)
        throw new BadRequestException(
          'El tipo de regla seleccionado no existe',
        );
      tipoRegla = tipo;
    }

    await this.validarNombreUnico(tenantId, dto.nombre ?? recargo.nombre, id);
    this.validarSegunTipoUpdate(tipoRegla.codigo, dto);
    await this.validarEstadoResultante(tipoRegla.codigo, recargo, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const tiposConDias = ['pronto_pago', 'mora'];
      const condicionValor =
        dto.diasVencimiento != null
          ? String(dto.diasVencimiento)
          : tiposConDias.includes(tipoRegla.codigo) && recargo.condicionValor
            ? recargo.condicionValor
            : null;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : ((dto.modo as ModoRegla) ?? recargo.modo);

      Object.assign(recargo, {
        ...dto,
        modo,
        condicionTipo,
        condicionValor,
      });
      await manager.save(recargo);

      // Replace children only when explicitly sent in the DTO
      if (dto.tramos !== undefined) {
        await manager.softDelete(RecargoTramo, { recargoId: id });
        if (dto.tramos.length) {
          const tramos = dto.tramos.map((t, i) =>
            manager.create(RecargoTramo, {
              recargoId: id,
              minimo: t.minimo,
              valor: t.valor,
              orden: i,
            }),
          );
          await manager.save(tramos);
        }
      }

      if (dto.metodoPagoIds !== undefined) {
        await manager.update(
          RecargoMetodoPago,
          { recargoId: id },
          { eliminadoEl: new Date() },
        );
        if (dto.metodoPagoIds.length) {
          const metodos = dto.metodoPagoIds.map((mid) =>
            manager.create(RecargoMetodoPago, {
              recargoId: id,
              metodoPagoId: mid,
            }),
          );
          await manager.save(metodos);
        }
      }

      return this.toListItem(recargo, tipoRegla, {
        tramos:
          dto.tramos !== undefined
            ? dto.tramos.map((t) => ({ minimo: t.minimo, valor: t.valor }))
            : undefined,
        metodoPagoIds: dto.metodoPagoIds,
        diasVencimiento:
          dto.diasVencimiento !== undefined
            ? dto.diasVencimiento
            : recargo.condicionValor
              ? parseInt(recargo.condicionValor, 10)
              : null,
      });
    });
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const recargo = await this.recargoRepo.findOne({ where: { id, tenantId } });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.recargoRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<Recargo> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const recargo = await this.recargoRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!recargo || !recargo.eliminadoEl || !recargo.eliminadoPor) {
      throw new NotFoundException(`Recargo ${id} no está en la papelera`);
    }
    // Se resuelve con el nombre CON EL QUE VA A QUEDAR, no el que tenía
    // guardado: si el usuario resolvió la colisión desde el modal, lo que
    // compite es el nombre nuevo.
    const nombre = nombreNuevo ?? recargo.nombre;
    try {
      // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
      // viejo sobreviviría y disfrazaría un borrado del sistema posterior como
      // borrado de persona (ver categorias.service.ts → restaurar()).
      // Revivir y renombrar van en la MISMA escritura: un `update` + un `save`
      // dejarían una ventana donde la fila está viva con el nombre en colisión.
      await this.recargoRepo.update(
        { id, tenantId },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          ...(nombreNuevo ? { nombre: nombreNuevo } : {}),
        },
      );
    } catch (e) {
      // 23505 = unique_violation. Ver descuentos.service.ts → restaurar() para
      // el porqué de captar el código de Postgres y de calcular la sugerencia
      // ACÁ y no antes del `UPDATE`.
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          await errorDeColisionNombre(
            this.recargoRepo,
            'r',
            'un recargo activo',
            tenantId,
            nombre,
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
    return this.recargoRepo.findOneOrFail({ where: { id, tenantId } });
  }

  async nombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<{ disponible: boolean }> {
    const qb = this.recargoRepo
      .createQueryBuilder('r')
      .where('r.tenant_id = :tenantId', { tenantId })
      // Case-insensitive, igual que descuentos: ver el comentario en
      // descuentos.service.ts → nombreDisponible().
      .andWhere('LOWER(r.nombre) = LOWER(:nombre)', { nombre })
      .andWhere('r.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('r.recargo_id != :excludeId', { excludeId });
    }
    const count = await qb.getCount();
    return { disponible: count === 0 };
  }

  private toListItem(
    recargo: Recargo,
    tipoRegla: TipoRegla,
    opts: {
      tramos?: { minimo: string; valor: string }[];
      metodoPagoIds?: string[];
      diasVencimiento?: number | null;
    },
  ) {
    return {
      ...recargo,
      tipoRegla: {
        id: tipoRegla.id,
        codigo: tipoRegla.codigo,
        nombre: tipoRegla.nombre,
      },
      ...(opts.tramos !== undefined ? { tramos: opts.tramos } : {}),
      ...(opts.metodoPagoIds !== undefined
        ? { metodoPagoIds: opts.metodoPagoIds }
        : {}),
      diasVencimiento:
        opts.diasVencimiento !== undefined
          ? opts.diasVencimiento
          : recargo.condicionValor
            ? parseInt(recargo.condicionValor, 10)
            : null,
    };
  }

  private async validarTipoRegla(tipoReglaId: string): Promise<TipoRegla> {
    const tipo = await this.tipoReglaRepo.findOne({
      where: { id: tipoReglaId },
    });
    if (!tipo)
      throw new BadRequestException('El tipo de regla seleccionado no existe');
    if (tipo.clase !== CLASE)
      throw new BadRequestException(
        'El tipo seleccionado no corresponde a un recargo',
      );
    return tipo;
  }

  private async validarNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const { disponible } = await this.nombreDisponible(
      tenantId,
      nombre,
      excludeId,
    );
    if (!disponible)
      throw new BadRequestException(
        `Ya existe un recargo con el nombre "${nombre}"`,
      );
  }

  // Called from create() — all required fields must be present
  private validarSegunTipoCreate(codigo: string, dto: CreateRecargoDto): void {
    const tiposConMetodos = ['recargo_metodo_pago'];
    const tiposFijoPorcentaje = ['interes_simple', 'interes_compuesto'];

    if (tiposConMetodos.includes(codigo) && !dto.metodoPagoIds?.length)
      throw new BadRequestException('Selecciona al menos un método de pago');
    if (
      tiposFijoPorcentaje.includes(codigo) &&
      dto.modo &&
      dto.modo !== 'porcentaje'
    )
      throw new BadRequestException('Este tipo solo admite modo porcentaje');
    if (TIPOS_CON_VALOR_UNICO.includes(codigo)) {
      if (!dto.valor)
        throw new BadRequestException('El valor es requerido para este tipo');
      this.validarValor(dto.modo ?? 'porcentaje', dto.valor);
    }
    if (codigo === 'mora' && dto.diasVencimiento == null)
      throw new BadRequestException('Días de vencimiento requerido');
    if (
      codigo === 'mora' &&
      dto.diasVencimiento != null &&
      (dto.diasVencimiento < 0 || dto.diasVencimiento > 365)
    )
      throw new BadRequestException(
        'Días de vencimiento debe estar entre 0 y 365',
      );
  }

  // Called from update() — only validate fields explicitly present in the DTO
  /**
   * Valida el estado CON EL QUE VA A QUEDAR la fila, no los campos que vinieron
   * en el `PATCH`. Mismo problema que en `descuentos.service.ts` (ver el
   * docblock de allá): mirar solo lo que llega deja pasar un cambio de
   * `tipoReglaId` que vuelve obligatorio un campo que la fila no tiene.
   *
   * Acá no hay chequeo de tramos porque ningún tipo de recargo los usa.
   */
  private async validarEstadoResultante(
    codigo: string,
    actual: Recargo,
    dto: UpdateRecargoDto,
  ): Promise<void> {
    const valorFinal = dto.valor !== undefined ? dto.valor : actual.valor;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !valorFinal)
      throw new BadRequestException('El valor es requerido para este tipo');

    if (TIPOS_CON_METODOS.includes(codigo)) {
      const cantidad =
        dto.metodoPagoIds !== undefined
          ? dto.metodoPagoIds.length
          : await this.metodoPagoRepo.count({
              where: { recargoId: actual.id },
            });
      if (!cantidad)
        throw new BadRequestException('Selecciona al menos un método de pago');
    }
  }

  private validarSegunTipoUpdate(codigo: string, dto: UpdateRecargoDto): void {
    const tiposFijoPorcentaje = ['interes_simple', 'interes_compuesto'];

    if (dto.tramos !== undefined && !dto.tramos.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');
    if (dto.metodoPagoIds !== undefined && !dto.metodoPagoIds.length)
      throw new BadRequestException('Selecciona al menos un método de pago');
    if (
      dto.modo !== undefined &&
      tiposFijoPorcentaje.includes(codigo) &&
      dto.modo !== 'porcentaje'
    )
      throw new BadRequestException('Este tipo solo admite modo porcentaje');
    if (dto.valor !== undefined && dto.valor)
      this.validarValor(dto.modo ?? 'porcentaje', dto.valor);
    if (
      dto.diasVencimiento !== undefined &&
      codigo === 'mora' &&
      (dto.diasVencimiento < 0 || dto.diasVencimiento > 365)
    )
      throw new BadRequestException(
        'Días de vencimiento debe estar entre 0 y 365',
      );
  }

  private derivarCondicionTipo(codigo: string): CondicionTipo {
    const map: Record<string, CondicionTipo> = {
      metodo_pago: CondicionTipo.METODO_PAGO,
      recargo_metodo_pago: CondicionTipo.METODO_PAGO,
      pronto_pago: CondicionTipo.VENCIMIENTO,
      mora: CondicionTipo.VENCIMIENTO,
    };
    return map[codigo] ?? CondicionTipo.NINGUNA;
  }

  private validarValor(modo: string, valor: string | null | undefined): void {
    if (!valor) return;
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) {
      throw new BadRequestException('El valor debe ser un número mayor a 0');
    }
    if (modo === 'porcentaje' && numero >= 1) {
      throw new BadRequestException(
        'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
      );
    }
  }
}
