import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRES_PERMISO_KEY,
  type ParPermiso,
} from '../decorators/requires-permiso.decorator';
import { RbacService } from '../../modules/rbac/rbac.service';
import { JwtUser } from '../interfaces/jwt-user.interface';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const alternativas = this.reflector.get<ParPermiso[] | undefined>(
      REQUIRES_PERMISO_KEY,
      context.getHandler(),
    );
    if (!alternativas?.length) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;
    if (!user?.tenantId) throw new ForbiddenException('No hay tenant activo');

    // Alcanza con UNA. El `for` y no un `Promise.all`: corta en la primera que
    // da, y la lista la fija el decorador (dos, hoy), nunca los datos — así que
    // no es un N+1 escondido.
    for (const alternativa of alternativas) {
      const tiene = await this.rbacService.userHasPermiso(
        user.id,
        user.tenantId,
        alternativa.modulo,
        alternativa.permiso,
      );
      if (tiene) return true;
    }
    throw new ForbiddenException('No tienes permiso para esta acción');
  }
}
