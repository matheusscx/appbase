import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AjusteStockDto } from './dto/ajuste-stock.dto';
import { QueryItemsDto } from './dto/query-items.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequiresPermiso('Items', 'Leer')
  findAll(@Req() req: Request, @Query() query: QueryItemsDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequiresPermiso('Items', 'Leer')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findOne(tenantId, id);
  }

  @Post()
  @RequiresPermiso('Items', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateItemDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.create(tenantId, usuarioId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Items', 'Actualizar')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Items', 'Eliminar')
  remove(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.remove(tenantId, id);
  }

  @Patch(':id/stock')
  @RequiresPermiso('Items', 'Actualizar')
  ajustarStock(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AjusteStockDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.ajustarStock(tenantId, usuarioId, id, dto);
  }

  @Get(':id/unidades')
  @RequiresPermiso('Items', 'Leer')
  findUnidades(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('estado') estado?: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findUnidades(tenantId, id, estado);
  }

  @Get(':id/lotes')
  @RequiresPermiso('Items', 'Leer')
  findLotes(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findLotes(tenantId, id);
  }
}
