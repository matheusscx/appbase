import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { TenantMetodoPago } from './entities/tenant-metodo-pago.entity';
import { UpdateTenantMetodoPagoDto } from './dto/update-tenant-metodo-pago.dto';

export interface MetodoPagoTenant {
  metodoPagoId: string;
  nombre: string;
  abreviatura: string | null;
  habilitada: boolean;
  permiteVuelto: boolean;
}

@Injectable()
export class MetodosPagoService {
  constructor(
    @InjectRepository(TenantMetodoPago)
    private readonly tenantMetodoPagoRepo: Repository<TenantMetodoPago>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Lectura
  // ───────────────────────────────────────────────────────────────────────────

  async findMetodosPago(tenantId: string): Promise<MetodoPagoTenant[]> {
    const rows: {
      metodo_pago_id: string;
      nombre: string;
      abreviatura: string | null;
      habilitada: boolean;
      permite_vuelto: boolean;
    }[] = await this.dataSource.query(
      `SELECT mp.metodo_pago_id,
              mp.nombre,
              mp.abreviatura,
              COALESCE(tmp.habilitada, false) AS habilitada,
              COALESCE(tmp.permite_vuelto, false) AS permite_vuelto
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       JOIN metodo_pago_pais mpp ON mpp.pais_id = p.pais_id
            AND mpp.eliminado_el IS NULL
       JOIN metodos_pago mp ON mp.metodo_pago_id = mpp.metodo_pago_id
            AND mp.eliminado_el IS NULL
       LEFT JOIN tenant_metodo_pago tmp ON tmp.tenant_id = t.tenant_id
            AND tmp.metodo_pago_id = mp.metodo_pago_id
            AND tmp.eliminado_el IS NULL
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
       ORDER BY mp.nombre ASC`,
      [tenantId],
    );

    return rows.map((r) => ({
      metodoPagoId: r.metodo_pago_id,
      nombre: r.nombre,
      abreviatura: r.abreviatura,
      habilitada: r.habilitada === true,
      permiteVuelto: r.permite_vuelto === true,
    }));
  }

  /**
   * Resuelve server-side el método de pago contable de crédito habilitado del
   * tenant (el que se registra en el pago de una venta pagada con tarjeta). Es
   * el método habilitado cuyo nombre incluye "crédito"; si no hay, cae al primer
   * habilitado. Compartido por el checkout online y las suscripciones Oneclick.
   */
  async resolverMetodoCredito(tenantId: string): Promise<string> {
    const habilitados = (await this.findMetodosPago(tenantId)).filter(
      (m) => m.habilitada,
    );
    const credito =
      habilitados.find((m) =>
        ['crédito', 'credito'].some((t) => m.nombre.toLowerCase().includes(t)),
      ) ?? habilitados[0];
    if (!credito)
      throw new BadRequestException(
        'No hay métodos de pago habilitados para la tienda online',
      );
    return credito.metodoPagoId;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Mutaciones
  // ───────────────────────────────────────────────────────────────────────────

  async updateMetodoPago(
    tenantId: string,
    metodoPagoId: string,
    dto: UpdateTenantMetodoPagoDto,
  ): Promise<TenantMetodoPago> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertDisponible(manager, tenantId, metodoPagoId);

      const row = await this.upsertRow(manager, tenantId, metodoPagoId);

      if (dto.habilitada !== undefined) row.habilitada = dto.habilitada;
      if (dto.permiteVuelto !== undefined)
        row.permiteVuelto = dto.permiteVuelto;

      return manager.save(TenantMetodoPago, row);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  private async assertDisponible(
    manager: EntityManager,
    tenantId: string,
    metodoPagoId: string,
  ): Promise<void> {
    const rows: { en_pais: boolean }[] = await manager.query(
      `SELECT (mpp.metodo_pago_id IS NOT NULL) AS en_pais
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
       LEFT JOIN metodo_pago_pais mpp ON mpp.pais_id = p.pais_id
            AND mpp.metodo_pago_id = $2 AND mpp.eliminado_el IS NULL
       WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId, metodoPagoId],
    );

    if (!rows.length) {
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    }
    if (rows[0].en_pais !== true) {
      throw new NotFoundException(
        `Método de pago ${metodoPagoId} no disponible para el país del tenant`,
      );
    }
  }

  /** Devuelve la fila tenant_metodo_pago existente (restaurada si estaba borrada) o una nueva sin persistir. */
  private async upsertRow(
    manager: EntityManager,
    tenantId: string,
    metodoPagoId: string,
  ): Promise<TenantMetodoPago> {
    const existing = await manager.findOne(TenantMetodoPago, {
      where: { tenantId, metodoPagoId },
      withDeleted: true,
    });
    if (existing) {
      existing.eliminadoEl = null;
      return existing;
    }
    return manager.create(TenantMetodoPago, {
      tenantId,
      metodoPagoId,
      habilitada: false,
      permiteVuelto: false,
    });
  }
}
