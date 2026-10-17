import { BadRequestException, ConflictException } from '@nestjs/common';
import { TarifasPagoService } from './tarifas-pago.service';

const TENANT = 't1';
const ID = 'a1';

const fila = (extra: object = {}) => ({
  tarifa_pago_id: ID,
  nombre: 'Moto',
  monto: '1900.0000',
  es_defecto: false,
  activa: true,
  ...extra,
});

describe('TarifasPagoService', () => {
  const db = {
    query: jest.fn(),
    transaccion: (cb: () => unknown) => cb(),
  };
  const service = new TarifasPagoService(db as never);

  beforeEach(() => db.query.mockReset());

  const sqls = () => db.query.mock.calls.map((c) => c[0] as string);

  it('crear: la primera tarifa del tenant queda por defecto aunque no se pida', async () => {
    db.query
      .mockResolvedValueOnce([]) // lock
      .mockResolvedValueOnce([{ tiene: false }])
      .mockResolvedValueOnce([]) // soltarDefecto
      .mockResolvedValueOnce([fila({ es_defecto: true })]);
    const r = await service.crear(TENANT, { nombre: 'Moto', monto: '1900' });
    expect(r.esDefecto).toBe(true);
    const insert = db.query.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO tarifas_pago'),
    );
    expect(insert?.[1]).toEqual([TENANT, 'Moto', '1900', true]);
  });

  it('crear: con otras ya cargadas no toca el defecto si no se pide', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tiene: true }])
      .mockResolvedValueOnce([fila()]);
    const r = await service.crear(TENANT, { nombre: 'Moto', monto: '1900' });
    expect(r.esDefecto).toBe(false);
    expect(sqls().some((s) => s.includes('SET es_defecto = false'))).toBe(
      false,
    );
  });

  it('crear: nombre repetido (23505) es 409', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ tiene: true }])
      .mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.crear(TENANT, { nombre: 'moto', monto: '1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('actualizar: esDefecto true suelta el defecto anterior antes de poner el nuevo', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([]) // soltarDefecto
      .mockResolvedValueOnce([fila({ es_defecto: true })]);
    const r = await service.actualizar(TENANT, ID, { esDefecto: true });
    expect(r.esDefecto).toBe(true);
    const todas = sqls();
    const soltar = todas.findIndex((s) => s.includes('SET es_defecto = false'));
    const poner = todas.findIndex((s) => s.includes('SET nombre = $3'));
    expect(soltar).toBeGreaterThan(-1);
    expect(soltar).toBeLessThan(poner);
  });

  it('actualizar: desactivar la tarifa por defecto es 400', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila({ es_defecto: true })]);
    await expect(
      service.actualizar(TENANT, ID, { activa: false }),
    ).rejects.toThrow(/otra tarifa por defecto/);
  });

  it('actualizar: marcar por defecto una inactiva es 400', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila({ activa: false })]);
    await expect(
      service.actualizar(TENANT, ID, { esDefecto: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('eliminar: la por defecto es 400 y no escribe', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila({ es_defecto: true })]);
    await expect(service.eliminar(TENANT, ID)).rejects.toThrow(
      /otra tarifa por defecto/,
    );
    expect(sqls().some((s) => s.includes('SET eliminado_el'))).toBe(false);
  });

  it('eliminar: en uso es 400; sin uso marca eliminado_el', async () => {
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([{ en_uso: true }]);
    await expect(service.eliminar(TENANT, ID)).rejects.toThrow(/desactívala/);

    db.query.mockReset();
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([{ en_uso: false }])
      .mockResolvedValueOnce([]);
    await expect(service.eliminar(TENANT, ID)).resolves.toEqual({
      success: true,
    });
    const sql = sqls().join('\n');
    expect(sql).toMatch(/SET eliminado_el = now\(\)/);
    expect(sql).not.toMatch(/DELETE FROM/);
  });

  it('exigirActivaDelTenant: 400 si no existe o está inactiva; ok si activa', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.exigirActivaDelTenant(TENANT, ID)).rejects.toThrow(
      BadRequestException,
    );
    db.query.mockResolvedValueOnce([{ activa: false }]);
    await expect(service.exigirActivaDelTenant(TENANT, ID)).rejects.toThrow(
      BadRequestException,
    );
    db.query.mockResolvedValueOnce([{ activa: true }]);
    await expect(
      service.exigirActivaDelTenant(TENANT, ID),
    ).resolves.toBeUndefined();
  });

  it('hayDefecto / exigirDefecto: miran solo la por defecto viva del tenant; sin ninguna, 400', async () => {
    db.query.mockResolvedValueOnce([{ hay: true }]);
    await expect(service.exigirDefecto(TENANT)).resolves.toBeUndefined();
    const sql = sqls()[0];
    expect(sql).toMatch(
      /tenant_id = \$1 AND es_defecto AND eliminado_el IS NULL/,
    );

    db.query.mockResolvedValueOnce([{ hay: false }]);
    await expect(service.hayDefecto(TENANT)).resolves.toBe(false);
    db.query.mockResolvedValueOnce([{ hay: false }]);
    await expect(service.exigirDefecto(TENANT)).rejects.toThrow(
      /al menos una tarifa de pago/,
    );
  });
});
