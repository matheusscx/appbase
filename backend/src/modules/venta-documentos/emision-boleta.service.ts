import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { TxContext } from '../../common/db/tx-context';
import {
  type CodigoDteError,
  DteError,
  type MedioPagoSii,
  type TipoBoleta,
} from '../dte/dte.types';
import { ColaDteService } from '../dte/cola-dte.service';
import { emitirBoleta } from '../dte/envio-boleta';
import { FoliosService } from '../dte/folios.service';
import { ahoraChile } from '../dte/perfil-fiscal';
import { PerfilFiscalService } from '../dte/perfil-fiscal.service';
import type { VentaDocumento } from './entities/venta-documento.entity';
import {
  datosBoletaDeVenta,
  grupoDelError,
  tipoBoletaDe,
  type GrupoErrorEmision,
  type LineaParaBoleta,
  type VentaParaBoleta,
} from './boleta-de-venta';

/** Qué pasó al intentar emitir la boleta de un documento (spec § 4.1, § 4.4). */
export type ResultadoEmision =
  | { estado: 'emitido'; folio: number; tipo: TipoBoleta }
  | { estado: 'sin_emitir'; codigo: CodigoDteError; mensaje: string }
  /** El documento ya no está por emitir (se emitió, se anuló, se descartó): no se hizo nada. */
  | { estado: 'omitido' };

/** Lo que responde `POST /dte/emitir-pendientes` (spec § 5). */
export interface ResultadoEmitirPendientes {
  emitidas: number;
  /** Cuántas siguen `sin_emitir` al terminar (también las que esta llamada no alcanzó). */
  pendientes: number;
  errores: { ventaId: string; codigo: string; mensaje: string }[];
}

/** Una fila de `GET /dte/boletas-sin-emitir` (spec § 4.5). */
export interface BoletaSinEmitirListada {
  ventaId: string;
  fecha: Date;
  monto: string;
  codigo: string;
  mensaje: string;
  grupo: GrupoErrorEmision;
}

/** Lo que responde `GET /dte/estado-emision` (spec § 8.1). */
export interface EstadoEmision {
  activa: boolean;
  avisos: {
    codigo: 'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER';
    mensaje: string;
  }[];
  sinEmitir: number;
}

/** Tope de boletas por llamada del botón: una transacción cada una, no se cuelga una petición. */
const MAX_PENDIENTES_POR_LLAMADA = 200;

/** El nombre del savepoint: una constante, nunca un valor de entrada. */
const SAVEPOINT_EMISION = 'emision_boleta';

/**
 * El documento por emitir, su venta y el umbral de identidad, en una lectura. El documento se
 * bloquea (`FOR UPDATE OF d`): dos emisiones del mismo documento no pueden tomar dos folios.
 *
 * El umbral es el de `UMBRAL_IDENTIDAD_SQL` (`ventas.service.ts`), con una diferencia
 * deliberada: el año es el de la VENTA y no el de hoy. Una boleta que se emite en enero por una
 * venta de diciembre usa el umbral de diciembre (spec § 4.3). Es gemelo y no el mismo texto
 * porque ese módulo importa a este: si cambia la regla de "sin fila del año rige la anterior",
 * cambian los dos.
 */
const LEER_DOCUMENTO_Y_VENTA = `
  SELECT d.documento_id, d.emisor, d.estado_envio, d.descarte,
         d.monto, d.monto_afecto, d.monto_exento, d.monto_impuestos,
         td.es_boleta,
         v.venta_id, v.creado_el, v.total_final, p.pais_id,
         (d.monto = v.total_final) AS cubre_todo,
         (SELECT u.monto
            FROM umbral_identidad_pagador u
           WHERE u.pais_id = p.pais_id AND u.eliminado_el IS NULL
             AND u.anio <= EXTRACT(YEAR FROM v.creado_el AT TIME ZONE prov.zona_horaria)
           ORDER BY u.anio DESC
           LIMIT 1) AS umbral_identidad
    FROM venta_documentos d
    -- Todo lo que cuelga del documento va en LEFT JOIN: si la venta o su país no se encuentran
    -- la fila llega con esas columnas en nulo y \`emitirDentro\` lo trata como un error, no como
    -- "documento que ya no está por emitir".
    LEFT JOIN ventas v ON v.venta_id = d.venta_id AND v.tenant_id = d.tenant_id
              AND v.eliminado_el IS NULL
    LEFT JOIN tenants t ON t.tenant_id = d.tenant_id AND t.eliminado_el IS NULL
    LEFT JOIN provincia prov ON prov.provincia_id = t.provincia_id AND prov.eliminado_el IS NULL
    LEFT JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
    -- Sin filtro de baja en el tipo: el tipo con que nació la venta está congelado en el
    -- documento, y darlo de baja después no lo convierte en otra cosa.
    LEFT JOIN tipos_documento_tributario td ON td.tipo_documento_id = d.tipo_documento_id
   WHERE d.documento_id = $1 AND d.tenant_id = $2 AND d.eliminado_el IS NULL
     FOR UPDATE OF d`;

