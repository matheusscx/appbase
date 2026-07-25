import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { CajaService } from './caja.service';
import type { LineaArqueo } from './caja.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { MotivosDiferenciaService } from '../motivos-diferencia/motivos-diferencia.service';

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
  const motivosService = {
    assertMotivoValido: jest.fn(),
    hayMotivosActivos: jest.fn(),
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

    motivosService.assertMotivoValido.mockReset();
    motivosService.hayMotivosActivos.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getRepositoryToken(MovimientoCaja), useValue: {} },
        {
          provide: getRepositoryToken(CajaArqueoMedio),
          useValue: { create: jest.fn((x) => x), save: jest.fn() },
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: MotivosDiferenciaService, useValue: motivosService },
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
          estado: In(['abierta', 'en_conciliacion']),
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
      managerMock.query
        .mockResolvedValueOnce([{ caja_id: CAJA_ID }]) // FOR UPDATE
        .mockResolvedValueOnce([
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

      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE'),
        [CAJA_ID, TENANT_ID],
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
      managerMock.query
        .mockResolvedValueOnce([{ caja_id: CAJA_ID }])
        .mockResolvedValueOnce([
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
      managerMock.query.mockResolvedValueOnce([]); // lock falla

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoEntrada),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when caja belongs to another user', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]);
      const cajaOtroUsuario: Partial<Caja> = {
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      };
      managerMock.findOne.mockResolvedValue(cajaOtroUsuario);

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoEntrada),
      ).rejects.toThrow(ForbiddenException);
    });

    it('la salida valida contra la línea de efectivo, no contra el total mezclado', async () => {
      const dtoSalida: CrearMovimientoDto = {
        tipo: 'salida',
        concepto: 'Retiro',
        monto: '600',
      };
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock FOR UPDATE
      managerMock.findOne.mockResolvedValueOnce(mockCajaAbierta);
      // Efectivo real = 500 (aunque haya 800 en tarjeta): sacar 600 debe fallar.
      jest
        .spyOn(service, 'calcularEsperadoEfectivo')
        .mockResolvedValueOnce('500.0000');

      await expect(
        service.registrarMovimiento(TENANT_ID, USUARIO_ID, CAJA_ID, dtoSalida),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('enviarConteo', () => {
    const arqueoRecomputado: LineaArqueo[] = [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: '1000.0000',
        requiereConteo: true,
      },
      {
        metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
        nombre: 'Tarjeta de débito',
        esEfectivo: false,
        esperado: '800.0000',
        requiereConteo: false,
      },
    ];

    // Última llamada a manager.save(Caja, caja) — enviarConteo ya no
    // devuelve la Caja completa (solo { estado, arqueo }).
    const findSavedCaja = (): Partial<Caja> =>
      managerMock.save.mock.calls.find(
        (c: unknown[]) => c[0] === Caja,
      )?.[1] as Partial<Caja>;

    beforeEach(() => {
      managerMock.query.mockResolvedValue([{ caja_id: CAJA_ID }]); // FOR UPDATE
      managerMock.findOne.mockResolvedValue({ ...mockCajaAbierta });
      managerMock.create.mockImplementation(
        (_e: unknown, data: unknown) => data,
      );
      managerMock.save.mockImplementation((_e: unknown, x: unknown) => x);
      jest.spyOn(service, 'calcularArqueo').mockResolvedValue([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          esperado: '1000.0000',
          requiereConteo: true,
        },
      ]);
    });

    it('todo cuadra → estado cerrada (auto-cierre) + fechaCierre', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        usuarioId: USUARIO_ID,
      });
      const res = await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      });
      expect(res.estado).toBe('cerrada');
      const savedCaja =
        managerMock.save.mock.calls.find(
          (c) => c[0] === Caja || c[1]?.estado,
        )?.[1] ?? managerMock.save.mock.calls.at(-1)[0];
      expect(savedCaja.estado).toBe('cerrada');
      expect(savedCaja.fechaCierre).toBeInstanceOf(Date);
    });

    it('hay descuadre → estado en_conciliacion, sin fechaCierre', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        usuarioId: USUARIO_ID,
      });
      const res = await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      });
      expect(res.estado).toBe('en_conciliacion');
      // manager.save(Caja, caja) — el objeto guardado es el 2º argumento.
      const savedCaja = managerMock.save.mock.calls.at(-1)[1];
      expect(savedCaja.estado).toBe('en_conciliacion');
      expect(savedCaja.fechaCierre).toBeNull();
    });

    it('la caja debe estar abierta', async () => {
      managerMock.findOne.mockResolvedValueOnce(null);
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, {
          lineas: [{ metodoPagoId: null, montoContado: '900' }],
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('congela el arqueo y fija los agregados de cajas = línea de efectivo', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: null, montoContado: '1000' },
          {
            metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
            montoContado: '800',
          },
        ],
      };
      const { estado, arqueo } = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dto,
      );
      expect(estado).toBe('cerrada');
      const savedCaja = findSavedCaja();
      expect(savedCaja.saldoFinal).toBe('1000.0000'); // esperado efectivo
      expect(savedCaja.montoContado).toBe('1000'); // contado efectivo
      expect(savedCaja.diferencia).toBe('0.0000');
      const efectivo = arqueo.find((l) => l.metodoPagoId === null);
      const tarjeta = arqueo.find((l) => l.metodoPagoId !== null);
      expect(efectivo?.diferencia).toBe('0.0000');
      expect(tarjeta?.contado).toBe('800.0000');
      expect(tarjeta?.diferencia).toBe('0.0000');
    });

    it('deja la línea opcional omitida como informativa (contado NULL)', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
      const dto: CerrarCajaDto = {
        lineas: [
          {
            metodoPagoId: null,
            montoContado: '900',
          },
        ], // solo efectivo
      };
      const { arqueo } = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dto,
      );
      const savedCaja = findSavedCaja();
      expect(savedCaja.diferencia).toBe('-100.0000');
      const tarjeta = arqueo.find((l) => l.metodoPagoId !== null);
      expect(tarjeta?.contado).toBeNull();
      expect(tarjeta?.diferencia).toBeNull();
    });

    it('400 si falta la línea de efectivo (obligatoria)', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
      const dto: CerrarCajaDto = {
        lineas: [
          {
            metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
            montoContado: '800',
          },
        ],
      };
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si el DTO trae un metodoPagoId ajeno al arqueo', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
      const dto: CerrarCajaDto = {
        lineas: [
          { metodoPagoId: null, montoContado: '1000' },
          {
            metodoPagoId: 'eeeeeeee-0000-0000-0000-000000000099',
            montoContado: '50',
          },
        ],
      };
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si una línea no-efectivo con requiere_conteo llega sin contado', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue([
          arqueoRecomputado[0],
          { ...arqueoRecomputado[1], requiereConteo: true },
        ]);
      const dto: CerrarCajaDto = {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      };
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('acepta montoContado con decimales', async () => {
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValue(arqueoRecomputado);
      const dto: CerrarCajaDto = {
        lineas: [
          {
            metodoPagoId: null,
            montoContado: '1000.5000',
          },
          {
            metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
            montoContado: '800',
          },
        ],
      };
      await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dto);
      const savedCaja = findSavedCaja();
      expect(savedCaja.diferencia).toBe('0.5000');
    });

    it('lanza si la caja no está abierta (lock falla)', async () => {
      managerMock.query.mockResolvedValueOnce([]); // lock vacío
      const dto: CerrarCajaDto = {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      };
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('descuadre → en_conciliacion sin exigir motivo (lo captura la fase 2)', async () => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValueOnce([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          esperado: '1000.0000',
          requiereConteo: true,
        },
      ]);
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        usuarioId: USUARIO_ID,
      });
      const { estado, arqueo } = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        {
          lineas: [{ metodoPagoId: null, montoContado: '900' }],
        },
      );
      expect(estado).toBe('en_conciliacion');
      const savedCaja = findSavedCaja();
      expect(savedCaja.diferencia).toBe('-100.0000');
      expect(arqueo[0].motivoDiferenciaId).toBeUndefined();
      expect(arqueo[0].comentarioDiferencia).toBeUndefined();
    });
  });

  describe('calcularEsperadoEfectivo', () => {
    it('suma fondo + entradas efectivo + manuales − salidas (sin no-efectivo)', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '500', salidas: '200' },
      ]);
      const r = await service.calcularEsperadoEfectivo(
        CAJA_ID,
        managerMock as never,
      );
      expect(r).toBe('1300.0000'); // 1000 + 500 − 200
    });

    it('devuelve el fondo cuando no hay movimientos', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: null, salidas: null },
      ]);
      const r = await service.calcularEsperadoEfectivo(
        CAJA_ID,
        managerMock as never,
      );
      expect(r).toBe('1000.0000');
    });
  });

  describe('calcularArqueo', () => {
    it('agrega la línea de efectivo + una línea por cada no-efectivo con movimientos', async () => {
      // 1ª query: esperado efectivo (reusa calcularEsperadoEfectivo)
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '500', salidas: '0' },
      ]);
      // 2ª query: líneas no-efectivo
      managerMock.query.mockResolvedValueOnce([
        {
          metodo_pago_id: 'dddddddd-0000-0000-0000-000000000004',
          nombre: 'Tarjeta de débito',
          requiere_conteo: false,
          entradas: '800',
        },
      ]);
      const lineas = await service.calcularArqueo(
        CAJA_ID,
        TENANT_ID,
        managerMock as never,
      );
      expect(lineas).toEqual([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          esperado: '1500.0000',
          requiereConteo: true,
        },
        {
          metodoPagoId: 'dddddddd-0000-0000-0000-000000000004',
          nombre: 'Tarjeta de débito',
          esEfectivo: false,
          esperado: '800.0000',
          requiereConteo: false,
        },
      ]);
    });

    it('devuelve solo la línea de efectivo cuando no hubo ventas no-efectivo', async () => {
      managerMock.query.mockResolvedValueOnce([
        { saldo_inicial: '1000', entradas_efectivo: '0', salidas: '0' },
      ]);
      managerMock.query.mockResolvedValueOnce([]); // sin no-efectivo
      const lineas = await service.calcularArqueo(
        CAJA_ID,
        TENANT_ID,
        managerMock as never,
      );
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        metodoPagoId: null,
        esEfectivo: true,
        requiereConteo: true,
        esperado: '1000.0000',
      });
    });
  });

  describe('obtenerArqueo', () => {
    const previewEfectivo: LineaArqueo[] = [
      {
        metodoPagoId: null,
        nombre: 'Efectivo',
        esEfectivo: true,
        esperado: '1000.0000',
        requiereConteo: true,
      },
      {
        metodoPagoId: 'mp-tarjeta',
        nombre: 'Tarjeta',
        esEfectivo: false,
        esperado: '5000.0000',
        requiereConteo: false,
      },
    ];

    it('caja abierta + tenant NO ciego → ciego:false, líneas completas con esperado', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'abierta',
      });
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValueOnce(previewEfectivo);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(false);

      const res = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );

      expect(res.ciego).toBe(false);
      expect(res.lineas).toHaveLength(2);
      expect(res.lineas[0]).toMatchObject({
        metodoPagoId: null,
        esperado: '1000.0000',
      });
      expect(res.lineas[0].contado).toBeUndefined();
    });

    it('caja abierta + tenant ciego → ciego:true, solo obligatorias, esperado null', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'abierta',
      });
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValueOnce(previewEfectivo);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true);

      const res = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );

      expect(res.ciego).toBe(true);
      // La tarjeta (no efectivo, requiere_conteo=false) es informativa → se filtra.
      expect(res.lineas).toHaveLength(1);
      expect(res.lineas[0]).toMatchObject({
        metodoPagoId: null,
        esEfectivo: true,
      });
      expect(res.lineas[0].esperado).toBeNull();
    });

    it('caja cerrada → ciego:false SIEMPRE, líneas congeladas reveladas', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true); // aunque el tenant sea ciego
      dataSource.query.mockResolvedValueOnce([
        {
          metodo_pago_id: null,
          nombre: 'Efectivo',
          es_efectivo: true,
          esperado: '1000.0000',
          contado: '950.0000',
          diferencia: '-50.0000',
          requiere_conteo: true,
        },
      ]);

      const res = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );

      expect(res.ciego).toBe(false);
      expect(res.lineas[0]).toMatchObject({
        metodoPagoId: null,
        esperado: '1000.0000',
        contado: '950.0000',
        diferencia: '-50.0000',
      });
    });
  });

  describe('justificarDiferencias', () => {
    it('actualiza el motivo de una línea congelada que descuadra', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      // línea congelada con diferencia ≠ 0
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-100.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({
        id: 'm1',
        nombre: 'falta de efectivo',
        requiereComentario: false,
      });
      managerMock.query.mockResolvedValueOnce(undefined); // UPDATE
      // obtenerArqueo de relectura (fuera de la transacción):
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.justificarDiferencias(TENANT_ID, CAJA_ID, [
        { metodoPagoId: null, motivoDiferenciaId: 'm1' },
      ]);

      expect(res).toEqual({ ciego: false, lineas: [] });
      expect(motivosService.assertMotivoValido).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
        'm1',
      );
      const updateCall = managerMock.query.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE caja_arqueo_medio');
      expect(updateCall[1]).toEqual(['m1', null, CAJA_ID, TENANT_ID]);
    });

    it('no toca líneas que cuadran (diferencia = 0)', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      dataSource.query.mockResolvedValueOnce([]);

      await service.justificarDiferencias(TENANT_ID, CAJA_ID, [
        { metodoPagoId: null, motivoDiferenciaId: 'm1' },
      ]);

      // Solo el SELECT inicial; ningún UPDATE porque la línea cuadra.
      expect(managerMock.query).toHaveBeenCalledTimes(1);
      expect(motivosService.assertMotivoValido).not.toHaveBeenCalled();
    });

    it('400 si la caja no está cerrada', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'abierta',
      });
      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, []),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404 si la caja no existe o no pertenece al tenant', async () => {
      managerMock.findOne.mockResolvedValueOnce(null);
      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, []),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 si hay motivos activos y falta motivoDiferenciaId', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-100.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);

      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, [
          { metodoPagoId: null },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400 si NO hay motivos activos y falta comentario (red de seguridad)', async () => {
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-100.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(false);

      await expect(
        service.justificarDiferencias(TENANT_ID, CAJA_ID, [
          { metodoPagoId: null },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getArqueoCiego / setArqueoCiego', () => {
    it('getArqueoCiego lee tenants.arqueo_ciego filtrando soft-delete', async () => {
      dataSource.query.mockResolvedValueOnce([{ arqueo_ciego: true }]);
      const res = await service.getArqueoCiego(TENANT_ID);
      expect(res).toBe(true);
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('FROM tenants');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(params).toEqual([TENANT_ID]);
    });

    it('getArqueoCiego → false cuando no hay fila', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      expect(await service.getArqueoCiego(TENANT_ID)).toBe(false);
    });

    it('setArqueoCiego actualiza la columna con el tenant del token', async () => {
      dataSource.query.mockResolvedValueOnce(undefined);
      await service.setArqueoCiego(TENANT_ID, true);
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('UPDATE tenants');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(params).toEqual([true, TENANT_ID]);
    });
  });

  describe('historial', () => {
    const mockRow = {
      caja_id: CAJA_ID,
      tenant_id: TENANT_ID,
      usuario_id: USUARIO_ID,
      tipo: 'fisica',
      estado: 'cerrada',
      saldo_inicial: '1000.0000',
      saldo_final: '950.0000',
      monto_contado: '948.0000',
      diferencia: '-2.0000',
      fecha_apertura: new Date('2026-06-29T08:00:00Z'),
      fecha_cierre: new Date('2026-06-29T18:00:00Z'),
      comentario: null,
    };

    it('(a) por defecto retorna solo cajas del usuario con tipo fisica', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([mockRow]);

      const result = await service.historial(TENANT_ID, USUARIO_ID, {}, false);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(CAJA_ID);
      expect(result.meta.total).toBe(1);
    });

    it('(b) todas=true con permiso retorna cajas de todo el tenant', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 2 }])
        .mockResolvedValueOnce([mockRow, { ...mockRow, caja_id: 'other' }]);

      const result = await service.historial(
        TENANT_ID,
        USUARIO_ID,
        { todas: true },
        true,
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it('(c) filtra por usuarioId cuando se indica en query', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([mockRow]);

      const result = await service.historial(
        TENANT_ID,
        USUARIO_ID,
        { usuarioId: USUARIO_ID },
        false,
      );

      expect(result.data).toHaveLength(1);
    });

    it('(d) lanza ForbiddenException si usuarioId ajeno sin Ver todas', async () => {
      await expect(
        service.historial(
          TENANT_ID,
          USUARIO_ID,
          { usuarioId: OTRO_USUARIO },
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(e) permite usuarioId ajeno cuando tiene Ver todas', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ ...mockRow, usuario_id: OTRO_USUARIO }]);

      const result = await service.historial(
        TENANT_ID,
        USUARIO_ID,
        { usuarioId: OTRO_USUARIO },
        true,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].usuarioId).toBe(OTRO_USUARIO);
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

  describe('cajonesEstado', () => {
    it('mapea un cajón ocupado con sesión (nombre completo, saldo esperado, esPropia)', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-1',
          nombre: 'Mostrador',
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

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result).toEqual([
        {
          cajonId: 'cajon-1',
          nombre: 'Mostrador',
          sesion: {
            cajaId: CAJA_ID,
            usuarioId: USUARIO_ID,
            usuarioNombre: 'Ana Pérez',
            saldoInicial: '1000.0000',
            saldoEsperado: '1150.0000',
            fechaApertura: new Date('2026-06-29T10:00:00Z'),
            esPropia: true,
          },
        },
      ]);
    });

    it('mapea un cajón libre (sin sesión) con sesion=null', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-2',
          nombre: 'Delivery',
          caja_id: null,
          usuario_id: null,
          usuario_nombre: null,
          usuario_apellido: null,
          saldo_inicial: null,
          fecha_apertura: null,
          total_entradas: null,
          total_salidas: null,
        },
      ]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result).toEqual([
        { cajonId: 'cajon-2', nombre: 'Delivery', sesion: null },
      ]);
    });

    it('marca esPropia=false para sesión de otro usuario y trata montos nulos como 0', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-3',
          nombre: 'Barra',
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

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      expect(result[0]?.sesion).toMatchObject({
        usuarioNombre: 'Beto',
        saldoEsperado: '500.0000',
        esPropia: false,
      });
    });

    it('pasa tenantId como único parámetro de la query', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.cajonesEstado(TENANT_ID, USUARIO_ID);

      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([TENANT_ID]);
    });
  });
});

