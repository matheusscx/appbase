import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { OnlineService } from './online.service';
import { CalcularVentaDto } from '../calculo-precios/dto/calcular.dto';

@ApiTags('online')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('online')
export class OnlineController {
  constructor(private readonly onlineService: OnlineService) {}

  @Post('checkout')
  @RequiresPermiso('Tienda Online', 'Crear')
  async checkout(@Req() req: Request, @Body() dto: CalcularVentaDto) {
    const u = req.user as JwtUser;
    return this.onlineService.checkout(u.tenantId ?? '', dto);
  }
}
