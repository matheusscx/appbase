import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import type { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import {
  cuantizar,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';
import {
  CFG_SIN_CONGELAR,
  descomponer,
  repartirAjuste,
  tasaEfectiva,
  type PorcionOriginal,
} from '../ventas/nota-credito-composicion';
import type { EmisorMedio } from '../metodos-pago/entities/tenant-metodo-pago.entity';
import type { Facturador } from '../tenants/entities/tenant.entity';
import {
  VentaDocumento,
  type ClaseDocumentoMaquina,
  type Descarte,
  type EmisorDocumento,
  type EstadoEnvio,
} from './entities/venta-documento.entity';

const ZERO = new Decimal(0);
/** Las mismas reglas que `numeroDocumento` en los DTO de cobro y de `CompletarDocumentoDto`. */
const NUMERO_MAX = 40;
// eslint-disable-next-line no-control-regex
const CARACTERES_DE_CONTROL = /[\u0000-\u001F\u007F]/;

/**
 * Los baldes congelados de un documento que cubre `monto` de una venta: neto
 * afecto, neto exento y la suma de **todos** los impuestos (una sola columna:
 * es lo que congelan `ventas.total_impuestos` y `venta_detalles.impuesto_aplicado`).
 * `montoAfecto + montoExento + montoImpuestos = monto`, exacto.
 *
 * Con el total de la venta reproduce sus baldes; con una parte reparte a
 * prorrata de las porciones afecta y exenta, con el mismo reparto y el mismo
 * cuantizador que la NC por monto (`nota-credito-composicion.ts`). El residuo
 * de cuantizar de una serie de documentos es el mismo que ADR-010 anota para
 * una serie de NC. Un solo camino, sin rama para "cubre todo".
 *
 * El cuantizador **ignora `nivelRedondeo` a propósito**, como el de la NC: un
 * documento declara plata ya cobrada, que viene en la escala de la moneda.
 */
export function componerBaldes(
  monto: Decimal,
  porciones: PorcionOriginal[],
  cfg: ConfigCalculo | null,
): { montoAfecto: Decimal; montoExento: Decimal; montoImpuestos: Decimal } {
  const config = cfg ?? CFG_SIN_CONGELAR;
  const q = (d: Decimal) => cuantizar(d, config);
  // Ordenadas por clasificación: el desempate del reparto es por posición, y
  // sin un orden fijo el mismo monto repartiría distinto según cómo vinieron.
  const pesos = porciones
    .map((p) => ({
      clasificacion: p.clasificacion,
      peso: new Decimal(p.total),
    }))
    .sort((a, b) => a.clasificacion.localeCompare(b.clasificacion));

  let montoAfecto = ZERO;
  let montoExento = ZERO;
  let montoImpuestos = ZERO;
  for (const parte of repartirAjuste(monto, pesos, config, q)) {
    if (parte.clasificacion !== 'afecto' && parte.clasificacion !== 'exento') {
      throw new Error(
        `Clasificación tributaria desconocida al componer un documento: ${parte.clasificacion}`,
      );
    }
    const { subtotal, impuesto } = descomponer(
      parte.bruto,
      tasaEfectiva(porciones, parte.clasificacion),
      q,
    );
    if (parte.clasificacion === 'afecto')
      montoAfecto = montoAfecto.plus(subtotal);
    else montoExento = montoExento.plus(subtotal);
    montoImpuestos = montoImpuestos.plus(impuesto);
  }
  return { montoAfecto, montoExento, montoImpuestos };
}

export interface PagoParaDocumento {
  pagoId: string;
  metodoPagoId: string;
  emisor: EmisorMedio;
  /** `pago_aplicaciones.tipo = 'venta'` de ESE pago: sin propina ni vuelto. */
  aplicadoVenta: string;
  numeroDocumento?: string;
  claseDocumento?: ClaseDocumentoMaquina;
}

/** Un pago de un abono (`registrarAbono`), tal como lo devuelve `registrar` en `porPago`. */
export interface AbonoParaDuplicado {
  pagoId: string;
  metodoPagoId: string;
  emisor: EmisorMedio;
  /** `pago_aplicaciones.tipo = 'venta'` de ESE pago. */
  aplicadoVenta: string;
  numeroDocumento?: string;
  claseDocumento?: ClaseDocumentoMaquina;
}

export interface RegistrarDuplicadoParams {
  tenantId: string;
  ventaId: string;
  pagos: AbonoParaDuplicado[];
}

/**
 * Quien consulta: el `manager` de una transacción abierta, o el `Db` cuando el
 * llamador lee fuera de una (el detalle de la venta). Las dos puertas resuelven
 * `query` igual, y `Db` reusa la transacción en contexto si la hay (ADR-020).
 */
export type Lector = EntityManager | Db;

export interface VentaDeLosDocumentosParams {
  tenantId: string;
  ventaId: string;
}

export interface ListarParaDetalleParams extends VentaDeLosDocumentosParams {
  /** Acota a un documento (la respuesta del `PATCH`); sin él, todos. */
  documentoId?: string;
}

export interface CompletarNumeroParams {
  tenantId: string;
  documentoId: string;
  numero: string;
  /** Solo con un documento de la máquina. Ausente conserva la que había. */
  clase?: ClaseDocumentoMaquina;
}

/**
 * Un documento tal como lo muestra el detalle de la venta y como responde el
 * `PATCH`. `ventaId` dice a quién pertenece: la venta o una de sus
 * correcciones, y es la ruta con la que se completa su número.
 */
export interface DocumentoDetalle {
  id: string;
  ventaId: string;
  emisor: EmisorDocumento;
  tipoDocumento: { id: string; codigo: string | null; nombre: string } | null;
  claseMaquina: ClaseDocumentoMaquina | null;
  numero: string | null;
  estadoEnvio: EstadoEnvio | null;
  monto: string;
  pagoId: string | null;
  documentoCorregidoId: string | null;
  esDuplicado: boolean;
  descarte: Descarte | null;
  descartadoEl: Date | null;
  /** Nombre de quien descartó: en `afirmado_no_hecho`, quién afirmó que no estaba hecho (E10). */
  descartadoPorNombre: string | null;
}

export interface EvaluarAnulacionParams {
  tenantId: string;
  ventaId: string;
  /**
   * La respuesta del usuario a "¿ya hiciste esta factura en tu facturador?"
   * (E10). `undefined` (no contestó) y `false` (contestó que no) son dos
   * conductas distintas: no se colapsan con un default.
   */
  externoHecho?: boolean;
}

export interface DescartarAlAnularParams extends EvaluarAnulacionParams {
  /** El usuario del token: queda como quien afirmó el descarte. */
  usuarioId: string;
}

/**
 * El veredicto de anular una venta mirando lo **emitido** (spec § 3.5). Una sola
 * regla para `cancelarUnaVez` y para el `anulable` del detalle:
 * - `anulable`: se puede anular; `descartes` es lo que queda descartado en la
 *   misma transacción (los `sistema` solo armados y los `externo` contestados
 *   con "no");
 * - `bloqueada`: va por nota de crédito; `motivo` es el 400;
 * - `pregunta_externo`: hay un documento hecho por fuera y falta la respuesta;
 *   `motivo` es el 400 que la pide. La pantalla la pregunta y reintenta.
 */
export type EvaluacionAnulacion =
  | {
      resultado: 'anulable';
      descartes: { documentoId: string; descarte: Descarte }[];
    }
  | { resultado: 'bloqueada'; motivo: string }
  | { resultado: 'pregunta_externo'; motivo: string };

export const MOTIVO_ANULAR_CON_MAQUINA =
  'La venta tiene un documento emitido por la máquina de tarjeta: se revierte con una nota de crédito, no se anula.';
export const MOTIVO_ANULAR_CON_ENVIADO =
  'La venta tiene un documento ya enviado al SII: se revierte con una nota de crédito, no se anula.';
export const MOTIVO_EXTERNO_SIN_RESPUESTA =
  'Esta venta tiene un documento hecho por fuera: falta decir si ya lo hiciste en tu facturador.';
export const MOTIVO_EXTERNO_YA_HECHO =
  'Ya está hecho: se revierte con una nota de crédito, hecha por fuera y anotada con su número.';

/**
 * Por dónde vuelve la plata de una corrección (spec § 3.6). El cliente nunca
 * manda el documento: manda esto, y el servidor resuelve qué documento corrige.
 * - `pago`: uno de los pagos de la venta;
 * - `sin_plata`: no vuelve plata (solo si la venta tiene saldo): corrige lo debido;
 * - `pasarela`: el reembolso de una orden online (lo usa el hook de la pasarela).
 *   La plata ya volvió por el proveedor: no mueve caja y **no rechaza** (un hecho
 *   consumado se registra). Trae el único documento válido de la venta, o `null`
 *   si no hay uno solo: la corrección se emite entonces sin fila de documento.
 */
export type ViaCorreccion =
  | { tipo: 'pago'; pagoId: string }
  | { tipo: 'sin_plata' }
  | { tipo: 'pasarela'; documentoId: string | null };

/** Lo que una corrección deja registrado, para decírselo al usuario antes de confirmar. */
export type RegistroCorreccion =
  | 'nota_credito_sistema'
  | 'nota_maquina'
  | 'nota_externa'
  | 'devolucion_interna'
  /** La venta nunca tuvo documentos (país sin boleta sembrada): la nota de crédito de siempre. */
  | 'nota_credito';

/** El documento que una corrección corrige: lo que hace falta para escribir el suyo. */
export interface DocumentoCorregido {
  id: string;
  emisor: EmisorDocumento;
  monto: string;
}

/**
 * Dónde cae una corrección. `documento` es `null` solo si la venta nunca tuvo
 * documentos (país sin boleta: spec § 3.3 "no cambia"): la nota se emite como
 * siempre, sin fila de documento.
 */
export interface DestinoCorreccion {
  documento: DocumentoCorregido | null;
  /**
   * Con "no vuelve plata": lo que la venta todavía debe (ver `saldo` de
   * `corregibles`: total − lo aplicado − lo ya rebajado sin plata), que es el tope
   * de esa corrección. `null` con cualquier otra vía.
   */
  saldo: string | null;
  /** El pago elegido es en efectivo: la plata sale de la caja. */
  mueveCaja: boolean;
}

export interface DocumentoQueCorrigeParams extends VentaDeLosDocumentosParams {
  via: ViaCorreccion;
}

/**
 * Una opción de "¿Por dónde vuelve la plata?" tal como la publica el detalle de
 * la venta. Sale de la misma resolución que usa la nota al crearse, así que la
 * pantalla no replica la regla.
 */
export interface OpcionDevolucion {
  /** El pago a corregir; `null` en "No vuelve plata". */
  pagoId: string | null;
  sinPlata: boolean;
  /** Nombre del medio de pago; `null` en "No vuelve plata". */
  metodo: string | null;
  /** Lo que ese pago cubrió de la venta (sin propina ni vuelto), o el saldo en "No vuelve plata". */
  monto: string;
  /** La plata sale de la caja (el pago fue en efectivo). */
  mueveCaja: boolean;
  registro: RegistroCorreccion;
}

export interface TopeDelDocumentoParams {
  tenantId: string;
  documento: DocumentoCorregido;
  monto: string;
}

export interface DocumentarCorreccionParams {
  tenantId: string;
  correccionVentaId: string;
  corregido: DocumentoCorregido;
  /** El monto de la corrección (su `total_final`). */
  monto: string;
  /** El tipo NC del país; `null` solo en la devolución interna. */
  tipoNotaCreditoId: string | null;
}

export interface DocumentarVentaParams {
  tenantId: string;
  venta: {
    id: string;
    /** `null`: el país no tiene boleta sembrada (AR/CO/MX). No es una factura. */
    tipoDocumentoId: string | null;
    esBoleta: boolean;
    canal: string;
    totalFinal: string;
    configCalculo: ConfigCalculo | null;
  };
  facturador: Facturador;
  /** Σ por clasificación de las líneas de la venta (ya en memoria al crearla). */
  porciones: PorcionOriginal[];
  pagos: PagoParaDocumento[];
}

/** Un documento por escribir: el monto es Decimal hasta que se arma la fila. */
interface Borrador {
  emisor: EmisorDocumento;
  tipoDocumentoId: string | null;
  claseMaquina?: ClaseDocumentoMaquina | null;
  numero?: string | null;
  estadoEnvio: 'armado' | null;
  monto: Decimal;
  pagoId?: string | null;
}

/**
 * Qué documentos tiene una venta y quién emitió cada uno (spec
 * `2026-10-01-emision-por-venta`, ADR-028). Módulo hoja: lo importan ventas y
 * pagos, y él no importa a ninguno. Al crear la venta recibe por parámetro lo
 * que ya está en memoria; el abono y la anulación leen `venta_documentos` por
 * el `manager` de la transacción del llamador, después de que éste tomó el lock
 * de la venta.
 */
@Injectable()
export class VentaDocumentosService {
  /**
   * Se corre **una vez, al crear la venta**, dentro de su transacción: en POS y
   * salones crear la venta es la entrega, y lo entregado se documenta al
   * entregarlo, se haya pagado o no (E1). El cliente nunca manda quién emitió:
   * el emisor sale del medio de cada pago y de `tenants.facturador`.
   *
   * Los documentos se insertan con un solo `save` del array. La suma de los no
   * duplicados es el `totalFinal` de la venta, salvo la de $0.
   */
  async documentarVenta(
    manager: EntityManager,
    params: DocumentarVentaParams,
  ): Promise<VentaDocumento[]> {
    const { venta, facturador, pagos } = params;
    const total = new Decimal(venta.totalFinal);

    // E6: el mínimo de la boleta es $1; una venta de $0 no lleva documento.
    if (total.lte(0)) return [];
    // Un país sin boleta sembrada no cambia (spec § 3.3, § 6): sin tipo, un
    // documento `sistema` no significaría nada. Ojo: `esBoleta = false` con
    // `id = null` NO es una factura.
    if (venta.tipoDocumentoId === null) return [];
    const tipo = venta.tipoDocumentoId;

    const borradores: Borrador[] = [];
    if (venta.canal === 'online') {
      // E5: la documenta el sistema, sin mirar el medio (en lo online no hay máquina).
      borradores.push(delSistema(tipo, total));
    } else if (!venta.esBoleta) {
      // E2: la factura cubre el total, se pague o no.
      borradores.push(
        facturador === 'sistema'
          ? delSistema(tipo, total)
          : externo(tipo, total),
      );
    } else {
      borradores.push(
        ...this.borradoresDeBoleta(tipo, total, facturador, pagos),
      );
    }

    const filas = borradores.map((b) => {
      const conBaldes = b.emisor === 'sistema' || b.emisor === 'externo';
      const baldes = conBaldes
        ? componerBaldes(b.monto, params.porciones, venta.configCalculo)
        : null;
      return manager.create(VentaDocumento, {
        tenantId: params.tenantId,
        ventaId: venta.id,
        emisor: b.emisor,
        tipoDocumentoId: b.tipoDocumentoId,
        claseMaquina: b.claseMaquina ?? null,
        numero: b.numero ?? null,
        estadoEnvio: b.estadoEnvio,
        monto: b.monto.toFixed(4),
        montoAfecto: baldes?.montoAfecto.toFixed(4) ?? null,
        montoExento: baldes?.montoExento.toFixed(4) ?? null,
        montoImpuestos: baldes?.montoImpuestos.toFixed(4) ?? null,
        pagoId: b.pagoId ?? null,
        documentoCorregidoId: null,
        esDuplicado: false,
        descarte: null,
        descartadoEl: null,
        descartadoPorUsuarioId: null,
      });
    });
    const guardadas = await manager.save(VentaDocumento, filas);
    // Cada pago del cierre queda enlazado al documento que lo cubre, en la misma
    // transacción (ver `Pago.documentoId`: se enlaza y no se infiere).
    await this.enlazarPagosDelCierre(manager, {
      tenantId: params.tenantId,
      documentos: guardadas,
      // Online y factura son un solo documento por el total: todos los pagos
      // caen ahí. En una boleta cada pago cae en el de su emisor.
      unDocumentoPorElTotal: venta.canal === 'online' || !venta.esBoleta,
      pagos,
    });
    return guardadas;
  }

  /**
   * El abono (`registrarAbono`) **no documenta**: lo que paga ya estaba
   * documentado al entregar (E1). La excepción es E1b: si el medio emite con la
   * `maquina`, la máquina va a imprimir un voucher que vale como boleta sobre
   * algo ya documentado. Queda anotado como duplicado (`es_duplicado`), con su
   * `pago_id` y el número y la clase si vinieron, para que el contador sepa qué
   * anular. **El cobro nunca se rechaza por esto.** No cuenta para la cobertura
   * ni para los topes de una corrección.
   *
   * Solo se anota si la venta tiene algún documento vigente que no sea un
   * duplicado: una venta de $0, o de un país sin boleta, no tiene nada que
   * duplicar. Una sola lectura y un solo `save` del array, aunque haya varios
   * pagos de la máquina.
   */
  async registrarDuplicadoDeAbono(
    manager: EntityManager,
    params: RegistrarDuplicadoParams,
  ): Promise<VentaDocumento[]> {
    const deLaMaquina = params.pagos.filter(
      // Un pago que fue todo propina no cubre nada de la venta (como en
      // `borradoresDeBoleta`): no da documento.
      (p) => p.emisor === 'maquina' && new Decimal(p.aplicadoVenta).gt(0),
    );
    if (!deLaMaquina.length) return [];

    if (!(await this.ventaDocumentada(manager, params))) return [];

    const filas = deLaMaquina.map((p) =>
      manager.create(VentaDocumento, {
        tenantId: params.tenantId,
        ventaId: params.ventaId,
        emisor: 'maquina',
        tipoDocumentoId: null,
        claseMaquina: p.claseDocumento ?? null,
        numero: p.numeroDocumento?.trim() || null,
        estadoEnvio: null,
        monto: new Decimal(p.aplicadoVenta).toFixed(4),
        montoAfecto: null,
        montoExento: null,
        montoImpuestos: null,
        pagoId: p.pagoId,
        documentoCorregidoId: null,
        esDuplicado: true,
        descarte: null,
        descartadoEl: null,
        descartadoPorUsuarioId: null,
      }),
    );
    return manager.save(VentaDocumento, filas);
  }

  /**
   * Enlaza cada pago del abono al documento que documentó la deuda: la boleta
   * del sistema, el documento hecho por fuera o la factura. **Nunca** el voucher
   * duplicado de E1b, aunque el medio sea de la máquina: el abono no documenta,
   * lo que paga ya estaba documentado. Una sola lectura y **un solo `UPDATE`**
   * para todos los pagos. Sin documento de la deuda (venta de $0, país sin
   * boleta) no escribe nada y los pagos quedan sin enlace.
   *
   * Va en la misma transacción que el abono, con el lock de la venta ya tomado.
   */
  async enlazarPagosDeAbono(
    manager: EntityManager,
    params: { tenantId: string; ventaId: string; pagoIds: string[] },
  ): Promise<void> {
    if (!params.pagoIds.length) return;
    const docs: { documento_id: string; emisor: EmisorDocumento }[] =
      await manager.query(
        `SELECT documento_id, emisor
           FROM venta_documentos
          WHERE venta_id = $1
            AND tenant_id = $2
            AND es_duplicado = false
            AND emisor IN ('sistema', 'externo')
            AND descarte IS NULL
            AND eliminado_el IS NULL
          ORDER BY creado_el, documento_id`,
        [params.ventaId, params.tenantId],
      );
    const deuda = documentoDeLaDeuda(docs);
    if (!deuda) return;
    await this.escribirEnlaces(
      manager,
      params.tenantId,
      params.pagoIds.map((pagoId) => [pagoId, deuda.documento_id]),
    );
  }

  /**
   * Los pagos del cierre → su documento. `maquina`: su propio voucher (por
   * `pago_id`; un pago que no cubrió nada no tiene voucher y queda sin enlace);
   * `nadie`: la fila nadie; el resto: la boleta del sistema. Con un solo
   * documento por el total (online, factura), ese para todos.
   */
  private async enlazarPagosDelCierre(
    manager: EntityManager,
    params: {
      tenantId: string;
      documentos: VentaDocumento[];
      unDocumentoPorElTotal: boolean;
      pagos: PagoParaDocumento[];
    },
  ): Promise<void> {
    const { documentos } = params;
    const pares: [string, string][] = [];
    for (const p of params.pagos) {
      const doc = params.unDocumentoPorElTotal
        ? documentos[0]
        : p.emisor === 'maquina'
          ? documentos.find((d) => d.pagoId === p.pagoId)
          : documentos.find(
              (d) => d.emisor === (p.emisor === 'nadie' ? 'nadie' : 'sistema'),
            );
      if (doc) pares.push([p.pagoId, doc.id]);
    }
    await this.escribirEnlaces(manager, params.tenantId, pares);
  }

  /** Un solo `UPDATE` para todos los pagos (nunca uno por pago). */
  private async escribirEnlaces(
    manager: EntityManager,
    tenantId: string,
    pares: [string, string][],
  ): Promise<void> {
    if (!pares.length) return;
    await manager.query(
      `UPDATE pagos AS p
          SET documento_id = v.documento_id,
              actualizado_el = NOW()
         FROM unnest($1::uuid[], $2::uuid[]) AS v(pago_id, documento_id)
        WHERE p.pago_id = v.pago_id
          AND p.tenant_id = $3
          AND p.eliminado_el IS NULL`,
      [pares.map(([pago]) => pago), pares.map(([, doc]) => doc), tenantId],
    );
  }

  /**
   * Anular mira lo **emitido**, no la etiqueta (E8, E10). Solo cuentan los
   * documentos vigentes (`descarte IS NULL`). Devuelve el veredicto sin
   * escribir; `descartarAlAnular` lo aplica. El llamador ya tiene el lock de la
   * venta, así que los documentos no cambian entre esta lectura y el descarte.
   *
   * 1. Bloquea un documento de la `maquina` (la máquina ya emitió) o uno del
   *    `sistema` ya `enviado`. Hoy ningún `sistema` está enviado: no hay envío.
   * 2. Bloquea un `externo` que ya tiene número: salió del otro facturador, el
   *    documento existe y va por nota de crédito, sin preguntar.
   * 3. Un `externo` sin número se pregunta: sin respuesta, 400 que la pide;
   *    `true`, 400 (va por NC); `false`, anula.
   * Lo que queda son documentos `sistema` solo armados (se descartan), filas
   * `nadie` (se dejan) y los `externo` contestados con "no" (se descartan).
   */
  async evaluarAnulacion(
    manager: Lector,
    params: EvaluarAnulacionParams,
  ): Promise<EvaluacionAnulacion> {
    const docs: {
      documento_id: string;
      emisor: EmisorDocumento;
      estado_envio: string | null;
      numero: string | null;
    }[] = await manager.query(
      `SELECT documento_id, emisor, estado_envio, numero
         FROM venta_documentos
        WHERE venta_id = $1
          AND tenant_id = $2
          AND descarte IS NULL
          AND eliminado_el IS NULL
        ORDER BY creado_el, documento_id`,
      [params.ventaId, params.tenantId],
    );

    if (docs.some((d) => d.emisor === 'maquina'))
      return { resultado: 'bloqueada', motivo: MOTIVO_ANULAR_CON_MAQUINA };
    if (
      docs.some((d) => d.emisor === 'sistema' && d.estado_envio === 'enviado')
    )
      return { resultado: 'bloqueada', motivo: MOTIVO_ANULAR_CON_ENVIADO };

    const externos = docs.filter((d) => d.emisor === 'externo');
    if (externos.some((d) => (d.numero ?? '').trim() !== ''))
      return { resultado: 'bloqueada', motivo: MOTIVO_EXTERNO_YA_HECHO };
    if (externos.length) {
      // Comparación estricta: solo `true` y `false` son respuestas. `undefined`
      // y `null` (que el DTO ya rechaza, pero este método no depende de eso) son
      // "nadie contestó": se pregunta, no se anula.
      if (params.externoHecho === true)
        return { resultado: 'bloqueada', motivo: MOTIVO_EXTERNO_YA_HECHO };
      if (params.externoHecho !== false)
        return {
          resultado: 'pregunta_externo',
          motivo: MOTIVO_EXTERNO_SIN_RESPUESTA,
        };
    }

    const descartes: { documentoId: string; descarte: Descarte }[] = [];
    for (const d of docs) {
      if (d.emisor === 'sistema')
        descartes.push({
          documentoId: d.documento_id,
          descarte: 'armado_sin_enviar',
        });
      else if (d.emisor === 'externo')
        descartes.push({
          documentoId: d.documento_id,
          descarte: 'afirmado_no_hecho',
        });
    }
    return { resultado: 'anulable', descartes };
  }

  /**
   * Aplica `evaluarAnulacion` dentro de la transacción de `cancelarUnaVez`: si
   * no es anulable lanza 400 con el motivo; si lo es, descarta lo que
   * corresponde con la hora y el usuario del token, en una sola sentencia y sin
   * borrar filas (queda el registro de que existieron, y en `afirmado_no_hecho`,
   * de quién lo afirmó).
   */
  async descartarAlAnular(
    manager: EntityManager,
    params: DescartarAlAnularParams,
  ): Promise<void> {
    const veredicto = await this.evaluarAnulacion(manager, params);
    if (veredicto.resultado !== 'anulable')
      throw new BadRequestException(veredicto.motivo);
    if (!veredicto.descartes.length) return;

    await manager.query(
      `UPDATE venta_documentos AS vd
          SET descarte = d.descarte,
              descartado_el = NOW(),
              descartado_por_usuario_id = $1,
              actualizado_el = NOW()
         FROM unnest($2::uuid[], $3::text[]) AS d(documento_id, descarte)
        WHERE vd.documento_id = d.documento_id
          AND vd.tenant_id = $4
          AND vd.descarte IS NULL
          AND vd.eliminado_el IS NULL`,
      [
        params.usuarioId,
        veredicto.descartes.map((d) => d.documentoId),
        veredicto.descartes.map((d) => d.descarte),
        params.tenantId,
      ],
    );
  }

  /**
   * ¿Esta venta ya tiene un documento que cubre su deuda? Es el predicado de
   * "ya documentada" (E1) y **lo comparten dos lectores**, para que no se
   * desalineen: `registrarDuplicadoDeAbono` (¿el voucher de este abono duplica?)
   * y el `abonoConMaquinaDuplica` del detalle (¿lo duplicaría uno que todavía no
   * se cobró?).
   *
   * Cuenta un documento vigente (`descarte IS NULL`), que no sea un duplicado y
   * con `emisor <> 'nadie'`: una fila `nadie` nunca documenta una deuda (la
   * deuda va siempre a `sistema` o `externo`, E1/E2), así que no cuenta.
   */
  async ventaDocumentada(
    lector: Lector,
    params: VentaDeLosDocumentosParams,
  ): Promise<boolean> {
    const filas: unknown[] = await lector.query(
      `SELECT 1
         FROM venta_documentos
        WHERE venta_id = $1
          AND tenant_id = $2
          AND es_duplicado = false
          AND emisor <> 'nadie'
          AND descarte IS NULL
          AND eliminado_el IS NULL
        LIMIT 1`,
      [params.ventaId, params.tenantId],
    );
    return filas.length > 0;
  }

  /**
   * Los documentos de la venta **y los de sus correcciones** (`venta_referencia_id`),
   * en una sola consulta, con el tipo y el nombre de quien descartó resueltos
   * por JOIN (una consulta por fila sería N+1).
   *
   * Incluye los descartados: el detalle muestra qué pasó con cada uno. Lo que
   * decide qué documento "vale" es `descarte`, no su presencia.
   */
  async listarParaDetalle(
    lector: Lector,
    params: ListarParaDetalleParams,
  ): Promise<DocumentoDetalle[]> {
    const filas: {
      documento_id: string;
      venta_id: string;
      emisor: EmisorDocumento;
      tipo_documento_id: string | null;
      tipo_codigo: string | null;
      tipo_nombre: string | null;
      clase_maquina: ClaseDocumentoMaquina | null;
      numero: string | null;
      estado_envio: EstadoEnvio | null;
      monto: string;
      pago_id: string | null;
      documento_corregido_id: string | null;
      es_duplicado: boolean;
      descarte: Descarte | null;
      descartado_el: Date | null;
      descartado_por_nombre: string | null;
    }[] = await lector.query(
      `SELECT vd.documento_id, vd.venta_id, vd.emisor, vd.tipo_documento_id,
              td.codigo AS tipo_codigo, td.nombre AS tipo_nombre,
              vd.clase_maquina, vd.numero, vd.estado_envio, vd.monto, vd.pago_id,
              vd.documento_corregido_id, vd.es_duplicado, vd.descarte,
              vd.descartado_el,
              NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellido)), '') AS descartado_por_nombre
         FROM venta_documentos vd
         -- Sin filtrar \`eliminado_el\` del tipo ni del usuario, a propósito: un
         -- documento ya emitido conserva su tipo y su historial aunque el catálogo
         -- o la cuenta se hayan borrado después. Filtrarlos dejaba la fila sin
         -- tipo (o sin quién afirmó que no estaba hecho, E10) por algo ajeno a ella.
         LEFT JOIN tipos_documento_tributario td
                ON td.tipo_documento_id = vd.tipo_documento_id
         LEFT JOIN usuarios u ON u.usuario_id = vd.descartado_por_usuario_id
        WHERE vd.tenant_id = $2
          AND vd.eliminado_el IS NULL
          -- Una sola lista (la venta y sus correcciones) y no \`= $1 OR IN (...)\`:
          -- con el \`OR\` el planner abandona el índice de \`venta_id\`.
          AND vd.venta_id IN (
            SELECT venta_id FROM ventas
             WHERE venta_referencia_id = $1
               AND tenant_id = $2
               AND eliminado_el IS NULL
            UNION ALL
            SELECT $1::uuid
          )
          AND ($3::uuid IS NULL OR vd.documento_id = $3::uuid)
        ORDER BY vd.creado_el, vd.documento_id`,
      [params.ventaId, params.tenantId, params.documentoId ?? null],
    );
    return filas.map((f) => ({
      id: f.documento_id,
      ventaId: f.venta_id,
      emisor: f.emisor,
      tipoDocumento: f.tipo_documento_id
        ? {
            id: f.tipo_documento_id,
            codigo: f.tipo_codigo,
            nombre: f.tipo_nombre ?? '',
          }
        : null,
      claseMaquina: f.clase_maquina,
      numero: f.numero,
      estadoEnvio: f.estado_envio,
      monto: f.monto,
      pagoId: f.pago_id,
      documentoCorregidoId: f.documento_corregido_id,
      esDuplicado: f.es_duplicado,
      descarte: f.descarte,
      descartadoEl: f.descartado_el,
      descartadoPorNombre: f.descartado_por_nombre,
    }));
  }

  /**
   * Anota el número de un documento de la máquina (el voucher, el folio) o de uno
   * hecho por fuera, después de la venta (spec § 3.4). Es la puerta que usan el
   * `PATCH` y, cuando exista, la integración con el facturador: **no recibe nada
   * del request** más que lo que escribe (ni usuario ni venta), y E10 trata igual
   * un número llegue como llegue.
   *
   * Valida el número por su cuenta (no vacío, hasta 40 caracteres, sin caracteres
   * de control): las mismas reglas del DTO, porque quien llame sin pasar por él
   * no las hereda.
   *
   * Aplica solo a un documento vigente (`descarte IS NULL`, no borrado), de la
   * `maquina` o `externo` y de ese tenant; cualquier otra cosa es 404 y no se
   * confirma que existe. La `clase` solo se acepta con la máquina (400 con un
   * `externo`). Que el documento sea de **tal venta**, y el lock de esa venta,
   * son del llamador: el lock evita que escribir el número de un `externo`
   * corra contra una anulación que lo declara no hecho.
   *
   * Devuelve el documento como lo muestra el detalle.
   */
  async completarNumero(
    manager: EntityManager,
    params: CompletarNumeroParams,
  ): Promise<DocumentoDetalle> {
    // El DTO ya lo rechaza, pero esta es la puerta de la integración futura y no
    // depende de que alguien la haya pasado por el pipe.
    const numero = params.numero.trim();
    if (!numero)
      throw new BadRequestException('El número no puede quedar vacío.');
    if (numero.length > NUMERO_MAX)
      throw new BadRequestException(
        `El número no puede pasar de ${NUMERO_MAX} caracteres.`,
      );
    if (CARACTERES_DE_CONTROL.test(numero))
      throw new BadRequestException(
        'El número no puede llevar caracteres de control.',
      );

    const vigente = `tenant_id = $2
          AND emisor IN ('maquina', 'externo')
          AND descarte IS NULL
          AND eliminado_el IS NULL`;
    const actuales: { emisor: EmisorDocumento }[] = await manager.query(
      `SELECT emisor
         FROM venta_documentos
        WHERE documento_id = $1
          AND ${vigente}`,
      [params.documentoId, params.tenantId],
    );
    if (!actuales.length)
      throw new NotFoundException('Documento no encontrado');
    if (params.clase !== undefined && actuales[0].emisor !== 'maquina')
      throw new BadRequestException(
        'La clase solo se anota en un documento de la máquina de tarjeta.',
      );

    // `COALESCE`: omitir la clase la conserva. Mandar `null` no llega hasta acá
    // (el DTO lo rechaza), y aunque llegara, tampoco la borraría.
    const escritas = unwrap<{ documento_id: string; venta_id: string }>(
      await manager.query(
        `UPDATE venta_documentos
            SET numero = $3,
                clase_maquina = COALESCE($4, clase_maquina),
                actualizado_el = NOW()
          WHERE documento_id = $1
            AND ${vigente}
          RETURNING documento_id, venta_id`,
        [params.documentoId, params.tenantId, numero, params.clase ?? null],
      ),
    );
    // Sin el lock del llamador el documento pudo dejar de valer entre la lectura
    // y esta sentencia: no se responde un éxito que no escribió nada.
    if (!escritas.length)
      throw new NotFoundException('Documento no encontrado');

    const [documento] = await this.listarParaDetalle(manager, {
      tenantId: params.tenantId,
      ventaId: escritas[0].venta_id,
      documentoId: params.documentoId,
    });
    return documento;
  }

  /**
   * Qué documento corrige una corrección, según por dónde vuelve la plata (spec
   * § 3.6). Lo resuelve el servidor: el cliente manda el pago o "sin plata", y
   * nunca el documento. Lo comparten la creación de la nota y el detalle
   * (`opcionesDevolucion`), para que la pantalla ofrezca exactamente lo que el
   * servidor después acepta.
   *
   * - `pago`/`pasarela`: el documento que cubre ese pago, que tiene que ser de
   *   esta venta y de este tenant. Un pago de la máquina tiene el suyo; los de
   *   `sistema` y `nadie` caen en el documento de su emisor; **el pago de un
   *   abono** cae en el documento que documentó la deuda, nunca en el voucher
   *   duplicado (E1b); y en una factura, siempre la factura.
   * - `sin_plata`: solo con saldo, y corrige el documento que cubre lo no
   *   pagado (la boleta del sistema, el `externo` o la factura).
   *
   * Solo cuentan los documentos vigentes (`descarte IS NULL`) de **esta** venta:
   * los de sus correcciones tienen otro `venta_id`.
   */
  async documentoQueCorrige(
    lector: Lector,
    params: DocumentoQueCorrigeParams,
  ): Promise<DestinoCorreccion> {
    const { via } = params;

    // Un reembolso de pasarela es un hecho consumado: nunca lanza. Corrige el
    // documento que la venta trae (si sigue vigente) y, si no hay, se emite sin.
    if (via.tipo === 'pasarela') {
      if (via.documentoId === null)
        return { documento: null, saldo: null, mueveCaja: false };
      const filas: {
        documento_id: string;
        emisor: EmisorDocumento;
        monto: string;
      }[] = await lector.query(
        `SELECT documento_id, emisor, monto::text AS monto
             FROM venta_documentos
            WHERE documento_id = $1
              AND venta_id = $2
              AND tenant_id = $3
              AND descarte IS NULL
              AND eliminado_el IS NULL`,
        [via.documentoId, params.ventaId, params.tenantId],
      );
      const f = filas[0];
      return {
        documento: f
          ? { id: f.documento_id, emisor: f.emisor, monto: f.monto }
          : null,
        saldo: null,
        mueveCaja: false,
      };
    }

    const c = await this.corregibles(lector, params);

    if (via.tipo === 'sin_plata') {
      if (!c.saldo.gt(0))
        throw new BadRequestException(
          'La venta no tiene saldo pendiente: elegí por cuál de sus pagos vuelve la plata.',
        );
      if (c.hayDocumentos && !c.deuda)
        throw new BadRequestException(
          'No se encontró el documento de lo que esta venta debe.',
        );
      return {
        documento: c.deuda,
        saldo: c.saldo.toFixed(4),
        mueveCaja: false,
      };
    }

    // Un `pagoId` de otra venta o de otro tenant no aparece en la lectura (que
    // filtra por las dos): mismo 400 que uno inexistente, sin confirmar nada.
    const pago = c.pagos.find((p) => p.pagoId === via.pagoId);
    if (!pago)
      throw new BadRequestException('El pago indicado no es de esta venta.');
    if (!pago.aplicadoVenta.gt(0))
      throw new BadRequestException(
        'Ese pago no cubrió nada de la venta (fue todo propina): elegí otro.',
      );
    if (c.hayDocumentos && !pago.documento)
      throw new BadRequestException('No se encontró el documento de ese pago.');
    return {
      documento: pago.documento,
      saldo: null,
      mueveCaja: pago.esEfectivo,
    };
  }

  /**
   * Las opciones de "¿Por dónde vuelve la plata?" de una venta: una por cada
   * pago que cubrió algo y que tiene documento que corregir, más "No vuelve
   * plata" solo si hay saldo. Sale de la **misma resolución** que
   * `documentoQueCorrige`, una sola lectura para toda la venta (sin una consulta
   * por pago). El cliente la muestra tal cual y manda `devolucion`.
   */
  async opcionesDevolucion(
    lector: Lector,
    params: VentaDeLosDocumentosParams,
  ): Promise<OpcionDevolucion[]> {
    const c = await this.corregibles(lector, params);
    const opciones: OpcionDevolucion[] = [];
    for (const p of c.pagos) {
      if (!p.aplicadoVenta.gt(0)) continue;
      if (c.hayDocumentos && !p.documento) continue;
      opciones.push({
        pagoId: p.pagoId,
        sinPlata: false,
        metodo: p.metodoNombre,
        monto: p.aplicadoVenta.toFixed(4),
        mueveCaja: p.esEfectivo,
        registro: registroDe(p.documento),
      });
    }
    if (c.saldo.gt(0) && !(c.hayDocumentos && !c.deuda))
      opciones.push({
        pagoId: null,
        sinPlata: true,
        metodo: null,
        monto: c.saldo.toFixed(4),
        mueveCaja: false,
        registro: registroDe(c.deuda),
      });
    return opciones;
  }

  /**
   * El tope por documento (spec § 3.6): lo corregido de un documento no pasa su
   * `monto`. Se suma a los dos topes de la nota, **bajo el mismo lock** (el
   * llamador ya tiene el `FOR UPDATE` de la venta). Cuenta toda corrección
   * previa que apunte al documento, devolución interna incluida.
   *
   * El mensaje no interpola ningún número: el 422 del efectivo de la caja es
   * otro tope y su valor no se revela (fuga 5 del modo ciego); acá se sigue la
   * misma disciplina para no abrir un oráculo nuevo.
   */
  async exigirTopeDelDocumento(
    manager: EntityManager,
    params: TopeDelDocumentoParams,
  ): Promise<void> {
    const filas: { corregido: string }[] = await manager.query(
      `SELECT COALESCE(SUM(vd.monto), 0)::text AS corregido
         FROM venta_documentos vd
         JOIN ventas v ON v.venta_id = vd.venta_id
                      AND v.tenant_id = vd.tenant_id
                      AND v.eliminado_el IS NULL
        WHERE vd.documento_corregido_id = $1
          AND vd.tenant_id = $2
          AND vd.descarte IS NULL
          AND vd.eliminado_el IS NULL`,
      [params.documento.id, params.tenantId],
    );
    const disponible = new Decimal(params.documento.monto).minus(
      filas[0]?.corregido ?? '0',
    );
    if (new Decimal(params.monto).gt(disponible))
      throw new BadRequestException(
        'El monto excede lo que queda por corregir del documento de ese pago.',
      );
  }

  /**
   * Escribe el documento de una corrección (spec § 3.6), según quién emitió el
   * que corrige:
   * - `sistema` → NC `sistema` / `armado`, con el tipo NC;
   * - `maquina` → NC `maquina` sin número (la hace la máquina o su portal y el
   *   sistema la anota), con el tipo NC;
   * - `externo` → NC `externo` sin número, con el tipo NC;
   * - `nadie` → **devolución interna**: fila `nadie`, sin tipo.
   *
   * Los baldes de una NC `sistema` o `externo` salen de las **líneas de la propia
   * corrección** (que `crearNotaCredito` ya compuso con la tasa de cada porción),
   * y no de `componerBaldes`: la corrección ya trae su neto y su IVA.
   */
  async documentarCorreccion(
    manager: EntityManager,
    params: DocumentarCorreccionParams,
  ): Promise<VentaDocumento> {
    const { corregido } = params;
    const interna = corregido.emisor === 'nadie';
    if (!interna && params.tipoNotaCreditoId === null)
      throw new InternalServerErrorException(
        'Una corrección con documento necesita el tipo de nota de crédito del país.',
      );

    let baldes: { afecto: string; exento: string; impuestos: string } | null =
      null;
    if (corregido.emisor === 'sistema' || corregido.emisor === 'externo') {
      const filas: { afecto: string; exento: string; impuestos: string }[] =
        await manager.query(
          `SELECT COALESCE(SUM(d.subtotal)
                     FILTER (WHERE d.clasificacion_tributaria = 'afecto'), 0)::text AS afecto,
                  COALESCE(SUM(d.subtotal)
                     FILTER (WHERE d.clasificacion_tributaria = 'exento'), 0)::text AS exento,
                  COALESCE(SUM(d.impuesto_aplicado), 0)::text AS impuestos
             FROM venta_detalles d
            WHERE d.venta_id = $1 AND d.eliminado_el IS NULL`,
          [params.correccionVentaId],
        );
      baldes = filas[0] ?? null;
    }

    const fila = manager.create(VentaDocumento, {
      tenantId: params.tenantId,
      ventaId: params.correccionVentaId,
      emisor: corregido.emisor,
      tipoDocumentoId: interna ? null : params.tipoNotaCreditoId,
      claseMaquina: null,
      numero: null,
      estadoEnvio: corregido.emisor === 'sistema' ? 'armado' : null,
      monto: new Decimal(params.monto).toFixed(4),
      montoAfecto: baldes ? new Decimal(baldes.afecto).toFixed(4) : null,
      montoExento: baldes ? new Decimal(baldes.exento).toFixed(4) : null,
      montoImpuestos: baldes ? new Decimal(baldes.impuestos).toFixed(4) : null,
      pagoId: null,
      documentoCorregidoId: corregido.id,
      esDuplicado: false,
      descarte: null,
      descartadoEl: null,
      descartadoPorUsuarioId: null,
    });
    return manager.save(VentaDocumento, fila);
  }

  /**
   * Todo lo que hace falta para resolver qué documento cubre cada pago de una
   * venta, en tres lecturas (la venta, sus documentos vigentes y sus pagos con
   * lo aplicado a la venta), sin una consulta por pago.
   *
   * El documento de cada pago **se lee de `pagos.documento_id`**, que se escribe
   * al cobrar y al abonar (`documentarVenta`, `enlazarPagosDeAbono`): no se
   * infiere. El emisor de un medio puede cambiar entre la venta y el reembolso, y
   * la corrección tiene que seguir cayendo en el documento que cubrió ese pago.
   * Solo cuentan los documentos vigentes: un enlace a uno descartado (venta
   * anulada) no resuelve nada.
   */
  private async corregibles(
    lector: Lector,
    params: VentaDeLosDocumentosParams,
  ): Promise<{
    saldo: Decimal;
    hayDocumentos: boolean;
    deuda: DocumentoCorregido | null;
    pagos: {
      pagoId: string;
      metodoNombre: string | null;
      esEfectivo: boolean;
      aplicadoVenta: Decimal;
      documento: DocumentoCorregido | null;
    }[];
  }> {
    const ventas: { total_final: string; sin_plata: string }[] =
      await lector.query(
        // \`sin_plata\`: lo que las correcciones anteriores "sin plata" ya rebajaron
        // de lo que se debía. Solo esas: las que volvieron por un pago (o por la
        // pasarela) devolvieron plata por fuera y la deuda sigue igual.
        `SELECT v.total_final::text AS total_final,
                COALESCE((
                  SELECT SUM(c.total_final)
                    FROM ventas c
                   WHERE c.venta_referencia_id = v.venta_id
                     AND c.tenant_id = v.tenant_id
                     AND c.devolucion_via = 'sin_plata'
                     AND c.eliminado_el IS NULL
                ), 0)::text AS sin_plata
           FROM ventas v
          WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
        [params.ventaId, params.tenantId],
      );
    if (!ventas.length) throw new NotFoundException('Venta no encontrada');

    const docs: {
      documento_id: string;
      emisor: EmisorDocumento;
      monto: string;
      es_duplicado: boolean;
    }[] = await lector.query(
      `SELECT documento_id, emisor, monto::text AS monto, es_duplicado
         FROM venta_documentos
        WHERE venta_id = $1
          AND tenant_id = $2
          AND descarte IS NULL
          AND eliminado_el IS NULL
        ORDER BY creado_el, documento_id`,
      [params.ventaId, params.tenantId],
    );

    const pagos: {
      pago_id: string;
      metodo_nombre: string | null;
      es_efectivo: boolean | null;
      documento_id: string | null;
      aplicado_venta: string;
    }[] = await lector.query(
      `SELECT p.pago_id,
              mp.nombre AS metodo_nombre,
              mp.es_efectivo,
              p.documento_id,
              COALESCE(SUM(pa.monto), 0)::text AS aplicado_venta
         FROM pagos p
         JOIN ventas v ON v.venta_id = p.venta_id
                      AND v.tenant_id = p.tenant_id
                      AND v.eliminado_el IS NULL
         -- Sin mp.eliminado_el IS NULL, a propósito: un pago ya cobrado conserva
         -- su medio aunque el catálogo lo haya dado de baja después, y filtrarlo
         -- dejaría al pago sin nombre ni es_efectivo (la plata saldría o no de la
         -- caja según un dato ajeno al pago).
         LEFT JOIN metodos_pago mp ON mp.metodo_pago_id = p.metodo_pago_id
         LEFT JOIN pago_aplicaciones pa
                ON pa.pago_id = p.pago_id
               AND pa.tipo = 'venta'
               AND pa.eliminado_el IS NULL
        WHERE p.venta_id = $1 AND p.tenant_id = $2 AND p.eliminado_el IS NULL
        GROUP BY p.pago_id, mp.nombre, mp.es_efectivo, p.documento_id
        ORDER BY p.creado_el, p.pago_id`,
      [params.ventaId, params.tenantId],
    );

    const doc = (d: (typeof docs)[number]): DocumentoCorregido => ({
      id: d.documento_id,
      emisor: d.emisor,
      monto: d.monto,
    });
    // Sin el voucher de la máquina ni los duplicados: lo que cubre la deuda.
    const deudaDoc = documentoDeLaDeuda(
      docs.filter((d) => d.emisor !== 'maquina' && !d.es_duplicado),
    );

    const aplicadoTotal = pagos.reduce(
      (a, p) => a.plus(p.aplicado_venta),
      ZERO,
    );
    return {
      // Lo que la venta todavía debe: total − lo aplicado − lo ya rebajado sin
      // plata. UNA sola cuenta para el tope de "no vuelve plata" y para ofrecerla
      // (`opcionesDevolucion`): la pantalla nunca ofrece lo que no queda por rebajar.
      saldo: new Decimal(ventas[0].total_final)
        .minus(aplicadoTotal)
        .minus(ventas[0].sin_plata),
      hayDocumentos: docs.length > 0,
      deuda: deudaDoc ? doc(deudaDoc) : null,
      pagos: pagos.map((p) => {
        const enlazado = p.documento_id
          ? docs.find((d) => d.documento_id === p.documento_id)
          : undefined;
        return {
          pagoId: p.pago_id,
          metodoNombre: p.metodo_nombre,
          esEfectivo: p.es_efectivo === true,
          aplicadoVenta: new Decimal(p.aplicado_venta),
          documento: enlazado ? doc(enlazado) : null,
        };
      }),
    };
  }

  /**
   * Boleta: los pagos se agrupan por el emisor de su medio, sobre lo aplicado a
   * la venta. Lo que queda sin pagar se documenta al cerrar (E1) según quién
   * factura el comercio (E2).
   */
  private borradoresDeBoleta(
    tipo: string,
    total: Decimal,
    facturador: Facturador,
    pagos: PagoParaDocumento[],
  ): Borrador[] {
    const maquina: Borrador[] = [];
    let sumaSistema = ZERO;
    let sumaNadie = ZERO;
    let pagado = ZERO;
    for (const p of pagos) {
      const aplicado = new Decimal(p.aplicadoVenta);
      pagado = pagado.plus(aplicado);
      if (p.emisor === 'maquina') {
        maquina.push({
          emisor: 'maquina',
          tipoDocumentoId: null,
          claseMaquina: p.claseDocumento ?? null,
          numero: p.numeroDocumento?.trim() || null,
          estadoEnvio: null,
          monto: aplicado,
          pagoId: p.pagoId,
        });
      } else if (p.emisor === 'nadie') {
        sumaNadie = sumaNadie.plus(aplicado);
      } else {
        sumaSistema = sumaSistema.plus(aplicado);
      }
    }
    // Inalcanzable hoy (el cobro apunta a total + propina y lo aplicado a la
    // venta nunca lo supera), pero un total fiscal falso es peor que un 500:
    // acotar a cero dejaría documentos que suman más que la venta, sin avisar.
    const noPagado = total.minus(pagado);
    if (noPagado.lt(0)) {
      throw new InternalServerErrorException(
        'Lo aplicado a la venta supera su total: no se puede documentar sin falsear el total fiscal.',
      );
    }

    const documentos: Borrador[] = [...maquina];
    documentos.push({
      emisor: 'nadie',
      tipoDocumentoId: null,
      estadoEnvio: null,
      monto: sumaNadie,
    });
    if (facturador === 'sistema') {
      documentos.push(delSistema(tipo, sumaSistema.plus(noPagado)));
    } else {
      documentos.push(delSistema(tipo, sumaSistema));
      documentos.push(externo(tipo, noPagado));
    }
    // Un documento de monto 0 no se crea: un pago que fue todo propina no cubre
    // nada de la venta, y lo no pagado o lo de los pagos del sistema puede ser
    // cero.
    return documentos.filter((d) => d.monto.gt(0));
  }
}

function delSistema(tipo: string, monto: Decimal): Borrador {
  return {
    emisor: 'sistema',
    tipoDocumentoId: tipo,
    estadoEnvio: 'armado',
    monto,
  };
}

function externo(tipo: string, monto: Decimal): Borrador {
  return { emisor: 'externo', tipoDocumentoId: tipo, estadoEnvio: null, monto };
}

function registroDe(documento: DocumentoCorregido | null): RegistroCorreccion {
  switch (documento?.emisor) {
    case 'sistema':
      return 'nota_credito_sistema';
    case 'maquina':
      return 'nota_maquina';
    case 'externo':
      return 'nota_externa';
    case 'nadie':
      return 'devolucion_interna';
    default:
      return 'nota_credito';
  }
}

/**
 * El documento que cubre lo que la venta debe: el hecho por fuera si lo hay (el
 * comercio factura por otro lado) y si no el del sistema (la boleta o la
 * factura). Los documentos que llegan ya vienen sin vouchers ni duplicados.
 */
function documentoDeLaDeuda<T extends { emisor: EmisorDocumento }>(
  docs: T[],
): T | undefined {
  return (
    docs.find((d) => d.emisor === 'externo') ??
    docs.find((d) => d.emisor === 'sistema')
  );
}
