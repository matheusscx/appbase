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
}

@Injectable()
export class TurnosService {
  constructor(
    @InjectRepository(Turno)
    private readonly turnoRepo: Repository<Turno>,
    @InjectRepository(SesionGarzon)
    private readonly sesionRepo: Repository<SesionGarzon>,
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
    if (dto.activo !== undefined) {
      if (dto.activo === false) {
        await this.assertSinSesionesAbiertas(tenantId, id);
      }
      turno.activo = dto.activo;
    }
    return this.toPublico(await this.turnoRepo.save(turno));
  }

  async eliminar(tenantId: string, id: string): Promise<void> {
    await this.getOrThrow(tenantId, id);
    await this.assertSinSesionesAbiertas(tenantId, id);
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
