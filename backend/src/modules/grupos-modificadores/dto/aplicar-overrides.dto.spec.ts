import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AplicarOverridesDto } from './aplicar-overrides.dto';

async function validar(payload: Record<string, unknown>) {
  return validate(plainToInstance(AplicarOverridesDto, payload));
}

const base = {
  itemGrupoIds: ['550e8400-e29b-41d4-a716-446655440116'],
  grupoOpcionId: '550e8400-e29b-41d4-a716-446655440117',
};

describe('AplicarOverridesDto', () => {
  it('acepta el payload mínimo sin overrides', async () => {
    const errores = await validar(base);
    expect(errores).toHaveLength(0);
  });

  it('acepta cantidad, unidadCodigo y precioExtra como string vacío (empty→null)', async () => {
    const errores = await validar({
      ...base,
      cantidad: '',
      unidadCodigo: '',
      precioExtra: '',
    });
    expect(errores).toHaveLength(0);
  });

  it('acepta valores numéricos/strings válidos para los overrides', async () => {
    const errores = await validar({
      ...base,
      cantidad: '2',
      unidadCodigo: 'kg',
      precioExtra: '100',
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza cantidad no numérica (distinta de vacío)', async () => {
    const errores = await validar({ ...base, cantidad: 'dos' });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza precioExtra no numérico (distinto de vacío)', async () => {
    const errores = await validar({ ...base, precioExtra: 'gratis' });
    expect(errores.length).toBeGreaterThan(0);
  });

  // Signo: mismo criterio que el `precioExtra` de `items` (no negativo, con el `0`
  // válido — una opción sin recargo es lo más común). Ver
  // `items/dto/dinero-signo.dto.spec.ts` para el porqué de cada campo.
  it('acepta precioExtra en 0 (override a "sin recargo")', async () => {
    const errores = await validar({ ...base, precioExtra: '0' });
    expect(errores).toHaveLength(0);
  });

  it('rechaza precioExtra negativo', async () => {
    const errores = await validar({ ...base, precioExtra: '-100' });
    expect(errores.some((e) => e.property === 'precioExtra')).toBe(true);
  });
});
