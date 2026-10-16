import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarCodigoPaquete } from './codigo-paquete';
import { AsignarDto } from './dto/asignar.dto';
import { EscanearDto } from './dto/escanear.dto';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';
import type {
  EstadoHoja,
  EstadoLinea,
  HojaRutaDetalle,
  LineaHoja,
  RespuestaEscaneo,
  ResultadoEscaneo,
  TotalesHoja,
} from './paqueteria.types';
import { RepartidoresService } from './repartidores.service';

interface FilaTotales {
  hoja_ruta_id: string;
  asignados: number;
  en_ruta: number;
  entregados: number;
  cobro_destino: number;
  monto_cobrado_destino: string;
  monto_pago_repartidor: string;
  monto_total_general: string;
}

interface FilaCabecera {
  id: string;
  repartidor_id: string;
  repartidor_nombre: string;
  fecha: string;
  estado: EstadoHoja;
  rendida_el: Date | null;
  total_asignados: number | null;
  total_entregados: number | null;
  total_cobro_destino: number | null;
  monto_cobrado_destino: string | null;
  monto_pago_repartidor: string | null;
  monto_total_general: string | null;
  neto_a_rendir: string | null;
}

interface FilaLinea {
  paquete_id: string;
  codigo: string;
  destinatario_nombre: string | null;
  direccion: string | null;
  comuna: string | null;
  cobro_en_destino: boolean;
  precio_envio: string;
  pago_repartidor: string;
  estado: EstadoLinea;
}

/** Una línea viva de un paquete, con la hoja y el repartidor a los que pertenece. */
interface LineaViva {
  id: string;
  paquete_id: string;
  estado: EstadoLinea;
  hoja_ruta_id: string;
  fecha: string;
  repartidor_nombre: string;
}

type Disponibilidad =
  | { tipo: 'libre'; reactivarId: string | null }
  | { tipo: 'en_esta_hoja' }
  | { tipo: 'ocupado'; motivo: string };

/** `'2026-10-12'` → `'12-10'`, sin pasar por `Date`: la fecha es un día, no un instante. */
const diaMes = (fecha: string): string => {
  const [, mes, dia] = fecha.split('-');
  return `${dia}-${mes}`;
};

const aTotales = (f: {
  asignados: number;
  en_ruta: number;
  entregados: number;
  cobro_destino: number;
  monto_cobrado_destino: string;
  monto_pago_repartidor: string;
  monto_total_general: string;
}): TotalesHoja => ({
  asignados: f.asignados,
  enRuta: f.en_ruta,
  entregados: f.entregados,
  cobroDestino: f.cobro_destino,
  montoCobradoDestino: f.monto_cobrado_destino,
  montoPagoRepartidor: f.monto_pago_repartidor,
  montoTotalGeneral: f.monto_total_general,
  // Plata con Decimal sobre los strings de `numeric`, nunca con `number`.
  netoARendir: new Decimal(f.monto_cobrado_destino)
    .minus(f.monto_pago_repartidor)
    .toFixed(4),
});

/**
 * Qué se puede hacer con un paquete a partir de sus líneas vivas (`en_ruta` y `entregado` de
 * cualquier hoja, más las de ESTA hoja). A lo sumo una línea `en_ruta` o `entregado` por
 * paquete: el índice único y el cerrojo del paquete lo garantizan.
 */
function disponibilidad(lineas: LineaViva[], hojaId: string): Disponibilidad {
  const entregada = lineas.find((l) => l.estado === 'entregado');
  if (entregada) {
    return {
      tipo: 'ocupado',
      motivo: `ya se entregó el ${diaMes(entregada.fecha)}`,
    };
  }
  const enRuta = lineas.find((l) => l.estado === 'en_ruta');
  if (enRuta) {
    return enRuta.hoja_ruta_id === hojaId
      ? { tipo: 'en_esta_hoja' }
      : {
          tipo: 'ocupado',
          motivo: `está con ${enRuta.repartidor_nombre} (hoja del ${diaMes(enRuta.fecha)})`,
        };
  }
  const intentoDeHoy = lineas.find(
    (l) => l.estado === 'no_entregado' && l.hoja_ruta_id === hojaId,
  );
  return { tipo: 'libre', reactivarId: intentoDeHoy?.id ?? null };
}

