import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import type { LecturaDteDto } from './dto/lectura-dte.dto';
import {
  LecturaDteService,
  normalizarClave,
  normalizarRut,
  planAprendizaje,
  type CodigoVivo,
  type EntradaAprendizaje,
} from './lectura-dte.service';

describe('normalizarRut', () => {
  it.each([
    ['76.543.210-3', '76543210-3'],
    ['76543210-3', '76543210-3'],
    ['765432103', '76543210-3'],
    [' 9.876.543-k ', '9876543-K'],
  ])('%s → %s', (entrada, salida) => {
    expect(normalizarRut(entrada)).toBe(salida);
  });
});

describe('normalizarClave', () => {
  it('mayúsculas, sin bordes, espacios colapsados', () => {
    expect(normalizarClave('  codigo:int1:cc350-12 ')).toBe(
      'CODIGO:INT1:CC350-12',
    );
    expect(normalizarClave('NOMBRE:Fanta   350ml  CJ12')).toBe(
      'NOMBRE:FANTA 350ML CJ12',
    );
  });
});

/**
 * Ata esta `normalizarClave` con la del frontend
 * (`frontend/app/composables/useDte.ts`, describe homónimo en
 * `useDte.spec.ts`) — mismos pares, mismo orden (docs/agent/pendientes.md
 * § 1, "Atar con un test las dos `normalizarClave`"). Backend y frontend no
 * comparten código (decisión del owner), así que el fixture está duplicado a
 * mano en los dos specs: si uno cambia, el otro no se entera solo. Medido
 * 2026-09-28 que las dos implementaciones no divergen para ningún code point
 * combinado con espacios — este fixture cubre los casos de borde de esa
 * medición (NBSP, tabs, `ß`, saltos de línea, espacios al borde y en medio).
 */
describe('normalizarClave — pares atados con el frontend (useDte.spec.ts)', () => {
  const PARES: [entrada: string, clave: string][] = [
    ['  codigo:int1:cc350-12 ', 'CODIGO:INT1:CC350-12'],
    ['NOMBRE:Fanta   350ml  CJ12', 'NOMBRE:FANTA 350ML CJ12'],
    [' CJ12 ', 'CJ12'],
    ['CJ 12', 'CJ 12'],
    ['\tCJ12\t', 'CJ12'],
    ['CJ\t12', 'CJ 12'],
    ['cj12\nabc', 'CJ12 ABC'],
    ['\ncj12\n', 'CJ12'],
    ['straße 350ml', 'STRASSE 350ML'],
    ['ß', 'SS'],
    ['  ß ml  ', 'SS ML'],
    ['  Fanta 350ml\tCJ12\n', 'FANTA 350ML CJ12'],
  ];

  it.each(PARES)('%j → %j', (entrada, clave) => {
    expect(normalizarClave(entrada)).toBe(clave);
  });
});

/**
 * `planAprendizaje`: puro, sin `Db` (spec compras-xml-dte § 5.2, tarea 2
 * § "Step 2"). Un test por regla.
 */
