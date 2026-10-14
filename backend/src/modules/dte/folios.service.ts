import { Injectable } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarRut } from '../../common/utils/rut.util';
import { leerCaf, type CafLeido } from './caf';
import { CifradoDteService } from './cifrado-dte.service';
import { DteError, type EmisorBoleta, type TipoBoleta } from './dte.types';
import type { CaratulaEnvio } from './envio-boleta';
import type { CertificadoLeido } from './firma';
import { vacio } from './perfil-fiscal';

/** El SII es siempre quien recibe el envío de boletas. */
const RUT_SII = '60803000-K';

// El CAF de menor rango que todavía tiene folios, de la razón social emisora y su ambiente.
// Corre en la transacción de quien lo pide: si la venta se cae, el rollback devuelve el folio
// (una secuencia de Postgres no lo devuelve, y cada hueco es un folio que se anula ante el SII).
const TOMAR_FOLIO = `
  UPDATE dte_cafs c
     SET siguiente_folio = c.siguiente_folio + 1, actualizado_el = now()
   WHERE c.caf_id = (
     SELECT f.caf_id
       FROM dte_cafs f
       JOIN razones_sociales rs
         ON rs.razon_social_id = f.razon_social_id AND rs.eliminado_el IS NULL
      WHERE f.tenant_id = $1 AND f.tipo = $2 AND f.eliminado_el IS NULL
        AND rs.preferida AND rs.habilitado
        AND f.ambiente = rs.ambiente_sii
        AND f.siguiente_folio <= f.hasta
      ORDER BY f.desde
      LIMIT 1
      FOR UPDATE OF f)
  RETURNING c.caf_id, c.siguiente_folio - 1 AS folio`;

interface FilaCafYEmisor {
  xml_cifrado: string;
  caf_ambiente: string;
  nombre: string;
  rut: string;
  direccion: string | null;
  giro: string | null;
  comuna: string | null;
  ambiente_sii: string | null;
  fecha_resolucion: string | null;
  numero_resolucion: number | null;
  razon_social_id: string;
}

interface CredencialesParaFirmar {
  caf: CafLeido;
  certificado: CertificadoLeido;
  emisor: EmisorBoleta;
  caratula: CaratulaEnvio;
}

/**
 * Entrega los folios de los CAF cargados (uno por boleta, sin repetir ni saltear) y lo que el
 * motor necesita para firmar con ellos.
 */
@Injectable()
export class FoliosService {
  constructor(
    private readonly db: Db,
    private readonly tx: TxContext,
    private readonly cifrado: CifradoDteService,
  ) {}

  /**
   * Toma el próximo folio libre del tipo, del CAF de menor rango de la razón social emisora (la
   * preferida) y su ambiente. Se llama dentro de `db.transaccion`, la de la venta: si la venta
   * se cae, el rollback devuelve el folio y no queda un hueco.
   */
  async tomarFolio(
    tenantId: string,
    tipo: TipoBoleta,
  ): Promise<{ cafId: string; folio: number }> {
    if (!this.tx.managerActivo()) {
      throw new Error(
        'tomarFolio corre dentro de db.transaccion: fuera de una, el folio se consume aunque la venta falle',
      );
    }
    // Dos intentos. Si otra caja agota este CAF mientras esperamos su bloqueo, la fila deja de
    // cumplir el WHERE al re-evaluarse y Postgres salta al siguiente CAF que veía su foto. Pero
    // esa foto es la del inicio de la sentencia: un CAF que se cargó mientras esperábamos no está
    // en ella, y la sentencia sale vacía aunque ya haya folios. La segunda toma una foto nueva y
    // lo ve.
    for (let intento = 0; intento < 2; intento++) {
      const [fila] = unwrap<{ caf_id: string; folio: number }>(
        await this.db.query(TOMAR_FOLIO, [tenantId, tipo]),
      );
      if (fila) return { cafId: fila.caf_id, folio: fila.folio };
    }
    throw new DteError(
      'SIN_FOLIOS',
      `No quedan folios de tipo ${tipo.toString()} cargados`,
    );
  }

