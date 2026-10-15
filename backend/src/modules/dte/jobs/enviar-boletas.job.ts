import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Db } from '../../../common/db/db.service';
import { unwrap } from '../../../common/utils/pg-returning.util';
import { CronRunnerService } from '../../cron/cron-runner.service';
import { DteError } from '../dte.types';
import type { AmbienteSii } from '../entities/dte-caf.entity';
import { armarEnvioBoleta } from '../envio-boleta';
import { FoliosService } from '../folios.service';
import { ahoraChile } from '../perfil-fiscal';
import { ESTADOS_ENVIO_EN_PROCESO } from '../resultado-sii';
import { SiiBoletaCliente } from '../sii-boleta.cliente';

export const JOB_ENVIAR_BOLETAS = 'enviar-boletas';

/** Boletas por sobre: a este número una razón social sale sin esperar. */
export const LOTE_MAXIMO = 50;
/** Con menos de 50, una razón social espera a que su pendiente más antigua cumpla esto. */
export const ESPERA_LOTE_MS = 5 * 60_000;
/** Cuánto vale la reserva de un sobre en vuelo antes de que sus boletas vuelvan a la cola. */
export const RESERVA_MS = 5 * 60_000;
/** Lo mínimo que el SII tarda en procesar un envío: antes de esto no se le pregunta. */
export const ESPERA_CONSULTA_MS = 10 * 60_000;

const ESCALA_REINTENTO_MS = [30_000, 60_000, 120_000, 300_000];
const ESPERA_MAXIMA_MS = 600_000;

/**
 * Cuánto espera una boleta antes del intento `n` (1 = el primero que ya falló): 30 s, 1, 2 y 5
 * minutos, y de ahí 10 minutos sin tope de intentos. Es la única fuente de la escala: el
 * `UPDATE` de devolución recibe estos valores y no los repite.
 */
export function espera(n: number): number {
  return ESCALA_REINTENTO_MS[n - 1] ?? ESPERA_MAXIMA_MS;
}

// Las razones sociales con un lote listo: 50 pendientes, o la más antigua ya esperó 5 minutos.
// Lo comparten el tick (¿hay algo que hacer?) y `enviarLotes` (qué hacer). Una boleta que volvió
// a la cola cuenta solo cuando su `proximo_intento_el` llegó: la espera creciente es por boleta.
const GRUPOS_LISTOS = `
  SELECT razon_social_id, tenant_id, ambiente, min(emitido_el) AS mas_antigua
    FROM dte_documentos
   WHERE estado = 'pendiente' AND eliminado_el IS NULL AND proximo_intento_el <= now()
   GROUP BY razon_social_id, tenant_id, ambiente
  HAVING count(*) >= $1 OR min(emitido_el) <= now() - ($2::int * interval '1 millisecond')`;

const HAY_TRABAJO = `
  SELECT (
    EXISTS (${GRUPOS_LISTOS})
    OR EXISTS (
      SELECT 1 FROM dte_envios e
       WHERE e.trackid IS NULL AND e.reservado_hasta < now() AND e.eliminado_el IS NULL
    )
  ) AS hay`;

// Un sobre sin trackid cuya reserva venció es un proceso que se cayó con el sobre en vuelo: el
// SII no lo recibió (o no sabemos que lo recibió) y sus boletas vuelven a la cola. El sobre se da
// de baja con soft delete: para el SII nunca existió, y sin esto la reserva vencida seguiría
// contando como trabajo en cada tick.
const DEVOLVER_RESERVAS_VENCIDAS = `
  WITH vencidos AS (
    UPDATE dte_envios
       SET eliminado_el = now(), reservado_hasta = NULL, actualizado_el = now(),
           ultimo_error = 'La reserva del envío venció sin respuesta del SII'
     WHERE trackid IS NULL AND reservado_hasta < now() AND eliminado_el IS NULL
    RETURNING envio_id
  )
  UPDATE dte_documentos d
     SET estado = 'pendiente', envio_id = NULL, actualizado_el = now()
    FROM vencidos v
   WHERE d.envio_id = v.envio_id AND d.estado = 'enviado' AND d.eliminado_el IS NULL`;

