import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  errorDeColisionNombreSQL,
  traducirColisionDeNombre,
} from '../../common/utils/nombre-sugerido.util';
import type { CreateConceptoMovimientoCajaDto } from './dto/create-concepto-movimiento-caja.dto';
import type { UpdateConceptoMovimientoCajaDto } from './dto/update-concepto-movimiento-caja.dto';

export interface ConceptoMovimientoCajaItem {
  id: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  // Solo se completan con `incluirEliminados` o tras `restaurar`.
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

interface ConceptoRow {
  concepto_movimiento_caja_id: string;
  nombre: string;
  tipo: string;
  activo: boolean;
  eliminado_el?: string | null;
  eliminado_por?: string | null;
  eliminado_por_nombre?: string | null;
}

const COLUMNAS = 'concepto_movimiento_caja_id, nombre, tipo, activo';

const aItem = (r: ConceptoRow): ConceptoMovimientoCajaItem => ({
  id: r.concepto_movimiento_caja_id,
  nombre: r.nombre,
  tipo: r.tipo,
  activo: r.activo,
  ...(r.eliminado_el !== undefined && {
    eliminadoEl: r.eliminado_el,
    eliminadoPor: r.eliminado_por,
    eliminadoPorNombre: r.eliminado_por_nombre,
  }),
});

@Injectable()
export class ConceptosMovimientoCajaService {
  constructor(private readonly db: Db) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
    incluirEliminados = false,
  ): Promise<ConceptoMovimientoCajaItem[]> {
    if (incluirEliminados) {
      // Papelera: el autor del borrado sale por JOIN en la misma query (uno por
      // fila sería N+1). Sin filtrar `eliminado_el` de `usuarios` a propósito: el
      // autor de un borrado es un hecho histórico. Solo lo que borró una persona:
      // `eliminado_por IS NULL` es un borrado del sistema, ni visible ni
      // restaurable (docs/features/papelera.md).
      const rows: ConceptoRow[] = await this.db.query(
        `SELECT m.concepto_movimiento_caja_id, m.nombre, m.tipo, m.activo,
                m.eliminado_el, m.eliminado_por,
                u.nombre_usuario AS eliminado_por_nombre
           FROM concepto_movimiento_caja m
           LEFT JOIN usuarios u ON u.usuario_id = m.eliminado_por
          WHERE m.tenant_id = $1
            AND (m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)
            ${soloActivas ? 'AND m.activo = true' : ''}
          ORDER BY lower(m.nombre) ASC`,
        [tenantId],
      );
      return rows.map(aItem);
    }
    const rows: ConceptoRow[] = await this.db.query(
      `SELECT ${COLUMNAS}
         FROM concepto_movimiento_caja
        WHERE tenant_id = $1 AND eliminado_el IS NULL
          ${soloActivas ? 'AND activo = true' : ''}
        ORDER BY lower(nombre) ASC`,
      [tenantId],
    );
    return rows.map(aItem);
  }

  async create(
    tenantId: string,
    dto: CreateConceptoMovimientoCajaDto,
  ): Promise<ConceptoMovimientoCajaItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<ConceptoRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `INSERT INTO concepto_movimiento_caja (tenant_id, nombre, tipo, activo)
           VALUES ($1, $2, $3, $4)
           RETURNING ${COLUMNAS}`,
          [tenantId, nombre, dto.tipo ?? 'ambos', dto.activo ?? true],
        ),
        () => this.assertNombreUnico(tenantId, nombre),
      ),
    );
    return aItem(rows[0]);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateConceptoMovimientoCajaDto,
  ): Promise<ConceptoMovimientoCajaItem> {
    const nombre = dto.nombre?.trim();
    if (nombre !== undefined) {
      await this.assertNombreUnico(tenantId, nombre, id);
    }

    const sets = ['actualizado_el = NOW()'];
    const params: unknown[] = [];
    if (nombre !== undefined) {
      params.push(nombre);
      sets.push(`nombre = $${params.length}`);
    }
    if (dto.tipo !== undefined) {
      params.push(dto.tipo);
      sets.push(`tipo = $${params.length}`);
    }
    if (dto.activo !== undefined) {
      params.push(dto.activo);
      sets.push(`activo = $${params.length}`);
    }
    params.push(id, tenantId);

    const rows = unwrap<ConceptoRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `UPDATE concepto_movimiento_caja SET ${sets.join(', ')}
            WHERE concepto_movimiento_caja_id = $${params.length - 1}
              AND tenant_id = $${params.length} AND eliminado_el IS NULL
        RETURNING ${COLUMNAS}`,
          params,
        ),
        async () => {
          if (nombre !== undefined) {
            await this.assertNombreUnico(tenantId, nombre, id);
          }
        },
      ),
    );
    if (!rows.length) {
      throw new NotFoundException(`Concepto ${id} no encontrado`);
    }
    return aItem(rows[0]);
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const rows = unwrap<{ concepto_movimiento_caja_id: string }>(
      await this.db.query(
        `UPDATE concepto_movimiento_caja
            SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
          WHERE concepto_movimiento_caja_id = $1 AND tenant_id = $2
            AND eliminado_el IS NULL
      RETURNING concepto_movimiento_caja_id`,
        [id, tenantId, usuarioId],
      ),
    );
    if (!rows.length) {
      throw new NotFoundException(`Concepto ${id} no encontrado`);
    }
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<ConceptoMovimientoCajaItem> {
    try {
      // Búsqueda y escritura en una sentencia: no hay ventana entre leer y escribir.
      // `eliminado_por IS NOT NULL`: la papelera solo restaura lo que borró una persona.
      const rows = unwrap<ConceptoRow>(
        await this.db.query(
          `UPDATE concepto_movimiento_caja
              SET eliminado_el = NULL, eliminado_por = NULL,
                  nombre = COALESCE($3, nombre), actualizado_el = NOW()
            WHERE concepto_movimiento_caja_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL AND eliminado_por IS NOT NULL
        RETURNING ${COLUMNAS}`,
          [id, tenantId, nombreNuevo ?? null],
        ),
      );
      if (!rows.length) {
        throw new NotFoundException(`Concepto ${id} no está en la papelera`);
      }
      return aItem(rows[0]);
    } catch (e) {
      // 23505: mientras estaba borrado nadie competía por el nombre; al revivirlo sí.
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          await errorDeColisionNombreSQL(
            this.db,
            'concepto_movimiento_caja',
            'un concepto activo',
            tenantId,
            nombreNuevo ?? (await this.nombreActual(tenantId, id)),
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
  }

  private async nombreActual(tenantId: string, id: string): Promise<string> {
    const filas: { nombre: string }[] = await this.db.query(
      `SELECT nombre FROM concepto_movimiento_caja
        WHERE concepto_movimiento_caja_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return filas[0]?.nombre ?? '';
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `
      SELECT 1 FROM concepto_movimiento_caja
       WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND concepto_movimiento_caja_id <> $3`;
    }
    const rows: unknown[] = await this.db.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un concepto con el nombre "${nombre}"`,
      );
    }
  }
}
