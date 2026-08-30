import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { CreateItemDto } from './create-item.dto';
import { UpdateItemDto } from './update-item.dto';
import { AplicarDesfaseItemDto } from './aplicar-desfases.dto';
import { AjusteStockDto } from './ajuste-stock.dto';

const MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440101';
const GRUPO_ID = '550e8400-e29b-41d4-a716-446655440116';
const OPCION_ID = '550e8400-e29b-41d4-a716-446655440117';

/**
 * Los campos de dinero del módulo no tienen `CHECK` en sus tablas
 * (`startup-pos.sql`), así que el DTO es la única barrera de signo. El barrido de
 * positividad de jul-2026 dejó `@IsDecimalNoNegativo` en ventas, caja y propinas
 * —los tres módulos auditados— y se detuvo en el borde: el catálogo quedó afuera.
 *
 * El criterio es **por campo**, no uniforme: acá los cuatro admiten `0` porque el
 * cero tiene lectura de negocio en cada uno (ver el comentario de cada `describe`).
 * Lo que ninguno admite es el negativo: llega a `totalFinal` o a `costo_actual` sin
 * que ninguna regla lo neutralice.
 */

/** Aplana los `property` de un árbol de errores anidados (`ValidateNested`). */
function propiedadesConError(errores: ValidationError[]): string[] {
  return errores.flatMap((e) => [
    e.property,
    ...propiedadesConError(e.children ?? []),
  ]);
}

const base = {
  nombre: 'Item de prueba',
  monedaId: MONEDA_ID,
  tipo: 'producto',
  unidadMedida: 'unidad',
  modoInventario: 'cantidad',
  precioBase: '1000',
};

describe('precioBase — signo', () => {
  /**
   * El `0` es legítimo y el propio service lo fuerza para los ingredientes
   * (`items.service.ts`, `tipo === 'ingrediente' ? '0'`), así que exigir `> 0`
   * acá tumbaría un caso que el sistema genera solo.
   */
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

/**
 * `costo` es el precio pagado en la carga inicial y entra a `costo_actual`, que es
 * la base del costeo (CPP) y del margen. El `0` es real —mercadería de donación o
 * muestra— y en `UpdateItemDto` el campo no existe como agujero: lo bloquea
 * `CostoNoEditableConstraint`, que rechaza cualquier valor.
 */
describe('costo — signo (solo CreateItemDto)', () => {
  it('acepta costo en 0 (mercadería sin costo de adquisición)', async () => {
    const dto = plainToInstance(CreateItemDto, { ...base, costo: '0' });
    const errores = await validate(dto);
    expect(errores).toHaveLength(0);
  });

  it('rechaza costo negativo', async () => {
    const dto = plainToInstance(CreateItemDto, { ...base, costo: '-500' });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('costo');
  });
});

/**
 * `precioExtra` se suma al precio de la línea (extra de receta u override de opción
 * de grupo). El `0` es el caso más común de todos: un extra gratis o una opción sin
 * recargo — el propio e2e lo manda (`grupos-modificadores-overrides.e2e-spec.ts`).
 */
describe('precioExtra — signo', () => {
  const extra = {
    ingredienteItemId: ITEM_ID,
    cantidad: '1',
    unidadCodigo: 'unidad',
  };
  const grupo = {
    grupoModificadorId: GRUPO_ID,
    min: 0,
    max: 1,
  };

  describe('RecetaExtraInputDto (extrasPermitidos)', () => {
    it('acepta precioExtra en 0 (extra gratis)', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        extrasPermitidos: [{ ...extra, precioExtra: '0' }],
      });
      const errores = await validate(dto);
      expect(errores).toHaveLength(0);
    });

    it('rechaza precioExtra negativo', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        extrasPermitidos: [{ ...extra, precioExtra: '-200' }],
      });
      const errores = await validate(dto);
      expect(propiedadesConError(errores)).toContain('precioExtra');
    });
  });

  describe('ItemGrupoOpcionOverrideInputDto (gruposModificadores[].opciones)', () => {
    it('acepta precioExtra en 0 (opción sin recargo)', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        gruposModificadores: [
          {
            ...grupo,
            opciones: [{ grupoOpcionId: OPCION_ID, precioExtra: '0' }],
          },
        ],
      });
      const errores = await validate(dto);
      expect(errores).toHaveLength(0);
    });

    it('rechaza precioExtra negativo', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        gruposModificadores: [
          {
            ...grupo,
            opciones: [{ grupoOpcionId: OPCION_ID, precioExtra: '-200' }],
          },
        ],
      });
      const errores = await validate(dto);
      expect(propiedadesConError(errores)).toContain('precioExtra');
    });

    // El `@ValidateIf(o => o.precioExtra !== '')` del DTO saltea TODOS los
    // validadores cuando el valor es vacío: es el "no tocar este override" que el
    // frontend manda. Agregar el decorador de signo no debe cambiarlo.
    it('sigue aceptando precioExtra vacío (no-override)', async () => {
      const dto = plainToInstance(CreateItemDto, {
        ...base,
        gruposModificadores: [
          {
            ...grupo,
            opciones: [{ grupoOpcionId: OPCION_ID, precioExtra: '' }],
          },
        ],
      });
      const errores = await validate(dto);
      expect(errores).toHaveLength(0);
    });

    // El mismo DTO anidado lo reusa `UpdateItemDto` vía `gruposModificadores`, así
    // que el decorador tiene que cubrir el PATCH sin tocar `update-item.dto.ts`.
    it('rechaza precioExtra negativo también en UpdateItemDto', async () => {
      const dto = plainToInstance(UpdateItemDto, {
        gruposModificadores: [
          {
            ...grupo,
            opciones: [{ grupoOpcionId: OPCION_ID, precioExtra: '-1' }],
          },
        ],
      });
      const errores = await validate(dto);
      expect(propiedadesConError(errores)).toContain('precioExtra');
    });
  });
});

