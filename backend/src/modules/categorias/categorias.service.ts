import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Categoria } from './entities/categoria.entity';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Categoria[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type CategoriaConAuditoria = Categoria & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class CategoriasService {
  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<CategoriaConAuditoria[]> {
    if (!incluirEliminados) {
      return this.categoriaRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    }
    // El nombre de quien borró sale por JOIN en la misma query: una consulta
    // por fila sería N+1 sobre un listado que puede tener cientos.
    // `getMany()` descarta los `addSelect` que no mapean a una columna de la
    // entity, así que hay que usar `getRawAndEntities()` y fusionar a mano.
    const { entities, raw } = await this.categoriaRepo
      .createQueryBuilder('c')
      // Sin `AND u.eliminado_el IS NULL`, a propósito: el autor de un borrado
      // es un hecho histórico y no debe desaparecer solo porque ese usuario
      // se haya dado de baja después (docs/patterns/backend.md, excepción
      // documentada junto a la regla general de soft delete).
      .leftJoin('usuarios', 'u', 'u.usuario_id = c.eliminado_por')
      .addSelect('u.nombre_usuario', 'c_eliminado_por_nombre')
      .where('c.tenant_id = :tenantId', { tenantId })
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un borrado
      // del sistema (seeder, `remapImpuestosOficialesDuplicados`), no
      // restaurable ni visible — decisión del owner, docs/features/papelera.md.
      .andWhere('(c.eliminado_el IS NULL OR c.eliminado_por IS NOT NULL)')
      .withDeleted()
      .orderBy('c.nombre', 'ASC')
      .getRawAndEntities<{ c_eliminado_por_nombre: string | null }>();

    return entities.map((categoria, i) => ({
      ...categoria,
      eliminadoPorNombre: raw[i].c_eliminado_por_nombre,
    }));
  }

  async create(tenantId: string, dto: CreateCategoriaDto): Promise<Categoria> {
    if (dto.impresoraId) {
      await this.validarImpresoraComanda(tenantId, dto.impresoraId);
    }
    const categoria = this.categoriaRepo.create({
      tenantId,
      nombre: dto.nombre,
      aplicaA: dto.aplicaA ?? 'ambos',
      activo: dto.activo ?? true,
      impresoraId: dto.impresoraId ?? null,
    });
    return this.categoriaRepo.save(categoria);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCategoriaDto,
  ): Promise<Categoria> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    if (dto.impresoraId) {
      await this.validarImpresoraComanda(tenantId, dto.impresoraId);
    }
    Object.assign(categoria, dto);
    return this.categoriaRepo.save(categoria);
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    // Una sola escritura en vez de `update` + `softDelete`: dos sentencias
    // sueltas pueden quedar a medias y dejar una fila borrada sin autor.
    await this.categoriaRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Categoria> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!categoria || !categoria.eliminadoEl || !categoria.eliminadoPor) {
      throw new NotFoundException(`Categoría ${id} no está en la papelera`);
    }
    await this.categoriaRepo.restore({ id, tenantId });
    return this.categoriaRepo.findOneOrFail({ where: { id, tenantId } });
  }

  private async validarImpresoraComanda(
    tenantId: string,
    impresoraId: string,
  ): Promise<void> {
    const rows: { impresora_id: string }[] = await this.dataSource.query(
      `SELECT impresora_id FROM impresoras
        WHERE impresora_id = $1 AND tenant_id = $2 AND rol = 'comanda'
          AND activo = true AND eliminado_el IS NULL`,
      [impresoraId, tenantId],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        `Impresora ${impresoraId} no es válida para comandas`,
      );
    }
  }
}