const TENANT = 'tenant-uuid';
const USER = 'user-uuid';
const CAJON = 'cajon-uuid';

// Respuestas por tabla que consulta abrir(): cajon (SELECT ... FROM cajones),
// allow-list total (COUNT ... cajon_usuario sin usuario_id), mi-allow
// (COUNT ... cajon_usuario con usuario_id), ocupadas (SELECT ... FROM cajas ... FOR UPDATE).
interface AbrirMocks {
  cajon?: Array<{ cajon_id: string; activo: boolean }>;
  allowTotal?: number;
  miAllow?: number;
  ocupadas?: Array<{ caja_id: string }>;
}

function makeManager(m: AbrirMocks) {
  return {
    query: jest.fn((sql: string) => {
      if (/FROM cajones/i.test(sql)) return Promise.resolve(m.cajon ?? []);
      if (/FROM cajon_usuario/i.test(sql)) {
        // el que filtra por usuario_id es "mi-allow"
        if (/usuario_id\s*=/i.test(sql)) {
          return Promise.resolve([{ total: m.miAllow ?? 0 }]);
        }
        return Promise.resolve([{ total: m.allowTotal ?? 0 }]);
      }
      if (/FROM cajas/i.test(sql)) return Promise.resolve(m.ocupadas ?? []);
      return Promise.resolve([]);
    }),
    create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
      ...data,
    })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
  };
}

