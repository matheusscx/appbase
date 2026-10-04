import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolverReembolsoDto } from './resolver-reembolso.dto';

const validar = (payload: Record<string, unknown>) =>
  validate(plainToInstance(ResolverReembolsoDto, payload));

describe('ResolverReembolsoDto', () => {
  it('"Salió" exige el código de autorización del portal', async () => {
    expect(await validar({ salio: true })).not.toHaveLength(0);
    expect(
      await validar({ salio: true, codigoAutorizacion: '' }),
    ).not.toHaveLength(0);
    expect(
      await validar({ salio: true, codigoAutorizacion: '12 34' }),
    ).not.toHaveLength(0);
    expect(
      await validar({ salio: true, codigoAutorizacion: '1213' }),
    ).toHaveLength(0);
  });

  it('"No salió" no lo pide', async () => {
    expect(await validar({ salio: false })).toHaveLength(0);
  });

  it('salio tiene que ser booleano', async () => {
    expect(await validar({ salio: 'si' })).not.toHaveLength(0);
  });
});
