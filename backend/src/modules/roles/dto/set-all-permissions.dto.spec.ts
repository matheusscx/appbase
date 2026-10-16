import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetAllPermissionsDto } from './set-all-permissions.dto';

async function validar(payload: unknown) {
  return validate(plainToInstance(SetAllPermissionsDto, payload));
}

const MODULO = '550e8400-e29b-41d4-a716-446655440100';
const PERMISO = '550e8400-e29b-41d4-a716-446655440200';

describe('SetAllPermissionsDto', () => {
  it('rechaza el body vacío', async () => {
    expect((await validar({})).length).toBeGreaterThan(0);
  });

  it('acepta módulos con permisos, y con la lista vacía (desvincula)', async () => {
    const errores = await validar({
      modulos: [
        { moduloTenantId: MODULO, moduloAppPermisoIds: [PERMISO] },
        { moduloTenantId: MODULO, moduloAppPermisoIds: [] },
      ],
    });
    expect(errores).toHaveLength(0);
  });

  it('rechaza un módulo sin UUID', async () => {
    const errores = await validar({
      modulos: [{ moduloTenantId: 'no-es-uuid', moduloAppPermisoIds: [] }],
    });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza un permiso que no es UUID dentro de un módulo', async () => {
    const errores = await validar({
      modulos: [{ moduloTenantId: MODULO, moduloAppPermisoIds: ['x'] }],
    });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('rechaza un elemento que no es objeto (`[[]]`)', async () => {
    expect((await validar({ modulos: [[]] })).length).toBeGreaterThan(0);
  });
});