describe('CajaService.abrir', () => {
  let service: CajaService;
  let cajaRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock; query: jest.Mock };
  let manager: ReturnType<typeof makeManager>;

  function build(mocks: AbrirMocks, existente: Caja | null = null) {
    cajaRepo.findOne.mockResolvedValue(existente);
    manager = makeManager(mocks);
    dataSource.transaction.mockImplementation(
      (cb: (m: typeof manager) => unknown) => cb(manager),
    );
  }

  beforeEach(async () => {
    cajaRepo = { findOne: jest.fn() };
    dataSource = { transaction: jest.fn(), query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getRepositoryToken(MovimientoCaja), useValue: {} },
        {
          provide: getRepositoryToken(CajaArqueoMedio),
          useValue: { create: jest.fn((x) => x), save: jest.fn() },
        },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: MotivosDiferenciaService,
          useValue: {
            assertMotivoValido: jest.fn(),
            hayMotivosActivos: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get<CajaService>(CajaService);
  });

  const dto = { cajonId: CAJON, saldoInicial: '0', comentario: undefined };

  it('abre sobre un cajón autorizado (allow-list vacía) y libre', async () => {
    build({
      cajon: [{ cajon_id: CAJON, activo: true }],
      allowTotal: 0,
      ocupadas: [],
    });
    const res = await service.abrir(TENANT, USER, dto);
    expect(res).toMatchObject({
      cajonId: CAJON,
      tipo: 'fisica',
      estado: 'abierta',
    });
    expect(manager.save).toHaveBeenCalled();
  });

  it('persiste saldoInicial y comentario del DTO en la caja creada', async () => {
    build({
      cajon: [{ cajon_id: CAJON, activo: true }],
      allowTotal: 0,
      ocupadas: [],
    });
    const dtoConDatos = {
      cajonId: CAJON,
      saldoInicial: '150.5',
      comentario: 'apertura de prueba',
    };
    const res = await service.abrir(TENANT, USER, dtoConDatos);
    expect(res).toMatchObject({
      cajonId: CAJON,
      tipo: 'fisica',
      estado: 'abierta',
      saldoInicial: '150.5',
      comentario: 'apertura de prueba',
    });
  });

  it('rechaza si el usuario ya tiene una caja abierta (409)', async () => {
    build({}, { id: 'x' } as Caja);
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rechaza cajón inexistente (404)', async () => {
    build({ cajon: [] });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rechaza cajón inactivo (409)', async () => {
    build({ cajon: [{ cajon_id: CAJON, activo: false }] });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rechaza si la allow-list no está vacía y el usuario no está (403)', async () => {
    build({
      cajon: [{ cajon_id: CAJON, activo: true }],
      allowTotal: 2,
      miAllow: 0,
    });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite si la allow-list contiene al usuario', async () => {
    build({
      cajon: [{ cajon_id: CAJON, activo: true }],
      allowTotal: 2,
      miAllow: 1,
      ocupadas: [],
    });
    const res = await service.abrir(TENANT, USER, dto);
    expect(res).toMatchObject({ cajonId: CAJON });
  });

  it('rechaza si el cajón ya tiene una caja abierta (409)', async () => {
    build({
      cajon: [{ cajon_id: CAJON, activo: true }],
      allowTotal: 0,
      ocupadas: [{ caja_id: 'otra' }],
    });
    await expect(service.abrir(TENANT, USER, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
