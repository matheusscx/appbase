import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CajaTestigoService } from './caja-testigo.service';
import { CajaTestigo } from './entities/caja-testigo.entity';
import { Caja } from './entities/caja.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { SesionesGarzonService } from '../turnos/sesiones-garzon.service';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADMIN_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const CAJA_ID = 'cccccccc-0000-0000-0000-000000000003';
const GARZON_A = 'dddddddd-0000-0000-0000-000000000004';
const GARZON_B = 'eeeeeeee-0000-0000-0000-000000000005';
const SESION_A = 'ffffffff-0000-0000-0000-000000000006';
const SESION_B = 'a1a1a1a1-0000-0000-0000-000000000007';
const TESTIGO_ID = 'a2a2a2a2-0000-0000-0000-000000000008';
// Cuenta con la que un dispositivo compartido (tótem) llama, sin ser la
// cuenta vinculada de ningún garzón — el caso normal cuando alguien resuelve
// por PIN.
const TOTEM_USUARIO_ID = 'c3c3c3c3-0000-0000-0000-000000000009';
// La cuenta vinculada a GARZON_A cuando está en modo "vía cuenta".
const USUARIO_VINCULADO_ID = 'd4d4d4d4-0000-0000-0000-00000000000a';
// Un garzón puede tener `usuario_id` seteado apuntando a la cuenta del
// TÓTEM (vinculación mal configurada). Distinta de TOTEM_USUARIO_ID solo
// para que quede claro en los tests cuál es cuál.
const CUENTA_TOTEM_VINCULADA_ID = 'e5e5e5e5-0000-0000-0000-00000000000b';

const cajaEnConciliacion: Partial<Caja> = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  estado: 'en_conciliacion',
  eliminadoEl: null,
};

// Factory, no objeto compartido: `resolver` MUTA la fila en memoria antes de
// guardarla (`testigo.estado = ...`), así que reusar la misma instancia entre
// tests dejaría el estado de un test filtrado al siguiente — el mismo molde
// de fuga que ya se cerró en garzones (commit 4af169ec).
function crearTestigoPendiente(): Partial<CajaTestigo> {
  return {
    id: TESTIGO_ID,
    tenantId: TENANT_ID,
    cajaId: CAJA_ID,
    garzonId: GARZON_A,
    sesionGarzonId: SESION_A,
    estado: 'pendiente',
    comentarioGarzon: null,
    resueltaEl: null,
    resueltaPorUsuarioId: null,
    viaFirma: null,
  };
}

