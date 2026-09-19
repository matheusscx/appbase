import {
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import type { OperacionIdempotente } from './huella';

export const MENSAJE_OTROS_DATOS =
  'Este cobro ya se había registrado con otros datos. Revisá la venta antes de cobrar de nuevo.';

export interface SolicitudIdempotenteInput {
  tenantId: string;
  usuarioId: string;
  /** El valor de `Idempotency-Key`. */
  clave: string;
  operacion: OperacionIdempotente;
  /** `huellaDe(operacion, …)`, armada por el llamador sin datos sensibles. */
  huella: string;
}

/**
 * Un cobro por intento, aunque el cajero confirme dos veces (ADR-026).
 */
@Injectable()
export class IdempotenciaService {
  constructor(private readonly db: Db) {}

  /**
   * Corre `operar` UNA vez por `(tenant, usuario, clave)`.
   *
   * El reclamo es la PRIMERA sentencia de la transacción, y `db.transaccion`
   * reusa la del llamador si la hay: reclamo, operación y respuesta commitean
   * juntos o no commitea ninguno. De ahí salen las tres garantías:
   * - un rechazo (sin stock, sin caja, deadlock) no deja rastro, y el reintento
   *   con la misma clave corre de verdad;
   * - un duplicado concurrente espera en el índice único hasta el commit del
   *   primero, no inserta, y cae en `reproducir`;
   * - no existe un estado "en proceso": una fila visible siempre tiene su
   *   respuesta.
   *
   * ⚠️ El reclamo tiene que ir ANTES de cualquier `FOR UPDATE` y de cualquier
   * chequeo de estado de la operación. Llamar a esto a mitad de camino
   * reclamaría después de que el rebote ("La cuenta no está abierta") ya
   * salió, que es justo lo que viene a convertir en reproducción.
   *
   * La reproducción es el `T` ya serializado —mismas claves, fechas como
   * string—, que para el cliente HTTP es idéntico. Se tipa como `T` para no
   * obligar a los llamadores a discriminar una unión.
   */
  ejecutar<T extends object>(
    s: SolicitudIdempotenteInput,
    operar: () => Promise<T>,
    ventaIdDe: (respuesta: T) => string | null,
  ): Promise<T & { repetida?: true }> {
    return this.db.transaccion(async () => {
      const reclamo = unwrap<{ id: string }>(
        await this.db.query(
          `INSERT INTO solicitudes_idempotentes
             (tenant_id, usuario_id, clave, operacion, huella)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, usuario_id, clave) WHERE eliminado_el IS NULL
           DO NOTHING
           RETURNING solicitud_idempotente_id AS id`,
          [s.tenantId, s.usuarioId, s.clave, s.operacion, s.huella],
        ),
      );
      if (reclamo.length === 0) return this.reproducir<T>(s);

      const respuesta = await operar();
      // Lo mismo que habría serializado el `ClassSerializerInterceptor`
      // global: es lo que el cliente recibió, y lo que se le reproduce.
      await this.db.query(
        `UPDATE solicitudes_idempotentes
            SET respuesta = $1, venta_id = $2, actualizado_el = NOW()
          WHERE solicitud_idempotente_id = $3`,
        [
          JSON.stringify(instanceToPlain(respuesta)),
          ventaIdDe(respuesta),
          reclamo[0].id,
        ],
      );
      return respuesta;
    });
  }

  private async reproducir<T>(
    s: SolicitudIdempotenteInput,
  ): Promise<T & { repetida: true }> {
    const [fila] = await this.db.query<
      {
        huella: string;
        respuesta: Record<string, unknown> | null;
        venta_id: string | null;
      }[]
    >(
      `SELECT huella, respuesta, venta_id
         FROM solicitudes_idempotentes
        WHERE tenant_id = $1 AND usuario_id = $2 AND clave = $3
          AND eliminado_el IS NULL`,
      [s.tenantId, s.usuarioId, s.clave],
    );
    // `ON CONFLICT` solo deja de insertar contra una fila COMMITEADA, y esa
    // fila se commitea con su respuesta. Si falta, algo rompió la atomicidad:
    // 500, nunca un falso "ya había entrado".
    if (!fila?.respuesta)
      throw new InternalServerErrorException(
        'Solicitud idempotente sin respuesta',
      );
    if (fila.huella !== s.huella)
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: MENSAJE_OTROS_DATOS,
        ventaId: fila.venta_id,
      });
    return { ...fila.respuesta, repetida: true } as unknown as T & {
      repetida: true;
    };
  }
}
