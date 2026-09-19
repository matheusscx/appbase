import {
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Exclude } from 'class-transformer';
import { Db } from '../../common/db/db.service';
import {
  IdempotenciaService,
  MENSAJE_OTROS_DATOS,
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

  beforeEach(() => {
    query = jest.fn();
    const db = {
      transaccion: (fn: () => unknown) => fn(),
      query,
    } as unknown as Db;
    service = new IdempotenciaService(db);
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
});