// SKIP LOCKED: dos instancias del backend toman lotes distintos en vez de esperarse (o de mandar
// la misma boleta en dos sobres). Con varias instancias, la segunda puede mandar un sobre chico:
// la regla del lote (50 o 5 minutos) se evalúa antes del lock, y la primera ya pudo llevarse las
// boletas. Es aceptado: el sobre chico es válido y las boletas no se duplican.
const TOMAR_LOTE = `
  SELECT documento_id, caf_id, xml, folio, tipo, rut_emisor
    FROM dte_documentos
   WHERE razon_social_id = $1 AND ambiente = $2 AND tenant_id = $4 AND estado = 'pendiente'
     AND proximo_intento_el <= now() AND eliminado_el IS NULL
   ORDER BY emitido_el, folio
   LIMIT $3
     FOR UPDATE SKIP LOCKED`;

const RESERVAR_ENVIO = `
  INSERT INTO dte_envios (tenant_id, razon_social_id, ambiente, reservado_hasta)
  VALUES ($1, $2, $3, now() + ($4::int * interval '1 millisecond'))
  RETURNING envio_id`;

const MARCAR_ENVIADAS = `
  UPDATE dte_documentos
     SET estado = 'enviado', envio_id = $1, actualizado_el = now()
   WHERE documento_id = ANY($2) AND eliminado_el IS NULL`;

// `AND eliminado_el IS NULL`: si el paso 1 ya dio de baja este sobre porque su reserva venció
// mientras el SII contestaba, no se escribe sobre una fila borrada (el UPDATE afecta 0 filas y
// el job sigue). Esas boletas ya volvieron a la cola y se reenviarán: el SII contestará que el
// folio ya lo recibió (RPT). Es el mismo hueco de un proceso que cae antes de anotar el trackid.
const ANOTAR_ENVIO_OK = `
  UPDATE dte_envios
     SET trackid = $2::bigint, estado_sii = $3, enviado_el = now(),
         consultar_desde = now() + ($4::double precision * interval '1 millisecond'),
         reservado_hasta = NULL, ultimo_error = $5, actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

// Soft delete a propósito (no es un olvido del filtro): el sobre no llegó a existir para el SII,
// y las boletas que llevaba vuelven a la cola para armar otro. La fila queda para ver qué falló,
// pero no puede contar como un envío vivo (ni como una reserva) ni como uno que consultar.
const DAR_DE_BAJA_ENVIO = `
  UPDATE dte_envios
     SET ultimo_error = $2, reservado_hasta = NULL, eliminado_el = now(), actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

// La espera es por boleta (`intentos` de cada una): sale de un solo `UPDATE` con la escala como
// arreglo. `intentos` a la derecha es el valor de antes, así que el intento nuevo es `intentos + 1`
// y su espera es la posición `intentos + 1` de la escala (1-based). Más allá de la escala, `$5`.
// `AND envio_id = $1` protege de un sobre ya reasignado: si la reserva venció mientras tanto y
// otra instancia tomó estas boletas, no se las pisamos.
const DEVOLVER_BOLETAS = `
  UPDATE dte_documentos
     SET estado = 'pendiente', envio_id = NULL, intentos = intentos + 1, ultimo_error = $3,
         proximo_intento_el = now() + (COALESCE(($4::int[])[intentos + 1], $5::int) * interval '1 millisecond'),
         actualizado_el = now()
   WHERE documento_id = ANY($2) AND envio_id = $1 AND eliminado_el IS NULL`;

