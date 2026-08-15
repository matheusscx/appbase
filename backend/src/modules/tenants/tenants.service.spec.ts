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
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { GarzonesService } from '../garzones/garzones.service';
import { TokensAccesoService } from '../auth/tokens-acceso.service';
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
  let tokensAcceso: { emitir: jest.Mock };
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
    tokensAcceso = { emitir: jest.fn().mockResolvedValue('tok-invitacion') };
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

      const result = await service.addMember('tenant-uuid', 'usuario-uuid');

      expect(usuarioTenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ eliminadoEl: null, esTotem: false }),
      );
      expect(result).toMatchObject({ eliminadoEl: null, esTotem: false });
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
   * Camino 2 del alta ("el correo existe pero no es miembro"): revive una
   * `UsuarioTenant` soft-borrada. Mismo motivo que el test de `addMember` de
   * más arriba — nadie pidió que el tótem sobreviviera a la baja.
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
        // `usuarioPrevio` no-null: el correo YA tiene una cuenta.
        createQueryBuilder: jest.fn(() => ({
          select: () => ({
            where: () => ({
              getOne: () => Promise.resolve({ id: 'usuario-previo' }),
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
});
