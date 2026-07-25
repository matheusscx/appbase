import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateMotivoDiferenciaDto } from './dto/create-motivo-diferencia.dto';
import { UpdateMotivoDiferenciaDto } from './dto/update-motivo-diferencia.dto';

export interface MotivoDiferenciaListItem {
  id: string;
  nombre: string;
  activo: boolean;
  requiereComentario: boolean;
  esFijo: boolean;
}

interface Row {
  motivo_diferencia_id: string;
  nombre: string;
  activo: boolean;
  requiere_comentario: boolean;
  es_fijo: boolean;
}

type Runner = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

const COLS =
  'motivo_diferencia_id, nombre, activo, requiere_comentario, es_fijo';

// TypeORM + pg: INSERT/UPDATE ... RETURNING llega como [rows, rowCount], no como rows.
function unwrap<T>(raw: unknown): T[] {
  return Array.isArray((raw as unknown[])[0])
    ? ((raw as T[][])[0] ?? [])
    : ((raw as T[]) ?? []);
}

function toItem(r: Row): MotivoDiferenciaListItem {
  return {
    id: r.motivo_diferencia_id,
    nombre: r.nombre,
    activo: r.activo,
    requiereComentario: r.requiere_comentario,
    esFijo: r.es_fijo,
  };
}

@Injectable()
export class MotivosDiferenciaService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
  ): Promise<MotivoDiferenciaListItem[]> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT ${COLS} FROM motivo_diferencia_caja
       WHERE tenant_id = $1 AND eliminado_el IS NULL
         ${soloActivas ? 'AND activo = true' : ''}
       ORDER BY es_fijo DESC, nombre ASC`,
      [tenantId],
    );
    return rows.map(toItem);
  }

  async create(
    tenantId: string,
    dto: CreateMotivoDiferenciaDto,
  ): Promise<MotivoDiferenciaListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<Row>(
      await this.dataSource.query(
        `INSERT INTO motivo_diferencia_caja
           (tenant_id, nombre, activo, requiere_comentario, es_fijo)
         VALUES ($1, $2, $3, $4, false)
         RETURNING ${COLS}`,
        [tenantId, nombre, dto.activo ?? true, dto.requiereComentario ?? false],
      ),
    );
    return toItem(rows[0]);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoDiferenciaDto,
  ): Promise<MotivoDiferenciaListItem> {
    const motivo = await this.findOneOrFail(tenantId, id);
    // Divergencia de causas-merma: en un fijo se bloquea SOLO el rename.
    if (motivo.esFijo && dto.nombre !== undefined) {
      throw new BadRequestException(
        'No se puede renombrar un motivo fijo del sistema',
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
    if (dto.requiereComentario !== undefined) {
      sets.push(`requiere_comentario = $${idx++}`);
      params.push(dto.requiereComentario);
    }

    params.push(id, tenantId);
    const rows = unwrap<Row>(
      await this.dataSource.query(
        `UPDATE motivo_diferencia_caja SET ${sets.join(', ')}
         WHERE motivo_diferencia_id = $${idx++} AND tenant_id = $${idx}
           AND eliminado_el IS NULL
         RETURNING ${COLS}`,
        params,
      ),
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo ${id} no encontrado`);
    }
    return toItem(rows[0]);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar un motivo fijo del sistema',
      );
    }
    await this.dataSource.query(
      `UPDATE motivo_diferencia_caja SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
  }

  /** Valida que un motivo pertenezca al tenant y esté activo (para el cierre/justificación). */
  async assertMotivoValido(
    runner: Runner,
    tenantId: string,
    motivoId: string,
  ): Promise<{ id: string; nombre: string; requiereComentario: boolean }> {
    const rows = (await runner.query(
      `SELECT motivo_diferencia_id, nombre, requiere_comentario
       FROM motivo_diferencia_caja
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2
         AND activo = true AND eliminado_el IS NULL`,
      [motivoId, tenantId],
    )) as {
      motivo_diferencia_id: string;
      nombre: string;
      requiere_comentario: boolean;
    }[];
    if (!rows.length) {
      throw new BadRequestException(
        'Motivo de diferencia no válido o inactivo',
      );
    }
    return {
      id: rows[0].motivo_diferencia_id,
      nombre: rows[0].nombre,
      requiereComentario: rows[0].requiere_comentario,
    };
  }

  async hayMotivosActivos(runner: Runner, tenantId: string): Promise<boolean> {
    const rows = (await runner.query(
      `SELECT 1 FROM motivo_diferencia_caja
       WHERE tenant_id = $1 AND activo = true AND eliminado_el IS NULL LIMIT 1`,
      [tenantId],
    )) as unknown[];
    return rows.length > 0;
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<MotivoDiferenciaListItem> {
    const rows: Row[] = await this.dataSource.query(
      `SELECT ${COLS} FROM motivo_diferencia_caja
       WHERE motivo_diferencia_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo ${id} no encontrado`);
    }
    return toItem(rows[0]);
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `SELECT 1 FROM motivo_diferencia_caja
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_diferencia_id <> $3`;
    }
    const rows: unknown[] = await this.dataSource.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo con el nombre "${nombre}"`,
      );
    }
  }
}