const ANOTAR_ENVIO_RECHAZADO = `
  UPDATE dte_envios
     SET ultimo_error = $2, reservado_hasta = NULL, actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

const RECHAZAR_BOLETAS = `
  UPDATE dte_documentos
     SET estado = 'rechazado', detalle_sii = $3::jsonb, ultimo_error = $4, actualizado_el = now()
   WHERE documento_id = ANY($2) AND envio_id = $1 AND eliminado_el IS NULL`;

interface GrupoListo {
  razon_social_id: string;
  tenant_id: string;
  ambiente: AmbienteSii;
}

interface FilaLote {
  documento_id: string;
  caf_id: string;
  xml: string;
  folio: number;
  tipo: 39 | 41;
  rut_emisor: string;
}

interface Resumen {
  enviados: number;
  devueltos: number;
  rechazados: number;
  vencidos: number;
}

/**
 * Manda al SII las boletas de la cola. Cada 30 s arma, por razón social, un sobre con sus
 * boletas pendientes (a las 50, o cuando la más antigua lleva 5 minutos esperando), lo reserva,
 * lo firma, lo envía con el cliente del SII y anota lo que contestó. No consulta el resultado:
 * eso es de otro job.
 *
 * Nunca hay una llamada HTTP con una transacción abierta: la reserva se confirma antes de
 * llamar al SII y el resultado se anota después. Si el proceso se cae entremedio, la reserva
 * vence y las boletas vuelven a la cola.
 */
@Injectable()
export class EnviarBoletasJob {
  private readonly logger = new Logger(EnviarBoletasJob.name);

  constructor(
    private readonly db: Db,
    private readonly runner: CronRunnerService,
    private readonly folios: FoliosService,
    private readonly cliente: SiiBoletaCliente,
    private readonly config: ConfigService,
  ) {}

  @Cron('*/30 * * * * *')
  async tick(): Promise<void> {
    if (this.config.get<string>('DTE_COLA_AUTOMATICA') === 'false') return;
    if (this.cliente.pausadoHasta() > Date.now()) return;
    try {
      // Un tick sin trabajo no entra al runner: con un tick cada 30 s serían ~2.900 filas al
      // día en `cron_ejecuciones` para no decir nada.
      const [{ hay }] = await this.db.query<{ hay: boolean }[]>(HAY_TRABAJO, [
        LOTE_MAXIMO,
        ESPERA_LOTE_MS,
      ]);
      if (!hay) return;
      await this.runner.ejecutar(JOB_ENVIAR_BOLETAS, () => this.enviarLotes());
    } catch (e) {
      this.logger.error(
        `No se pudo revisar la cola de boletas: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async enviarLotes(ahora = new Date()): Promise<string> {
    const resumen: Resumen = {
      enviados: 0,
      devueltos: 0,
      rechazados: 0,
      vencidos: 0,
    };

    const [, vencidos] = await this.db.query<[unknown[], number]>(
      DEVOLVER_RESERVAS_VENCIDAS,
    );
    resumen.vencidos = vencidos;

    const grupos = await this.db.query<GrupoListo[]>(
      `SELECT razon_social_id, tenant_id, ambiente
         FROM (${GRUPOS_LISTOS}) g
        ORDER BY mas_antigua`,
      [LOTE_MAXIMO, ESPERA_LOTE_MS],
    );

    let pausado = false;
    let falla: Error | undefined;
    for (const grupo of grupos) {
      // El SII pidió espaciar los pedidos (405 o límite agotado): no se reserva nada que después
      // no se pueda mandar.
      if (this.cliente.pausadoHasta() > Date.now()) {
        pausado = true;
        break;
      }
      try {
        await this.procesar(grupo, ahora, resumen);
      } catch (e) {
        // Un error de programación de una razón social no le quita el turno a las demás. Se
        // registra y se vuelve a tirar al final: el runner lo anota y la reserva vence sola.
        this.logger.error(
          `Falló el envío de la razón social ${grupo.razon_social_id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        falla ??= e instanceof Error ? e : new Error(String(e));
      }
    }
    if (falla) throw falla;

    return (
      `${resumen.enviados.toString()} sobres enviados, ` +
      `${resumen.devueltos.toString()} boletas devueltas a la cola, ` +
      `${resumen.rechazados.toString()} rechazadas, ` +
      `${resumen.vencidos.toString()} de reservas vencidas` +
      (pausado ? '; el SII pidió espaciar los pedidos, se corta' : '')
    );
  }

  private async procesar(
    grupo: GrupoListo,
    ahora: Date,
    resumen: Resumen,
  ): Promise<void> {
    const reserva = await this.reservar(grupo);
    if (!reserva) return;
    const { envioId, filas } = reserva;
    const ids = filas.map((f) => f.documento_id);

    let credenciales: Awaited<
      ReturnType<FoliosService['credencialesParaFirmar']>
    >;
    let sobre: string;
    try {
      // Con el CAF de la boleta más antigua: trae el certificado y la carátula, y rechaza si la
      // empresa cambió de ambiente, si el certificado venció o si falta un dato.
      credenciales = await this.folios.credencialesParaFirmar(
        grupo.tenant_id,
        filas[0].caf_id,
        ahora,
      );
      sobre = armarEnvioBoleta(
        filas.map((f) => ({
          xml: f.xml,
          rutEmisor: f.rut_emisor,
          folio: f.folio,
          tipo: f.tipo,
        })),
        credenciales.caratula,
        credenciales.certificado,
        ahoraChile(ahora),
      );
    } catch (e) {
      // Un problema de la empresa (certificado vencido, perfil incompleto) no rechaza las
      // boletas: vuelven a la cola con el motivo a la vista, hasta que el dueño lo arregle.
      if (e instanceof DteError) {
        await this.devolver(envioId, ids, e.message);
        resumen.devueltos += ids.length;
        return;
      }
      throw e;
    }

    const r = await this.cliente.enviar(
      grupo.ambiente,
      credenciales.certificado,
      credenciales.caratula.rutEmisor,
      sobre,
    );

    switch (r.tipo) {
      case 'ok': {
        // El estado del POST se guarda solo si es uno que sigue en proceso. Un código final
        // (o desconocido) dejaría al envío fuera de la consulta antes de que nadie la haga:
        // queda sin código, se consulta igual y el motivo queda anotado.
        const estado = r.datos.estado;
        const guardable = ESTADOS_ENVIO_EN_PROCESO.includes(estado);
        await this.db.query(ANOTAR_ENVIO_OK, [
          envioId,
          r.datos.trackid,
          guardable ? estado : null,
          Math.max(ESPERA_CONSULTA_MS, r.reintentarEnMs ?? 0),
          estado === '' || guardable
            ? null
            : `El SII respondió el envío con el código ${estado.slice(0, 20)}; se consulta igual`,
        ]);
        resumen.enviados += 1;
        return;
      }
      case 'peticion_invalida':
        await this.rechazar(envioId, ids, r.mensaje);
        resumen.rechazados += ids.length;
        return;
      case 'no_autorizado':
        // Incluye los fallos al pedir la semilla o el token: no es culpa de las boletas.
        await this.devolver(
          envioId,
          ids,
          'El SII no aceptó la autenticación del certificado; se reintenta',
        );
        break;
      case 'no_encontrado':
        await this.devolver(
          envioId,
          ids,
          'El SII no encontró el servicio de recepción de boletas; se reintenta',
        );
        break;
      case 'transitorio':
        await this.devolver(envioId, ids, r.mensaje);
        break;
    }
    resumen.devueltos += ids.length;
  }

  /** Toma hasta 50 boletas y las deja reservadas a un sobre nuevo, en una sola transacción. */
  private reservar(
    grupo: GrupoListo,
  ): Promise<{ envioId: string; filas: FilaLote[] } | null> {
    return this.db.transaccion(async () => {
      const filas = await this.db.query<FilaLote[]>(TOMAR_LOTE, [
        grupo.razon_social_id,
        grupo.ambiente,
        LOTE_MAXIMO,
        grupo.tenant_id,
      ]);
      if (filas.length === 0) return null;
      const [{ envio_id: envioId }] = unwrap<{ envio_id: string }>(
        await this.db.query(RESERVAR_ENVIO, [
          grupo.tenant_id,
          grupo.razon_social_id,
          grupo.ambiente,
          RESERVA_MS,
        ]),
      );
      await this.db.query(MARCAR_ENVIADAS, [
        envioId,
        filas.map((f) => f.documento_id),
      ]);
      return { envioId, filas };
    });
  }

  /** El sobre no existió para el SII: se da de baja y sus boletas vuelven a la cola. */
  private devolver(
    envioId: string,
    ids: string[],
    mensaje: string,
  ): Promise<void> {
    return this.db.transaccion(async () => {
      await this.db.query(DAR_DE_BAJA_ENVIO, [envioId, mensaje]);
      await this.db.query(DEVOLVER_BOLETAS, [
        envioId,
        ids,
        mensaje,
        ESCALA_REINTENTO_MS.map((_, i) => espera(i + 1)),
        espera(ESCALA_REINTENTO_MS.length + 1),
      ]);
    });
  }

  /** El SII dijo que el pedido está mal formado: reintentar no lo arregla. */
  private rechazar(
    envioId: string,
    ids: string[],
    mensaje: string,
  ): Promise<void> {
    return this.db.transaccion(async () => {
      await this.db.query(ANOTAR_ENVIO_RECHAZADO, [envioId, mensaje]);
      await this.db.query(RECHAZAR_BOLETAS, [
        envioId,
        ids,
        JSON.stringify({ origen: 'envio', mensaje }),
        mensaje,
      ]);
    });
  }
}
