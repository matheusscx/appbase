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
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { QueryIncluirEliminadosDto } from '../../common/dto/query-incluir-eliminados.dto';
import { RestaurarDto } from '../../common/dto/restaurar.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
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
  listar(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.turnosService.listar(user.tenantId, query.incluirEliminados);
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
    const user = req.user as JwtUser;
    return this.turnosService.eliminar(user.tenantId!, user.id, id);
  }

  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre que la
  // fila ya tenía, que es como llaman las pantallas sin colisión.
  @Post(':id/restaurar')
  @RequiresPermiso('Salones', 'Eliminar')
  restaurar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RestaurarDto,
  ) {
    const user = req.user as JwtUser;
    return this.turnosService.restaurar(user.tenantId!, id, dto.nombre);
  }
}
