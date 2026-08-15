import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetPermissionsDto } from './set-permissions.dto';

async function validar(payload: unknown) {
  return validate(plainToInstance(SetPermissionsDto, payload));
}

const PERMISO = '550e8400-e29b-41d4-a716-446655440200';

describe('SetPermissionsDto', () => {
  // El bug medido: `PUT {}` llegaba a `moduloAppPermisoIds.length` sobre
  // `undefined` porque nada validaba el body (interfaz TS inline, no DTO).
  it('rechaza el body vacío', async () => {
    const errores = await validar({});
    expect(errores.some((e) => e.property === 'moduloAppPermisoIds')).toBe(
      true,
    );
  });

  it('rechaza moduloAppPermisoIds que no sea un array', async () => {
    const errores = await validar({ moduloAppPermisoIds: 'no-es-un-array' });
    expect(errores.some((e) => e.property === 'moduloAppPermisoIds')).toBe(
      true,
    );
  });

  it('rechaza un elemento que no es UUID', async () => {
    const errores = await validar({ moduloAppPermisoIds: ['no-es-uuid'] });
    expect(errores.some((e) => e.property === 'moduloAppPermisoIds')).toBe(
      true,
    );
  });

  it('acepta una lista de UUIDs', async () => {
    const errores = await validar({ moduloAppPermisoIds: [PERMISO] });
    expect(errores).toHaveLength(0);
  });

  // Array vacío es válido a propósito: es el "desvincular el rol del módulo"
  // (mismo patrón que `SetCajonUsuariosDto`), no un olvido de `@ArrayNotEmpty()`.
  it('acepta un array vacío (desvincular el rol del módulo)', async () => {
    const errores = await validar({ moduloAppPermisoIds: [] });
    expect(errores).toHaveLength(0);
  });
});
