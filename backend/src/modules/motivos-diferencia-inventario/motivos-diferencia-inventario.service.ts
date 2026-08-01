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

/** `DataSource` o el `EntityManager` de una transacción: ambos exponen `query`. */
type SqlRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

// `eliminadoEl`/`eliminadoPor`/`eliminadoPorNombre` solo se completan cuando
// se pide `incluirEliminados` (o tras `restaurar`): el listado normal no trae
// esas columnas, sin el JOIN, N+1 si lo forzáramos ahí.
export interface MotivoDiferenciaInventarioListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

interface MotivoDiferenciaInventarioRow {
  motivo_diferencia_inventario_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
}

interface MotivoDiferenciaInventarioRowConEliminado extends MotivoDiferenciaInventarioRow {
  eliminado_el: string | null;
  eliminado_por: string | null;
  eliminado_por_nombre?: string | null;
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
    incluirEliminados = false,
  ): Promise<MotivoDiferenciaInventarioListItem[]> {
    if (!incluirEliminados) {
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

    // Papelera: incluye los borrados y el nombre de quien borró, resuelto
    // por JOIN en la misma query (una por fila sería N+1). Sin filtrar el
    // `eliminado_el` de `usuarios` a propósito: el autor de un borrado es un
    // hecho histórico (docs/patterns/backend.md, ver categorias.service.ts →
    // findAll).
    const rows: MotivoDiferenciaInventarioRowConEliminado[] =
      await this.dataSource.query(
        `SELECT m.motivo_diferencia_inventario_id, m.nombre, m.activo, m.es_fijo,
                m.eliminado_el, m.eliminado_por,
                u.nombre_usuario AS eliminado_por_nombre
           FROM motivo_diferencia_inventario m
           LEFT JOIN usuarios u ON u.usuario_id = m.eliminado_por
          WHERE m.tenant_id = $1
            ${soloActivas ? 'AND m.activo = true' : ''}
          ORDER BY m.es_fijo DESC, m.nombre ASC`,
        [tenantId],
      );
    return rows.map((r) => ({
      id: r.motivo_diferencia_inventario_id,
      nombre: r.nombre,
      activo: r.activo,
      esFijo: r.es_fijo,
      eliminadoEl: r.eliminado_el,
      eliminadoPor: r.eliminado_por,
      eliminadoPorNombre: r.eliminado_por_nombre,
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

  // Transaccional y con la fila bloqueada por la misma razón que `remove`:
  // desactivar (`activo = false`) durante un `aplicar()` en vuelo dejaría en
  // el kardex una causa inactiva. Ver el comentario de `remove`.
  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoDiferenciaInventarioDto,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    return this.dataSource.transaction(async (manager) => {
      const motivo = await this.findOneOrFail(tenantId, id, manager, true);
      if (motivo.esFijo) {
        throw new BadRequestException(
          'No se puede modificar un motivo fijo del sistema',
        );
      }
      if (dto.nombre !== undefined) {
        await this.assertNombreUnico(tenantId, dto.nombre.trim(), id, manager);
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
        await manager.query(
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
    });
  }

  // Verificar el uso y borrar en queries sueltas era un check-then-act: bajo
  // READ COMMITTED el EXISTS no ve los INSERT todavía sin commitear de un
  // `aplicar()` de recuento en vuelo, así que el motivo se eliminaba igual y
  // quedaba congelado en el kardex. El lock de la fila lo cierra: `aplicar()`
  // la toma con FOR SHARE mientras revalida, este FOR UPDATE espera a que
  // commitee y recién entonces el EXISTS ve los movimientos.
  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const motivo = await this.findOneOrFail(tenantId, id, manager, true);
      if (motivo.esFijo) {
        throw new BadRequestException(
          'No se puede eliminar un motivo fijo del sistema',
        );
      }

      // Una sola query cubre las tres referencias posibles a la causa: el
      // kardex ya aplicado, el override de línea de un recuento en borrador y
      // la causa por defecto de la sesión — nunca tres queries sueltas.
      const uso: { existe: boolean }[] = await manager.query(
        `SELECT EXISTS (
           SELECT 1 FROM movimientos_inventario
            WHERE motivo_diferencia_id = $1 AND eliminado_el IS NULL
           UNION ALL
           SELECT 1 FROM recuento_inventario_linea
            WHERE motivo_diferencia_id = $1 AND eliminado_el IS NULL
           UNION ALL
           SELECT 1 FROM recuento_inventario
            WHERE motivo_diferencia_default_id = $1 AND eliminado_el IS NULL
         ) AS existe`,
        [id],
      );
      if (uso[0].existe) {
        throw new BadRequestException(
          'No se puede eliminar: el motivo está en uso en movimientos o recuentos de inventario',
        );
      }

      // Una sola escritura en vez de dos sentencias sueltas: no puede quedar
      // una fila borrada sin autor.
      await manager.query(
        `UPDATE motivo_diferencia_inventario
            SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
          WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [id, tenantId, usuarioId],
      );
    });
  }

  async restaurar(
    tenantId: string,
    id: string,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    try {
      // `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve
      // búsqueda y escritura en una sentencia: no hay ventana entre leer y
      // escribir.
      const rows = unwrap<MotivoDiferenciaInventarioRowConEliminado>(
        await this.dataSource.query(
          `UPDATE motivo_diferencia_inventario
              SET eliminado_el = NULL, actualizado_el = NOW()
            WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL
          RETURNING motivo_diferencia_inventario_id, nombre, activo, es_fijo,
                    eliminado_el, eliminado_por`,
          [id, tenantId],
        ),
      );
      if (!rows.length) {
        throw new NotFoundException(
          `Motivo de diferencia ${id} no está en la papelera`,
        );
      }
      return {
        id: rows[0].motivo_diferencia_inventario_id,
        nombre: rows[0].nombre,
        activo: rows[0].activo,
        esFijo: rows[0].es_fijo,
        eliminadoEl: rows[0].eliminado_el,
        eliminadoPor: rows[0].eliminado_por,
      };
    } catch (e) {
      // 23505 = unique_violation. El índice único de nombre es parcial
      // (WHERE eliminado_el IS NULL): mientras el motivo estaba borrado
      // nadie competía por el nombre, pero al revivirlo vuelve a competir.
      // Se capta el código de Postgres —no una lista de índices a mano—
      // para que valga también donde no lo enumeramos.
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          'Ya existe un motivo de diferencia activo con ese nombre. Renombrá el actual o el restaurado antes de continuar.',
        );
      }
      throw e;
    }
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
    runner: SqlRunner = this.dataSource,
    bloquear = false,
  ): Promise<MotivoDiferenciaInventarioListItem> {
    const rows = (await runner.query(
      `SELECT motivo_diferencia_inventario_id, nombre, activo, es_fijo
       FROM motivo_diferencia_inventario
       WHERE motivo_diferencia_inventario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ${bloquear ? 'FOR UPDATE' : ''}`,
      [id, tenantId],
    )) as MotivoDiferenciaInventarioRow[];
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
    runner: SqlRunner = this.dataSource,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `
      SELECT 1 FROM motivo_diferencia_inventario
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_diferencia_inventario_id <> $3`;
    }
    const rows = (await runner.query(sql, params)) as unknown[];
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo de diferencia con el nombre "${nombre}"`,
      );
    }
  }
}
