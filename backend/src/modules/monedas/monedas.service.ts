import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Db } from '../../common/db/db.service';
import type { ModoRedondeo } from '../calculo-precios/calculo-precios.engine';
import { TenantMoneda } from './entities/tenant-moneda.entity';
import { UpdateTenantMonedaDto } from './dto/update-tenant-moneda.dto';

export interface MonedaTenant {
  monedaId: string;
  nombre: string;
  codigoIso: string;
  simbolo: string | null;
  decimales: number;
  separadorDecimal: string;
  separadorMiles: string;
  locale: string;
  habilitada: boolean;
  esOficial: boolean;
  valorDelDia: string | null;
}

interface ContextoMoneda {
  monedaOficialId: string | null;
  enPais: boolean;
}

@Injectable()
export class MonedasService {
  constructor(
    @InjectRepository(TenantMoneda)
    private readonly tenantMonedaRepo: Repository<TenantMoneda>,
    private readonly db: Db,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Lectura
  // ───────────────────────────────────────────────────────────────────────────

  async findMonedas(tenantId: string): Promise<MonedaTenant[]> {
    const rows: {
      moneda_id: string;
      nombre: string;
      codigo_iso: string;
      simbolo: string | null;
      decimales: number | string;
      separador_decimal: string;
      separador_miles: string;
      locale: string;
      es_oficial: boolean;
      habilitada: boolean;
      valor_del_dia: string | null;
    }[] = await this.db.query(
      `SELECT m.moneda_id,
              m.nombre,
              m.codigo_iso,
              m.simbolo,
              m.decimales,
              m.separador_decimal,
              m.separador_miles,
              m.locale,
              -- La moneda del PAIS (ADR-005). Es la UNICA nocion de "oficial"
              -- del sistema: decide la escala de toda la plata del tenant y es
              -- la moneda a la que se convierten los totales. El orden de la
              -- lista tambien sale de aca (ORDER BY es_oficial DESC).
              (m.moneda_id = p.moneda_oficial_id) AS es_oficial,
              COALESCE(tm.habilitada, false) AS habilitada,
              tm.valor_del_dia
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN pais_moneda pm ON pm.pais_id = p.pais_id AND pm.eliminado_el IS NULL
       JOIN moneda m ON m.moneda_id = pm.moneda_id AND m.eliminado_el IS NULL
       LEFT JOIN tenant_moneda tm ON tm.tenant_id = t.tenant_id
            AND tm.moneda_id = m.moneda_id AND tm.eliminado_el IS NULL
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
       ORDER BY es_oficial DESC, m.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => {
      const esOficial = r.es_oficial === true;
      return {
        monedaId: r.moneda_id,
        nombre: r.nombre,
        codigoIso: r.codigo_iso?.trim(),
        simbolo: r.simbolo,
        decimales: Number(r.decimales),
        separadorDecimal: r.separador_decimal?.trim() ?? ',',
        separadorMiles: r.separador_miles?.trim() ?? '.',
        locale: r.locale?.trim() ?? 'es-CL',
        esOficial,
        // La oficial está siempre habilitada y su tasa es fija en 1
        habilitada: esOficial ? true : r.habilitada === true,
        valorDelDia: esOficial ? '1' : r.valor_del_dia,
      };
    });
  }

  /**
   * `moneda.decimales` de la moneda **oficial del país** del tenant. El motor de
   * precios la usa para congelar la escala a la que cuantiza el documento
   * (`ConfigCalculo.decimalesMoneda`) y `EscalaMonedaPipe` para rechazar en el
   * borde la plata que no cabe. Una consulta, no una por línea.
   *
   * ⚠️ **Hubo un tiempo en que esto leía otro campo, y vale saberlo.** Hasta el
   * 2026-08-21 existía `tenant_moneda.es_default` y esta función resolvía la
   * escala con él, con un docblock que lo justificaba diciendo *"es la misma
   * moneda a la que `ventas` convierte y persiste los totales"*. Era falso justo
   * cuando diferían: la conversión multiplica por `valor_del_dia` y a la moneda
   * del **país** se le fuerza `1`, así que los totales aterrizaban en pesos
   * mientras la escala salía de otra moneda. Medido: un ítem de 4,5674 UF daba
   * un total de `222.085,7822` pesos en vez de `222.086`.
   *
   * **Ese campo ya no existe.** Se eliminó junto con su endpoint porque no hacía
   * ningún trabajo de presentación —el orden de la lista sale de `es_oficial`— y
   * su única conducta real era decidir plata por un camino distinto al del resto
   * del sistema. Hoy "oficial" nombra **una sola cosa**.
   *
   * Es la misma consulta que `LiquidacionPropinasService.resolverMonedaOficial`,
   * y eso es deliberado: la escala con la que se cuantiza una venta y la escala
   * con la que se reparte su propina tienen que salir de la misma moneda o el
   * reparto no puede representar lo que se cobró.
   */
  async decimalesOficiales(tenantId: string): Promise<number> {
    const rows: { decimales: number | string }[] = await this.db.query(
      `SELECT m.decimales
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         JOIN moneda m ON m.moneda_id = p.moneda_oficial_id
              AND m.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    if (!rows.length) {
      // Sin país o sin `moneda_oficial_id` no hay escala posible: no se asume
      // una. Es el mismo error que ya devolvía cuando faltaba la fila de
      // `tenant_moneda`, con otra causa.
      throw new BadRequestException(
        'El tenant no tiene moneda oficial configurada',
      );
    }
    return Number(rows[0].decimales);
  }

  /**
   * `moneda.decimales` de la moneda **con la que se registró la venta**, no la
   * oficial vigente del tenant: una nota de crédito o un reembolso corrigen
   * *ese* documento, y si el tenant cambia de moneda oficial después, el
   * ajuste viejo tiene que seguir cuantizando con la escala que tenía al
   * momento de venderse. Mismo criterio que `decimalesOficiales` — filtra
   * `eliminado_el IS NULL` en las dos tablas del JOIN y parametriza el
   * tenant — para que un reembolso no pueda leer la venta de otro tenant.
   *
   * Trae junto el `modoRedondeo` **congelado** en `ventas.config_calculo` de
   * esa misma fila — no una segunda consulta: el reembolso necesita los dos
   * datos de la misma venta para cuantizar (decisión (g) del plan de
   * redondeo: la corrección hereda el criterio del documento que corrige, no
   * el vigente). `modoRedondeo` viene `null` si la venta no tiene
   * `config_calculo`. Eso **ya no es el caso general de toda NC**:
   * `VentasService.crearNotaCredito` congela la config heredada en la NC que
   * crea, así que hoy solo queda `null` cuando la venta referenciada tampoco
   * la tiene — dato roto aguas arriba, no un caso esperado. Devolverlo
   * `null` en vez de resolver un default acá es deliberado: qué hacer ante la
   * ausencia es una decisión de cada consumidor, no de este service — ver
   * `VentasReembolsoHandler.cuantizarMontoReembolso`, el único hoy.
   */
  async decimalesDeLaVenta(
    ventaId: string,
    tenantId: string,
  ): Promise<{ decimales: number; modoRedondeo: ModoRedondeo | null }> {
    const rows: {
      decimales: number | string;
      // `config_calculo` es JSONB: lo que vuelve de la base no lo garantiza
      // ningún tipo, se relee casteado. El cast vive acá —una vez, en el borde—
      // y no repartido como `string` aguas abajo, que era lo que dejaba a un
      // modo inventado viajar hasta el motor sin que nadie lo notara.
      config_calculo: { modoRedondeo?: ModoRedondeo } | null;
    }[] = await this.db.query(
      `SELECT m.decimales, v.config_calculo
         FROM ventas v
         JOIN moneda m ON m.moneda_id = v.moneda_id AND m.eliminado_el IS NULL
        WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
      [ventaId, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException('Venta no encontrada');
    }
    return {
      decimales: Number(rows[0].decimales),
      modoRedondeo: rows[0].config_calculo?.modoRedondeo ?? null,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mutaciones
  // ───────────────────────────────────────────────────────────────────────────

  async updateMoneda(
    tenantId: string,
    monedaId: string,
    dto: UpdateTenantMonedaDto,
  ): Promise<TenantMoneda> {
    const ctx = await this.resolveContexto(this.db, tenantId, monedaId);
    const esOficial = monedaId === ctx.monedaOficialId;

    if (esOficial) {
      if (dto.habilitada === false) {
        throw new BadRequestException(
          'No se puede deshabilitar la moneda oficial',
        );
      }
      if (dto.valorDelDia !== undefined) {
        throw new BadRequestException(
          'La tasa de cambio de la moneda oficial es fija en 1',
        );
      }
    }

    // `upsertRow` necesita un `EntityManager` completo (`findOne`/`create`),
    // no solo `.query`. `db.transaccion` se lo da a través de la fachada:
    // abre una transacción propia (o reusa la del contexto si hubiera una) en
    // vez de tomar `dataSource.manager` directo.
    const row = await this.db.transaccion((manager) =>
      this.upsertRow(manager, tenantId, monedaId),
    );

    if (dto.habilitada !== undefined) row.habilitada = dto.habilitada;
    if (dto.valorDelDia !== undefined) row.valorDelDia = dto.valorDelDia;

    return this.tenantMonedaRepo.save(row);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async resolveContexto(
    manager: EntityManager | Db,
    tenantId: string,
    monedaId: string,
  ): Promise<ContextoMoneda> {
    const rows: { moneda_oficial_id: string | null; en_pais: boolean }[] =
      await manager.query(
        `SELECT p.moneda_oficial_id,
                (pm.moneda_id IS NOT NULL) AS en_pais
         FROM tenants t
         JOIN provincia prov ON prov.provincia_id = t.provincia_id
              AND prov.eliminado_el IS NULL
         JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
         LEFT JOIN pais_moneda pm ON pm.pais_id = p.pais_id
              AND pm.moneda_id = $2 AND pm.eliminado_el IS NULL
         WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
        [tenantId, monedaId],
      );

    if (!rows.length) {
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    }
    if (rows[0].en_pais !== true) {
      throw new NotFoundException(
        `Moneda ${monedaId} no disponible para el país del tenant`,
      );
    }
    return { monedaOficialId: rows[0].moneda_oficial_id, enPais: true };
  }

  /** Devuelve la fila tenant_moneda existente (restaurada si estaba borrada) o una nueva sin persistir. */
  private async upsertRow(
    manager: EntityManager,
    tenantId: string,
    monedaId: string,
  ): Promise<TenantMoneda> {
    const existing = await manager.findOne(TenantMoneda, {
      where: { tenantId, monedaId },
      withDeleted: true,
    });
    if (existing) {
      existing.eliminadoEl = null;
      return existing;
    }
    return manager.create(TenantMoneda, {
      tenantId,
      monedaId,
      habilitada: false,
      valorDelDia: null,
    });
  }
}
