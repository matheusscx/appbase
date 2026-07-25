import { ForbiddenException } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { type CajaService } from './caja.service';
import { type RbacService } from '../rbac/rbac.service';

describe('CajaController', () => {
  let controller: CajaController;
  let cajaService: CajaService;
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

    rbacService = {
      userHasPermiso: jest.fn(),
      userIsTenantAdmin: jest.fn(),
    } as unknown as RbacService;

    controller = new CajaController(cajaService, rbacService);
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
      expect(resumen).toHaveBeenCalledWith('t1', 'u1', 'caja1', true);
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
      expect(resumen).toHaveBeenCalledWith('t1', 'u1', 'caja1', false);
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
      expect(listar).toHaveBeenCalledWith('t1', 'u1', 'caja1', query, true);
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
      expect(listar).toHaveBeenCalledWith('t1', 'u1', 'caja1', query, false);
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

  describe('cerrar (fase 2: finalizar, owner-o-admin)', () => {
    it('computa esAdmin=false para un cajero sin rol admin y delega en cajaService.cerrar', async () => {
      const dto = {
        lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
      } as any;
      jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(false);
      jest.spyOn(cajaService, 'cerrar').mockResolvedValue({} as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      await controller.cerrar(req, 'caja1', dto);
      expect(rbacService.userIsTenantAdmin).toHaveBeenCalledWith('u1', 't1');
      expect(cajaService.cerrar).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        false,
        dto,
      );
    });

    it('computa esAdmin=true para un admin del tenant y delega en cajaService.cerrar', async () => {
      const dto = { lineas: [] } as any;
      jest.spyOn(rbacService, 'userIsTenantAdmin').mockResolvedValue(true);
      jest.spyOn(cajaService, 'cerrar').mockResolvedValue({} as any);
      const req = { user: { id: 'admin1', tenantId: 't1' } } as any;
      await controller.cerrar(req, 'caja1', dto);
      expect(cajaService.cerrar).toHaveBeenCalledWith(
        't1',
        'admin1',
        'caja1',
        true,
        dto,
      );
    });
  });

  describe('enviarConteo', () => {
    it('enviarConteo delega en cajaService.enviarConteo con tenant/usuario del token', () => {
      const dto = {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      } as any;
      jest
        .spyOn(cajaService, 'enviarConteo')
        .mockResolvedValue({ estado: 'cerrada', arqueo: [] } as any);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.enviarConteo(req, 'caja1', dto);
      expect(cajaService.enviarConteo).toHaveBeenCalledWith(
        't1',
        'u1',
        'caja1',
        dto,
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
      );
    });
  });

  describe('cajonesEstado (Cajas:Leer exclusivo)', () => {
    it('delega en cajaService.cajonesEstado sin consultar rbacService', () => {
      jest.spyOn(cajaService, 'cajonesEstado').mockResolvedValue([]);
      const req = { user: { id: 'u1', tenantId: 't1' } } as any;
      controller.cajonesEstado(req);
      expect(cajaService.cajonesEstado).toHaveBeenCalledWith('t1', 'u1');
      expect(rbacService.userHasPermiso).not.toHaveBeenCalled();
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

  describe('config arqueo-ciego (permiso Cajas)', () => {
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
  });
});
