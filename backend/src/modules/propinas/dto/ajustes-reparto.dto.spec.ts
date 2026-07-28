import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AjustesRepartoDto } from './ajustes-reparto.dto';
import { UpdateLiquidacionDto } from './update-liquidacion.dto';

const GARZON = '550e8400-e29b-41d4-a716-446655440238';

/**
 * Los dos `monto` manuales quedaron fuera del barrido de signo de `74f3f35`.
 * El `CHECK` de BD (`chk_liquidacion_participante_metricas`) igual impedía
 * persistir un negativo, pero salía como 500 crudo — y el **preview**, que no
 * persiste, devolvía la propina negativa en pantalla sin tocar la BD.
 */
describe('signo de los montos manuales de propina', () => {
  async function erroresDe(dto: object): Promise<string[]> {
    const errores = await validate(dto as never);
    return errores.flatMap((e) => Object.keys(e.constraints ?? {}));
  }

  it('AjustesRepartoDto rechaza un monto negativo', async () => {
    const dto = plainToInstance(AjustesRepartoDto, {
      montosManuales: [{ garzonId: GARZON, monto: '-5000' }],
    });
    const errores = await validate(dto);
    expect(errores).not.toHaveLength(0);
  });

  it('AjustesRepartoDto acepta 0 y positivos', async () => {
    for (const monto of ['0', '5000.5000']) {
      const dto = plainToInstance(AjustesRepartoDto, {
        montosManuales: [{ garzonId: GARZON, monto }],
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    }
  });

  it('UpdateLiquidacionDto rechaza un monto negativo por participante', async () => {
    const dto = plainToInstance(UpdateLiquidacionDto, {
      participantes: [{ id: GARZON, monto: '-1' }],
    });
    const errores = await validate(dto);
    expect(errores).not.toHaveLength(0);
  });

  it('UpdateLiquidacionDto acepta un monto positivo', async () => {
    const dto = plainToInstance(UpdateLiquidacionDto, {
      participantes: [{ id: GARZON, monto: '1200.0000' }],
    });
    await expect(erroresDe(dto)).resolves.toEqual([]);
  });
});