/**
 * `AplicarDesfaseItemDto.precioBase` no era un agujero funcional: el service ya
 * rechaza `<= 0` a mano, en la validación de `precioBase` con la que abre
 * `ItemsService.aplicarDesfases`. Pero ese chequeo **es condicional a
 * `actualizarPrecio`**, así que el decorador acá no puede ser
 * `IsDecimalPositivo`: rechazaría `{ precioBase: '0', actualizarPrecio: false }`,
 * que hoy se acepta y se ignora. `NoNegativo` mata el negativo sin cambiar el
 * contrato; el `> 0` sigue viviendo en el service, que es quien ve el otro campo.
 */
describe('AplicarDesfaseItemDto.precioBase — signo', () => {
  const RECETA_ID = '550e8400-e29b-41d4-a716-446655440102';

  it('acepta precioBase en 0 sin actualizarPrecio (el service lo ignora)', async () => {
    const dto = plainToInstance(AplicarDesfaseItemDto, {
      itemId: RECETA_ID,
      actualizarPrecio: false,
      precioBase: '0',
    });
    const errores = await validate(dto);
    expect(errores).toHaveLength(0);
  });

  it('acepta precioBase ausente (solo recalcular costo)', async () => {
    const dto = plainToInstance(AplicarDesfaseItemDto, {
      itemId: RECETA_ID,
    });
    const errores = await validate(dto);
    expect(errores).toHaveLength(0);
  });

  it('rechaza precioBase negativo', async () => {
    const dto = plainToInstance(AplicarDesfaseItemDto, {
      itemId: RECETA_ID,
      actualizarPrecio: true,
      precioBase: '-1000',
    });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('precioBase');
  });
});

/**
 * `AjusteStockDto.costoUnitario` es lo que se PAGÓ en una entrada: alimenta el
 * promedio ponderado y se congela en el kardex. Admite `0` desde el 2026-08-29
 * (decisión del owner): la mercadería de donación o muestra entra con costo 0 de
 * verdad, igual que el `costo` de `CreateItemDto` de más arriba. Ausente sigue
 * significando "no sé cuánto costó" y no toca el CPP — el `0` sí lo mueve.
 *
 * El que NO admite `0` es `AjusteCostoDto.costoNuevo` (`inventario/dto/`): ahí el
 * cero anularía el promedio en vez de informarlo, y su comentario lo dice.
 */
describe('AjusteStockDto.costoUnitario — signo', () => {
  const entrada = { cantidad: '10', tipo: 'entrada', motivo: 'compra' };

  it('acepta costoUnitario en 0 (entrada de mercadería donada)', async () => {
    const dto = plainToInstance(AjusteStockDto, {
      ...entrada,
      costoUnitario: '0',
    });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).not.toContain('costoUnitario');
  });

  it('acepta costoUnitario ausente (compra sin costo declarado)', async () => {
    const dto = plainToInstance(AjusteStockDto, entrada);
    const errores = await validate(dto);
    expect(errores).toHaveLength(0);
  });

  it('rechaza costoUnitario negativo', async () => {
    const dto = plainToInstance(AjusteStockDto, {
      ...entrada,
      costoUnitario: '-1',
    });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('costoUnitario');
  });

  // La cantidad no se aflojó junto con el costo: un movimiento de 0 unidades no
  // mueve nada, y el único que registra cantidad 0 es el `ajuste_costo`, que no
  // pasa por este DTO.
  it('sigue rechazando cantidad en 0', async () => {
    const dto = plainToInstance(AjusteStockDto, { ...entrada, cantidad: '0' });
    const errores = await validate(dto);
    expect(propiedadesConError(errores)).toContain('cantidad');
  });
});
