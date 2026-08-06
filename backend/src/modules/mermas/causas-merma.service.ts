import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  errorDeColisionNombreSQL,
  traducirColisionDeNombre,
} from '../../common/utils/nombre-sugerido.util';
import { CreateCausaMermaDto } from './dto/create-causa-merma.dto';
import { UpdateCausaMermaDto } from './dto/update-causa-merma.dto';

// `eliminadoEl`/`eliminadoPor`/`eliminadoPorNombre` solo se completan cuando
// se pide `incluirEliminados` (o tras `restaurar`): el listado normal no trae
// esas columnas, sin el JOIN, N+1 si lo forzáramos ahí.
export interface CausaMermaListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

interface CausaMermaRow {
  causa_merma_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
}

interface CausaMermaRowConEliminado extends CausaMermaRow {
  eliminado_el: string | null;
  eliminado_por: string | null;
  eliminado_por_nombre: string | null;
}

@Injectable()
export class CausasMermaService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
    incluirEliminados = false,
  ): Promise<CausaMermaListItem[]> {
    if (!incluirEliminados) {
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

    // Papelera: incluye las borradas y el nombre de quien borró, resuelto por
    // JOIN en la misma query (una por fila sería N+1). Sin filtrar el
    // `eliminado_el` de `usuarios` a propósito: el autor de un borrado es un
    // hecho histórico (docs/patterns/backend.md, ver categorias.service.ts →
    // findAll).
    // Solo lo que borró una persona: `eliminado_por IS NULL` es un borrado
    // del sistema, no restaurable ni visible — decisión del owner,
    // docs/features/papelera.md.
    const rows: CausaMermaRowConEliminado[] = await this.dataSource.query(
      `SELECT cm.causa_merma_id, cm.nombre, cm.activo, cm.es_fijo,
              cm.eliminado_el, cm.eliminado_por,
              u.nombre_usuario AS eliminado_por_nombre
         FROM causas_merma cm
         LEFT JOIN usuarios u ON u.usuario_id = cm.eliminado_por
        WHERE cm.tenant_id = $1
          AND (cm.eliminado_el IS NULL OR cm.eliminado_por IS NOT NULL)
          ${soloActivas ? 'AND cm.activo = true' : ''}
        ORDER BY cm.es_fijo DESC, cm.nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.causa_merma_id,
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
    dto: CreateCausaMermaDto,
  ): Promise<CausaMermaListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<CausaMermaRow>(
      await traducirColisionDeNombre(
        this.dataSource.query(
          `INSERT INTO causas_merma (tenant_id, nombre, activo, es_fijo)
         VALUES ($1, $2, $3, false)
         RETURNING causa_merma_id, nombre, activo, es_fijo`,
          [tenantId, nombre, dto.activo ?? true],
        ),
        () => this.assertNombreUnico(tenantId, nombre),
      ),
    );
    return {
      id: rows[0].causa_merma_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCausaMermaDto,
  ): Promise<CausaMermaListItem> {
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
    const rows = unwrap<CausaMermaRow>(
      await traducirColisionDeNombre(
        this.dataSource.query(
          `UPDATE causas_merma SET ${sets.join(', ')}
         WHERE causa_merma_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
         RETURNING causa_merma_id, nombre, activo, es_fijo`,
          params,
        ),
        async () => {
          // Solo si el update tocaba el nombre: si no, este 23505 no es una
          // colisión de nombre y hay que relanzarlo tal cual.
          if (dto.nombre !== undefined) {
            await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
          }
        },
      ),
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

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
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
    // Una sola escritura en vez de dos sentencias sueltas: no puede quedar
    // una fila borrada sin autor.
    await this.dataSource.query(
      `UPDATE causas_merma
          SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
        WHERE causa_merma_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId, usuarioId],
    );
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<CausaMermaListItem> {
    try {
      // `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve
      // búsqueda y escritura en una sentencia: no hay ventana entre leer y
      // escribir.
      const rows = unwrap<CausaMermaRowConEliminado>(
        await this.dataSource.query(
          `UPDATE causas_merma
              SET eliminado_el = NULL, eliminado_por = NULL,
                  nombre = COALESCE($3, nombre),
                  actualizado_el = NOW()
            WHERE causa_merma_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL AND eliminado_por IS NOT NULL
          RETURNING causa_merma_id, nombre, activo, es_fijo,
                    eliminado_el, eliminado_por`,
          [id, tenantId, nombreNuevo ?? null],
        ),
      );
      if (!rows.length) {
        // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
        // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
        throw new NotFoundException(
          `Causa de merma ${id} no está en la papelera`,
        );
      }
      return {
        id: rows[0].causa_merma_id,
        nombre: rows[0].nombre,
        activo: rows[0].activo,
        esFijo: rows[0].es_fijo,
        eliminadoEl: rows[0].eliminado_el,
        eliminadoPor: rows[0].eliminado_por,
      };
    } catch (e) {
      // 23505 = unique_violation. El índice único de nombre es parcial
      // (WHERE eliminado_el IS NULL): mientras la causa estaba borrada nadie
      // competía por el nombre, pero al revivirla vuelve a competir. Se
      // capta el código de Postgres —no una lista de índices a mano— para
      // que valga también donde no lo enumeramos.
      if ((e as { code?: string }).code === '23505') {
        // La sugerencia se calcula ACÁ y no antes del `UPDATE` a propósito:
        // con índice único el `catch` hace falta igual —entre consultar y
        // escribir otra transacción puede tomar el nombre—, así que
        // pre-consultar agregaría una query en TODOS los restaurar sin poder
        // sacar este bloque. El `UPDATE` corre en autocommit, así que su fallo
        // no deja una transacción abortada y estas queries funcionan.
        //
        // `ignorarMayusculas: true` porque el índice de esta tabla es sobre
        // `lower(nombre)` (medido con `pg_indexes`, 2026-08-01): sin eso la
        // sugerencia podría devolver un nombre que la base considera tomado y
        // el usuario recibiría el mismo 400 tras confirmar el modal.
        throw new BadRequestException(
          await errorDeColisionNombreSQL(
            this.dataSource,
            'causas_merma',
            'una causa de merma activa',
            tenantId,
            nombreNuevo ?? (await this.nombreActual(tenantId, id)),
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
  }

  async assertCausaActiva(
    runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    tenantId: string,
    causaMermaId: string,
  ): Promise<{ id: string; nombre: string }> {
    const rows = (await runner.query(
      `SELECT causa_merma_id, nombre FROM causas_merma
       WHERE causa_merma_id = $1 AND tenant_id = $2
         AND activo = true AND eliminado_el IS NULL`,
      [causaMermaId, tenantId],
    )) as { causa_merma_id: string; nombre: string }[];
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
    const rows: unknown[] = await this.dataSource.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe una causa de merma con el nombre "${nombre}"`,
      );
    }
  }
  /**
   * El nombre guardado de una fila de la papelera. Hace falta SOLO en el
   * `catch` del 23505: el `UPDATE … RETURNING` de arriba no lee la fila antes
   * de escribir (a propósito: así no hay ventana entre leer y escribir), así
   * que cuando choca no tenemos el nombre con el que chocó. Una query más,
   * únicamente en el camino de error.
   */
  private async nombreActual(tenantId: string, id: string): Promise<string> {
    const filas: { nombre: string }[] = await this.dataSource.query(
      `SELECT nombre FROM causas_merma WHERE causa_merma_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return filas[0]?.nombre ?? '';
  }
}
