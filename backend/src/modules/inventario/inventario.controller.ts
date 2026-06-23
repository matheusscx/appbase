import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InventarioService } from './inventario.service';
import { FindMovimientosDto } from './dto/find-movimientos.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('movimientos')
  findMovimientos(@Req() req: Request, @Query() query: FindMovimientosDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.findMovimientos(tenantId, query);
  }
}