  /**
   * Descifra lo que el motor necesita para emitir con el CAF que entregó `tomarFolio`: el CAF, el
   * certificado vigente de su razón social y los datos del emisor y de la carátula. Un dato que
   * falta sale como `DteError` con el motivo, para decirle al dueño del local qué completar.
   */
  async credencialesParaFirmar(
    tenantId: string,
    cafId: string,
    ahora: Date,
  ): Promise<CredencialesParaFirmar> {
    const [fila] = await this.db.query<FilaCafYEmisor[]>(
      `SELECT f.xml_cifrado, f.ambiente AS caf_ambiente, rs.razon_social_id, rs.nombre, rs.rut, rs.direccion, rs.giro,
              rs.comuna, rs.ambiente_sii,
              to_char(rs.fecha_resolucion, 'YYYY-MM-DD') AS fecha_resolucion,
              rs.numero_resolucion
         FROM dte_cafs f
         JOIN razones_sociales rs
           ON rs.razon_social_id = f.razon_social_id AND rs.eliminado_el IS NULL
        WHERE f.caf_id = $2 AND f.tenant_id = $1 AND f.eliminado_el IS NULL`,
      [tenantId, cafId],
    );
    if (!fila)
      throw new DteError(
        'SIN_FOLIOS',
        'No se encontró el archivo de folios (CAF) con el que se tomó el folio',
      );

    const incompleto = (campo: string) =>
      new DteError(
        'PERFIL_INCOMPLETO',
        `Falta completar ${campo} en el perfil fiscal para poder emitir`,
      );
    if (vacio(fila.giro)) throw incompleto('el giro');
    if (vacio(fila.comuna)) throw incompleto('la comuna');
    if (vacio(fila.direccion)) throw incompleto('la dirección');
    if (!fila.ambiente_sii)
      throw incompleto('el ambiente (certificación o producción)');
    if (!fila.fecha_resolucion)
      throw incompleto('la fecha de la resolución del SII');
    if (fila.numero_resolucion === null)
      throw incompleto('el número de la resolución del SII');
    // `tomarFolio` bloquea solo el CAF: el ambiente de la razón social puede cambiar (y
    // confirmarse) antes de esta lectura. Firmar con el CAF del otro ambiente quemaría el folio.
    if (fila.caf_ambiente !== fila.ambiente_sii)
      throw new DteError(
        'AMBIENTE_DISTINTO',
        'La empresa cambió de ambiente mientras se tomaba el folio; vuelve a intentar',
      );

    const [cert] = await this.db.query<{ credencial_cifrada: string }[]>(
      `SELECT credencial_cifrada
         FROM dte_certificados
        WHERE razon_social_id = $1 AND tenant_id = $2 AND reemplazado_el IS NULL
          AND eliminado_el IS NULL AND credencial_cifrada IS NOT NULL`,
      [fila.razon_social_id, tenantId],
    );
    if (!cert)
      throw new DteError(
        'SIN_CERTIFICADO',
        'Falta subir el certificado digital para poder emitir',
      );
    const guardado = JSON.parse(
      this.cifrado.descifrar(cert.credencial_cifrada),
    ) as Omit<CertificadoLeido, 'venceEl'> & { venceEl: string };
    const certificado: CertificadoLeido = {
      ...guardado,
      venceEl: new Date(guardado.venceEl),
    };
    if (certificado.venceEl <= ahora)
      throw new DteError(
        'CERTIFICADO_VENCIDO',
        'El certificado digital está vencido; sube uno vigente para poder emitir',
      );

    const rutEmisor = normalizarRut(fila.rut);
    return {
      caf: leerCaf(this.cifrado.descifrar(fila.xml_cifrado)),
      certificado,
      emisor: {
        rut: rutEmisor,
        razonSocial: fila.nombre,
        giro: fila.giro,
        direccion: fila.direccion,
        comuna: fila.comuna,
      },
      caratula: {
        rutEmisor,
        rutReceptor: RUT_SII,
        fchResol: fila.fecha_resolucion,
        nroResol: fila.numero_resolucion,
      },
    };
  }
}
