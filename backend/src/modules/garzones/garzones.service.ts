import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { Garzon } from './entities/garzon.entity';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';

const BCRYPT_COST = 10;
// El PIN se genera automáticamente; estos acotan la generación única.
const MAX_INTENTOS_PIN = 50;
const PIN_MAX_EXCLUSIVO = 1_000_000; // 000000..999999

/** Vista pública de un garzón — nunca incluye el hash del PIN. */
export interface GarzonPublico {
  id: string;
  nombre: string;
  activo: boolean;
  creadoEl: Date;
  actualizadoEl: Date;
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

  async crear(tenantId: string, dto: CreateGarzonDto): Promise<GarzonConPin> {
    const pin = await this.generarPinUnico(tenantId);
    const garzon = this.garzonRepo.create({
      tenantId,
      nombre: dto.nombre,
      pinHash: await bcrypt.hash(pin, BCRYPT_COST),
      activo: dto.activo ?? true,
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
