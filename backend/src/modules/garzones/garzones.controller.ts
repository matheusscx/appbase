import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { GarzonesService } from './garzones.service';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { IdentificarDto } from './dto/identificar.dto';

/**
 * Gestión de garzones. Reutiliza el módulo RBAC `Salones`: el CRUD de
 * administración usa las acciones Leer/Crear/Actualizar/Eliminar; la
 * identificación operativa por PIN usa `Operar`.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('garzones')
export class GarzonesController {
  constructor(private readonly garzonesService: GarzonesService) {}

  @Get()
  @RequiresPermiso('Salones', 'Leer')
  listar(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.listar(user.tenantId);
  }

  @Post()
  @RequiresPermiso('Salones', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateGarzonDto) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.crear(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Salones', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateGarzonDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.actualizar(user.tenantId, id, dto);
  }

  /** Regenera el PIN del garzón y lo devuelve una sola vez. */
  @Patch(':id/pin')
  @RequiresPermiso('Salones', 'Actualizar')
  regenerarPin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.regenerarPin(user.tenantId, id);
  }

  @Delete(':id')
  @RequiresPermiso('Salones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.eliminar(user.tenantId, id);
  }

  /** Identifica al garzón por su PIN (para feedback en la UI del garzón). */
  @Post('identificar')
  @RequiresPermiso('Salones', 'Operar')
  async identificar(@Req() req: Request, @Body() dto: IdentificarDto) {
    const user = req.user as { tenantId: string };
    const garzon = await this.garzonesService.resolverGarzonPorPin(
      user.tenantId,
      dto.pin,
    );
    return { garzonId: garzon.id, nombre: garzon.nombre };
  }
}