// Las líneas con la tasa de IVA que cada una pagó, en UNA consulta. La tasa es la suma de los
// `porcentaje_aplicado` de sus `ventas_impuestos` cuyo impuesto es de tipo `iva` (0 en una
// exenta). El JOIN a `impuestos` NO filtra `eliminado_el`: un impuesto borrado después de la
// venta no cambia lo que la venta cobró, y sin la fila la línea perdería su IVA y la boleta
// saldría con un descuento que nunca existió.
const LEER_LINEAS = `
  SELECT d.descripcion, d.cantidad, d.subtotal, d.total_linea,
         (d.clasificacion_tributaria = 'exento') AS exenta,
         COALESCE(iva.tasa, 0) AS tasa_iva
    FROM venta_detalles d
    LEFT JOIN (
      SELECT vi.detalle_id, SUM(COALESCE(vi.porcentaje_aplicado, 0)) AS tasa
        FROM ventas_impuestos vi
        -- Sin filtro de baja en impuestos: un impuesto borrado después de la venta no
        -- cambia lo que la venta cobró (la línea perdería su IVA y saldría con un recargo).
        JOIN impuestos i ON i.impuesto_id = vi.impuesto_id
       WHERE vi.venta_id = $1 AND vi.eliminado_el IS NULL AND i.tipo = 'iva'
       GROUP BY vi.detalle_id
    ) iva ON iva.detalle_id = d.detalle_id
   WHERE d.venta_id = $1 AND d.eliminado_el IS NULL
   ORDER BY d.creado_el, d.detalle_id`;

// La suma de los impuestos de la venta que no son IVA (el ILA): la boleta no los informa, y el
// motor la rechaza si es mayor que cero. Mismo JOIN sin `eliminado_el` que arriba, por lo mismo.
const LEER_ADICIONALES = `
  SELECT COALESCE(SUM(vi.valor_aplicado), 0) AS adicionales
    FROM ventas_impuestos vi
    -- Sin filtro de baja en impuestos: lo que la venta cobró no cambia porque se borre la regla.
    JOIN impuestos i ON i.impuesto_id = vi.impuesto_id
   WHERE vi.venta_id = $1 AND vi.eliminado_el IS NULL AND i.tipo <> 'iva'`;

// Las boletas por emitir de un tenant: el predicado del índice parcial
// `idx_venta_documentos_sin_emitir` más la venta viva. La venta se une para que la lista, el
// conteo y el botón vean lo mismo: un documento cuya venta ya no existe no se puede emitir
// (`emitir` lo trata como un error de datos) y tampoco se ofrece.
const SIN_EMITIR_DEL_TENANT = `
    FROM venta_documentos d
    JOIN ventas v ON v.venta_id = d.venta_id AND v.tenant_id = d.tenant_id
                 AND v.eliminado_el IS NULL
   WHERE d.tenant_id = $1 AND d.estado_envio = 'sin_emitir'
     AND d.descarte IS NULL AND d.eliminado_el IS NULL`;

const LEER_SIN_EMITIR = `
  SELECT d.documento_id, d.venta_id, d.monto, v.creado_el AS fecha,
         d.emision_error_codigo, d.emision_error
  ${SIN_EMITIR_DEL_TENANT}
   ORDER BY d.creado_el, d.documento_id
   LIMIT ${MAX_PENDIENTES_POR_LLAMADA.toString()}`;

const LEER_INTERRUPTOR = `
  SELECT emite_boleta_electronica AS emite FROM tenants
   WHERE tenant_id = $1 AND eliminado_el IS NULL`;

