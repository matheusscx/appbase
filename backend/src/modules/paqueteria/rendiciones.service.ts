import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { EntregasRepartidorService } from './entregas-repartidor.service';
import { HojasRutaService } from './hojas-ruta.service';
import { RepartidoresService } from './repartidores.service';
import type { QueryRendicionesDto } from './dto/query-rendiciones.dto';
import type { RendirDto } from './dto/rendir.dto';
import type {
  DiaRendicion,
  RendicionDetalle,
  RendicionFila,
  TotalesHoja,
  TotalesRendicion,
} from './paqueteria.types';

interface FilaRendicion {
  rendicion_id: string;
  repartidor_id: string;
  repartidor_nombre: string;
  rendida_el: Date;
  total_entregados: number;
  monto_cobrado_destino: string;
  monto_cobrado_efectivo: string;
  monto_cobrado_transferencia: string;
  monto_pago_repartidor: string;
  monto_entregado_a_cuenta: string;
  saldo: string;
}

interface FilaTarifa {
  hoja_ruta_id: string;
  tarifa_pago_id: string | null;
  nombre: string | null;
  n: number;
  monto: string;
}

/** Una hoja con lo que `HojasRutaService.totales` calcula (en vivo) o lo que congeló (rendida). */
interface HojaConTotales {
  id: string;
  fecha: string;
  totales: TotalesHoja;
}

const SIN_TARIFA = 'sin_tarifa';

const aTotales = (f: FilaRendicion): TotalesRendicion => ({
  entregados: f.total_entregados,
  montoCobradoDestino: f.monto_cobrado_destino,
  montoCobradoEfectivo: f.monto_cobrado_efectivo,
  montoCobradoTransferencia: f.monto_cobrado_transferencia,
  montoPagoRepartidor: f.monto_pago_repartidor,
  montoEntregadoACuenta: f.monto_entregado_a_cuenta,
  saldo: f.saldo,
});

/**
 * Los totales de la rendición: la suma de lo que sus hojas calcularon (o congelaron) más lo
 * entregado a cuenta. Es la ÚNICA suma de plata de este service, sobre strings de `numeric` con
 * Decimal: lo que cada hoja vale sale de `totales`, acá solo se suman sus resultados.
 */
const sumar = (
  hojas: TotalesHoja[],
  entregadoACuenta: Decimal,
): TotalesRendicion => {
  let destino = new Decimal(0);
  let efectivo = new Decimal(0);
  let transferencia = new Decimal(0);
  let pago = new Decimal(0);
  let entregados = 0;
  for (const h of hojas) {
    entregados += h.entregados;
    destino = destino.plus(h.montoCobradoDestino);
    efectivo = efectivo.plus(h.montoCobradoEfectivo);
    transferencia = transferencia.plus(h.montoCobradoTransferencia);
    pago = pago.plus(h.montoPagoRepartidor);
  }
  return {
    entregados,
    montoCobradoDestino: destino.toFixed(4),
    montoCobradoEfectivo: efectivo.toFixed(4),
    montoCobradoTransferencia: transferencia.toFixed(4),
    montoPagoRepartidor: pago.toFixed(4),
    montoEntregadoACuenta: entregadoACuenta.toFixed(4),
    saldo: destino.minus(pago).minus(entregadoACuenta).toFixed(4),
  };
};

/**
 * La rendición de un repartidor sobre las hojas que se elijan (un día, varios, una semana).
 * `previa` y `rendir` arman la cuenta con el mismo código y las mismas hojas, así que dan los
 * mismos totales; `rendir` además la escribe, todo en una transacción.
 */
@Injectable()
export class RendicionesService {
  constructor(
    private readonly db: Db,
    private readonly repartidores: RepartidoresService,
    private readonly hojas: HojasRutaService,
    private readonly entregas: EntregasRepartidorService,
  ) {}

  /** Las rendiciones cuyas hojas tocan el rango (por fecha de la hoja), la más reciente primero. */
  async lista(
    tenantId: string,
    q: QueryRendicionesDto,
  ): Promise<RendicionFila[]> {
    if (q.desde > q.hasta) {
      throw new BadRequestException('El rango de fechas está invertido.');
    }
    const params: unknown[] = [tenantId, q.desde, q.hasta];
    let filtroRepartidor = '';
    if (q.repartidorId) {
      params.push(q.repartidorId);
      filtroRepartidor = `AND r.repartidor_id = $${params.length}`;
    }
    const filas: (FilaRendicion & {
      desde: string;
      hasta: string;
      hojas: number;
    })[] = await this.db.query(
      `SELECT r.rendicion_id, r.repartidor_id, rep.nombre AS repartidor_nombre, r.rendida_el,
              r.total_entregados, r.monto_cobrado_destino, r.monto_cobrado_efectivo,
              r.monto_cobrado_transferencia, r.monto_pago_repartidor,
              r.monto_entregado_a_cuenta, r.saldo, x.desde, x.hasta, x.hojas
         FROM rendiciones r
         JOIN repartidores rep ON rep.repartidor_id = r.repartidor_id
                              AND rep.tenant_id = r.tenant_id AND rep.eliminado_el IS NULL
         CROSS JOIN LATERAL (
           SELECT MIN(h.fecha)::text AS desde, MAX(h.fecha)::text AS hasta, COUNT(*)::int AS hojas
             FROM hojas_ruta h
            WHERE h.rendicion_id = r.rendicion_id AND h.tenant_id = r.tenant_id
              AND h.eliminado_el IS NULL
         ) x
        WHERE r.tenant_id = $1 AND r.eliminado_el IS NULL
          AND x.hojas > 0 AND x.hasta >= $2 AND x.desde <= $3
          ${filtroRepartidor}
        ORDER BY r.rendida_el DESC, r.rendicion_id`,
      params,
    );
    return filas.map((f) => ({
      id: f.rendicion_id,
      repartidorId: f.repartidor_id,
      repartidorNombre: f.repartidor_nombre,
      rendidaEl: f.rendida_el.toISOString(),
      desde: f.desde,
      hasta: f.hasta,
      hojas: f.hojas,
      totales: aTotales(f),
    }));
  }

