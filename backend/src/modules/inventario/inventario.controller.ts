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
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { InventarioService } from './inventario.service';
import { FindMovimientosDto } from './dto/find-movimientos.dto';
import { AjusteCostoDto } from './dto/ajuste-costo.dto';
import { FindStockMinimoDto } from './dto/find-stock-minimo.dto';

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

  /**
   * El listado del aviso de stock bajo. `Inventario:Leer` y no `Items:Leer`:
   * la marca es información de inventario, y viaja sola en su propia ruta
   * para que el catálogo no la exponga a quien no tiene este permiso.
   */
  @Get('stock-minimo')
  @RequiresPermiso('Inventario', 'Leer')
  findStockMinimo(@Req() req: Request, @Query() query: FindStockMinimoDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.findStockMinimo(tenantId, query);
  }

  @Post('ajustes-costo')
  @RequiresPermiso('Inventario', 'Actualizar')
  registrarAjusteCosto(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: AjusteCostoDto,
  ) {
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
