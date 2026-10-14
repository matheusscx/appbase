import { Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarRut } from '../../common/utils/rut.util';
import { DteError } from './dte.types';
import type { BoletaEmitida } from './envio-boleta';

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
}
