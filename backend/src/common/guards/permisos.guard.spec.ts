import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermisosGuard } from './permisos.guard';
import {
  RequiresPermiso,
  RequiresAlgunPermiso,
  REQUIRES_PERMISO_KEY,
} from '../decorators/requires-permiso.decorator';
import type { RbacService } from '../../modules/rbac/rbac.service';

/**
 * El guard que sostiene la invariante 6 (permisos con enforcement real en el
 * backend) no tenía spec propia: se probaba de rebote por e2e. Nació con la
 * necesidad de que una ruta acepte MÁS DE UN módulo — la gestión de garzones,
 * que le sirve tanto a Salones como a Propinas.
 */
describe('PermisosGuard', () => {
  const USER = { id: 'user-uuid', tenantId: 'tenant-uuid' };

  function build(metadata: unknown, permitidos: [string, string][]) {
    const reflector = { get: jest.fn().mockReturnValue(metadata) };
    const rbac = {
      userHasPermiso: jest.fn(
        (_u: string, _t: string, modulo: string, permiso: string) =>
          Promise.resolve(
            permitidos.some(([m, p]) => m === modulo && p === permiso),
          ),
      ),
    };
    const ctx = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user: USER }) }),
    };
    const guard = new PermisosGuard(
      reflector as unknown as Reflector,
      rbac as unknown as RbacService,
    );
    return { guard, rbac, ctx: ctx as never };
  }

  /** Lo que el decorador deja en la metadata, sin duplicar su forma acá. */
  function metadataDe(decorador: MethodDecorator): unknown {
    const target = { metodo: () => undefined };
    const descriptor = Object.getOwnPropertyDescriptor(target, 'metodo')!;
    decorador(target, 'metodo', descriptor);
    return Reflect.getMetadata(REQUIRES_PERMISO_KEY, descriptor.value);
  }

  it('deja pasar la ruta sin decorador', async () => {
    const { guard, ctx } = build(undefined, []);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('con un solo par exige ese permiso', async () => {
    const meta = metadataDe(RequiresPermiso('Salones', 'Leer'));
    const ok = build(meta, [['Salones', 'Leer']]);
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);

    const no = build(meta, [['Propinas', 'Leer']]);
    await expect(no.guard.canActivate(no.ctx)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('con alternativas alcanza con tener UNA', async () => {
    // El caso que motivó el cambio: el garzón le sirve a los dos módulos, así
    // que un tenant que contrató Propinas y no Salones tiene que poder
    // gestionarlo — y el que contrató Salones y no Propinas, también.
    const meta = metadataDe(
      RequiresAlgunPermiso(
        { modulo: 'Salones', permiso: 'Leer' },
        { modulo: 'Propinas', permiso: 'Leer' },
      ),
    );

    const soloSalones = build(meta, [['Salones', 'Leer']]);
    await expect(soloSalones.guard.canActivate(soloSalones.ctx)).resolves.toBe(
      true,
    );

    const soloPropinas = build(meta, [['Propinas', 'Leer']]);
    await expect(
      soloPropinas.guard.canActivate(soloPropinas.ctx),
    ).resolves.toBe(true);
  });

  it('con alternativas rechaza cuando no tiene ninguna', async () => {
    const meta = metadataDe(
      RequiresAlgunPermiso(
        { modulo: 'Salones', permiso: 'Leer' },
        { modulo: 'Propinas', permiso: 'Leer' },
      ),
    );
    const { guard, rbac, ctx } = build(meta, [['Ventas', 'Leer']]);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(rbac.userHasPermiso).toHaveBeenCalledTimes(2);
  });

  it('corta en la primera alternativa que da: no consulta de más', async () => {
    // Cada alternativa es una consulta a RBAC. Son pocas y las fija el
    // decorador (no los datos), pero preguntar de más cuando ya se sabe la
    // respuesta es gratis de evitar.
    const meta = metadataDe(
      RequiresAlgunPermiso(
        { modulo: 'Salones', permiso: 'Leer' },
        { modulo: 'Propinas', permiso: 'Leer' },
      ),
    );
    const { guard, rbac, ctx } = build(meta, [['Salones', 'Leer']]);

    await guard.canActivate(ctx);
    expect(rbac.userHasPermiso).toHaveBeenCalledTimes(1);
  });

  it('rechaza sin tenant activo, antes de consultar permisos', async () => {
    const meta = metadataDe(RequiresPermiso('Salones', 'Leer'));
    const reflector = { get: jest.fn().mockReturnValue(meta) };
    const rbac = { userHasPermiso: jest.fn() };
    const ctx = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u' } }) }),
    };
    const guard = new PermisosGuard(
      reflector as unknown as Reflector,
      rbac as unknown as RbacService,
    );

    await expect(guard.canActivate(ctx as never)).rejects.toThrow(
      /No hay tenant activo/,
    );
    expect(rbac.userHasPermiso).not.toHaveBeenCalled();
  });
});
