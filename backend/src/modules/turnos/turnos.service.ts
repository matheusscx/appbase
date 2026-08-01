import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Turno } from './entities/turno.entity';
import {
  EstadoSesionGarzon,
  SesionGarzon,
} from './entities/sesion-garzon.entity';
import { CreateTurnoDto } from './dto/create-turno.dto';
import { UpdateTurnoDto } from './dto/update-turno.dto';

/** Vista pública de un turno. */
export interface TurnoPublico {
  id: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  activo: boolean;
  creadoEl: Date;
  actualizadoEl: Date;
  eliminadoEl?: Date | null;
  // Opcional: el listado sin `incluirEliminados` no hace el JOIN a `usuarios`
  // (N+1 si lo forzáramos ahí).
  eliminadoPorNombre?: string | null;
}

@Injectable()
export class TurnosService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnoRepo: Repository<Turno>,
    @InjectRepository(SesionGarzon)
    private readonly sesionRepo: Repository<SesionGarzon>,
  ) {}

  private toPublico(
    t: Turno,
    eliminadoPorNombre?: string | null,
  ): TurnoPublico {
    return {
      id: t.id,
      nombre: t.nombre,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      activo: t.activo,
      creadoEl: t.creadoEl,
      actualizadoEl: t.actualizadoEl,
      eliminadoEl: t.eliminadoEl,
      ...(eliminadoPorNombre !== undefined ? { eliminadoPorNombre } : {}),
    };
  }

  async listar(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<TurnoPublico[]> {
    if (!incluirEliminados) {
      const turnos = await this.turnoRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
      return turnos.map((t) => this.toPublico(t));
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const { entities, raw } = await this.turnoRepo
      .createQueryBuilder('t')
      .leftJoin('usuarios', 'u', 'u.usuario_id = t.eliminado_por')
      .addSelect('u.nombre_usuario', 't_eliminado_por_nombre')
      .where('t.tenant_id = :tenantId', { tenantId })
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema (seeder, `remapImpuestosOficialesDuplicados`),
      // no restaurable ni visible — decisión del owner, docs/features/papelera.md.
      .andWhere('(t.eliminado_el IS NULL OR t.eliminado_por IS NOT NULL)')
      .withDeleted()
      .orderBy('t.nombre', 'ASC')
      .getRawAndEntities<{ t_eliminado_por_nombre: string | null }>();

    return entities.map((t, i) =>
      this.toPublico(t, raw[i].t_eliminado_por_nombre),
    );
  }

  async crear(tenantId: string, dto: CreateTurnoDto): Promise<TurnoPublico> {
    await this.assertNombreUnico(tenantId, dto.nombre);
    const turno = this.turnoRepo.create({
      tenantId,
      nombre: dto.nombre,
      horaInicio: dto.horaInicio,
      horaFin: dto.horaFin,
      activo: dto.activo ?? true,
    });
    const guardado = await this.turnoRepo.save(turno);
    return this.toPublico(guardado);
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateTurnoDto,
  ): Promise<TurnoPublico> {
    const turno = await this.getOrThrow(tenantId, id);
    if (dto.nombre !== undefined) {
      await this.assertNombreUnico(tenantId, dto.nombre, id);
      turno.nombre = dto.nombre;
    }
    if (dto.horaInicio !== undefined) turno.horaInicio = dto.horaInicio;
    if (dto.horaFin !== undefined) turno.horaFin = dto.horaFin;
    if (dto.activo !== undefined) {
      if (dto.activo === false) {
        await this.assertSinSesionesAbiertas(tenantId, id);
      }
      turno.activo = dto.activo;
    }
    return this.toPublico(await this.turnoRepo.save(turno));
  }

  async eliminar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.getOrThrow(tenantId, id);
    await this.assertSinSesionesAbiertas(tenantId, id);
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.turnoRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<TurnoPublico> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const turno = await this.turnoRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!turno || !turno.eliminadoEl || !turno.eliminadoPor) {
      throw new NotFoundException(`Turno ${id} no está en la papelera`);
    }
    // `turnos` no tiene índice único de nombre (medido: no hay `CREATE
    // UNIQUE INDEX` sobre la tabla) — la unicidad la garantiza `crear()`/
    // `actualizar()` en código vía `assertNombreUnico`, que excluye
    // borrados (`findOne` con `@DeleteDateColumn` los filtra solo). Sin
    // este chequeo acá, restaurar reabre exactamente el hueco que esa
    // validación existe para cerrar (reusa `assertNombreUnico`, no una
    // validación nueva). `assertNombreUnico` lanza `ConflictException`
    // (409) porque así lo esperan `crear()`/`actualizar()` ya probados; acá
    // se traduce a 400, el mismo status accionable que dan los recursos con
    // índice único al restaurar.
    try {
      await this.assertNombreUnico(tenantId, turno.nombre, id);
    } catch (e) {
      if (e instanceof ConflictException) {
        throw new BadRequestException(
          `Ya existe un turno activo con el nombre "${turno.nombre}". Renombrá el actual o el restaurado antes de continuar.`,
        );
      }
      throw e;
    }
    // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
    // viejo sobreviviría y disfrazaría un borrado del sistema posterior como
    // borrado de persona (ver categorias.service.ts → restaurar()).
    await this.turnoRepo.update(
      { id, tenantId },
      { eliminadoEl: null, eliminadoPor: null },
    );
    const restaurado = await this.turnoRepo.findOneOrFail({
      where: { id, tenantId },
    });
    return this.toPublico(restaurado);
  }

  /**
   * Devuelve el turno activo o lanza 400 (uso operativo al iniciar sesión).
   */
  async getActivoOrThrow(tenantId: string, id: string): Promise<Turno> {
    const turno = await this.turnoRepo.findOne({ where: { id, tenantId } });
    if (!turno || !turno.activo) {
      throw new BadRequestException('Turno inválido o inactivo');
    }
    return turno;
  }

  /**
   * Bloquea desactivar/eliminar un turno con sesiones de garzón abiertas.
   */
  async assertSinSesionesAbiertas(
    tenantId: string,
    turnoId: string,
  ): Promise<void> {
    const abiertas = await this.sesionRepo.count({
      where: {
        tenantId,
        turnoId,
        estado: EstadoSesionGarzon.ABIERTA,
      },
    });
    if (abiertas > 0) {
      throw new BadRequestException(
        'No se puede modificar un turno con sesiones abiertas',
      );
    }
  }

  private async getOrThrow(tenantId: string, id: string): Promise<Turno> {
    const turno = await this.turnoRepo.findOne({ where: { id, tenantId } });
    if (!turno) {
      throw new NotFoundException(`Turno ${id} no encontrado`);
    }
    return turno;
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    exceptId?: string,
  ): Promise<void> {
    const existente = await this.turnoRepo.findOne({
      where: { tenantId, nombre },
    });
    if (existente && existente.id !== exceptId) {
      throw new ConflictException('Ya existe un turno con ese nombre');
    }
  }
}
