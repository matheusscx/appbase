import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull } from 'typeorm';
import {
  CuentaAsignacion,
  MotivoCuentaAsignacion,
} from './entities/cuenta-asignacion.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';

export interface CuentaAsignacionDetalle {
  id: string;
  garzonId: string;
  garzonNombre: string | null;
  desdeEl: Date;
  hastaEl: Date | null;
  motivo: MotivoCuentaAsignacion;
  origenGarzonId: string | null;
  origenGarzonNombre: string | null;
  actorUsuarioId: string | null;
  actorUsuarioNombre: string | null;
}

@Injectable()
export class CuentaAsignacionesService implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly garzones: GarzonesService,
    private readonly sesiones: SesionesGarzonService,
  ) {}

  async registrarApertura(
    manager: EntityManager,
    cuenta: Cuenta,
    garzonId: string,
  ): Promise<void> {
    await manager.save(
      CuentaAsignacion,
      manager.create(CuentaAsignacion, {
        tenantId: cuenta.tenantId,
        cuentaId: cuenta.id,
        garzonId,
        desdeEl: cuenta.abiertaEl ?? new Date(),
        hastaEl: null,
        motivo: MotivoCuentaAsignacion.APERTURA,
        origenGarzonId: null,
        actorUsuarioId: null,
      }),
    );
  }

  async transferirPorPin(
    tenantId: string,
    cuentaId: string,
    pin: string,
  ): Promise<Cuenta> {
    const destino = await this.garzones.resolverGarzonPorPin(tenantId, pin);
    await this.sesiones.assertSesionAbierta(tenantId, destino.id);
    return this.transferir(
      tenantId,
      cuentaId,
      destino.id,
      MotivoCuentaAsignacion.TRANSFERENCIA_PIN,
      null,
    );
  }

  async transferirAdmin(
    tenantId: string,
    usuarioId: string,
    cuentaId: string,
    garzonId: string,
  ): Promise<Cuenta> {
    await this.garzones.obtenerActivoPorId(tenantId, garzonId);
    await this.sesiones.assertSesionAbierta(tenantId, garzonId);
    return this.transferir(
      tenantId,
      cuentaId,
      garzonId,
      MotivoCuentaAsignacion.TRANSFERENCIA_ADMIN,
      usuarioId,
    );
  }

  async cerrarTramoVigente(
    manager: EntityManager,
    tenantId: string,
    cuentaId: string,
    hastaEl: Date,
  ): Promise<void> {
    await manager.update(
      CuentaAsignacion,
      { cuentaId, tenantId, hastaEl: IsNull() },
      { hastaEl },
    );
  }

  async listar(
    tenantId: string,
    cuentaId: string,
  ): Promise<CuentaAsignacionDetalle[]> {
    const rows: {
      cuenta_asignacion_id: string;
      garzon_id: string;
      garzon_nombre: string | null;
      desde_el: Date;
      hasta_el: Date | null;
      motivo: MotivoCuentaAsignacion;
      origen_garzon_id: string | null;
      origen_garzon_nombre: string | null;
      actor_usuario_id: string | null;
      actor_usuario_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT ca.cuenta_asignacion_id,
              ca.garzon_id,
              g.nombre AS garzon_nombre,
              ca.desde_el,
              ca.hasta_el,
              ca.motivo,
              ca.origen_garzon_id,
              go.nombre AS origen_garzon_nombre,
              ca.actor_usuario_id,
              u.nombre AS actor_usuario_nombre
         FROM cuenta_asignaciones ca
         LEFT JOIN garzones g
           ON g.garzon_id = ca.garzon_id AND g.eliminado_el IS NULL
         LEFT JOIN garzones go
           ON go.garzon_id = ca.origen_garzon_id AND go.eliminado_el IS NULL
         LEFT JOIN usuarios u
           ON u.usuario_id = ca.actor_usuario_id AND u.eliminado_el IS NULL
        WHERE ca.tenant_id = $1
          AND ca.cuenta_id = $2
          AND ca.eliminado_el IS NULL
        ORDER BY ca.desde_el ASC`,
      [tenantId, cuentaId],
    );

    return rows.map((r) => ({
      id: r.cuenta_asignacion_id,
      garzonId: r.garzon_id,
      garzonNombre: r.garzon_nombre,
      desdeEl: r.desde_el,
      hastaEl: r.hasta_el,
      motivo: r.motivo,
      origenGarzonId: r.origen_garzon_id,
      origenGarzonNombre: r.origen_garzon_nombre,
      actorUsuarioId: r.actor_usuario_id,
      actorUsuarioNombre: r.actor_usuario_nombre,
    }));
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`
      UPDATE cuentas
         SET garzon_responsable_id = garzon_apertura_id
       WHERE garzon_responsable_id IS NULL
         AND garzon_apertura_id IS NOT NULL
    `);
      await manager.query(`
      INSERT INTO cuenta_asignaciones (
        tenant_id, cuenta_id, garzon_id, desde_el, hasta_el, motivo
      )
      SELECT c.tenant_id,
             c.cuenta_id,
             c.garzon_apertura_id,
             c.abierta_el,
             CASE WHEN c.estado = 'abierta' THEN NULL ELSE c.cerrada_el END,
             'apertura'
        FROM cuentas c
       WHERE c.garzon_apertura_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM cuenta_asignaciones ca
            WHERE ca.cuenta_id = c.cuenta_id
              AND ca.eliminado_el IS NULL
         )
    `);
    });
  }

  private async transferir(
    tenantId: string,
    cuentaId: string,
    destinoGarzonId: string,
    motivo: MotivoCuentaAsignacion,
    actorUsuarioId: string | null,
  ): Promise<Cuenta> {
    return this.dataSource.transaction(async (manager) => {
      const cuenta = await manager.findOne(Cuenta, {
        where: { id: cuentaId, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!cuenta) throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
      if (cuenta.estado !== EstadoCuenta.ABIERTA) {
        throw new BadRequestException('La cuenta no está abierta');
      }
      if (cuenta.garzonResponsableId === destinoGarzonId) {
        throw new BadRequestException(
          'El garzón ya es responsable de la cuenta',
        );
      }

      const ahora = new Date();
      await this.cerrarTramoVigente(manager, tenantId, cuentaId, ahora);
      await manager.save(
        CuentaAsignacion,
        manager.create(CuentaAsignacion, {
          tenantId,
          cuentaId,
          garzonId: destinoGarzonId,
          desdeEl: ahora,
          hastaEl: null,
          motivo,
          origenGarzonId: cuenta.garzonResponsableId,
          actorUsuarioId,
        }),
      );
      cuenta.garzonResponsableId = destinoGarzonId;
      return manager.save(Cuenta, cuenta);
    });
  }
}
