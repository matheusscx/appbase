import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RolesService } from './roles.service';
import { Rol } from './entities/rol.entity';
import { RolUsuario } from './entities/rol-usuario.entity';
import { ModuloRol } from './entities/modulo-rol.entity';
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { RbacService } from '../rbac/rbac.service';

const ROL = 'rol-uuid';
const TENANT = 'tenant-uuid';
const USUARIO = 'usuario-uuid';
const MODULO = 'modulo-tenant-uuid';

type PermisoRow = {
  rolId: string;
  moduloTenantId: string;
  moduloAppPermisoId: string;
};
type ModuloRolRow = {
  rolId: string;
  moduloTenantId: string;
  eliminadoEl: Date | null;
};

// Emula el `manager` que entrega `dataSource.transaction`, operando sobre un
// borrador (`state`) que sólo se vuelca al "commit" real si el callback del
// service no tira. Así el test de atomicidad puede afirmar sobre datos, no
// sobre si se llamó a `transaction`.
function crearManagerFalso(
  state: { permisos: PermisoRow[]; modulosRol: ModuloRolRow[] },
  opts: { fallaEnSave?: boolean } = {},
) {
  return {
    delete: jest.fn(
      async (
        entity: unknown,
        criteria: { rolId: string; moduloTenantId: string },
      ) => {
        if (entity === RolPermisoModulo) {
          state.permisos = state.permisos.filter(
            (p) =>
              !(
                p.rolId === criteria.rolId &&
                p.moduloTenantId === criteria.moduloTenantId
              ),
          );
        }
      },
    ),
    create: jest.fn((_entity: unknown, data: unknown) => ({
      ...(data as object),
    })),
    findOne: jest.fn(
      async (
        entity: unknown,
        options: { where: { rolId: string; moduloTenantId: string } },
      ) => {
        if (entity === ModuloRol) {
          return (
            state.modulosRol.find(
              (m) =>
                m.rolId === options.where.rolId &&
                m.moduloTenantId === options.where.moduloTenantId,
            ) ?? null
          );
        }
        return null;
      },
    ),
    save: jest.fn(async (a: unknown, b?: unknown) => {
      if (opts.fallaEnSave) throw new Error('save falló');
      if (Array.isArray(a)) {
        state.permisos.push(...(a as PermisoRow[]));
        return a;
      }
      if (a === ModuloRol) {
        const data = b as ModuloRolRow;
        const idx = state.modulosRol.findIndex(
          (m) =>
            m.rolId === data.rolId && m.moduloTenantId === data.moduloTenantId,
        );
        if (idx >= 0) state.modulosRol[idx] = data;
        else state.modulosRol.push(data);
        return data;
      }
      return a;
    }),
    softDelete: jest.fn(
      async (
        entity: unknown,
        criteria: { rolId: string; moduloTenantId: string },
      ) => {
        if (entity === ModuloRol) {
          const row = state.modulosRol.find(
            (m) =>
              m.rolId === criteria.rolId &&
              m.moduloTenantId === criteria.moduloTenantId,
          );
          if (row) row.eliminadoEl = new Date();
        }
      },
    ),
  };
}

