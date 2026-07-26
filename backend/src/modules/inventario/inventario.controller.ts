import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { InventarioService } from './inventario.service';
import { FindMovimientosDto } from './dto/find-movimientos.dto';
import { AjusteCostoDto } from './dto/ajuste-costo.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Get('movimientos')
  @RequiresPermiso('Inventario', 'Leer')
  findMovimientos(@Req() req: Request, @Query() query: FindMovimientosDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.findMovimientos(tenantId, query);
  }

  @Post('ajustes-costo')
  @RequiresPermiso('Inventario', 'Actualizar')
  registrarAjusteCosto(@Req() req: Request, @Body() dto: AjusteCostoDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.inventarioService.registrarAjusteCosto(
      tenantId,
      usuarioId,
      dto,
    );
  }
}