const CONTAR_SIN_EMITIR = `SELECT count(*)::int AS n ${SIN_EMITIR_DEL_TENANT}`;

// El bloqueo de la venta que toma `VentasService.lockVentaOriginal` (anular, la nota de crédito y
// el PATCH del número). Es un duplicado deliberado de ese SQL: este módulo no puede importar a
// `VentasService` (ventas importa a venta-documentos). Si cambia el bloqueo allá, cambia acá.
const BLOQUEAR_VENTA = `
  SELECT venta_id FROM ventas
   WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
     FOR UPDATE`;

const LEER_RECEPTOR = `
  SELECT nombre, rut, email, telefono
    FROM venta_customer
   WHERE venta_id = $1 AND eliminado_el IS NULL
   ORDER BY creado_el
   LIMIT 1`;

// Los pagos que cubre ESE documento (`pagos.documento_id`), con lo que cada uno aplicó a la
// venta (sin propina ni vuelto) y su código del SII. El medio de pago se une sin `eliminado_el`:
// que el local dé de baja un medio después no cambia con qué se pagó.
const LEER_PAGOS = `
  SELECT pa.monto, mp.medio_pago_sii
    FROM (
      SELECT p.pago_id, p.metodo_pago_id, p.creado_el, SUM(a.monto) AS monto
        FROM pagos p
        JOIN pago_aplicaciones a ON a.pago_id = p.pago_id AND a.tipo = 'venta'
             AND a.tenant_id = p.tenant_id AND a.eliminado_el IS NULL
       WHERE p.documento_id = $1 AND p.tenant_id = $2 AND p.eliminado_el IS NULL
       GROUP BY p.pago_id, p.metodo_pago_id, p.creado_el
    ) pa
    -- Sin filtro de baja en metodos_pago: dar de baja un medio después no cambia con qué se pagó.
    LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = pa.metodo_pago_id
   ORDER BY pa.creado_el, pa.pago_id`;

interface FilaDocumentoYVenta {
  documento_id: string;
  emisor: string;
  estado_envio: string | null;
  descarte: string | null;
  monto: string;
  monto_afecto: string | null;
  monto_exento: string | null;
  monto_impuestos: string | null;
  es_boleta: boolean | null;
  // Nulos si la venta o su país no se encontraron (ver `LEER_DOCUMENTO_Y_VENTA`).
  venta_id: string | null;
  creado_el: Date | null;
  total_final: string | null;
  pais_id: string | null;
  cubre_todo: boolean | null;
  umbral_identidad: string | null;
}

interface FilaLinea {
  descripcion: string | null;
  cantidad: string;
  subtotal: string;
  total_linea: string;
  exenta: boolean;
  tasa_iva: string;
}

const MEDIOS_PAGO_SII: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Emite la boleta electrónica de una venta (spec `2026-10-14-boleta-desde-la-venta`, § 4).
 * Una sola función emite: la venta al crearse y el botón "emitir pendientes" la llaman, así que
 * no hay un segundo camino que pueda armar otra boleta.
 */
@Injectable()
export class EmisionBoletaService {
  constructor(
    private readonly db: Db,
    private readonly tx: TxContext,
    private readonly folios: FoliosService,
    private readonly cola: ColaDteService,
    private readonly perfil: PerfilFiscalService,
  ) {}

  /**
   * El documento de la venta que el sistema debe emitir como boleta: el del emisor `sistema`,
   * con tipo de documento de boleta, vigente y que no sea un duplicado. A lo sumo uno (ADR-028);
   * dos contradicen esa regla y es un error nuestro, no algo que se elija a gusto. Pura.
   */
  documentoAEmitir(
    documentos: VentaDocumento[],
    tipoEsBoleta: boolean,
  ): VentaDocumento | null {
    if (!tipoEsBoleta) return null;
    const candidatos = documentos.filter(
      (d) =>
        d.emisor === 'sistema' &&
        d.tipoDocumentoId !== null &&
        d.descarte === null &&
        !d.esDuplicado,
    );
    if (candidatos.length > 1)
      throw new Error(
        `La venta tiene ${candidatos.length.toString()} documentos del sistema por emitir como boleta: ADR-028 admite uno`,
      );
    return candidatos[0] ?? null;
  }

