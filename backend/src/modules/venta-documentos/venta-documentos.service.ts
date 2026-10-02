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
