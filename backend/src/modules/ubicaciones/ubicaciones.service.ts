import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  errorDeColisionNombreSQL,
  traducirColisionDeNombre,
} from '../../common/utils/nombre-sugerido.util';
import { CreateUbicacionDto } from './dto/create-ubicacion.dto';
import { UpdateUbicacionDto } from './dto/update-ubicacion.dto';

/** `DataSource` o el `EntityManager` de una transacción: ambos exponen `query`. */
type SqlRunner = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

// `eliminadoEl`/`eliminadoPor`/`eliminadoPorNombre` solo se completan cuando
// se pide `incluirEliminados` (o tras `restaurar`): el listado normal no trae
// esas columnas, sin el JOIN, N+1 si lo forzáramos ahí.
export interface UbicacionListItem {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
  activo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}

interface UbicacionRow {
  ubicacion_id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
  activo: boolean;
}

interface UbicacionRowConEliminado extends UbicacionRow {
  eliminado_el: string | null;
  eliminado_por: string | null;
  eliminado_por_nombre?: string | null;
}

export interface FindAllOpts {
  soloActivas?: boolean;
  incluirEliminados?: boolean;
}

@Injectable()
export class UbicacionesService {
  constructor(private readonly db: Db) {}

  /**
   * El `ubicacion_id` del local del tenant. Es el default de toda operación de
   * inventario que no elija lugar y el único origen del que sale una venta.
   *
   * No recibe `EntityManager`: `Db.query` resuelve solo el manager de la
   * transacción activa (ADR-020), así que llamarlo adentro de una transacción
   * lee lo que esa transacción ve.
   */
  async localDe(tenantId: string): Promise<string> {
    const rows: { ubicacion_id: string }[] = await this.db.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [tenantId],
    );
    if (!rows.length) {
      // Un tenant sin local es un tenant que no puede vender. Se siembra al
      // crearlo, así que llegar acá significa una fila borrada a mano.
      throw new InternalServerErrorException(
        'El tenant no tiene ubicación local',
      );
    }
    return rows[0].ubicacion_id;
  }

  async findAll(
    tenantId: string,
    opts: FindAllOpts = {},
  ): Promise<UbicacionListItem[]> {
    const { soloActivas = false, incluirEliminados = false } = opts;
    if (!incluirEliminados) {
      const rows: UbicacionRow[] = await this.db.query(
        `SELECT ubicacion_id, nombre, tipo, activo
           FROM ubicaciones
           WHERE tenant_id = $1 AND eliminado_el IS NULL
             ${soloActivas ? 'AND activo = true' : ''}
           ORDER BY tipo ASC, nombre ASC`,
        [tenantId],
      );
      return rows.map((r) => ({
        id: r.ubicacion_id,
        nombre: r.nombre,
        tipo: r.tipo,
        activo: r.activo,
      }));
    }

    // Papelera: incluye los borrados y el nombre de quien borró, resuelto por
    // JOIN en la misma query (una por fila sería N+1). Solo lo que borró una
    // persona (`eliminado_por IS NOT NULL`) es restaurable/visible — decisión
    // del owner, docs/features/papelera.md.
    const rows: UbicacionRowConEliminado[] = await this.db.query(
      `SELECT u.ubicacion_id, u.nombre, u.tipo, u.activo,
              u.eliminado_el, u.eliminado_por,
              us.nombre_usuario AS eliminado_por_nombre
         FROM ubicaciones u
         LEFT JOIN usuarios us ON us.usuario_id = u.eliminado_por
        WHERE u.tenant_id = $1
          AND (u.eliminado_el IS NULL OR u.eliminado_por IS NOT NULL)
          ${soloActivas ? 'AND u.activo = true' : ''}
        ORDER BY u.tipo ASC, u.nombre ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.ubicacion_id,
      nombre: r.nombre,
      tipo: r.tipo,
      activo: r.activo,
      eliminadoEl: r.eliminado_el,
      eliminadoPor: r.eliminado_por,
      eliminadoPorNombre: r.eliminado_por_nombre,
    }));
  }

  async create(
    tenantId: string,
    dto: CreateUbicacionDto,
  ): Promise<UbicacionListItem> {
    // El local es uno solo por tenant y nace sembrado al crearlo (ver el
    // docblock de `Ubicacion`): no se crea por acá.
    if (dto.tipo === 'local') {
      throw new BadRequestException(
        'La ubicación local ya existe: se siembra al crear el tenant y no se puede crear otra',
      );
    }
    const nombre = dto.nombre.trim();
    await this.assertNombreUnico(tenantId, nombre);
    const rows = unwrap<UbicacionRow>(
      await traducirColisionDeNombre(
        this.db.query(
          `INSERT INTO ubicaciones (tenant_id, nombre, tipo, activo)
           VALUES ($1, $2, 'bodega', $3)
           RETURNING ubicacion_id, nombre, tipo, activo`,
          [tenantId, nombre, dto.activo ?? true],
        ),
        () => this.assertNombreUnico(tenantId, nombre),
      ),
    );
    return {
      id: rows[0].ubicacion_id,
      nombre: rows[0].nombre,
      tipo: rows[0].tipo,
      activo: rows[0].activo,
    };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateUbicacionDto,
  ): Promise<UbicacionListItem> {
    const escritura = this.db.transaccion(async (manager) => {
      const ubicacion = await this.findOneOrFail(tenantId, id, manager, true);
      if (ubicacion.tipo === 'local' && dto.activo === false) {
        // Decisión del owner (spec § 4.1): el local no se desactiva, porque
        // es la única ubicación desde la que se vende — desactivarla dejaría
        // al tenant sin forma de vender.
        throw new BadRequestException(
          'El local no se puede desactivar: es la ubicación desde la que se vende',
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
      const rows = unwrap<UbicacionRow>(
        await manager.query(
          `UPDATE ubicaciones SET ${sets.join(', ')}
           WHERE ubicacion_id = $${idx++} AND tenant_id = $${idx} AND eliminado_el IS NULL
           RETURNING ubicacion_id, nombre, tipo, activo`,
          params,
        ),
      );
      if (!rows.length) {
        throw new NotFoundException(`Ubicación ${id} no encontrada`);
      }
      return {
        id: rows[0].ubicacion_id,
        nombre: rows[0].nombre,
        tipo: rows[0].tipo,
        activo: rows[0].activo,
      };
    });
    return traducirColisionDeNombre(escritura, async () => {
      // Solo si el update tocaba el nombre: si no, este 23505 no es una
      // colisión de nombre y hay que relanzarlo tal cual.
      if (dto.nombre !== undefined) {
        await this.assertNombreUnico(tenantId, dto.nombre.trim(), id);
      }
    });
  }

  // Verificar el uso y borrar en queries sueltas era un check-then-act: bajo
  // READ COMMITTED el EXISTS no ve los INSERT todavía sin commitear, así que
  // en principio esto debería lockear la fila igual que
  // `MotivosDiferenciaInventarioService.remove` — pero acá no hay un
  // `aplicar()` corriendo en paralelo a esta feature (Tarea 1: nadie escribe
  // `stock_ubicacion` todavía), así que la carrera es teórica y `db.transaccion`
  // + `FOR UPDATE` se agregan cuando la Tarea 2 la hace real, no antes.
  //
  // ⚠️ `stock_ubicacion` nace en ESTA tarea (ver `StockUbicacion`) pero nadie
  // la escribe todavía — se puebla en la Tarea 2. Hasta entonces esta consulta
  // siempre da 0 y el guard no bloquea nada en la práctica; se escribe ahora
  // para que el borrado no nazca sin la defensa y nadie la agregue después
  // "cuando se acuerde".
  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const filas: { tipo: string; nombre: string }[] = await this.db.query(
      `SELECT tipo, nombre FROM ubicaciones
        WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!filas.length) throw new NotFoundException('Ubicación no encontrada');

    if (filas[0].tipo === 'local') {
      throw new BadRequestException(
        'El local no se puede eliminar: es la ubicación desde la que se vende',
      );
    }

    // Vaciar antes de borrar. Sin esto el stock queda colgado de una fila
    // borrada: invisible en todo listado y sin forma de sacarlo.
    const conStock: { items_con_stock: string }[] = await this.db.query(
      `SELECT COUNT(*) AS items_con_stock
         FROM stock_ubicacion
        WHERE ubicacion_id = $1 AND stock <> 0`,
      [id],
    );
    const cuantos = Number(conStock[0].items_con_stock);
    if (cuantos > 0) {
      throw new BadRequestException(
        `"${filas[0].nombre}" todavía tiene ${cuantos} producto(s) con stock. ` +
          'Trasladá lo que queda antes de eliminarla.',
      );
    }

    await this.db.query(
      `UPDATE ubicaciones
          SET eliminado_el = NOW(), eliminado_por = $3
        WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId, usuarioId],
    );
  }

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<UbicacionListItem> {
    try {
      // `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve
      // búsqueda y escritura en una sentencia: no hay ventana entre leer y
      // escribir.
      const rows = unwrap<UbicacionRowConEliminado>(
        await this.db.query(
          `UPDATE ubicaciones
              SET eliminado_el = NULL, eliminado_por = NULL,
                  nombre = COALESCE($3, nombre),
                  actualizado_el = NOW()
            WHERE ubicacion_id = $1 AND tenant_id = $2
              AND eliminado_el IS NOT NULL AND eliminado_por IS NOT NULL
          RETURNING ubicacion_id, nombre, tipo, activo, eliminado_el, eliminado_por`,
          [id, tenantId, nombreNuevo ?? null],
        ),
      );
      if (!rows.length) {
        // `AND eliminado_por IS NOT NULL` arriba: decisión del owner — la
        // papelera solo restaura lo que borró una persona (docs/features/papelera.md).
        throw new NotFoundException(`Ubicación ${id} no está en la papelera`);
      }
      return {
        id: rows[0].ubicacion_id,
        nombre: rows[0].nombre,
        tipo: rows[0].tipo,
        activo: rows[0].activo,
        eliminadoEl: rows[0].eliminado_el,
        eliminadoPor: rows[0].eliminado_por,
      };
    } catch (e) {
      // 23505 = unique_violation. El índice único de nombre es parcial (WHERE
      // eliminado_el IS NULL): mientras la ubicación estaba borrada nadie
      // competía por el nombre, pero al revivirla vuelve a competir.
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          await errorDeColisionNombreSQL(
            this.db,
            'ubicaciones',
            'una ubicación activa',
            tenantId,
            nombreNuevo ?? (await this.nombreActual(tenantId, id)),
            { ignorarMayusculas: true },
          ),
        );
      }
      throw e;
    }
  }

  private async findOneOrFail(
    tenantId: string,
    id: string,
    runner: SqlRunner = this.db,
    bloquear = false,
  ): Promise<UbicacionListItem> {
    const rows = (await runner.query(
      `SELECT ubicacion_id, nombre, tipo, activo
       FROM ubicaciones
       WHERE ubicacion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
       ${bloquear ? 'FOR UPDATE' : ''}`,
      [id, tenantId],
    )) as UbicacionRow[];
    if (!rows.length) {
      throw new NotFoundException(`Ubicación ${id} no encontrada`);
    }
    return {
      id: rows[0].ubicacion_id,
      nombre: rows[0].nombre,
      tipo: rows[0].tipo,
      activo: rows[0].activo,
    };
  }

  private async assertNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
    runner: SqlRunner = this.db,
  ): Promise<void> {
    const params: unknown[] = [tenantId, nombre];
    let sql = `
      SELECT 1 FROM ubicaciones
      WHERE tenant_id = $1 AND lower(nombre) = lower($2) AND eliminado_el IS NULL`;
    if (excludeId) {
      params.push(excludeId);
      sql += ` AND ubicacion_id <> $3`;
    }
    const rows = (await runner.query(sql, params)) as unknown[];
    if (rows.length) {
      throw new BadRequestException(
        `Ya existe una ubicación con el nombre "${nombre}"`,
      );
    }
  }

  /**
   * El nombre guardado de una fila de la papelera. Hace falta SOLO en el
   * `catch` del 23505: el `UPDATE … RETURNING` de arriba no lee la fila antes
   * de escribir, así que cuando choca no tenemos el nombre con el que chocó.
   */
  private async nombreActual(tenantId: string, id: string): Promise<string> {
    const filas: { nombre: string }[] = await this.db.query(
      `SELECT nombre FROM ubicaciones WHERE ubicacion_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return filas[0]?.nombre ?? '';
  }
}
