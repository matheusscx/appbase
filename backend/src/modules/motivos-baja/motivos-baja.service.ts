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
import { CreateMotivoBajaDto } from './dto/create-motivo-baja.dto';
import { UpdateMotivoBajaDto } from './dto/update-motivo-baja.dto';
import { TipoMotivoBaja } from './tipo-motivo-baja.enum';

// `eliminadoEl`/`eliminadoPor`/`eliminadoPorNombre` solo se completan cuando
// se pide `incluirEliminados` (o tras `restaurar`): el listado normal no trae
// esas columnas, sin el JOIN, N+1 si lo forzáramos ahí.
export interface MotivoBajaListItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  tipo: TipoMotivoBaja;
  enUso: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

/** Lo que `findOneOrFail` necesita resolver: identidad + lo que `update`/`remove`
 *  chequean antes de escribir. Sin `enUso` a propósito — ni `update` (fuera del
 *  cambio de tipo) ni `remove` lo usan, y `remove` ya calcula su propio uso con
 *  otra consulta (`COUNT`, no `EXISTS`) para el mensaje que devuelve. */
interface MotivoBajaActual {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  tipo: TipoMotivoBaja;
}

interface MotivoBajaRow {
  motivo_baja_id: string;
  nombre: string;
  activo: boolean;
  es_fijo: boolean;
  tipo: TipoMotivoBaja;
}

interface MotivoBajaRowConUso extends MotivoBajaRow {
  en_uso: boolean;
}

interface MotivoBajaRowConEliminado extends MotivoBajaRowConUso {
  eliminado_el: string | null;
  eliminado_por: string | null;
  eliminado_por_nombre: string | null;
}

interface MotivoBajaRowRestaurado extends MotivoBajaRowConUso {
  eliminado_el: string | null;
  eliminado_por: string | null;
}

@Injectable()
export class MotivosBajaService {
  constructor(private readonly db: Db) {}

