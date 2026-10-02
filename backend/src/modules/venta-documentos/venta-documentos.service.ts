import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
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
} from './entities/venta-documento.entity';

const ZERO = new Decimal(0);

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
    return manager.save(VentaDocumento, filas);
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

    // `emisor <> 'nadie'`: una fila `nadie` nunca documenta una deuda (la deuda va
    // siempre a `sistema` o `externo`, E1/E2), así que no cuenta como documentada.
    const documentada: unknown[] = await manager.query(
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
    if (!documentada.length) return [];

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
    manager: EntityManager,
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
