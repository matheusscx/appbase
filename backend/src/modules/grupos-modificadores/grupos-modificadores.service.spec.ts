import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { CatalogService } from '../catalog/catalog.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ITEM_ING_A = '550e8400-e29b-41d4-a716-4466554400a1';
const ITEM_ING_B = '550e8400-e29b-41d4-a716-4466554400a2';
const ITEM_PROD = '550e8400-e29b-41d4-a716-4466554400b1';

describe('GruposModificadoresService', () => {
  let service: GruposModificadoresService;
  let managerMock: { query: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
  let convertirUnidad: jest.Mock;

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    convertirUnidad = jest.fn().mockResolvedValue('1');
    dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => unknown) =>
        cb(managerMock),
      ),
      query: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        GruposModificadoresService,
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
    // Grupo recién creado: shape consistente con GET/PATCH (itemsUsandoCount).
    expect(res.itemsUsandoCount).toBe(0);
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

  describe('update/remove grupo', () => {
    it('reemplaza opciones manteniendo la familia y devuelve shape completo (itemsUsandoCount + stock)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo vivo
        // (nombre sin cambio → no se llama assertNombreLibre ni UPDATE nombre)
        .mockResolvedValueOnce([{ affected: 1 }]) // soft-delete opciones viejas
        .mockResolvedValueOnce([
          {
            tipo: 'producto',
            nombre: 'Coca',
            modo_inventario: 'cantidad',
            unidad_medida: 'unidad',
          },
        ]) // item lookup
        .mockResolvedValueOnce([{ grupo_opcion_id: 'O9' }]) // INSERT opción
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // cargarGrupo: SELECT grupo vivo
        .mockResolvedValueOnce([
          {
            grupo_opcion_id: 'O9',
            item_id: ITEM_PROD,
            item_nombre: 'Coca',
            tipo: 'producto',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '800',
            orden: 0,
            stock: null,
          },
        ]) // cargarGrupo: SELECT opciones con JOIN items
        .mockResolvedValueOnce([{ total: 2 }]); // cargarGrupo: SELECT COUNT uso
      const res = await service.update(TENANT_ID, 'G1', {
        nombre: 'Bebida',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '800' }],
      });
      expect(res.familia).toBe('vendible');
      expect(res.opciones).toHaveLength(1);
      // Shape consistente con findOne/findAll: itemsUsandoCount y stock por
      // opción deben venir siempre, también tras reemplazar opciones.
      expect(typeof res.itemsUsandoCount).toBe('number');
      expect(res.itemsUsandoCount).toBe(2);
      expect(res.opciones[0]).toHaveProperty('stock');
      expect(res.opciones[0].stock).toBeNull();
    });

    it('renombra sin reemplazar opciones (rama solo-rename) y verifica disponibilidad', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo vivo
        .mockResolvedValueOnce([]) // assertNombreLibre (nombre cambió)
        .mockResolvedValueOnce([]) // UPDATE nombre
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebidas' },
        ]) // cargarGrupo: SELECT grupo
        .mockResolvedValueOnce([]) // cargarGrupo: SELECT opciones
        .mockResolvedValueOnce([{ total: 0 }]); // cargarGrupo: COUNT uso

      const res = await service.update(TENANT_ID, 'G1', { nombre: 'Bebidas' });

      expect(res.nombre).toBe('Bebidas');
      const updateNombre = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE grupos_modificadores SET nombre'),
      );
      expect(updateNombre).toBeDefined();
    });

    it('no verifica disponibilidad de nombre si el nombre no cambia', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo vivo
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // cargarGrupo: SELECT grupo
        .mockResolvedValueOnce([]) // cargarGrupo: SELECT opciones
        .mockResolvedValueOnce([{ total: 0 }]); // cargarGrupo: COUNT uso

      await service.update(TENANT_ID, 'G1', { nombre: 'Bebida' });

      const checkNombre = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('LOWER(nombre)'),
      );
      expect(checkNombre).toBeUndefined();
    });

    it('update lanza 404 si el grupo no existe', async () => {
      managerMock.query.mockResolvedValueOnce([]); // SELECT grupo vivo → vacío
      await expect(
        service.update(TENANT_ID, 'inexistente', { nombre: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('remove lanza 404 si el grupo no existe', async () => {
      managerMock.query.mockResolvedValueOnce([]); // SELECT grupo vivo → vacío
      await expect(service.remove(TENANT_ID, 'inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('bloquea borrar un grupo asociado a items vivos', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo
        .mockResolvedValueOnce([{ nombre: 'Combo Clásico' }]); // items asociados vivos
      await expect(service.remove(TENANT_ID, 'G1')).rejects.toThrow(
        /No se puede eliminar.*Combo Clásico/i,
      );
    });
  });

  describe('findAll', () => {
    it('batchea opciones y conteos (3 queries totales, sin N+1 por grupo)', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
          { grupo_modificador_id: 'G2', nombre: 'Proteína' },
        ]) // SELECT grupos
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            grupo_opcion_id: 'O1',
            item_id: ITEM_PROD,
            item_nombre: 'Coca',
            tipo: 'producto',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '0',
            orden: 0,
            stock: '10',
          },
          {
            grupo_modificador_id: 'G2',
            grupo_opcion_id: 'O2',
            item_id: ITEM_ING_A,
            item_nombre: 'Carne',
            tipo: 'ingrediente',
            cantidad: '100',
            unidad_codigo: 'g',
            precio_extra: '0',
            orden: 0,
            stock: '500',
          },
        ]) // SELECT opciones batcheadas (ANY)
        .mockResolvedValueOnce([{ grupo_modificador_id: 'G1', total: 3 }]); // conteos

      const res = await service.findAll(TENANT_ID);

      // 3 queries totales, no una tanda de 3 por cada grupo.
      expect(dataSourceMock.query).toHaveBeenCalledTimes(3);
      expect(res).toHaveLength(2);
      expect(res[0]).toMatchObject({
        grupoModificadorId: 'G1',
        familia: 'vendible',
        itemsUsandoCount: 3,
      });
      expect(res[0].opciones).toHaveLength(1);
      expect(res[1]).toMatchObject({
        grupoModificadorId: 'G2',
        familia: 'ingrediente',
        itemsUsandoCount: 0, // no aparece en usoRows → 0 por defecto
      });
    });

    it('devuelve [] sin más queries si el tenant no tiene grupos', async () => {
      dataSourceMock.query.mockResolvedValueOnce([]);
      const res = await service.findAll(TENANT_ID);
      expect(res).toEqual([]);
      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
    });
  });
});
