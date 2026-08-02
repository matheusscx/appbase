import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { errorDeColisionNombre } from '../../common/utils/nombre-sugerido.util';
import { validarMontosDeRegla } from '../../common/utils/monto-regla.util';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateDescuentoDto } from './dto/create-descuento.dto';
import { UpdateDescuentoDto } from './dto/update-descuento.dto';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const CLASE = 'descuento';

/**
 * Tipos que expresan su monto con un `valor` único. Los que faltan lo expresan
 * con `tramos` (`por_mayor`, `por_monto_venta`), que tienen su propia
 * validación: entre las dos listas quedan cubiertos los 6 códigos que siembra
 * el backend, o sea que **ningún descuento puede quedar sin forma de decir
 * cuánto descuenta** (decisión del owner, 2026-08-01).
 *
 * `directo` faltaba acá: se podían crear descuentos directos sin importe, que
 * no descuentan nada. Vive a nivel módulo —y no dentro del validador de
 * `create()`— porque `update()` necesita la MISMA lista para no dejar vaciar
 * por `PATCH` un valor que `create()` exigió.
 */
const TIPOS_CON_VALOR_UNICO = [
  'directo',
  'metodo_pago',
  'pronto_pago',
  'promocional',
];

/** Tipos que expresan su monto con `tramos` en vez de con un `valor` único. */
const TIPOS_CON_TRAMOS = ['por_mayor', 'por_monto_venta'];

