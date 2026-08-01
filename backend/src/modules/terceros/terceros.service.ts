import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tercero } from './entities/tercero.entity';
import { CreateTerceroDto } from './dto/create-tercero.dto';
import { UpdateTerceroDto } from './dto/update-tercero.dto';

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Tercero[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type TerceroConAuditoria = Tercero & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class TercerosService {
  constructor(
    @InjectRepository(Tercero)
    private readonly terceroRepo: Repository<Tercero>,
  ) {}

  async findAll(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<TerceroConAuditoria[]> {
    if (!incluirEliminados) {
      return this.terceroRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const { entities, raw } = await this.terceroRepo
      .createQueryBuilder('t')
      .leftJoin('usuarios', 'u', 'u.usuario_id = t.eliminado_por')
      .addSelect('u.nombre_usuario', 't_eliminado_por_nombre')
      .where('t.tenant_id = :tenantId', { tenantId })
      .withDeleted()
      .orderBy('t.nombre', 'ASC')
      .getRawAndEntities<{ t_eliminado_por_nombre: string | null }>();

    return entities.map((tercero, i) => ({
      ...tercero,
      eliminadoPorNombre: raw[i].t_eliminado_por_nombre,
    }));
  }

  create(tenantId: string, dto: CreateTerceroDto): Promise<Tercero> {
    const tercero = this.terceroRepo.create({
      tenantId,
      tipo: dto.tipo,
      nombre: dto.nombre,
      rut: dto.rut,
      nombreLegal: dto.nombreLegal,
      rutFiscal: dto.rutFiscal,
      correo: dto.correo,
      telefono: dto.telefono,
      direccion: dto.direccion,
      activo: dto.activo ?? true,
    });
    return this.terceroRepo.save(tercero);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTerceroDto,
  ): Promise<Tercero> {
    const tercero = await this.terceroRepo.findOne({
      where: { id, tenantId },
    });
    if (!tercero) {
      throw new NotFoundException(`Tercero ${id} no encontrado`);
    }
    Object.assign(tercero, dto);
    return this.terceroRepo.save(tercero);
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const tercero = await this.terceroRepo.findOne({
      where: { id, tenantId },
    });
    if (!tercero) {
      throw new NotFoundException(`Tercero ${id} no encontrado`);
    }
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.terceroRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Tercero> {
    // Una sola regla para los dos casos —no existe, o existe y está viva—:
    // `eliminadoEl` no nulo es lo que define "está en la papelera".
    const tercero = await this.terceroRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!tercero || !tercero.eliminadoEl) {
      throw new NotFoundException(`Tercero ${id} no está en la papelera`);
    }
    await this.terceroRepo.restore({ id, tenantId });
    return this.terceroRepo.findOneOrFail({ where: { id, tenantId } });
  }
}
