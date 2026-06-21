import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_PERMISO_KEY } from '../decorators/requires-permiso.decorator';
import { RbacService } from '../../modules/rbac/rbac.service';
import { JwtUser } from '../interfaces/jwt-user.interface';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permiso = this.reflector.get<{ modulo: string; permiso: string }>(
      REQUIRES_PERMISO_KEY,
      context.getHandler(),
    );
    if (!permiso) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;
    if (!user?.tenantId) throw new ForbiddenException('No hay tenant activo');

    const hasPermiso = await this.rbacService.userHasPermiso(
      user.id,
      user.tenantId,
      permiso.modulo,
      permiso.permiso,
    );
    if (!hasPermiso)
      throw new ForbiddenException('No tienes permiso para esta acción');
    return true;
  }
}
