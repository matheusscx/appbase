import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { DescuentosService } from './descuentos.service';
import { CreateDescuentoDto } from './dto/create-descuento.dto';
import { UpdateDescuentoDto } from './dto/update-descuento.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('descuentos')
export class DescuentosController {
  constructor(private readonly descuentosService: DescuentosService) {}

  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.descuentosService.findAll(user.tenantId);
  }

  // Must be registered BEFORE :id to avoid NestJS resolving 'nombre-disponible' as an id param
  @Get('nombre-disponible')
  nombreDisponible(
    @Req() req: Request,
    @Query('nombre') nombre: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const user = req.user as { tenantId: string };
    return this.descuentosService.nombreDisponible(
      user.tenantId,
      nombre,
      excludeId,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateDescuentoDto) {
    const user = req.user as { tenantId: string };
    return this.descuentosService.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateDescuentoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.descuentosService.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.descuentosService.remove(user.tenantId, id);
  }
}
