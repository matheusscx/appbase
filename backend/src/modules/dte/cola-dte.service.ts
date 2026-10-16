import { Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarRut } from '../../common/utils/rut.util';
import { DteError } from './dte.types';
import type { BoletaEmitida } from './envio-boleta';
import { COND_CON_PROBLEMAS, COND_RECHAZADA } from './problemas-sii';

// La razón social y el ambiente salen del CAF con que se tomó el folio, no de quien llama: son
// los que el SII le asignó a ese folio. El CAF guarda su RUT normalizado y la boleta solo se
// inserta si es el mismo. Es una sola sentencia para distinguir "el CAF no existe" de "es de otro
// RUT" sin dejar una fila a medias: el SELECT final devuelve el CAF si existe, y `documento_id`
// solo si se insertó.
const ENCOLAR = `
  WITH caf AS (
    SELECT c.caf_id, c.tenant_id, c.razon_social_id, c.ambiente, c.rut_emisor
      FROM dte_cafs c
     WHERE c.caf_id = $2 AND c.tenant_id = $1 AND c.eliminado_el IS NULL
  ), nuevo AS (
    INSERT INTO dte_documentos
      (tenant_id, razon_social_id, caf_id, tipo, folio, ambiente, rut_emisor, xml,
       estado, emitido_el, proximo_intento_el)
    SELECT caf.tenant_id, caf.razon_social_id, caf.caf_id, $3::smallint, $4::integer,
           caf.ambiente, $5::varchar, $6::text, 'pendiente', now(), now()
      FROM caf
     WHERE caf.rut_emisor = $5::varchar
    RETURNING documento_id
  )
  SELECT caf.rut_emisor, (SELECT documento_id FROM nuevo) AS documento_id
    FROM caf`;

/** Lo que el panel de soporte ve de cada boleta con problemas, de cualquier tenant. */
export interface BoletaConProblemaSoporte {
  documentoId: string;
  tenantId: string;
  /** `tenants.nombre`. */
  tenant: string;
  /** `razones_sociales.nombre`; null si la razón social se dio de baja. */
  razonSocial: string | null;
  ambiente: string;
  tipo: 39 | 41;
  folio: number;
  emitidaEl: Date;
  grupo: 'atrasada' | 'rechazada';
  intentos: number;
  ultimoError: string | null;
  detalleSii: unknown;
  /** `dte_envios.estado_sii` del sobre en que viajó; null si aún no viajó o el sobre se dio de baja. */
  envioEstadoSii: string | null;
  /** `dte_envios.ultimo_error`: por qué una atrasada `enviado` quedó trabada (la boleta no lo guarda). */
  envioUltimoError: string | null;
  /** El local se dio de baja (`tenants.eliminado_el`); sus boletas se siguen enviando, así que se muestran. */
  tenantDadoDeBaja: boolean;
}

interface FilaProblemaSoporte {
  documento_id: string;
  tenant_id: string;
  tenant: string;
  razon_social: string | null;
  ambiente: string;
  tipo: 39 | 41;
  folio: number;
  emitido_el: Date;
  grupo: 'atrasada' | 'rechazada';
  intentos: number;
  ultimo_error: string | null;
  detalle_sii: unknown;
  envio_estado_sii: string | null;
  envio_ultimo_error: string | null;
  tenant_dado_de_baja: boolean;
}

