import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { type CajaService } from './caja.service';
import { type CajaTestigoService } from './caja-testigo.service';
import { type RbacService } from '../rbac/rbac.service';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';

describe('CajaController', () => {
  let controller: CajaController;
  let cajaService: CajaService;
  let cajaTestigoService: CajaTestigoService;
  let rbacService: RbacService;

  beforeEach(() => {
    cajaService = {
      findActiva: jest.fn(),
      cajonesEstado: jest.fn(),
      historial: jest.fn(),
      findOne: jest.fn(),
      abrir: jest.fn(),
      registrarMovimiento: jest.fn(),
      enviarConteo: jest.fn(),
      resumenMovimientos: jest.fn(),
      listarMovimientos: jest.fn(),
      obtenerArqueo: jest.fn(),
      getArqueoCiego: jest.fn(),
      setArqueoCiego: jest.fn(),
      justificarDiferencias: jest.fn(),
      cerrar: jest.fn(),
    } as unknown as CajaService;

    cajaTestigoService = {
      solicitar: jest.fn(),
      resolver: jest.fn(),
      pendientesDeGarzon: jest.fn(),
      listar: jest.fn(),
    } as unknown as CajaTestigoService;

    rbacService = {
      userHasPermiso: jest.fn(),
      userIsTenantAdmin: jest.fn(),
    } as unknown as RbacService;

    controller = new CajaController(
      cajaService,
      cajaTestigoService,
      rbacService,
    );
    // Por defecto no-admin: el gating de ciego (esAdminTenant) resuelve false salvo
    // que un test lo sobreescriba.
    jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(false);
  });

  describe('detalle (lectura compartida MiCaja/Cajas)', () => {
    it('detalle lanza ForbiddenException si el usuario no tiene MiCaja:Leer ni Cajas:Leer', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(controller.detalle(req, 'caja1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('detalle pasa verTodas=true cuando el usuario tiene Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const findOne = jest
        .spyOn(cajaService, 'findOne')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.detalle(req, 'caja1');
      expect(findOne).toHaveBeenCalledWith('t1', 'u1', 'caja1', true);
    });

    it('detalle pasa verTodas=false para un cajero con solo MiCaja:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Leer',
        );
      const findOne = jest
        .spyOn(cajaService, 'findOne')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.detalle(req, 'caja1');
      expect(findOne).toHaveBeenCalledWith('t1', 'u1', 'caja1', false);
    });
  });

  describe('resumenMovimientos (lectura compartida)', () => {
    it('lanza ForbiddenException si el usuario no tiene MiCaja:Leer ni Cajas:Leer', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(controller.resumenMovimientos(req, 'caja1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('pasa verTodas=true cuando el usuario tiene Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const resumen = jest
        .spyOn(cajaService, 'resumenMovimientos')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.resumenMovimientos(req, 'caja1');
      expect(resumen).toHaveBeenCalledWith('t1', 'u1', 'caja1', true, false);
    });

    it('pasa verTodas=false para un cajero con solo MiCaja:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Leer',
        );
      const resumen = jest
        .spyOn(cajaService, 'resumenMovimientos')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.resumenMovimientos(req, 'caja1');
      expect(resumen).toHaveBeenCalledWith('t1', 'u1', 'caja1', false, false);
    });
  });

  describe('listarMovimientos (lectura compartida)', () => {
    it('lanza ForbiddenException si el usuario no tiene MiCaja:Leer ni Cajas:Leer', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(
        controller.listarMovimientos(req, 'caja1', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('pasa verTodas=true cuando el usuario tiene Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const listar = jest
        .spyOn(cajaService, 'listarMovimientos')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = { tipo: 'entrada' } as any;
      await controller.listarMovimientos(req, 'caja1', query);
      expect(listar).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        query,
        true,
        false,
      );
    });

    it('pasa verTodas=false para un cajero con solo MiCaja:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Leer',
        );
      const listar = jest
        .spyOn(cajaService, 'listarMovimientos')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = {} as any;
      await controller.listarMovimientos(req, 'caja1', query);
      expect(listar).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        query,
        false,
        false,
      );
    });
  });

  describe('historial (lectura compartida + scope condicional)', () => {
    it('lanza ForbiddenException si el usuario no tiene MiCaja:Leer ni Cajas:Leer', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(controller.historial(req, {} as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('no pasa verTodas si query.todas es false y no consulta a otro usuario, aunque el usuario tenga Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const historial = jest
        .spyOn(cajaService, 'historial')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = { todas: false } as any;
      await controller.historial(req, query);
      expect(historial).toHaveBeenCalledWith('t1', 'u1', query, false);
    });

    it('pasa verTodas=true cuando query.todas=true y el usuario tiene Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const historial = jest
        .spyOn(cajaService, 'historial')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = { todas: true } as any;
      await controller.historial(req, query);
      expect(historial).toHaveBeenCalledWith('t1', 'u1', query, true);
    });

    it('pasa verTodas=false cuando query.todas=true pero el usuario solo tiene MiCaja:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Leer',
        );
      const historial = jest
        .spyOn(cajaService, 'historial')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = { todas: true } as any;
      await controller.historial(req, query);
      expect(historial).toHaveBeenCalledWith('t1', 'u1', query, false);
    });

    it('pasa verTodas=true cuando consulta a otro usuario y tiene Cajas:Leer', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Leer',
        );
      const historial = jest
        .spyOn(cajaService, 'historial')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const query = { usuarioId: 'otro-usuario' } as any;
      await controller.historial(req, query);
      expect(historial).toHaveBeenCalledWith('t1', 'u1', query, true);
    });
  });

  describe('endpoints owner-only (MiCaja)', () => {
    it('activa delega en cajaService.findActiva', () => {
      jest.spyOn(cajaService, 'findActiva').mockResolvedValue(null);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.activa(req);
      expect(cajaService.findActiva).toHaveBeenCalledWith('t1', 'u1');
    });

    it('abrir delega en cajaService.abrir', () => {
      const dto = { saldoInicial: '1000' } as any;
      jest.spyOn(cajaService, 'abrir').mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.abrir(req, dto);
      expect(cajaService.abrir).toHaveBeenCalledWith('t1', 'u1', dto);
    });

    it('registrarMovimiento delega en cajaService.registrarMovimiento', () => {
      const dto = { tipo: 'entrada', concepto: 'x', monto: '100' } as any;
      jest
        .spyOn(cajaService, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.registrarMovimiento(req, 'caja1', dto);
      expect(cajaService.registrarMovimiento).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        dto,
      );
    });
  });

  describe('cerrar (fase 2: finalizar, owner-o-encargado)', () => {
    it('lanza ForbiddenException si el usuario no tiene MiCaja:Actualizar ni Cajas:Actualizar', async () => {
      const dto = { lineas: [] } as any;
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(controller.cerrar(req, 'caja1', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(cajaService.cerrar).not.toHaveBeenCalled();
    });

    it('puedeForzar=false para el dueño (solo MiCaja:Actualizar) y delega en cajaService.cerrar', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
      } as any;
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Actualizar',
        );
      jest.spyOn(cajaService, 'cerrar').mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.cerrar(req, 'caja1', dto);
      expect(cajaService.cerrar).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        false,
        dto,
      );
    });

    it('puedeForzar=true para el encargado (Cajas:Actualizar) y delega en cajaService.cerrar', async () => {
      const dto = { lineas: [] } as any;
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Actualizar',
        );
      jest.spyOn(cajaService, 'cerrar').mockResolvedValue({} as any);
      const req = { user: { id: 'encargado1', tenantId: 't1' } } as any;
      await controller.cerrar(req, 'caja1', dto);
      expect(cajaService.cerrar).toHaveBeenCalledWith(
        't1',
        'encargado1',
        'caja1',
        true,
        dto,
      );
    });
  });

  describe('enviarConteo (cierre forzado: owner-o-encargado)', () => {
    it('lanza ForbiddenException si el usuario no tiene MiCaja:Actualizar ni Cajas:Actualizar', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      } as any;
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(false);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await expect(controller.enviarConteo(req, 'caja1', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(cajaService.enviarConteo).not.toHaveBeenCalled();
    });

    it('puedeForzar=false para el dueño (solo MiCaja:Actualizar) y delega en cajaService.enviarConteo', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      } as any;
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'MiCaja' && permiso === 'Actualizar',
        );
      jest
        .spyOn(cajaService, 'enviarConteo')
        .mockResolvedValue({ estado: 'cerrada', arqueo: [] } as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.enviarConteo(req, 'caja1', dto);
      expect(cajaService.enviarConteo).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        dto,
        false,
      );
    });

    it('puedeForzar=true para el encargado (Cajas:Actualizar) y delega en cajaService.enviarConteo', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      } as any;
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockImplementation(
          async (_u, _t, modulo, permiso) =>
            modulo === 'Cajas' && permiso === 'Actualizar',
        );
      jest
        .spyOn(cajaService, 'enviarConteo')
        .mockResolvedValue({ estado: 'en_conciliacion', arqueo: [] } as any);
      const req = { user: { id: 'encargado1', tenantId: 't1' } } as any;
      await controller.enviarConteo(req, 'caja1', dto);
      expect(cajaService.enviarConteo).toHaveBeenCalledWith(
        't1',
        'encargado1',
        'caja1',
        dto,
        true,
      );
    });
  });

  describe('arqueo', () => {
    it('resuelve lectura compartida y delega en obtenerArqueo', async () => {
      jest
        .spyOn(rbacService, 'userHasPermiso')
        .mockResolvedValueOnce(false) // MiCaja:Leer
        .mockResolvedValueOnce(true); // Cajas:Leer
      jest
        .spyOn(cajaService, 'obtenerArqueo')
        .mockResolvedValueOnce({ ciego: false, lineas: [] });
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.arqueo(req, 'caja1');
      expect(cajaService.obtenerArqueo).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        true,
        false,
      );
    });

    it('pasa esAdmin=true cuando el usuario es admin del tenant', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(true);
      jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(true);
      const obtener = jest
        .spyOn(cajaService, 'obtenerArqueo')
        .mockResolvedValue({ ciego: false, lineas: [] });
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.arqueo(req, 'caja1');
      expect(obtener).toHaveBeenCalledWith('t1', 'u1', 'caja1', true, true);
    });

    it('pasa esAdmin=true para un superadmin sin consultar userIsTenantAdmin', async () => {
      jest.spyOn(rbacService, 'userHasPermiso').mockResolvedValue(true);
      const isAdmin = jest.spyOn(rbacService, 'userIsTenantAdmin');
      const obtener = jest
        .spyOn(cajaService, 'obtenerArqueo')
        .mockResolvedValue({ ciego: false, lineas: [] });
      const req = {
        user: { id: 'u1', tenantId: 't1', esSuperadmin: true },
      } as any;
      await controller.arqueo(req, 'caja1');
      expect(obtener).toHaveBeenCalledWith('t1', 'u1', 'caja1', true, true);
      expect(isAdmin).not.toHaveBeenCalled();
    });
  });

  describe('cajonesEstado (Cajas:Leer exclusivo)', () => {
    it('pasa esAdmin=false para un supervisor no-admin (queda ciego)', async () => {
      jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(false);
      jest.spyOn(cajaService, 'cajonesEstado').mockResolvedValue([]);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.cajonesEstado(req);
      expect(cajaService.cajonesEstado).toHaveBeenCalledWith('t1', 'u1', false);
      // El permiso lo enforcea el guard, no el handler.
      expect(rbacService.userHasPermiso).not.toHaveBeenCalled();
    });

    it('pasa esAdmin=true para el admin del tenant (el ciego no le aplica)', async () => {
      jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(true);
      const cajones = jest
        .spyOn(cajaService, 'cajonesEstado')
        .mockResolvedValue([]);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.cajonesEstado(req);
      expect(cajones).toHaveBeenCalledWith('t1', 'u1', true);
    });
  });

  describe('justificarDiferencias (admin-only)', () => {
    it('delega en cajaService.justificarDiferencias con el tenant del token', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
      } as any;
      jest
        .spyOn(cajaService, 'justificarDiferencias')
        .mockResolvedValue({ ciego: false, lineas: [] });
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.justificarDiferencias(req, 'caja1', dto);
      expect(cajaService.justificarDiferencias).toHaveBeenCalledWith(
        't1',
        'caja1',
        dto.lineas,
      );
      expect(res).toEqual({ ciego: false, lineas: [] });
    });
  });

  describe('config arqueo-ciego (admin-only)', () => {
    it('GET delega en getArqueoCiego con el tenant del token', async () => {
      jest.spyOn(cajaService, 'getArqueoCiego').mockResolvedValue(true);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.getArqueoCiego(req);
      expect(cajaService.getArqueoCiego).toHaveBeenCalledWith('t1');
      expect(res).toEqual({ arqueoCiego: true });
    });

    it('PUT delega en setArqueoCiego con el tenant del token y el valor del DTO', async () => {
      jest.spyOn(cajaService, 'setArqueoCiego').mockResolvedValue(undefined);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.setArqueoCiego(req, { arqueoCiego: false });
      expect(cajaService.setArqueoCiego).toHaveBeenCalledWith('t1', false);
      expect(res).toEqual({ arqueoCiego: false });
    });

    it('PUT arqueo-ciego está protegido por TenantAdminGuard (config admin-only)', () => {
      const guards = Reflect.getMetadata(
        '__guards__',
        CajaController.prototype.setArqueoCiego,
      ) as unknown[];
      expect(guards).toContain(TenantAdminGuard);
    });
  });

  describe('testigos del cierre forzado', () => {
    it('solicitarTestigos delega en cajaTestigoService.solicitar con tenant, usuario y garzonIds del DTO', async () => {
      jest
        .spyOn(cajaTestigoService, 'solicitar')
        .mockResolvedValue([{ id: 'testigo1' }] as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.solicitarTestigos(req, 'caja1', {
        garzonIds: ['g1', 'g2'],
      });
      expect(cajaTestigoService.solicitar).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        ['g1', 'g2'],
      );
      expect(res).toEqual([{ id: 'testigo1' }]);
    });

    it('resolverTestigo delega en cajaTestigoService.resolver pasando quién llama (u.id)', async () => {
      jest
        .spyOn(cajaTestigoService, 'resolver')
        .mockResolvedValue({ id: 'testigo1', estado: 'firmada' } as any);
      const dto = { pin: '111111', firma: true };
      // El controller NO decide con `u.id` — solo lo pasa. Es `resolver`
      // quien decide qué hacer con esa cuenta: si el garzón está vinculado,
      // TIENE que coincidir (vía cuenta); si no, es solo el dato de qué
      // cuenta tecleó el PIN (normalmente el tótem, no un garzón sin cuenta).
      const req = {
        user: { id: 'quien-sea-que-llame', tenantId: 't1' },
      } as any;
      const res = await controller.resolverTestigo(req, 'testigo1', dto);
      expect(cajaTestigoService.resolver).toHaveBeenCalledWith(
        't1',
        'testigo1',
        'quien-sea-que-llame',
        dto,
      );
      expect(res).toEqual({ id: 'testigo1', estado: 'firmada' });
    });

    it('resolverTestigo NO tiene Cajas:Actualizar — el garzón no tiene permisos de caja', () => {
      const permiso = Reflect.getMetadata(
        'requires_permiso',
        CajaController.prototype.resolverTestigo,
      ) as { modulo: string; permiso: string } | undefined;
      expect(permiso).not.toEqual({ modulo: 'Cajas', permiso: 'Actualizar' });
    });

    it('resolverTestigo SÍ tiene Salones:Operar — ronda 3, sin esto cualquier token del tenant llegaba al handler', () => {
      const permiso = Reflect.getMetadata(
        'requires_permiso',
        CajaController.prototype.resolverTestigo,
      ) as { modulo: string; permiso: string } | undefined;
      expect(permiso).toEqual({ modulo: 'Salones', permiso: 'Operar' });
    });

    it('pendientesDeGarzon tiene Salones:Operar — ronda 3, sin esto exponía montos a cualquier usuario del tenant', () => {
      const permiso = Reflect.getMetadata(
        'requires_permiso',
        CajaController.prototype.pendientesDeGarzon,
      ) as { modulo: string; permiso: string } | undefined;
      expect(permiso).toEqual({ modulo: 'Salones', permiso: 'Operar' });
    });

    it('pendientesDeGarzon delega en cajaTestigoService.pendientesDeGarzon con el tenant, quién llama y la credencial del body', async () => {
      jest
        .spyOn(cajaTestigoService, 'pendientesDeGarzon')
        .mockResolvedValue([]);
      const dto = { garzonId: 'garzon1', pin: '111111' };
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      const res = await controller.pendientesDeGarzon(req, dto);
      expect(cajaTestigoService.pendientesDeGarzon).toHaveBeenCalledWith(
        't1',
        'u1',
        dto,
      );
      expect(res).toEqual([]);
    });

    it('listarTestigos delega en cajaTestigoService.listar con el tenant del token y el cajaId de la ruta', async () => {
      jest
        .spyOn(cajaTestigoService, 'listar')
        .mockResolvedValue([{ id: 'testigo1', estado: 'pendiente' }] as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;

      const res = await controller.listarTestigos(req, 'caja1');

      expect(cajaTestigoService.listar).toHaveBeenCalledWith('t1', 'caja1');
      expect(res).toEqual([{ id: 'testigo1', estado: 'pendiente' }]);
    });

    it('listarTestigos exige Cajas:Leer — lectura de supervisión, no de arqueo', () => {
      const permiso = Reflect.getMetadata(
        'requires_permiso',
        CajaController.prototype.listarTestigos,
      ) as { modulo: string; permiso: string } | undefined;
      expect(permiso).toEqual({ modulo: 'Cajas', permiso: 'Leer' });
    });
  });
});
