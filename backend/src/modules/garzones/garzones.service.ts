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
 * Respuesta de creación / regeneración: incluye el PIN en claro **una sola
 * vez**. No se persiste en claro ni se puede volver a leer (solo queda el hash).
 */
export interface GarzonConPin extends GarzonPublico {
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
    return { ...this.toPublico(guardado), pin };
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateGarzonDto,
  ): Promise<GarzonPublico> {
    const garzon = await this.getOrThrow(tenantId, id);
    if (dto.nombre !== undefined) garzon.nombre = dto.nombre;
    if (dto.activo !== undefined) garzon.activo = dto.activo;
    if (dto.tipo !== undefined) garzon.tipo = dto.tipo;
    return this.toPublico(await this.garzonRepo.save(garzon));
  }

  /**
   * Genera un PIN nuevo para el garzón y lo devuelve **una sola vez**. El PIN
   * anterior deja de funcionar de inmediato (se reemplaza el hash).
   */
  async regenerarPin(tenantId: string, id: string): Promise<GarzonConPin> {
    const garzon = await this.getOrThrow(tenantId, id);
    const pin = await this.generarPinUnico(tenantId, id);
    garzon.pinHash = await bcrypt.hash(pin, BCRYPT_COST);
    const guardado = await this.garzonRepo.save(garzon);
    return { ...this.toPublico(guardado), pin };
  }

  async eliminar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.getOrThrow(tenantId, id);
    const abiertas = await this.sesionRepo.count({
      where: {
        tenantId,
        garzonId: id,
        estado: EstadoSesionGarzon.ABIERTA,
      },
    });
    if (abiertas > 0) {
      throw new BadRequestException(
        'No se puede eliminar un garzón con una sesión abierta',
      );
    }
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.garzonRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<GarzonPublico> {
    // Una sola regla para los dos casos —no existe, o existe y está viva—:
    // `eliminadoEl` no nulo es lo que define "está en la papelera".
    const garzon = await this.garzonRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!garzon || !garzon.eliminadoEl) {
      throw new NotFoundException(`Garzón ${id} no está en la papelera`);
    }
    try {
      await this.garzonRepo.restore({ id, tenantId });
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
