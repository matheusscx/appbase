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

@Injectable()
export class CategoriasService {
  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  findAll(tenantId: string): Promise<Categoria[]> {
    return this.categoriaRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
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

  async remove(tenantId: string, id: string): Promise<void> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    await this.categoriaRepo.softDelete({ id, tenantId });
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
