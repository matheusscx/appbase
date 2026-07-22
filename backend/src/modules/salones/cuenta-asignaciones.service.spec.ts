import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import {
  CuentaAsignacion,
  MotivoCuentaAsignacion,
} from './entities/cuenta-asignacion.entity';
import { Cuenta, EstadoCuenta } from './entities/cuenta.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';

const TENANT = 'tenant-uuid';
const CUENTA = 'cuenta-uuid';
const ORIGEN = 'garzon-origen-uuid';
const DESTINO = 'garzon-destino-uuid';
const USUARIO = 'usuario-uuid';
const PIN = '123456';

describe('CuentaAsignacionesService', () => {
  let service: CuentaAsignacionesService;
  let garzones: {
    resolverGarzonPorPin: jest.Mock;
    obtenerActivoPorId: jest.Mock;
  };
  let sesiones: { assertSesionAbierta: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    garzones = {
      resolverGarzonPorPin: jest.fn(),
      obtenerActivoPorId: jest.fn(),
    };
    sesiones = {
      assertSesionAbierta: jest.fn().mockResolvedValue(undefined),
    };
    manager = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      save: jest.fn((_e: unknown, row: unknown) => Promise.resolve(row)),
      query: jest.fn().mockResolvedValue([]),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
      query: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CuentaAsignacionesService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: GarzonesService, useValue: garzones },
        { provide: SesionesGarzonService, useValue: sesiones },
      ],
    }).compile();

    service = module.get(CuentaAsignacionesService);
  });

  describe('transferirPorPin', () => {
    it('transfiere por PIN cerrando el tramo anterior y creando el nuevo', async () => {
      garzones.resolverGarzonPorPin.mockResolvedValue({
        id: DESTINO,
        activo: true,
      });
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: ORIGEN,
      });

      const result = await service.transferirPorPin(TENANT, CUENTA, PIN);

      expect(manager.findOne).toHaveBeenCalledWith(
        Cuenta,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(
        TENANT,
        DESTINO,
      );
      expect(manager.update).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          cuentaId: CUENTA,
          tenantId: TENANT,
          hastaEl: IsNull(),
        }),
        expect.objectContaining({ hastaEl: expect.any(Date) }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          garzonId: DESTINO,
          origenGarzonId: ORIGEN,
          motivo: MotivoCuentaAsignacion.TRANSFERENCIA_PIN,
          actorUsuarioId: null,
        }),
      );
      expect(result.garzonResponsableId).toBe(DESTINO);
    });

    it('cuenta inexistente → NotFoundException', async () => {
      garzones.resolverGarzonPorPin.mockResolvedValue({
        id: DESTINO,
        activo: true,
      });
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow(NotFoundException);
    });

    it('cuenta cerrada → BadRequestException', async () => {
      garzones.resolverGarzonPorPin.mockResolvedValue({
        id: DESTINO,
        activo: true,
      });
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.CERRADA,
        garzonResponsableId: ORIGEN,
      });

      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow('La cuenta no está abierta');
    });

    it('destino igual a responsable → BadRequestException', async () => {
      garzones.resolverGarzonPorPin.mockResolvedValue({
        id: ORIGEN,
        activo: true,
      });
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: ORIGEN,
      });

      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow('El garzón ya es responsable de la cuenta');
    });

    it('destino sin sesión propaga 400', async () => {
      garzones.resolverGarzonPorPin.mockResolvedValue({
        id: DESTINO,
        activo: true,
      });
      sesiones.assertSesionAbierta.mockRejectedValue(
        new BadRequestException(
          'El garzón no tiene una sesión de trabajo abierta',
        ),
      );

      await expect(
        service.transferirPorPin(TENANT, CUENTA, PIN),
      ).rejects.toThrow(BadRequestException);
      expect(manager.findOne).not.toHaveBeenCalled();
    });
  });

  describe('transferirAdmin', () => {
    it('admin registra actorUsuarioId y TRANSFERENCIA_ADMIN', async () => {
      garzones.obtenerActivoPorId.mockResolvedValue({
        id: DESTINO,
        activo: true,
      });
      manager.findOne.mockResolvedValue({
        id: CUENTA,
        tenantId: TENANT,
        estado: EstadoCuenta.ABIERTA,
        garzonResponsableId: ORIGEN,
      });

      const result = await service.transferirAdmin(
        TENANT,
        USUARIO,
        CUENTA,
        DESTINO,
      );

      expect(garzones.obtenerActivoPorId).toHaveBeenCalledWith(TENANT, DESTINO);
      expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(
        TENANT,
        DESTINO,
      );
      expect(manager.create).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          garzonId: DESTINO,
          origenGarzonId: ORIGEN,
          motivo: MotivoCuentaAsignacion.TRANSFERENCIA_ADMIN,
          actorUsuarioId: USUARIO,
        }),
      );
      expect(result.garzonResponsableId).toBe(DESTINO);
    });
  });

  describe('registrarApertura', () => {
    it('crea tramo APERTURA', async () => {
      const cuenta = {
        id: CUENTA,
        tenantId: TENANT,
        abiertaEl: new Date('2026-07-16T12:00:00Z'),
      } as Cuenta;

      await service.registrarApertura(manager as never, cuenta, ORIGEN);

      expect(manager.create).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          tenantId: TENANT,
          cuentaId: CUENTA,
          garzonId: ORIGEN,
          motivo: MotivoCuentaAsignacion.APERTURA,
          hastaEl: null,
          origenGarzonId: null,
          actorUsuarioId: null,
        }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          motivo: MotivoCuentaAsignacion.APERTURA,
          garzonId: ORIGEN,
        }),
      );
    });
  });

  describe('cerrarTramoVigente', () => {
    it('actualiza solo tenantId + cuentaId + hastaEl IS NULL', async () => {
      const hastaEl = new Date('2026-07-16T15:00:00Z');

      await service.cerrarTramoVigente(
        manager as never,
        TENANT,
        CUENTA,
        hastaEl,
      );

      expect(manager.update).toHaveBeenCalledWith(
        CuentaAsignacion,
        expect.objectContaining({
          cuentaId: CUENTA,
          tenantId: TENANT,
          hastaEl: IsNull(),
        }),
        expect.objectContaining({ hastaEl }),
      );
      const whereArg = manager.update.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(Object.keys(whereArg).sort()).toEqual(
        ['cuentaId', 'hastaEl', 'tenantId'].sort(),
      );
    });
  });

  describe('listar', () => {
    it('devuelve nombres de garzón/origen/actor y orden ascendente', async () => {
      dataSource.query.mockResolvedValue([
        {
          cuenta_asignacion_id: 'a1',
          garzon_id: ORIGEN,
          garzon_nombre: 'Ana',
          desde_el: new Date('2026-07-16T10:00:00Z'),
          hasta_el: new Date('2026-07-16T12:00:00Z'),
          motivo: MotivoCuentaAsignacion.APERTURA,
          origen_garzon_id: null,
          origen_garzon_nombre: null,
          actor_usuario_id: null,
          actor_usuario_nombre: null,
        },
        {
          cuenta_asignacion_id: 'a2',
          garzon_id: DESTINO,
          garzon_nombre: 'Bruno',
          desde_el: new Date('2026-07-16T12:00:00Z'),
          hasta_el: null,
          motivo: MotivoCuentaAsignacion.TRANSFERENCIA_ADMIN,
          origen_garzon_id: ORIGEN,
          origen_garzon_nombre: 'Ana',
          actor_usuario_id: USUARIO,
          actor_usuario_nombre: 'Admin',
        },
      ]);

      const result = await service.listar(TENANT, CUENTA);

      expect(result).toEqual([
        expect.objectContaining({
          id: 'a1',
          garzonId: ORIGEN,
          garzonNombre: 'Ana',
          origenGarzonNombre: null,
          actorUsuarioNombre: null,
        }),
        expect.objectContaining({
          id: 'a2',
          garzonId: DESTINO,
          garzonNombre: 'Bruno',
          origenGarzonId: ORIGEN,
          origenGarzonNombre: 'Ana',
          actorUsuarioId: USUARIO,
          actorUsuarioNombre: 'Admin',
        }),
      ]);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringMatching(/ORDER BY\s+ca\.desde_el\s+ASC/i),
        [TENANT, CUENTA],
      );
    });

    it('el SELECT del historial filtra tenant y eliminado_el IS NULL', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.listar(TENANT, CUENTA);

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toMatch(/ca\.tenant_id\s*=\s*\$1/i);
      expect(sql).toMatch(/ca\.cuenta_id\s*=\s*\$2/i);
      expect(sql).toMatch(/ca\.eliminado_el\s+IS\s+NULL/i);
      expect(params).toEqual([TENANT, CUENTA]);
    });
  });

  describe('onApplicationBootstrap', () => {
    it('ejecuta el backfill idempotente y no duplica una asignación existente', async () => {
      await service.onApplicationBootstrap();

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.query).toHaveBeenCalledTimes(2);

      const updateSql = manager.query.mock.calls[0][0] as string;
      expect(updateSql).toMatch(/UPDATE\s+cuentas/i);
      expect(updateSql).toMatch(
        /garzon_responsable_id\s*=\s*garzon_apertura_id/i,
      );
      expect(updateSql).toMatch(/garzon_responsable_id\s+IS\s+NULL/i);
      expect(updateSql).toMatch(/eliminado_el\s+IS\s+NULL/i);

      const insertSql = manager.query.mock.calls[1][0] as string;
      expect(insertSql).toMatch(/INSERT\s+INTO\s+cuenta_asignaciones/i);
      expect(insertSql).toMatch(/NOT\s+EXISTS/i);
      expect(insertSql).toMatch(/ca\.eliminado_el\s+IS\s+NULL/i);
      expect(insertSql).toMatch(/c\.eliminado_el\s+IS\s+NULL/i);
      expect(insertSql).toMatch(/'apertura'/i);
    });
  });
});
