import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCausaMermaDto } from './dto/create-causa-merma.dto';
import { UpdateCausaMermaDto } from './dto/update-causa-merma.dto';

export interface CausaMermaListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
}

interface CausaMermaRow {
  causa_merma_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
}

type QueryRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
};

@Injectable()
export class CausasMermaService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
  ): Promise<CausaMermaListItem[]> {
    const rows: CausaMermaRow[] = await this.dataSource.query(
      `SELECT causa_merma_id, nombre, activo, es_fijo
       FROM causas_merma
       WHERE tenant_id = $1 AND eliminado_el IS NULL
         ${soloActivas ? 'AND activo = true' : ''}
       ORDER BY es_fijo DESC, nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.causa_merma_id,
      nombre: r.nombre,
      activo: r.activo,
      esFijo: r.es_fijo,
    }));
  }

  async create(
    tenantId: string,
    dto: CreateCausaMermaDto,
  ): Promise<{ id: string }> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows: { causa_merma_id: string }[] = await this.dataSource.query(
      `INSERT INTO causas_merma (tenant_id, nombre, activo, es_fijo)
       VALUES ($1, $2, $3, false) RETURNING causa_merma_id`,
      [tenantId, nombre, dto.activo ?? true],
    );
    return { id: rows[0].causa_merma_id };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCausaMermaDto,
  ): Promise<{ id: string }> {
    const causa = await this.findOneOrFail(tenantId, id);
    if (causa.esFijo) {
      throw new BadRequestException(
        'No se puede modificar una causa fija del sistema',
      );
    }
    if (dto.nombre !== undefined) {
      await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
    }

    const sets = ['actualizado_el = NOW()'];
    const params: unknown[] = [];
    let idx = 1;

    if (dto.nombre !== undefined) {
      sets.push(`nombre = $${idx++}`);
      params.push(dto.nombre.trim());
    }
    if (dto.activo !== undefined) {
      sets.push(`activo = $${idx++}`);
      params.push(dto.activo);
    }

    params.push(id, tenantId);
    await this.dataSource.query(
      `UPDATE causas_merma SET ${sets.join(', ')}
       WHERE causa_merma_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL`,
      params,
    );
    return { id };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const causa = await this.findOneOrFail(tenantId, id);
    if (causa.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar una causa fija del sistema',
      );
    }
    const uso: { cnt: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::text AS cnt FROM movimientos_inventario
       WHERE causa_merma_id = $1 AND eliminado_el IS NULL`,
      [id],
    );
    if (parseInt(uso[0].cnt, 10) > 0) {
      throw new BadRequestException(
        'No se puede eliminar: la causa está en uso en movimientos de merma',
      );
    }
    await this.dataSource.query(
      `UPDATE causas_merma SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE causa_merma_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
  }

  async assertCausaActiva(
    runner: QueryRunner,
    tenantId: string,
    causaMermaId: string,
  ): Promise<{ id: string; nombre: string }> {
    const rows: { causa_merma_id: string; nombre: string }[] =
      await runner.query(
        `SELECT causa_merma_id, nombre FROM causas_merma
         WHERE causa_merma_id = $1 AND tenant_id = $2
           AND activo = true AND eliminado_el IS NULL`,
        [causaMermaId, tenantId],
      );
    if (!rows.length) {
      throw new BadRequestException('Causa de merma no válida o inactiva');
    }
    return { id: rows[0].causa_merma_id, nombre: rows[0].nombre };
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<CausaMermaListItem> {
    const rows: CausaMermaRow[] = await this.dataSource.query(
      `SELECT causa_merma_id, nombre, activo, es_fijo
       FROM causas_merma
       WHERE causa_merma_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Causa de merma ${id} no encontrada`);
    }
    return {
      id: rows[0].causa_merma_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `
      SELECT 1 FROM causas_merma
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND causa_merma_id <> $3`;
    }
    const rows = await this.dataSource.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe una causa de merma con el nombre "${nombre}"`,
      );
    }
  }
}
