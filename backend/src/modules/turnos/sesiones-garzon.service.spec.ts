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
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
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
    tipo: TipoGarzon.GARZON,
    esPlaceholder: false,
    usuarioId: null,
    creadoEl: new Date('2026-01-01T00:00:00Z'),
    actualizadoEl: new Date('2026-01-01T00:00:00Z'),
    eliminadoEl: null,
    eliminadoPor: null,
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
    eliminadoPor: null,
    ...over,
  };
}

function sesion(over: Partial<SesionGarzon> = {}): SesionGarzon {
  return {
    id: SESION_ID,
    tenantId: TENANT,
    garzonId: GARZON_ID,
    turnoId: TURNO_ID,
    tipoGarzon: TipoGarzon.GARZON,
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
  let garzones: { resolverGarzonActuante: jest.Mock };
  let turnos: { getActivoOrThrow: jest.Mock };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    sesionRepo = makeSesionRepo();
    garzones = {
      resolverGarzonActuante: jest.fn().mockResolvedValue(garzon()),
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

    const result = await service.iniciar(TENANT, USUARIO_ID, {
      garzonId: GARZON_ID,
      pin: PIN,
      turnoId: TURNO_ID,
    });

    // El usuario del JWT llega al resolver: es lo que le permite decidir si
    // este dispositivo es personal o un tótem.
    expect(garzones.resolverGarzonActuante).toHaveBeenCalledWith(
      TENANT,
      USUARIO_ID,
      expect.objectContaining({ garzonId: GARZON_ID, pin: PIN }),
    );
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

  it('iniciar congela tipo_garzon del garzón', async () => {
    garzones.resolverGarzonActuante.mockResolvedValue(
      garzon({ tipo: TipoGarzon.COCINA }),
    );
    sesionRepo.findOne.mockResolvedValue(null);
    const saved = sesion({
      id: 'sesion-new',
      tipoGarzon: TipoGarzon.COCINA,
    });
    sesionRepo.save.mockResolvedValue(saved);

    const result = await service.iniciar(TENANT, USUARIO_ID, {
      garzonId: GARZON_ID,
      pin: PIN,
      turnoId: TURNO_ID,
    });

    expect(sesionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tipoGarzon: TipoGarzon.COCINA }),
    );
    expect(result.tipoGarzon).toBe(TipoGarzon.COCINA);
  });

  it('iniciar rechaza si ya hay sesión abierta', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());

    await expect(
      service.iniciar(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
        turnoId: TURNO_ID,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.iniciar(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
        turnoId: TURNO_ID,
      }),
    ).rejects.toThrow('El garzón ya tiene una sesión abierta');

    expect(sesionRepo.save).not.toHaveBeenCalled();
  });

  it('iniciar rechaza turno inactivo', async () => {
    turnos.getActivoOrThrow.mockRejectedValue(
      new BadRequestException('Turno inválido o inactivo'),
    );

    await expect(
      service.iniciar(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
        turnoId: TURNO_ID,
      }),
    ).rejects.toThrow('Turno inválido o inactivo');
  });

  it('cerrarPropia cierra y fija finEl', async () => {
    const abierta = sesion();
    sesionRepo.findOne.mockResolvedValue(abierta);
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query
      .mockResolvedValueOnce([
        { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.cerrarPropia(TENANT, USUARIO_ID, {
      garzonId: GARZON_ID,
      pin: PIN,
    });

    expect(result.estado).toBe(EstadoSesionGarzon.CERRADA);
    expect(result.origenCierre).toBe(OrigenCierreSesion.PIN);
    expect(result.finEl).toBeInstanceOf(Date);
    expect(result.cerradaPorUsuarioId).toBeNull();
    expect(result.cuentasPendientes).toEqual([]);
  });

  it('cerrarPropia sin sesión abierta → 400', async () => {
    sesionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.cerrarPropia(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.cerrarPropia(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
      }),
    ).rejects.toThrow('El garzón no tiene una sesión abierta');
  });

  it('cerrarAdmin registra cerradaPorUsuarioId y origenCierre=admin', async () => {
    const abierta = sesion();
    sesionRepo.findOne.mockResolvedValue(abierta);
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query
      .mockResolvedValueOnce([
        { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
      ])
      .mockResolvedValueOnce([]);

    const result = await service.cerrarAdmin(TENANT, SESION_ID, USUARIO_ID);

    expect(result.estado).toBe(EstadoSesionGarzon.CERRADA);
    expect(result.origenCierre).toBe(OrigenCierreSesion.ADMIN);
    expect(result.cerradaPorUsuarioId).toBe(USUARIO_ID);
    expect(result.finEl).toBeInstanceOf(Date);
    expect(result.cuentasPendientes).toEqual([]);
  });

  // ── Mesas que quedan abiertas al cerrar la sesión ──────────────────────────
  // Ninguno de los dos cierres se bloquea (decisión del owner, 2026-08-06): lo
  // que devuelven es la lista para que la UI ofrezca transferirla. Sin ella el
  // garzón se va y la mesa queda sin poder cobrarse, porque `cerrarCuenta`
  // exige que el responsable esté en turno.

  const filaPendiente = {
    cuenta_id: 'cuenta-1',
    numero: 3,
    mesa_nombre: 'Mesa 4',
    salon_nombre: 'Terraza',
  };

  it('cerrarPropia devuelve las cuentas que quedaron a nombre del garzón', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query
      .mockResolvedValueOnce([
        { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
      ])
      .mockResolvedValueOnce([filaPendiente]);

    const result = await service.cerrarPropia(TENANT, USUARIO_ID, {
      garzonId: GARZON_ID,
      pin: PIN,
    });

    expect(result.cuentasPendientes).toEqual([
      {
        cuentaId: 'cuenta-1',
        numero: 3,
        mesaNombre: 'Mesa 4',
        salonNombre: 'Terraza',
      },
    ]);
    const sql = (dataSource.query.mock.calls[1] as [string, ...unknown[]])[0];
    const params = (dataSource.query.mock.calls[1] as [string, unknown[]])[1];
    expect(params).toEqual([TENANT, GARZON_ID]);
    expect(sql).toMatch(/c\.tenant_id = \$1/);
    expect(sql).toMatch(/c\.garzon_responsable_id = \$2/);
    expect(sql).toMatch(/c\.estado = 'abierta'/);
    expect(sql).toMatch(/c\.eliminado_el IS NULL/);
  });

  it('cerrarAdmin devuelve las mismas cuentas pendientes', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query
      .mockResolvedValueOnce([
        { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
      ])
      .mockResolvedValueOnce([filaPendiente]);

    const result = await service.cerrarAdmin(TENANT, SESION_ID, USUARIO_ID);

    expect(result.cuentasPendientes).toHaveLength(1);
    expect(result.cuentasPendientes[0].cuentaId).toBe('cuenta-1');
    const params = (dataSource.query.mock.calls[1] as [string, unknown[]])[1];
    expect(params).toEqual([TENANT, GARZON_ID]);
  });

  // Una cuenta abierta sobre una mesa borrada es justo la que no hay que perder
  // de vista: con `JOIN` desaparecería de la lista y nadie se enteraría de que
  // quedó sin cobrar. Se asevera sobre el SQL porque el escenario exige borrar
  // una mesa con cuentas abiertas, que la API bloquea.
  it('la cuenta se lista aunque su mesa o su salón estén borrados', async () => {
    sesionRepo.findOne.mockResolvedValue(sesion());
    sesionRepo.save.mockImplementation((row: SesionGarzon) =>
      Promise.resolve(row),
    );
    dataSource.query
      .mockResolvedValueOnce([
        { garzon_nombre: 'Ana', turno_nombre: 'Almuerzo' },
      ])
      .mockResolvedValueOnce([
        { ...filaPendiente, mesa_nombre: null, salon_nombre: null },
      ]);

    const result = await service.cerrarPropia(TENANT, USUARIO_ID, {
      garzonId: GARZON_ID,
      pin: PIN,
    });

    expect(result.cuentasPendientes).toHaveLength(1);
    expect(result.cuentasPendientes[0].mesaNombre).toBe('');
    expect(result.cuentasPendientes[0].salonNombre).toBe('');

    const sql = (dataSource.query.mock.calls[1] as [string, ...unknown[]])[0];
    expect(sql).toMatch(/LEFT JOIN\s+mesas\s+m\b[\s\S]*?m\.tenant_id/i);
    expect(sql).toMatch(/LEFT JOIN\s+salones\s+sa\b[\s\S]*?sa\.tenant_id/i);
    expect(sql).not.toMatch(/(?<!LEFT )JOIN\s+mesas/i);
    expect(sql).not.toMatch(/(?<!LEFT )JOIN\s+salones/i);
    // Y el soft delete de las DOS tablas nuevas, no solo el de `cuentas`: es la
    // invariante que más reincide en este repo, y el diff que agregó los joins
    // es exactamente donde faltaría el freno.
    expect(sql).toMatch(/m\.eliminado_el IS NULL/);
    expect(sql).toMatch(/sa\.eliminado_el IS NULL/);
  });

  it('buscarSesionAbierta devuelve null en vez de tirar 400', async () => {
    sesionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.buscarSesionAbierta(TENANT, GARZON_ID),
    ).resolves.toBeNull();
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
        tipo_garzon: TipoGarzon.GARZON,
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

  // Los JOIN a `garzones` y `turnos` de los dos listados acotaban solo por
  // `eliminado_el`, mientras `sesiones_garzon` sí filtra por tenant. No son
  // explotables hoy —el `garzon_id` y el `turno_id` de esas filas se escriben por
  // caminos tenant-scoped— pero es la misma defensa que ya faltó en el JOIN de
  // garzones de ventas. Se asevera sobre el SQL porque el escenario no se puede
  // montar por API: exigiría dos tenants compartiendo una PK.
  it('los dos listados acotan los JOIN de garzones y turnos por tenant', async () => {
    dataSource.query.mockResolvedValueOnce([]);
    await service.listarAbiertas(TENANT);
    const sqlAbiertas = (
      dataSource.query.mock.calls[0] as [string, ...unknown[]]
    )[0];

    dataSource.query.mockReset();
    dataSource.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    await service.historial(TENANT, {});
    const sqlHistorial = (
      dataSource.query.mock.calls[1] as [string, ...unknown[]]
    )[0];

    for (const sql of [sqlAbiertas, sqlHistorial]) {
      expect(sql).toMatch(/LEFT JOIN\s+garzones\s+g\b[\s\S]*?g\.tenant_id/i);
      expect(sql).toMatch(/LEFT JOIN\s+turnos\s+t\b[\s\S]*?t\.tenant_id/i);
    }
  });

  describe('contarAbiertas', () => {
    // El caller real (CajaService.enviarConteo) le pasa el `manager` de una
    // transacción en curso, no `this.dataSource` — por eso el método toma un
    // `runner` genérico en vez de usar el campo privado.
    it('corre la query sobre el runner que le pasan, no sobre this.dataSource', async () => {
      const runner = { query: jest.fn().mockResolvedValue([{ total: 3 }]) };

      const result = await service.contarAbiertas(runner, TENANT);

      expect(result).toBe(3);
      expect(dataSource.query).not.toHaveBeenCalled();
      const [sql, params] = runner.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/FROM\s+sesiones_garzon/i);
      expect(sql).toMatch(/estado\s*=\s*'abierta'/i);
      expect(sql).toMatch(/eliminado_el\s+IS\s+NULL/i);
      expect(params).toEqual([TENANT]);
    });

    it('sin filas → 0, no undefined', async () => {
      const runner = { query: jest.fn().mockResolvedValue([]) };

      const result = await service.contarAbiertas(runner, TENANT);

      expect(result).toBe(0);
    });
  });

  describe('activaPropia', () => {
    // Es lo que responde "¿este garzón está en turno?" cuando alguien teclea su
    // PIN. No lo invocaba ningún test.
    it('devuelve la sesión abierta del garzón que corresponde al PIN', async () => {
      const abierta = sesion({ id: SESION_ID });
      sesionRepo.findOne.mockResolvedValue(abierta);

      const result = await service.activaPropia(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
      });

      expect(garzones.resolverGarzonActuante).toHaveBeenCalledWith(
        TENANT,
        USUARIO_ID,
        expect.objectContaining({ garzonId: GARZON_ID, pin: PIN }),
      );
      // Acotado al garzón del PIN y a su sesión ABIERTA: sin el filtro de
      // estado devolvería una sesión ya cerrada como si siguiera en turno.
      expect(sesionRepo.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          garzonId: GARZON_ID,
          estado: EstadoSesionGarzon.ABIERTA,
        },
      });
      expect(result?.id).toBe(SESION_ID);
    });

    it('devuelve null si el garzón no tiene sesión abierta', async () => {
      sesionRepo.findOne.mockResolvedValue(null);

      expect(
        await service.activaPropia(TENANT, USUARIO_ID, {
          garzonId: GARZON_ID,
          pin: PIN,
        }),
      ).toBeNull();
    });

    it('un PIN inválido propaga el rechazo, no devuelve null', async () => {
      // `null` significa "sin turno abierto". Si un PIN equivocado devolviera
      // lo mismo, el llamador ofrecería iniciar turno en vez de decir que el
      // PIN está mal.
      garzones.resolverGarzonActuante.mockRejectedValue(
        new BadRequestException('PIN inválido'),
      );

      await expect(
        service.activaPropia(TENANT, USUARIO_ID, {
          garzonId: GARZON_ID,
          pin: '000000',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Los otros dos tests de `historial()` llaman con `{}`, así que ningún filtro
  // llegó nunca a construirse. El riesgo no es teórico: los placeholders
  // arrancan en `$2` porque `$1` ya es el tenant, y una numeración corrida
  // filtra por el tenant como si fuera un garzón —o mezcla tenants— sin que
  // nada explote.
  it('los filtros se numeran DESPUÉS del tenant, y sus valores viajan en orden', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await service.historial(TENANT, {
      garzonId: GARZON_ID,
      turnoId: TURNO_ID,
      estado: EstadoSesionGarzon.CERRADA,
      desde: '2026-08-01',
      hasta: '2026-08-31',
    });

    // La primera query es la de la zona horaria; después van count y listado.
    const [countSql, countParams] = dataSource.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(countSql).toContain('s.garzon_id = $2');
    expect(countSql).toContain('s.turno_id = $3');
    expect(countSql).toContain('s.estado = $4');
    // $5 es la zona; las fechas van después y se castean a día del tenant.
    expect(countSql).toContain(
      's.inicio_el >= ($6::date::timestamp AT TIME ZONE $5)',
    );
    expect(countSql).toContain(
      's.inicio_el < (($7::date + 1)::timestamp AT TIME ZONE $5)',
    );
    expect(countParams).toEqual([
      TENANT,
      GARZON_ID,
      TURNO_ID,
      EstadoSesionGarzon.CERRADA,
      'America/Santiago',
      '2026-08-01',
      '2026-08-31',
    ]);

    // El listado agrega LIMIT/OFFSET después de los filtros: su numeración
    // arranca donde terminaron ellos, no en un número fijo.
    const [listSql, listParams] = dataSource.query.mock.calls[2] as [
      string,
      unknown[],
    ];
    expect(listSql).toContain('LIMIT $8');
    expect(listSql).toContain('OFFSET $9');
    expect(listParams).toHaveLength(9);
  });

  it('"Hasta hoy" incluye el día completo, no corta en medianoche', async () => {
    // El bug: `<= '2026-08-07'` castea a medianoche y excluye TODO el día, así
    // que "Desde hoy / Hasta hoy" devolvía la lista vacía.
    dataSource.query
      .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await service.historial(TENANT, {
      desde: '2026-08-07',
      hasta: '2026-08-07',
    });

    const [sql] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('+ 1)::timestamp AT TIME ZONE');
    expect(sql).not.toMatch(/s\.inicio_el <= \$/);
  });

  it('la zona se busca acotada por tenant y sin filas eliminadas', async () => {
    // El docblock afirma que estos filtros no son decorativos. Sin un test que
    // los pinche, esa afirmación es más fuerte que su evidencia: el mutante que
    // los borra pasaba la suite entera.
    dataSource.query
      .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await service.historial(TENANT, { desde: '2026-08-01' });

    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/JOIN provincia pr[\s\S]*?pr\.eliminado_el IS NULL/);
    expect(sql).toMatch(/JOIN pais p[\s\S]*?p\.eliminado_el IS NULL/);
    expect(sql).toMatch(/t\.tenant_id = \$1[\s\S]*?t\.eliminado_el IS NULL/);
    expect(params).toEqual([TENANT]);
  });

  it('sin filtro de fecha no sale a buscar la zona horaria', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await service.historial(TENANT, { estado: EstadoSesionGarzon.ABIERTA });

    const sqls = dataSource.query.mock.calls.map(([s]) => s as string);
    expect(sqls.some((s) => s.includes('zona_horaria_principal'))).toBe(false);
  });

  it('un filtro ausente no deja un hueco en la numeración', async () => {
    dataSource.query
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await service.historial(TENANT, { estado: EstadoSesionGarzon.ABIERTA });

    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('s.estado = $2');
    expect(sql).not.toContain('s.garzon_id');
    expect(params).toEqual([TENANT, EstadoSesionGarzon.ABIERTA]);
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
          tipo_garzon: TipoGarzon.GARZON,
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
      service.iniciar(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
        turnoId: TURNO_ID,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.iniciar(TENANT, USUARIO_ID, {
        garzonId: GARZON_ID,
        pin: PIN,
        turnoId: TURNO_ID,
      }),
    ).rejects.toThrow('El garzón ya tiene una sesión abierta');
  });
});
