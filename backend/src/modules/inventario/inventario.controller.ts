import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { SetStockMinimoDto } from './dto/set-stock-minimo.dto';

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

  /**
   * El bloque "Stock bajo" del inicio. Ruta propia y no un campo de
   * `/resumen-negocio/hoy`, que pide otro permiso (`Resumen del negocio:Leer`):
   * juntarlos le daría el dato a quien no debe verlo, o se lo escondería a
   * quien sí (spec § 3.1).
   */
  @Get('stock-bajo/resumen')
  @RequiresPermiso('Inventario', 'Leer')
  resumenStockBajo(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.resumenStockBajo(tenantId);
  }

  /**
   * Carga (o, con `minimo: null`, limpia) el mínimo de un producto en una
   * ubicación. `Inventario:Actualizar` y no `Items:Actualizar`: es política de
   * reabastecimiento, como `ajustes-costo` —quien edita el catálogo no es
   * necesariamente quien decide cuánto stock hace falta— (spec § 4).
   */
  @Put('stock-minimo/:itemId/:ubicacionId')
  @RequiresPermiso('Inventario', 'Actualizar')
  setStockMinimo(
    @Req() req: Request,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('ubicacionId', ParseUUIDPipe) ubicacionId: string,
    @Body() dto: SetStockMinimoDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.inventarioService.setMinimo(
      tenantId,
      itemId,
      ubicacionId,
      dto.minimo,
    );
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
