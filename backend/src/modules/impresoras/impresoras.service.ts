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

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Impresora[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type ImpresoraConAuditoria = Impresora & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class ImpresorasService {
  constructor(
    @InjectRepository(Impresora)
    private readonly impresoraRepo: Repository<Impresora>,
  ) {}

  async listar(
    tenantId: string,
    rol?: RolImpresora,
    incluirEliminados = false,
  ): Promise<ImpresoraConAuditoria[]> {
    if (!incluirEliminados) {
      return this.impresoraRepo.find({
        where: rol ? { tenantId, rol } : { tenantId },
        order: { nombre: 'ASC' },
      });
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const qb = this.impresoraRepo
      .createQueryBuilder('i')
      .leftJoin('usuarios', 'u', 'u.usuario_id = i.eliminado_por')
      .addSelect('u.nombre_usuario', 'i_eliminado_por_nombre')
      .where('i.tenant_id = :tenantId', { tenantId })
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema, no restaurable ni visible — decisión del
      // owner, docs/features/papelera.md.
      .andWhere('(i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)')
      .withDeleted()
      .orderBy('i.nombre', 'ASC');
    if (rol) {
      qb.andWhere('i.rol = :rol', { rol });
    }
    const { entities, raw } = await qb.getRawAndEntities<{
      i_eliminado_por_nombre: string | null;
    }>();
    return entities.map((impresora, i) => ({
      ...impresora,
      eliminadoPorNombre: raw[i].i_eliminado_por_nombre,
    }));
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

  async eliminar(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    await this.getOrThrow(tenantId, id);
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.impresoraRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Impresora> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const impresora = await this.impresoraRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!impresora || !impresora.eliminadoEl || !impresora.eliminadoPor) {
      throw new NotFoundException(`Impresora ${id} no está en la papelera`);
    }
    await this.impresoraRepo.restore({ id, tenantId });
    return this.impresoraRepo.findOneOrFail({ where: { id, tenantId } });
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