describe('CajaTestigoService', () => {
  let service: CajaTestigoService;
  let testigoRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let cajaRepo: { findOne: jest.Mock };
  let dataSource: { query: jest.Mock };
  const sesionesGarzonServiceMock = { listarAbiertas: jest.fn() };
  const garzonesServiceMock = {
    verificarPin: jest.fn(),
    obtenerActivoPorId: jest.fn(),
    miVinculo: jest.fn(),
    resolverGarzonActuante: jest.fn(),
  };
  const managerMock = {
    update: jest.fn(),
    count: jest.fn(),
  } as unknown as EntityManager;

  beforeEach(async () => {
    testigoRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(crearTestigoPendiente()),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve(x)),
    };
    cajaRepo = { findOne: jest.fn().mockResolvedValue(cajaEnConciliacion) };
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    sesionesGarzonServiceMock.listarAbiertas.mockReset().mockResolvedValue([
      { garzonId: GARZON_A, id: SESION_A },
      { garzonId: GARZON_B, id: SESION_B },
    ]);
    garzonesServiceMock.verificarPin.mockReset().mockResolvedValue({});
    // Default: garzón SIN vincular (vía PIN, el caso de siempre). Los tests
    // de "vía cuenta" lo sobreescriben con `usuarioId` seteado.
    garzonesServiceMock.obtenerActivoPorId
      .mockReset()
      .mockResolvedValue({ id: GARZON_A, usuarioId: null });
    // Default: quien llama NO está vinculado a ningún garzón (tótem). Los
    // tests de "vía cuenta"/vinculación lo sobreescriben.
    garzonesServiceMock.miVinculo.mockReset().mockResolvedValue(null);
    // Default: `resolverGarzonActuante` resuelve GARZON_A (modo tótem con
    // credencial explícita). Los tests de `pendientesDeGarzon` que necesitan
    // otro garzón, o que el vínculo personal ignore la credencial, lo
    // sobreescriben.
    garzonesServiceMock.resolverGarzonActuante
      .mockReset()
      .mockResolvedValue({ id: GARZON_A, usuarioId: null });
    (managerMock.update as jest.Mock).mockReset();
    (managerMock.count as jest.Mock).mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaTestigoService,
        { provide: getRepositoryToken(CajaTestigo), useValue: testigoRepo },
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: SesionesGarzonService,
          useValue: sesionesGarzonServiceMock,
        },
        { provide: GarzonesService, useValue: garzonesServiceMock },
      ],
    }).compile();

    service = module.get<CajaTestigoService>(CajaTestigoService);
  });

  describe('solicitar', () => {
    it('solicita a los garzones con sesión abierta y deja las filas pendientes', async () => {
      const resultado = await service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [
        GARZON_A,
      ]);

      expect(testigoRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          cajaId: CAJA_ID,
          garzonId: GARZON_A,
          sesionGarzonId: SESION_A,
          solicitadaPor: ADMIN_ID,
          estado: 'pendiente',
        }),
      );
      expect(resultado).toHaveLength(1);
    });

    it('pide fe a varios garzones en un solo llamado, una fila por garzón', async () => {
      await service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [
        GARZON_A,
        GARZON_B,
      ]);

      expect(testigoRepo.save).toHaveBeenCalledTimes(2);
      expect(testigoRepo.save).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          garzonId: GARZON_A,
          sesionGarzonId: SESION_A,
        }),
      );
      expect(testigoRepo.save).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          garzonId: GARZON_B,
          sesionGarzonId: SESION_B,
        }),
      );
    });

    it('rechaza pedirle fe a un garzón SIN sesión abierta', async () => {
      sesionesGarzonServiceMock.listarAbiertas.mockResolvedValue([]);

      await expect(
        service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(testigoRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza pedirle fe a un garzón que no está en la lista de sesiones abiertas', async () => {
      sesionesGarzonServiceMock.listarAbiertas.mockResolvedValue([
        { garzonId: GARZON_B, id: SESION_B },
      ]);

      await expect(
        service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Regresión de la revisión independiente (ronda 3, IMPORTANT 2): validar
    // y escribir en el mismo loop dejaba la fila de A ya commiteada cuando B
    // fallaba, y un reintento de [A, B] fallaba en A por 23505 en vez del
    // error real. Todas las sesiones se resuelven ANTES de escribir nada.
    it('no escribe ninguna fila si algún garzón de la lista no tiene sesión (todo o nada)', async () => {
      sesionesGarzonServiceMock.listarAbiertas.mockResolvedValue([
        { garzonId: GARZON_A, id: SESION_A },
        // GARZON_B no tiene sesión abierta.
      ]);

      await expect(
        service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A, GARZON_B]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(testigoRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza pedir testigo si la caja no existe', async () => {
      cajaRepo.findOne.mockResolvedValue(null);

      await expect(
        service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sesionesGarzonServiceMock.listarAbiertas).not.toHaveBeenCalled();
    });

    it('solo se puede solicitar sobre una caja en conciliación (conteo ya congelado)', async () => {
      cajaRepo.findOne.mockResolvedValue({
        id: CAJA_ID,
        tenantId: TENANT_ID,
        estado: 'abierta',
        eliminadoEl: null,
      });

      await expect(
        service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sesionesGarzonServiceMock.listarAbiertas).not.toHaveBeenCalled();
    });
  });

  describe('resolver — vía PIN (garzón sin cuenta vinculada)', () => {
    it('firma con el PIN correcto y queda `firmada` con hora', async () => {
      const r = await service.resolver(
        TENANT_ID,
        TESTIGO_ID,
        TOTEM_USUARIO_ID,
        {
          pin: '111111',
          firma: true,
        },
      );

      expect(garzonesServiceMock.verificarPin).toHaveBeenCalledWith(
        TENANT_ID,
        GARZON_A,
        '111111',
      );
      expect(r.estado).toBe('firmada');
      expect(r.resueltaEl).toBeInstanceOf(Date);
      expect(r.viaFirma).toBe('pin');
      expect(r.resueltaPorUsuarioId).toBe(TOTEM_USUARIO_ID);
    });

    it('un PIN incorrecto no firma', async () => {
      garzonesServiceMock.verificarPin.mockRejectedValue(
        new BadRequestException('PIN inválido'),
      );

      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, TOTEM_USUARIO_ID, {
          pin: '999999',
          firma: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(testigoRepo.save).not.toHaveBeenCalled();
    });

    it('sin PIN no hay nada que verificar', async () => {
      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, TOTEM_USUARIO_ID, {
          firma: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(garzonesServiceMock.verificarPin).not.toHaveBeenCalled();
    });

    it('el rechazo se guarda con lo que el garzón quiso decir', async () => {
      const r = await service.resolver(
        TENANT_ID,
        TESTIGO_ID,
        TOTEM_USUARIO_ID,
        {
          pin: '111111',
          firma: false,
          comentario: 'No vi el conteo, estaba en la cocina',
        },
      );

      expect(r.estado).toBe('rechazada');
      expect(r.comentarioGarzon).toBe('No vi el conteo, estaba en la cocina');
    });

    it('una solicitud ya resuelta no se puede volver a resolver', async () => {
      testigoRepo.findOne.mockResolvedValue({
        ...crearTestigoPendiente(),
        estado: 'firmada',
      });

      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, TOTEM_USUARIO_ID, {
          pin: '111111',
          firma: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(garzonesServiceMock.obtenerActivoPorId).not.toHaveBeenCalled();
      expect(garzonesServiceMock.verificarPin).not.toHaveBeenCalled();
    });

    it('una solicitud inexistente no se puede resolver', async () => {
      testigoRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, TOTEM_USUARIO_ID, {
          pin: '111111',
          firma: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolver — vía cuenta (garzón vinculado a un usuario)', () => {
    beforeEach(() => {
      garzonesServiceMock.obtenerActivoPorId.mockResolvedValue({
        id: GARZON_A,
        usuarioId: USUARIO_VINCULADO_ID,
      });
      // El vínculo cuenta de verdad: `miVinculo` de esa cuenta apunta de
      // vuelta a este garzón (no es un tótem, no está desincronizado).
      garzonesServiceMock.miVinculo.mockResolvedValue({
        garzonId: GARZON_A,
        nombre: 'Garzón A',
      });
    });

    it('la cuenta vinculada firma sin PIN', async () => {
      const r = await service.resolver(
        TENANT_ID,
        TESTIGO_ID,
        USUARIO_VINCULADO_ID,
        { firma: true },
      );

      expect(garzonesServiceMock.verificarPin).not.toHaveBeenCalled();
      expect(r.estado).toBe('firmada');
      expect(r.viaFirma).toBe('cuenta');
      expect(r.resueltaPorUsuarioId).toBe(USUARIO_VINCULADO_ID);
    });

    // El test que sostiene la propiedad central de la ronda 2: la vía fuerte
    // no se esquiva yendo al tótem, ni mandando el PIN correcto.
    it('otra cuenta NO puede firmar por el garzón vinculado, aunque mande el PIN correcto', async () => {
      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, TOTEM_USUARIO_ID, {
          pin: '111111',
          firma: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(garzonesServiceMock.verificarPin).not.toHaveBeenCalled();
      expect(testigoRepo.save).not.toHaveBeenCalled();
    });

    it('el encargado que pidió la firma tampoco puede completarla', async () => {
      await expect(
        service.resolver(TENANT_ID, TESTIGO_ID, ADMIN_ID, {
          pin: '111111',
          firma: true,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(testigoRepo.save).not.toHaveBeenCalled();
    });
  });

  // Flanco nuevo contra la propiedad central (revisión independiente, ronda
  // 4): `resolver` decidía "vía cuenta" mirando solo `garzones.usuario_id`.
  // Si ese `usuario_id` apunta a la cuenta del TÓTEM (una vinculación mal
  // configurada, o un error de carga), la vía cuenta aceptaba una firma SIN
  // PIN desde un dispositivo compartido y la congelaba como prueba fuerte
  // — exactamente lo que el resto del sistema de garzones ya neutraliza
  // (`es_totem` es un override duro en `garzonPersonalDe`).
  describe('resolver — un garzón vinculado a la cuenta del tótem NO habilita la vía cuenta', () => {
    it('cae a PIN aunque `usuario_id` esté seteado, porque esa cuenta es un tótem', async () => {
      garzonesServiceMock.obtenerActivoPorId.mockResolvedValue({
        id: GARZON_A,
        usuarioId: CUENTA_TOTEM_VINCULADA_ID,
      });
      // `miVinculo` de la cuenta del tótem da null: `es_totem` la excluye
      // en `garzonPersonalDe`, aunque exista una fila de `garzones` que
      // apunte a ella.
      garzonesServiceMock.miVinculo.mockResolvedValue(null);

      const r = await service.resolver(
        TENANT_ID,
        TESTIGO_ID,
        CUENTA_TOTEM_VINCULADA_ID,
        { pin: '111111', firma: true },
      );

      expect(garzonesServiceMock.verificarPin).toHaveBeenCalledWith(
        TENANT_ID,
        GARZON_A,
        '111111',
      );
      expect(r.viaFirma).toBe('pin');
    });
  });

  describe('pendientesDeGarzon', () => {
    const CREDENCIAL = { garzonId: GARZON_A, pin: '111111' };

    it('sin pendientes, no consulta el arqueo', async () => {
      const r = await service.pendientesDeGarzon(
        TENANT_ID,
        TOTEM_USUARIO_ID,
        CREDENCIAL,
      );

      expect(r).toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    // Regresión de la revisión independiente (ronda 4, CRITICAL 2 seguía
    // abierto): `miVinculo` da `null` tanto para "sin vínculo" como para
    // "tótem", así que la cuenta del tótem —la que de hecho usa esta
    // pantalla— podía pedir las pendientes de CUALQUIER `garzonId`
    // enumerado del selector, sin que nada lo contrastara. La identidad
    // ahora sale de `resolverGarzonActuante` (mismo patrón que
    // `activaPropia`): sin vínculo personal, EXIGE `garzonId` + PIN.
    it('resuelve el garzón actuante vía resolverGarzonActuante, con la credencial tal cual', async () => {
      await service.pendientesDeGarzon(TENANT_ID, TOTEM_USUARIO_ID, CREDENCIAL);

      expect(garzonesServiceMock.resolverGarzonActuante).toHaveBeenCalledWith(
        TENANT_ID,
        TOTEM_USUARIO_ID,
        CREDENCIAL,
      );
    });

    it('busca las pendientes del garzón RESUELTO, no del `garzonId` que mandó el cliente', async () => {
      // resolverGarzonActuante puede devolver un garzón distinto al pedido
      // si la cuenta que llama tiene vínculo personal (rama 1: el vínculo
      // manda, la credencial se ignora). El filtro de `find` tiene que usar
      // SIEMPRE el garzón devuelto.
      garzonesServiceMock.resolverGarzonActuante.mockResolvedValue({
        id: GARZON_B,
        usuarioId: null,
      });

      await service.pendientesDeGarzon(TENANT_ID, TOTEM_USUARIO_ID, {
        garzonId: GARZON_A, // lo que "pidió" el cliente
        pin: '111111',
      });

      expect(testigoRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ garzonId: GARZON_B }), // el resuelto
        }),
      );
    });

    it('sin vínculo personal y sin credencial, no llega a leer nada (resolverGarzonActuante corta con 400)', async () => {
      garzonesServiceMock.resolverGarzonActuante.mockRejectedValue(
        new BadRequestException(
          'Elegí el garzón e ingresá su PIN para continuar',
        ),
      );

      await expect(
        service.pendientesDeGarzon(TENANT_ID, TOTEM_USUARIO_ID, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(testigoRepo.find).not.toHaveBeenCalled();
    });

    it('devuelve lo contado y NUNCA lo esperado, en una sola query de arqueo filtrada por tenant', async () => {
      testigoRepo.find.mockResolvedValue([
        { ...crearTestigoPendiente(), id: TESTIGO_ID, cajaId: CAJA_ID },
      ]);
      dataSource.query.mockResolvedValue([
        {
          caja_id: CAJA_ID,
          metodo_pago_id: null,
          nombre: 'Efectivo',
          es_efectivo: true,
          contado: '15000.0000',
        },
      ]);

      const r = await service.pendientesDeGarzon(
        TENANT_ID,
        TOTEM_USUARIO_ID,
        CREDENCIAL,
      );

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(dataSource.query.mock.calls[0][1]).toEqual([[CAJA_ID], TENANT_ID]);
      expect(r).toHaveLength(1);
      expect(r[0].garzonVinculado).toBe(false);
      expect(r[0].lineas).toEqual([
        {
          metodoPagoId: null,
          nombre: 'Efectivo',
          esEfectivo: true,
          contado: '15000.0000',
        },
      ]);
      expect(r[0].lineas[0]).not.toHaveProperty('esperado');
    });

    it('marca garzonVinculado=true cuando el garzón resuelto está vinculado de verdad (no tótem)', async () => {
      garzonesServiceMock.resolverGarzonActuante.mockResolvedValue({
        id: GARZON_A,
        usuarioId: USUARIO_VINCULADO_ID,
      });
      garzonesServiceMock.miVinculo.mockResolvedValue({
        garzonId: GARZON_A,
        nombre: 'Garzón A',
      });
      testigoRepo.find.mockResolvedValue([
        { ...crearTestigoPendiente(), id: TESTIGO_ID, cajaId: CAJA_ID },
      ]);

      const r = await service.pendientesDeGarzon(
        TENANT_ID,
        USUARIO_VINCULADO_ID,
        {},
      );

      expect(r[0].garzonVinculado).toBe(true);
    });

    it('garzonVinculado=false cuando el usuario_id vinculado es el de un tótem', async () => {
      garzonesServiceMock.resolverGarzonActuante.mockResolvedValue({
        id: GARZON_A,
        usuarioId: CUENTA_TOTEM_VINCULADA_ID,
      });
      garzonesServiceMock.miVinculo.mockResolvedValue(null); // es_totem
      testigoRepo.find.mockResolvedValue([
        { ...crearTestigoPendiente(), id: TESTIGO_ID, cajaId: CAJA_ID },
      ]);

      const r = await service.pendientesDeGarzon(
        TENANT_ID,
        CUENTA_TOTEM_VINCULADA_ID,
        {},
      );

      expect(r[0].garzonVinculado).toBe(false);
    });
  });

  describe('hayFirmaDe', () => {
    it('true si hay una fila firmada, consultada con el manager de la transacción', async () => {
      (managerMock.count as jest.Mock).mockResolvedValue(1);

      await expect(
        service.hayFirmaDe(managerMock, TENANT_ID, CAJA_ID),
      ).resolves.toBe(true);
      expect(managerMock.count).toHaveBeenCalledWith(
        CajaTestigo,
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_ID,
            cajaId: CAJA_ID,
            estado: 'firmada',
          }),
        }),
      );
    });

    it('false si no hay ninguna', async () => {
      (managerMock.count as jest.Mock).mockResolvedValue(0);
      await expect(
        service.hayFirmaDe(managerMock, TENANT_ID, CAJA_ID),
      ).resolves.toBe(false);
    });
  });

  describe('cancelarPendientes', () => {
    it('pasa las pendientes de la caja a cancelada', async () => {
      await service.cancelarPendientes(managerMock, TENANT_ID, CAJA_ID);

      expect(managerMock.update).toHaveBeenCalledWith(
        CajaTestigo,
        expect.objectContaining({
          tenantId: TENANT_ID,
          cajaId: CAJA_ID,
          estado: 'pendiente',
        }),
        { estado: 'cancelada' },
      );
    });
  });

  describe('caducarPorSesion', () => {
    it('pasa las pendientes de esa sesión a caducada', async () => {
      await service.caducarPorSesion(managerMock, TENANT_ID, SESION_A);

      expect(managerMock.update).toHaveBeenCalledWith(
        CajaTestigo,
        expect.objectContaining({
          tenantId: TENANT_ID,
          sesionGarzonId: SESION_A,
          estado: 'pendiente',
        }),
        { estado: 'caducada' },
      );
    });
  });
});
