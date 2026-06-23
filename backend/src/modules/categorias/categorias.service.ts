import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Categoria } from './entities/categoria.entity';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { UpdateCategoriaDto } from './dto/update-categoria.dto';

@Injectable()
export class CategoriasService {
  constructor(
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
  ) {}

  findAll(tenantId: string): Promise<Categoria[]> {
    return this.categoriaRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  create(tenantId: string, dto: CreateCategoriaDto): Promise<Categoria> {
    const categoria = this.categoriaRepo.create({
      tenantId,
      nombre: dto.nombre,
      aplicaA: dto.aplicaA ?? 'ambos',
      activo: dto.activo ?? true,
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
}
