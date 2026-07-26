import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CreateMotivoDiferenciaInventarioDto } from './dto/create-motivo-diferencia-inventario.dto';
import { UpdateMotivoDiferenciaInventarioDto } from './dto/update-motivo-diferencia-inventario.dto';

export interface MotivoDiferenciaInventarioListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
}

interface MotivoDiferenciaInventarioRow {
  motivo_diferencia_inventario_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
}

@Injectable()
export class MotivosDiferenciaInventarioService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
  ): Promise<MotivoDiferenciaInventarioListItem[]> {
    const rows: MotivoDiferenciaInventarioRow[] = await this.dataSource.query(
      `SELECT motivo_diferencia_inventario_id, nombre, activo, es_fijo
       FROM motivo_diferencia_inventario
       WHERE tenant_id = $1 AND eliminado_el IS NULL
         ${soloActivas ? 'AND activo = true' : ''}
       ORDER BY es_fijo DESC, nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.motivo_diferencia_inventario_id,
      nombre: r.nombre,
      activo: r.activo,
      esFijo: r.es_fijo,
    }));
  }

  async create(
    tenantId: string,
    dto: CreateMotivoDiferenciaInventarioDto,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<MotivoDiferenciaInventarioRow>(
      await this.dataSource.query(
        `INSERT INTO motivo_diferencia_inventario (tenant_id, nombre, activo, es_fijo)
         VALUES ($1, $2, $3, false)
         RETURNING motivo_diferencia_inventario_id, nombre, activo, es_fijo`,
        [tenantId, nombre, dto.activo ?? true],
      ),
    );
    return {
      id: rows[0].motivo_diferencia_inventario_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoDiferenciaInventarioDto,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede modificar un motivo fijo del sistema',
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
    const rows = unwrap<MotivoDiferenciaInventarioRow>(
      await this.dataSource.query(
        `UPDATE motivo_diferencia_inventario SET ${sets.join(', ')}
         WHERE motivo_diferencia_inventario_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
         RETURNING motivo_diferencia_inventario_id, nombre, activo, es_fijo`,
        params,
      ),
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo de diferencia ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_diferencia_inventario_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar un motivo fijo del sistema',
      );
    }

    const uso: { cnt: string }[] = await this.dataSource.query(
      `SELECT COUNT(*)::text AS cnt FROM movimientos_inventario
        WHERE motivo_diferencia_id = $1 AND eliminado_el IS NULL`,
      [id],
    );
    if (parseInt(uso[0].cnt, 10) > 0) {
      throw new BadRequestException(
        'No se puede eliminar: el motivo está en uso en movimientos de recuento',
      );
    }

    await this.dataSource.query(
      `UPDATE motivo_diferencia_inventario SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
  }

  async assertMotivoActivo(
    runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    tenantId: string,
    motivoId: string,
  ): Promise<{ id: string; nombre: string }> {
    const rows = (await runner.query(
      `SELECT motivo_diferencia_inventario_id, nombre
         FROM motivo_diferencia_inventario
        WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2
          AND activo = true AND eliminado_el IS NULL`,
      [motivoId, tenantId],
    )) as { motivo_diferencia_inventario_id: string; nombre: string }[];
    if (!rows.length) {
      throw new BadRequestException(
        'Motivo de diferencia no válido o inactivo',
      );
    }
    return {
      id: rows[0].motivo_diferencia_inventario_id,
      nombre: rows[0].nombre,
    };
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    const rows: MotivoDiferenciaInventarioRow[] = await this.dataSource.query(
      `SELECT motivo_diferencia_inventario_id, nombre, activo, es_fijo
       FROM motivo_diferencia_inventario
       WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo de diferencia ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_diferencia_inventario_id,
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
      SELECT 1 FROM motivo_diferencia_inventario
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_diferencia_inventario_id <> $3`;
    }
    const rows: unknown[] = await this.dataSource.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo de diferencia con el nombre "${nombre}"`,
      );
    }
  }
}
