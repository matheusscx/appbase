import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Db } from '../../../common/db/db.service';
import { CronRunnerService } from '../../cron/cron-runner.service';
import { DteError } from '../dte.types';
import type { AmbienteSii } from '../entities/dte-caf.entity';
import { FoliosService } from '../folios.service';
import {
  ESTADO_ENVIO_REPETIDO,
  ESTADOS_ENVIO_FINALES,
  repartirResultado,
} from '../resultado-sii';
import { SiiBoletaCliente } from '../sii-boleta.cliente';

export const JOB_CONSULTAR_ENVIOS = 'consultar-envios';

/** Cuánto vale la reserva de una consulta, y cada cuánto se repite mientras el SII procesa. */
export const REPITE_CONSULTA_MS = 5 * 60_000;
/** Un 404 se sigue consultando hasta este tiempo después del envío: de ahí en adelante, a revisión. */
export const PLAZO_404_MS = 24 * 3_600_000;
/** Envíos por corrida: el SII limita los pedidos por hora, y todos los tenants salen por la misma IP. */
const LOTE_CONSULTAS = 20;

const MENSAJE_REPETIDO = 'El SII ya tenía este envío (RPT)';
const MENSAJE_NO_ENCUENTRA = 'El SII no encuentra el envío';
const MENSAJE_AUN_NO_ENCUENTRA =
  'El SII todavía no encuentra el envío; se vuelve a consultar';
const MENSAJE_SIN_AUTENTICACION =
  'El SII no aceptó la autenticación del certificado; se reintenta';
const MENSAJE_SIN_BOLETAS = 'El envío no tiene boletas vivas que consultar';

// Los envíos que ya se mandaron, sin resultado final, y cuya consulta venció. Lo comparten el
// tick (¿hay algo que hacer?) y la reserva (qué hacer). `estado_sii` NULL no pasa por el
// `NOT IN` (NULL no es verdadero ni falso), de ahí el `IS NULL` aparte. $1 = los estados finales.
const ENVIOS_LISTOS = `
  FROM dte_envios
 WHERE trackid IS NOT NULL AND consultar_desde <= now() AND eliminado_el IS NULL
   AND (estado_sii IS NULL OR NOT (estado_sii = ANY($1::text[])))`;

const HAY_TRABAJO = `SELECT EXISTS (SELECT 1 ${ENVIOS_LISTOS}) AS hay`;

// SKIP LOCKED + la reserva de abajo: dos instancias del backend toman envíos distintos. El
// `FOR UPDATE` solo dura hasta el commit de la transacción corta (la llamada al SII va fuera de
// ella), así que lo que protege el resto del tiempo es mover `consultar_desde`. Cinco minutos
// pueden no alcanzar para 20 consultas de hasta 20 s cada una: si otra instancia retoma un envío
// que esta todavía no anotó, el reparto es inocuo (solo escribe boletas `enviado`, y la segunda
// en llegar no encuentra ninguna).
// `pasaron_24h` lo decide el reloj de la base, el mismo que fijó `enviado_el`.
const TOMAR_ENVIOS = `
  SELECT envio_id, tenant_id, razon_social_id, ambiente, trackid,
         enviado_el <= now() - ($2::double precision * interval '1 millisecond') AS pasaron_24h
  ${ENVIOS_LISTOS}
  ORDER BY consultar_desde
  LIMIT $3
    FOR UPDATE SKIP LOCKED`;

const RESERVAR_ENVIOS = `
  UPDATE dte_envios
     SET consultar_desde = now() + ($2::int * interval '1 millisecond'), actualizado_el = now()
   WHERE envio_id = ANY($1) AND eliminado_el IS NULL`;

// Las boletas de todos los envíos del lote en una sola lectura, sea cual sea su estado: de ahí
// sale el CAF con el que se descifra el certificado de cada envío (cualquiera sirve: todas las
// de un sobre son de la misma razón social) y las que se reparten. El reparto solo escribe las
// que siguen `enviado` (ver REPARTIR_BOLETAS). `xml` no se lee: no hace falta y pesa.
const BOLETAS_DE_LOS_ENVIOS = `
  SELECT envio_id, documento_id, caf_id, tipo, folio
    FROM dte_documentos
   WHERE envio_id = ANY($1) AND eliminado_el IS NULL
   ORDER BY envio_id, emitido_el, folio`;

