import {
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { instanceToPlain } from 'class-transformer';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
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
  /**
   * El 422 de "otros datos" cuando la operación no es un cobro: la nota de
   * crédito no "se cobró". Sin él, `MENSAJE_OTROS_DATOS`.
   */
  mensajeOtrosDatos?: string;
}

/**
 * Quién hizo el request: el usuario del JWT o, en la API externa de la
 * pasarela, la llave de API (que no tiene usuario). La clave es única por
 * actor, no solo por tenant.
 */
export type ActorIdempotente = { usuarioId: string } | { apiKeyId: string };

export interface SolicitudConEfectoExternoInput {
  tenantId: string;
  actor: ActorIdempotente;
  clave: string;
  operacion: OperacionIdempotente;
  huella: string;
  mensajeOtrosDatos: string;
}

/** Lo que devuelve un paso: la respuesta a guardar, o soltar el reclamo con ese error. */
export type ResultadoConEfectoExterno<T> = { respuesta: T } | { soltar: Error };

export interface PasosConEfectoExterno<P, T> {
  /**
   * tx0, recién reclamada la clave: los chequeos que pueden rebotar y el
   * registro write-ahead del efecto. Lanzar revierte el reclamo: sin rastro.
   */
  preparar: (solicitudId: string) => Promise<P>;
  /** tx1, con la fila del reclamo bloqueada: el efecto externo y su registro. */
  efectuar: (
    solicitudId: string,
    preparado: P,
  ) => Promise<ResultadoConEfectoExterno<T>>;
  /**
   * El reclamo existe, es de este pedido y NO tiene respuesta: la tx1 que lo
   * hizo murió o el efecto quedó sin confirmar. Corre con la fila bloqueada
   * (si la tx1 siguiera viva, esto la habría esperado). Devuelve la respuesta
   * que queda guardada, o lanza (nada se guarda).
   */
  resolverSinConfirmar: (
    solicitudId: string,
  ) => Promise<ResultadoConEfectoExterno<T>>;
  /** Lo que el 422 de "otros datos" agrega al mensaje (p. ej. `{ ordenId }`). */
  cuerpoOtrosDatos: (solicitudId: string) => Promise<Record<string, unknown>>;
}

/**
 * - `efectuada`: el efecto corrió en este request.
 * - `resuelta`: el reclamo estaba sin confirmar y `resolverSinConfirmar` lo
 *   cerró.
 * - `reproducida`: ya tenía respuesta; es la guardada más `repetida: true`.
 */
export type OrigenConEfectoExterno = 'efectuada' | 'resuelta' | 'reproducida';

/**
 * Un cobro por intento, aunque el cajero confirme dos veces (ADR-026).
 */
