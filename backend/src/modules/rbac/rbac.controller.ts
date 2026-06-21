import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RbacService } from './rbac.service';
import { JwtUser } from '../../common/interfaces/jwt-user.interface';

@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @Get('mis-permisos')
  getMisPermisos(@Request() req: { user: JwtUser }): Promise<string[]> {
    return this.rbacService.getMisPermisos(req.user.id, req.user.tenantId!);
  }

  @Get('es-admin')
  async esAdmin(
    @Request() req: { user: JwtUser },
  ): Promise<{ esAdmin: boolean }> {
    const esAdmin = await this.rbacService.userIsTenantAdmin(
      req.user.id,
      req.user.tenantId!,
    );
    return { esAdmin };
  }
}
