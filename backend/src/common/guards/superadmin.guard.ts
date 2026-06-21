import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtUser } from '../interfaces/jwt-user.interface';

@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    return request.user?.esSuperadmin === true;
  }
}
