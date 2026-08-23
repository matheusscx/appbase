import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePreferenciasFinancierasDto } from './update-preferencias-financieras.dto';

/**
 * `montoTolerancia` es la tolerancia de descuadre del arqueo, y era el único
 * campo de plata del DTO sin validación de signo: `@IsNumberString()` acepta
 * `'-500'` sin chistar. Una tolerancia negativa no significa nada — el `0` sí
 * (es el default: cero tolerancia), así que la regla es `>= 0` y no `> 0`.
 *
 * La **escala** de este campo la valida `EscalaMonedaPipe` (marca
 * `@EsMontoCobrado()`), que es otra pieza: corre en el borde HTTP, no en
 * `validate()`. Por eso acá no hay ningún caso de decimales — un test que
 * mandara `'1.5'` a `validate()` pasaría en verde sin probar nada del pipe.
 */
const base = {
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  formula: ['descuentos', 'recargos', 'impuestos'],
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  montoTolerancia: '0',
  umbralDescuadreAviso: '0',
  umbralDescuadreAlto: '0',
};

async function propiedadesConError(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(UpdatePreferenciasFinancierasDto, payload);
  return (await validate(dto as object)).map((e) => e.property);
}

describe('UpdatePreferenciasFinancierasDto — montoTolerancia', () => {
  it('acepta 0: el default es "sin tolerancia", no "sin valor"', async () => {
    await expect(propiedadesConError(base)).resolves.toEqual([]);
  });

  it('acepta una tolerancia positiva', async () => {
    await expect(
      propiedadesConError({ ...base, montoTolerancia: '500' }),
    ).resolves.toEqual([]);
  });

  it('rechaza una tolerancia negativa', async () => {
    await expect(
      propiedadesConError({ ...base, montoTolerancia: '-500' }),
    ).resolves.toEqual(['montoTolerancia']);
  });
});

/**
 * Los dos umbrales de descuadre del cierre corren la misma regla de signo que
 * `montoTolerancia` —y por eso comparten este archivo—, pero el `'0'` significa
 * lo CONTRARIO: acá desactiva el nivel, no "cero tolerancia". Que el DTO lo
 * acepte es justamente lo que deja apagar la feature.
 *
 * La relación ENTRE los dos (alto >= aviso) no se valida acá: necesita ver los
 * dos campos juntos, así que vive en `TenantsService` y su test está allá.
 */
describe('UpdatePreferenciasFinancierasDto — umbrales de descuadre', () => {
  it('acepta 0 en los dos: es cómo se deja la feature apagada', async () => {
    await expect(propiedadesConError(base)).resolves.toEqual([]);
  });

  it('acepta umbrales positivos', async () => {
    await expect(
      propiedadesConError({
        ...base,
        umbralDescuadreAviso: '2000',
        umbralDescuadreAlto: '10000',
      }),
    ).resolves.toEqual([]);
  });

  it('rechaza un umbral de aviso negativo', async () => {
    await expect(
      propiedadesConError({ ...base, umbralDescuadreAviso: '-1' }),
    ).resolves.toEqual(['umbralDescuadreAviso']);
  });

  it('rechaza un umbral alto negativo', async () => {
    await expect(
      propiedadesConError({ ...base, umbralDescuadreAlto: '-1' }),
    ).resolves.toEqual(['umbralDescuadreAlto']);
  });
});