// Respuesta del SII sin resultado final: se anota y se vuelve a preguntar más tarde. `$5` es el
// aviso de un código que no conocemos, o NULL (que limpia el error de una consulta anterior).
const ANOTAR_EN_PROCESO = `
  UPDATE dte_envios
     SET estado_sii = $2, respuesta_sii = $3::jsonb, intentos_consulta = intentos_consulta + 1,
         consultar_desde = now() + ($4::double precision * interval '1 millisecond'),
         ultimo_error = $5, actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

// Resultado final: el envío sale de la consulta (`consultar_desde` NULL). `ultimo_error` es el
// aviso de RPT, o NULL si antes de este resultado había quedado un error de otra consulta.
const ANOTAR_FINAL = `
  UPDATE dte_envios
     SET estado_sii = $2, respuesta_sii = $3::jsonb, intentos_consulta = intentos_consulta + 1,
         consultar_desde = NULL, ultimo_error = $4, actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

// Un solo UPDATE para todas las boletas del sobre, con el estado y el detalle de cada una (nunca
// una consulta por boleta). `AND d.estado = 'enviado'`: una boleta que ya tiene estado final no
// se pisa, y `d.envio_id = $1` ata cada id al sobre que se está repartiendo.
const REPARTIR_BOLETAS = `
  UPDATE dte_documentos d
     SET estado = c.estado, detalle_sii = c.detalle::jsonb, actualizado_el = now()
    FROM unnest($2::uuid[], $3::text[], $4::text[]) AS c(documento_id, estado, detalle)
   WHERE d.documento_id = c.documento_id AND d.envio_id = $1
     AND d.estado = 'enviado' AND d.eliminado_el IS NULL`;

// `$3` NULL deja `consultar_desde` en NULL (NULL × intervalo es NULL): así el envío sale de la
// consulta y queda para que alguien lo revise, con el motivo en `ultimo_error`.
const ANOTAR_ERROR = `
  UPDATE dte_envios
     SET ultimo_error = $2, consultar_desde = now() + ($3::int * interval '1 millisecond'),
         actualizado_el = now()
   WHERE envio_id = $1 AND eliminado_el IS NULL`;

interface EnvioListo {
  envio_id: string;
  tenant_id: string;
  razon_social_id: string;
  ambiente: AmbienteSii;
  trackid: string;
  pasaron_24h: boolean | null;
}

interface FilaBoleta {
  envio_id: string;
  documento_id: string;
  caf_id: string;
  tipo: number;
  folio: number;
}

type Credenciales = Awaited<
  ReturnType<FoliosService['credencialesParaFirmar']>
>;

interface Resumen {
  finales: number;
  enProceso: number;
  conError: number;
}

/**
 * El código del SII son 3 letras y la columna también. Uno más largo se corta, salvo que el
 * corte sea un estado final y el código no lo sea (`RCHX` → `RCH`): guardado así, la cola lo
 * daría por terminado sin que nadie repartiera nada. En ese caso queda sin código (la
 * respuesta completa está en `respuesta_sii`).
 */
function guardable(codigo: string): string | null {
  const corte = codigo.slice(0, 3);
  return corte !== codigo && ESTADOS_ENVIO_FINALES.includes(corte)
    ? null
    : corte;
}

/**
 * Pregunta al SII cómo van los envíos ya mandados y reparte el resultado entre sus boletas
 * (aceptada, con reparos o rechazada). Cada minuto toma hasta 20 envíos con `trackid`, sin
 * resultado final y con la consulta vencida (el SII pide esperar 10 minutos tras enviar).
 *
 * Nunca hay una llamada HTTP con una transacción abierta: la reserva se confirma antes de
 * llamar al SII y el resultado se anota después. La reserva es mover `consultar_desde` 5
 * minutos: si el proceso se cae, la consulta se repite sola cuando vence.
 */
@Injectable()
export class ConsultarEnviosJob {
  private readonly logger = new Logger(ConsultarEnviosJob.name);

