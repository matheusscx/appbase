import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Turno } from './entities/turno.entity';
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
}

@Injectable()
export class TurnosService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnoRepo: Repository<Turno>,
  ) {}

  private toPublico(t: Turno): TurnoPublico {
    return {
      id: t.id,
      nombre: t.nombre,
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      activo: t.activo,
      creadoEl: t.creadoEl,
      actualizadoEl: t.actualizadoEl,
    };
  }

  async listar(tenantId: string): Promise<TurnoPublico[]> {
    const turnos = await this.turnoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
    return turnos.map((t) => this.toPublico(t));
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
    if (dto.activo !== undefined) turno.activo = dto.activo;
    // Bloqueo por sesiones abiertas: Task 2 (SesionGarzon).
    return this.toPublico(await this.turnoRepo.save(turno));
  }

  async eliminar(tenantId: string, id: string): Promise<void> {
    await this.getOrThrow(tenantId, id);
    // Bloqueo por sesiones abiertas: Task 2 (SesionGarzon).
    await this.turnoRepo.softDelete({ id, tenantId });
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
   * Stub: Task 2 implementará el chequeo contra SesionGarzon abiertas.
   */
  async assertSinSesionesAbiertas(
    _tenantId: string,
    _turnoId: string,
  ): Promise<void> {
    // no-op hasta Task 2
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
