import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

interface AuthenticatedRequest {
  user?: {
    tenantId?: string;
  };
}

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return !!request.user?.tenantId;
  }
}