/**
 * Orden de bloqueo de TODO lo que escribe líneas de una hoja: repartidor (`FOR SHARE`) → hoja
 * (`FOR UPDATE`) → paquetes (`FOR UPDATE`, por `paquete_id` ascendente). Es el mismo que usan
 * `PaquetesService.update` (hoja → paquete) y `RepartidoresService.remove` (repartidor → hojas):
 * mientras todos lo respeten no hay ciclo, y quien lo rompa abre un deadlock.
 */
@Injectable()
export class HojasRutaService {
  constructor(
    private readonly db: Db,
    private readonly repartidores: RepartidoresService,
    private readonly configuracion: PaqueteConfiguracionService,
  ) {}

  /**
   * Resuelve UN código por llamada: lo crea si no existe y lo asigna a la hoja del repartidor de
   * ese día. El `cobroEnDestino` del interruptor solo vale para un paquete que este escaneo
   * crea: uno existente conserva el suyo (spec § 3 regla 5b).
   */
  async escanear(
    tenantId: string,
    dto: EscanearDto,
  ): Promise<RespuestaEscaneo> {
    const codigo = normalizarCodigoPaquete(dto.codigo);
    return this.db.transaccion(async () => {
      await this.repartidores.exigirActivo(tenantId, dto.repartidorId, {
        bloquear: true,
      });
      const hoja = await this.abrirOTomarHoja(
        tenantId,
        dto.repartidorId,
        dto.fecha,
      );

      let resultado: ResultadoEscaneo = 'asignado';
      let paqueteId = await this.bloquearPaquete(tenantId, codigo);
      if (!paqueteId) {
        const defaults = await this.configuracion.exigirDefaults(tenantId);
        const nuevo = unwrap<{ paquete_id: string }>(
          await this.db.query(
            `INSERT INTO paquetes (tenant_id, codigo, cobro_en_destino, precio_envio, pago_repartidor)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, codigo) WHERE eliminado_el IS NULL DO NOTHING
             RETURNING paquete_id`,
            [
              tenantId,
              codigo,
              dto.cobroEnDestino,
              defaults.precioEnvio,
              defaults.pagoRepartidor,
            ],
          ),
        );
        if (nuevo.length) {
          paqueteId = nuevo[0].paquete_id;
          resultado = 'asignado_nuevo';
        } else {
          // Lo creó un escaneo concurrente de otra hoja (el de esta lo frenó el cerrojo de la
          // hoja): se sigue como un paquete que ya existía.
          paqueteId = await this.bloquearPaquete(tenantId, codigo);
          if (!paqueteId) {
            throw new ConflictException(
              `El paquete ${codigo} cambió mientras se escaneaba: volvé a escanearlo.`,
            );
          }
        }
      }

      const lineas = await this.lineasVivas(tenantId, [paqueteId], hoja.id);
      const estado = disponibilidad(lineas, hoja.id);
      if (estado.tipo === 'ocupado') {
        throw new ConflictException(`El paquete ${codigo} ${estado.motivo}.`);
      }
      if (estado.tipo === 'en_esta_hoja') {
        resultado = 'ya_escaneado';
      } else if (estado.reactivarId) {
        await this.reactivar(tenantId, [estado.reactivarId]);
      } else {
        await this.db.query(
          `INSERT INTO hoja_ruta_paquetes (tenant_id, hoja_ruta_id, paquete_id)
           VALUES ($1, $2, $3)`,
          [tenantId, hoja.id, paqueteId],
        );
      }
      return {
        resultado,
        codigo,
        hoja: await this.detalle(tenantId, hoja.id),
      };
    });
  }

