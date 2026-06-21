import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';

interface AuthenticatedRequest {
  user?: {
    esSuperadmin?: boolean;
  };
}

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user?.esSuperadmin === true;
  }
}
