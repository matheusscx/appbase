import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CajaService } from './caja.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTRO_USUARIO = 'ffffffff-0000-0000-0000-000000000099';
const CAJA_ID = 'cccccccc-0000-0000-0000-000000000003';

const mockCajaAbierta: Partial<Caja> = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  usuarioId: USUARIO_ID,
  tipo: 'fisica',
  estado: 'abierta',
  saldoInicial: '1000',
  eliminadoEl: null,
};

describe('CajaService', () => {
  let service: CajaService;
  let cajaRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let managerMock: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
    find: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    cajaRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    managerMock = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      query: jest.fn(),
      find: jest.fn(),
    };

    dataSource = {
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getRepositoryToken(MovimientoCaja), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CajaService>(CajaService);
  });

  describe('findActiva', () => {
    it('should return the open physical caja for the given tenant and user', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);

      const result = await service.findActiva(TENANT_ID, USUARIO_ID);

      expect(cajaRepo.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          tipo: 'fisica',
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });
      expect(result).toEqual(mockCajaAbierta);
    });

    it('should return null when there is no open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(null);

      const result = await service.findActiva(TENANT_ID, USUARIO_ID);

      expect(result).toBeNull();
    });
  });

  describe('abrir', () => {
    const dto: AbrirCajaDto = {
      saldoInicial: '500',
      comentario: 'Apertura matutina',
    };

    it('should create and return a new open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(null); // no hay caja activa
      const created: Partial<Caja> = {
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        tipo: 'fisica',
        estado: 'abierta',
        saldoInicial: dto.saldoInicial,
        comentario: dto.comentario ?? null,
      };
      const saved = { id: 'new-uuid', ...created };
      cajaRepo.create.mockReturnValue(created);
      cajaRepo.save.mockResolvedValue(saved);

      const result = await service.abrir(TENANT_ID, USUARIO_ID, dto);

      expect(cajaRepo.create).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        tipo: 'fisica',
        estado: 'abierta',
        saldoInicial: dto.saldoInicial,
        comentario: dto.comentario,
      });
      expect(cajaRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(saved);
    });

    it('should throw ConflictException when user already has an open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);

      await expect(service.abrir(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        new ConflictException('Ya tienes una caja abierta'),
      );

      expect(cajaRepo.create).not.toHaveBeenCalled();
      expect(cajaRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('registrarMovimiento', () => {
    const dtoEntrada: CrearMovimientoDto = {
      tipo: 'entrada',
      concepto: 'Fondo de caja',
      monto: '200',
    };
    const dtoSalida: CrearMovimientoDto = {
      tipo: 'salida',
      concepto: 'Retiro',
      monto: '500',
    };

    it('registers an entrada and returns the saved movimiento', async () => {
      managerMock.findOne.mockResolvedValue(mockCajaAbierta);
      // saldoEsperado query: saldoInicial=1000, entradas=0, salidas=0 → 1000
      managerMock.query.mockResolvedValue([
        { saldo_inicial: '1000', total_entradas: null, total_salidas: null },
      ]);
      const movCreado = {
        id: 'mov-001',
        cajaId: CAJA_ID,
        tipo: 'entrada',
        concepto: 'Fondo de caja',
        monto: '200',
        referencia: null,
      };
      managerMock.create.mockReturnValue(movCreado);
      managerMock.save.mockResolvedValue(movCreado);

      const result = await service.registrarMovimiento(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoEntrada,
      );

      expect(managerMock.findOne).toHaveBeenCalledWith(Caja, {
        where: {
          id: CAJA_ID,
          tenantId: TENANT_ID,
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });
      expect(managerMock.create).toHaveBeenCalledWith(MovimientoCaja, {
        cajaId: CAJA_ID,
        tipo: 'entrada',
        concepto: 'Fondo de caja',
        monto: '200',
        referencia: null,
        ventaId: null,
        pagoId: null,
        metodoPagoId: null,
      });
      expect(result).toEqual(movCreado);
    });

    it('throws UnprocessableEntityException when salida exceeds saldo esperado', async () => {
      managerMock.findOne.mockResolvedValue(mockCajaAbierta);
      // saldo esperado = 1000 + 0 - 0 = 1000, pero salida pide 500 → debería pasar
      // Para este test: saldo = 300, salida = 500 → saldo insuficiente
      managerMock.query.mockResolvedValue([
        { saldo_inicial: '300', total_entradas: null, total_salidas: null },
      ]);

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoSalida),
      ).rejects.toThrow(
        new UnprocessableEntityException('Saldo insuficiente en caja'),
      );

      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caja is closed or not found', async () => {
      managerMock.findOne.mockResolvedValue(null);

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoEntrada),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when caja belongs to another user', async () => {
      const cajaOtroUsuario: Partial<Caja> = {
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      };
      managerMock.findOne.mockResolvedValue(cajaOtroUsuario);

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoEntrada),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cerrar', () => {
    const dto: CerrarCajaDto = {
      montoContado: '1200',
      comentario: 'Cierre diario',
    };

    beforeEach(() => {
      // Mock calcularSaldoEsperado so cerrar tests don't depend on query internals
      jest
        .spyOn(service, 'calcularSaldoEsperado')
        .mockResolvedValue('1000.0000');
    });

    it('(a) cuadre exacto: diferencia = "0.0000"', async () => {
      managerMock.findOne.mockResolvedValue({ ...mockCajaAbierta });
      jest
        .spyOn(service, 'calcularSaldoEsperado')
        .mockResolvedValue('1200.0000');
      managerMock.save.mockImplementation((_entity: unknown, data: unknown) =>
        Promise.resolve(data),
      );

      const dtoExacto: CerrarCajaDto = { montoContado: '1200.0000' };
      const result = await service.cerrar(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoExacto,
      );

      expect(result.diferencia).toBe('0.0000');
      expect(result.estado).toBe('cerrada');
      expect(result.saldoFinal).toBe('1200.0000');
      expect(result.fechaCierre).toBeInstanceOf(Date);
    });

    it('(b) sobrante: monto contado > saldo esperado → diferencia positiva', async () => {
      managerMock.findOne.mockResolvedValue({ ...mockCajaAbierta });
      jest
        .spyOn(service, 'calcularSaldoEsperado')
        .mockResolvedValue('1000.0000');
      managerMock.save.mockImplementation((_entity: unknown, data: unknown) =>
        Promise.resolve(data),
      );

      const dtoSobrante: CerrarCajaDto = { montoContado: '1200' };
      const result = await service.cerrar(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoSobrante,
      );

      expect(result.diferencia).toBe('200.0000');
      expect(result.estado).toBe('cerrada');
    });

    it('(c) faltante: monto contado < saldo esperado → diferencia negativa', async () => {
      managerMock.findOne.mockResolvedValue({ ...mockCajaAbierta });
      jest
        .spyOn(service, 'calcularSaldoEsperado')
        .mockResolvedValue('1000.0000');
      managerMock.save.mockImplementation((_entity: unknown, data: unknown) =>
        Promise.resolve(data),
      );

      const dtoFaltante: CerrarCajaDto = { montoContado: '800' };
      const result = await service.cerrar(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoFaltante,
      );

      expect(result.diferencia).toBe('-200.0000');
      expect(result.estado).toBe('cerrada');
    });

    it('(d) caja ya cerrada o no encontrada → ForbiddenException', async () => {
      managerMock.findOne.mockResolvedValue(null);

      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(e) caja ajena → ForbiddenException', async () => {
      const cajaOtroUsuario: Partial<Caja> = {
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      };
      managerMock.findOne.mockResolvedValue(cajaOtroUsuario);

      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('historial', () => {
    it('(a) todas=false: retorna solo cajas del usuario con tipo fisica', async () => {
      const cajas = [mockCajaAbierta];
      cajaRepo.find.mockResolvedValue(cajas);

      const result = await service.historial(TENANT_ID, USUARIO_ID, false);

      expect(cajaRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          tipo: 'fisica',
          eliminadoEl: IsNull(),
        },
        order: { fechaApertura: 'DESC' },
      });
      expect(result).toEqual(cajas);
    });

    it('(b) todas=true: retorna todas las cajas del tenant con tipo fisica', async () => {
      const cajaOtro = { ...mockCajaAbierta, usuarioId: OTRO_USUARIO };
      const cajas = [mockCajaAbierta, cajaOtro];
      cajaRepo.find.mockResolvedValue(cajas);

      const result = await service.historial(TENANT_ID, USUARIO_ID, true);

      expect(cajaRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          tipo: 'fisica',
          eliminadoEl: IsNull(),
        },
        order: { fechaApertura: 'DESC' },
      });
      expect(result).toEqual(cajas);
    });
  });

  describe('findOne', () => {
    it('(c) retorna la caja cuando es del usuario', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);

      const result = await service.findOne(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );

      expect(cajaRepo.findOne).toHaveBeenCalledWith({
        where: { id: CAJA_ID, tenantId: TENANT_ID, eliminadoEl: IsNull() },
      });
      expect(result).toEqual(mockCajaAbierta);
    });

    it('(d) retorna la caja cuando tieneVerTodas=true aunque sea de otro usuario', async () => {
      const cajaOtro = { ...mockCajaAbierta, usuarioId: OTRO_USUARIO };
      cajaRepo.findOne.mockResolvedValue(cajaOtro);

      const result = await service.findOne(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        true,
      );

      expect(result).toEqual(cajaOtro);
    });

    it('(e) lanza ForbiddenException cuando no es del usuario y tieneVerTodas=false', async () => {
      const cajaOtro = { ...mockCajaAbierta, usuarioId: OTRO_USUARIO };
      cajaRepo.findOne.mockResolvedValue(cajaOtro);

      await expect(
        service.findOne(TENANT_ID, USUARIO_ID, CAJA_ID, false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(f) lanza NotFoundException si no existe la caja', async () => {
      cajaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(TENANT_ID, USUARIO_ID, CAJA_ID, false),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listarMovimientos', () => {
    const mockRow = {
      movimiento_id: 'mov-001',
      caja_id: CAJA_ID,
      tipo: 'entrada',
      concepto: 'Apertura extra',
      monto: '200.0000',
      referencia: null,
      fecha: new Date('2026-06-29T12:00:00Z'),
      venta_id: null,
    };

    it('el dueño lista movimientos paginados (orden fecha ASC)', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([mockRow]);

      const result = await service.listarMovimientos(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        {},
      );

      expect(cajaRepo.findOne).toHaveBeenCalledWith({
        where: { id: CAJA_ID, tenantId: TENANT_ID, eliminadoEl: IsNull() },
      });
      expect(result.data).toEqual([
        {
          id: 'mov-001',
          cajaId: CAJA_ID,
          tipo: 'entrada',
          concepto: 'Apertura extra',
          monto: '200.0000',
          referencia: null,
          fecha: mockRow.fecha,
          ventaId: null,
        },
      ]);
      expect(result.meta.total).toBe(1);
    });

    it('con tieneVerTodas=true permite leer movimientos de una caja ajena', async () => {
      cajaRepo.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await expect(
        service.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID, {}, true),
      ).resolves.toEqual({
        data: [],
        meta: expect.objectContaining({ total: 0 }),
      });
    });

    it('sobre caja ajena sin tieneVerTodas lanza ForbiddenException', async () => {
      cajaRepo.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });

      await expect(
        service.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID, {}, false),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFoundException si la caja no existe', async () => {
      cajaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.listarMovimientos(TENANT_ID, USUARIO_ID, CAJA_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resumenMovimientos', () => {
    it('calcula totales del turno', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      dataSource.query.mockResolvedValue([
        {
          saldo_inicial: '1000.0000',
          total_entradas: '500.0000',
          total_salidas: '200.0000',
          total_movimientos: 3,
        },
      ]);

      const result = await service.resumenMovimientos(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
      );

      expect(result).toEqual({
        saldoInicial: '1000.0000',
        totalEntradas: '500.0000',
        totalSalidas: '200.0000',
        saldoEsperado: '1300.0000',
        totalMovimientos: 3,
      });
    });
  });

  describe('abiertas', () => {
    it('mapea filas a CajaAbierta con nombre completo y saldo esperado', async () => {
      dataSource.query.mockResolvedValue([
        {
          caja_id: CAJA_ID,
          usuario_id: USUARIO_ID,
          usuario_nombre: 'Ana',
          usuario_apellido: 'Pérez',
          saldo_inicial: '1000',
          fecha_apertura: new Date('2026-06-29T10:00:00Z'),
          total_entradas: '200',
          total_salidas: '50',
        },
      ]);

      const result = await service.abiertas(TENANT_ID, USUARIO_ID, true);

      expect(result).toEqual([
        {
          id: CAJA_ID,
          usuarioId: USUARIO_ID,
          usuarioNombre: 'Ana Pérez',
          saldoInicial: '1000.0000',
          saldoEsperado: '1150.0000',
          fechaApertura: new Date('2026-06-29T10:00:00Z'),
          esPropia: true,
        },
      ]);
    });

    it('trata entradas/salidas nulas como 0 y marca esPropia=false para otro usuario', async () => {
      dataSource.query.mockResolvedValue([
        {
          caja_id: CAJA_ID,
          usuario_id: OTRO_USUARIO,
          usuario_nombre: 'Beto',
          usuario_apellido: null,
          saldo_inicial: '500',
          fecha_apertura: new Date('2026-06-29T09:00:00Z'),
          total_entradas: null,
          total_salidas: null,
        },
      ]);

      const result = await service.abiertas(TENANT_ID, USUARIO_ID, true);

      expect(result[0]).toMatchObject({
        usuarioNombre: 'Beto',
        saldoEsperado: '500.0000',
        esPropia: false,
      });
    });

    it('pasa tenantId, el flag tieneVerTodas y usuarioId como parámetros de la query', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.abiertas(TENANT_ID, USUARIO_ID, false);

      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([TENANT_ID, false, USUARIO_ID]);
    });
  });
});