  /** Todo o nada: si un paquete no está disponible no se asigna ninguno y se nombran los códigos. */
  async asignar(tenantId: string, dto: AsignarDto): Promise<HojaRutaDetalle> {
    return this.db.transaccion(async () => {
      await this.repartidores.exigirActivo(tenantId, dto.repartidorId, {
        bloquear: true,
      });
      const hoja = await this.abrirOTomarHoja(
        tenantId,
        dto.repartidorId,
        dto.fecha,
      );

      // `ORDER BY ... FOR UPDATE` bloquea en el orden del `ORDER BY`: dos asignaciones con
      // paquetes en común los toman en el mismo orden y no se cruzan.
      const paquetes: { paquete_id: string; codigo: string }[] =
        await this.db.query(
          `SELECT paquete_id, codigo FROM paquetes
            WHERE tenant_id = $1 AND paquete_id = ANY($2::uuid[]) AND eliminado_el IS NULL
            ORDER BY paquete_id
            FOR UPDATE`,
          [tenantId, dto.paqueteIds],
        );
      if (paquetes.length !== dto.paqueteIds.length) {
        throw new NotFoundException('Alguno de los paquetes no existe.');
      }

      const lineas = await this.lineasVivas(tenantId, dto.paqueteIds, hoja.id);
      const porPaquete = new Map<string, LineaViva[]>();
      for (const l of lineas) {
        porPaquete.set(l.paquete_id, [
          ...(porPaquete.get(l.paquete_id) ?? []),
          l,
        ]);
      }

      const rechazados: string[] = [];
      const reactivar: string[] = [];
      const nuevos: string[] = [];
      for (const p of paquetes) {
        const estado = disponibilidad(
          porPaquete.get(p.paquete_id) ?? [],
          hoja.id,
        );
        if (estado.tipo === 'ocupado') {
          rechazados.push(`${p.codigo} ${estado.motivo}`);
        } else if (estado.tipo === 'en_esta_hoja') {
          rechazados.push(`${p.codigo} ya está en esta hoja`);
        } else if (estado.reactivarId) {
          reactivar.push(estado.reactivarId);
        } else {
          nuevos.push(p.paquete_id);
        }
      }
      if (rechazados.length) {
        throw new BadRequestException(
          `No se asignó ninguno: ${rechazados.join('; ')}.`,
        );
      }

      if (reactivar.length) await this.reactivar(tenantId, reactivar);
      if (nuevos.length) {
        await this.db.query(
          `INSERT INTO hoja_ruta_paquetes (tenant_id, hoja_ruta_id, paquete_id)
           SELECT $1, $2, unnest($3::uuid[])`,
          [tenantId, hoja.id, nuevos],
        );
      }
      return this.detalle(tenantId, hoja.id);
    });
  }