/** Tipos que además exigen al menos un método de pago asociado. */
const TIPOS_CON_METODOS = ['metodo_pago'];

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Descuento[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type DescuentoConAuditoria = Descuento & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class DescuentosService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Descuento)
    private readonly descuentoRepo: Repository<Descuento>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(DescuentoTramo)
    private readonly tramoRepo: Repository<DescuentoTramo>,
    @InjectRepository(DescuentoMetodoPago)
    private readonly metodoPagoRepo: Repository<DescuentoMetodoPago>,
  ) {}

  async findAll(tenantId: string, incluirEliminados = false) {
    let reglas: DescuentoConAuditoria[];
    if (!incluirEliminados) {
      reglas = await this.descuentoRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    } else {
      // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
      // los `addSelect` que no mapean a una columna de la entity, así que hay
      // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
      // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
      // documentada: el autor de un borrado es un hecho histórico).
      const { entities, raw } = await this.descuentoRepo
        .createQueryBuilder('d')
        .leftJoin('usuarios', 'u', 'u.usuario_id = d.eliminado_por')
        .addSelect('u.nombre_usuario', 'd_eliminado_por_nombre')
        .where('d.tenant_id = :tenantId', { tenantId })
        // Solo lo que borró una persona: `eliminado_por IS NULL` es un
        // borrado del sistema (seeder, `remapImpuestosOficialesDuplicados`),
        // no restaurable ni visible — decisión del owner, docs/features/papelera.md.
        .andWhere('(d.eliminado_el IS NULL OR d.eliminado_por IS NOT NULL)')
        .withDeleted()
        .orderBy('d.nombre', 'ASC')
        .getRawAndEntities<{ d_eliminado_por_nombre: string | null }>();
      reglas = entities.map((d, i) => ({
        ...d,
        eliminadoPorNombre: raw[i].d_eliminado_por_nombre,
      }));
    }
    const ids = reglas.map((r) => r.id);

    const tramos = ids.length
      ? await this.tramoRepo.find({
          where: { descuentoId: In(ids) },
          order: { orden: 'ASC' },
        })
      : [];

    const metodos = ids.length
      ? await this.metodoPagoRepo.find({
          where: { descuentoId: In(ids) },
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
        .filter((t) => t.descuentoId === r.id)
        .map((t) => ({ minimo: t.minimo, valor: t.valor })),
      metodoPagoIds: metodos
        .filter((m) => m.descuentoId === r.id)
        .map((m) => m.metodoPagoId),
      diasVencimiento: r.condicionValor ? parseInt(r.condicionValor, 10) : null,
    }));
  }

  async create(tenantId: string, dto: CreateDescuentoDto) {
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

      const descuento = manager.create(Descuento, {
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
      await manager.save(descuento);

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(DescuentoTramo, {
            descuentoId: descuento.id,
            minimo: t.minimo,
            valor: t.valor,
            orden: i,
          }),
        );
        await manager.save(tramos);
      }

      if (dto.metodoPagoIds?.length) {
        const metodos = dto.metodoPagoIds.map((mid) =>
          manager.create(DescuentoMetodoPago, {
            descuentoId: descuento.id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return this.toListItem(descuento, tipoRegla, {
        tramos: (dto.tramos ?? []).map((t) => ({
          minimo: t.minimo,
          valor: t.valor,
        })),
        metodoPagoIds: dto.metodoPagoIds ?? [],
        diasVencimiento: dto.diasVencimiento ?? null,
      });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDescuentoDto) {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);

    let tipoRegla: TipoRegla;
    if (dto.tipoReglaId) {
      tipoRegla = await this.validarTipoRegla(dto.tipoReglaId);
    } else {
      const tipo = await this.tipoReglaRepo.findOne({
        where: { id: descuento.tipoReglaId },
      });
      if (!tipo)
        throw new BadRequestException(
          'El tipo de regla seleccionado no existe',
        );
      tipoRegla = tipo;
    }

    await this.validarNombreUnico(tenantId, dto.nombre ?? descuento.nombre, id);
    this.validarSegunTipoUpdate(tipoRegla.codigo, dto);
    await this.validarEstadoResultante(tipoRegla.codigo, descuento, dto);

    return this.dataSource.transaction(async (manager) => {
      const condicionTipo = this.derivarCondicionTipo(tipoRegla.codigo);
      const tiposConDias = ['pronto_pago', 'mora'];
      const condicionValor =
        dto.diasVencimiento != null
          ? String(dto.diasVencimiento)
          : tiposConDias.includes(tipoRegla.codigo) && descuento.condicionValor
            ? descuento.condicionValor
            : null;
      const modo = [
        'pronto_pago',
        'interes_simple',
        'interes_compuesto',
      ].includes(tipoRegla.codigo)
        ? ModoRegla.PORCENTAJE
        : ((dto.modo as ModoRegla) ?? descuento.modo);

      Object.assign(descuento, {
        ...dto,
        modo,
        condicionTipo,
        condicionValor,
      });
      await manager.save(descuento);

      // Replace children only when explicitly sent in the DTO
      if (dto.tramos !== undefined) {
        await manager.softDelete(DescuentoTramo, { descuentoId: id });
        if (dto.tramos.length) {
          const tramos = dto.tramos.map((t, i) =>
            manager.create(DescuentoTramo, {
              descuentoId: id,
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
          DescuentoMetodoPago,
          { descuentoId: id },
          { eliminadoEl: new Date() },
        );
        if (dto.metodoPagoIds.length) {
          const metodos = dto.metodoPagoIds.map((mid) =>
            manager.create(DescuentoMetodoPago, {
              descuentoId: id,
              metodoPagoId: mid,
            }),
          );
          await manager.save(metodos);
        }
      }

      return this.toListItem(descuento, tipoRegla, {
        tramos:
          dto.tramos !== undefined
            ? dto.tramos.map((t) => ({ minimo: t.minimo, valor: t.valor }))
            : undefined,
        metodoPagoIds: dto.metodoPagoIds,
        diasVencimiento:
          dto.diasVencimiento !== undefined
            ? dto.diasVencimiento
            : descuento.condicionValor
              ? parseInt(descuento.condicionValor, 10)
              : null,
      });
    });
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.descuentoRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  /**
   * Papelera. `nombreNuevo` solo llega cuando el usuario resolvió una colisión
   * desde el modal; sin él se restaura con el nombre que la fila ya tenía, que
   * es el comportamiento de siempre.
   */
  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<Descuento> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!descuento || !descuento.eliminadoEl || !descuento.eliminadoPor) {
      throw new NotFoundException(`Descuento ${id} no está en la papelera`);
    }
    const nombre = nombreNuevo ?? descuento.nombre;
    try {
      // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
      // viejo sobreviviría y disfrazaría un borrado del sistema posterior como
      // borrado de persona (ver categorias.service.ts → restaurar()).
      // Revivir y renombrar van en la MISMA escritura: dos sentencias dejarían
      // una ventana con la fila viva y el nombre en colisión.
      await this.descuentoRepo.update(
        { id, tenantId },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          ...(nombreNuevo ? { nombre: nombreNuevo } : {}),
        },
      );
    } catch (e) {
      // 23505 = unique_violation. `uq_descuentos_tenant_nombre_vivo` es parcial
      // (WHERE eliminado_el IS NULL): mientras el descuento estaba borrado nadie
      // competía por el nombre, pero al revivirlo vuelve a competir. Se capta el
      // código de Postgres —no una lista de índices a mano— para que valga
      // también donde no lo enumeramos. Mismo patrón que cajones y causas-merma.
      if ((e as { code?: string }).code === '23505') {
        // La sugerencia se calcula ACÁ y no antes del `UPDATE` a propósito: con
        // índice único el `catch` hace falta igual —entre consultar y escribir
        // otra transacción puede tomar el nombre—, así que pre-consultar
        // agregaría una query en TODOS los restaurar sin poder sacar este
        // bloque. El `UPDATE` corre en autocommit, así que su fallo no deja una
        // transacción abortada y esta query funciona.
        throw new BadRequestException(
          await errorDeColisionNombre(
            this.descuentoRepo,
            'd',
            'un descuento activo',
            tenantId,
            nombre,
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
    return this.descuentoRepo.findOneOrFail({ where: { id, tenantId } });
  }

  async nombreDisponible(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<{ disponible: boolean }> {
    const qb = this.descuentoRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId })
      // Case-insensitive: "Black Friday" y "black friday" son el mismo nombre
      // (docs/PRODUCTO.md). Tiene que coincidir con el índice
      // `uq_descuentos_tenant_nombre_vivo`, que es sobre `lower(nombre)`; si
      // esta comparación fuera exacta, el endpoint público de disponibilidad
      // diría "libre" y el guardado fallaría con 23505.
      .andWhere('LOWER(d.nombre) = LOWER(:nombre)', { nombre })
      .andWhere('d.eliminado_el IS NULL');
    if (excludeId) {
      qb.andWhere('d.descuento_id != :excludeId', { excludeId });
    }
    const count = await qb.getCount();
    return { disponible: count === 0 };
  }

  private toListItem(
    descuento: Descuento,
    tipoRegla: TipoRegla,
    opts: {
      tramos?: { minimo: string; valor: string }[];
      metodoPagoIds?: string[];
      diasVencimiento?: number | null;
    },
  ) {
    return {
      ...descuento,
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
          : descuento.condicionValor
            ? parseInt(descuento.condicionValor, 10)
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
        'El tipo seleccionado no corresponde a un descuento',
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
        `Ya existe un descuento con el nombre "${nombre}"`,
      );
  }

  // Called from create() — all required fields must be present
  private validarSegunTipoCreate(
    codigo: string,
    dto: CreateDescuentoDto,
  ): void {
    const tiposFijoPorcentaje = [
      'pronto_pago',
      'interes_simple',
      'interes_compuesto',
    ];

    if (TIPOS_CON_TRAMOS.includes(codigo) && !dto.tramos?.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');
    if (TIPOS_CON_METODOS.includes(codigo) && !dto.metodoPagoIds?.length)
      throw new BadRequestException('Selecciona al menos un método de pago');
    if (
      tiposFijoPorcentaje.includes(codigo) &&
      dto.modo &&
      dto.modo !== 'porcentaje'
    )
      throw new BadRequestException('Este tipo solo admite modo porcentaje');
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !dto.valor)
      throw new BadRequestException('El valor es requerido para este tipo');
    // Con el modo con el que la fila VA A QUEDAR, que no siempre es el que
    // llegó: tres tipos lo fuerzan a porcentaje.
    validarMontosDeRegla(
      tiposFijoPorcentaje.includes(codigo)
        ? 'porcentaje'
        : (dto.modo ?? 'porcentaje'),
      dto.valor,
      dto.tramos,
    );
    if (codigo === 'pronto_pago' && dto.diasVencimiento == null)
      throw new BadRequestException('Días antes del vencimiento requerido');
    if (codigo === 'mora' && dto.diasVencimiento == null)
      throw new BadRequestException('Días de vencimiento requerido');
    if (
      codigo === 'pronto_pago' &&
      dto.diasVencimiento != null &&
      dto.diasVencimiento <= 0
    )
      throw new BadRequestException(
        'Días antes del vencimiento debe ser mayor a 0',
      );
    if (
      codigo === 'mora' &&
      dto.diasVencimiento != null &&
      (dto.diasVencimiento < 0 || dto.diasVencimiento > 365)
    )
      throw new BadRequestException(
        'Días de vencimiento debe estar entre 0 y 365',
      );
    if (codigo === 'promocional' && (!dto.fechaInicio || !dto.fechaFin))
      throw new BadRequestException(
        'Fechas de inicio y fin requeridas para descuento promocional',
      );
  }

  // Called from update() — only validate fields explicitly present in the DTO
  /**
   * Valida el estado CON EL QUE VA A QUEDAR la fila, no los campos que vinieron
   * en el `PATCH`.
   *
   * `validarSegunTipoUpdate` mira solo lo que llega, y por eso dejaba pasar dos
   * caminos —los dos verificados en vivo contra la API antes de cerrarlos, los
   * dos con 200— en los que la fila terminaba sin poder expresar su monto:
   *
   *   - `PATCH { tipoReglaId: directo }` sobre un `por_mayor` (que guarda el
   *     monto en `tramos` y tiene `valor` nulo) → un `directo` sin valor.
   *   - `PATCH { tipoReglaId: por_mayor }` sobre un `directo` → un descuento
   *     por tramos con CERO tramos.
   *
   * Tapar cada camino por separado no alcanzaba: el problema no es qué campo
   * viene, es que cambiar el tipo cambia QUÉ campos hacen falta. Por eso se
   * valida el resultado.
   *
   * Las cuentas de `tramos`/`metodoPagoIds` solo se consultan cuando el tipo
   * resultante las exige y el `PATCH` no las trae — una query puntual, nunca
   * una por fila.
   */
  private async validarEstadoResultante(
    codigo: string,
    actual: Descuento,
    dto: UpdateDescuentoDto,
  ): Promise<void> {
    const valorFinal = dto.valor !== undefined ? dto.valor : actual.valor;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !valorFinal)
      throw new BadRequestException('El valor es requerido para este tipo');

    // Los tramos que QUEDAN, no los que llegaron: un `PATCH` que solo cambia el
    // `modo` reinterpreta los valores ya guardados —un tramo de `5000` legítimo
    // como monto fijo pasa a ser 500.000%—, y ese `PATCH` no trae tramos.
    // Se leen siempre por eso, y porque un cambio de tipo puede dejar tramos
    // huérfanos en una regla que ya no los pide: el motor igual los evalúa,
    // porque mira `tramos.length` antes que el código del tipo.
    const tramosFinales =
      dto.tramos !== undefined
        ? dto.tramos
        : await this.tramoRepo.find({ where: { descuentoId: actual.id } });

    if (TIPOS_CON_TRAMOS.includes(codigo) && !tramosFinales.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');

    const tiposFijoPorcentaje = [
      'pronto_pago',
      'interes_simple',
      'interes_compuesto',
    ];
    validarMontosDeRegla(
      tiposFijoPorcentaje.includes(codigo)
        ? 'porcentaje'
        : (dto.modo ?? actual.modo),
      valorFinal,
      tramosFinales,
    );

    if (TIPOS_CON_METODOS.includes(codigo)) {
      const cantidad =
        dto.metodoPagoIds !== undefined
          ? dto.metodoPagoIds.length
          : await this.metodoPagoRepo.count({
              where: { descuentoId: actual.id },
            });
      if (!cantidad)
        throw new BadRequestException('Selecciona al menos un método de pago');
    }
  }

  private validarSegunTipoUpdate(
    codigo: string,
    dto: UpdateDescuentoDto,
  ): void {
    const tiposFijoPorcentaje = [
      'pronto_pago',
      'interes_simple',
      'interes_compuesto',
    ];

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
    // El `valor` y los tramos NO se validan acá: dependen del modo con el que
    // la fila queda, que un `PATCH` puede no traer. Lo hace
    // `validarEstadoResultante`, que sí tiene la fila actual.
    if (
      dto.diasVencimiento !== undefined &&
      codigo === 'pronto_pago' &&
      dto.diasVencimiento <= 0
    )
      throw new BadRequestException(
        'Días antes del vencimiento debe ser mayor a 0',
      );
    if (
      dto.diasVencimiento !== undefined &&
      codigo === 'mora' &&
      (dto.diasVencimiento < 0 || dto.diasVencimiento > 365)
    )
      throw new BadRequestException(
        'Días de vencimiento debe estar entre 0 y 365',
      );
    if (
      (dto.fechaInicio !== undefined || dto.fechaFin !== undefined) &&
      codigo === 'promocional' &&
      (!dto.fechaInicio || !dto.fechaFin)
    )
      throw new BadRequestException(
        'Fechas de inicio y fin requeridas para descuento promocional',
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
}
