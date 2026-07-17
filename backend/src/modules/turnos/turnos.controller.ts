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
import { TurnosService } from './turnos.service';
import { CreateTurnoDto } from './dto/create-turno.dto';
import { UpdateTurnoDto } from './dto/update-turno.dto';

/**
 * Catálogo de turnos referenciales. Reutiliza el módulo RBAC `Salones`.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('turnos')
export class TurnosController {
  constructor(private readonly turnosService: TurnosService) {}

  @Get()
  @RequiresPermiso('Salones', 'Leer')
  listar(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.turnosService.listar(user.tenantId);
  }

  @Post()
  @RequiresPermiso('Salones', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateTurnoDto) {
    const user = req.user as { tenantId: string };
    return this.turnosService.crear(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Salones', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTurnoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.turnosService.actualizar(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Salones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.turnosService.eliminar(user.tenantId, id);
  }
}
