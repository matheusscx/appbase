import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UbicacionesService } from './ubicaciones.service';

describe('UbicacionesService', () => {
  // Un solo mock de `query` para el pool y para el manager de la transacción:
  // `remove()` corre bajo `db.transaccion` desde la revisión de rama (lock real
  // contra el traslado concurrente), y lo que importan estos tests es el ORDEN
  // de las sentencias, no si vinieron del pool o del manager.
  const db = {
    query: jest.fn(),
    transaccion: (cb: (m: { query: jest.Mock }) => unknown) =>
      cb({ query: db.query }),
  };
  const service = new UbicacionesService(db as never);

  beforeEach(() => db.query.mockReset());

  it('localDe devuelve el ubicacion_id del local del tenant', async () => {
    db.query.mockResolvedValueOnce([{ ubicacion_id: 'u-local' }]);
    await expect(service.localDe('t1')).resolves.toBe('u-local');
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/tipo\s*=\s*'local'/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
  });

  it('no deja borrar el local', async () => {
    db.query.mockResolvedValueOnce([{ tipo: 'local', nombre: 'Local' }]);
    await expect(service.remove('t1', 'usr', 'u-local')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no deja borrar una bodega con stock adentro, y dice cuánto queda', async () => {
    db.query
      .mockResolvedValueOnce([{ tipo: 'bodega', nombre: 'Subsuelo' }])
      .mockResolvedValueOnce([{ items_con_stock: '2' }]);
    await expect(service.remove('t1', 'usr', 'u-bodega')).rejects.toThrow(
      /2 producto/,
    );
  });

  // Decisión del owner (2026-09-18): un recuento abierto sobre la bodega frena
  // el borrado; el recuento no rebota después, al aplicarlo.
  it('no deja borrar una bodega vacía con un recuento abierto, y no llega a marcarla', async () => {
    db.query
      .mockResolvedValueOnce([{ tipo: 'bodega', nombre: 'Subsuelo' }])
      .mockResolvedValueOnce([{ items_con_stock: '0' }])
      .mockResolvedValueOnce([{ recuentos_abiertos: '1' }]);
    await expect(service.remove('t1', 'usr', 'u-bodega')).rejects.toThrow(
      /recuento abierto/,
    );
    const [sql, params] = db.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/FROM recuento_inventario/);
    expect(sql).toMatch(/estado = 'borrador'/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
    expect(params).toEqual(['u-bodega', 't1']);
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('borra la bodega vacía y sin recuentos abiertos', async () => {
    db.query
      .mockResolvedValueOnce([{ tipo: 'bodega', nombre: 'Subsuelo' }])
      .mockResolvedValueOnce([{ items_con_stock: '0' }])
      .mockResolvedValueOnce([{ recuentos_abiertos: '0' }])
      .mockResolvedValueOnce(undefined);
    await service.remove('t1', 'usr', 'u-bodega');
    expect(db.query.mock.calls[3][0]).toMatch(/SET eliminado_el = NOW\(\)/);
  });

  describe('bloquearContraBorrado', () => {
    it('toma FOR SHARE sobre la ubicación viva del tenant', async () => {
      db.query.mockResolvedValueOnce([{ ubicacion_id: 'u-bodega' }]);
      await service.bloquearContraBorrado(db, 't1', 'u-bodega');
      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/FROM ubicaciones/);
      expect(sql).toMatch(/eliminado_el IS NULL/);
      expect(sql).toMatch(/FOR SHARE/);
      expect(params).toEqual(['u-bodega', 't1']);
    });

    it('rechaza una ubicación borrada, inexistente o de otro tenant', async () => {
      db.query.mockResolvedValueOnce([]);
      await expect(
        service.bloquearContraBorrado(db, 't1', 'u-borrada'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
