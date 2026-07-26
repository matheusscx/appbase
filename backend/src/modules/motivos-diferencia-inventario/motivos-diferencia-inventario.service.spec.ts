import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { MotivosDiferenciaInventarioService } from './motivos-diferencia-inventario.service';
import { MotivoDiferenciaInventario } from './entities/motivo-diferencia-inventario.entity';

const TENANT_ID = 'tenant-uuid';
const MOTIVO_ID = 'motivo-uuid';

describe('MotivosDiferenciaInventarioService', () => {
  let service: MotivosDiferenciaInventarioService;
  let queryMock: jest.Mock;
  const dataSource = { query: undefined as unknown as jest.Mock };

  beforeEach(async () => {
    queryMock = jest.fn();
    dataSource.query = queryMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MotivosDiferenciaInventarioService,
        {
          provide: getRepositoryToken(MotivoDiferenciaInventario),
          useValue: {},
        },
        { provide: getDataSourceToken(), useValue: { query: queryMock } },
      ],
    }).compile();

    service = module.get<MotivosDiferenciaInventarioService>(
      MotivosDiferenciaInventarioService,
    );
  });

  it('rechaza un nombre duplicado en el mismo tenant', async () => {
    queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(service.create(TENANT_ID, { nombre: 'Robo' })).rejects.toThrow(
      'Ya existe un motivo de diferencia con el nombre "Robo"',
    );
  });

  it('rechaza modificar un motivo fijo del sistema', async () => {
    queryMock.mockResolvedValueOnce([
      {
        motivo_diferencia_inventario_id: MOTIVO_ID,
        nombre: 'Robo',
        activo: true,
        es_fijo: true,
      },
    ]);

    await expect(
      service.update(TENANT_ID, MOTIVO_ID, { nombre: 'Otro nombre' }),
    ).rejects.toThrow('No se puede modificar un motivo fijo del sistema');
  });

  it('rechaza eliminar un motivo fijo del sistema', async () => {
    queryMock.mockResolvedValueOnce([
      {
        motivo_diferencia_inventario_id: MOTIVO_ID,
        nombre: 'Robo',
        activo: true,
        es_fijo: true,
      },
    ]);

    await expect(service.remove(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
      'No se puede eliminar un motivo fijo del sistema',
    );
  });

  it('rechaza eliminar un motivo en uso en movimientos', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          motivo_diferencia_inventario_id: MOTIVO_ID,
          nombre: 'Robo',
          activo: true,
          es_fijo: false,
        },
      ])
      .mockResolvedValueOnce([{ cnt: '1' }]);

    await expect(service.remove(TENANT_ID, MOTIVO_ID)).rejects.toThrow(
      'No se puede eliminar: el motivo está en uso en movimientos de recuento',
    );
  });

  it('assertMotivoActivo rechaza un motivo inactivo o de otro tenant', async () => {
    const runner = { query: jest.fn().mockResolvedValueOnce([]) };

    await expect(
      service.assertMotivoActivo(runner, TENANT_ID, MOTIVO_ID),
    ).rejects.toThrow('Motivo de diferencia no válido o inactivo');
  });

  it('findAll con soloActivas filtra los inactivos', async () => {
    queryMock.mockResolvedValueOnce([]);

    await service.findAll(TENANT_ID, true);
    const sql = String(dataSource.query.mock.calls[0][0]);
    expect(sql).toContain('AND activo = true');
  });
});