@Injectable()
export class IdempotenciaService {
  constructor(
    private readonly db: Db,
    private readonly tx: TxContext,
  ) {}

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
        message: s.mensajeOtrosDatos ?? MENSAJE_OTROS_DATOS,
        ventaId: fila.venta_id,
      });
    return { ...fila.respuesta, repetida: true } as unknown as T & {
      repetida: true;
    };
  }

  /**
   * Una vez por `(tenant, actor, clave)` cuando el efecto NO está en la base
   * (la plata que devuelve Transbank): **at-most-once** en vez del
   * exactly-once de `ejecutar` (ADR-029).
   *
   * `ejecutar` reclama dentro de la transacción del efecto, así que reclamo y
   * efecto commitean juntos. Con un efecto externo eso es at-least-once: si el
   * proceso cae entre "el proveedor aprobó" y el COMMIT, el rollback se lleva
   * el reclamo y el reintento vuelve a llamar. Acá el reclamo se commitea
   * ANTES (tx0, con lo que `preparar` escribe) y el efecto corre en una tx1
   * que bloquea la fila del reclamo. Un reintento bloquea la misma fila:
   * - si la tx1 sigue viva, espera y reproduce lo que ella guardó;
   * - si murió, Postgres soltó el lock con la conexión: la fila no tiene
   *   respuesta y decide `resolverSinConfirmar`, nunca un segundo efecto.
   * Así "en curso" y "abandonado" se distinguen sin relojes. Orden de locks:
   * el reclamo primero, después lo que bloquee el llamador.
   *
   * ⚠️ No se suma a una transacción activa —lanza—: el commit de tx0 tiene
   * que ser real antes del efecto.
   */
  async ejecutarConEfectoExterno<P, T extends object>(
    s: SolicitudConEfectoExternoInput,
    pasos: PasosConEfectoExterno<P, T>,
  ): Promise<{ origen: OrigenConEfectoExterno; respuesta: T }> {
    if (this.tx.managerActivo())
      throw new Error(
        'ejecutarConEfectoExterno no puede sumarse a una transacción: el reclamo tiene que commitear antes del efecto (ADR-029)',
      );
    // El reclamo pudo soltarse (`soltar`) entre nuestro INSERT que chocó y el
    // SELECT: entonces la clave está libre y se reclama de nuevo. Una vuelta
    // alcanza; la segunda es defensiva.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const reclamado = await this.db.transaccion(async () => {
        const id = await this.reclamar(s);
        return id ? { id, preparado: await pasos.preparar(id) } : null;
      });
      if (reclamado) {
        const r = await this.db.transaccion(async () => {
          await this.bloquear(reclamado.id);
          return this.cerrar(
            reclamado.id,
            await pasos.efectuar(reclamado.id, reclamado.preparado),
          );
        });
        if ('soltar' in r) throw r.soltar;
        return { origen: 'efectuada', respuesta: r.respuesta };
      }
      const retomado = await this.db.transaccion(() => this.retomar(s, pasos));
      if (retomado === null) continue;
      if ('soltar' in retomado) throw retomado.soltar;
      return retomado;
    }
    throw new InternalServerErrorException(
      'No se pudo reclamar la clave de idempotencia',
    );
  }

  private async reclamar(
    s: SolicitudConEfectoExternoInput,
  ): Promise<string | null> {
    // Un `ON CONFLICT` por actor, con el predicado de SU índice parcial.
    const [columna, actorId] =
      'usuarioId' in s.actor
        ? ['usuario_id', s.actor.usuarioId]
        : ['api_key_id', s.actor.apiKeyId];
    const filas = unwrap<{ id: string }>(
      await this.db.query(
        `INSERT INTO solicitudes_idempotentes
           (tenant_id, ${columna}, clave, operacion, huella)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, ${columna}, clave) WHERE eliminado_el IS NULL
         DO NOTHING
         RETURNING solicitud_idempotente_id AS id`,
        [s.tenantId, actorId, s.clave, s.operacion, s.huella],
      ),
    );
    return filas[0]?.id ?? null;
  }

  private async bloquear(id: string): Promise<void> {
    const filas = await this.db.query<unknown[]>(
      `SELECT 1 FROM solicitudes_idempotentes
        WHERE solicitud_idempotente_id = $1
          AND eliminado_el IS NULL
        FOR UPDATE`,
      [id],
    );
    // Lo reclamó este mismo request en tx0 y solo su tx1 lo suelta: si no
    // está, algo rompió esa garantía y no hay reclamo que proteja el efecto.
    if (filas.length === 0)
      throw new InternalServerErrorException(
        'El reclamo de la clave de idempotencia desapareció antes del efecto',
      );
  }

  /** Guarda la respuesta, o suelta el reclamo: la clave queda libre para el mismo pedido corregido. */
  private async cerrar<T extends object>(
    id: string,
    r: ResultadoConEfectoExterno<T>,
  ): Promise<ResultadoConEfectoExterno<T>> {
    if ('soltar' in r) {
      await this.db.query(
        `UPDATE solicitudes_idempotentes
            SET eliminado_el = NOW(), actualizado_el = NOW()
          WHERE solicitud_idempotente_id = $1
            AND eliminado_el IS NULL`,
        [id],
      );
      return r;
    }
    await this.db.query(
      `UPDATE solicitudes_idempotentes
          SET respuesta = $1, actualizado_el = NOW()
        WHERE solicitud_idempotente_id = $2
          AND eliminado_el IS NULL`,
      [JSON.stringify(instanceToPlain(r.respuesta)), id],
    );
    return r;
  }

  /** `null` = el reclamo se soltó en el medio y la clave está libre otra vez. */
  private async retomar<P, T extends object>(
    s: SolicitudConEfectoExternoInput,
    pasos: PasosConEfectoExterno<P, T>,
  ): Promise<
    { origen: OrigenConEfectoExterno; respuesta: T } | { soltar: Error } | null
  > {
    const [columna, actorId] =
      'usuarioId' in s.actor
        ? ['usuario_id', s.actor.usuarioId]
        : ['api_key_id', s.actor.apiKeyId];
    // `FOR UPDATE` espera a la tx1 que siga viva; en READ COMMITTED, al
    // soltarse relee la fila: ve la respuesta que guardó, o que se soltó.
    const [fila] = await this.db.query<
      {
        id: string;
        huella: string;
        respuesta: Record<string, unknown> | null;
      }[]
    >(
      `SELECT solicitud_idempotente_id AS id, huella, respuesta
         FROM solicitudes_idempotentes
        WHERE tenant_id = $1 AND ${columna} = $2 AND clave = $3
          AND eliminado_el IS NULL
        FOR UPDATE`,
      [s.tenantId, actorId, s.clave],
    );
    if (!fila) return null;
    if (fila.huella !== s.huella)
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: s.mensajeOtrosDatos,
        ...(await pasos.cuerpoOtrosDatos(fila.id)),
      });
    if (fila.respuesta)
      return {
        origen: 'reproducida',
        respuesta: { ...fila.respuesta, repetida: true } as unknown as T,
      };
    const r = await this.cerrar(
      fila.id,
      await pasos.resolverSinConfirmar(fila.id),
    );
    return 'soltar' in r ? r : { origen: 'resuelta', respuesta: r.respuesta };
  }
}
