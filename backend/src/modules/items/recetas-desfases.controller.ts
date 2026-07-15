import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ItemsService } from './items.service';
import { QueryDesfasesDto } from './dto/query-desfases.dto';
import { AplicarDesfasesDto } from './dto/aplicar-desfases.dto';
import { DescartarDesfasesDto } from './dto/descartar-desfases.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('recetas')
export class RecetasDesfasesController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get('desfases')
  @RequiresPermiso('Items', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.listarDesfases(tenantId, query.ingredienteItemId);
  }

  @Post('desfases/aplicar')
  @RequiresPermiso('Items', 'Actualizar')
  aplicar(@Req() req: Request, @Body() dto: AplicarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.aplicarDesfases(tenantId, dto.items);
  }

  @Post('desfases/descartar')
  @RequiresPermiso('Items', 'Actualizar')
  descartar(@Req() req: Request, @Body() dto: DescartarDesfasesDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.descartarDesfases(tenantId, dto.recetaItemIds);
  }
}
