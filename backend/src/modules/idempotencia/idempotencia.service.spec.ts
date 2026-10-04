import {
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Exclude } from 'class-transformer';
import { Db } from '../../common/db/db.service';
import type { TxContext } from '../../common/db/tx-context';
import {
  IdempotenciaService,
  MENSAJE_OTROS_DATOS,
  type PasosConEfectoExterno,
  type SolicitudConEfectoExternoInput,
  type SolicitudIdempotenteInput,
} from './idempotencia.service';

/**
 * Prueba LA RAMA que toma `ejecutar` según lo que contesta la base. La
 * concurrencia, el `ON CONFLICT` y la atomicidad con la venta solo se prueban
 * contra Postgres real: `test/idempotencia-venta.e2e-spec.ts`.
 */
describe('IdempotenciaService', () => {
  const solicitud: SolicitudIdempotenteInput = {
    tenantId: 't1',
    usuarioId: 'u1',
    clave: '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10',
    operacion: 'venta.crear',
    huella: 'h-original',
  };

  let query: jest.Mock;
  let service: IdempotenciaService;
  let managerActivo: unknown;

  beforeEach(() => {
    query = jest.fn();
    const db = {
      transaccion: (fn: () => unknown) => fn(),
      query,
    } as unknown as Db;
    managerActivo = undefined;
    service = new IdempotenciaService(db, {
      managerActivo: () => managerActivo,
    } as unknown as TxContext);
  });

  it('primer intento: corre la operación una vez y guarda su respuesta serializada', async () => {
    // `RETURNING` llega como [rows, rowCount] en pg + TypeORM.
    query.mockResolvedValueOnce([[{ id: 'sol-1' }], 1]);
    query.mockResolvedValueOnce([[], 1]);

    class Respuesta {
      id = 'venta-1';
      @Exclude() secreto = 'no-viaja';
    }
    const operar = jest.fn().mockResolvedValue(new Respuesta());

    const res = await service.ejecutar(
      solicitud,
      operar,
      (r: Respuesta) => r.id,
    );

    expect(operar).toHaveBeenCalledTimes(1);
    expect(res).not.toHaveProperty('repetida');
    const [, params] = query.mock.calls[1] as [string, unknown[]];
    // Lo que se guarda es lo que habría serializado el interceptor global:
    // sin los campos @Exclude.
    expect(JSON.parse(params[0] as string)).toEqual({ id: 'venta-1' });
    expect(params[1]).toBe('venta-1');
    expect(params[2]).toBe('sol-1');
  });

  it('reintento con la misma huella: reproduce sin correr la operación', async () => {
    query.mockResolvedValueOnce([[], 0]);
    query.mockResolvedValueOnce([
      {
        huella: 'h-original',
        respuesta: { id: 'venta-1', estado: 'pagada' },
        venta_id: 'venta-1',
      },
    ]);
    const operar = jest.fn();

    const res = await service.ejecutar(solicitud, operar, () => null);

    expect(operar).not.toHaveBeenCalled();
    expect(res).toEqual({ id: 'venta-1', estado: 'pagada', repetida: true });
  });

  it('reintento con otra huella: 422 con la venta, sin correr la operación', async () => {
    query.mockResolvedValueOnce([[], 0]);
    query.mockResolvedValueOnce([
      { huella: 'h-otra', respuesta: { id: 'venta-1' }, venta_id: 'venta-1' },
    ]);
    const operar = jest.fn();

    const error = await service
      .ejecutar(solicitud, operar, () => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual({
      statusCode: 422,
      message: MENSAJE_OTROS_DATOS,
      ventaId: 'venta-1',
    });
    expect(operar).not.toHaveBeenCalled();
  });

  it('fila sin respuesta: 500, nunca un falso "ya había entrado"', async () => {
    query.mockResolvedValueOnce([[], 0]);
    query.mockResolvedValueOnce([
      { huella: 'h-original', respuesta: null, venta_id: null },
    ]);

    await expect(
      service.ejecutar(solicitud, jest.fn(), () => null),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  /**
   * La variante con efecto externo (ADR-029). Acá se prueba qué paso corre según
   * lo que contesta la base; que el reclamo commitee antes del efecto, el lock
   * del reintento y la concurrencia se prueban contra Postgres:
   * `test/pasarela-reembolso.e2e-spec.ts`.
   */
  describe('ejecutarConEfectoExterno', () => {
    const externa: SolicitudConEfectoExternoInput = {
      tenantId: 't1',
      actor: { usuarioId: 'u1' },
      clave: '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10',
      operacion: 'pasarela.reembolso',
      huella: 'h-original',
      mensajeOtrosDatos: 'Este reembolso ya se había hecho con otros datos',
    };
    const pasos = (): jest.Mocked<
      PasosConEfectoExterno<string, Record<string, unknown>>
    > => ({
      preparar: jest.fn().mockResolvedValue('preparado'),
      efectuar: jest.fn().mockResolvedValue({ respuesta: { ok: 1 } }),
      resolverSinConfirmar: jest
        .fn()
        .mockResolvedValue({ respuesta: { aclarado: 1 } }),
      cuerpoOtrosDatos: jest.fn().mockResolvedValue({ ordenId: 'o1' }),
    });
    const sqlDe = (i: number) => (query.mock.calls[i] as [string])[0];

    it('no se suma a una transacción activa: el commit del reclamo tiene que ser real antes del efecto', async () => {
      managerActivo = {};
      const p = pasos();

      await expect(
        service.ejecutarConEfectoExterno(externa, p),
      ).rejects.toThrow('no puede sumarse a una transacción');
      expect(query).not.toHaveBeenCalled();
      expect(p.efectuar).not.toHaveBeenCalled();
    });

    it('primera vez: reclama, prepara, BLOQUEA el reclamo, efectúa y guarda la respuesta', async () => {
      query.mockResolvedValueOnce([[{ id: 'sol-1' }], 1]); // INSERT
      query.mockResolvedValueOnce([{}]); // FOR UPDATE: la fila está
      query.mockResolvedValueOnce([[], 1]); // UPDATE respuesta
      const p = pasos();

      const r = await service.ejecutarConEfectoExterno(externa, p);

      expect(r).toEqual({ origen: 'efectuada', respuesta: { ok: 1 } });
      expect(p.preparar).toHaveBeenCalledWith('sol-1');
      expect(p.efectuar).toHaveBeenCalledWith('sol-1', 'preparado');
      expect(sqlDe(0)).toContain('ON CONFLICT (tenant_id, usuario_id, clave)');
      expect(sqlDe(1)).toContain('FOR UPDATE');
      expect(query.mock.calls[1][1]).toEqual(['sol-1']);
      expect(sqlDe(2)).toContain('SET respuesta');
    });

    it('la llave de API reclama por su propio índice, no por el de usuario', async () => {
      query.mockResolvedValueOnce([[{ id: 'sol-1' }], 1]);
      query.mockResolvedValue([{}]);

      await service.ejecutarConEfectoExterno(
        { ...externa, actor: { apiKeyId: 'k1' } },
        pasos(),
      );

      expect(sqlDe(0)).toContain(
        '(tenant_id, api_key_id, clave, operacion, huella)',
      );
      expect(sqlDe(0)).toContain('ON CONFLICT (tenant_id, api_key_id, clave)');
      expect(query.mock.calls[0][1]).toEqual([
        't1',
        'k1',
        externa.clave,
        'pasarela.reembolso',
        'h-original',
      ]);
    });

    it('si el reclamo desapareció antes del efecto, no efectúa: 500', async () => {
      query.mockResolvedValueOnce([[{ id: 'sol-1' }], 1]);
      query.mockResolvedValueOnce([]); // FOR UPDATE: no está
      const p = pasos();

      await expect(
        service.ejecutarConEfectoExterno(externa, p),
      ).rejects.toThrow('desapareció');
      expect(sqlDe(1)).toContain('eliminado_el IS NULL');
      expect(p.efectuar).not.toHaveBeenCalled();
    });

    it('soltar: marca el reclamo borrado (la clave queda libre) y lanza ese error', async () => {
      query.mockResolvedValueOnce([[{ id: 'sol-1' }], 1]);
      query.mockResolvedValue([{}]);
      const p = pasos();
      const error = new Error('cambió el disponible');
      p.efectuar.mockResolvedValueOnce({ soltar: error });

      await expect(service.ejecutarConEfectoExterno(externa, p)).rejects.toBe(
        error,
      );
      expect(sqlDe(2)).toContain('SET eliminado_el = NOW()');
    });

    it('ya reclamada con respuesta: reproduce, sin preparar ni efectuar', async () => {
      query.mockResolvedValueOnce([[], 0]);
      query.mockResolvedValueOnce([
        { id: 'sol-1', huella: 'h-original', respuesta: { ok: 1 } },
      ]);
      const p = pasos();

      const r = await service.ejecutarConEfectoExterno(externa, p);

      expect(r).toEqual({
        origen: 'reproducida',
        respuesta: { ok: 1, repetida: true },
      });
      expect(sqlDe(1)).toContain('FOR UPDATE');
      expect(p.preparar).not.toHaveBeenCalled();
      expect(p.efectuar).not.toHaveBeenCalled();
      expect(p.resolverSinConfirmar).not.toHaveBeenCalled();
    });

    it('ya reclamada SIN respuesta: no efectúa de nuevo; resuelve y guarda lo que resolvió', async () => {
      query.mockResolvedValueOnce([[], 0]);
      query.mockResolvedValueOnce([
        { id: 'sol-1', huella: 'h-original', respuesta: null },
      ]);
      query.mockResolvedValueOnce([[], 1]);
      const p = pasos();

      const r = await service.ejecutarConEfectoExterno(externa, p);

      expect(r).toEqual({ origen: 'resuelta', respuesta: { aclarado: 1 } });
      expect(p.efectuar).not.toHaveBeenCalled();
      expect(p.resolverSinConfirmar).toHaveBeenCalledWith('sol-1');
      expect(sqlDe(2)).toContain('SET respuesta');
    });

    it('ya reclamada con otra huella: 422 con el mensaje del llamador y su cuerpo, tenga o no respuesta', async () => {
      query.mockResolvedValueOnce([[], 0]);
      query.mockResolvedValueOnce([
        { id: 'sol-1', huella: 'h-otra', respuesta: null },
      ]);
      const p = pasos();

      const error = await service
        .ejecutarConEfectoExterno(externa, p)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        statusCode: 422,
        message: externa.mensajeOtrosDatos,
        ordenId: 'o1',
      });
      expect(p.resolverSinConfirmar).not.toHaveBeenCalled();
    });

    it('el reclamo se soltó entre el choque y la lectura: vuelve a reclamar', async () => {
      query.mockResolvedValueOnce([[], 0]); // INSERT choca
      query.mockResolvedValueOnce([]); // SELECT: ya no está (se soltó)
      query.mockResolvedValueOnce([[{ id: 'sol-2' }], 1]); // INSERT entra
      query.mockResolvedValue([{}]);
      const p = pasos();

      const r = await service.ejecutarConEfectoExterno(externa, p);

      expect(r.origen).toBe('efectuada');
      expect(p.preparar).toHaveBeenCalledWith('sol-2');
    });
  });
});