describe('RolesService', () => {
  let service: RolesService;
  let rolRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let rolUsuarioRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let rolPermisoModuloRepo: { find: jest.Mock };
  let tenantModuloRepo: { findOne: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let rbac: { administradoresDe: jest.Mock };
  // El manager que `transaction` le pasa al service, para poder afirmar sobre
  // lo que se escribió DENTRO (y no sobre un repositorio inyectado, que sería
  // justo el error que se quiere impedir).
  let managerDeLaTx: ReturnType<typeof crearManagerFalso> | null;
  // Estado "commiteado" para las pruebas de setPermissions: sólo se actualiza
  // cuando el `transaction` falso completa sin errores.
  let store: { permisos: PermisoRow[]; modulosRol: ModuloRolRow[] };

  beforeEach(async () => {
    rolRepo = {
      findOne: jest.fn().mockResolvedValue({ id: ROL, tenantId: TENANT }),
      create: jest.fn((data: unknown) => data),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    rolUsuarioRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: unknown) => data),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
    };
    rolPermisoModuloRepo = { find: jest.fn().mockResolvedValue([]) };
    tenantModuloRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ moduloTenantId: MODULO, tenantId: TENANT }),
    };
    store = { permisos: [], modulosRol: [] };
    managerDeLaTx = null;
    // Por defecto el usuario SÍ es miembro del tenant.
    dataSource = {
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      transaction: jest.fn(
        async (work: (manager: unknown) => Promise<unknown>) => {
          const draft = {
            permisos: [...store.permisos],
            modulosRol: store.modulosRol.map((m) => ({ ...m })),
          };
          const manager = crearManagerFalso(draft);
          managerDeLaTx = manager;
          const result = await work(manager);
          store.permisos = draft.permisos;
          store.modulosRol = draft.modulosRol;
          return result;
        },
      ),
    };
    // Por defecto el tenant tiene OTRO admin además del que se toca: el camino
    // normal de `removeUser` no debe bloquearse.
    rbac = { administradoresDe: jest.fn().mockResolvedValue(['otro-admin']) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RbacService, useValue: rbac },
        { provide: getRepositoryToken(Rol), useValue: rolRepo },
        { provide: getRepositoryToken(RolUsuario), useValue: rolUsuarioRepo },
        { provide: getRepositoryToken(ModuloRol), useValue: {} },
        {
          provide: getRepositoryToken(RolPermisoModulo),
          useValue: rolPermisoModuloRepo,
        },
        {
          provide: getRepositoryToken(TenantModulo),
          useValue: tenantModuloRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  describe('assignUser', () => {
    it('asigna cuando el rol y el usuario son del tenant', async () => {
      await expect(service.assignUser(ROL, TENANT, USUARIO)).resolves.toEqual({
        rolId: ROL,
        tenantId: TENANT,
        usuarioId: USUARIO,
      });
    });

    // El agujero que cerró esta entrada: se validaba al usuario pero nunca al
    // rol, así que un admin podía escribir en `roles_usuarios` una fila que
    // apunta a un rol de otro tenant.
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignUser('rol-de-otro-tenant', TENANT, USUARIO),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rolUsuarioRepo.save).not.toHaveBeenCalled();
    });

    it('busca el rol acotado por id Y tenant, no solo por id', async () => {
      await service.assignUser(ROL, TENANT, USUARIO);

      expect(rolRepo.findOne).toHaveBeenCalledWith({
        where: { id: ROL, tenantId: TENANT },
      });
    });

    it('valida el rol antes de tocar la membresía del usuario', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assignUser(ROL, TENANT, USUARIO),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Si el rol no existe, ni siquiera se consulta si el usuario es miembro.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('sigue rechazando a un usuario ajeno al tenant', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.assignUser(ROL, TENANT, USUARIO),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rolUsuarioRepo.save).not.toHaveBeenCalled();
    });

    it('revive una asignación soft-borrada en vez de duplicarla', async () => {
      rolUsuarioRepo.findOne.mockResolvedValue({
        rolId: ROL,
        tenantId: TENANT,
        usuarioId: USUARIO,
        eliminadoEl: new Date(),
      });

      const res = (await service.assignUser(ROL, TENANT, USUARIO)) as {
        eliminadoEl: Date | null;
      };

      expect(res.eliminadoEl).toBeNull();
      expect(rolUsuarioRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('removeUser — no puede dejar al tenant sin administradores', () => {
    it('desasigna normalmente mientras quede algún administrador', async () => {
      await expect(
        service.removeUser(ROL, TENANT, USUARIO),
      ).resolves.toBeUndefined();

      expect(managerDeLaTx?.softDelete).toHaveBeenCalledWith(RolUsuario, {
        rolId: ROL,
        tenantId: TENANT,
        usuarioId: USUARIO,
      });
    });

    // "tira" y no "no commitea": el rollback lo hace Postgres al propagar el
    // throw, y el `transaction` falso de este spec no lo modela. Lo cubre el
    // e2e (`membresia-ultimo-admin.e2e-spec.ts`).
    it('si la desasignación deja al tenant sin ningún admin, tira', async () => {
      // Nadie queda después del borrado. El primer llamado es el del lock, el
      // segundo la verificación: se responde por posición para que el test
      // distinga los dos y no pase por dar siempre lo mismo.
      rbac.administradoresDe
        .mockResolvedValueOnce([USUARIO])
        .mockResolvedValueOnce([]);

      await expect(service.removeUser(ROL, TENANT, USUARIO)).rejects.toThrow(
        /sin ningún administrador/,
      );
    });

    it('el conteo toma lock ANTES de borrar, y la verificación posterior no', async () => {
      // El orden es la mitad de la corrección: contar sin `FOR UPDATE`, o
      // contar después de que la otra transacción ya commiteó, deja pasar a
      // los dos requests que sacan a los dos últimos admins.
      await service.removeUser(ROL, TENANT, USUARIO);

      const llamadas = rbac.administradoresDe.mock.calls as [
        unknown,
        string,
        boolean,
      ][];
      expect(llamadas).toHaveLength(2);
      expect(llamadas[0][2]).toBe(true);
      expect(llamadas[1][2]).toBe(false);
      // Y las dos con el manager de la transacción, no por fuera: contar en
      // otra conexión no ve el borrado propio y además toma una segunda del
      // pool mientras esta transacción retiene la primera.
      expect(llamadas[0][0]).toBe(managerDeLaTx);
      expect(llamadas[1][0]).toBe(managerDeLaTx);
    });
  });

  describe('create', () => {
    it('crea el rol con esFijo=false y descripcion null por defecto', async () => {
      await service.create(TENANT, { nombre: 'Cajero' });

      expect(rolRepo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'Cajero',
        descripcion: null,
        esFijo: false,
      });
      expect(rolRepo.save).toHaveBeenCalled();
    });

    it('persiste la descripcion cuando viene en el dto', async () => {
      await service.create(TENANT, {
        nombre: 'Cajero',
        descripcion: 'Turno tarde',
      });

      expect(rolRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ descripcion: 'Turno tarde' }),
      );
    });
  });

  describe('update', () => {
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update(ROL, TENANT, { nombre: 'Nuevo nombre' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rolRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza modificar un rol fijo', async () => {
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: true,
      });

      await expect(
        service.update(ROL, TENANT, { nombre: 'Nuevo nombre' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rolRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza modificar un rol de sistema (que NO es fijo)', async () => {
      // `esFijo: false` explícito: si el bloqueo se apoyara en `esFijo`, este
      // test pasaría por la razón equivocada y el rol de sistema quedaría
      // editable. Son dos ejes distintos.
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: false,
        esSistema: true,
      });

      await expect(
        service.update(ROL, TENANT, { nombre: 'Operador de todo' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rolRepo.save).not.toHaveBeenCalled();
    });

    it('aplica los cambios del dto sobre el rol existente', async () => {
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        nombre: 'Viejo',
        esFijo: false,
      });

      await service.update(ROL, TENANT, { nombre: 'Nuevo nombre' });

      expect(rolRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROL, nombre: 'Nuevo nombre' }),
      );
    });
  });

  describe('remove', () => {
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(service.remove(ROL, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(rolRepo.softDelete).not.toHaveBeenCalled();
    });

    it('rechaza eliminar un rol fijo', async () => {
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: true,
      });

      await expect(service.remove(ROL, TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(rolRepo.softDelete).not.toHaveBeenCalled();
    });

    it('rechaza eliminar un rol de sistema (que NO es fijo)', async () => {
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: false,
        esSistema: true,
      });

      await expect(service.remove(ROL, TENANT)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(rolRepo.softDelete).not.toHaveBeenCalled();
    });

    it('hace soft delete del rol', async () => {
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: false,
      });

      await service.remove(ROL, TENANT);

      expect(rolRepo.softDelete).toHaveBeenCalledWith({ id: ROL });
    });
  });

  describe('findPermissions', () => {
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(service.findPermissions(ROL, TENANT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(rolPermisoModuloRepo.find).not.toHaveBeenCalled();
    });

    it('devuelve los permisos del rol', async () => {
      const permisos = [
        { rolId: ROL, moduloTenantId: MODULO, moduloAppPermisoId: 'p1' },
      ];
      rolPermisoModuloRepo.find.mockResolvedValue(permisos);

      await expect(service.findPermissions(ROL, TENANT)).resolves.toEqual(
        permisos,
      );
      expect(rolPermisoModuloRepo.find).toHaveBeenCalledWith({
        where: { rolId: ROL },
      });
    });
  });

  describe('setPermissions', () => {
    it('rechaza un rol que no es de este tenant', async () => {
      rolRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setPermissions(ROL, MODULO, TENANT, ['permiso-1']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rechaza un módulo que no pertenece a este tenant', async () => {
      tenantModuloRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setPermissions(ROL, MODULO, TENANT, ['permiso-1']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rechaza tocarle los permisos a un rol de sistema — es lo que sostiene el otorgamiento acotado', async () => {
      // El más importante de los tres bloqueos. `Operador de salón` lo puede
      // repartir alguien que NO es admin (`Salones:Actualizar`), así que su
      // lista de permisos tiene que estar fijada por construcción: si el admin
      // le agrega `Ventas:Crear`, el encargado pasa a repartir eso también sin
      // que ninguno de los dos se entere. `esFijo: false` a propósito — el
      // bloqueo no puede venir de ahí.
      rolRepo.findOne.mockResolvedValue({
        id: ROL,
        tenantId: TENANT,
        esFijo: false,
        esSistema: true,
      });

      await expect(
        service.setPermissions(ROL, MODULO, TENANT, ['permiso-1']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('reemplaza los permisos del (rol, módulo) y vincula el módulo al rol', async () => {
      store.permisos = [
        {
          rolId: ROL,
          moduloTenantId: MODULO,
          moduloAppPermisoId: 'permiso-viejo',
        },
      ];

      await service.setPermissions(ROL, MODULO, TENANT, ['permiso-nuevo']);

      expect(store.permisos).toEqual([
        {
          rolId: ROL,
          moduloTenantId: MODULO,
          moduloAppPermisoId: 'permiso-nuevo',
        },
      ]);
      expect(store.modulosRol).toEqual([
        { rolId: ROL, moduloTenantId: MODULO },
      ]);
    });

    it('revive el vínculo rol↔módulo si estaba soft-borrado', async () => {
      store.modulosRol = [
        { rolId: ROL, moduloTenantId: MODULO, eliminadoEl: new Date() },
      ];

      await service.setPermissions(ROL, MODULO, TENANT, ['permiso-nuevo']);

      expect(store.modulosRol[0].eliminadoEl).toBeNull();
    });

    // Array vacío es "desvincular a propósito" (ver set-permissions.dto.ts),
    // no un caso de error: el rol pierde el vínculo con el módulo.
    it('con un array vacío, desvincula el rol del módulo en vez de guardar permisos', async () => {
      store.permisos = [
        {
          rolId: ROL,
          moduloTenantId: MODULO,
          moduloAppPermisoId: 'permiso-viejo',
        },
      ];
      store.modulosRol = [
        { rolId: ROL, moduloTenantId: MODULO, eliminadoEl: null },
      ];

      await service.setPermissions(ROL, MODULO, TENANT, []);

      expect(store.permisos).toEqual([]);
      expect(store.modulosRol[0].eliminadoEl).toBeInstanceOf(Date);
    });

    // El defecto que cierra esta entrada: delete-luego-save sin transacción.
    // Si el save de los permisos nuevos falla, el delete de los viejos NO debe
    // quedar commiteado — si no, el rol se queda sin ningún permiso en el
    // módulo. La aserción es sobre el estado "commiteado" (`store`), no sobre
    // si se llamó a `dataSource.transaction`.
    it('si el save de los permisos nuevos falla, el delete no queda commiteado', async () => {
      store.permisos = [
        {
          rolId: ROL,
          moduloTenantId: MODULO,
          moduloAppPermisoId: 'permiso-viejo',
        },
      ];
      dataSource.transaction = jest.fn(
        async (work: (manager: unknown) => Promise<unknown>) => {
          const draft = {
            permisos: [...store.permisos],
            modulosRol: store.modulosRol.map((m) => ({ ...m })),
          };
          const manager = crearManagerFalso(draft, { fallaEnSave: true });
          const result = await work(manager);
          store.permisos = draft.permisos;
          store.modulosRol = draft.modulosRol;
          return result;
        },
      );

      await expect(
        service.setPermissions(ROL, MODULO, TENANT, ['permiso-nuevo']),
      ).rejects.toThrow('save falló');

      expect(store.permisos).toEqual([
        {
          rolId: ROL,
          moduloTenantId: MODULO,
          moduloAppPermisoId: 'permiso-viejo',
        },
      ]);
    });
  });
});
