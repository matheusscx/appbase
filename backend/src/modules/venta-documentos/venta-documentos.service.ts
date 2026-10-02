import { Injectable, InternalServerErrorException } from '@nestjs/common';
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
 * pagos, y él no importa a ninguno (los datos que necesita los recibe por
 * parámetro; no consulta nada).
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
