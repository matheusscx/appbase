import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { In, IsNull, QueryFailedError } from 'typeorm';
import { CajaService } from './caja.service';
import type { LineaArqueo } from './caja.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import type { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import type { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { MotivosDiferenciaService } from '../motivos-diferencia/motivos-diferencia.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';
import { CajaTestigoService } from './caja-testigo.service';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTRO_USUARIO = 'ffffffff-0000-0000-0000-000000000099';
const CAJA_ID = 'cccccccc-0000-0000-0000-000000000003';
const ADMIN_ID = 'eeeeeeee-0000-0000-0000-000000000005';

const mockCajaAbierta: Partial<Caja> = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  usuarioId: USUARIO_ID,
  tipo: 'fisica',
  estado: 'abierta',
  saldoInicial: '1000',
  eliminadoEl: null,
  // `null` explícito, no `undefined`: una caja recién abierta que TODAVÍA no
  // pasó por `enviarConteo` (fase 1) es el único estado real donde
  // `cerradaPor` no está seteado — `undefined` no es un valor que TypeORM
  // devuelva (el `findOne` no lleva `select`). Cada test de `cerrar` que le
  // importa quién contó lo sobreescribe explícitamente.
  cerradaPor: null,
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
  const sesionesGarzonServiceMock = {
    contarAbiertas: jest.fn(),
  };
  const cajaTestigoServiceMock = {
    hayFirmaDe: jest.fn(),
    cancelarPendientes: jest.fn(),
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
    // Default: sin garzones en turno. Cada test que le importa el número lo
    // sobreescribe explícitamente (ver describe('enviarConteo')).
    sesionesGarzonServiceMock.contarAbiertas.mockReset().mockResolvedValue(0);
    // Default: nadie firmó y no hay pendientes que cancelar. Cada test de
    // `cerrar` que le importa el resultado lo sobreescribe explícitamente.
    cajaTestigoServiceMock.hayFirmaDe.mockReset().mockResolvedValue(false);
    cajaTestigoServiceMock.cancelarPendientes
      .mockReset()
      .mockResolvedValue(undefined);

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
        {
          provide: SesionesGarzonService,
          useValue: sesionesGarzonServiceMock,
        },
        { provide: CajaTestigoService, useValue: cajaTestigoServiceMock },
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

    // Cierre forzado (owner 2026-08-11): un admin del tenant puede cerrar la
    // caja de otro cajero. `dtoConteo` cuadra exacto con el arqueo mockeado en
    // el beforeEach (esperado '1000.0000' == montoContado '1000') a propósito:
    // sirve tanto para los tests que no miran `estado` como para los que sí.
    const dtoConteo: CerrarCajaDto = {
      lineas: [{ metodoPagoId: null, montoContado: '1000' }],
    };

    it('cierre forzado: un admin no dueño puede enviar el conteo y queda registrado quién contó', async () => {
      managerMock.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });

      await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        true,
      );

      expect(managerMock.save).toHaveBeenCalledWith(
        Caja,
        expect.objectContaining({ cerradaPor: USUARIO_ID }),
      );
    });

    it('cierre normal: cerrada_por también se guarda, y es el dueño', async () => {
      await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        false,
      );

      expect(managerMock.save).toHaveBeenCalledWith(
        Caja,
        expect.objectContaining({ cerradaPor: USUARIO_ID }),
      );
    });

    // Combinación más frecuente en un local chico: el admin-cajero cerrando su
    // propio turno. `esAdmin=true` pero `esForzado` sigue en false porque el
    // dueño de la caja es el mismo usuario del token — nada de esto pasa por
    // conciliación forzada, se comporta como un cierre normal.
    it('un admin que además es el dueño de la caja: NO es forzado, auto-cierra si cuadra', async () => {
      const r = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        true,
      );

      expect(r.estado).toBe('cerrada');
      expect(managerMock.save).toHaveBeenCalledWith(
        Caja,
        expect.objectContaining({ cerradaPor: USUARIO_ID }),
      );
    });

    it('un NO admin que no es dueño sigue sin poder tocar la caja', async () => {
      managerMock.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });

      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dtoConteo, false),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // El retoque al flujo existente: sin esta ventana no hay dónde poner la firma.
    it('un cierre forzado que CUADRA igual queda en_conciliacion, no se auto-cierra', async () => {
      managerMock.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        usuarioId: OTRO_USUARIO,
      });

      const r = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        true,
      );

      expect(r.estado).toBe('en_conciliacion');
    });

    it('un cierre NORMAL que cuadra sigue auto-cerrándose', async () => {
      const r = await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        false,
      );

      expect(r.estado).toBe('cerrada');
    });

    it('congela cuántos garzones había en turno', async () => {
      sesionesGarzonServiceMock.contarAbiertas.mockResolvedValue(3);

      await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        false,
      );

      expect(managerMock.save).toHaveBeenCalledWith(
        Caja,
        expect.objectContaining({ testigosDisponibles: 3 }),
      );
    });

    // El lock `FOR UPDATE` de `bloquearCajaAbierta` sigue vivo durante toda la
    // transacción: pedir el conteo con `dataSource.query` (otra conexión del
    // pool) en vez del `manager` de esta transacción es el patrón de deadlock
    // documentado en `docs/agent/pendientes.md`. Este test es la red para que
    // no vuelva.
    it('cuenta los garzones con el `manager` de la transacción, no con una conexión nueva del pool', async () => {
      await service.enviarConteo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        dtoConteo,
        false,
      );

      expect(sesionesGarzonServiceMock.contarAbiertas).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
      );
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

    it('caja abierta + tenant ciego pero esAdmin=true → ciego:false con esperado (no consulta el flag)', async () => {
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'abierta',
      });
      jest
        .spyOn(service, 'calcularArqueo')
        .mockResolvedValueOnce(previewEfectivo);
      const flag = jest.spyOn(service, 'getArqueoCiego');

      const res = await service.obtenerArqueo(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
        true,
      );

      expect(res.ciego).toBe(false);
      expect(res.lineas).toEqual(previewEfectivo);
      expect(flag).not.toHaveBeenCalled();
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

  // El endpoint HTTP valida el signo por DTO, pero este helper es el que usan
  // ventas y pagos, y es por donde entró el bug del vuelto: no tenía guard propio.
  describe('registrarMovimientoEnTransaccion', () => {
    it('rechaza un monto negativo: el signo lo codifica `tipo`, no el monto', async () => {
      await expect(
        service.registrarMovimientoEnTransaccion(managerMock as never, {
          cajaId: CAJA_ID,
          tipo: 'entrada',
          concepto: 'prueba',
          monto: '-500.0000',
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    // El par del test de arriba, y el que impide "endurecer" esto a `> 0`: un
    // pago devuelto íntegro como vuelto deja neto 0 y esa venta es legítima.
    // Exigir positivo acá la tumbaba entera con 422 (lo cazó la revisión).
    it.each([['0.0000'], ['500.0000']])('acepta monto %s', async (monto) => {
      managerMock.save.mockResolvedValueOnce({ id: 'mov-1' });
      await service.registrarMovimientoEnTransaccion(managerMock as never, {
        cajaId: CAJA_ID,
        tipo: 'entrada',
        concepto: 'prueba',
        monto,
      });
      expect(managerMock.save).toHaveBeenCalled();
    });
  });

  describe('cerrar (finalizar desde en_conciliacion)', () => {
    it('400 si la caja no está en_conciliacion', async () => {
      managerMock.query.mockResolvedValueOnce([]); // lock: no hay fila en_conciliacion
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
          lineas: [],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un no-owner que no es admin → 403', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
      });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
          lineas: [],
        } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('owner finaliza: aplica motivos y pasa a cerrada + fechaCierre', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: USUARIO_ID, // el propio dueño contó: no forzado
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-100.0000' },
      ]); // filas congeladas
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
        usuarioId: USUARIO_ID,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
        lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
      });

      // manager.save(Caja, caja) — el objeto guardado es el 2º argumento.
      const savedCaja = managerMock.save.mock.calls.at(-1)[1];
      expect(savedCaja.estado).toBe('cerrada');
      expect(savedCaja.fechaCierre).toBeInstanceOf(Date);
      expect(res.caja.estado).toBe('cerrada');
    });

    it('admin (no owner) puede finalizar', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        // Sin descuadre (ver abajo), la única forma de llegar acá es forzado
        // — alguien contó por OTRO_USUARIO. Con firma, no exige comentario.
        cerradaPor: USUARIO_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]); // sin descuadre → no exige motivo
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(true);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, true, {
        lineas: [],
      });
      expect(res.caja.estado).toBe('cerrada');
    });

    // El recorrido tiene que salir del arqueo congelado, no del payload: mientras
    // iteraba `dto.lineas`, mandar `lineas: []` cerraba la caja sin justificar
    // nada. El test de arriba (diferencia 0 + `lineas: []` → cierra) es el par que
    // impide "arreglarlo" exigiendo siempre un array no vacío.
    it('400 si una línea descuadra y el payload la omite (mandar `lineas: []` no alcanza)', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        // No forzado: sin esto la caja "forzada por default" (cerradaPor:
        // null del fixture) pasaría por el motivo equivocado — el 400 de
        // este test tiene que salir de `aplicarMotivosADescuadres`, no del
        // comentario obligatorio.
        cerradaPor: USUARIO_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-1000.0000' },
      ]); // el arqueo congelado SÍ tiene un descuadre
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);

      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
          lineas: [],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Y corta antes de tocar la caja: sigue en_conciliacion.
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    // Camino de éxito con cruce de clave no trivial: sin esto, un bug que cruzara
    // mal payload↔fila escribiría el motivo en la línea equivocada y devolvería
    // 200 — un error silencioso que ningún test de fallo detecta.
    it('dos líneas descuadradas justificadas: cada motivo va a SU propia fila', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: USUARIO_ID, // el propio dueño contó: no forzado
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-1000.0000' },
        { metodo_pago_id: 'mp-tarjeta', diferencia: '-500.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      // Dependiente del ARGUMENTO, no del orden de llamada: si el mock resolviera
      // por orden, un cruce roto igual escribiría el motivo "correcto" y el test
      // pasaría sin comprobar nada. En producción `assertMotivoValido` filtra por
      // el id recibido, así que esto reproduce su contrato real.
      motivosService.assertMotivoValido.mockImplementation(
        (_manager: unknown, _tenantId: string, motivoId: string) =>
          Promise.resolve({
            id: motivoId,
            nombre: motivoId,
            requiereComentario: false,
          }),
      );
      managerMock.query.mockResolvedValueOnce(undefined); // UPDATE efectivo
      managerMock.query.mockResolvedValueOnce(undefined); // UPDATE tarjeta
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: USUARIO_ID,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
        lineas: [
          { metodoPagoId: 'mp-tarjeta', motivoDiferenciaId: 'm-tarjeta' },
          { metodoPagoId: null, motivoDiferenciaId: 'm-efectivo' },
        ],
      });

      expect(res.caja.estado).toBe('cerrada');
      // El payload viene en orden inverso al del arqueo a propósito: si el cruce
      // fuera posicional en vez de por método, los motivos saldrían cambiados.
      const updates = managerMock.query.mock.calls
        .filter(([sql]: [string]) => sql.includes('UPDATE caja_arqueo_medio'))
        .map(([sql, params]) => ({
          porNull: sql.includes('metodo_pago_id IS NULL'),
          params,
        }));
      expect(updates).toHaveLength(2);
      const efectivo = updates.find((u) => u.porNull);
      const tarjeta = updates.find((u) => !u.porNull);
      expect(efectivo?.params).toEqual([
        'm-efectivo',
        null,
        CAJA_ID,
        TENANT_ID,
      ]);
      expect(tarjeta?.params).toEqual([
        'm-tarjeta',
        null,
        CAJA_ID,
        TENANT_ID,
        'mp-tarjeta',
      ]);
    });

    it('400 si descuadran dos líneas y el payload solo justifica una', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: USUARIO_ID, // no forzado: mismo motivo que el test anterior
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '-1000.0000' },
        { metodo_pago_id: 'mp-tarjeta', diferencia: '-500.0000' },
      ]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({
        id: 'm1',
        nombre: 'falta de efectivo',
        requiereComentario: false,
      });
      managerMock.query.mockResolvedValueOnce(undefined); // UPDATE de la de efectivo

      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
          lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(managerMock.save).not.toHaveBeenCalled();
    });

    // "Forzado" se deriva de `cerradaPor !== usuarioId` (dueño de la caja), no
    // de un flag aparte: `cerradaPor` lo llena SIEMPRE `enviarConteo`.
    it('cierre forzado sin ninguna firma exige comentario', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        cerradaPor: ADMIN_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]); // sin descuadre → no exige motivo
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(false);

      await expect(
        service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
          lineas: [],
        } as any),
      ).rejects.toThrow(/comentario/i);

      expect(cajaTestigoServiceMock.hayFirmaDe).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
        CAJA_ID,
      );
      // Y corta antes de tocar la caja: sigue en_conciliacion.
      expect(managerMock.save).not.toHaveBeenCalled();
    });

    it('cierre forzado CON firma no exige comentario', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        cerradaPor: ADMIN_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(true);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
        lineas: [],
      });

      expect(res.caja.estado).toBe('cerrada');
    });

    it('cierre NORMAL (sin forzar) sin comentario sigue funcionando', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: USUARIO_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: USUARIO_ID,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
        lineas: [],
      });

      expect(res.caja.estado).toBe('cerrada');
      expect(cajaTestigoServiceMock.hayFirmaDe).not.toHaveBeenCalled();
    });

    it('al cerrar, las solicitudes de testigo pendientes quedan canceladas', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        cerradaPor: ADMIN_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(true);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query.mockResolvedValueOnce([]);

      await service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
        lineas: [],
      });

      expect(cajaTestigoServiceMock.cancelarPendientes).toHaveBeenCalledWith(
        managerMock,
        TENANT_ID,
        CAJA_ID,
      );
    });

    // Fail-closed: `cerradaPor` ausente es hoy inalcanzable (`enviarConteo` lo
    // llena siempre para llegar a `en_conciliacion`), pero si un `select`
    // parcial futuro lo dejara afuera, el control tiene que exigir la
    // explicación en vez de perdonarla en silencio.
    it('cerradaPor ausente (defensivo) se trata como forzado: exige comentario', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: null,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);

      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
          lineas: [],
        } as any),
      ).rejects.toThrow(/comentario/i);

      expect(managerMock.save).not.toHaveBeenCalled();
    });

    // Decisión del owner 2026-08-12: el comentario que el encargado ya
    // escribió en la fase 1 (`enviarConteo`, persistido en
    // `caja.comentarioCierre` — columna separada de la apertura, ver abajo)
    // alcanza como explicación — no hace falta uno NUEVO en esta fase.
    it('el comentario de la fase 1 alcanza: no exige uno nuevo en el DTO', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        cerradaPor: ADMIN_ID,
        comentarioCierre: 'conté solo, no había nadie en turno',
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(false);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query.mockResolvedValueOnce([]);

      const res = await service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
        lineas: [],
      });

      expect(res.caja.estado).toBe('cerrada');
      const savedCaja = managerMock.save.mock.calls.at(-1)[1];
      expect(savedCaja.comentarioCierre).toBe(
        'conté solo, no había nadie en turno',
      );
    });

    // Corrección de la revisión (ronda 3 → pivote del owner, ronda 4): la
    // primera corrección concatenaba fase 1 y fase 2 en la MISMA columna
    // (`caja.comentario`) — el owner señaló que eso era parchar la confusión,
    // no arreglarla: el comentario de la APERTURA y el del CIERRE no tienen
    // nada que ver entre sí y nunca deberían compartir columna. Con
    // `comentarioCierre` separado de `comentario`, este es el mutante que de
    // verdad importa: que el cierre NUNCA escriba en la columna de apertura,
    // ni la pise ni la borre.
    it('el comentario de la apertura y el del cierre se conservan por separado', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: OTRO_USUARIO,
        cerradaPor: ADMIN_ID,
        comentario: 'fondo de $50.000 para el turno de la tarde', // apertura
        comentarioCierre: null, // fase 1 no dejó nada
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaTestigoServiceMock.hayFirmaDe.mockResolvedValueOnce(false);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: OTRO_USUARIO,
      });
      dataSource.query.mockResolvedValueOnce([]);

      await service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
        lineas: [],
        comentario: 'nadie firmó, cierro para no dejar trabado al cajero',
      });

      const savedCaja = managerMock.save.mock.calls.at(-1)[1];
      expect(savedCaja.comentario).toBe(
        'fondo de $50.000 para el turno de la tarde',
      );
      expect(savedCaja.comentarioCierre).toBe(
        'nadie firmó, cierro para no dejar trabado al cajero',
      );
    });

    // Minor de la revisión: el DTO acepta `comentario` en CUALQUIER cierre, no
    // solo en el forzado sin firma — descartarlo en silencio en los demás
    // casos perdería una explicación que el usuario sí escribió.
    it('un cierre normal (no forzado) con comentario en el DTO lo guarda', async () => {
      managerMock.query.mockResolvedValueOnce([{ caja_id: CAJA_ID }]); // lock ok
      managerMock.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'en_conciliacion',
        usuarioId: USUARIO_ID,
        cerradaPor: USUARIO_ID,
      });
      managerMock.query.mockResolvedValueOnce([
        { metodo_pago_id: null, diferencia: '0.0000' },
      ]);
      cajaRepo.findOne.mockResolvedValueOnce({
        ...mockCajaAbierta,
        estado: 'cerrada',
        usuarioId: USUARIO_ID,
      });
      dataSource.query.mockResolvedValueOnce([]);

      await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
        lineas: [],
        comentario: 'todo ok, cerré rápido',
      });

      const savedCaja = managerMock.save.mock.calls.at(-1)[1];
      expect(savedCaja.comentarioCierre).toBe('todo ok, cerré rápido');
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
      // Sin cajonId (mock) → no se consulta el nombre; cajonNombre queda null.
      expect(result).toEqual({ ...mockCajaAbierta, cajonNombre: null });
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('(c2) resuelve el nombre del cajón para una caja física', async () => {
      cajaRepo.findOne.mockResolvedValue({
        ...mockCajaAbierta,
        cajonId: 'cajon-1',
      });
      dataSource.query.mockResolvedValueOnce([{ nombre: 'Barra' }]);

      const result = await service.findOne(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
      );

      expect(result.cajonNombre).toBe('Barra');
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

      expect(result).toEqual({ ...cajaOtro, cajonNombre: null });
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
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(false);
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
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(false);
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

    it('ciego + caja abierta: devuelve página vacía sin consultar movimientos_caja', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true);

      const result = await service.listarMovimientos(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        {},
      );

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('esAdmin=true: revela movimientos aun en caja abierta ciega (no consulta el flag)', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      const flag = jest.spyOn(service, 'getArqueoCiego');
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'm1',
            caja_id: CAJA_ID,
            tipo: 'salida',
            concepto: 'x',
            monto: '500.0000',
            referencia: null,
            fecha: new Date('2026-01-01'),
            venta_id: null,
          },
        ]);

      const result = await service.listarMovimientos(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        {},
        false,
        true,
      );

      expect(result.meta.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(flag).not.toHaveBeenCalled();
    });
  });

  describe('resumenMovimientos', () => {
    it('calcula totales del turno', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(false);
      dataSource.query.mockResolvedValue([
        {
          saldo_inicial: '1000.0000',
          estado: 'abierta',
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
        ciego: false,
        saldoInicial: '1000.0000',
        totalEntradas: '500.0000',
        totalSalidas: '200.0000',
        saldoEsperado: '1300.0000',
        totalMovimientos: 3,
      });
    });

    it('ciego + caja abierta: oculta totales (ciego:true, saldoInicial presente, resto null)', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValueOnce(true);
      dataSource.query.mockResolvedValue([
        {
          saldo_inicial: '1000.0000',
          estado: 'abierta',
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
        ciego: true,
        saldoInicial: '1000.0000',
        totalEntradas: null,
        totalSalidas: null,
        saldoEsperado: null,
        totalMovimientos: null,
      });
    });

    it('esAdmin=true: revela cifras aun en caja abierta ciega (no consulta el flag)', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);
      const flag = jest.spyOn(service, 'getArqueoCiego');
      dataSource.query.mockResolvedValue([
        {
          saldo_inicial: '1000.0000',
          estado: 'abierta',
          total_entradas: '500.0000',
          total_salidas: '200.0000',
          total_movimientos: 3,
        },
      ]);

      const result = await service.resumenMovimientos(
        TENANT_ID,
        USUARIO_ID,
        CAJA_ID,
        false,
        true,
      );

      expect(result.ciego).toBe(false);
      expect(result.saldoEsperado).toBe('1300.0000');
      expect(flag).not.toHaveBeenCalled();
    });
  });

  describe('cajonesEstado', () => {
    // El default de la grilla es "tenant sin modo ciego": cada test que ejerce
    // el ciego lo pisa explícitamente.
    beforeEach(() => {
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValue(false);
    });

    it('mapea un cajón ocupado con sesión (nombre completo, saldo esperado, esPropia)', async () => {
      dataSource.query.mockResolvedValue([
        {
          cajon_id: 'cajon-1',
          nombre: 'Mostrador',
          caja_id: CAJA_ID,
          estado: 'abierta',
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
          estado: 'abierta',
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

    // La grilla de supervisión era la puerta de atrás del cierre ciego: mostraba
    // el esperado que `obtenerArqueo` retiene. Los tres tests de abajo fijan las
    // tres condiciones de la regla (`!esAdmin`, ciego, caja `abierta`); sacar
    // cualquiera de las tres hace fallar exactamente uno.
    const filaOcupada = (estado: string) => ({
      cajon_id: 'cajon-1',
      nombre: 'Mostrador',
      caja_id: CAJA_ID,
      estado,
      usuario_id: USUARIO_ID,
      usuario_nombre: 'Ana',
      usuario_apellido: 'Pérez',
      saldo_inicial: '1000',
      fecha_apertura: new Date('2026-06-29T10:00:00Z'),
      total_entradas: '200',
      total_salidas: '50',
    });

    it('modo ciego + caja abierta + no-admin: retiene el saldoEsperado (null)', async () => {
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValue(true);
      dataSource.query.mockResolvedValue([filaOcupada('abierta')]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID, false);

      expect(result[0]?.sesion?.saldoEsperado).toBeNull();
      // El saldo inicial NO es secreto: el cajero lo declaró al abrir.
      expect(result[0]?.sesion?.saldoInicial).toBe('1000.0000');
    });

    it('modo ciego + caja abierta + admin: revela el saldoEsperado sin consultar el flag', async () => {
      const flag = jest
        .spyOn(service, 'getArqueoCiego')
        .mockResolvedValue(true);
      dataSource.query.mockResolvedValue([filaOcupada('abierta')]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID, true);

      expect(result[0]?.sesion?.saldoEsperado).toBe('1150.0000');
      // Cortocircuito: para un admin ni se consulta la config (sin query de más).
      expect(flag).not.toHaveBeenCalled();
    });

    it('modo ciego + caja en_conciliacion: revela, porque el conteo ya se congeló', async () => {
      jest.spyOn(service, 'getArqueoCiego').mockResolvedValue(true);
      dataSource.query.mockResolvedValue([filaOcupada('en_conciliacion')]);

      const result = await service.cajonesEstado(TENANT_ID, USUARIO_ID, false);

      expect(result[0]?.sesion?.saldoEsperado).toBe('1150.0000');
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
        {
          provide: SesionesGarzonService,
          useValue: { contarAbiertas: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: CajaTestigoService,
          useValue: { hayFirmaDe: jest.fn(), cancelarPendientes: jest.fn() },
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

  // El chequeo aplicativo corre fuera de la transacción, así que bajo
  // concurrencia el que frena es el índice único (23505). Hay DOS índices y el
  // mensaje tiene que decir cuál se violó: "ya tenés una caja" y "el cajón está
  // ocupado" mandan al usuario a hacer cosas distintas.
  it.each([
    ['ux_cajas_activa_por_usuario', 'Ya tienes una caja abierta'],
    ['ux_cajas_cajon_abierta', 'El cajón ya tiene una caja abierta'],
  ])('traduce el 23505 de %s a su propio mensaje', async (constraint, msg) => {
    build({ cajon: [{ cajon_id: CAJON, activo: true }] });
    const err = new QueryFailedError('INSERT', [], new Error('duplicate key'));
    (err as unknown as { code: string }).code = '23505';
    (err as unknown as { constraint: string }).constraint = constraint;
    manager.save.mockRejectedValueOnce(err);

    await expect(service.abrir(TENANT, USER, dto)).rejects.toThrow(msg);
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