describe('planAprendizaje', () => {
  const ITEM = 'item-1';
  const OTRO_ITEM = 'item-2';
  const PRESENTACION = 'presentacion-1';

  function entrada(
    clave: string,
    destino: EntradaAprendizaje['destino'],
    descripcion = 'Descripción',
  ): EntradaAprendizaje {
    return { clave, descripcion, destino };
  }

  function viva(
    id: string,
    clave: string,
    destino: EntradaAprendizaje['destino'],
  ): CodigoVivo {
    return { id, clave, descripcion: 'Descripción vieja', destino };
  }

  it('clave sin viva: va a insertar, nada que marcar', () => {
    const e = entrada('CJ12', { itemId: ITEM, unidadCodigo: 'unidad' });
    expect(planAprendizaje([e], [])).toEqual({ marcar: [], insertar: [e] });
  });

  it('viva con el mismo destino: no marca ni inserta, la descripción no se toca', () => {
    const destino = { itemId: ITEM, unidadCodigo: 'unidad' };
    const e = entrada('CJ12', destino, 'Descripción nueva de la factura');
    const v = viva('viva-1', 'CJ12', destino);
    expect(planAprendizaje([e], [v])).toEqual({ marcar: [], insertar: [] });
  });

  it('viva con otro destino: marca la vieja e inserta la nueva', () => {
    const e = entrada('CJ12', { itemId: ITEM, unidadCodigo: 'unidad' });
    const v = viva('viva-1', 'CJ12', {
      itemId: OTRO_ITEM,
      unidadCodigo: 'unidad',
    });
    expect(planAprendizaje([e], [v])).toEqual({
      marcar: ['viva-1'],
      insertar: [e],
    });
  });

  it('la misma clave dos veces con el mismo destino (línea bonificada a $0): una sola entrada', () => {
    const destino = { itemId: ITEM, presentacionId: PRESENTACION };
    const a = entrada('CJ12', destino, 'Primera vez');
    const b = entrada('CJ12', destino, 'Bonificada a $0, mismo código');
    const { marcar, insertar } = planAprendizaje([a, b], []);
    expect(marcar).toEqual([]);
    expect(insertar).toHaveLength(1);
    expect(insertar[0].clave).toBe('CJ12');
  });

  it('la misma clave con destinos distintos: 400 que nombra la clave', () => {
    const a = entrada('CJ12', { itemId: ITEM, unidadCodigo: 'unidad' });
    const b = entrada('CJ12', { itemId: OTRO_ITEM, unidadCodigo: 'unidad' });
    expect(() => planAprendizaje([a, b], [])).toThrow(BadRequestException);
    expect(() => planAprendizaje([a, b], [])).toThrow(/CJ12/);
  });

  it('mercadería y no_mercaderia para la misma clave: la misma excepción', () => {
    const a = entrada('FLETE', { itemId: ITEM, unidadCodigo: 'unidad' });
    const b = entrada('FLETE', 'no_mercaderia');
    expect(() => planAprendizaje([a, b], [])).toThrow(BadRequestException);
    expect(() => planAprendizaje([a, b], [])).toThrow(/FLETE/);
  });
});

/**
 * `resolverAsociaciones`: el filtro de `eliminado_el` sobre `codigos_proveedor`
 * (spec § 5.3, mutante Step 6 #2). Reaprender deja dos filas con la MISMA
 * clave (la vieja marcada, la nueva viva); un e2e de comportamiento sobre eso
 * es no determinístico —`porClave` es un `Map` que se queda con la ÚLTIMA
 * fila del array, y sin `ORDER BY` ese orden lo decide el heap de Postgres,
 * no el código—. Medido: quitar el filtro NO tumbó el e2e de reaprendizaje en
 * este entorno porque la fila nueva salió última igual. Por eso, como en el
 * `ORDER BY` de bloqueo de filas (`docs/patterns/backend.md` §15), el que caza
 * esto de verdad es un unitario que afirma sobre el SQL, con `Db` mockeado.
 */
describe('resolverAsociaciones: la consulta de codigos_proveedor filtra eliminado_el', () => {
  it('el SQL de `FROM codigos_proveedor` incluye `cp.eliminado_el IS NULL`', async () => {
    const queries: string[] = [];
    const query = jest.fn((sql: string) => {
      queries.push(sql);
      if (/FROM terceros/.test(sql)) {
        return Promise.resolve([
          { tercero_id: 'proveedor-1', nombre: 'Proveedor X' },
        ]);
      }
      return Promise.resolve([]);
    });
    const moduleRef = await Test.createTestingModule({
      providers: [LecturaDteService, { provide: Db, useValue: { query } }],
    }).compile();
    const service = moduleRef.get(LecturaDteService);

    await service.leer('tenant-1', {
      emisorRut: '12.345.678-9',
      receptorRut: '12.345.678-9',
      tipoDte: '33',
      folio: 'F1',
      claves: ['CLAVE-1'],
    });

    const sqlAsociaciones = queries.find((q) =>
      q.includes('FROM codigos_proveedor'),
    );
    expect(sqlAsociaciones).toBeDefined();
    expect(sqlAsociaciones).toMatch(/cp\.eliminado_el IS NULL/);
  });
});

