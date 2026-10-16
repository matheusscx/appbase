import { BadRequestException } from '@nestjs/common';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';

const TENANT = 't1';

describe('PaqueteConfiguracionService', () => {
  const db = {
    query: jest.fn(),
    transaccion: (cb: () => unknown) => cb(),
  };
  const service = new PaqueteConfiguracionService(db as never);

  beforeEach(() => db.query.mockReset());

  it('obtener sin fila: no configurada, montos en 0', async () => {
    db.query.mockResolvedValueOnce([]);
    await expect(service.obtener(TENANT)).resolves.toEqual({
      configurada: false,
      precioEnvioDefecto: '0',
      pagoRepartidorDefecto: '0',
    });
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/tenant_id = \$1/);
    expect(sql).toMatch(/eliminado_el IS NULL/);
  });

  it('obtener con fila: configurada, con los montos de la fila', async () => {
    db.query.mockResolvedValueOnce([
      {
        precio_envio_defecto: '10000.0000',
        pago_repartidor_defecto: '5000.0000',
      },
    ]);
    await expect(service.obtener(TENANT)).resolves.toEqual({
      configurada: true,
      precioEnvioDefecto: '10000.0000',
      pagoRepartidorDefecto: '5000.0000',
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

  it('exigirDefaults con fila: devuelve los dos montos', async () => {
    db.query.mockResolvedValueOnce([
      {
        precio_envio_defecto: '10000.0000',
        pago_repartidor_defecto: '5000.0000',
      },
    ]);
    await expect(service.exigirDefaults(TENANT)).resolves.toEqual({
      precioEnvio: '10000.0000',
      pagoRepartidor: '5000.0000',
    });
  });

  it('guardar: upsert por tenant sobre el índice parcial, devuelve configurada', async () => {
    db.query.mockResolvedValueOnce([
      [
        {
          precio_envio_defecto: '10000.0000',
          pago_repartidor_defecto: '5000.0000',
        },
      ],
      1,
    ]);
    await expect(
      service.guardar(TENANT, {
        precioEnvioDefecto: '10000',
        pagoRepartidorDefecto: '5000',
      }),
    ).resolves.toEqual({
      configurada: true,
      precioEnvioDefecto: '10000.0000',
      pagoRepartidorDefecto: '5000.0000',
    });
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT \(tenant_id\) WHERE eliminado_el IS NULL/);
    expect(params).toEqual([TENANT, '10000', '5000']);
  });
});
