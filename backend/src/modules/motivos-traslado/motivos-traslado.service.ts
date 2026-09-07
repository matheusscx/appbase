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
import { CreateMotivoTrasladoDto } from './dto/create-motivo-traslado.dto';
import { UpdateMotivoTrasladoDto } from './dto/update-motivo-traslado.dto';

// `eliminadoEl`/`eliminadoPor`/`eliminadoPorNombre` solo se completan cuando
// se pide `incluirEliminados` (o tras `restaurar`): el listado normal no trae
// esas columnas, sin el JOIN, N+1 si lo forzáramos ahí.
export interface MotivoTrasladoListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

interface MotivoTrasladoRow {
  motivo_traslado_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
}

interface MotivoTrasladoRowConEliminado extends MotivoTrasladoRow {
  eliminado_el: string | null;
  eliminado_por: string | null;
  eliminado_por_nombre?: string | null;
}

@Injectable()
export class MotivosTrasladoService {
  constructor(private readonly db: Db) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
    incluirEliminados = false,
  ): Promise<MotivoTrasladoListItem[]> {
    if (!incluirEliminados) {
      const rows: MotivoTrasladoRow[] = await this.db.query(
        `SELECT motivo_traslado_id, nombre, activo, es_fijo
           FROM motivo_traslado
           WHERE tenant_id = $1 AND eliminado_el IS NULL
             ${soloActivas ? 'AND activo = true' : ''}
           ORDER BY es_fijo DESC, nombre ASC`,
        [tenantId],
      );
      return rows.map((r) => ({
        id: r.motivo_traslado_id,
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
    // Solo lo que borró una persona: `eliminado_por IS NULL` es un borrado
    // del sistema, no restaurable ni visible — decisión del owner,
    // docs/features/papelera.md.
    const rows: MotivoTrasladoRowConEliminado[] = await this.db.query(
      `SELECT m.motivo_traslado_id, m.nombre, m.activo, m.es_fijo,
              m.eliminado_el, m.eliminado_por,
              u.nombre_usuario AS eliminado_por_nombre
         FROM motivo_traslado m
         LEFT JOIN usuarios u ON u.usuario_id = m.eliminado_por
        WHERE m.tenant_id = $1
          AND (m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)
          ${soloActivas ? 'AND m.activo = true' : ''}
        ORDER BY m.es_fijo DESC, m.nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.motivo_traslado_id,
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
    dto: CreateMotivoTrasladoDto,
  ): Promise<MotivoTrasladoListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<MotivoTrasladoRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `INSERT INTO motivo_traslado (tenant_id, nombre, activo, es_fijo)
         VALUES ($1, $2, $3, false)
         RETURNING motivo_traslado_id, nombre, activo, es_fijo`,
          [tenantId, nombre, dto.activo ?? true],
        ),
        () => this.assertNombreUnico(tenantId, nombre),
      ),
    );
    return {
      id: rows[0].motivo_traslado_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoTrasladoDto,
  ): Promise<MotivoTrasladoListItem> {
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
    const rows = unwrap<MotivoTrasladoRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `UPDATE motivo_traslado SET ${sets.join(', ')}
         WHERE motivo_traslado_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
         RETURNING motivo_traslado_id, nombre, activo, es_fijo`,
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
      throw new NotFoundException(`Motivo de traslado ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_traslado_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
    };
  }

  // A diferencia de `motivo-diferencia-inventario` y `causas-merma`, acá no
  // hay chequeo de "en uso": la Tarea 9 (`traslados`) todavía no existe, así
  // que no hay ninguna tabla que pueda referenciar este motivo. Cuando esa
  // tabla nazca, su tarea decide si hace falta bloquear el borrado de un
  // motivo referenciado — no se anticipa acá.
  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar un motivo fijo del sistema',
      );
    }
    // Una sola escritura en vez de dos sentencias sueltas: no puede quedar
    // una fila borrada sin autor.
    await this.db.query(
      `UPDATE motivo_traslado
          SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
        WHERE motivo_traslado_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId, usuarioId],
    );
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<MotivoTrasladoListItem> {
    try {
      // `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve
      // búsqueda y escritura en una sentencia: no hay ventana entre leer y
      // escribir.
      const rows = unwrap<MotivoTrasladoRowConEliminado>(
        await this.db.query(
          `UPDATE motivo_traslado
              SET eliminado_el = NULL, eliminado_por = NULL,
                  nombre = COALESCE($3, nombre),
                  actualizado_el = NOW()
            WHERE motivo_traslado_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL AND eliminado_por IS NOT NULL
          RETURNING motivo_traslado_id, nombre, activo, es_fijo,
                    eliminado_el, eliminado_por`,
          [id, tenantId, nombreNuevo ?? null],
        ),
      );
      if (!rows.length) {
        // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
        // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
        throw new NotFoundException(
          `Motivo de traslado ${id} no está en la papelera`,
        );
      }
      return {
        id: rows[0].motivo_traslado_id,
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
        // La sugerencia se calcula ACÁ y no antes del `UPDATE` a propósito:
        // con índice único el `catch` hace falta igual —entre consultar y
        // escribir otra transacción puede tomar el nombre—, así que
        // pre-consultar agregaría una query en TODOS los restaurar sin poder
        // sacar este bloque. El `UPDATE` corre en autocommit, así que su
        // fallo no deja una transacción abortada y estas queries funcionan.
        //
        // `ignorarMayusculas: true` porque el índice de esta tabla es sobre
        // `lower(nombre)` (mismo patrón que `causas_merma`/
        // `motivo_diferencia_inventario`): sin eso la sugerencia podría
        // devolver un nombre que la base considera tomado y el usuario
        // recibiría el mismo 400 tras confirmar el modal.
        throw new BadRequestException(
          await errorDeColisionNombreSQL(
            this.db,
            'motivo_traslado',
            'un motivo de traslado activo',
            tenantId,
            nombreNuevo ?? (await this.nombreActual(tenantId, id)),
            { ignorarMayusculas: true },
          ),
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
      `SELECT motivo_traslado_id, nombre
         FROM motivo_traslado
        WHERE motivo_traslado_id = $1 AND tenant_id = $2
          AND activo = true AND eliminado_el IS NULL`,
      [motivoId, tenantId],
    )) as { motivo_traslado_id: string; nombre: string }[];
    if (!rows.length) {
      throw new BadRequestException('Motivo de traslado no válido o inactivo');
    }
    return {
      id: rows[0].motivo_traslado_id,
      nombre: rows[0].nombre,
    };
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<MotivoTrasladoListItem> {
    const rows: MotivoTrasladoRow[] = await this.db.query(
      `SELECT motivo_traslado_id, nombre, activo, es_fijo
       FROM motivo_traslado
       WHERE motivo_traslado_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo de traslado ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_traslado_id,
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
      SELECT 1 FROM motivo_traslado
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_traslado_id <> $3`;
    }
    const rows: unknown[] = await this.db.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo de traslado con el nombre "${nombre}"`,
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
    const filas: { nombre: string }[] = await this.db.query(
      `SELECT nombre FROM motivo_traslado WHERE motivo_traslado_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return filas[0]?.nombre ?? '';
  }
}
