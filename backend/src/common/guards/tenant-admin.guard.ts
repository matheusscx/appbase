import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { RbacService } from '../../modules/rbac/rbac.service';
import { JwtUser } from '../interfaces/jwt-user.interface';

/**
 * Permite la acción solo si el usuario tiene un rol fijo (Administrador) en el
 * tenant activo. Se usa para proteger la administración de roles/permisos y la
 * asignación de roles a usuarios. Debe ir después de JwtAuthGuard + TenantGuard.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  constructor(private readonly rbacService: RbacService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;
    if (!user?.tenantId)
      throw new ForbiddenException('No hay tenant activo en el token');

    const esAdmin = await this.rbacService.userIsTenantAdmin(
      user.id,
      user.tenantId,
    );
    if (!esAdmin)
      throw new ForbiddenException(
        'Solo un administrador del tenant puede realizar esta acción',
      );

    return true;
  }
}