  async findAll(
    tenantId: string,
    soloActivas = false,
    incluirEliminados = false,
    tipo?: TipoMotivoBaja,
  ): Promise<MotivoBajaListItem[]> {
    const params = tipo ? [tenantId, tipo] : [tenantId];

    if (!incluirEliminados) {
      const rows: MotivoBajaRowConUso[] = await this.db.query(
        `SELECT mb.motivo_baja_id, mb.nombre, mb.activo, mb.es_fijo, mb.tipo,
                EXISTS (SELECT 1 FROM movimientos_inventario mv
                         WHERE mv.motivo_baja_id = mb.motivo_baja_id
                           AND mv.eliminado_el IS NULL) AS en_uso
           FROM motivo_baja mb
          WHERE mb.tenant_id = $1 AND mb.eliminado_el IS NULL
            ${soloActivas ? 'AND mb.activo = true' : ''}
            ${tipo ? 'AND mb.tipo = $2' : ''}
          ORDER BY mb.es_fijo DESC, mb.nombre ASC`,
        params,
      );
      return rows.map((r) => ({
        id: r.motivo_baja_id,
        nombre: r.nombre,
        activo: r.activo,
        esFijo: r.es_fijo,
        tipo: r.tipo,
        enUso: r.en_uso,
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
    const rows: MotivoBajaRowConEliminado[] = await this.db.query(
      `SELECT mb.motivo_baja_id, mb.nombre, mb.activo, mb.es_fijo, mb.tipo,
              EXISTS (SELECT 1 FROM movimientos_inventario mv
                       WHERE mv.motivo_baja_id = mb.motivo_baja_id
                         AND mv.eliminado_el IS NULL) AS en_uso,
              mb.eliminado_el, mb.eliminado_por,
              u.nombre_usuario AS eliminado_por_nombre
         FROM motivo_baja mb
         LEFT JOIN usuarios u ON u.usuario_id = mb.eliminado_por
        WHERE mb.tenant_id = $1
          AND (mb.eliminado_el IS NULL OR mb.eliminado_por IS NOT NULL)
          ${soloActivas ? 'AND mb.activo = true' : ''}
          ${tipo ? 'AND mb.tipo = $2' : ''}
        ORDER BY mb.es_fijo DESC, mb.nombre ASC`,
      params,
    );
    return rows.map((r) => ({
      id: r.motivo_baja_id,
      nombre: r.nombre,
      activo: r.activo,
      esFijo: r.es_fijo,
      tipo: r.tipo,
      enUso: r.en_uso,
      eliminadoEl: r.eliminado_el,
      eliminadoPor: r.eliminado_por,
      eliminadoPorNombre: r.eliminado_por_nombre,
    }));
  }

  async create(
    tenantId: string,
    dto: CreateMotivoBajaDto,
  ): Promise<MotivoBajaListItem> {
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<MotivoBajaRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `INSERT INTO motivo_baja (tenant_id, nombre, activo, es_fijo, tipo)
         VALUES ($1, $2, $3, false, $4)
         RETURNING motivo_baja_id, nombre, activo, es_fijo, tipo`,
          [tenantId, nombre, dto.activo ?? true, dto.tipo],
        ),
        () => this.assertNombreUnico(tenantId, nombre),
      ),
    );
    return {
      id: rows[0].motivo_baja_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
      tipo: rows[0].tipo,
      // Recién creado: no puede tener movimientos todavía.
      enUso: false,
    };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMotivoBajaDto,
  ): Promise<MotivoBajaListItem> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede modificar un motivo fijo del sistema',
      );
    }
    if (dto.nombre !== undefined) {
      await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
    }

    // Cambiar el tipo después de usarlo reescribiría la historia: un "Se
    // quemó" pasado a no_elaborado haría que un plato que salió de la cocina
    // figure como que nunca gastó stock. Solo se consulta el uso cuando el
    // tipo realmente cambia — mandar el mismo tipo no dispara esta consulta.
    if (dto.tipo !== undefined && dto.tipo !== motivo.tipo) {
      const uso: { en_uso: boolean }[] = await this.db.query(
        `SELECT EXISTS (SELECT 1 FROM movimientos_inventario
                         WHERE motivo_baja_id = $1 AND eliminado_el IS NULL) AS en_uso`,
        [id],
      );
      if (uso[0].en_uso) {
        throw new BadRequestException(
          'No se puede cambiar el tipo: el motivo ya se usó en movimientos',
        );
      }
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
    if (dto.tipo !== undefined) {
      sets.push(`tipo = $${idx++}`);
      params.push(dto.tipo);
    }

    params.push(id, tenantId);
    const rows = unwrap<MotivoBajaRowConUso>(
      await traducirColisionDeNombre(
        this.db.query(
          `UPDATE motivo_baja SET ${sets.join(', ')}
         WHERE motivo_baja_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
         RETURNING motivo_baja_id, nombre, activo, es_fijo, tipo,
                   EXISTS (SELECT 1 FROM movimientos_inventario mv
                            WHERE mv.motivo_baja_id = motivo_baja.motivo_baja_id
                              AND mv.eliminado_el IS NULL) AS en_uso`,
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
      throw new NotFoundException(`Motivo de baja ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_baja_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
      tipo: rows[0].tipo,
      enUso: rows[0].en_uso,
    };
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const motivo = await this.findOneOrFail(tenantId, id);
    if (motivo.esFijo) {
      throw new BadRequestException(
        'No se puede eliminar un motivo fijo del sistema',
      );
    }
    const uso: { cnt: string }[] = await this.db.query(
      `SELECT COUNT(*)::text AS cnt FROM movimientos_inventario
       WHERE motivo_baja_id = $1 AND eliminado_el IS NULL`,
      [id],
    );
    if (parseInt(uso[0].cnt, 10) > 0) {
      throw new BadRequestException(
        'No se puede eliminar: el motivo está en uso en movimientos de merma',
      );
    }
    // Una sola escritura en vez de dos sentencias sueltas: no puede quedar
    // una fila borrada sin autor.
    await this.db.query(
      `UPDATE motivo_baja
          SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
        WHERE motivo_baja_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId, usuarioId],
    );
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<MotivoBajaListItem> {
    try {
      // `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve
      // búsqueda y escritura en una sentencia: no hay ventana entre leer y
      // escribir.
      const rows = unwrap<MotivoBajaRowRestaurado>(
        await this.db.query(
          `UPDATE motivo_baja
              SET eliminado_el = NULL, eliminado_por = NULL,
                  nombre = COALESCE($3, nombre),
                  actualizado_el = NOW()
            WHERE motivo_baja_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL AND eliminado_por IS NOT NULL
          RETURNING motivo_baja_id, nombre, activo, es_fijo, tipo,
                    EXISTS (SELECT 1 FROM movimientos_inventario mv
                             WHERE mv.motivo_baja_id = motivo_baja.motivo_baja_id
                               AND mv.eliminado_el IS NULL) AS en_uso,
                    eliminado_el, eliminado_por`,
          [id, tenantId, nombreNuevo ?? null],
        ),
      );
      if (!rows.length) {
        // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
        // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
        throw new NotFoundException(
          `Motivo de baja ${id} no está en la papelera`,
        );
      }
      return {
        id: rows[0].motivo_baja_id,
        nombre: rows[0].nombre,
        activo: rows[0].activo,
        esFijo: rows[0].es_fijo,
        tipo: rows[0].tipo,
        enUso: rows[0].en_uso,
        eliminadoEl: rows[0].eliminado_el,
        eliminadoPor: rows[0].eliminado_por,
      };
    } catch (e) {
      // 23505 = unique_violation. El índice único de nombre es parcial
      // (WHERE eliminado_el IS NULL): mientras el motivo estaba borrado nadie
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
            this.db,
            'motivo_baja',
            'un motivo de baja activo',
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
    motivoBajaId: string,
  ): Promise<{ id: string; nombre: string; tipo: TipoMotivoBaja }> {
    const rows = (await runner.query(
      `SELECT motivo_baja_id, nombre, tipo FROM motivo_baja
       WHERE motivo_baja_id = $1 AND tenant_id = $2
         AND activo = true AND eliminado_el IS NULL`,
      [motivoBajaId, tenantId],
    )) as { motivo_baja_id: string; nombre: string; tipo: TipoMotivoBaja }[];
    if (!rows.length) {
      throw new BadRequestException('Motivo de baja no válido o inactivo');
    }
    return {
      id: rows[0].motivo_baja_id,
      nombre: rows[0].nombre,
      tipo: rows[0].tipo,
    };
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
  ): Promise<MotivoBajaActual> {
    const rows: MotivoBajaRow[] = await this.db.query(
      `SELECT motivo_baja_id, nombre, activo, es_fijo, tipo
       FROM motivo_baja
       WHERE motivo_baja_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`Motivo de baja ${id} no encontrado`);
    }
    return {
      id: rows[0].motivo_baja_id,
      nombre: rows[0].nombre,
      activo: rows[0].activo,
      esFijo: rows[0].es_fijo,
      tipo: rows[0].tipo,
    };
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `
      SELECT 1 FROM motivo_baja
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND motivo_baja_id <> $3`;
    }
    const rows: unknown[] = await this.db.query(sql, params);
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe un motivo de baja con el nombre "${nombre}"`,
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
      `SELECT nombre FROM motivo_baja WHERE motivo_baja_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return filas[0]?.nombre ?? '';
  }
}