  /** Cabecera + líneas (la más reciente primero) + totales; 404 si la hoja no es del tenant. */
  async detalle(tenantId: string, hojaId: string): Promise<HojaRutaDetalle> {
    const cabeceras: FilaCabecera[] = await this.db.query(
      `SELECT h.hoja_ruta_id AS id, h.repartidor_id, r.nombre AS repartidor_nombre,
              h.fecha::text AS fecha, h.estado, h.rendida_el,
              h.total_asignados, h.total_entregados, h.total_cobro_destino,
              h.monto_cobrado_destino, h.monto_pago_repartidor,
              h.monto_total_general, h.neto_a_rendir
         FROM hojas_ruta h
         JOIN repartidores r ON r.repartidor_id = h.repartidor_id
                            AND r.tenant_id = h.tenant_id AND r.eliminado_el IS NULL
        WHERE h.hoja_ruta_id = $1 AND h.tenant_id = $2 AND h.eliminado_el IS NULL`,
      [hojaId, tenantId],
    );
    if (!cabeceras.length) {
      throw new NotFoundException('Hoja de ruta no encontrada');
    }
    const c = cabeceras[0];

    const lineas: FilaLinea[] = await this.db.query(
      `SELECT p.paquete_id, p.codigo, p.destinatario_nombre, p.direccion, p.comuna,
              p.cobro_en_destino, p.precio_envio, p.pago_repartidor, l.estado
         FROM hoja_ruta_paquetes l
         JOIN paquetes p ON p.paquete_id = l.paquete_id
                        AND p.tenant_id = l.tenant_id AND p.eliminado_el IS NULL
        WHERE l.hoja_ruta_id = $1 AND l.tenant_id = $2 AND l.eliminado_el IS NULL
        ORDER BY l.creado_el DESC, l.hoja_ruta_paquete_id`,
      [hojaId, tenantId],
    );

    // Una hoja rendida lee lo que congeló al rendir (no hay línea `en_ruta`: rendir lo exige);
    // una abierta, el cálculo en vivo.
    const totales: TotalesHoja =
      c.estado === 'rendida'
        ? aTotales({
            asignados: c.total_asignados ?? 0,
            en_ruta: 0,
            entregados: c.total_entregados ?? 0,
            cobro_destino: c.total_cobro_destino ?? 0,
            monto_cobrado_destino: c.monto_cobrado_destino ?? '0.0000',
            monto_pago_repartidor: c.monto_pago_repartidor ?? '0.0000',
            monto_total_general: c.monto_total_general ?? '0.0000',
          })
        : (await this.totales(tenantId, [hojaId])).get(hojaId)!;

    return {
      id: c.id,
      repartidorId: c.repartidor_id,
      repartidorNombre: c.repartidor_nombre,
      fecha: c.fecha,
      estado: c.estado,
      rendidaEl: c.rendida_el ? c.rendida_el.toISOString() : null,
      ...totales,
      lineas: lineas.map(
        (l): LineaHoja => ({
          paqueteId: l.paquete_id,
          codigo: l.codigo,
          destinatarioNombre: l.destinatario_nombre,
          direccion: l.direccion,
          comuna: l.comuna,
          cobroEnDestino: l.cobro_en_destino,
          precioEnvio: l.precio_envio,
          pagoRepartidor: l.pago_repartidor,
          estado: l.estado,
        }),
      ),
    };
  }

  /**
   * La ÚNICA consulta de totales (spec § 7): la usan el detalle, la lista y, al rendir, la que
   * produce lo que se congela. Calcula en vivo sobre las líneas; leer lo congelado de una hoja
   * rendida es cosa de quien la lee.
   */
  async totales(
    tenantId: string,
    hojaIds: string[],
  ): Promise<Map<string, TotalesHoja>> {
    const filas: FilaTotales[] = await this.db.query(
      `SELECT h.hoja_ruta_id,
              COUNT(l.hoja_ruta_paquete_id)::int                                          AS asignados,
              COUNT(*) FILTER (WHERE l.estado = 'en_ruta')::int                           AS en_ruta,
              COUNT(*) FILTER (WHERE l.estado = 'entregado')::int                         AS entregados,
              COUNT(*) FILTER (WHERE l.estado = 'entregado' AND p.cobro_en_destino)::int  AS cobro_destino,
              COALESCE(SUM(p.precio_envio) FILTER (WHERE l.estado = 'entregado' AND p.cobro_en_destino), 0::numeric(18,4)) AS monto_cobrado_destino,
              COALESCE(SUM(p.pago_repartidor) FILTER (WHERE l.estado = 'entregado'), 0::numeric(18,4))                     AS monto_pago_repartidor,
              COALESCE(SUM(p.precio_envio) FILTER (WHERE l.estado = 'entregado'), 0::numeric(18,4))                        AS monto_total_general
         FROM hojas_ruta h
         LEFT JOIN hoja_ruta_paquetes l ON l.hoja_ruta_id = h.hoja_ruta_id
                                       AND l.tenant_id = h.tenant_id AND l.eliminado_el IS NULL
         LEFT JOIN paquetes p ON p.paquete_id = l.paquete_id
                             AND p.tenant_id = h.tenant_id AND p.eliminado_el IS NULL
        WHERE h.tenant_id = $1 AND h.hoja_ruta_id = ANY($2::uuid[]) AND h.eliminado_el IS NULL
        GROUP BY h.hoja_ruta_id`,
      [tenantId, hojaIds],
    );
    return new Map(filas.map((f) => [f.hoja_ruta_id, aTotales(f)]));
  }

