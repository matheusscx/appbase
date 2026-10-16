import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { CreateEntregaRepartidorDto } from './dto/create-entrega-repartidor.dto';
import { UpdateEntregaRepartidorDto } from './dto/update-entrega-repartidor.dto';
import { QueryEntregasRepartidorDto } from './dto/query-entregas-repartidor.dto';
import type { EntregaRepartidorFila, MedioCobro } from './paqueteria.types';
import { RepartidoresService } from './repartidores.service';

export interface FilaEntrega {
  entrega_repartidor_id: string;
  repartidor_id: string;
  repartidor_nombre: string;
  fecha: string;
  monto: string;
  medio: MedioCobro;
  nota: string | null;
  rendicion_id: string | null;
  creado_el: Date;
}

/** Las columnas de una entrega con el nombre del repartidor; `e` y `r` son los alias de la consulta. */
export const COLUMNAS_ENTREGA = `e.entrega_repartidor_id, e.repartidor_id, r.nombre AS repartidor_nombre,
       e.fecha::text AS fecha, e.monto, e.medio, e.nota, e.rendicion_id, e.creado_el`;

export const aFilaEntrega = (f: FilaEntrega): EntregaRepartidorFila => ({
  id: f.entrega_repartidor_id,
  repartidorId: f.repartidor_id,
  repartidorNombre: f.repartidor_nombre,
  fecha: f.fecha,
  monto: f.monto,
  medio: f.medio,
  nota: f.nota,
  rendicionId: f.rendicion_id,
  creadoEl: f.creado_el.toISOString(),
});

/**
 * La plata que un repartidor le deja a la oficina en cualquier momento. Mientras no entre a una
 * rendición se corrige o se anula; el candado de eso NO es un cerrojo sino el `WHERE rendicion_id
 * IS NULL` del propio `UPDATE`: si una rendición la reclamó primero, el `UPDATE` espera su fila,
 * relee y no encuentra nada (400); si el cambio llega primero, la rendición suma el monto ya
 * cambiado (docs/features/paqueteria.md, § Orden de bloqueo).
 */
@Injectable()
export class EntregasRepartidorService {
  constructor(
    private readonly db: Db,
    private readonly repartidores: RepartidoresService,
  ) {}

  async listar(
    tenantId: string,
    q: QueryEntregasRepartidorDto,
  ): Promise<EntregaRepartidorFila[]> {
    const params: unknown[] = [tenantId];
    let filtros = '';
    if (q.repartidorId) {
      params.push(q.repartidorId);
      filtros += ` AND e.repartidor_id = $${params.length}`;
    }
    if (q.pendientes) filtros += ' AND e.rendicion_id IS NULL';
    const filas: FilaEntrega[] = await this.db.query(
      `SELECT ${COLUMNAS_ENTREGA}
         FROM entregas_repartidor e
         JOIN repartidores r ON r.repartidor_id = e.repartidor_id
                            AND r.tenant_id = e.tenant_id AND r.eliminado_el IS NULL
        WHERE e.tenant_id = $1 AND e.eliminado_el IS NULL${filtros}
        ORDER BY e.fecha DESC, e.creado_el DESC, e.entrega_repartidor_id`,
      params,
    );
    return filas.map(aFilaEntrega);
  }

  /** Las entregas que entraron a esa rendición (solo lectura: ya no se anulan). */
  async deRendicion(
    tenantId: string,
    rendicionId: string,
  ): Promise<EntregaRepartidorFila[]> {
    const filas: FilaEntrega[] = await this.db.query(
      `SELECT ${COLUMNAS_ENTREGA}
         FROM entregas_repartidor e
         JOIN repartidores r ON r.repartidor_id = e.repartidor_id
                            AND r.tenant_id = e.tenant_id AND r.eliminado_el IS NULL
        WHERE e.tenant_id = $1 AND e.rendicion_id = $2 AND e.eliminado_el IS NULL
        ORDER BY e.fecha DESC, e.creado_el DESC, e.entrega_repartidor_id`,
      [tenantId, rendicionId],
    );
    return filas.map(aFilaEntrega);
  }

