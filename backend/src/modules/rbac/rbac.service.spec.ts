import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
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
    const dbMock = {
      transaccion: (fn: (m: unknown) => unknown) => fn(undefined),
      query: dataSource.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RbacService, { provide: Db, useValue: dbMock }],
    }).compile();

    service = module.get<RbacService>(RbacService);
  });

  // ── Lo que CONCEDE acceso va primero: un `return true` sin test es peor que
  // un `return false` sin test.
  describe('resolverAlcanceCaja', () => {
    /**
     * El eje "lo mío / todo" del que cuelgan caja, ventas y pagos. Se testea
     * mockeando `userHasPermiso` —que ya tiene sus propios tests acá arriba—
     * porque lo que este método aporta no es la consulta sino la COMBINACIÓN
     * de los dos permisos y el 403 cuando no hay ninguno.
     */
    const conPermisos = (micaja: boolean, cajas: boolean) =>
      jest
        .spyOn(service, 'userHasPermiso')
        .mockImplementation((_u, _t, modulo) =>
          Promise.resolve(modulo === 'Cajas' ? cajas : micaja),
        );

    it('con Cajas:Leer ve todo', async () => {
      conPermisos(false, true);
      await expect(service.resolverAlcanceCaja(USER, TENANT)).resolves.toBe(
        true,
      );
    });

    it('con solo MiCaja:Leer ve lo suyo', async () => {
      conPermisos(true, false);
      await expect(service.resolverAlcanceCaja(USER, TENANT)).resolves.toBe(
        false,
      );
    });

    it('con los dos gana el alcance mayor', async () => {
      conPermisos(true, true);
      await expect(service.resolverAlcanceCaja(USER, TENANT)).resolves.toBe(
        true,
      );
    });

    it('sin ninguno de los dos: 403, no un alcance vacío', async () => {
      // Devolver `false` acá sería peor que lanzar: el llamador filtraría por
      // "lo mío" y le respondería 200 con una lista vacía a alguien que no
      // tiene permiso de leer nada. El 403 dice la verdad.
      conPermisos(false, false);
      await expect(service.resolverAlcanceCaja(USER, TENANT)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resolverAlcanceDerivadoDeCaja (ventas y pagos)', () => {
    const conCajasLeer = (tiene: boolean) =>
      jest
        .spyOn(service, 'userHasPermiso')
        .mockImplementation((_u, _t, modulo) =>
          Promise.resolve(modulo === 'Cajas' ? tiene : true),
        );
    const conModuloCajas = (contratado: boolean) =>
      jest
        .spyOn(service, 'tenantContrataModuloCajas')
        .mockResolvedValue(contratado);

    it('con Cajas:Leer ve todo, sin consultar la contratación', async () => {
      conCajasLeer(true);
      const spy = conModuloCajas(true);
      await expect(
        service.resolverAlcanceDerivadoDeCaja(USER, TENANT),
      ).resolves.toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it('sin tenant en el token se acota, no se abre', async () => {
      // `TenantGuard` va delante y esto no debería pasar nunca. Pero el default
      // de una función cuya única razón de ser es no ser fail-open tiene que
      // apuntar a acotar: con tenant vacío ni el permiso ni el módulo matchean,
      // y las dos consultas darían "no" — que sin esta guarda se lee como "el
      // tenant no contrató Cajas" y concede todo.
      const spy = conCajasLeer(false);
      const spyModulo = jest.spyOn(service, 'tenantContrataModuloCajas');

      await expect(
        service.resolverAlcanceDerivadoDeCaja(USER, ''),
      ).resolves.toBe(false);
      expect(spy).not.toHaveBeenCalled();
      expect(spyModulo).not.toHaveBeenCalled();
    });

    it('el tenant SIN el módulo Cajas: la supervisión no existe, se ve todo', async () => {
      // Una tienda solo online compró Ventas/Pagos y no Cajas. Ahí `Cajas:Leer`
      // es INOBTENIBLE —`userHasPermiso` exige el módulo contratado, incluso
      // para el rol fijo—, así que acotar dejaría a su propio admin sin ver la
      // facturación y sin ninguna configuración que lo revierta.
      conCajasLeer(false);
      conModuloCajas(false);
      await expect(
        service.resolverAlcanceDerivadoDeCaja(USER, TENANT),
      ).resolves.toBe(true);
    });

    it('el tenant CON el módulo y el usuario sin el permiso: se acota', async () => {
      // El caso del cajero. Que no tenga `Cajas:Leer` es una decisión de
      // configuración, no la ausencia del concepto.
      conCajasLeer(false);
      conModuloCajas(true);
      await expect(
        service.resolverAlcanceDerivadoDeCaja(USER, TENANT),
      ).resolves.toBe(false);
    });

    it('NO mira MiCaja: quitar un permiso no puede conceder acceso', async () => {
      // La versión anterior devolvía `true` cuando faltaban LOS DOS permisos, y
      // eso era fail-open: sacarle `MiCaja:Leer` a un rol que conserva
      // `MiCaja:Crear` —una acción que parece un endurecimiento— dejaba al
      // cajero operando igual (`abrir` y `movimientos` piden `Crear`;
      // `conteo`/`cerrar` no llevan permiso de módulo) Y le concedía todos los
      // pagos del tenant.
      const spy = jest
        .spyOn(service, 'userHasPermiso')
        .mockResolvedValue(false);
      conModuloCajas(true);

      await expect(
        service.resolverAlcanceDerivadoDeCaja(USER, TENANT),
      ).resolves.toBe(false);
      for (const [, , modulo] of spy.mock.calls) {
        expect(modulo).not.toBe('MiCaja');
      }
    });
  });

  describe('tenantContrataModuloCajas', () => {
    it('pregunta por el módulo Cajas del tenant, filtrando borrados', async () => {
      // Es la query que decide entre "ve todo" y "se acota", así que su SQL se
      // afirma: sin esto, perder el filtro de soft-delete o el atado al tenant
      // no rompería ningún test — justo en el método cuya única razón de ser es
      // no ser fail-open.
      dataSource.query.mockResolvedValueOnce([]);

      await service.tenantContrataModuloCajas(TENANT);

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const plano = sql.replace(/\s+/g, ' ');
      expect(plano).toContain('FROM tenant_modulos tm');
      expect(plano).toContain("ma.nombre = 'Cajas'");
      expect(plano).toContain('tm.tenant_id = $1');
      expect(plano).toContain('tm.eliminado_el IS NULL');
      expect(plano).toContain('ma.eliminado_el IS NULL');
      expect(params).toEqual([TENANT]);
    });

    it('sin filas contratadas devuelve false', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.tenantContrataModuloCajas(TENANT)).resolves.toBe(
        false,
      );
    });

    it('con una fila devuelve true', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(service.tenantContrataModuloCajas(TENANT)).resolves.toBe(
        true,
      );
    });
  });

  describe('conceder acceso', () => {
    it('userHasPermiso corta en true si el usuario tiene un rol fijo Y el módulo está contratado', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.userHasPermiso(USER, TENANT, 'ventas', 'crear'),
      ).resolves.toBe(true);
      // Corta: no llega a hacer el JOIN completo.
      expect(dataSource.query).toHaveBeenCalledTimes(1);

      // El módulo pedido viaja en el short-circuit: sin esto la consulta
      // concedería sobre cualquier módulo, contratado o no.
      const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual([USER, TENANT, 'ventas']);
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

    // El borde comercial: el admin del tenant NO llega a un módulo que la
    // empresa no contrató. Los módulos son lo que se vende, así que el borde es
    // duro también para él. Antes el short-circuit no miraba `tenant_modulos` y
    // esto respondía 200.
    it('el admin sin el módulo contratado no pasa por el short-circuit ni por el JOIN completo', async () => {
      // El short-circuit no encuentra fila (no hay `tenant_modulos` del módulo)
      // y el JOIN completo tampoco (el admin no tiene el permiso asignado a su
      // rol: nunca le hizo falta).
      dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(
        service.userHasPermiso(USER, TENANT, 'salones', 'operar'),
      ).resolves.toBe(false);

      // Sigue siendo admin: lo que se le niega es el módulo, no la condición.
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(service.userIsTenantAdmin(USER, TENANT)).resolves.toBe(true);
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

    it('los tres JOIN de `tenant_modulos` atan el tenant, cuelguen o no del rol', async () => {
      await service.userHasPermiso(USER, TENANT, 'ventas', 'crear');
      await service.getMisPermisos(USER, TENANT);

      const conModulos = sqls().filter((sql) =>
        /JOIN tenant_modulos tm ON/.test(sql),
      );
      // Tres desde que el short-circuit del rol fijo también mira los módulos
      // contratados: el admin tiene todos los permisos, pero solo dentro de lo
      // que la empresa pagó.
      expect(conModulos).toHaveLength(3);

      // El invariante es la atadura al tenant, y lo cumplen las tres.
      for (const sql of conModulos) {
        expect(sql).toMatch(
          /JOIN tenant_modulos tm ON[^|]*?tm\.tenant_id = ru\.tenant_id/,
        );
      }

      // Las dos que evalúan un permiso concreto además cuelgan el módulo del
      // rol (`modulos_roles`). La del short-circuit no lo hace a propósito: al
      // admin no hay que asignarle el módulo, le basta que esté contratado.
      const colgadasDelRol = conModulos.filter((sql) =>
        /tm\.modulo_tenant_id = mr\.modulo_tenant_id/.test(sql),
      );
      expect(colgadasDelRol).toHaveLength(2);
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