  constructor(
    private readonly db: Db,
    private readonly runner: CronRunnerService,
    private readonly folios: FoliosService,
    private readonly cliente: SiiBoletaCliente,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.config.get<string>('DTE_COLA_AUTOMATICA') === 'false') return;
    if (this.cliente.pausadoHasta() > Date.now()) return;
    try {
      // Un tick sin trabajo no entra al runner: con un tick por minuto serían 1.440 filas al
      // día en `cron_ejecuciones` para no decir nada.
      const [{ hay }] = await this.db.query<{ hay: boolean }[]>(HAY_TRABAJO, [
        ESTADOS_ENVIO_FINALES,
      ]);
      if (!hay) return;
      await this.runner.ejecutar(JOB_CONSULTAR_ENVIOS, () => this.consultar());
    } catch (e) {
      this.logger.error(
        `No se pudo revisar la cola de consultas: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async consultar(ahora = new Date()): Promise<string> {
    if (this.cliente.pausadoHasta() > Date.now())
      return 'El SII pidió espaciar los pedidos, no se consulta';

    const envios = await this.reservar();
    if (envios.length === 0) return 'Sin envíos que consultar';

    // Una lectura para todo el lote; sin esto sería una por envío.
    const filas = await this.db.query<FilaBoleta[]>(BOLETAS_DE_LOS_ENVIOS, [
      envios.map((e) => e.envio_id),
    ]);
    const boletasDe = new Map<string, FilaBoleta[]>();
    for (const f of filas)
      boletasDe.set(f.envio_id, [...(boletasDe.get(f.envio_id) ?? []), f]);

    // Las credenciales dependen de la razón social (y del ambiente del CAF), no del envío: una
    // por razón social en vez de una por envío. Se guarda la promesa, así que un fallo
    // (`DteError`) también se lee una sola vez y se anota en cada envío de esa razón social.
    const memo = new Map<string, Promise<Credenciales>>();
    const credencialesDe = (envio: EnvioListo, cafId: string) => {
      const clave = `${envio.tenant_id}|${envio.razon_social_id}|${envio.ambiente}`;
      let promesa = memo.get(clave);
      if (!promesa) {
        promesa = this.folios.credencialesParaFirmar(
          envio.tenant_id,
          cafId,
          ahora,
        );
        memo.set(clave, promesa);
      }
      return promesa;
    };

    const resumen: Resumen = { finales: 0, enProceso: 0, conError: 0 };
    let pausado = false;
    let falla: Error | undefined;
    for (const envio of envios) {
      // El SII pidió espaciar los pedidos (405 o límite agotado): lo que falta del lote vuelve
      // a consultarse cuando venza su reserva.
      if (this.cliente.pausadoHasta() > Date.now()) {
        pausado = true;
        break;
      }
      try {
        await this.consultarUno(
          envio,
          boletasDe.get(envio.envio_id) ?? [],
          credencialesDe,
          resumen,
        );
      } catch (e) {
        // Un error de programación en un envío no le quita el turno a los demás. Se registra y
        // se vuelve a tirar al final: el runner lo anota y la reserva vence sola.
        this.logger.error(
          `Falló la consulta del envío ${envio.envio_id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        falla ??= e instanceof Error ? e : new Error(String(e));
      }
    }
    if (falla) throw falla;

    return (
      `${resumen.finales.toString()} envíos con resultado final, ` +
      `${resumen.enProceso.toString()} siguen en proceso, ` +
      `${resumen.conError.toString()} con error` +
      (pausado ? '; el SII pidió espaciar los pedidos, se corta' : '')
    );
  }

  /** Toma hasta 20 envíos y los deja reservados 5 minutos, en una sola transacción. */
  private reservar(): Promise<EnvioListo[]> {
    return this.db.transaccion(async () => {
      const envios = await this.db.query<EnvioListo[]>(TOMAR_ENVIOS, [
        ESTADOS_ENVIO_FINALES,
        PLAZO_404_MS,
        LOTE_CONSULTAS,
      ]);
      if (envios.length > 0)
        await this.db.query(RESERVAR_ENVIOS, [
          envios.map((e) => e.envio_id),
          REPITE_CONSULTA_MS,
        ]);
      return envios;
    });
  }

