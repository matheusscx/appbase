import { BadRequestException } from '@nestjs/common';
import { UbicacionesService } from './ubicaciones.service';

describe('UbicacionesService', () => {
  const db = { query: jest.fn() };
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
});