  async crear(
    tenantId: string,
    dto: CreateEntregaRepartidorDto,
    usuarioId: string,
  ): Promise<EntregaRepartidorFila> {
    return this.db.transaccion(async () => {
      // Primer cerrojo del módulo: `remove` toma al repartidor `FOR UPDATE` antes de preguntar
      // por sus entregas, así no queda una entrega apuntando a un repartidor borrado.
      await this.repartidores.exigirExistente(tenantId, dto.repartidorId, {
        bloquear: true,
      });
      const nuevas = unwrap<{ entrega_repartidor_id: string }>(
        await this.db.query(
          `INSERT INTO entregas_repartidor
             (tenant_id, repartidor_id, fecha, monto, medio, nota, registrada_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING entrega_repartidor_id`,
          [
            tenantId,
            dto.repartidorId,
            dto.fecha,
            dto.monto,
            dto.medio,
            dto.nota ?? null,
            usuarioId,
          ],
        ),
      );
      return this.buscar(tenantId, nuevas[0].entrega_repartidor_id);
    });
  }

  /** Solo toca lo que llegó: `nota: null` la borra, ausente la deja como está. */
  async actualizar(
    tenantId: string,
    id: string,
    dto: UpdateEntregaRepartidorDto,
  ): Promise<EntregaRepartidorFila> {
    const sets: string[] = [];
    const params: unknown[] = [id, tenantId];
    const poner = (columna: string, valor: unknown) => {
      params.push(valor);
      sets.push(`${columna} = $${params.length}`);
    };
    if (dto.fecha !== undefined) poner('fecha', dto.fecha);
    if (dto.monto !== undefined) poner('monto', dto.monto);
    if (dto.medio !== undefined) poner('medio', dto.medio);
    if (dto.nota !== undefined) poner('nota', dto.nota);
    if (!sets.length) return this.buscar(tenantId, id);

    return this.db.transaccion(async () => {
      const filas = unwrap<{ entrega_repartidor_id: string }>(
        await this.db.query(
          `UPDATE entregas_repartidor SET ${sets.join(', ')}, actualizado_el = now()
            WHERE entrega_repartidor_id = $1 AND tenant_id = $2
              AND rendicion_id IS NULL AND eliminado_el IS NULL
            RETURNING entrega_repartidor_id`,
          params,
        ),
      );
      if (!filas.length) throw await this.noEditable(tenantId, id);
      return this.buscar(tenantId, id);
    });
  }

  /** Soft delete; solo mientras no esté rendida. */
  async anular(tenantId: string, id: string): Promise<{ success: true }> {
    const filas = unwrap<{ entrega_repartidor_id: string }>(
      await this.db.query(
        `UPDATE entregas_repartidor SET eliminado_el = now(), actualizado_el = now()
          WHERE entrega_repartidor_id = $1 AND tenant_id = $2
            AND rendicion_id IS NULL AND eliminado_el IS NULL
          RETURNING entrega_repartidor_id`,
        [id, tenantId],
      ),
    );
    if (!filas.length) throw await this.noEditable(tenantId, id);
    return { success: true as const };
  }

  /** Por qué un `UPDATE … WHERE rendicion_id IS NULL` no tocó nada: no existe (404) o ya está rendida (400). */
  private async noEditable(
    tenantId: string,
    id: string,
  ): Promise<NotFoundException | BadRequestException> {
    const filas: { rendicion_id: string | null }[] = await this.db.query(
      `SELECT rendicion_id FROM entregas_repartidor
        WHERE entrega_repartidor_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!filas.length) {
      return new NotFoundException('Entrega no encontrada');
    }
    return new BadRequestException(
      'La entrega ya está rendida: no se puede modificar ni anular.',
    );
  }

  private async buscar(
    tenantId: string,
    id: string,
  ): Promise<EntregaRepartidorFila> {
    const filas: FilaEntrega[] = await this.db.query(
      `SELECT ${COLUMNAS_ENTREGA}
         FROM entregas_repartidor e
         JOIN repartidores r ON r.repartidor_id = e.repartidor_id
                            AND r.tenant_id = e.tenant_id AND r.eliminado_el IS NULL
        WHERE e.entrega_repartidor_id = $1 AND e.tenant_id = $2 AND e.eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (!filas.length) throw new NotFoundException('Entrega no encontrada');
    return aFilaEntrega(filas[0]);
  }
}
