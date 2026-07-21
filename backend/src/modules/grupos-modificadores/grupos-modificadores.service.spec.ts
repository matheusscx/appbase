import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { CatalogService } from '../catalog/catalog.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ITEM_ING_A = '550e8400-e29b-41d4-a716-4466554400a1';
const ITEM_ING_B = '550e8400-e29b-41d4-a716-4466554400a2';
const ITEM_PROD = '550e8400-e29b-41d4-a716-4466554400b1';
const ITEM_PROD_2 = '550e8400-e29b-41d4-a716-4466554400b2';
const OPCION_ID = '550e8400-e29b-41d4-a716-4466554400c1';

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

  it('permite crear una opción sin cantidad default (queda null)', async () => {
    managerMock.query
      .mockResolvedValueOnce([]) // assertNombreLibre
      .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // INSERT grupo
      .mockResolvedValueOnce([
        {
          tipo: 'producto',
          nombre: 'Coca',
          modo_inventario: 'cantidad',
          unidad_medida: 'unidad',
        },
      ])
      .mockResolvedValueOnce([{ grupo_opcion_id: 'O1' }]); // INSERT opción
    const res = await service.create(TENANT_ID, {
      nombre: 'Bebida',
      opciones: [{ itemId: ITEM_PROD, precioExtra: '0' }], // sin cantidad
    });
    expect(res.opciones[0].cantidad).toBeNull();
  });

  it('rechaza cantidad default explícita <= 0', async () => {
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
        opciones: [{ itemId: ITEM_PROD, cantidad: '0', precioExtra: '0' }],
      } as any),
    ).rejects.toThrow(/cantidad.*mayor a 0/i);
  });

  describe('update/remove grupo', () => {
    it('reemplaza opciones manteniendo la familia y devuelve shape completo (itemsUsandoCount + stock)', async () => {
      // Upsert-preservando (Task 2): sin opciones vivas previas, la opción
      // entrante es nueva → INSERT (no hay reemplazo-total con delete-all).
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo vivo
        // (nombre sin cambio → no se llama assertNombreLibre ni UPDATE nombre)
        .mockResolvedValueOnce([]) // SELECT opciones vivas actuales (map por item_id) — ninguna
        .mockResolvedValueOnce([
          {
            tipo: 'producto',
            nombre: 'Coca',
            modo_inventario: 'cantidad',
            unidad_medida: 'unidad',
          },
        ]) // item lookup
        .mockResolvedValueOnce([{ grupo_opcion_id: 'O9' }]) // INSERT opción (nueva)
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

    it('preserva grupo_opcion_id de una opción que sigue viva (UPDATE, no delete+insert)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupo vivo
        // SELECT opciones vivas actuales (map por item_id)
        .mockResolvedValueOnce([
          { grupo_opcion_id: 'O-EXIST', item_id: ITEM_PROD },
        ])
        // item lookup de la opción entrante (validarYResolverOpciones)
        .mockResolvedValueOnce([
          {
            tipo: 'producto',
            nombre: 'Coca',
            modo_inventario: 'cantidad',
            unidad_medida: 'unidad',
          },
        ])
        .mockResolvedValueOnce([]) // UPDATE de la opción existente
        .mockResolvedValueOnce([]); // cargarGrupo: SELECT grupo → [] → devuelve null (no importa para este test)
      await service.update(TENANT_ID, 'G1', {
        nombre: 'Bebida',
        opciones: [{ itemId: ITEM_PROD, cantidad: '1', precioExtra: '900' }],
      });
      const updateCall = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          /UPDATE grupo_modificador_opciones SET/i.test(c[0]) &&
          /precio_extra/i.test(c[0]),
      );
      expect(updateCall).toBeTruthy(); // hubo UPDATE de la opción, no un INSERT nuevo
      const insertCall = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          /INSERT INTO grupo_modificador_opciones/i.test(c[0]),
      );
      expect(insertCall).toBeUndefined();
    });

    it('soft-borra los overrides de una opción eliminada del grupo', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ])
        .mockResolvedValueOnce([
          { grupo_opcion_id: 'O-GONE', item_id: ITEM_PROD },
        ]) // vivas actuales
        // opciones entrantes: ITEM_PROD_2 en vez de ITEM_PROD → O-GONE desaparece
        .mockResolvedValueOnce([
          {
            tipo: 'producto',
            nombre: 'Fanta',
            modo_inventario: 'cantidad',
            unidad_medida: 'unidad',
          },
        ]) // item de la nueva opción
        .mockResolvedValueOnce([{ grupo_opcion_id: 'O-NEW' }]) // INSERT nueva
        .mockResolvedValueOnce([]) // soft-delete overrides de O-GONE
        .mockResolvedValueOnce([]) // soft-delete opción O-GONE
        .mockResolvedValueOnce([]); // cargarGrupo: SELECT grupo → [] → devuelve null
      await service.update(TENANT_ID, 'G1', {
        opciones: [{ itemId: ITEM_PROD_2, cantidad: '1', precioExtra: '0' }],
      });
      const ovrDelete = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          /UPDATE item_grupo_modificador_opciones SET eliminado_el/i.test(c[0]),
      );
      expect(ovrDelete).toBeTruthy();
      const opcionDelete = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          /UPDATE grupo_modificador_opciones SET eliminado_el/i.test(c[0]),
      );
      expect(opcionDelete).toBeTruthy();
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

    it('propaga cantidad null en una opción de lectura (columna nullable)', async () => {
      dataSourceMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: 'G1', nombre: 'Bebida' },
        ]) // SELECT grupos
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            grupo_opcion_id: 'O1',
            item_id: ITEM_PROD,
            item_nombre: 'Coca',
            tipo: 'producto',
            cantidad: null,
            unidad_codigo: null,
            precio_extra: '0',
            orden: 0,
            stock: null,
          },
        ]) // SELECT opciones batcheadas (ANY)
        .mockResolvedValueOnce([]); // conteos

      const res = await service.findAll(TENANT_ID);

      expect(res[0].opciones[0].cantidad).toBeNull();
    });

    it('devuelve [] sin más queries si el tenant no tiene grupos', async () => {
      dataSourceMock.query.mockResolvedValueOnce([]);
      const res = await service.findAll(TENANT_ID);
      expect(res).toEqual([]);
      expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('itemsUsando / aplicarOverrides', () => {
    it('aplicarOverrides hace upsert del mismo valor a varias asociaciones', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // grupo vivo
        .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }]) // opción pertenece al grupo
        .mockResolvedValueOnce([
          { item_grupo_id: 'IG1' },
          { item_grupo_id: 'IG2' },
        ]) // asociaciones válidas del grupo
        .mockResolvedValueOnce([]) // overrides vivos de IG1
        .mockResolvedValueOnce([]) // INSERT override IG1
        .mockResolvedValueOnce([]) // overrides vivos de IG2
        .mockResolvedValueOnce([]); // INSERT override IG2
      const res = await service.aplicarOverrides(TENANT_ID, 'G1', {
        itemGrupoIds: ['IG1', 'IG2'],
        grupoOpcionId: OPCION_ID,
        cantidad: '150',
        unidadCodigo: 'g',
      });
      expect(res.actualizados).toBe(2);
    });

    it('rechaza aplicar a un item_grupo_id que no pertenece al grupo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
        .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }])
        .mockResolvedValueOnce([{ item_grupo_id: 'IG1' }]); // solo IG1 es válido; IG9 no
      await expect(
        service.aplicarOverrides(TENANT_ID, 'G1', {
          itemGrupoIds: ['IG1', 'IG9'],
          grupoOpcionId: OPCION_ID,
          cantidad: '150',
        }),
      ).rejects.toThrow(/no pertenece|no válid/i);
    });

    it('rechaza override de cantidad en opción ingrediente sin unidad efectiva', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }]) // grupo vivo
        .mockResolvedValueOnce([
          {
            grupo_opcion_id: OPCION_ID,
            tipo: 'ingrediente',
            default_cantidad: null,
            default_unidad: null,
            unidad_medida: 'g',
          },
        ]) // opción pertenece (ingrediente, sin default de cantidad/unidad)
        .mockResolvedValueOnce([{ item_grupo_id: 'IG1' }]); // asociaciones válidas
      await expect(
        service.aplicarOverrides(TENANT_ID, 'G1', {
          itemGrupoIds: ['IG1'],
          grupoOpcionId: OPCION_ID,
          cantidad: '150', // sin unidadCodigo → unidad efectiva null
        }),
      ).rejects.toThrow(/unidad de medida/i);
    });

    it('rechaza override con unidad incompatible en opción ingrediente', async () => {
      convertirUnidad.mockRejectedValueOnce(new Error('unidad incompatible'));
      managerMock.query
        .mockResolvedValueOnce([{ grupo_modificador_id: 'G1' }])
        .mockResolvedValueOnce([
          {
            grupo_opcion_id: OPCION_ID,
            tipo: 'ingrediente',
            default_cantidad: null,
            default_unidad: null,
            unidad_medida: 'g',
          },
        ])
        .mockResolvedValueOnce([{ item_grupo_id: 'IG1' }]);
      await expect(
        service.aplicarOverrides(TENANT_ID, 'G1', {
          itemGrupoIds: ['IG1'],
          grupoOpcionId: OPCION_ID,
          cantidad: '150',
          unidadCodigo: 'ml',
        }),
      ).rejects.toThrow(/incompatible/i);
    });
  });
});
