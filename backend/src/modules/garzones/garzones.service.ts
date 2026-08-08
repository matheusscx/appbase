import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, type EntityManager } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Garzon } from './entities/garzon.entity';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { TipoGarzon } from './enums/tipo-garzon.enum';
import {
  EstadoSesionGarzon,
  SesionGarzon,
} from '../turnos/entities/sesion-garzon.entity';

const BCRYPT_COST = 10;
// El PIN se genera automáticamente; estos acotan la generación única.
const MAX_INTENTOS_PIN = 50;
const PIN_MAX_EXCLUSIVO = 1_000_000; // 000000..999999

/** Vista pública de un garzón — nunca incluye el hash del PIN. */
export interface GarzonPublico {
  id: string;
  nombre: string;
  activo: boolean;
  tipo: TipoGarzon;
  creadoEl: Date;
  actualizadoEl: Date;
  eliminadoEl?: Date | null;
  // Opcional: el listado sin `incluirEliminados` no hace el JOIN a `usuarios`
  // (N+1 si lo forzáramos ahí).
  eliminadoPorNombre?: string | null;
}

/**
 * Respuesta de una mutación que puede tener un efecto que el admin no
 * anticipa. `advertencias` viene siempre —vacío si no hay nada que decir—,
 * igual que en ventas e items: el que consume no tiene que distinguir entre
 * "sin advertencias" y "el endpoint no las manda".
 *
 * Decisión del owner (2026-08-07): estos dos casos **advierten, no bloquean**.
 * Ninguno rompe la operación en el momento —a diferencia de desactivar o
 * eliminar, que sí bloquean— pero los dos tienen una consecuencia que aparece
 * más tarde y en otra pantalla.
 */
export interface GarzonConAdvertencias extends GarzonPublico {
  advertencias: string[];
}

/**
 * Respuesta de creación / regeneración: incluye el PIN en claro **una sola
 * vez**. No se persiste en claro ni se puede volver a leer (solo queda el hash).
 */
export interface GarzonConPin extends GarzonConAdvertencias {
  pin: string;
}

@Injectable()
export class GarzonesService {
  constructor(
    @InjectRepository(Garzon)
    private readonly garzonRepo: Repository<Garzon>,
    @InjectRepository(SesionGarzon)
    private readonly sesionRepo: Repository<SesionGarzon>,
  ) {}

  private toPublico(
    g: Garzon,
    eliminadoPorNombre?: string | null,
  ): GarzonPublico {
    return {
      id: g.id,
      nombre: g.nombre,
      activo: g.activo,
      tipo: g.tipo ?? TipoGarzon.GARZON,
      creadoEl: g.creadoEl,
      actualizadoEl: g.actualizadoEl,
      eliminadoEl: g.eliminadoEl,
      ...(eliminadoPorNombre !== undefined ? { eliminadoPorNombre } : {}),
    };
  }

