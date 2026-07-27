import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { RecuentosService } from './recuentos.service';
import { CreateRecuentoDto } from './dto/create-recuento.dto';
import { UpdateRecuentoDto } from './dto/update-recuento.dto';
import { UpdateRecuentoLineaDto } from './dto/update-recuento-linea.dto';
import { FindRecuentosDto } from './dto/find-recuentos.dto';

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
  findAll(@Req() req: Request, @Query() query: FindRecuentosDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequiresPermiso('Inventario', 'Leer')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.findOne(tenantId, id);
  }

  @Patch(':id/lineas/:lineaId')
  @RequiresPermiso('Inventario', 'Crear')
  updateLinea(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineaId') lineaId: string,
    @Body() dto: UpdateRecuentoLineaDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.updateLinea(tenantId, id, lineaId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Inventario', 'Crear')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateRecuentoDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.update(tenantId, id, dto);
  }

  @Post(':id/cancelar')
  @RequiresPermiso('Inventario', 'Crear')
  cancelar(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.recuentosService.cancelar(tenantId, id);
  }

  // Distinto del 'Crear' que usan contar/cargar conteos: aplicar mueve stock
  // real, es deliberadamente un permiso separado (quien cuenta no es
  // necesariamente quien aprueba).
  @Post(':id/aplicar')
  @RequiresPermiso('Inventario', 'Actualizar')
  aplicar(@Req() req: Request, @Param('id') id: string) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.recuentosService.aplicar(tenantId, usuarioId, id);
  }
}
