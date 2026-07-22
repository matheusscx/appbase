import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Impresora, RolImpresora } from './entities/impresora.entity';
import { CreateImpresoraDto } from './dto/create-impresora.dto';
import { UpdateImpresoraDto } from './dto/update-impresora.dto';

@Injectable()
export class ImpresorasService {
  constructor(
    @InjectRepository(Impresora)
    private readonly impresoraRepo: Repository<Impresora>,
  ) {}

  listar(tenantId: string, rol?: RolImpresora): Promise<Impresora[]> {
    return this.impresoraRepo.find({
      where: rol ? { tenantId, rol } : { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async crear(tenantId: string, dto: CreateImpresoraDto): Promise<Impresora> {
    this.validarConexion(dto);
    const impresora = this.impresoraRepo.create({
      tenantId,
      nombre: dto.nombre,
      rol: dto.rol,
      tipoConexion: dto.tipoConexion,
      host: dto.tipoConexion === 'red' ? (dto.host ?? null) : null,
      puerto: dto.tipoConexion === 'red' ? (dto.puerto ?? null) : null,
      nombreCola:
        dto.tipoConexion === 'sistema' ? (dto.nombreCola ?? null) : null,
      activo: dto.activo ?? true,
    });
    return this.impresoraRepo.save(impresora);
  }

  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateImpresoraDto,
  ): Promise<Impresora> {
    const impresora = await this.getOrThrow(tenantId, id);
    if (dto.nombre !== undefined) impresora.nombre = dto.nombre;
    if (dto.rol !== undefined) impresora.rol = dto.rol;
    if (dto.tipoConexion !== undefined)
      impresora.tipoConexion = dto.tipoConexion;
    if (dto.host !== undefined) impresora.host = dto.host;
    if (dto.puerto !== undefined) impresora.puerto = dto.puerto;
    if (dto.nombreCola !== undefined) impresora.nombreCola = dto.nombreCola;
    if (dto.activo !== undefined) impresora.activo = dto.activo;
    return this.impresoraRepo.save(impresora);
  }

  async eliminar(tenantId: string, id: string): Promise<void> {
    await this.getOrThrow(tenantId, id);
    await this.impresoraRepo.softDelete({ id, tenantId });
  }

  private validarConexion(dto: CreateImpresoraDto): void {
    if (dto.tipoConexion === 'red' && (!dto.host || !dto.puerto)) {
      throw new BadRequestException(
        'Host y puerto son requeridos para una impresora de red',
      );
    }
    if (dto.tipoConexion === 'sistema' && !dto.nombreCola) {
      throw new BadRequestException(
        'El nombre de la cola es requerido para una impresora de sistema',
      );
    }
  }

  private async getOrThrow(tenantId: string, id: string): Promise<Impresora> {
    const impresora = await this.impresoraRepo.findOne({
      where: { id, tenantId },
    });
    if (!impresora) {
      throw new NotFoundException(`Impresora ${id} no encontrada`);
    }
    return impresora;
  }
}