  /**
   * Emite la boleta del documento detrás de un savepoint. Un `DteError` (sin folios, certificado
   * vencido, un dato que el motor rechaza) deshace la emisión, deja el documento `sin_emitir`
   * con el motivo y NO propaga: la venta entra igual (decisión del owner). Cualquier otro error
   * se propaga y la venta se cae, como hoy (regla R9 de la cola).
   *
   * Se llama dentro de `db.transaccion`, la de la venta: el folio, la boleta en la cola y el
   * estado del documento se confirman con ella o no se confirma nada. El bloqueo del CAF que
   * toma `tomarFolio` dura hasta el commit, así que esta llamada va LAST en la transacción: nada
   * que se bloquee después puede formar un ciclo con él (spec § 4.6).
   */
  async emitir(
    tenantId: string,
    ventaDocumentoId: string,
    ahora: Date,
  ): Promise<ResultadoEmision> {
    if (!this.tx.managerActivo()) {
      throw new Error(
        'emitir corre dentro de db.transaccion: fuera de una, el folio se consume aunque la venta falle',
      );
    }
    try {
      return await this.db.conSavepoint(SAVEPOINT_EMISION, () =>
        this.emitirDentro(tenantId, ventaDocumentoId, ahora),
      );
    } catch (e) {
      if (!(e instanceof DteError)) throw e;
      // Ya volvió al savepoint: la transacción está sana y esto sí se puede escribir. El
      // `estado_envio` del WHERE cubre la ventana en que el rollback soltó el bloqueo del
      // documento y otra emisión pudo ganarle: nunca se pisa un `emitido`.
      await this.db.query(
        `UPDATE venta_documentos
            SET estado_envio = 'sin_emitir', emision_error_codigo = $3,
                emision_error = $4, actualizado_el = now()
          WHERE documento_id = $1 AND tenant_id = $2
            AND estado_envio IN ('armado', 'sin_emitir') AND eliminado_el IS NULL`,
        [ventaDocumentoId, tenantId, e.codigo, e.message],
      );
      return { estado: 'sin_emitir', codigo: e.codigo, mensaje: e.message };
    }
  }

  /**
   * El botón "emitir pendientes" (spec § 5): las boletas `sin_emitir` del tenant, de la más
   * vieja a la más nueva, hasta 200. Cada una va en SU transacción —un fallo no deshace las que
   * ya salieron— y primero toma el bloqueo de su venta, el mismo orden que la venta (venta y
   * después CAF), así que una anulación en paralelo o espera o ya ganó: `emitir` vuelve a mirar
   * el documento bajo bloqueo y, si se descartó, lo omite.
   *
   * Un error del grupo del perfil (`SIN_FOLIOS`, certificado…) corta: las que siguen fallarían
   * igual. Uno de la boleta (un impuesto adicional, un texto) se anota y sigue. Cualquier error
   * que no sea de la emisión se propaga (R9 de la cola): las ya emitidas quedaron confirmadas.
   *
   * Procesar de a una es escritura de N filas, no una lectura N+1: la lista sale de una consulta.
   */
  async emitirPendientes(
    tenantId: string,
    ahora: Date,
  ): Promise<ResultadoEmitirPendientes> {
    const lista = await this.db.query<
      { documento_id: string; venta_id: string }[]
    >(LEER_SIN_EMITIR, [tenantId]);
    let emitidas = 0;
    const errores: ResultadoEmitirPendientes['errores'] = [];
    for (const pendiente of lista) {
      const r = await this.db.transaccion(
        async (): Promise<ResultadoEmision> => {
          const venta = await this.db.query<{ venta_id: string }[]>(
            BLOQUEAR_VENTA,
            [pendiente.venta_id, tenantId],
          );
          if (venta.length === 0) return { estado: 'omitido' };
          return this.emitir(tenantId, pendiente.documento_id, ahora);
        },
      );
      if (r.estado === 'emitido') emitidas++;
      if (r.estado !== 'sin_emitir') continue;
      errores.push({
        ventaId: pendiente.venta_id,
        codigo: r.codigo,
        mensaje: r.mensaje,
      });
      if (grupoDelError(r.codigo) === 'perfil') break;
    }
    return {
      emitidas,
      pendientes: await this.contarSinEmitir(tenantId),
      errores,
    };
  }