  /**
   * Crea la hoja de ese repartidor ese día o toma la que hay, y la deja bloqueada (`FOR UPDATE`)
   * hasta que termine la transacción del llamador. El `INSERT … DO NOTHING` seguido del
   * `SELECT … FOR UPDATE` son dos sentencias a propósito: la segunda toma su propio snapshot y
   * ve la hoja que una transacción concurrente acaba de confirmar.
   */
  private async abrirOTomarHoja(
    tenantId: string,
    repartidorId: string,
    fecha: string,
  ): Promise<{ id: string; estado: EstadoHoja }> {
    await this.db.query(
      `INSERT INTO hojas_ruta (tenant_id, repartidor_id, fecha)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, repartidor_id, fecha) WHERE eliminado_el IS NULL DO NOTHING`,
      [tenantId, repartidorId, fecha],
    );
    const hojas: { id: string; estado: EstadoHoja }[] = await this.db.query(
      `SELECT hoja_ruta_id AS id, estado FROM hojas_ruta
        WHERE tenant_id = $1 AND repartidor_id = $2 AND fecha = $3 AND eliminado_el IS NULL
        FOR UPDATE`,
      [tenantId, repartidorId, fecha],
    );
    const hoja = hojas[0];
    if (hoja.estado === 'rendida') {
      throw new BadRequestException(
        'La hoja de ruta de ese día ya está rendida: elegí otra fecha.',
      );
    }
    return hoja;
  }

  /** El filtro de borrado va en el mismo `WHERE` del cerrojo: un `remove` que gane lo deja sin fila (404/409), no con una línea sobre un paquete borrado. */
  private async bloquearPaquete(
    tenantId: string,
    codigo: string,
  ): Promise<string | undefined> {
    const filas: { paquete_id: string }[] = await this.db.query(
      `SELECT paquete_id FROM paquetes
        WHERE tenant_id = $1 AND codigo = $2 AND eliminado_el IS NULL
        FOR UPDATE`,
      [tenantId, codigo],
    );
    return filas[0]?.paquete_id;
  }

  /** Una consulta para todos los paquetes (sin N+1): sus líneas ocupadas y los intentos de esta hoja. */
  private lineasVivas(
    tenantId: string,
    paqueteIds: string[],
    hojaId: string,
  ): Promise<LineaViva[]> {
    return this.db.query(
      `SELECT l.hoja_ruta_paquete_id AS id, l.paquete_id, l.estado, l.hoja_ruta_id,
              h.fecha::text AS fecha, r.nombre AS repartidor_nombre
         FROM hoja_ruta_paquetes l
         JOIN hojas_ruta h ON h.hoja_ruta_id = l.hoja_ruta_id
                          AND h.tenant_id = l.tenant_id AND h.eliminado_el IS NULL
         JOIN repartidores r ON r.repartidor_id = h.repartidor_id
                            AND r.tenant_id = h.tenant_id AND r.eliminado_el IS NULL
        WHERE l.tenant_id = $1 AND l.paquete_id = ANY($2::uuid[]) AND l.eliminado_el IS NULL
          AND (l.estado IN ('en_ruta', 'entregado') OR l.hoja_ruta_id = $3)`,
      [tenantId, paqueteIds, hojaId],
    );
  }

  /** Reintento del mismo día: el `no_entregado` de esta hoja vuelve a `en_ruta`, sin línea nueva. */
  private async reactivar(tenantId: string, lineaIds: string[]): Promise<void> {
    await this.db.query(
      `UPDATE hoja_ruta_paquetes SET estado = 'en_ruta', actualizado_el = now()
        WHERE tenant_id = $1 AND hoja_ruta_paquete_id = ANY($2::uuid[]) AND eliminado_el IS NULL`,
      [tenantId, lineaIds],
    );
  }
}
