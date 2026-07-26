import {
  Body,
  Controller,
  Get,
  Param,
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
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RecuentosService } from './recuentos.service';
import { CreateRecuentoDto } from './dto/create-recuento.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('recuentos')
export class RecuentosController {
  constructor(private readonly recuentosService: RecuentosService) {}

  @Post()
  @RequiresPermiso('Inventario', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateRecuentoDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.recuentosService.create(tenantId, usuarioId, dto);
  }

  @Get()
  @RequiresPermiso('Inventario', 'Leer')
  findAll(@Req() req: Request, @Query() query: PaginationQueryDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequiresPermiso('Inventario', 'Leer')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.findOne(tenantId, id);
  }
}
