import { Test } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { assertSinHuecos } from '../../common/db/db.spec-helper';
import { TxContext } from '../../common/db/tx-context';
import { ColaDteService } from './cola-dte.service';
import { DteError } from './dte.types';
import type { BoletaEmitida } from './envio-boleta';
import { COND_CON_PROBLEMAS, COND_RECHAZADA } from './problemas-sii';

const TENANT = '550e8400-e29b-41d4-a716-446655440007';
const CAF_ID = '11111111-2222-4333-8444-555555555555';
const DOCUMENTO_ID = '99999999-8888-4777-8666-555555555555';

const BOLETA: BoletaEmitida = {
  xml: '<DTE>Café</DTE>',
  rutEmisor: '76555444-6',
  folio: 4007,
  tipo: 39,
  diferenciaIvaRedondeo: '0',
};

describe('ColaDteService', () => {
  let service: ColaDteService;
  let db: { query: jest.Mock };
  let tx: { managerActivo: jest.Mock };

  beforeEach(async () => {
    db = { query: jest.fn() };
    tx = { managerActivo: jest.fn().mockReturnValue({}) };
    const modulo = await Test.createTestingModule({
      providers: [
        ColaDteService,
        { provide: Db, useValue: db },
        { provide: TxContext, useValue: tx },
      ],
    }).compile();
    service = modulo.get(ColaDteService);
  });

  async function errorDe(promesa: Promise<unknown>): Promise<DteError> {
    try {
      await promesa;
    } catch (e) {
      if (e instanceof DteError) return e;
      throw e;
    }
    throw new Error('no tiró');
  }

  it('sin transacción activa tira, y no toca la base', async () => {
    tx.managerActivo.mockReturnValue(undefined);

    await expect(service.encolar(TENANT, BOLETA, CAF_ID)).rejects.toThrow(
      /dentro de db\.transaccion/,
    );
    expect(db.query).not.toHaveBeenCalled();
  });

  it('devuelve el id del documento, con la boleta y el CAF como parámetros', async () => {
    db.query.mockResolvedValueOnce([
      { rut_emisor: '76555444-6', documento_id: DOCUMENTO_ID },
    ]);

    await expect(service.encolar(TENANT, BOLETA, CAF_ID)).resolves.toEqual({
      documentoId: DOCUMENTO_ID,
    });
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      TENANT,
      CAF_ID,
      39,
      4007,
      '76555444-6',
      '<DTE>Café</DTE>',
    ]);
    assertSinHuecos(sql, params);
  });

  it('el SQL filtra el CAF por tenant y no borrado, e inserta pendiente', async () => {
    db.query.mockResolvedValueOnce([
      { rut_emisor: '76555444-6', documento_id: DOCUMENTO_ID },
    ]);
    await service.encolar(TENANT, BOLETA, CAF_ID);

    const [sql] = db.query.mock.calls[0] as [string];
    expect(sql).toContain('c.tenant_id = $1');
    expect(sql).toContain('c.caf_id = $2');
    expect(sql).toContain('c.eliminado_el IS NULL');
    expect(sql).toContain("'pendiente', now(), now()");
    expect(sql).toContain('caf.rut_emisor = $5::varchar');
    expect(sql).toContain('RETURNING documento_id');
  });

  it('entiende el RETURNING que llega como [filas, cuántas]', async () => {
    db.query.mockResolvedValueOnce([
      [{ rut_emisor: '76555444-6', documento_id: DOCUMENTO_ID }],
      1,
    ]);

    await expect(service.encolar(TENANT, BOLETA, CAF_ID)).resolves.toEqual({
      documentoId: DOCUMENTO_ID,
    });
  });

  it('un CAF que no existe (o es de otro tenant) es SIN_FOLIOS', async () => {
    db.query.mockResolvedValueOnce([]);

    const error = await errorDe(service.encolar(TENANT, BOLETA, CAF_ID));
    expect(error.codigo).toBe('SIN_FOLIOS');
  });

  it('un CAF de otro RUT es ENVIO_OTRO_EMISOR, con ambos RUT en el mensaje', async () => {
    db.query.mockResolvedValueOnce([
      { rut_emisor: '78787878-4', documento_id: null },
    ]);

    const error = await errorDe(service.encolar(TENANT, BOLETA, CAF_ID));
    expect(error.codigo).toBe('ENVIO_OTRO_EMISOR');
    expect(error.message).toContain('76555444-6');
    expect(error.message).toContain('78787878-4');
  });

  it('normaliza el RUT de la boleta antes de compararlo con el del CAF', async () => {
    db.query.mockResolvedValueOnce([
      { rut_emisor: '76555444-6', documento_id: DOCUMENTO_ID },
    ]);
    await service.encolar(
      TENANT,
      { ...BOLETA, rutEmisor: '76.555.444-6' },
      CAF_ID,
    );

    const [, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params[4]).toBe('76555444-6');
  });

  describe('problemasDeTodos', () => {
    const EMITIDA = new Date('2026-10-15T10:00:00.000Z');
    const FILA = {
      documento_id: DOCUMENTO_ID,
      tenant_id: TENANT,
      tenant: 'Paris',
      razon_social: 'Panadería Paris SpA',
      ambiente: 'certificacion',
      tipo: 39,
      folio: 4007,
      emitido_el: EMITIDA,
      grupo: 'atrasada',
      intentos: 3,
      ultimo_error: 'No hay conexión con el SII',
      detalle_sii: null,
      envio_estado_sii: '1',
      envio_ultimo_error: 'El SII contestó un código que no conocemos',
    };

    it('hace una sola consulta y pasa de snake_case a camelCase', async () => {
      db.query.mockResolvedValueOnce([
        FILA,
        {
          ...FILA,
          documento_id: 'aaaaaaaa-8888-4777-8666-555555555555',
          grupo: 'rechazada',
          razon_social: null,
          ultimo_error: null,
          detalle_sii: { estado: 'RCH' },
          envio_estado_sii: null,
          envio_ultimo_error: null,
        },
      ]);

      const filas = await service.problemasDeTodos();

      expect(db.query).toHaveBeenCalledTimes(1);
      expect(filas).toEqual([
        {
          documentoId: DOCUMENTO_ID,
          tenantId: TENANT,
          tenant: 'Paris',
          razonSocial: 'Panadería Paris SpA',
          ambiente: 'certificacion',
          tipo: 39,
          folio: 4007,
          emitidaEl: EMITIDA,
          grupo: 'atrasada',
          intentos: 3,
          ultimoError: 'No hay conexión con el SII',
          detalleSii: null,
          envioEstadoSii: '1',
          envioUltimoError: 'El SII contestó un código que no conocemos',
        },
        expect.objectContaining({
          documentoId: 'aaaaaaaa-8888-4777-8666-555555555555',
          grupo: 'rechazada',
          razonSocial: null,
          ultimoError: null,
          detalleSii: { estado: 'RCH' },
          envioEstadoSii: null,
          envioUltimoError: null,
        }),
      ]);
    });

    it('sin boletas con problemas devuelve una lista vacía', async () => {
      db.query.mockResolvedValueOnce([]);

      await expect(service.problemasDeTodos()).resolves.toEqual([]);
    });

    it('cruza tenants a propósito, sin parámetros, y filtra lo dado de baja en cada join', async () => {
      db.query.mockResolvedValueOnce([]);
      await service.problemasDeTodos();

      const [sql, params] = db.query.mock.calls[0] as [string, unknown[]?];
      expect(params ?? []).toEqual([]);
      expect(sql).not.toContain('d.tenant_id =');
      expect(sql).toContain('d.eliminado_el IS NULL');
      expect(sql).toContain('t.eliminado_el IS NULL');
      expect(sql).toContain('rs.eliminado_el IS NULL');
      expect(sql).toContain('LEFT JOIN razones_sociales rs');
      expect(sql).toContain(
        'LEFT JOIN dte_envios e ON e.envio_id = d.envio_id AND e.eliminado_el IS NULL',
      );
      expect(sql).toContain(COND_CON_PROBLEMAS);
      expect(sql).toContain(COND_RECHAZADA);
      expect(sql).toContain('ORDER BY d.emitido_el, d.folio');
      expect(sql).toContain('LIMIT 200');
    });
  });
});
