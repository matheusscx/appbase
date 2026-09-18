import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { ResumenNegocioService } from './resumen-negocio.service';

@ApiTags('resumen-negocio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('resumen-negocio')
export class ResumenNegocioController {
  constructor(private readonly resumenNegocioService: ResumenNegocioService) {}

  /**
   * Módulo propio `Resumen del negocio` y no `Ventas:Leer` (spec
   * 2026-09-18-dashboard-inicio § 2): la cajera tiene `Ventas:Leer` para
   * buscar una boleta y reimprimirla, y con ese permiso también vería cuánto
   * factura el local. Sin parámetros: `tenantId` sale del token, nunca de la
   * query.
   */
  @Get('hoy')
  @RequiresPermiso('Resumen del negocio', 'Leer')
  async hoy(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.resumenNegocioService.hoy(user.tenantId!);
  }
}
