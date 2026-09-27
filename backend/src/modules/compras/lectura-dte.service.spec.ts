import { Test } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import type { LecturaDteDto } from './dto/lectura-dte.dto';
import {
  LecturaDteService,
  normalizarClave,
  normalizarRut,
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