// Cruza tenants a propósito: es el eje superadmin, como `/admin/tenants`; la ruta que la usa
// lleva SuperadminGuard y no recibe tenant de ningún lado. El LEFT JOIN a la razón social deja ver
// la boleta aunque la razón social se haya dado de baja.
// EXCEPCIÓN DELIBERADA al filtro `eliminado_el` en `tenants`: el JOIN NO excluye al local dado de
// baja. Una boleta ya emitida se sigue enviando al SII aunque el local se dé de baja (decisión del
// owner, 2026-10-15: las boletas ya se entregaron al cliente, no enviarlas es infracción del local),
// así que si le falla, soporte tiene que verla. `tenant_dado_de_baja` la marca en la pantalla.
// No "arreglar" agregándole `AND t.eliminado_el IS NULL`: esconde justo las que nadie más mira.
// El LEFT JOIN a `dte_envios` trae el motivo de una atrasada `enviado` trabada (código desconocido
// del SII, 404 de 24 h): vive en el envío, no en la boleta. Es LEFT porque una `pendiente` no tiene
// envío, y filtra `eliminado_el` porque un envío dado de baja no explica nada.
// El tope de 200 acota la respuesta; las más antiguas van primero, que son las más atrasadas.
const PROBLEMAS_DE_TODOS = `
  SELECT d.documento_id, d.tenant_id, t.nombre AS tenant, rs.nombre AS razon_social, d.ambiente,
         d.tipo, d.folio, d.emitido_el,
         CASE WHEN ${COND_RECHAZADA} THEN 'rechazada' ELSE 'atrasada' END AS grupo,
         d.intentos, d.ultimo_error, d.detalle_sii,
         e.estado_sii AS envio_estado_sii, e.ultimo_error AS envio_ultimo_error,
         t.eliminado_el IS NOT NULL AS tenant_dado_de_baja
    FROM dte_documentos d
    JOIN tenants t ON t.tenant_id = d.tenant_id
    LEFT JOIN razones_sociales rs ON rs.razon_social_id = d.razon_social_id AND rs.eliminado_el IS NULL
    LEFT JOIN dte_envios e ON e.envio_id = d.envio_id AND e.eliminado_el IS NULL
   WHERE d.eliminado_el IS NULL AND ${COND_CON_PROBLEMAS}
   ORDER BY d.emitido_el, d.folio
   LIMIT 200`;

/**
 * La cola de envío de boletas al SII. `encolar` guarda la boleta ya firmada como `pendiente`;
 * quien la manda al SII es el job de envío.
 */
@Injectable()
export class ColaDteService {
  constructor(
    private readonly db: Db,
    private readonly tx: TxContext,
  ) {}

  /**
   * Guarda la boleta firmada en la cola. Se llama dentro de `db.transaccion`, la de la venta:
   * el folio, la boleta y la venta se confirman juntos o ninguno (una boleta sin venta, o una
   * venta sin boleta, son un folio perdido ante el SII).
   */
  async encolar(
    tenantId: string,
    boleta: BoletaEmitida,
    cafId: string,
  ): Promise<{ documentoId: string }> {
    if (!this.tx.managerActivo()) {
      throw new Error(
        'encolar corre dentro de db.transaccion: fuera de una, la boleta queda en la cola aunque la venta falle',
      );
    }
    const rutBoleta = normalizarRut(boleta.rutEmisor);
    const [fila] = unwrap<{
      rut_emisor: string;
      documento_id: string | null;
    }>(
      await this.db.query(ENCOLAR, [
        tenantId,
        cafId,
        boleta.tipo,
        boleta.folio,
        rutBoleta,
        boleta.xml,
      ]),
    );
    if (!fila)
      throw new DteError(
        'SIN_FOLIOS',
        'No se encontró el archivo de folios (CAF) con el que se tomó el folio',
      );
    if (!fila.documento_id)
      throw new DteError(
        'ENVIO_OTRO_EMISOR',
        `La boleta es del RUT ${rutBoleta}, pero su archivo de folios es del RUT ${normalizarRut(fila.rut_emisor)}`,
      );
    return { documentoId: fila.documento_id };
  }

  /** Las boletas atrasadas o rechazadas de todos los tenants, para el panel de soporte. */
  async problemasDeTodos(): Promise<BoletaConProblemaSoporte[]> {
    const filas = unwrap<FilaProblemaSoporte>(
      await this.db.query(PROBLEMAS_DE_TODOS),
    );
    return filas.map((f) => ({
      documentoId: f.documento_id,
      tenantId: f.tenant_id,
      tenant: f.tenant,
      razonSocial: f.razon_social,
      ambiente: f.ambiente,
      tipo: f.tipo,
      folio: f.folio,
      emitidaEl: f.emitido_el,
      grupo: f.grupo,
      intentos: f.intentos,
      ultimoError: f.ultimo_error,
      detalleSii: f.detalle_sii,
      envioEstadoSii: f.envio_estado_sii,
      envioUltimoError: f.envio_ultimo_error,
      tenantDadoDeBaja: f.tenant_dado_de_baja,
    }));
  }
}
