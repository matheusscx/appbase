import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrearProveedorCompraDto } from '../../compras/dto/crear-proveedor-compra.dto';
import { CreateTerceroDto } from './create-tercero.dto';
import { UpdateTerceroDto } from './update-tercero.dto';

/**
 * Cada DTO que escribe `terceros.rut` lleva `@RutChileno()` (06.16). Un DTO que
 * lo pierda deja pasar un RUT con DV malo; el e2e lo ve también, pero este spec
 * corre en `npm test`. El detalle de la regla: `rut-chileno.decorator.spec.ts`.
 */
const base = { nombre: 'Proveedor', tipo: 'proveedor' };

describe.each([
  ['CreateTerceroDto', CreateTerceroDto, ['rut', 'rutFiscal']],
  ['UpdateTerceroDto', UpdateTerceroDto, ['rut', 'rutFiscal']],
  ['CrearProveedorCompraDto', CrearProveedorCompraDto, ['rut']],
] as const)('%s', (_n, Dto, campos) => {
  const cuerpo = (extra: object) =>
    plainToInstance(
      Dto as new () => object,
      Dto === CrearProveedorCompraDto
        ? { nombre: 'P', ...extra }
        : { ...base, ...extra },
    );

  it.each(campos)(
    '%s: DV malo se rechaza y uno válido se normaliza',
    async (campo) => {
      expect(await validate(cuerpo({ [campo]: '76.543.210-5' }))).toHaveLength(
        1,
      );
      const ok = cuerpo({ [campo]: '76.543.210-3' });
      expect(await validate(ok)).toHaveLength(0);
      expect((ok as Record<string, unknown>)[campo]).toBe('76543210-3');
    },
  );
});
