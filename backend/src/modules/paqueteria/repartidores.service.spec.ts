import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RepartidoresService } from './repartidores.service';

const TENANT = 't1';
const ID = 'r1';

describe('RepartidoresService', () => {
  const db = {
    query: jest.fn(),
    transaccion: (cb: () => unknown) => cb(),
  };
  const tarifas = { exigirActivaDelTenant: jest.fn() };
  const service = new RepartidoresService(db as never, tarifas as never);

  beforeEach(() => {
    db.query.mockReset();
    tarifas.exigirActivaDelTenant.mockReset();
  });

  it('findAll: trae activos e inactivos del tenant, sin borrados', async () => {
    db.query.mockResolvedValueOnce([
      {
        repartidor_id: ID,
        nombre: 'Juan',
        telefono: null,
        activo: false,
        tarifa_pago_id: null,
      },
    ]);
    await expect(service.findAll(TENANT)).resolves.toEqual([
      {
        id: ID,
        nombre: 'Juan',
        telefono: null,
        activo: false,
        tarifaPagoId: null,
      },
    ]);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(sql).not.toMatch(/activo\s*=/);
  });

  it('exigirActivo: 404 si no existe en el tenant', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.exigirActivo(TENANT, ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('exigirActivo: 400 si está inactivo', async () => {
    db.query.mockResolvedValueOnce([
      { repartidor_id: ID, nombre: 'Juan', telefono: null, activo: false },
    ]);
    await expect(service.exigirActivo(TENANT, ID)).rejects.toThrow(
      'Juan está inactivo',
    );
  });

  it('exigirActivo: devuelve la fila si está activo', async () => {
    db.query.mockResolvedValueOnce([
      { repartidor_id: ID, nombre: 'Juan', telefono: '+56', activo: true },
    ]);
    await expect(service.exigirActivo(TENANT, ID)).resolves.toEqual({
      id: ID,
      nombre: 'Juan',
      telefono: '+56',
      activo: true,
    });
  });

  it('exigirActivo: solo bloquea la fila (FOR SHARE) cuando se lo piden', async () => {
    const fila = {
      repartidor_id: ID,
      nombre: 'Juan',
      telefono: null,
      activo: true,
    };
    db.query.mockResolvedValue([fila]);
    await service.exigirActivo(TENANT, ID);
    await service.exigirActivo(TENANT, ID, { bloquear: true });
    expect(db.query.mock.calls[0][0] as string).not.toMatch(/FOR SHARE/);
    expect(db.query.mock.calls[1][0] as string).toMatch(/FOR SHARE/);
  });

  it('update: 404 si no existe en el tenant', async () => {
    db.query.mockResolvedValueOnce([]); // el FOR UPDATE no encuentra la fila
    await expect(service.update(TENANT, ID, { nombre: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('update: solo toca los campos enviados, y null borra el teléfono', async () => {
    db.query
      .mockResolvedValueOnce([{ tarifa_pago_id: null }]) // el repartidor, FOR UPDATE
      .mockResolvedValueOnce([
        [{ repartidor_id: ID, nombre: 'Juan', telefono: null, activo: true }],
        1,
      ]);
    await service.update(TENANT, ID, { telefono: null });
    const [sql, params] = db.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/telefono = \$3/);
    expect(sql).not.toMatch(/nombre = /);
    expect(sql).not.toMatch(/activo = /);
    expect(sql).toMatch(/tenant_id = \$2/);
    expect(params).toEqual([ID, TENANT, null]);
  });

  it('update: toma al repartidor FOR UPDATE antes que la tarifa (orden del módulo)', async () => {
    const orden: string[] = [];
    db.query.mockImplementation((sql: string) => {
      if (/FOR UPDATE/.test(sql)) {
        orden.push('repartidor');
        return Promise.resolve([{ tarifa_pago_id: null }]);
      }
      return Promise.resolve([
        [{ repartidor_id: ID, nombre: 'Juan', telefono: null, activo: true }],
        1,
      ]);
    });
    tarifas.exigirActivaDelTenant.mockImplementation(() => {
      orden.push('tarifa');
      return Promise.resolve();
    });
    await service.update(TENANT, ID, { tarifaPagoId: 'tarifa-1' });
    expect(orden).toEqual(['repartidor', 'tarifa']);
  });

  it('remove: 404 si no existe', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.remove(TENANT, ID)).rejects.toThrow(NotFoundException);
  });

  it('remove: 400 si tiene hojas de ruta (se desactiva, no se borra)', async () => {
    db.query
      .mockResolvedValueOnce([{ repartidor_id: ID }]) // existe
      .mockResolvedValueOnce([{ tiene: true }]); // EXISTS hojas_ruta
    const error = await service.remove(TENANT, ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toMatch(/tiene hojas de ruta/);
    const sql = db.query.mock.calls[1][0] as string;
    expect(sql).toMatch(/tenant_id = \$2/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
  });

  it('remove: marca eliminado_el, nunca DELETE', async () => {
    db.query
      .mockResolvedValueOnce([{ repartidor_id: ID }])
      .mockResolvedValueOnce([{ tiene: false }])
      .mockResolvedValueOnce([[], 1]);
    await service.remove(TENANT, ID);
    const sql = db.query.mock.calls[2][0] as string;
    expect(sql).toMatch(/SET eliminado_el = now\(\)/);
    expect(sql).not.toMatch(/DELETE/i);
  });
});
