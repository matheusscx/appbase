import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRES_PERMISO_KEY } from '../decorators/requires-permiso.decorator';
import { JwtUser } from '../interfaces/jwt-user.interface';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Placeholder — implementación real en Fase 5 con RbacService
    const permiso = this.reflector.get<
      { modulo: string; permiso: string } | undefined
    >(REQUIRES_PERMISO_KEY, context.getHandler());
    if (!permiso) return true; // sin metadata = ruta pública
    // Por ahora: permitir todo si hay tenantId (se restringirá en Fase 5)
    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    return !!request.user?.tenantId;
  }
}
