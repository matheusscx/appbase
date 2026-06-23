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
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AjusteStockDto } from './dto/ajuste-stock.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query('tipo') tipo?: string,
    @Query('categoriaId') categoriaId?: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findAll(tenantId, tipo, categoriaId);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findOne(tenantId, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateItemDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.create(tenantId, usuarioId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.update(tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.remove(tenantId, id);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id/stock')
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
}