  /** Las boletas por emitir con su motivo, para la pantalla del admin: UNA consulta (spec § 4.5). */
  async sinEmitir(tenantId: string): Promise<BoletaSinEmitirListada[]> {
    const filas = await this.db.query<
      {
        venta_id: string;
        monto: string;
        fecha: Date;
        emision_error_codigo: string | null;
        emision_error: string | null;
      }[]
    >(LEER_SIN_EMITIR, [tenantId]);
    return filas.map((f) => {
      // Un `sin_emitir` siempre trae su motivo (lo escribe `emitir`); si faltara, el código
      // desconocido cae en el grupo de la boleta y no corta nada.
      const codigo = (f.emision_error_codigo ??
        'DESCONOCIDO') as CodigoDteError;
      return {
        ventaId: f.venta_id,
        fecha: f.fecha,
        monto: f.monto,
        codigo,
        mensaje: f.emision_error ?? '',
        grupo: grupoDelError(codigo),
      };
    });
  }

  /**
   * Lo que ve el cajero (spec § 8.1): si el local emite, los avisos del perfil y cuántas boletas
   * siguen sin emitir. El POS lo lee tras cada cobro, así que con la emisión apagada es UNA
   * consulta (el interruptor) y no se arma el perfil. Prendida: el interruptor, el perfil
   * (cuatro) y un `count`; fijas, sin importar cuántos CAF haya. Solo devuelve los mensajes de
   * los avisos: nada del emisor ni del certificado.
   */
  async estadoEmision(tenantId: string, ahora: Date): Promise<EstadoEmision> {
    const [tenant] = await this.db.query<{ emite: boolean }[]>(
      LEER_INTERRUPTOR,
      [tenantId],
    );
    if (!tenant?.emite) return { activa: false, avisos: [], sinEmitir: 0 };
    const perfil = await this.perfil.obtener(tenantId, ahora);
    return {
      activa: true,
      avisos: perfil.avisos.map((a) => ({
        codigo: a.codigo,
        mensaje: a.mensaje,
      })),
      sinEmitir: await this.contarSinEmitir(tenantId),
    };
  }

  private async contarSinEmitir(tenantId: string): Promise<number> {
    const [fila] = await this.db.query<{ n: number }[]>(CONTAR_SIN_EMITIR, [
      tenantId,
    ]);
    return fila?.n ?? 0;
  }

  private async emitirDentro(
    tenantId: string,
    ventaDocumentoId: string,
    ahora: Date,
  ): Promise<ResultadoEmision> {
    const [fila] = await this.db.query<FilaDocumentoYVenta[]>(
      LEER_DOCUMENTO_Y_VENTA,
      [ventaDocumentoId, tenantId],
    );
    // `omitido` es solo "este documento ya no está por emitir": entre la lista del botón y el
    // bloqueo pudo emitirse, anularse o descartarse. No hay nada que hacer y no es un error.
    if (!fila) return { estado: 'omitido' };
    if (
      fila.descarte !== null ||
      (fila.estado_envio !== 'armado' && fila.estado_envio !== 'sin_emitir')
    )
      return { estado: 'omitido' };

    // Desde acá el documento SÍ está por emitir: que falte algo de su contexto, o que no sea
    // una boleta del sistema, es un bug de quien lo pidió o del dato, y no se disfraza de
    // `omitido` (el botón lo daría por "ya emitida" y la boleta quedaría sin salir en silencio).
    // Tampoco es un `DteError`: no es un dato de la boleta que el local pueda arreglar.
    if (
      fila.venta_id === null ||
      fila.creado_el === null ||
      fila.total_final === null ||
      fila.cubre_todo === null ||
      fila.pais_id === null
    )
      throw new Error(
        `No se encontró la venta, el comercio o el país del documento ${ventaDocumentoId}: no se puede emitir su boleta`,
      );
    if (fila.es_boleta === null)
      throw new Error(
        `El documento ${ventaDocumentoId} apunta a un tipo de documento que no existe`,
      );
    if (fila.emisor !== 'sistema' || !fila.es_boleta)
      throw new Error(
        `El documento ${ventaDocumentoId} no es una boleta del sistema: no se emite con EmisionBoletaService`,
      );

    const venta = await this.leerVenta(tenantId, ventaDocumentoId, {
      ...fila,
      venta_id: fila.venta_id,
      creado_el: fila.creado_el,
      total_final: fila.total_final,
      cubre_todo: fila.cubre_todo,
    });
    const tipo = tipoBoletaDe(venta);
    const { cafId, folio } = await this.folios.tomarFolio(tenantId, tipo);
    const cred = await this.folios.credencialesParaFirmar(
      tenantId,
      cafId,
      ahora,
    );
    const proveedor = this.perfil.proveedorSoftware();
    if (!proveedor)
      throw new DteError(
        'PERFIL_INCOMPLETO',
        'Falta el proveedor de software en la configuración del sistema',
      );

    const boleta = emitirBoleta(
      datosBoletaDeVenta(venta, folio, cred.emisor, proveedor),
      cred,
      ahoraChile(ahora),
    );
    const { documentoId } = await this.cola.encolar(tenantId, boleta, cafId);
    await this.db.query(
      `UPDATE venta_documentos
          SET estado_envio = 'emitido', dte_documento_id = $3,
              emision_error_codigo = NULL, emision_error = NULL, actualizado_el = now()
        WHERE documento_id = $1 AND tenant_id = $2`,
      [ventaDocumentoId, tenantId, documentoId],
    );
    return { estado: 'emitido', folio, tipo };
  }

