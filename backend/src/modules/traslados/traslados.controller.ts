import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { TrasladosService } from './traslados.service';
import { CreateTrasladoDto } from './dto/create-traslado.dto';

/**
 * Se reusa `Inventario/Crear` en vez de inventar `Inventario/Trasladar`: el
 * traslado es un solo acto y no tiene el paso de aprobación que justificó
 * separar permisos en el recuento (`docs/features/bodegas-y-traslados.md`,
 * «POST /traslados»).
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('traslados')
export class TrasladosController {
  constructor(private readonly trasladosService: TrasladosService) {}

  @Get()
  @RequiresPermiso('Inventario', 'Leer')
  findAll(@Req() req: Request, @Query() query: PaginationQueryDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.trasladosService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequiresPermiso('Inventario', 'Leer')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.trasladosService.findOne(tenantId, id);
  }

  @Post()
  @RequiresPermiso('Inventario', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateTrasladoDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.trasladosService.crear(tenantId, usuarioId, dto);
  }
}
