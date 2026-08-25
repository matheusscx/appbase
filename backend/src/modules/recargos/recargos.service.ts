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

/**
 * Tipos que expresan su monto con `tramos` en vez de con un `valor` único —
 * espejo de `TIPOS_CON_TRAMOS` en `descuentos.service.ts`.
 *
 * Hasta el 2026-08-22 esta lista no existía y el comentario que ocupaba su
 * lugar decía que ningún recargo usaba tramos: la plomería estaba
 * (`create()`/`update()` los persisten) pero ningún tipo los pedía, así que era
 * alcanzable por API y sin sentido de negocio. El owner decidió **construirlo
 * en vez de borrarlo** (2026-08-11): recargos por escalones, igual que los
 * descuentos.
 *
 * El motor no necesitó cambios: `evaluarRegla` ramifica por `tramos.length > 0`
 * sin mirar la clase, y un código que no está en `DIFERIDAS` ni en
 * `METODO_PAGO_CODIGOS` llega a esa rama con la magnitud del monto.
 */
const TIPOS_CON_TRAMOS = ['recargo_por_monto_venta'];

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Recargo[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type RecargoConAuditoria = Recargo & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class RecargosService {
  constructor(
    private readonly db: Db,
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
        .map((t) => ({
          minimoCantidad: t.minimoCantidad,
          minimoMonto: t.minimoMonto,
          valorMonto: t.valorMonto,
          valorPorcentaje: t.valorPorcentaje,
        })),
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

      const recargo = manager.create(Recargo, {
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
      await manager.save(recargo);

      if (dto.tramos?.length) {
        const tramos = dto.tramos.map((t, i) =>
          manager.create(RecargoTramo, {
            recargoId: recargo.id,
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
          manager.create(RecargoMetodoPago, {
            recargoId: recargo.id,
            metodoPagoId: mid,
          }),
        );
        await manager.save(metodos);
      }

      return this.toListItem(recargo, tipoRegla, {
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

    const escritura = this.db.transaccion(async (manager) => {
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
        // Va DESPUÉS del spread: apaga la columna de la unidad abandonada. Sin
        // esto, cambiar de unidad dejaría las dos llenas y el CHECK de tabla
        // devolvería un 500 en vez del 400 que ya dio la validación.
        ...importeResultante(modo, dto, recargo),
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
            : recargo.condicionValor
              ? parseInt(recargo.condicionValor, 10)
              : null,
      });
    });
    return traducirColisionDeNombre(escritura, () =>
      this.validarNombreUnico(tenantId, dto.nombre ?? recargo.nombre, id),
    );
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

  /**
   * Consulta inversa a `ItemsService.obtenerUso`: dado un recargo, los
   * ítems vivos que lo usan. Alimenta el modal de confirmación al pausar
   * ("deja de aplicarse en N ítems"). Una sola query con JOIN — nunca una
   * por fila —, acotada por tenant y `eliminado_el IS NULL` sobre `items`
   * (la tabla puente `item_recargos` no tiene `tenant_id` ni `eliminado_el`
   * propios).
   */
  async obtenerUso(
    tenantId: string,
    id: string,
  ): Promise<{ items: { id: string; nombre: string }[] }> {
    const recargo = await this.recargoRepo.findOne({
      where: { id, tenantId },
    });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);

    const items: { id: string; nombre: string }[] = await this.db.query(
      `SELECT i.item_id AS id, i.nombre
         FROM item_recargos ir
         JOIN items i ON i.item_id = ir.item_id
          AND i.tenant_id = $2 AND i.eliminado_el IS NULL
        WHERE ir.recargo_id = $1
        ORDER BY i.nombre ASC`,
      [id, tenantId],
    );

    return { items };
  }

  private toListItem(
    recargo: Recargo,
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

    if (TIPOS_CON_TRAMOS.includes(codigo) && !dto.tramos?.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');
    if (tiposConMetodos.includes(codigo) && !dto.metodoPagoIds?.length)
      throw new BadRequestException('Selecciona al menos un método de pago');
    if (
      tiposFijoPorcentaje.includes(codigo) &&
      dto.modo &&
      dto.modo !== 'porcentaje'
    )
      throw new BadRequestException('Este tipo solo admite modo porcentaje');
    // Con el modo con el que la fila VA A QUEDAR, que no siempre es el que
    // llegó: dos tipos lo fuerzan a porcentaje.
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
   * Desde el 2026-08-22 sí hay chequeo de que EXISTAN tramos, para los tipos de
   * `TIPOS_CON_TRAMOS`: un `PATCH` que solo cambia el `tipoReglaId` puede dejar
   * una regla que se expresa por escalones sin ningún escalón, y el motor no le
   * cobraría nada. Los tramos que haya se siguen validando aunque el tipo no los
   * pida: la plomería es alcanzable por API y el motor los evalúa mirando
   * `tramos.length` antes que el código del tipo.
   */
  private async validarEstadoResultante(
    codigo: string,
    actual: Recargo,
    dto: UpdateRecargoDto,
  ): Promise<void> {
    const tiposFijoPorcentaje = ['interes_simple', 'interes_compuesto'];
    const modoResultante = tiposFijoPorcentaje.includes(codigo)
      ? 'porcentaje'
      : (dto.modo ?? actual.modo);
    // Los tramos que QUEDAN, no los que llegaron. Un `PATCH` que solo cambia el
    // `modo` ya no puede reinterpretarlos —viven en la columna de la unidad
    // vieja—, así que leerlos es lo que hace que ese PATCH FALLE en vez de
    // dejar una fila que el CHECK de tabla rechazaría después.
    const tramosFinales =
      dto.tramos !== undefined
        ? dto.tramos
        : await this.tramoRepo.find({ where: { recargoId: actual.id } });

    if (TIPOS_CON_TRAMOS.includes(codigo) && !tramosFinales.length)
      throw new BadRequestException('Este tipo requiere al menos un tramo');

    // Lo que mandó el cliente (para que la columna equivocada sea 400) más los
    // tramos que quedan.
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
    // El `valor` y los tramos NO se validan acá: dependen del modo con el que
    // la fila queda, que un `PATCH` puede no traer. Lo hace
    // `validarEstadoResultante`, que sí tiene la fila actual.
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