  /** Lo que la boleta necesita de la venta, en consultas fijas (ninguna por línea ni por pago). */
  private async leerVenta(
    tenantId: string,
    ventaDocumentoId: string,
    fila: FilaDocumentoYVenta & {
      venta_id: string;
      creado_el: Date;
      total_final: string;
      cubre_todo: boolean;
    },
  ): Promise<VentaParaBoleta> {
    const lineas = await this.db.query<FilaLinea[]>(LEER_LINEAS, [
      fila.venta_id,
    ]);
    const [adicionales] = await this.db.query<{ adicionales: string }[]>(
      LEER_ADICIONALES,
      [fila.venta_id],
    );
    const [receptor] = await this.db.query<
      {
        nombre: string | null;
        rut: string | null;
        email: string | null;
        telefono: string | null;
      }[]
    >(LEER_RECEPTOR, [fila.venta_id]);
    const pagos = await this.db.query<
      { monto: string; medio_pago_sii: number | null }[]
    >(LEER_PAGOS, [ventaDocumentoId, tenantId]);

    return {
      // `AAAA-MM-DD` del día de Chile en que cayó la venta, también si se emite después.
      fechaVenta: ahoraChile(fila.creado_el).slice(0, 10),
      lineas: lineas.map(
        (l): LineaParaBoleta => ({
          descripcion: l.descripcion,
          cantidad: l.cantidad,
          subtotal: l.subtotal,
          totalLinea: l.total_linea,
          exenta: l.exenta,
          tasaIva: l.tasa_iva,
        }),
      ),
      documento: {
        monto: fila.monto,
        // Un documento del sistema nace con sus baldes (ADR-028); el CHECK de nulos no existe,
        // así que se afirma acá en vez de emitir con un '0' inventado.
        montoAfecto: baldeObligatorio(fila.monto_afecto, 'monto_afecto'),
        montoExento: baldeObligatorio(fila.monto_exento, 'monto_exento'),
        montoImpuestos: baldeObligatorio(
          fila.monto_impuestos,
          'monto_impuestos',
        ),
        cubreTodo: fila.cubre_todo,
      },
      adicionales: adicionales?.adicionales ?? '0',
      receptor: receptor?.rut
        ? {
            rut: receptor.rut,
            nombre: receptor.nombre,
            correo: receptor.email,
            telefono: receptor.telefono,
          }
        : null,
      // Estricto, como la regla del cobro: la norma dice "exceda".
      superaUmbral:
        fila.umbral_identidad !== null &&
        new Decimal(fila.total_final).gt(fila.umbral_identidad),
      pagos: pagos.map((p) => ({
        monto: p.monto,
        medioPagoSii: medioPagoSiiDe(p.medio_pago_sii),
      })),
    };
  }
}

function baldeObligatorio(valor: string | null, columna: string): string {
  if (valor === null)
    throw new Error(
      `El documento del sistema no tiene ${columna}: se congela al crearlo (ADR-028)`,
    );
  return valor;
}

function medioPagoSiiDe(codigo: number | null): MedioPagoSii | null {
  return codigo !== null && MEDIOS_PAGO_SII.includes(codigo)
    ? (codigo as MedioPagoSii)
    : null;
}