  private async consultarUno(
    envio: EnvioListo,
    boletas: FilaBoleta[],
    credencialesDe: (envio: EnvioListo, cafId: string) => Promise<Credenciales>,
    resumen: Resumen,
  ): Promise<void> {
    if (boletas.length === 0) {
      // Sin boletas no hay CAF con que descifrar el certificado: reintentar no lo arregla.
      await this.anotarError(envio.envio_id, MENSAJE_SIN_BOLETAS, null);
      resumen.conError += 1;
      return;
    }

    let credenciales: Credenciales;
    try {
      credenciales = await credencialesDe(envio, boletas[0].caf_id);
    } catch (e) {
      // Un problema de la empresa (certificado vencido, perfil incompleto) no toca las boletas:
      // el envío se vuelve a consultar y el motivo queda a la vista hasta que el dueño lo arregle.
      if (e instanceof DteError) {
        await this.anotarError(envio.envio_id, e.message, REPITE_CONSULTA_MS);
        resumen.conError += 1;
        return;
      }
      throw e;
    }

    const r = await this.cliente.consultarEnvio(
      envio.ambiente,
      credenciales.certificado,
      credenciales.caratula.rutEmisor,
      envio.trackid,
    );

    switch (r.tipo) {
      case 'ok': {
        // Se decide con el código completo: un código desconocido que empieza como uno final
        // (`RCHX`) no es final.
        const { final, cambios, observaciones } = repartirResultado(
          r.datos,
          boletas.map((b) => ({
            documentoId: b.documento_id,
            tipo: b.tipo,
            folio: b.folio,
          })),
        );
        if (!final) {
          await this.db.query(ANOTAR_EN_PROCESO, [
            envio.envio_id,
            guardable(r.datos.estado),
            JSON.stringify(r.datos),
            Math.max(REPITE_CONSULTA_MS, r.reintentarEnMs ?? 0),
            observaciones.length > 0 ? observaciones.join('; ') : null,
          ]);
          resumen.enProceso += 1;
          return;
        }
        await this.db.transaccion(async () => {
          await this.db.query(ANOTAR_FINAL, [
            envio.envio_id,
            guardable(r.datos.estado),
            JSON.stringify(r.datos),
            r.datos.estado === ESTADO_ENVIO_REPETIDO
              ? MENSAJE_REPETIDO
              : observaciones.length > 0
                ? observaciones.join('; ').slice(0, 1000)
                : null,
          ]);
          if (cambios.length > 0)
            await this.db.query(REPARTIR_BOLETAS, [
              envio.envio_id,
              cambios.map((c) => c.documentoId),
              cambios.map((c) => c.estado),
              cambios.map((c) =>
                c.detalleSii === null ? null : JSON.stringify(c.detalleSii),
              ),
            ]);
        });
        resumen.finales += 1;
        return;
      }
      case 'no_encontrado':
        // Un envío recién mandado puede tardar en aparecer. Pasadas 24 horas ya no es demora:
        // sale de la consulta y sus boletas siguen `enviado` (atrasadas a la vista).
        if (envio.pasaron_24h)
          await this.anotarError(envio.envio_id, MENSAJE_NO_ENCUENTRA, null);
        else
          await this.anotarError(
            envio.envio_id,
            MENSAJE_AUN_NO_ENCUENTRA,
            REPITE_CONSULTA_MS,
          );
        break;
      case 'no_autorizado':
        await this.anotarError(
          envio.envio_id,
          MENSAJE_SIN_AUTENTICACION,
          REPITE_CONSULTA_MS,
        );
        break;
      case 'peticion_invalida':
      case 'transitorio':
        await this.anotarError(envio.envio_id, r.mensaje, REPITE_CONSULTA_MS);
        break;
    }
    resumen.conError += 1;
  }

  /** `esperaMs` null saca el envío de la consulta. */
  private anotarError(
    envioId: string,
    mensaje: string,
    esperaMs: number | null,
  ): Promise<unknown> {
    return this.db.query(ANOTAR_ERROR, [envioId, mensaje, esperaMs]);
  }
}
