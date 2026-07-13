import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Garzon } from './entities/garzon.entity';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { ResetPinDto } from './dto/reset-pin.dto';

const BCRYPT_COST = 10;

/** Vista pública de un garzón — nunca incluye el hash del PIN. */
export interface GarzonPublico {
  id: string;
  nombre: string;
  activo: boolean;
  creadoEl: Date;
  actualizadoEl: Date;
}

@Injectable()
export class GarzonesService {
  constructor(
    @InjectRepository(Garzon)
    private readonly garzonRepo: Repository<Garzon>,
  ) {}

  private toPublico(g: Garzon): GarzonPublico {
    return {
      id: g.id,
      nombre: g.nombre,
      activo: g.activo,
      creadoEl: g.creadoEl,
      actualizadoEl: g.actualizadoEl,
    };
  }

  async listar(tenantId: string): Promise<GarzonPublico[]> {
    const garzones = await this.garzonRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
    return garzones.map((g) => this.toPublico(g));
  }

  async crear(tenantId: string, dto: CreateGarzonDto): Promise<GarzonPublico> {
    await this.assertPinDisponible(tenantId, dto.pin);
    const garzon = this.garzonRepo.create({
      tenantId,
      nombre: dto.nombre,
      pinHash: await bcrypt.hash(dto.pin, BCRYPT_COST),
      activo: dto.activo ?? true,
    });
    return this.toPublico(await this.garzonRepo.save(garzon));
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateGarzonDto,
  ): Promise<GarzonPublico> {
    const garzon = await this.getOrThrow(tenantId, id);
    if (dto.nombre !== undefined) garzon.nombre = dto.nombre;
    if (dto.activo !== undefined) garzon.activo = dto.activo;
    return this.toPublico(await this.garzonRepo.save(garzon));
  }

  async resetPin(
    tenantId: string,
    id: string,
    dto: ResetPinDto,
  ): Promise<GarzonPublico> {
    const garzon = await this.getOrThrow(tenantId, id);
    await this.assertPinDisponible(tenantId, dto.pin, id);
    garzon.pinHash = await bcrypt.hash(dto.pin, BCRYPT_COST);
    return this.toPublico(await this.garzonRepo.save(garzon));
  }

  async eliminar(tenantId: string, id: string): Promise<void> {
    await this.getOrThrow(tenantId, id);
    await this.garzonRepo.softDelete({ id, tenantId });
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

  private async getOrThrow(tenantId: string, id: string): Promise<Garzon> {
    const garzon = await this.garzonRepo.findOne({ where: { id, tenantId } });
    if (!garzon) {
      throw new NotFoundException(`Garzón ${id} no encontrado`);
    }
    return garzon;
  }

  /**
   * El PIN debe ser único entre los garzones (no eliminados) del tenant, para
   * que la identificación "solo por PIN" no sea ambigua. Como está hasheado,
   * se compara contra cada garzón existente. `exceptId` excluye al propio
   * garzón en un reset.
   */
  private async assertPinDisponible(
    tenantId: string,
    pin: string,
    exceptId?: string,
  ): Promise<void> {
    const garzones = await this.garzonRepo.find({ where: { tenantId } });
    for (const garzon of garzones) {
      if (garzon.id === exceptId) continue;
      if (await bcrypt.compare(pin, garzon.pinHash)) {
        throw new BadRequestException(
          'Ya existe un garzón con ese PIN en este tenant',
        );
      }
    }
  }
}
