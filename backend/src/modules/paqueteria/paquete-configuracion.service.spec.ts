import { BadRequestException } from '@nestjs/common';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';

const TENANT = 't1';

describe('PaqueteConfiguracionService', () => {
  const db = {
    query: jest.fn(),
    transaccion: (cb: () => unknown) => cb(),
  };
  const tarifas = { hayDefecto: jest.fn() };
  const service = new PaqueteConfiguracionService(
    db as never,
    tarifas as never,
  );

  beforeEach(() => {
    db.query.mockReset();
    tarifas.hayDefecto.mockReset().mockResolvedValue(true);
  });

  it('obtener sin fila: no configurada, precio en 0', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.obtener(TENANT)).resolves.toEqual({
      configurada: false,
      precioEnvioDefecto: '0',
    });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
  });

  it('obtener con fila y con tarifa por defecto: configurada', async () => {
    db.query.mockResolvedValueOnce([{ precio_envio_defecto: '10000.0000' }]);
    await expect(service.obtener(TENANT)).resolves.toEqual({
      configurada: true,
      precioEnvioDefecto: '10000.0000',
    });
    expect(tarifas.hayDefecto).toHaveBeenCalledWith(TENANT);
  });

  it('obtener con fila pero sin tarifa por defecto: NO configurada (falta con qué pagar)', async () => {
    tarifas.hayDefecto.mockResolvedValue(false);
    db.query.mockResolvedValueOnce([{ precio_envio_defecto: '10000.0000' }]);
    await expect(service.obtener(TENANT)).resolves.toEqual({
      configurada: false,
      precioEnvioDefecto: '10000.0000',
    });
  });

  it('exigirDefaults sin fila: 400 que pide configurar', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.exigirDefaults(TENANT)).rejects.toThrow(
      new BadRequestException(
        'Configurá los valores por defecto de Paquetería antes de cargar paquetes.',
      ),
    );
  });

  it('exigirDefaults con fila: devuelve el precio', async () => {
    db.query.mockResolvedValueOnce([{ precio_envio_defecto: '10000.0000' }]);
    await expect(service.exigirDefaults(TENANT)).resolves.toEqual({
      precioEnvio: '10000.0000',
    });
  });

  it('guardar: upsert por tenant sobre el índice parcial; configurada depende de la tarifa por defecto', async () => {
    tarifas.hayDefecto.mockResolvedValue(false);
    db.query.mockResolvedValueOnce([
      [{ precio_envio_defecto: '10000.0000' }],
      1,
    ]);
    await expect(
      service.guardar(TENANT, { precioEnvioDefecto: '10000' }),
    ).resolves.toEqual({
      configurada: false,
      precioEnvioDefecto: '10000.0000',
    });
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT \(tenant_id\) WHERE eliminado_el IS NULL/);
    expect(params).toEqual([TENANT, '10000']);
  });
});
