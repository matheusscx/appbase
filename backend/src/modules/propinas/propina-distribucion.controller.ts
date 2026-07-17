import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { PropinaDistribucionService } from './propina-distribucion.service';
import { UpdateDistribucionDto } from './dto/update-distribucion.dto';

@ApiTags('propinas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('propinas')
export class PropinaDistribucionController {
  constructor(private readonly distribucion: PropinaDistribucionService) {}

  @Get('distribucion')
  @RequiresPermiso('Propinas', 'Leer')
  obtener(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.distribucion.obtener(user.tenantId!);
  }

  @Put('distribucion')
  @RequiresPermiso('Propinas', 'Configurar')
  reemplazar(@Req() req: Request, @Body() dto: UpdateDistribucionDto) {
    const user = req.user as JwtUser;
    return this.distribucion.reemplazar(user.tenantId!, user.id, dto);
  }
}
