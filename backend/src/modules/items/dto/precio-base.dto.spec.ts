import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemDto } from './create-item.dto';
import { UpdateItemDto } from './update-item.dto';

const MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

/**
 * `precio_base` es dinero y no tiene `CHECK` en la tabla (`startup-pos.sql`), así
 * que el DTO es la única barrera. El barrido de positividad de jul-2026 dejó
 * `@IsDecimalNoNegativo` en ventas, caja y propinas —los tres módulos auditados—
 * y se detuvo en el borde: el catálogo quedó afuera.
 *
 * El criterio es **no negativo, no positivo**: el `0` es legítimo y el propio
 * service lo fuerza para los ingredientes (`items.service.ts`, `tipo ===
 * 'ingrediente' ? '0'`), así que exigir `> 0` acá tumbaría un caso que el sistema
 * genera solo. Lo que no tiene lectura posible es un precio negativo: el motor
 * llega a `totalFinal: -100` con `precioUnitario: '-100'` y ninguna regla lo
 * neutraliza.
 */
describe('precioBase — signo', () => {
  const base = {
    nombre: 'Item de prueba',
    monedaId: MONEDA_ID,
    tipo: 'producto',
    unidadMedida: 'unidad',
    modoInventario: 'cantidad',
  };

  describe('CreateItemDto', () => {
    it('acepta precioBase en 0 (el service lo fuerza para ingredientes)', async () => {
      const dto = plainToInstance(CreateItemDto, { ...base, precioBase: '0' });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(false);
    });

    it('acepta precioBase con decimales', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        precioBase: '1500.5000',
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(false);
    });

    it('rechaza precioBase negativo', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        precioBase: '-100',
      });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(true);
    });
  });

  describe('UpdateItemDto', () => {
    it('acepta precioBase ausente (PATCH parcial)', async () => {
      const dto = plainToInstance(UpdateItemDto, { nombre: 'Otro nombre' });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(false);
    });

    it('acepta precioBase en 0', async () => {
      const dto = plainToInstance(UpdateItemDto, { precioBase: '0' });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(false);
    });

    it('rechaza precioBase negativo', async () => {
      const dto = plainToInstance(UpdateItemDto, { precioBase: '-0.01' });
      const errores = await validate(dto);
      expect(errores.some((e) => e.property === 'precioBase')).toBe(true);
    });
  });
});