  /** La cuenta como quedaría si se rindiera ahora; no escribe ni bloquea. Las mismas exigencias que `rendir`. */
  async previa(
    tenantId: string,
    repartidorId: string,
    hojaIds: string[],
  ): Promise<RendicionDetalle> {
    const repartidor = await this.repartidores.exigirExistente(
      tenantId,
      repartidorId,
    );
    const hojas = await this.hojas.exigirRendibles(
      tenantId,
      repartidorId,
      hojaIds,
    );
    const entregas = await this.entregas.listar(tenantId, {
      repartidorId,
      pendientes: true,
    });
    const aCuenta = entregas.reduce(
      (suma, e) => suma.plus(e.monto),
      new Decimal(0),
    );
    return this.armar(tenantId, {
      id: null,
      repartidorId,
      repartidorNombre: repartidor.nombre,
      rendidaEl: null,
      hojas,
      entregas,
      totales: sumar(
        hojas.map((h) => h.totales),
        aCuenta,
      ),
    });
  }

  /**
   * Cierra la cuenta del repartidor sobre las hojas elegidas, todo o nada. Orden de bloqueo:
   * repartidor `FOR SHARE` → hojas `FOR UPDATE` por `hoja_ruta_id` ascendente. Las entregas de
   * plata pendientes se reclaman con UN `UPDATE … WHERE rendicion_id IS NULL … RETURNING monto` y
   * se suman de lo devuelto: una entrega que otra pestaña editó, anuló o creó a la vez queda
   * dentro con su monto final o fuera para la próxima, nunca contada dos veces ni perdida.
   */
  async rendir(
    tenantId: string,
    dto: RendirDto,
    usuarioId: string | null,
  ): Promise<RendicionDetalle> {
    return this.db.transaccion(async () => {
      await this.repartidores.exigirExistente(tenantId, dto.repartidorId, {
        bloquear: true,
      });
      const hojas = await this.hojas.exigirRendibles(
        tenantId,
        dto.repartidorId,
        dto.hojaIds,
        { bloquear: true },
      );

      // La fila nace con lo de las hojas y sin entregas: las hojas y las entregas la apuntan por
      // clave foránea, así que tiene que existir antes de congelarlas y reclamarlas.
      const sinEntregas = sumar(
        hojas.map((h) => h.totales),
        new Decimal(0),
      );
      const creadas = unwrap<{ rendicion_id: string }>(
        await this.db.query(
          `INSERT INTO rendiciones
             (tenant_id, repartidor_id, rendida_por, total_entregados, monto_cobrado_destino,
              monto_cobrado_efectivo, monto_cobrado_transferencia, monto_pago_repartidor,
              monto_entregado_a_cuenta, saldo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING rendicion_id`,
          [
            tenantId,
            dto.repartidorId,
            usuarioId,
            sinEntregas.entregados,
            sinEntregas.montoCobradoDestino,
            sinEntregas.montoCobradoEfectivo,
            sinEntregas.montoCobradoTransferencia,
            sinEntregas.montoPagoRepartidor,
            sinEntregas.montoEntregadoACuenta,
            sinEntregas.saldo,
          ],
        ),
      );
      const rendicionId = creadas[0].rendicion_id;

      // Un bucle de escrituras acotado (a lo sumo 62 hojas por el DTO) y sin lecturas adentro:
      // `congelar` sigue siendo la única que escribe una hoja rendida, con los totales que
      // `exigirRendibles` ya calculó para ella.
      for (const h of hojas) {
        await this.hojas.congelar(
          tenantId,
          h.id,
          usuarioId,
          h.totales,
          rendicionId,
        );
      }

      const reclamadas = unwrap<{ monto: string }>(
        await this.db.query(
          `UPDATE entregas_repartidor SET rendicion_id = $2, actualizado_el = now()
            WHERE tenant_id = $1 AND repartidor_id = $3
              AND rendicion_id IS NULL AND eliminado_el IS NULL
            RETURNING monto`,
          [tenantId, rendicionId, dto.repartidorId],
        ),
      );
      const totales = sumar(
        hojas.map((h) => h.totales),
        reclamadas.reduce((suma, e) => suma.plus(e.monto), new Decimal(0)),
      );
      await this.db.query(
        `UPDATE rendiciones SET monto_entregado_a_cuenta = $3, saldo = $4, actualizado_el = now()
          WHERE rendicion_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
        [rendicionId, tenantId, totales.montoEntregadoACuenta, totales.saldo],
      );
      return this.detalle(tenantId, rendicionId);
    });
  }

  /** Lo que la rendición congeló: no depende de ninguna tarifa ni paquete de hoy. */
  async detalle(
    tenantId: string,
    rendicionId: string,
  ): Promise<RendicionDetalle> {
    const filas: FilaRendicion[] = await this.db.query(
      `SELECT r.rendicion_id, r.repartidor_id, rep.nombre AS repartidor_nombre, r.rendida_el,
              r.total_entregados, r.monto_cobrado_destino, r.monto_cobrado_efectivo,
              r.monto_cobrado_transferencia, r.monto_pago_repartidor,
              r.monto_entregado_a_cuenta, r.saldo
         FROM rendiciones r
         JOIN repartidores rep ON rep.repartidor_id = r.repartidor_id
                              AND rep.tenant_id = r.tenant_id AND rep.eliminado_el IS NULL
        WHERE r.rendicion_id = $1 AND r.tenant_id = $2 AND r.eliminado_el IS NULL`,
      [rendicionId, tenantId],
    );
    if (!filas.length) throw new NotFoundException('Rendición no encontrada');
    const r = filas[0];
    const hojas = await this.hojas.filasDeRendicion(tenantId, rendicionId);
    return this.armar(tenantId, {
      id: r.rendicion_id,
      repartidorId: r.repartidor_id,
      repartidorNombre: r.repartidor_nombre,
      rendidaEl: r.rendida_el.toISOString(),
      hojas: hojas.map((h) => ({ id: h.id, fecha: h.fecha, totales: h })),
      entregas: await this.entregas.deRendicion(tenantId, rendicionId),
      totales: aTotales(r),
    });
  }

  /**
   * La planilla: una fila por día (hoja) y una columna por tarifa usada. La plata de cada día es
   * la de su hoja (`totales`); `porTarifa` es SOLO un conteo de líneas entregadas por tarifa.
   */
  private async armar(
    tenantId: string,
    base: Omit<RendicionDetalle, 'dias' | 'tarifas'> & {
      hojas: HojaConTotales[];
    },
  ): Promise<RendicionDetalle> {
    const { hojas, ...resto } = base;
    const lineas: FilaTarifa[] = await this.db.query(
      `SELECT l.hoja_ruta_id, l.tarifa_pago_id, t.nombre, COUNT(*)::int AS n,
              MAX(l.pago_repartidor) AS monto
         FROM hoja_ruta_paquetes l
         -- Sin eliminado_el en la tarifa, a propósito: una tarifa borrada sigue rotulando las
         -- entregas que ya pagó (la línea guarda su monto y no depende de ella).
         LEFT JOIN tarifas_pago t ON t.tarifa_pago_id = l.tarifa_pago_id
                                 AND t.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.hoja_ruta_id = ANY($2::uuid[])
          AND l.estado = 'entregado' AND l.eliminado_el IS NULL
        GROUP BY l.hoja_ruta_id, l.tarifa_pago_id, t.nombre`,
      [tenantId, hojas.map((h) => h.id)],
    );

    const porHoja = new Map<string, Record<string, number>>();
    const usadas = new Map<
      string,
      { id: string; nombre: string; monto: Decimal }
    >();
    for (const l of lineas) {
      const clave = l.tarifa_pago_id ?? SIN_TARIFA;
      porHoja.set(l.hoja_ruta_id, {
        ...porHoja.get(l.hoja_ruta_id),
        [clave]: l.n,
      });
      const antes = usadas.get(clave);
      usadas.set(clave, {
        id: clave,
        nombre: l.nombre ?? 'Sin tarifa',
        monto: antes ? Decimal.max(antes.monto, l.monto) : new Decimal(l.monto),
      });
    }

    // Por fecha ascendente (el orden de la planilla): las hojas pueden llegar en el de sus ids.
    const dias: DiaRendicion[] = [...hojas]
      .sort(
        (a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id),
      )
      .map((h) => ({
        hojaId: h.id,
        fecha: h.fecha,
        porTarifa: porHoja.get(h.id) ?? {},
        entregados: h.totales.entregados,
        montoPagoRepartidor: h.totales.montoPagoRepartidor,
        montoCobradoEfectivo: h.totales.montoCobradoEfectivo,
        montoCobradoTransferencia: h.totales.montoCobradoTransferencia,
        neto: h.totales.netoARendir,
      }));
    return {
      ...resto,
      dias,
      tarifas: [...usadas.values()]
        .sort(
          (a, b) =>
            a.monto.comparedTo(b.monto) || a.nombre.localeCompare(b.nombre),
        )
        .map((t) => ({
          id: t.id,
          nombre: t.nombre,
          monto: t.monto.toFixed(4),
        })),
    };
  }
}
