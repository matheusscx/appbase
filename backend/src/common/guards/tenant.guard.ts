import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { UsuarioTenant } from '../../modules/tenants/entities/usuario-tenant.entity';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';
import { JwtUser } from '../interfaces/jwt-user.interface';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;
    if (!user?.tenantId)
      throw new ForbiddenException('No hay tenant activo en el token');
    const membership = await this.usuarioTenantRepo.findOne({
      where: {
        usuarioId: user.id,
        tenantId: user.tenantId,
        eliminadoEl: IsNull(),
      },
    });
    if (!membership)
      throw new ForbiddenException('No perteneces a este tenant');

    // Verify the tenant exists and is not soft-deleted
    const tenant = await this.tenantRepo.findOne({
      where: { id: user.tenantId },
    });
    if (!tenant)
      throw new ForbiddenException('El tenant no existe o fue eliminado');

    return true;
  }
}
