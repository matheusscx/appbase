import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import type { PaginatedResponse } from '../../common/interfaces/paginated-response.interface';
import {
  buildPaginationMeta,
  resolvePagination,
} from '../../common/utils/pagination.util';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarCodigoPaquete } from './codigo-paquete';
import { CreatePaqueteDto } from './dto/create-paquete.dto';
import { QueryPaquetesDto } from './dto/query-paquetes.dto';
import { UpdatePaqueteDto } from './dto/update-paquete.dto';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';
import type { EstadoPaquete, PaqueteFila } from './paqueteria.types';

export interface PaqueteFilaRow {
  id: string;
  codigo: string;
  destinatario_nombre: string | null;
  destinatario_telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  nota: string | null;
  remitente_tercero_id: string | null;
  remitente_nombre: string | null;
  cobro_en_destino: boolean;
  precio_envio: string;
  pago_repartidor: string;
  estado: EstadoPaquete;
  hoja_ruta_id: string | null;
  repartidor_nombre: string | null;
  bloqueado: boolean;
}

const COLUMNAS_PAQUETE_FILA = `
  SELECT p.paquete_id AS id, p.codigo, p.destinatario_nombre, p.destinatario_telefono,
         p.direccion, p.comuna, p.nota, p.remitente_tercero_id, t.nombre AS remitente_nombre,
         p.cobro_en_destino, p.precio_envio, p.pago_repartidor,
         COALESCE(ruta.estado, 'disponible') AS estado,
         ruta.hoja_ruta_id, ruta.repartidor_nombre,
         (ruta.estado = 'entregado' AND ruta.hoja_estado = 'rendida') IS TRUE AS bloqueado`;

/** El `FROM` aparte para que el `COUNT(*)` del listado cuente sobre lo mismo que lista. */
const FROM_PAQUETE_FILA = `
    FROM paquetes p
    LEFT JOIN terceros t ON t.tercero_id = p.remitente_tercero_id
                        AND t.tenant_id = p.tenant_id AND t.eliminado_el IS NULL
    LEFT JOIN LATERAL (
      SELECT l.estado, l.hoja_ruta_id, h.estado AS hoja_estado, r.nombre AS repartidor_nombre
        FROM hoja_ruta_paquetes l
        JOIN hojas_ruta h   ON h.hoja_ruta_id = l.hoja_ruta_id
                           AND h.tenant_id = p.tenant_id AND h.eliminado_el IS NULL
        JOIN repartidores r ON r.repartidor_id = h.repartidor_id
                           AND r.tenant_id = p.tenant_id AND r.eliminado_el IS NULL
       WHERE l.paquete_id = p.paquete_id AND l.tenant_id = p.tenant_id
         AND l.eliminado_el IS NULL
         AND l.estado IN ('en_ruta', 'entregado')
       LIMIT 1
    ) ruta ON TRUE`;

/**
 * Estado del paquete derivado de sus líneas (docs/features/paqueteria.md, regla 2). Sin N+1: un
 * LATERAL por fila, apoyado en idx_hoja_ruta_paquetes_paquete. Una línea en_ruta o entregado
 * como mucho por paquete: el índice único y las reglas de asignar/marcar lo garantizan. Lo usan
 * el listado, `filaPorId` y el escaneo. Agregar un
 * `WHERE p.tenant_id = $n AND p.eliminado_el IS NULL`.
 */
export const SELECT_PAQUETE_FILA = `${COLUMNAS_PAQUETE_FILA}${FROM_PAQUETE_FILA}`;

export const aFilaPaquete = (r: PaqueteFilaRow): PaqueteFila => ({
  id: r.id,
  codigo: r.codigo,
  destinatarioNombre: r.destinatario_nombre,
  destinatarioTelefono: r.destinatario_telefono,
  direccion: r.direccion,
  comuna: r.comuna,
  nota: r.nota,
  remitenteTerceroId: r.remitente_tercero_id,
  remitenteNombre: r.remitente_nombre,
  cobroEnDestino: r.cobro_en_destino,
  precioEnvio: r.precio_envio,
  pagoRepartidor: r.pago_repartidor,
  estado: r.estado,
  hojaRutaId: r.hoja_ruta_id,
  repartidorNombre: r.repartidor_nombre,
  bloqueado: r.bloqueado,
});

