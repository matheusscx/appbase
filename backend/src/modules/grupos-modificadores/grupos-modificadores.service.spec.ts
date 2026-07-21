import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { CatalogService } from '../catalog/catalog.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ITEM_ING_A = '550e8400-e29b-41d4-a716-4466554400a1';
const ITEM_ING_B = '550e8400-e29b-41d4-a716-4466554400a2';
const ITEM_PROD = '550e8400-e29b-41d4-a716-4466554400b1';

describe('GruposModificadoresService', () => {
  let service: GruposModificadoresService;
  let managerMock: { query: jest.Mock };
  let convertirUnidad: jest.Mock;

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    convertirUnidad = jest.fn().mockResolvedValue('1');
    const dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => unknown) =>
        cb(managerMock),
      ),
      query: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GruposModificadoresService,
        { provide: getRepositoryToken(GrupoModificador), useValue: {} },
        { provide: getRepositoryToken(GrupoModificadorOpcion), useValue: {} },
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: CatalogService, useValue: { convertirUnidad } },
      ],
    }).compile();
    service = moduleRef.get(GruposModificadoresService);
  });

  it('crea un grupo homogéneo de familia ingrediente y resuelve opciones', async () => {
    // INSERT grupo → item lookups (2 ingredientes) → INSERT opciones
    managerMock.query
      .mockResolvedValueOnce([]) // check nombre único vivo
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // INSERT grupo RETURNING
      .mockResolvedValueOnce([
        {
          tipo: 'ingrediente',
          nombre: 'Carne',
          modo_inventario: 'cantidad',
          unidad_medida: 'g',
        },
      ])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }])
      .mockResolvedValueOnce([
        {
          tipo: 'ingrediente',
          nombre: 'Pollo',
          modo_inventario: 'cantidad',
          unidad_medida: 'g',
        },
      ])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O2' }]);
    const res = await service.create(TENANT_ID, {
      nombre: 'Proteína',
      opciones: [
        {
          itemId: ITEM_ING_A,
          cantidad: '100',
          unidadCodigo: 'g',
          precioExtra: '0',
        },
        {
          itemId: ITEM_ING_B,
          cantidad: '120',
          unidadCodigo: 'g',
          precioExtra: '1500',
        },
      ],
    });
    expect(res.familia).toBe('ingrediente');
    expect(res.opciones).toHaveLength(2);
  });

  it('rechaza mezclar familia ingrediente y vendible', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([
        {
          tipo: 'ingrediente',
          nombre: 'Carne',
          modo_inventario: 'cantidad',
          unidad_medida: 'g',
        },
      ])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }])
      .mockResolvedValueOnce([
        {
          tipo: 'producto',
          nombre: 'Coca',
          modo_inventario: 'cantidad',
          unidad_medida: 'unidad',
        },
      ]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'Mixto',
        opciones: [
          {
            itemId: ITEM_ING_A,
            cantidad: '100',
            unidadCodigo: 'g',
            precioExtra: '0',
          },
          { itemId: ITEM_PROD, cantidad: '1', precioExtra: '0' },
        ],
      } as any),
    ).rejects.toThrow(/misma familia|homogén/i);
  });

  it('rechaza precioExtra negativo', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([
        {
          tipo: 'producto',
          nombre: 'Coca',
          modo_inventario: 'cantidad',
          unidad_medida: 'unidad',
        },
      ]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'Bebida',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '-1' }],
      } as any),
    ).rejects.toThrow(/precio.*mayor o igual a 0/i);
  });

  it('rechaza opción vendible de tipo combo o suscripcion', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
      .mockResolvedValueOnce([
        {
          tipo: 'combo',
          nombre: 'Otro combo',
          modo_inventario: null,
          unidad_medida: null,
        },
      ]);
    await expect(
      service.create(TENANT_ID, {
        nombre: 'X',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '0' }],
      } as any),
    ).rejects.toThrow(/producto.*receta.*servicio|ingrediente/i);
  });
});