  async listar(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<GarzonPublico[]> {
    if (!incluirEliminados) {
      const garzones = await this.garzonRepo.find({
        where: { tenantId, esPlaceholder: false },
        order: { nombre: 'ASC' },
      });
      return garzones.map((g) => this.toPublico(g));
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const { entities, raw } = await this.garzonRepo
      .createQueryBuilder('g')
      .leftJoin('usuarios', 'u', 'u.usuario_id = g.eliminado_por')
      .addSelect('u.nombre_usuario', 'g_eliminado_por_nombre')
      .where('g.tenant_id = :tenantId AND g.es_placeholder = false', {
        tenantId,
      })
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema, no restaurable ni visible — decisión del
      // owner, docs/features/papelera.md.
      .andWhere('(g.eliminado_el IS NULL OR g.eliminado_por IS NOT NULL)')
      .withDeleted()
      .orderBy('g.nombre', 'ASC')
      .getRawAndEntities<{ g_eliminado_por_nombre: string | null }>();

    return entities.map((g, i) =>
      this.toPublico(g, raw[i].g_eliminado_por_nombre),
    );
  }

  async crear(tenantId: string, dto: CreateGarzonDto): Promise<GarzonConPin> {
    const pin = await this.generarPinUnico(tenantId);
    const garzon = this.garzonRepo.create({
      tenantId,
      nombre: dto.nombre,
      pinHash: await bcrypt.hash(pin, BCRYPT_COST),
      activo: dto.activo ?? true,
      tipo: dto.tipo ?? TipoGarzon.GARZON,
    });
    const guardado = await this.garzonRepo.save(garzon);
    // Un garzón recién creado no puede tener sesión abierta: el array va vacío
    // para que el que consume no tenga que distinguir este endpoint de los otros.
    return { ...this.toPublico(guardado), pin, advertencias: [] };
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateGarzonDto,
  ): Promise<GarzonConAdvertencias> {
    const garzon = await this.getOrThrow(tenantId, id);
    const tipoAnterior = garzon.tipo ?? TipoGarzon.GARZON;
    // Desactivar corta; cambiar el tipo advierte. Los dos preguntan lo mismo, así
    // que la consulta se hace UNA vez: un PATCH del formulario manda el objeto
    // entero, con lo cual las dos condiciones pueden darse en el mismo request.
    const desactiva = dto.activo === false && garzon.activo;
    const cambiaTipo = dto.tipo !== undefined && dto.tipo !== tipoAnterior;
    const sesionesAbiertas =
      desactiva || cambiaTipo
        ? await this.contarSesionesAbiertas(tenantId, id)
        : 0;

    // Mismo chequeo que `eliminar()`, que ya lo tenía: desactivar a alguien con
    // sesión abierta lo deja sin poder cerrarla ni operar —`resolverGarzonPorPin`
    // filtra `activo: true`— y su sesión queda abierta con `fin_el = null` hasta
    // que un admin la fuerce. Mientras tanto el turno tampoco se puede desactivar.
    if (desactiva) {
      this.assertSinSesionAbierta(sesionesAbiertas, 'desactivar');
    }

    // El cambio de `tipo` advierte en vez de bloquear (decisión del owner,
    // 2026-08-07). No es simétrico con desactivar: desactivar rompe la operación
    // del garzón AHORA, mientras que el tipo no rompe nada en el turno en curso
    // —`sesiones-garzon.service.ts` copia `garzon.tipo` a `sesion_garzon` al
    // abrir, así que el reparto usa el congelado— pero deja al admin sin saber
    // que su cambio no rige hasta el turno siguiente. Bloquear obligaría a
    // cerrar el turno para corregir un tipo mal cargado.
    const advertencias: string[] = [];
    if (cambiaTipo && sesionesAbiertas > 0) {
      // La segunda frase NO es adorno: si la persona genera propinas con los dos
      // tipos dentro de un mismo período, `assertGarzonEnUnSoloGrupo` corta la
      // liquidación entera con un 400 hasta que alguien parta el período. Sin
      // decirlo, el aviso suena inocuo y el admin no se entera de que acaba de
      // programar ese bloqueo.
      advertencias.push(
        `${garzon.nombre} tiene una sesión abierta: el reparto de propinas de ese turno ` +
          `sigue usando el tipo con el que la abrió (${tipoAnterior}), y el cambio a ` +
          `${dto.tipo} rige desde la próxima sesión. Si genera propinas con los dos tipos ` +
          `en un mismo período, la liquidación de ese período no va a poder cerrarse hasta ` +
          `partirlo en dos.`,
      );
    }

    if (dto.nombre !== undefined) garzon.nombre = dto.nombre;
    if (dto.activo !== undefined) garzon.activo = dto.activo;
    if (dto.tipo !== undefined) garzon.tipo = dto.tipo;
    return {
      ...this.toPublico(await this.garzonRepo.save(garzon)),
      advertencias,
    };
  }

  /**
   * Genera un PIN nuevo para el garzón y lo devuelve **una sola vez**. El PIN
   * anterior deja de funcionar de inmediato (se reemplaza el hash).
   *
   * Con sesión abierta **advierte, no bloquea** (decisión del owner,
   * 2026-08-07): rotar una credencial es la respuesta correcta a una filtración,
   * y trabarla porque hay un turno abierto sería la política al revés. Lo que sí
   * hace falta es que el admin vea en el momento que el garzón queda sin poder
   * marcar salida ni operar hasta recibir el PIN nuevo.
   */
  async regenerarPin(tenantId: string, id: string): Promise<GarzonConPin> {
    const garzon = await this.getOrThrow(tenantId, id);
    const advertencias: string[] = [];
    if ((await this.contarSesionesAbiertas(tenantId, id)) > 0) {
      advertencias.push(
        `${garzon.nombre} está en turno: el PIN anterior deja de funcionar ya mismo, ` +
          `así que no va a poder operar ni marcar salida hasta que reciba el nuevo.`,
      );
    }
    const pin = await this.generarPinUnico(tenantId, id);
    garzon.pinHash = await bcrypt.hash(pin, BCRYPT_COST);
    const guardado = await this.garzonRepo.save(garzon);
    return { ...this.toPublico(guardado), pin, advertencias };
  }

  async eliminar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.getOrThrow(tenantId, id);
    this.assertSinSesionAbierta(
      await this.contarSesionesAbiertas(tenantId, id),
      'eliminar',
    );
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.garzonRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<GarzonPublico> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const garzon = await this.garzonRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!garzon || !garzon.eliminadoEl || !garzon.eliminadoPor) {
      throw new NotFoundException(`Garzón ${id} no está en la papelera`);
    }
    try {
      // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
      // viejo sobreviviría y disfrazaría un borrado del sistema posterior
      // como borrado de persona (ver categorias.service.ts → restaurar()).
      await this.garzonRepo.update(
        { id, tenantId },
        { eliminadoEl: null, eliminadoPor: null },
      );
    } catch (e) {
      // 23505 = unique_violation. `uq_garzones_mostrador_tenant` es parcial
      // (WHERE es_placeholder = true AND eliminado_el IS NULL): un solo
      // "Mostrador" vivo por tenant. Si el placeholder borrado sigue siendo
      // el que `restaurar()` intenta revivir mientras `asegurarMostrador()`
      // ya creó uno nuevo (find-or-create disparado por otra venta en el
      // medio), restaurar el viejo colisiona. `nombre` no tiene índice único
      // en `garzones` — este es el único choque posible acá, así que el
      // mensaje es específico al placeholder, no genérico de "nombre". Mismo
      // patrón que causas-merma.service.ts → restaurar().
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          'Ya existe un garzón "Mostrador" activo para este tenant (se crea automáticamente, uno por tenant). No se puede restaurar el placeholder anterior mientras el nuevo siga vivo.',
        );
      }
      throw e;
    }
    const restaurado = await this.garzonRepo.findOneOrFail({
      where: { id, tenantId },
    });
    return this.toPublico(restaurado);
  }

  /**
   * Identifica al garzón por su PIN dentro del tenant. Itera los garzones
   * activos y compara con bcrypt (N pequeño por tenant). Lanza 400 si ningún
   * PIN coincide. Uso interno (SalonesService) y endpoint /garzones/identificar.
   *
   * Es un `BadRequestException` (no 401) a propósito: un PIN incorrecto es un
   * error operativo del garzón, no un fallo de autenticación de la sesión del
   * dispositivo. Un 401 haría que el interceptor de `useApiFetch` intente
   * refrescar el token y cierre la sesión del restaurante.
   */
  async resolverGarzonPorPin(tenantId: string, pin: string): Promise<Garzon> {
    const garzones = await this.garzonRepo.find({
      where: { tenantId, activo: true },
    });
    for (const garzon of garzones) {
      if (await bcrypt.compare(pin, garzon.pinHash)) {
        return garzon;
      }
    }
    throw new BadRequestException('PIN inválido');
  }

  async obtenerActivoPorId(tenantId: string, id: string): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({
      where: { id, tenantId, activo: true },
    });
    if (!garzon || !garzon.activo) {
      throw new BadRequestException('Garzón no encontrado o inactivo');
    }
    return garzon;
  }

  /**
   * Resuelve el garzón placeholder "Mostrador" del tenant — receptor neutro de
   * la propina del POS. Idempotente: si no existe lo crea con `activo=false`,
   * `esPlaceholder=true` y un `pin_hash` inutilizable, para que nunca opere ni
   * se identifique por PIN. Se ejecuta dentro del `manager` de la transacción
   * de la venta. Ver docs/features/pagos.md.
   */
  async asegurarMostrador(
    manager: EntityManager,
    tenantId: string,
  ): Promise<Garzon> {
    const existente = await manager.findOne(Garzon, {
      where: { tenantId, esPlaceholder: true, eliminadoEl: IsNull() },
    });
    if (existente) return existente;
    return manager.save(
      Garzon,
      manager.create(Garzon, {
        tenantId,
        nombre: 'Mostrador',
        pinHash: '!',
        activo: false,
        tipo: TipoGarzon.GARZON,
        esPlaceholder: true,
      }),
    );
  }

  /**
   * Cuántas sesiones abiertas tiene el garzón. Cuatro operaciones preguntan lo
   * mismo y difieren solo en qué hacen con la respuesta: eliminar y desactivar
   * cortan, cambiar el tipo y regenerar el PIN advierten.
   */
  private async contarSesionesAbiertas(
    tenantId: string,
    id: string,
  ): Promise<number> {
    return this.sesionRepo.count({
      where: { tenantId, garzonId: id, estado: EstadoSesionGarzon.ABIERTA },
    });
  }

  /**
   * Las dos operaciones que sacan al garzón de circulación comparten la regla.
   * Recibe el conteo ya hecho en vez de hacerlo: `actualizar()` necesita el
   * mismo número para decidir si además advierte por el cambio de tipo, y
   * consultarlo dos veces en el mismo request sería una query al pedo.
   */
  private assertSinSesionAbierta(
    abiertas: number,
    accion: 'eliminar' | 'desactivar',
  ): void {
    if (abiertas > 0) {
      throw new BadRequestException(
        `No se puede ${accion} un garzón con una sesión abierta`,
      );
    }
  }

  private async getOrThrow(tenantId: string, id: string): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({ where: { id, tenantId } });
    if (!garzon) {
      throw new NotFoundException(`Garzón ${id} no encontrado`);
    }
    return garzon;
  }

  /**
   * Genera un PIN aleatorio de 6 dígitos garantizado único entre los garzones
   * (no eliminados) del tenant, para que la identificación "solo por PIN" no sea
   * ambigua. Reintenta ante colisión (muy improbable con N pequeño sobre 10^6).
   * `exceptId` excluye al propio garzón al regenerar su PIN.
   */
  private async generarPinUnico(
    tenantId: string,
    exceptId?: string,
  ): Promise<string> {
    for (let intento = 0; intento < MAX_INTENTOS_PIN; intento++) {
      const pin = randomInt(0, PIN_MAX_EXCLUSIVO).toString().padStart(6, '0');
      if (!(await this.pinYaUsado(tenantId, pin, exceptId))) {
        return pin;
      }
    }
    throw new ConflictException(
      'No se pudo generar un PIN único; intenta de nuevo',
    );
  }

  /**
   * Indica si el PIN ya pertenece a algún garzón (no eliminado) del tenant.
   * Como está hasheado, se compara contra cada garzón existente. `exceptId`
   * excluye al propio garzón al regenerar su PIN.
   */
  private async pinYaUsado(
    tenantId: string,
    pin: string,
    exceptId?: string,
  ): Promise<boolean> {
    const garzones = await this.garzonRepo.find({ where: { tenantId } });
    for (const garzon of garzones) {
      if (garzon.id === exceptId) continue;
      if (await bcrypt.compare(pin, garzon.pinHash)) {
        return true;
      }
    }
    return false;
  }
}
