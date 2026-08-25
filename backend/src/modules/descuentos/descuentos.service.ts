import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Db } from '../../common/db/db.service';
import {
  errorDeColisionNombre,
  traducirColisionDeNombre,
} from '../../common/utils/nombre-sugerido.util';
import {
  validarMontosDeRegla,
  validarMinimosDeTramos,
  importeResultante,
} from '../../common/utils/monto-regla.util';
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
const TIPOS_CON_VALOR_UNICO = ['directo', 'metodo_pago', 'pronto_pago'];

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
    private readonly db: Db,
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
        .map((t) => ({
          minimoCantidad: t.minimoCantidad,
          minimoMonto: t.minimoMonto,
          valorMonto: t.valorMonto,
          valorPorcentaje: t.valorPorcentaje,
        })),
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

    const escritura = this.db.transaccion(async (manager) => {
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
        // Solo la columna del modo; la otra queda en null explícito.
        ...importeResultante(modo, dto, {}),
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
            minimoCantidad: t.minimoCantidad ?? null,
            minimoMonto: t.minimoMonto ?? null,
            valorMonto: t.valorMonto ?? null,
            valorPorcentaje: t.valorPorcentaje ?? null,
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
          minimoCantidad: t.minimoCantidad,
          minimoMonto: t.minimoMonto,
          valorMonto: t.valorMonto,
          valorPorcentaje: t.valorPorcentaje,
        })),
        metodoPagoIds: dto.metodoPagoIds ?? [],
        diasVencimiento: dto.diasVencimiento ?? null,
      });
    });
    return traducirColisionDeNombre(escritura, () =>
      this.validarNombreUnico(tenantId, dto.nombre),
    );
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

    const escritura = this.db.transaccion(async (manager) => {
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
        // Va DESPUÉS del spread: apaga la columna de la unidad abandonada. Sin
        // esto, cambiar de unidad dejaría las dos llenas y el CHECK de tabla
        // devolvería un 500 en vez del 400 que ya dio la validación.
        ...importeResultante(modo, dto, descuento),
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
              minimoCantidad: t.minimoCantidad ?? null,
              minimoMonto: t.minimoMonto ?? null,
              valorMonto: t.valorMonto ?? null,
              valorPorcentaje: t.valorPorcentaje ?? null,
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
            ? dto.tramos.map((t) => ({
                minimoCantidad: t.minimoCantidad,
                minimoMonto: t.minimoMonto,
                valorMonto: t.valorMonto,
                valorPorcentaje: t.valorPorcentaje,
              }))
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
    return traducirColisionDeNombre(escritura, () =>
      this.validarNombreUnico(tenantId, dto.nombre ?? descuento.nombre, id),
    );
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

  /**
   * Consulta inversa a `ItemsService.obtenerUso`: dado un descuento, los
   * ítems vivos que lo usan. Alimenta el modal de confirmación al pausar
   * ("deja de aplicarse en N ítems"). Una sola query con JOIN — nunca una
   * por fila —, acotada por tenant y `eliminado_el IS NULL` sobre `items`
   * (la tabla puente `item_descuentos` no tiene `tenant_id` ni
   * `eliminado_el` propios).
   */
  async obtenerUso(
    tenantId: string,
    id: string,
  ): Promise<{ items: { id: string; nombre: string }[] }> {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);

    const items: { id: string; nombre: string }[] = await this.db.query(
      `SELECT i.item_id AS id, i.nombre
         FROM item_descuentos idd
         JOIN items i ON i.item_id = idd.item_id
          AND i.tenant_id = $2 AND i.eliminado_el IS NULL
        WHERE idd.descuento_id = $1
        ORDER BY i.nombre ASC`,
      [id, tenantId],
    );

    return { items };
  }

  private toListItem(
    descuento: Descuento,
    tipoRegla: TipoRegla,
    opts: {
      tramos?: {
        minimoCantidad?: string | null;
        minimoMonto?: string | null;
        valorMonto?: string | null;
        valorPorcentaje?: string | null;
      }[];
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
    // Con el modo con el que la fila VA A QUEDAR, que no siempre es el que
    // llegó: tres tipos lo fuerzan a porcentaje.
    const modoResultante = tiposFijoPorcentaje.includes(codigo)
      ? 'porcentaje'
      : (dto.modo ?? 'porcentaje');
    // El orden importa: PRIMERO lo que mandó el cliente, después lo que falta.
    // Al revés, quien manda `valorMonto` en una regla de porcentaje recibe "el
    // valor es requerido" —mandó un valor— en vez del mensaje que le dice cuál
    // columna corresponde. Mandar la columna equivocada tiene que ser un 400
    // que se entienda, no un descarte mudo que guarde algo distinto.
    validarMontosDeRegla(modoResultante, dto, dto.tramos);
    // El mínimo va aparte porque su discriminador es el `codigo` del tipo, no
    // el `modo`: son dos ejes independientes.
    validarMinimosDeTramos(
      TIPOS_CON_TRAMOS.includes(codigo) ? codigo : null,
      dto.tramos,
    );
    const importe =
      modoResultante === 'monto_fijo' ? dto.valorMonto : dto.valorPorcentaje;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !importe)
      throw new BadRequestException('El valor es requerido para este tipo');
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
   * Lo que el `PATCH` no trae se lee de la BD: los tramos siempre que falten
   * (los guardados son los que delatan que la fila no puede quedar como se
   * pide), los métodos de pago solo si el tipo resultante los exige. Una query
   * puntual por request, nunca una por fila.
   */
  private async validarEstadoResultante(
    codigo: string,
    actual: Descuento,
    dto: UpdateDescuentoDto,
  ): Promise<void> {
    const tiposFijoPorcentaje = [
      'pronto_pago',
      'interes_simple',
      'interes_compuesto',
    ];
    const modoResultante = tiposFijoPorcentaje.includes(codigo)
      ? 'porcentaje'
      : (dto.modo ?? actual.modo);
    // Los tramos que QUEDAN, no los que llegaron. Un `PATCH` que solo cambia el
    // `modo` ya no puede reinterpretarlos —viven en la columna de la unidad
    // vieja—, así que leerlos es lo que hace que ese PATCH FALLE en vez de
    // dejar una fila que el CHECK de tabla rechazaría después. Y se leen
    // igual porque un cambio de tipo puede dejar tramos huérfanos en una regla
    // que ya no los pide: el motor los evalúa mirando `tramos.length` antes
    // que el código del tipo.
    const tramosFinales =
      dto.tramos !== undefined
        ? dto.tramos
        : await this.tramoRepo.find({ where: { descuentoId: actual.id } });

    if (TIPOS_CON_TRAMOS.includes(codigo) && !tramosFinales.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');

    // Lo que mandó el cliente (para que la columna equivocada sea 400) más los
    // tramos que QUEDAN. Si el modo cambia y el PATCH no reenvía los tramos,
    // los guardados están en la columna de la unidad vieja y esto falla — que
    // es lo correcto: antes ese mismo PATCH los reinterpretaba en silencio.
    validarMontosDeRegla(modoResultante, dto, tramosFinales);
    // Sobre `tramosFinales` y no sobre `dto.tramos`: un PATCH que solo cambia
    // el `tipoReglaId` reinterpreta los tramos YA GUARDADOS, y ahí es donde el
    // mínimo puede quedar en la columna equivocada sin que el cliente mande
    // ningún tramo.
    validarMinimosDeTramos(
      TIPOS_CON_TRAMOS.includes(codigo) ? codigo : null,
      tramosFinales,
    );

    // El mismo orden que en `validarSegunTipoCreate`, y por el mismo motivo:
    // PRIMERO lo que mandó el cliente, después lo que falta. Al revés —como
    // estuvo hasta el 2026-08-23— un `PATCH { valorPorcentaje: null,
    // valorMonto: '5000' }` sobre una regla de porcentaje deja la fila sin
    // importe, así que contestaba *"el valor es requerido"* a quien acababa de
    // mandar uno, en vez de decirle cuál columna corresponde. La forma la arma
    // cualquier cliente que serialice el formulario entero; el frontend no,
    // porque manda una sola columna.
    //
    // Cuesta que la lectura de tramos de arriba corra antes de este chequeo:
    // un PATCH destinado a morir acá hace una query que antes se ahorraba. Es
    // una query puntual por request, nunca una por fila.
    const resultante = importeResultante(modoResultante, dto, actual);
    const importeFinal =
      modoResultante === 'monto_fijo'
        ? resultante.valorMonto
        : resultante.valorPorcentaje;
    if (TIPOS_CON_VALOR_UNICO.includes(codigo) && !importeFinal)
      throw new BadRequestException('El valor es requerido para este tipo');

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
