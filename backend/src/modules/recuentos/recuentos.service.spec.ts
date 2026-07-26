import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { RecuentosService } from './recuentos.service';

const TENANT_ID = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';
const ITEM_ID = 'item-uuid';

describe('RecuentosService', () => {
  let service: RecuentosService;
  let manager: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    manager = { query: jest.fn() };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecuentosService,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<RecuentosService>(RecuentosService);
  });

  describe('RecuentosService — crear sesión', () => {
    it('congela el stock del sistema en cada línea', async () => {
      manager.query
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            nombre: 'Producto test',
            tipo: 'producto',
            stock: '12400',
            modo_inventario: 'cantidad',
            unidad_medida: 'un',
          },
        ])
        .mockResolvedValueOnce([{ recuento_id: 'recuento-1' }])
        .mockResolvedValueOnce(undefined);

      await service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] });

      const insertLinea = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('INSERT INTO recuento_inventario_linea'),
      );
      expect(insertLinea![1]).toEqual(expect.arrayContaining(['12400']));
    });

    it('rechaza un producto en modo serie o lote', async () => {
      manager.query.mockResolvedValueOnce([
        {
          item_id: ITEM_ID,
          nombre: 'Notebook',
          tipo: 'producto',
          stock: '3',
          modo_inventario: 'serie',
          unidad_medida: 'un',
        },
      ]);

      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
      ).rejects.toThrow('El recuento solo admite productos por cantidad');
    });

    it('rechaza un item sin control de stock', async () => {
      manager.query.mockResolvedValueOnce([]);

      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
      ).rejects.toThrow('El item no tiene control de stock');
    });

    it('rechaza crear una sesión sin items', async () => {
      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [] }),
      ).rejects.toThrow('El recuento necesita al menos un producto');
    });
  });
});
