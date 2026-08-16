import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { Usuario } from '../users/usuario.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { TokensAccesoService } from '../auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../auth/entities/token-acceso.entity';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import type { UpdateMyTenantDto } from './dto/update-my-tenant.dto';

const mockTenant: Tenant = {
  id: 'tenant-uuid',
  provinciaId: 'prov-uuid',
  nombre: 'Paris',
  correo: 'contacto@paris.cl',
  telefono: '+56226005000',
  direccion: 'Av. Kennedy 9001',
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  montoTolerancia: '0',
  arqueoCiego: false,
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    softDelete: jest.Mock;
    create: jest.Mock;
  };
  let razonSocialRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let tenantFormulaPrecioRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
    query: jest.Mock;
    /** El manager de FUERA de la transacción. Ver `crearUsuario — atomicidad`. */
    manager: { query: jest.Mock; save: jest.Mock };
  };
  let usuarioTenantRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
  };
  let tokensAcceso: {
    emitir: jest.Mock;
    invalidarAnteriores: jest.Mock;
    buscarVigente: jest.Mock;
    quemar: jest.Mock;
  };
  let mail: { enviar: jest.Mock };

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      softDelete: jest.fn(),
      create: jest.fn(),
    };
    razonSocialRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softDelete: jest.fn(),
    };
    tenantFormulaPrecioRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
      query: jest.fn(),
      manager: { query: jest.fn(), save: jest.fn() },
    };
    usuarioTenantRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      softDelete: jest.fn(),
    };
    tokensAcceso = {
      emitir: jest.fn().mockResolvedValue('tok-invitacion'),
      invalidarAnteriores: jest.fn(),
      buscarVigente: jest.fn(),
      quemar: jest.fn(),
    };
    mail = { enviar: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        {
          provide: getRepositoryToken(UsuarioTenant),
          useValue: usuarioTenantRepo,
        },
        {
          provide: getRepositoryToken(TenantModulo),
          useValue: { find: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(TenantFormulaPrecio),
          useValue: tenantFormulaPrecioRepo,
        },
        {
          provide: getRepositoryToken(Caja),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(RazonSocial), useValue: razonSocialRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: GarzonesService,
          useValue: { asegurarMostrador: jest.fn() },
        },
        { provide: TokensAccesoService, useValue: tokensAcceso },
        // ⚠️ Mockeado, no real: un unit que mandara mail de verdad sería
        // exactamente lo que el fallback de `MailService` existe para evitar.
        { provide: MailService, useValue: mail },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  describe('updateMine', () => {
    it('actualiza los campos del tenant', async () => {
      const dto: UpdateMyTenantDto = { nombre: 'Paris Updated' };
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantRepo.save.mockResolvedValue({
        ...mockTenant,
        nombre: 'Paris Updated',
      });

      const result = await service.updateMine('tenant-uuid', dto);

      expect(result.nombre).toBe('Paris Updated');
      expect(tenantRepo.save).toHaveBeenCalled();
    });

    it('lanza NotFoundException si el tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(service.updateMine('no-existe', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el correo ya está en uso', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantRepo.save.mockRejectedValue({ code: '23505' });
      await expect(
        service.updateMine('tenant-uuid', { correo: 'otro@tenant.cl' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('addMember', () => {
    /** La cuenta que `addMember` busca para decidir el camino. */
    function cuenta(contrasena: string | null) {
      dataSource.query.mockResolvedValue([
        { correo: 'ana@paris.cl', contrasena },
      ]);
    }

    it('revive la membresía soft-borrada sin arrastrar el tótem viejo', async () => {
      // El tótem es override duro: revivir en silencio con `es_totem` en
      // `true` bloquea sin explicación un vínculo de garzón posterior.
      // Nadie pidió que sobreviviera a la baja — ver docs/agent/pendientes.md.
      const existente = {
        tenantId: 'tenant-uuid',
        usuarioId: 'usuario-uuid',
        esTotem: true,
        eliminadoEl: new Date(),
      };
      usuarioTenantRepo.findOne.mockResolvedValue(existente);
      usuarioTenantRepo.save.mockImplementation((row: unknown) =>
        Promise.resolve(row),
      );
      // Sin contraseña: nadie controla la cuenta todavía, no hay a quién
      // pedirle permiso, y vale la conducta de siempre.
      cuenta(null);

      const result = await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(usuarioTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ eliminadoEl: null, esTotem: false }),
      );
      expect(result).toEqual({
        usuarioId: 'usuario-uuid',
        pendienteConfirmacion: false,
      });
    });

    it('una membresía viva (no borrada) no se reescribe', async () => {
      const viva = {
        tenantId: 'tenant-uuid',
        usuarioId: 'usuario-uuid',
        esTotem: true,
        eliminadoEl: null,
      };
      usuarioTenantRepo.findOne.mockResolvedValue(viva);

      await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(usuarioTenantRepo.save).not.toHaveBeenCalled();
      // Y ni siquiera mira la cuenta: ya es miembro, no hay nada que confirmar.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    // ── La otra puerta al mismo efecto que `crearUsuario` ──────────────────
    it('una cuenta CON contraseña no queda asociada: manda mail y espera', async () => {
      // Cerrar sólo el alta dejaba el invariante a medias: el alta devuelve el
      // `usuarioId` aun cuando deja la confirmación pendiente, así que el
      // camino completo eran dos requests por esta puerta.
      usuarioTenantRepo.findOne.mockResolvedValue(null);
      cuenta('$2b$10$hash');
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });

      const result = await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(usuarioTenantRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual({
        usuarioId: 'usuario-uuid',
        pendienteConfirmacion: true,
      });
      expect(mail.enviar).toHaveBeenCalledWith(
        expect.objectContaining({ asunto: 'Te están sumando a Paris' }),
      );
    });

    it('el token de esta puerta viaja SIN roles, que es distinto de "se murieron"', async () => {
      // `rolIds: []` es la marca de origen que lee `confirmarIngreso`: acá no
      // hay roles porque esta puerta nunca los asignó, no porque se hayan
      // borrado en la semana que el mail estuvo en la casilla.
      usuarioTenantRepo.findOne.mockResolvedValue(null);
      cuenta('$2b$10$hash');
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });

      await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(tokensAcceso.emitir).toHaveBeenCalledWith(
        'usuario-uuid',
        TipoTokenAcceso.CONFIRMACION,
        undefined,
        { tenantId: 'tenant-uuid', rolIds: [] },
      );
    });

    it('revivir una membresía borrada de una cuenta CON contraseña también confirma', async () => {
      // El gemelo del gemelo: la rama de revival no puede saltearse el
      // criterio sólo porque la fila ya existía alguna vez.
      usuarioTenantRepo.findOne.mockResolvedValue({
        tenantId: 'tenant-uuid',
        usuarioId: 'usuario-uuid',
        esTotem: false,
        eliminadoEl: new Date(),
      });
      cuenta('$2b$10$hash');
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });

      const result = await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(usuarioTenantRepo.save).not.toHaveBeenCalled();
      expect(result.pendienteConfirmacion).toBe(true);
    });
  });

  describe('findMembers', () => {
    it('el JOIN a roles ata también el tenant_id, no solo el rol_id', async () => {
      // El `LEFT JOIN roles_usuarios` ya filtra por `ru.tenant_id = ut.tenant_id`,
      // pero el `LEFT JOIN roles` siguiente unía solo por `rol_id` — un
      // `roles_usuarios` corrupto que apuntara a un rol de otro tenant mostraría
      // ese nombre de rol ajeno en el roster. Va en el `ON`, no en el `WHERE`:
      // con `LEFT JOIN` puesto en el `WHERE` haría desaparecer al miembro entero
      // cuando no tiene rol asignado (r todo NULL), no solo el nombre del rol.
      dataSource.query.mockResolvedValue([]);
      await service.findMembers('tenant-uuid');
      const [sql] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(
        /LEFT JOIN roles r ON r\.rol_id = ru\.rol_id AND r\.tenant_id = ru\.tenant_id/,
      );
    });
  });

  const mockRazonSocial: RazonSocial = {
    id: 'rs-uuid',
    tenantId: 'tenant-uuid',
    nombre: 'Paris SPA',
    rut: '76.123.456-7',
    direccion: 'Av. Kennedy 9001',
    telefono: null,
    habilitado: false,
    preferida: false,
    creadoEl: new Date(),
    actualizadoEl: new Date(),
    eliminadoEl: null,
  };

  describe('findRazonesSociales', () => {
    it('retorna las razones sociales del tenant', async () => {
      razonSocialRepo.find.mockResolvedValue([mockRazonSocial]);
      const result = await service.findRazonesSociales('tenant-uuid');
      expect(result).toEqual([mockRazonSocial]);
      expect(razonSocialRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-uuid' },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('createRazonSocial', () => {
    it('crea y retorna la razon social', async () => {
      razonSocialRepo.create.mockReturnValue(mockRazonSocial);
      razonSocialRepo.save.mockResolvedValue(mockRazonSocial);
      const dto = { nombre: 'Paris SPA', rut: '76.123.456-7' };
      const result = await service.createRazonSocial('tenant-uuid', dto);
      expect(result).toEqual(mockRazonSocial);
      expect(razonSocialRepo.create).toHaveBeenCalledWith({
        tenantId: 'tenant-uuid',
        nombre: 'Paris SPA',
        rut: '76.123.456-7',
      });
    });
  });

  describe('updateRazonSocial', () => {
    it('actualiza la razon social', async () => {
      razonSocialRepo.findOne.mockResolvedValue({ ...mockRazonSocial });
      razonSocialRepo.save.mockResolvedValue({
        ...mockRazonSocial,
        nombre: 'Paris SA',
      });
      const result = await service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
        nombre: 'Paris SA',
      });
      expect(result.nombre).toBe('Paris SA');
    });

    it('lanza NotFoundException si no pertenece al tenant', async () => {
      razonSocialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateRazonSocial('tenant-uuid', 'otro-id', { nombre: 'X' }),
      ).rejects.toThrow(NotFoundException);
      // No alcanza con que la excepción salga: el mock devuelve `null` pase lo
      // que pase, así que sin esto el test seguía en verde aunque el `where`
      // dejara de filtrar por tenant (mutante verificado).
      expect(razonSocialRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'otro-id', tenantId: 'tenant-uuid' },
      });
    });
  });

  describe('removeRazonSocial', () => {
    it('hace soft delete de la razon social', async () => {
      razonSocialRepo.findOne.mockResolvedValue(mockRazonSocial);
      razonSocialRepo.softDelete.mockResolvedValue({ affected: 1 });
      await service.removeRazonSocial('tenant-uuid', 'rs-uuid');
      expect(razonSocialRepo.softDelete).toHaveBeenCalledWith({
        id: 'rs-uuid',
        tenantId: 'tenant-uuid',
      });
    });

    it('lanza NotFoundException si no pertenece al tenant', async () => {
      razonSocialRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeRazonSocial('tenant-uuid', 'no-existe'),
      ).rejects.toThrow(NotFoundException);
      // Misma razón que en `updateRazonSocial`: sin verificar el `where`, el
      // mock (`null` fijo) deja pasar un filtro que perdió `tenantId`.
      expect(razonSocialRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'no-existe', tenantId: 'tenant-uuid' },
      });
    });
  });

  describe('setPreferida', () => {
    it('limpia la preferida anterior y marca la nueva', async () => {
      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...mockRazonSocial, habilitado: true }),
        query: jest.fn().mockResolvedValue(undefined),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      const result = await service.setPreferida('tenant-uuid', 'rs-uuid');

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET preferida = false'),
        ['tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('SET preferida = true'),
        ['rs-uuid'],
      );
      expect(result.preferida).toBe(true);
    });

    it('lanza NotFoundException si la razón social no existe en el tenant', async () => {
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        query: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      await expect(
        service.setPreferida('tenant-uuid', 'no-existe'),
      ).rejects.toThrow(NotFoundException);
      expect(mockManager.query).not.toHaveBeenCalled();
      // Misma razón que en `updateRazonSocial`/`removeRazonSocial`: el mock
      // devuelve `null` sin mirar los argumentos, así que sin esto el `where`
      // podía perder `tenantId` y el test seguía en verde.
      expect(mockManager.findOne).toHaveBeenCalledWith(RazonSocial, {
        where: { id: 'no-existe', tenantId: 'tenant-uuid' },
      });
    });

    it('lanza BadRequestException si la razón social está deshabilitada', async () => {
      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue({ ...mockRazonSocial, habilitado: false }),
        query: jest.fn(),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      await expect(
        service.setPreferida('tenant-uuid', 'rs-uuid'),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.query).not.toHaveBeenCalled();
    });
  });

  describe('updateRazonSocial — guard preferida', () => {
    it('lanza BadRequestException al intentar deshabilitar la razón social preferida', async () => {
      razonSocialRepo.findOne.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: true,
        preferida: true,
      });
      await expect(
        service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
          habilitado: false,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(razonSocialRepo.save).not.toHaveBeenCalled();
    });

    it('permite deshabilitar una razón social no preferida', async () => {
      razonSocialRepo.findOne.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: true,
        preferida: false,
      });
      razonSocialRepo.save.mockResolvedValue({
        ...mockRazonSocial,
        habilitado: false,
        preferida: false,
      });
      const result = await service.updateRazonSocial('tenant-uuid', 'rs-uuid', {
        habilitado: false,
      });
      expect(result.habilitado).toBe(false);
    });
  });

  describe('getPreferenciasFinancieras', () => {
    it('retorna modos y fórmula ordenada', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });
      tenantFormulaPrecioRepo.find.mockResolvedValue([
        { tenantId: 'tenant-uuid', paso: 1, tipo: 'descuentos' },
        { tenantId: 'tenant-uuid', paso: 2, tipo: 'recargos' },
        { tenantId: 'tenant-uuid', paso: 3, tipo: 'impuestos' },
      ]);

      const result = await service.getPreferenciasFinancieras('tenant-uuid');

      expect(tenantFormulaPrecioRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-uuid' },
        order: { paso: 'ASC' },
      });
      expect(result.calculoDescuentos).toBe('base');
      expect(result.calculoRecargos).toBe('base');
      expect(result.formula).toEqual(['descuentos', 'recargos', 'impuestos']);
      expect(result.escalaCalculo).toBe(6);
      expect(result.modoRedondeo).toBe('HALF_UP');
      expect(result.montoTolerancia).toBe('0');
    });

    it('lanza NotFoundException si el tenant no existe', async () => {
      tenantRepo.findOne.mockResolvedValue(null);
      await expect(
        service.getPreferenciasFinancieras('no-existe'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePreferenciasFinancieras', () => {
    it('persiste modos y reescribe la fórmula con pasos correctos', async () => {
      const mockManager = { query: jest.fn().mockResolvedValue(undefined) };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );
      tenantFormulaPrecioRepo.find.mockResolvedValue([
        { tenantId: 'tenant-uuid', paso: 1, tipo: 'recargos' },
        { tenantId: 'tenant-uuid', paso: 2, tipo: 'descuentos' },
        { tenantId: 'tenant-uuid', paso: 3, tipo: 'impuestos' },
      ]);

      const dto = {
        calculoDescuentos: 'compuesto',
        calculoRecargos: 'base',
        formula: ['recargos', 'descuentos', 'impuestos'],
        escalaCalculo: 4,
        modoRedondeo: 'HALF_EVEN',
        montoTolerancia: '1.5',
      };

      const result = await service.updatePreferenciasFinancieras(
        'tenant-uuid',
        dto,
      );

      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tenants'),
        ['compuesto', 'base', 4, 'HALF_EVEN', '1.5', 'tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tenant_formula_precio'),
        ['tenant-uuid'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 1, 'recargos'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 2, 'descuentos'],
      );
      expect(mockManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tenant_formula_precio'),
        ['tenant-uuid', 3, 'impuestos'],
      );
      expect(result.formula).toEqual(['recargos', 'descuentos', 'impuestos']);
      expect(result.calculoDescuentos).toBe('compuesto');
      expect(result.escalaCalculo).toBe(4);
      expect(result.modoRedondeo).toBe('HALF_EVEN');
      expect(result.montoTolerancia).toBe('1.5');
    });

    it('lanza BadRequestException si la fórmula tiene tipos duplicados', async () => {
      const dto = {
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        formula: ['descuentos', 'descuentos', 'impuestos'],
        escalaCalculo: 6,
        modoRedondeo: 'HALF_UP',
        montoTolerancia: '0',
      };
      await expect(
        service.updatePreferenciasFinancieras('tenant-uuid', dto),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la fórmula tiene solo 2 tipos distintos', async () => {
      const dto = {
        calculoDescuentos: 'base',
        calculoRecargos: 'base',
        formula: ['descuentos', 'recargos', 'descuentos'],
        escalaCalculo: 6,
        modoRedondeo: 'HALF_UP',
        montoTolerancia: '0',
      };
      await expect(
        service.updatePreferenciasFinancieras('tenant-uuid', dto),
      ).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  /**
   * La atomicidad del alta, que hasta 2026-08-09 no la sostenía ningún test.
   *
   * Medido entonces: reemplazar `this.dataSource.transaction(...)` por
   * `this.dataSource.manager` dejaba los 1549 unit y los 367 e2e **en verde**.
   * La transacción funcionaba —rompiendo el INSERT de roles a mano no quedaba ni
   * el usuario ni la membresía— pero una regresión habría pasado sin ruido. El
   * test que parecía cubrirlo ("sin roles → 400") lo corta el `ValidationPipe`
   * antes de que el service arranque.
   *
   * Desde la API no es trivial forzar un fallo **después** de crear el usuario,
   * así que va en unit: el manager de la transacción y el de fuera son dos
   * objetos distintos, y lo que se afirma es cuál de los dos recibió cada
   * escritura.
   */
  describe('crearUsuario — atomicidad', () => {
    const DTO = {
      nombre: 'Ana',
      apellido: 'Torres',
      correo: 'Ana.Torres@paris.cl',
      rolIds: ['550e8400-e29b-41d4-a716-446655440001'],
    };

    /** Un manager con el mínimo que recorre el camino de "cuenta nueva". */
    function managerFake() {
      return {
        query: jest.fn((sql: string) =>
          Promise.resolve(
            // La validación de roles compara longitudes: si esto devuelve
            // vacío, el alta corta con 400 y el test no prueba nada.
            sql.includes('FROM roles') ? [{ rol_id: DTO.rolIds[0] }] : [],
          ),
        ),
        // `getOne()` en null = el correo no tiene cuenta todavía.
        createQueryBuilder: jest.fn(() => ({
          select: () => ({
            where: () => ({ getOne: () => Promise.resolve(null) }),
          }),
        })),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_entidad: unknown, fila: unknown) => fila),
        save: jest.fn((_entidad: unknown, fila: object) =>
          Promise.resolve({ id: 'usuario-nuevo', ...fila }),
        ),
      };
    }

    let managerTx: ReturnType<typeof managerFake>;

    beforeEach(() => {
      managerTx = managerFake();
      // El manager de fuera de la transacción: si alguna escritura cae acá, el
      // alta dejó de ser atómica.
      dataSource.manager = managerFake();
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(managerTx),
      );
    });

    it('escribe TODO con el manager de la transacción, nunca con el de fuera', async () => {
      const res = await service.crearUsuario('tenant-uuid', DTO);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(managerTx.save).toHaveBeenCalled();
      expect(managerTx.query).toHaveBeenCalled();
      // Las dos mitades del mutante: sin `transaction` no hay rollback, y con
      // `dataSource.manager` cada sentencia commitea sola.
      expect(dataSource.manager.save).not.toHaveBeenCalled();
      expect(dataSource.manager.query).not.toHaveBeenCalled();
      // La otra puerta de la misma fuga, que no es el mutante medido: escribir
      // con un repositorio inyectado en vez del manager commitea igual de
      // suelto, y `managerTx.save` seguiría llamándose por las otras filas.
      expect(usuarioTenantRepo.save).not.toHaveBeenCalled();
      expect(tenantRepo.save).not.toHaveBeenCalled();
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(res.invitado).toBe(true);
    });

    it('emite la invitación DENTRO de la transacción', async () => {
      // Si se emitiera afuera y el alta fallara después, quedaría un link vivo
      // apuntando a un usuario que no existe.
      await service.crearUsuario('tenant-uuid', DTO);

      expect(tokensAcceso.emitir).toHaveBeenCalledWith(
        'usuario-nuevo',
        'invitacion',
        managerTx,
      );
    });

    it('si falla la baja de roles, propaga y NO manda el mail', async () => {
      // El fallo va en la ÚLTIMA sentencia: para entonces el usuario, la
      // membresía y el token ya se escribieron, que es justo el estado que la
      // transacción tiene que deshacer.
      managerTx.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM roles')) {
          return Promise.resolve([{ rol_id: DTO.rolIds[0] }]);
        }
        if (sql.includes('UPDATE roles_usuarios')) {
          return Promise.reject(new Error('deadlock detected'));
        }
        return Promise.resolve([]);
      });

      // Lo que carga el peso es esto: que el fallo de la última sentencia
      // **propague** en vez de quedar tragado.
      await expect(service.crearUsuario('tenant-uuid', DTO)).rejects.toThrow(
        'deadlock detected',
      );
      // Corolario, no aserción independiente: el envío está después del `await`
      // de la transacción, así que cualquier throw ya lo saltea. Se afirma para
      // que quede escrito que un alta sin commit no manda link.
      expect(mail.enviar).not.toHaveBeenCalled();
    });
  });

  /**
   * Camino 2 del alta ("el correo existe, no es miembro y **no tiene
   * contraseña**"): revive una `UsuarioTenant` soft-borrada. Mismo motivo que el
   * test de `addMember` de más arriba — nadie pidió que el tótem sobreviviera a
   * la baja.
   *
   * ⚠️ El `contrasena: null` del fixture **no es decoración**: desde el
   * 2026-08-15 es lo único que separa este camino del de confirmación. Una
   * cuenta con contraseña no se adopta.
   */
  describe('crearUsuario — revive membresía sin arrastrar el tótem', () => {
    it('el `miembro` revivido pierde `esTotem`, no solo `eliminadoEl`', async () => {
      const miembroBorrado = {
        usuarioId: 'usuario-previo',
        tenantId: 'tenant-uuid',
        esTotem: true,
        eliminadoEl: new Date(),
      };
      const rolId = '550e8400-e29b-41d4-a716-446655440001';
      const managerCamino2 = {
        query: jest.fn((sql: string) =>
          Promise.resolve(
            sql.includes('FROM roles') ? [{ rol_id: rolId }] : [],
          ),
        ),
        // `usuarioPrevio` no-null: el correo YA tiene una cuenta, invitada en
        // otro tenant y sin contraseña elegida todavía.
        createQueryBuilder: jest.fn(() => ({
          select: () => ({
            where: () => ({
              getOne: () =>
                Promise.resolve({ id: 'usuario-previo', contrasena: null }),
            }),
          }),
        })),
        findOne: jest.fn().mockResolvedValue(miembroBorrado),
        save: jest.fn((_entidad: unknown, fila: object) =>
          Promise.resolve(fila),
        ),
      };
      dataSource.transaction.mockImplementation(
        (cb: (m: typeof managerCamino2) => unknown) => cb(managerCamino2),
      );

      await service.crearUsuario('tenant-uuid', {
        nombre: 'Ana',
        correo: 'ana@paris.cl',
        rolIds: [rolId],
      });

      expect(managerCamino2.save).toHaveBeenCalledWith(
        UsuarioTenant,
        expect.objectContaining({ eliminadoEl: null, esTotem: false }),
      );
    });
  });

  /**
   * `crearUsuario` hace check-then-act (SELECT por correo, después INSERT) y
   * hasta acá no traducía la carrera: el perdedor de dos altas concurrentes
   * con el mismo correo recibía el `23505` crudo de Postgres — un 500 donde
   * correspondía el mismo 409 que ya tira el chequeo deliberado ("ese correo
   * ya es miembro de este tenant"). Mismo patrón que `updateMine`, sesenta
   * líneas más arriba en este archivo.
   */
  describe('crearUsuario — traduce el 23505 de la carrera', () => {
    it('el perdedor de la carrera recibe ConflictException, no el 500 crudo', async () => {
      dataSource.transaction.mockRejectedValue({ code: '23505' });

      await expect(
        service.crearUsuario('tenant-uuid', {
          nombre: 'Ana',
          correo: 'ana@paris.cl',
          rolIds: ['550e8400-e29b-41d4-a716-446655440001'],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('otros errores de la transacción NO se disfrazan de conflicto', async () => {
      dataSource.transaction.mockRejectedValue(new Error('deadlock detected'));

      await expect(
        service.crearUsuario('tenant-uuid', {
          nombre: 'Ana',
          correo: 'ana@paris.cl',
          rolIds: ['550e8400-e29b-41d4-a716-446655440001'],
        }),
      ).rejects.toThrow('deadlock detected');
    });
  });

  /**
   * **El agujero que cierra todo esto** (decisión del owner, 2026-08-15).
   *
   * Hasta acá, `crearUsuario` adoptaba cualquier cuenta cuyo correo coincidiera.
   * Alguien que pre-registrara `futuro.empleado@empresa.cl` con una contraseña
   * suya se llevaba, el día del alta, los roles que el admin eligió para otra
   * persona — y sin ninguna señal para nadie.
   *
   * Lo que carga el peso de esta suite es la aserción **negativa**: que no se
   * escriba ni la membresía ni los roles. Que salga el mail es la mitad amable;
   * la que cierra el agujero es que la cuenta se quede afuera.
   */
  describe('crearUsuario — la cuenta preexistente CON contraseña no se adopta', () => {
    const ROL = '550e8400-e29b-41d4-a716-446655440001';
    const DTO = { nombre: 'Ana', correo: 'ana@paris.cl', rolIds: [ROL] };

    /** El manager de la transacción, con el camino completo disponible. */
    function managerConCuentaPrevia(contrasena: string | null) {
      return {
        query: jest.fn((sql: string) => {
          if (sql.includes('FROM roles')) {
            return Promise.resolve([{ rol_id: ROL }]);
          }
          if (sql.includes('FROM tenants')) {
            return Promise.resolve([{ nombre: 'Paris' }]);
          }
          return Promise.resolve([]);
        }),
        createQueryBuilder: jest.fn(() => ({
          select: () => ({
            where: () => ({
              getOne: () =>
                Promise.resolve({ id: 'usuario-previo', contrasena }),
            }),
          }),
        })),
        // Sin membresía previa, ni viva ni borrada: el caso limpio.
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_e: unknown, fila: unknown) => fila),
        save: jest.fn((_e: unknown, fila: object) => Promise.resolve(fila)),
      };
    }

    let managerTx: ReturnType<typeof managerConCuentaPrevia>;

    function montar(contrasena: string | null) {
      managerTx = managerConCuentaPrevia(contrasena);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(managerTx),
      );
    }

    it('no la asocia al tenant ni le asigna roles', async () => {
      montar('$2b$10$hash.que.eligio.otra.persona');

      const res = await service.crearUsuario('tenant-uuid', DTO);

      // Sin fila en `usuarios_tenants` no es miembro **por construcción**: es
      // toda la defensa, y no depende de que nadie filtre un estado nuevo.
      expect(managerTx.save).not.toHaveBeenCalled();
      const sqls = managerTx.query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('INSERT INTO roles_usuarios'))).toBe(
        false,
      );
      expect(sqls.some((s) => s.includes('UPDATE roles_usuarios'))).toBe(false);
      // Y el admin tiene que poder distinguirlo de un alta consumada.
      expect(res.pendienteConfirmacion).toBe(true);
      expect(res.invitado).toBe(false);
    });

    it('emite el token de confirmación con el tenant y los roles adentro', async () => {
      montar('$2b$10$hash.que.eligio.otra.persona');

      await service.crearUsuario('tenant-uuid', DTO);

      // Los `rolIds` viajan congelados en el token: es lo que `confirmarIngreso`
      // va a revalidar y aplicar. Sin `datos`, la confirmación no sabría a qué
      // tenant entrar.
      expect(tokensAcceso.emitir).toHaveBeenCalledWith(
        'usuario-previo',
        'confirmacion',
        managerTx,
        { tenantId: 'tenant-uuid', rolIds: [ROL] },
      );
      // Y los anteriores mueren primero: dar el alta dos veces tiene que dejar
      // **un** link vivo, el último, no dos con roles distintos congelados.
      //
      // ⚠️ **Acotado al tenant** (4º argumento). Sin eso, la misma persona con
      // un alta pendiente en otra empresa la perdía: el alta de acá le quemaba
      // aquel token, su link dejaba de servir y **desaparecía del roster del
      // otro tenant** —la mitad pendiente del `UNION ALL` exige
      // `usado_el IS NULL`— sin ninguna señal para nadie. Y era accionable:
      // cualquier admin podía bloquear indefinidamente las altas pendientes de
      // un correo ajeno repitiendo la suya.
      expect(tokensAcceso.invalidarAnteriores).toHaveBeenCalledWith(
        'usuario-previo',
        'confirmacion',
        managerTx,
        'tenant-uuid',
      );
    });

    it('el mail nombra al tenant y no promete elegir contraseña', async () => {
      montar('$2b$10$hash.que.eligio.otra.persona');

      await service.crearUsuario('tenant-uuid', DTO);

      expect(mail.enviar).toHaveBeenCalledTimes(1);
      const enviado = mail.enviar.mock.calls[0]![0] as {
        para: string;
        asunto: string;
        cuerpo: string;
      };
      expect(enviado.para).toBe('ana@paris.cl');
      // El caso legítimo —alguien con cuenta en otra empresa— necesita saber
      // QUIÉN lo suma, no que "confirme su correo": su correo ya funciona.
      expect(enviado.asunto).toContain('Paris');
      expect(enviado.cuerpo).toContain('/confirmacion/tok-invitacion');
      expect(enviado.cuerpo).not.toContain('/invitacion/');
    });

    it('la cuenta preexistente SIN contraseña se adopta, como antes', async () => {
      // Nadie controla esa cuenta todavía (la invitaron en otro lado y nunca
      // eligió), así que no hay a quién pedirle permiso.
      montar(null);

      const res = await service.crearUsuario('tenant-uuid', DTO);

      expect(managerTx.save).toHaveBeenCalledWith(
        UsuarioTenant,
        expect.objectContaining({ tenantId: 'tenant-uuid' }),
      );
      const sqls = managerTx.query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('INSERT INTO roles_usuarios'))).toBe(
        true,
      );
      expect(res.pendienteConfirmacion).toBe(false);
      expect(tokensAcceso.emitir).not.toHaveBeenCalled();
      expect(mail.enviar).not.toHaveBeenCalled();
    });
  });

  /**
   * La otra mitad: el clic en el link es lo que crea la membresía. Hasta que
   * ocurre, la persona no está en ninguna tabla del tenant.
   */
  describe('confirmarIngreso', () => {
    const ROL_VIVO = '550e8400-e29b-41d4-a716-446655440001';
    const ROL_BORRADO = '550e8400-e29b-41d4-a716-446655440002';

    function managerFake(vivos: string[]) {
      return {
        query: jest.fn((sql: string) => {
          if (sql.includes('FROM usuarios u')) {
            return Promise.resolve([
              { correo: 'ana@paris.cl', tenant: 'Paris' },
            ]);
          }
          if (sql.includes('FROM roles')) {
            return Promise.resolve(vivos.map((rol_id) => ({ rol_id })));
          }
          return Promise.resolve([]);
        }),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((_e: unknown, fila: unknown) => fila),
        save: jest.fn((_e: unknown, fila: object) => Promise.resolve(fila)),
        // Sella `correo_verificado_el`: abrir el link prueba la dirección,
        // igual que aceptar una invitación.
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
    }

    let managerTx: ReturnType<typeof managerFake>;

    function montar(vivos: string[], congelados = [ROL_VIVO, ROL_BORRADO]) {
      tokensAcceso.buscarVigente.mockResolvedValue({
        id: 'token-uuid',
        usuarioId: 'usuario-previo',
        datos: { tenantId: 'tenant-uuid', rolIds: congelados },
      });
      managerTx = managerFake(vivos);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(managerTx),
      );
    }

    it('crea la membresía y asigna solo los roles que sobrevivieron', async () => {
      montar([ROL_VIVO]);

      const res = await service.confirmarIngreso('tok');

      expect(managerTx.save).toHaveBeenCalledWith(
        UsuarioTenant,
        expect.objectContaining({
          tenantId: 'tenant-uuid',
          usuarioId: 'usuario-previo',
        }),
      );
      // El rol borrado en la semana que el mail estuvo en la casilla no se
      // reinserta: el INSERT lleva los revalidados, no los congelados.
      const insert = (
        managerTx.query.mock.calls as unknown as [string, unknown[]][]
      ).find((c) => c[0].includes('INSERT INTO roles_usuarios'));
      expect(insert?.[1]).toEqual([
        'usuario-previo',
        'tenant-uuid',
        [ROL_VIVO],
      ]);
      expect(tokensAcceso.quemar).toHaveBeenCalledWith('token-uuid', managerTx);

      // Y de paso queda verificado el correo: abrir este link prueba la
      // dirección igual que aceptar una invitación. Sin esto, una cuenta
      // auto-registrada que nunca abrió su link de verificación confirmaría
      // que la suman a la empresa y después el login la rechazaría igual.
      expect(managerTx.update).toHaveBeenCalledWith(
        Usuario,
        expect.objectContaining({ id: 'usuario-previo' }),
        expect.objectContaining({ correoVerificadoEl: expect.any(Function) }),
      );
      expect(res.message).toContain('Paris');
    });

    it('si no sobrevivió ningún rol, no entra a medias', async () => {
      montar([]);

      // Entrar sin rol es entrar y no ver nada. Y el array vacío, además, haría
      // que la baja de `fijarRolesExactos` (`rol_id <> ALL($3)`) le borrara
      // todos los roles que tuviera en el tenant.
      await expect(service.confirmarIngreso('tok')).rejects.toThrow(
        BadRequestException,
      );
      expect(managerTx.save).not.toHaveBeenCalled();
      expect(
        managerTx.query.mock.calls.some((c) =>
          String(c[0]).includes('roles_usuarios'),
        ),
      ).toBe(false);
    });

    it('si ya es miembro por otro camino, no le pisa los roles de hoy', async () => {
      montar([ROL_VIVO]);
      managerTx.findOne.mockResolvedValue({
        usuarioId: 'usuario-previo',
        tenantId: 'tenant-uuid',
        esTotem: false,
        eliminadoEl: null,
      });

      await expect(service.confirmarIngreso('tok')).rejects.toThrow(
        BadRequestException,
      );
      expect(
        managerTx.query.mock.calls.some((c) =>
          String(c[0]).includes('roles_usuarios'),
        ),
      ).toBe(false);
    });

    it('revive la membresía soft-borrada sin arrastrar el tótem', async () => {
      montar([ROL_VIVO]);
      managerTx.findOne.mockResolvedValue({
        usuarioId: 'usuario-previo',
        tenantId: 'tenant-uuid',
        esTotem: true,
        eliminadoEl: new Date(),
      });

      await service.confirmarIngreso('tok');

      expect(managerTx.save).toHaveBeenCalledWith(
        UsuarioTenant,
        expect.objectContaining({ eliminadoEl: null, esTotem: false }),
      );
    });

    it('un token que no está vigente no escribe nada', async () => {
      tokensAcceso.buscarVigente.mockResolvedValue(null);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(managerFake([ROL_VIVO])),
      );

      await expect(service.confirmarIngreso('tok')).rejects.toThrow(
        BadRequestException,
      );
      // Ni siquiera se abre la transacción: el corte es antes.
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('verificarConfirmacion', () => {
    it('devuelve correo y tenant SIN quemar el token', async () => {
      tokensAcceso.buscarVigente.mockResolvedValue({
        id: 'token-uuid',
        usuarioId: 'usuario-previo',
        datos: { tenantId: 'tenant-uuid', rolIds: ['r'] },
      });
      dataSource.manager.query = jest
        .fn()
        .mockResolvedValue([{ correo: 'ana@paris.cl', tenant: 'Paris' }]);

      const res = await service.verificarConfirmacion('tok');

      expect(res).toEqual({ correo: 'ana@paris.cl', tenant: 'Paris' });
      // Es la pantalla, no la decisión: quemarlo acá haría que un prefetch del
      // navegador inutilizara el link antes de que la persona toque nada.
      expect(tokensAcceso.quemar).not.toHaveBeenCalled();
    });
  });

  describe('findMembers — los pendientes de confirmación', () => {
    it('los marca, en una sola consulta y sin perder a los miembros', async () => {
      dataSource.query.mockResolvedValue([
        {
          usuario_id: 'u-miembro',
          nombre: 'Ana',
          apellido: 'Torres',
          correo: 'ana@paris.cl',
          es_totem: false,
          rol_id: 'rol-1',
          rol_nombre: 'Cajero',
          pendiente: false,
        },
        {
          usuario_id: 'u-pendiente',
          nombre: 'Beto',
          apellido: 'Ruiz',
          correo: 'beto@otra.cl',
          es_totem: false,
          rol_id: 'rol-2',
          rol_nombre: 'Mesero',
          pendiente: true,
        },
      ]);

      const res = await service.findMembers('tenant-uuid');

      // Una consulta: la variante "traigo miembros y después los pendientes"
      // son dos round-trips para una sola pantalla.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(res).toHaveLength(2);
      expect(res[0].pendienteConfirmacion).toBe(false);
      expect(res[1].pendienteConfirmacion).toBe(true);
      // El pendiente muestra los roles que VA a recibir, no los que tiene.
      expect(res[1].roles).toEqual([{ rolId: 'rol-2', nombre: 'Mesero' }]);
    });

    it('quien es miembro y además tiene un token vivo aparece UNA vez, como miembro', async () => {
      // `usuarioId` es la llave de la fila en la pantalla: duplicarla rompe la
      // lista. Y los roles del token —los que recibiría— no pueden mezclarse
      // con los que ya tiene.
      dataSource.query.mockResolvedValue([
        {
          usuario_id: 'u-1',
          nombre: 'Ana',
          apellido: 'Torres',
          correo: 'ana@paris.cl',
          es_totem: false,
          rol_id: 'rol-1',
          rol_nombre: 'Cajero',
          pendiente: false,
        },
        {
          usuario_id: 'u-1',
          nombre: 'Ana',
          apellido: 'Torres',
          correo: 'ana@paris.cl',
          es_totem: false,
          rol_id: 'rol-9',
          rol_nombre: 'Administrador',
          pendiente: true,
        },
      ]);

      const res = await service.findMembers('tenant-uuid');

      expect(res).toHaveLength(1);
      expect(res[0].pendienteConfirmacion).toBe(false);
      expect(res[0].roles).toEqual([{ rolId: 'rol-1', nombre: 'Cajero' }]);
    });
  });
});
