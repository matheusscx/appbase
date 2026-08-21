import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { EscalaMonedaPipe } from './escala-moneda.pipe';
import { EsCosto, EsMontoCobrado } from '../decorators/escala-moneda.decorator';
import { type MonedasService } from '../../modules/monedas/monedas.service';

class DtoDeMonto {
  @EsMontoCobrado()
  monto: string;
}

class DtoDeCosto {
  @EsCosto()
  costoUnitario: string;
}

class DtoSinMarcas {
  monto: string;
}

class LineaDePago {
  @EsMontoCobrado()
  monto: string;
}

class DtoConLineas {
  pagos: LineaDePago[];
}

const meta = (metatype: unknown): ArgumentMetadata =>
  ({ type: 'body', metatype, data: undefined }) as ArgumentMetadata;

function armar(decimales: number) {
  const decimalesOficiales = jest.fn().mockResolvedValue(decimales);
  const monedas = { decimalesOficiales } as unknown as MonedasService;
  const pipe = new EscalaMonedaPipe(monedas, {
    user: {
      id: 'u-1',
      email: 'cajero@tenant.cl',
      tenantId: 'tenant-1',
      esSuperadmin: false,
    },
  });
  return { pipe, decimalesOficiales };
}

const linea = (monto: string): LineaDePago =>
  Object.assign(new LineaDePago(), { monto });

describe('EscalaMonedaPipe', () => {
  it('rechaza un monto con más decimales de los que la moneda admite', async () => {
    const { pipe } = armar(0); // CLP

    await expect(
      pipe.transform({ monto: '1000.5' }, meta(DtoDeMonto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('acepta un entero escrito con ceros a la derecha', async () => {
    // La regla es sobre el VALOR, no sobre la cadena: mil pesos es
    // representable en CLP, y el formato con que se escribió no lo cambia.
    const { pipe } = armar(0); // CLP

    await expect(
      pipe.transform({ monto: '1000.00' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '1000.00' });
  });

  it('acepta dos decimales en una moneda de dos decimales', async () => {
    const { pipe } = armar(2); // USD

    await expect(
      pipe.transform({ monto: '10.55' }, meta(DtoDeMonto)),
    ).resolves.toEqual({ monto: '10.55' });
  });

  it('valida un costo contra la escala 4, no contra la de la moneda', async () => {
    const { pipe, decimalesOficiales } = armar(0); // CLP: 0 decimales

    await expect(
      pipe.transform({ costoUnitario: '5.0000' }, meta(DtoDeCosto)),
    ).resolves.toEqual({ costoUnitario: '5.0000' });
    await expect(
      pipe.transform({ costoUnitario: '5.00001' }, meta(DtoDeCosto)),
    ).rejects.toThrow(BadRequestException);
    // La escala del costo es fija: ni siquiera pregunta por la moneda.
    expect(decimalesOficiales).not.toHaveBeenCalled();
  });

  it('deja pasar intacto un DTO sin campos marcados', async () => {
    const { pipe, decimalesOficiales } = armar(0);

    await expect(
      pipe.transform({ monto: '1000.5' }, meta(DtoSinMarcas)),
    ).resolves.toEqual({ monto: '1000.5' });
    expect(decimalesOficiales).not.toHaveBeenCalled();
  });

  it('alcanza los campos marcados dentro de listas anidadas', async () => {
    const { pipe } = armar(0); // CLP
    const dto = Object.assign(new DtoConLineas(), {
      pagos: [linea('1000'), linea('500.5')],
    });

    await expect(pipe.transform(dto, meta(DtoConLineas))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('pregunta los decimales de la moneda una sola vez por request', async () => {
    const { pipe, decimalesOficiales } = armar(0);
    const dto = Object.assign(new DtoConLineas(), {
      pagos: [linea('1000'), linea('2000'), linea('3000')],
    });

    await pipe.transform(dto, meta(DtoConLineas));
    await pipe.transform({ monto: '10' }, meta(DtoDeMonto));

    expect(decimalesOficiales).toHaveBeenCalledTimes(1);
    expect(decimalesOficiales).toHaveBeenCalledWith('tenant-1');
  });
});
