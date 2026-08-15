import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { RbacService } from './rbac.service';

const USER = 'usuario-uuid';
const TENANT = 'tenant-uuid';

describe('RbacService', () => {
  let service: RbacService;
  let dataSource: { query: jest.Mock };

  /** Todas las SQL que se ejecutaron, sin saltos ni indentación. */
  const sqls = (): string[] =>
    dataSource.query.mock.calls.map(([sql]: [string]) =>
      sql.replace(/\s+/g, ' ').trim(),
    );

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  // ── Lo que CONCEDE acceso va primero: un `return true` sin test es peor que
  // un `return false` sin test.
  describe('conceder acceso', () => {
    it('userHasPermiso corta en true si el usuario tiene un rol fijo', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.userHasPermiso(USER, TENANT, 'ventas', 'crear'),
      ).resolves.toBe(true);
      // Corta: no llega a hacer el JOIN completo.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('userHasPermiso concede si el JOIN completo devuelve una fila', async () => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.userHasPermiso(USER, TENANT, 'ventas', 'crear'),
      ).resolves.toBe(true);
    });

    it('userIsTenantAdmin concede con un rol fijo', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(service.userIsTenantAdmin(USER, TENANT)).resolves.toBe(true);
    });

    it('getMisPermisos con rol fijo devuelve todos los del tenant', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([
          { modulo: 'ventas', permiso: 'crear' },
          { modulo: 'caja', permiso: 'abrir' },
        ]);

      await expect(service.getMisPermisos(USER, TENANT)).resolves.toEqual([
        'ventas:crear',
        'caja:abrir',
      ]);
    });

    it('getMisPermisos sin rol fijo devuelve solo los asignados', async () => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ modulo: 'ventas', permiso: 'ver' }]);

      await expect(service.getMisPermisos(USER, TENANT)).resolves.toEqual([
        'ventas:ver',
      ]);
    });
  });

  describe('negar acceso', () => {
    it('userHasPermiso niega si ninguna de las dos consultas trae filas', async () => {
      await expect(
        service.userHasPermiso(USER, TENANT, 'ventas', 'crear'),
      ).resolves.toBe(false);
      expect(dataSource.query).toHaveBeenCalledTimes(2);
    });

    it('userIsTenantAdmin niega sin rol fijo', async () => {
      await expect(service.userIsTenantAdmin(USER, TENANT)).resolves.toBe(
        false,
      );
    });
  });

  // ── El invariante que sostiene el aislamiento entre tenants. `roles_usuarios`
  // puede tener una fila que apunte a un rol de otro tenant; sin esta atadura en
  // el JOIN, esa fila se evalúa de verdad y concede permisos ajenos.
  describe('cada tabla unida queda atada al mismo tenant', () => {
    it('las cinco consultas atan `roles` a `ru.tenant_id`', async () => {
      await service.userHasPermiso(USER, TENANT, 'ventas', 'crear');
      await service.userIsTenantAdmin(USER, TENANT);
      await service.getMisPermisos(USER, TENANT);

      const conRoles = sqls().filter((sql) => /JOIN roles r ON/.test(sql));
      expect(conRoles).toHaveLength(5);
      for (const sql of conRoles) {
        expect(sql).toMatch(
          /JOIN roles r ON r\.rol_id = ru\.rol_id AND r\.tenant_id = ru\.tenant_id/,
        );
      }
    });

    it('los dos JOIN de `tenant_modulos` que cuelgan del rol atan el tenant', async () => {
      await service.userHasPermiso(USER, TENANT, 'ventas', 'crear');
      await service.getMisPermisos(USER, TENANT);

      const conModulos = sqls().filter((sql) =>
        /JOIN tenant_modulos tm ON/.test(sql),
      );
      expect(conModulos).toHaveLength(2);
      for (const sql of conModulos) {
        expect(sql).toMatch(
          /JOIN tenant_modulos tm ON tm\.modulo_tenant_id = mr\.modulo_tenant_id AND tm\.tenant_id = ru\.tenant_id/,
        );
      }
    });

    it('todas parten de `roles_usuarios` acotado por el tenant del token', async () => {
      await service.userHasPermiso(USER, TENANT, 'ventas', 'crear');
      await service.userIsTenantAdmin(USER, TENANT);
      await service.getMisPermisos(USER, TENANT);

      for (const [sql, params] of dataSource.query.mock.calls as [
        string,
        unknown[],
      ][]) {
        if (!/FROM roles_usuarios ru/.test(sql)) continue;
        expect(sql.replace(/\s+/g, ' ')).toContain('ru.tenant_id = $2');
        expect(params[1]).toBe(TENANT);
      }
    });
  });
});