/** `%` y `_` de lo que tipea el usuario son texto, no comodines. */
const escaparLike = (texto: string) => texto.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class PaquetesService {
  constructor(
    private readonly db: Db,
    private readonly configuracion: PaqueteConfiguracionService,
  ) {}

  async findAll(
    tenantId: string,
    query: QueryPaquetesDto,
  ): Promise<PaginatedResponse<PaqueteFila>> {
    const { page, pageSize, offset } = resolvePagination(query);
    const params: unknown[] = [tenantId];
    const condiciones = ['p.tenant_id = $1', 'p.eliminado_el IS NULL'];
    const agregar = (valor: unknown): string => {
      params.push(valor);
      return `$${params.length}`;
    };

    if (query.estado) {
      condiciones.push(
        `COALESCE(ruta.estado, 'disponible') = ${agregar(query.estado)}`,
      );
    }
    if (query.cobroEnDestino) {
      condiciones.push(
        `p.cobro_en_destino = ${agregar(query.cobroEnDestino === 'true')}`,
      );
    }
    if (query.porCompletar) {
      condiciones.push(
        '(p.direccion IS NULL OR p.destinatario_nombre IS NULL)',
      );
    }
    if (query.q?.trim()) {
      // Mismo camino que el escaneo: el QR pegado en el buscador encuentra el paquete por su código.
      const codigo = normalizarCodigoPaquete(query.q);
      const exacto = agregar(codigo);
      const parcial = agregar(`%${escaparLike(codigo)}%`);
      condiciones.push(
        `(p.codigo = ${exacto} OR p.codigo ILIKE ${parcial} OR p.destinatario_nombre ILIKE ${parcial})`,
      );
    }
    const where = condiciones.join(' AND ');

    const cuenta: { total: number }[] = await this.db.query(
      `SELECT COUNT(*)::int AS total ${FROM_PAQUETE_FILA} WHERE ${where}`,
      params,
    );
    const rows: PaqueteFilaRow[] = await this.db.query(
      `${SELECT_PAQUETE_FILA}
        WHERE ${where}
        ORDER BY p.creado_el DESC, p.paquete_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return {
      data: rows.map(aFilaPaquete),
      meta: buildPaginationMeta(page, pageSize, cuenta[0]?.total ?? 0),
    };
  }

  async filaPorId(tenantId: string, id: string): Promise<PaqueteFila> {
    const rows: PaqueteFilaRow[] = await this.db.query(
      `${SELECT_PAQUETE_FILA}
        WHERE p.paquete_id = $1 AND p.tenant_id = $2 AND p.eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Paquete no encontrado');
    return aFilaPaquete(rows[0]);
  }

  /** El remitente llega por body: tiene que ser un tercero de ESTE tenant y estar activo. */
  async validarTercero(tenantId: string, terceroId: string): Promise<void> {
    const rows: { nombre: string; activo: boolean }[] = await this.db.query(
      `SELECT nombre, activo FROM terceros
        WHERE tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [terceroId, tenantId],
    );
    if (!rows.length) throw new NotFoundException('Remitente no encontrado');
    if (!rows[0].activo) {
      throw new BadRequestException(
        `El remitente "${rows[0].nombre}" está pausado y no admite paquetes nuevos`,
      );
    }
  }

  async create(tenantId: string, dto: CreatePaqueteDto): Promise<PaqueteFila> {
    const codigo = normalizarCodigoPaquete(dto.codigo);
    if (dto.remitenteTerceroId) {
      await this.validarTercero(tenantId, dto.remitenteTerceroId);
    }
    // Solo se pide la configuración si falta algún monto: con los dos explícitos no hace falta.
    const defaults =
      dto.precioEnvio === undefined || dto.pagoRepartidor === undefined
        ? await this.configuracion.exigirDefaults(tenantId)
        : null;

    const rows = unwrap<{ paquete_id: string }>(
      await this.db.query(
        `INSERT INTO paquetes
           (tenant_id, codigo, destinatario_nombre, destinatario_telefono, direccion,
            comuna, nota, remitente_tercero_id, cobro_en_destino, precio_envio, pago_repartidor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tenant_id, codigo) WHERE eliminado_el IS NULL DO NOTHING
         RETURNING paquete_id`,
        [
          tenantId,
          codigo,
          dto.destinatarioNombre ?? null,
          dto.destinatarioTelefono ?? null,
          dto.direccion ?? null,
          dto.comuna ?? null,
          dto.nota ?? null,
          dto.remitenteTerceroId ?? null,
          dto.cobroEnDestino,
          dto.precioEnvio ?? defaults!.precioEnvio,
          dto.pagoRepartidor ?? defaults!.pagoRepartidor,
        ],
      ),
    );
    if (!rows.length) throw this.codigoRepetido(codigo);
    return this.filaPorId(tenantId, rows[0].paquete_id);
  }

  /**
   * Solo toca lo que llegó: `null` vacía un campo opcional, ausente lo deja. Un paquete ya
   * rendido conserva sus montos y su cobro en destino (la rendición los congeló, regla 7), pero
   * sí se le puede completar la dirección o el destinatario.
   *
   * Leer `bloqueado` y escribir son sentencias separadas: sin cerrojo, una rendición que se
   * confirme en el medio dejaría cambiar los montos de un paquete ya rendido. Rendir bloquea la
   * hoja (`FOR UPDATE`) y no los paquetes, así que el cerrojo va sobre la hoja: `FOR SHARE`
   * espera a que la rendición termine, y una rendición que llegue después espera a esta
   * transacción. Orden de bloqueo: hoja → paquete, el mismo de asignar y rendir.
   */
  async update(
    tenantId: string,
    id: string,
    dto: UpdatePaqueteDto,
  ): Promise<PaqueteFila> {
    return this.db.transaccion(async () => {
      await this.db.query(
        `SELECT h.hoja_ruta_id
           FROM hoja_ruta_paquetes l
           JOIN hojas_ruta h ON h.hoja_ruta_id = l.hoja_ruta_id
                            AND h.tenant_id = $2 AND h.eliminado_el IS NULL
          WHERE l.paquete_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
            AND l.estado IN ('en_ruta', 'entregado')
            FOR SHARE OF h`,
        [id, tenantId],
      );
      const actual = await this.filaPorId(tenantId, id);
      const tocaMontos =
        dto.precioEnvio !== undefined ||
        dto.pagoRepartidor !== undefined ||
        dto.cobroEnDestino !== undefined;
      if (actual.bloqueado && tocaMontos) {
        throw new BadRequestException(
          `El paquete ${actual.codigo} ya se rindió: sus montos no se pueden cambiar.`,
        );
      }

      const sets: string[] = [];
      const params: unknown[] = [id, tenantId];
      const poner = (columna: string, valor: unknown) => {
        params.push(valor);
        sets.push(`${columna} = $${params.length}`);
      };
      let codigo = actual.codigo;
      if (dto.codigo !== undefined) {
        codigo = normalizarCodigoPaquete(dto.codigo);
        poner('codigo', codigo);
      }
      if (dto.destinatarioNombre !== undefined)
        poner('destinatario_nombre', dto.destinatarioNombre);
      if (dto.destinatarioTelefono !== undefined)
        poner('destinatario_telefono', dto.destinatarioTelefono);
      if (dto.direccion !== undefined) poner('direccion', dto.direccion);
      if (dto.comuna !== undefined) poner('comuna', dto.comuna);
      if (dto.nota !== undefined) poner('nota', dto.nota);
      if (dto.remitenteTerceroId !== undefined) {
        if (dto.remitenteTerceroId !== null) {
          await this.validarTercero(tenantId, dto.remitenteTerceroId);
        }
        poner('remitente_tercero_id', dto.remitenteTerceroId);
      }
      if (dto.cobroEnDestino !== undefined)
        poner('cobro_en_destino', dto.cobroEnDestino);
      if (dto.precioEnvio !== undefined) poner('precio_envio', dto.precioEnvio);
      if (dto.pagoRepartidor !== undefined)
        poner('pago_repartidor', dto.pagoRepartidor);

      if (sets.length === 0) return actual;

      let rows: { paquete_id: string }[];
      try {
        rows = unwrap<{ paquete_id: string }>(
          await this.db.query(
            `UPDATE paquetes SET ${sets.join(', ')}, actualizado_el = now()
              WHERE paquete_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
              RETURNING paquete_id`,
            params,
          ),
        );
      } catch (e) {
        // Otro paquete vivo ya tiene ese código: el índice único lo frena, no hay chequeo previo
        // que lo gane. Se lanza el 409 sin tocar la base: la sentencia fallida dejó la transacción
        // abortada (25P02) y el error que sale de acá la deshace entera.
        if ((e as { code?: string }).code === '23505') {
          throw this.codigoRepetido(codigo);
        }
        throw e;
      }
      if (!rows.length) throw new NotFoundException('Paquete no encontrado');
      return this.filaPorId(tenantId, id);
    });
  }

  /**
   * Un paquete que alguna vez salió en una hoja es parte de su historia (y de su rendición): no
   * se borra. El cerrojo y la pregunta por las líneas van en sentencias distintas a propósito:
   * bajo READ COMMITTED cada sentencia toma su propio snapshot, y un `EXISTS` en la misma
   * sentencia que el `FOR UPDATE` no vería la línea que una asignación confirmó mientras
   * esta esperaba el cerrojo.
   */
  async remove(tenantId: string, id: string): Promise<{ success: true }> {
    return this.db.transaccion(async () => {
      const rows: { codigo: string }[] = await this.db.query(
        `SELECT p.codigo
           FROM paquetes p
          WHERE p.paquete_id = $1 AND p.tenant_id = $2 AND p.eliminado_el IS NULL
            FOR UPDATE`,
        [id, tenantId],
      );
      if (!rows.length) throw new NotFoundException('Paquete no encontrado');

      const lineas: { tiene: boolean }[] = await this.db.query(
        `SELECT EXISTS (
           SELECT 1 FROM hoja_ruta_paquetes l
            WHERE l.paquete_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
         ) AS tiene`,
        [id, tenantId],
      );
      if (lineas[0].tiene) {
        throw new BadRequestException(
          `El paquete ${rows[0].codigo} ya salió en una hoja de ruta: no se puede borrar.`,
        );
      }
      await this.db.query(
        `UPDATE paquetes SET eliminado_el = now(), actualizado_el = now()
          WHERE paquete_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [id, tenantId],
      );
      return { success: true as const };
    });
  }

  private codigoRepetido(codigo: string): ConflictException {
    return new ConflictException(
      `Ya existe un paquete con el código ${codigo}.`,
    );
  }
}
