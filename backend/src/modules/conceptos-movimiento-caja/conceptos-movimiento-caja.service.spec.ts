import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { ConceptosMovimientoCajaService } from './conceptos-movimiento-caja.service';

const TENANT_ID = 'tenant-uuid';
const CONCEPTO_ID = 'concepto-uuid';
const USUARIO_ID = 'usuario-uuid';

const fila = {
  concepto_movimiento_caja_id: CONCEPTO_ID,
  nombre: 'Compra de insumos',
  tipo: 'salida',
  activo: true,
};

describe('ConceptosMovimientoCajaService', () => {
  let service: ConceptosMovimientoCajaService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConceptosMovimientoCajaService,
        { provide: Db, useValue: { query: queryMock } },
      ],
    }).compile();
    service = module.get(ConceptosMovimientoCajaService);
  });

  describe('findAll', () => {
    it('filtra por tenant y por borrado, sin tipo ni activos por defecto', async () => {
      queryMock.mockResolvedValueOnce([fila]);
      const res = await service.findAll(TENANT_ID);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('tenant_id = $1');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(sql).not.toContain('activo = true');
      expect(params).toEqual([TENANT_ID]);
      expect(res).toEqual([
        {
          id: CONCEPTO_ID,
          nombre: 'Compra de insumos',
          tipo: 'salida',
          activo: true,
        },
      ]);
    });

    it('con soloActivas filtra activo', async () => {
      queryMock.mockResolvedValueOnce([]);
      await service.findAll(TENANT_ID, true);
      expect((queryMock.mock.calls[0] as [string])[0]).toContain(
        'activo = true',
      );
    });
  });

  describe('create', () => {
    it('rechaza un nombre duplicado en el tenant (sin importar mayúsculas)', async () => {
      queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(
        service.create(TENANT_ID, { nombre: ' compra de insumos ' }),
      ).rejects.toThrow(
        'Ya existe un concepto con el nombre "compra de insumos"',
      );
    });

    it('inserta con el tenant del token, nombre recortado y tipo ambos por defecto', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ ...fila, tipo: 'ambos' }]);
      const res = await service.create(TENANT_ID, { nombre: '  Cambio ' });
      const [sql, params] = queryMock.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO concepto_movimiento_caja');
      expect(params).toEqual([TENANT_ID, 'Cambio', 'ambos', true]);
      expect(res.tipo).toBe('ambos');
    });
  });

  describe('update', () => {
    it('404 si el concepto no existe en el tenant', async () => {
      queryMock.mockResolvedValueOnce([]);
      await expect(
        service.update(TENANT_ID, CONCEPTO_ID, { activo: false }),
      ).rejects.toThrow('no encontrado');
      const [sql] = queryMock.mock.calls[0] as [string];
      expect(sql).toContain('tenant_id = $');
      expect(sql).toContain('eliminado_el IS NULL');
    });

    it('rechaza renombrar a un nombre que ya tiene otro concepto', async () => {
      queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(
        service.update(TENANT_ID, CONCEPTO_ID, { nombre: 'Retiro' }),
      ).rejects.toThrow('Ya existe un concepto con el nombre "Retiro"');
    });

    it('actualiza solo lo enviado', async () => {
      queryMock.mockResolvedValueOnce([{ ...fila, activo: false }]);
      const res = await service.update(TENANT_ID, CONCEPTO_ID, {
        activo: false,
      });
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('activo = $1');
      expect(sql).not.toContain('nombre =');
      expect(params).toEqual([false, CONCEPTO_ID, TENANT_ID]);
      expect(res.activo).toBe(false);
    });
  });

  describe('remove', () => {
    it('marca eliminado_el y eliminado_por, nunca borra', async () => {
      queryMock.mockResolvedValueOnce([{ concepto_movimiento_caja_id: 'x' }]);
      await service.remove(TENANT_ID, USUARIO_ID, CONCEPTO_ID);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE concepto_movimiento_caja');
      expect(sql).toContain('eliminado_el = NOW()');
      expect(sql).not.toMatch(/DELETE/i);
      expect(sql).toContain('tenant_id = $2');
      expect(sql).toContain('eliminado_el IS NULL');
      expect(params).toEqual([CONCEPTO_ID, TENANT_ID, USUARIO_ID]);
    });

    it('404 si no hay fila viva del tenant', async () => {
      queryMock.mockResolvedValueOnce([]);
      await expect(
        service.remove(TENANT_ID, USUARIO_ID, CONCEPTO_ID),
      ).rejects.toThrow('no encontrado');
    });
  });

  describe('papelera', () => {
    it('findAll con incluirEliminados trae lo borrado por una persona, con su autor, en una sola query', async () => {
      queryMock.mockResolvedValueOnce([
        {
          ...fila,
          eliminado_el: '2026-10-17T10:00:00Z',
          eliminado_por: USUARIO_ID,
          eliminado_por_nombre: 'admin.paris',
        },
      ]);
      const res = await service.findAll(TENANT_ID, false, true);
      expect(queryMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('LEFT JOIN usuarios');
      expect(sql).toContain('m.tenant_id = $1');
      expect(sql).toContain(
        '(m.eliminado_el IS NULL OR m.eliminado_por IS NOT NULL)',
      );
      expect(params).toEqual([TENANT_ID]);
      expect(res[0]).toMatchObject({
        eliminadoEl: '2026-10-17T10:00:00Z',
        eliminadoPor: USUARIO_ID,
        eliminadoPorNombre: 'admin.paris',
      });
    });

    it('restaurar revive solo lo que borró una persona, del tenant, en una sentencia', async () => {
      queryMock.mockResolvedValueOnce([
        { ...fila, eliminado_el: null, eliminado_por: null },
      ]);
      const res = await service.restaurar(TENANT_ID, CONCEPTO_ID);
      const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('SET eliminado_el = NULL, eliminado_por = NULL');
      expect(sql).toContain('tenant_id = $2');
      expect(sql).toContain('nombre = COALESCE($3, nombre)');
      expect(sql).toContain('eliminado_el IS NOT NULL');
      expect(sql).toContain('eliminado_por IS NOT NULL');
      expect(params).toEqual([CONCEPTO_ID, TENANT_ID, null]);
      expect(res.id).toBe(CONCEPTO_ID);
    });

    it('restaurar con un nombre nuevo lo manda', async () => {
      queryMock.mockResolvedValueOnce([fila]);
      await service.restaurar(TENANT_ID, CONCEPTO_ID, 'Compras 2');
      expect((queryMock.mock.calls[0] as [string, unknown[]])[1]).toEqual([
        CONCEPTO_ID,
        TENANT_ID,
        'Compras 2',
      ]);
    });

    it('restaurar algo que no está en la papelera → 404', async () => {
      queryMock.mockResolvedValueOnce([]);
      await expect(service.restaurar(TENANT_ID, CONCEPTO_ID)).rejects.toThrow(
        'no está en la papelera',
      );
    });

    it('restaurar con el nombre tomado por uno vivo → 400 que explica la colisión', async () => {
      queryMock.mockRejectedValueOnce({ code: '23505' });
      queryMock.mockResolvedValue([{ nombre: 'Compra de insumos' }]);
      await expect(
        service.restaurar(TENANT_ID, CONCEPTO_ID, 'Compra de insumos'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
