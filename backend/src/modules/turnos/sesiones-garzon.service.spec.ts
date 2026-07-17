import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SesionesGarzonService } from './sesiones-garzon.service';
import {
  EstadoSesionGarzon,
  OrigenCierreSesion,
  SesionGarzon,
} from './entities/sesion-garzon.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { TurnosService } from './turnos.service';
import type { Garzon } from '../garzones/entities/garzon.entity';
import type { Turno } from './entities/turno.entity';

const TENANT = 'tenant-uuid';
const PIN = '123456';
const GARZON_ID = 'garzon-1';
const TURNO_ID = 'turno-1';
const SESION_ID = 'sesion-1';
const USUARIO_ID = 'usuario-1';

type SesionRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
};

function makeSesionRepo(): SesionRepo {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    count: jest.fn().mockResolvedValue(0),
  };
}

function garzon(over: Partial<Garzon> = {}): Garzon {
  return {
    id: GARZON_ID,
    tenantId: TENANT,
    nombre: 'Ana',
    pinHash: 'hash',
    activo: true,
    creadoEl: new Date('2026-01-01T00:00:00Z'),
    actualizadoEl: new Date('2026-01-01T00:00:00Z'),
    eliminadoEl: null,
    ...over,
  };
}

function turno(over: Partial<Turno> = {}): Turno {
  return {
    id: TURNO_ID,
    tenantId: TENANT,
    nombre: 'Almuerzo',
    horaInicio: '12:00',
    horaFin: '16:00',
    activo: true,
    creadoEl: new Date('2026-01-01T00:00:00Z'),
    actualizadoEl: new Date('2026-01-01T00:00:00Z'),
    eliminadoEl: null,
    ...over,
  };
}

function sesion(over: Partial<SesionGarzon> = {}): SesionGarzon {
  return {
    id: SESION_ID,
    tenantId: TENANT,
    garzonId: GARZON_ID,
    turnoId: TURNO_ID,
    inicioEl: new Date('2026-07-16T12:00:00Z'),
    finEl: null,
    estado: EstadoSesionGarzon.ABIERTA,
    origenCierre: null,
    cerradaPorUsuarioId: null,
    creadoEl: new Date('2026-07-16T12:00:00Z'),
    actualizadoEl: new Date('2026-07-16T12:00:00Z'),
    eliminadoEl: null,
    ...over,
  };
}