/**
 * `leer()`: el corte de notas de crédito/débito (spec compras-xml-dte § 3.1)
 * tiene que ser un corte ANTES de consultar, no un filtro sobre el resultado
 * — el seed no tiene ninguna fila con código '56'/'61' en
 * `tipos_documento_compra`, así que un e2e por sí solo no distingue "cortó
 * antes" de "consultó y no encontró nada". Este test mockea `Db` e inspecciona
 * el SQL de cada llamada.
 */
describe('leer(): el corte de 56/61 nunca consulta tipos_documento_compra', () => {
  let service: LecturaDteService;
  let queries: string[];

  beforeEach(async () => {
    queries = [];
    const query = jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve([]);
    });
    const moduleRef = await Test.createTestingModule({
      providers: [LecturaDteService, { provide: Db, useValue: { query } }],
    }).compile();
    service = moduleRef.get(LecturaDteService);
  });

  function dto(tipoDte: string): LecturaDteDto {
    return {
      emisorRut: '12.345.678-9',
      receptorRut: '12.345.678-9',
      tipoDte,
      folio: 'F1',
      claves: [],
    };
  }

  const consultoTipoDocumento = () =>
    queries.some((sql) => sql.includes('tipos_documento_compra'));

  it.each(['56', '61'])(
    'tipoDte %s: nunca llega a consultar tipos_documento_compra',
    async (tipoDte) => {
      await service.leer('tenant-1', dto(tipoDte));
      expect(consultoTipoDocumento()).toBe(false);
    },
  );

  it('tipoDte 33: sí consulta tipos_documento_compra', async () => {
    await service.leer('tenant-1', dto('33'));
    expect(consultoTipoDocumento()).toBe(true);
  });
});

/**
 * Con `proveedorId`, `assertRutDelProveedor` y `resolverProveedor` leían la
 * misma fila de `terceros` dos veces: la primera para validar el RUT, la
 * segunda solo por `nombre` (docs/agent/pendientes.md § 1, hallazgo
 * 2026-09-28). `assertRutDelProveedor` ahora devuelve la fila que ya leyó y
 * `resolverProveedor` la reusa en vez de repetir el `SELECT`.
 */
describe('leer() con proveedorId: una sola consulta a terceros', () => {
  it('consulta `terceros` una sola vez y usa esa fila para el nombre', async () => {
    const queries: string[] = [];
    const query = jest.fn((sql: string) => {
      queries.push(sql);
      if (/FROM terceros/.test(sql)) {
        return Promise.resolve([
          { nombre: 'Proveedor X', rut: null, rut_fiscal: null },
        ]);
      }
      return Promise.resolve([]);
    });
    const moduleRef = await Test.createTestingModule({
      providers: [LecturaDteService, { provide: Db, useValue: { query } }],
    }).compile();
    const service = moduleRef.get(LecturaDteService);
    const proveedorId = '550e8400-e29b-41d4-a716-446655440001';

    const respuesta = await service.leer('tenant-1', {
      emisorRut: '12.345.678-9',
      receptorRut: '12.345.678-9',
      tipoDte: '33',
      folio: 'F1',
      proveedorId,
      claves: [],
    });

    const consultasATerceros = queries.filter((sql) =>
      /FROM terceros/.test(sql),
    );
    expect(consultasATerceros).toHaveLength(1);
    expect(respuesta.proveedor).toEqual({
      id: proveedorId,
      nombre: 'Proveedor X',
    });
  });
});
