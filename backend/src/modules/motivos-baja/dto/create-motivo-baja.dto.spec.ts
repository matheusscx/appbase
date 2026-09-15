import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMotivoBajaDto } from './create-motivo-baja.dto';
import { TipoMotivoBaja } from '../tipo-motivo-baja.enum';

/**
 * `tipo` es obligatorio al crear (el admin lo elige, sin default): a
 * diferencia de `UpdateMotivoBajaDto` no lleva `@ValidateIf`, así que ausente
 * también es error — no solo un valor fuera del enum.
 */
async function errores(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateMotivoBajaDto, payload);
  const res = await validate(dto as object);
  return res.map((e) => e.property);
}

describe('CreateMotivoBajaDto — tipo', () => {
  it('ausente es error: no hay default', async () => {
    await expect(errores({ nombre: 'Rotura' })).resolves.toEqual(['tipo']);
  });

  it('rechaza un valor fuera del enum', async () => {
    await expect(errores({ nombre: 'Rotura', tipo: 'otro' })).resolves.toEqual([
      'tipo',
    ]);
  });

  it.each([
    TipoMotivoBaja.MERMA,
    TipoMotivoBaja.CORTESIA,
    TipoMotivoBaja.NO_ELABORADO,
  ])('acepta el valor del enum %s', async (tipo) => {
    await expect(errores({ nombre: 'Rotura', tipo })).resolves.toEqual([]);
  });
});