describe('SesionesGarzonService', () => {
  let service: SesionesGarzonService;
  let sesionRepo: SesionRepo;
  let garzones: { resolverGarzonPorPin: jest.Mock };
  let turnos: { getActivoOrThrow: jest.Mock };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    sesionRepo = makeSesionRepo();
    garzones = {
      resolverGarzonPorPin: jest.fn().mockResolvedValue(garzon()),
    };
    turnos = {
      getActivoOrThrow: jest.fn().mockResolvedValue(turno()),
    };
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SesionesGarzonService,
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
        { provide: GarzonesService, useValue: garzones },
        { provide: TurnosService, useValue: turnos },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(SesionesGarzonService);
  });

  it('iniciar abre sesión con pin + turno activo', async () => {
    sesionRepo.findOne.mockResolvedValue(null);
    const saved = sesion({ id: 'sesion-new' });
    sesionRepo.save.mockResolvedValue(saved);

    const result = await service.iniciar(TENANT, {
      pin: PIN,
      turnoId: TURNO_ID,
    });

    expect(garzones.resolverGarzonPorPin).toHaveBeenCalledWith(TENANT, PIN);
    expect(turnos.getActivoOrThrow).toHaveBeenCalledWith(TENANT, TURNO_ID);
    expect(sesionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        garzonId: GARZON_ID,
        turnoId: TURNO_ID,
        estado: EstadoSesionGarzon.ABIERTA,
        finEl: null,
        origenCierre: null,
      }),
    );
    expect(result.id).toBe('sesion-new');
    expect(result.garzonNombre).toBe('Ana');
    expect(result.turnoNombre).toBe('Almuerzo');
    expect(result.estado).toBe(EstadoSesionGarzon.ABIERTA);
  });

  it('iniciar rechaza si ya hay sesión abierta', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());

    await expect(
      service.iniciar(TENANT, { pin: PIN, turnoId: TURNO_ID }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.iniciar(TENANT, { pin: PIN, turnoId: TURNO_ID }),
    ).rejects.toThrow('El garzón ya tiene una sesión abierta');

    expect(sesionRepo.save).not.toHaveBeenCalled();
  });

  it('iniciar rechaza turno inactivo', async () => {
    turnos.getActivoOrThrow.mockRejectedValue(
      new BadRequestException('Turno inválido o inactivo'),
    );

    await expect(
      service.iniciar(TENANT, { pin: PIN, turnoId: TURNO_ID }),
    ).rejects.toThrow('Turno inválido o inactivo');
  });

  it('cerrarPorPin cierra y fija finEl', async () => {
    const abierta = sesion();
    sesionRepo.findOne.mockResolvedValue(abierta);
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query.mockResolvedValue([
      { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
    ]);

    const result = await service.cerrarPorPin(TENANT, PIN);

    expect(result.estado).toBe(EstadoSesionGarzon.CERRADA);
    expect(result.origenCierre).toBe(OrigenCierreSesion.PIN);
    expect(result.finEl).toBeInstanceOf(Date);
    expect(result.cerradaPorUsuarioId).toBeNull();
  });

  it('cerrarPorPin sin sesión abierta → 400', async () => {
    sesionRepo.findOne.mockResolvedValue(null);

    await expect(service.cerrarPorPin(TENANT, PIN)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.cerrarPorPin(TENANT, PIN)).rejects.toThrow(
      'El garzón no tiene una sesión abierta',
    );
  });

  it('cerrarAdmin registra cerradaPorUsuarioId y origenCierre=admin', async () => {
    const abierta = sesion();
    sesionRepo.findOne.mockResolvedValue(abierta);
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query.mockResolvedValue([
      { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
    ]);

    const result = await service.cerrarAdmin(TENANT, SESION_ID, USUARIO_ID);

    expect(result.estado).toBe(EstadoSesionGarzon.CERRADA);
    expect(result.origenCierre).toBe(OrigenCierreSesion.ADMIN);
    expect(result.cerradaPorUsuarioId).toBe(USUARIO_ID);
    expect(result.finEl).toBeInstanceOf(Date);
  });

  it('assertSesionAbierta lanza 400 si no hay abierta', async () => {
    sesionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.assertSesionAbierta(TENANT, GARZON_ID),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.assertSesionAbierta(TENANT, GARZON_ID),
    ).rejects.toThrow('El garzón no tiene una sesión de trabajo abierta');
  });

  it('assertSesionAbierta resuelve si hay abierta', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());

    await expect(
      service.assertSesionAbierta(TENANT, GARZON_ID),
    ).resolves.toBeUndefined();
  });

  it('listarAbiertas incluye sesión aunque garzón/turno estén soft-deleted', async () => {
    dataSource.query.mockResolvedValueOnce([
      {
        sesion_garzon_id: SESION_ID,
        garzon_id: GARZON_ID,
        garzon_nombre: null,
        turno_id: TURNO_ID,
        turno_nombre: null,
        inicio_el: new Date('2026-07-16T12:00:00Z'),
        fin_el: null,
        estado: EstadoSesionGarzon.ABIERTA,
        origen_cierre: null,
        cerrada_por_usuario_id: null,
      },
    ]);

    const result = await service.listarAbiertas(TENANT);

    const listCall = dataSource.query.mock.calls[0] as [string, ...unknown[]];
    const listSql = listCall[0];
    expect(listSql).toMatch(/LEFT JOIN\s+garzones/i);
    expect(listSql).toMatch(/LEFT JOIN\s+turnos/i);
    expect(listSql).not.toMatch(/(?<!LEFT )JOIN\s+garzones/i);
    expect(listSql).not.toMatch(/(?<!LEFT )JOIN\s+turnos/i);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(SESION_ID);
    expect(result[0].garzonNombre).toBe('');
    expect(result[0].turnoNombre).toBe('');
  });

  it('historial incluye sesión aunque el turno esté soft-deleted', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([
        {
          sesion_garzon_id: SESION_ID,
          garzon_id: GARZON_ID,
          garzon_nombre: 'Ana',
          turno_id: TURNO_ID,
          turno_nombre: null,
          inicio_el: new Date('2026-07-16T12:00:00Z'),
          fin_el: new Date('2026-07-16T16:00:00Z'),
          estado: EstadoSesionGarzon.CERRADA,
          origen_cierre: OrigenCierreSesion.PIN,
          cerrada_por_usuario_id: null,
        },
      ]);

    const result = await service.historial(TENANT, {});

    const countCall = dataSource.query.mock.calls[0] as [string, ...unknown[]];
    const listCall = dataSource.query.mock.calls[1] as [string, ...unknown[]];
    const listSql = listCall[0];
    expect(listSql).toMatch(/LEFT JOIN\s+garzones/i);
    expect(listSql).toMatch(/LEFT JOIN\s+turnos/i);
    expect(listSql).not.toMatch(/(?<!LEFT )JOIN\s+garzones/i);
    expect(listSql).not.toMatch(/(?<!LEFT )JOIN\s+turnos/i);

    const countSql = countCall[0];
    expect(countSql).toMatch(/FROM sesiones_garzon s/i);
    expect(countSql).not.toMatch(/JOIN/i);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(SESION_ID);
    expect(result.data[0].turnoId).toBe(TURNO_ID);
    expect(result.data[0].turnoNombre).toBe('');
    expect(result.meta.total).toBe(1);
  });

  it('iniciar mapea unique violation 23505 a sesión ya abierta', async () => {
    sesionRepo.findOne.mockResolvedValue(null);
    sesionRepo.save.mockRejectedValue({ code: '23505' });

    await expect(
      service.iniciar(TENANT, { pin: PIN, turnoId: TURNO_ID }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.iniciar(TENANT, { pin: PIN, turnoId: TURNO_ID }),
    ).rejects.toThrow('El garzón ya tiene una sesión abierta');
  });
});
