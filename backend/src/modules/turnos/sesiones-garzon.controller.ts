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
import { SesionesGarzonService } from './sesiones-garzon.service';
import { IniciarSesionDto } from './dto/iniciar-sesion.dto';
import { PinDto } from './dto/pin.dto';
import { QuerySesionesDto } from './dto/query-sesiones.dto';

/**
 * Sesiones de trabajo de garzón. Reutiliza el módulo RBAC `Salones`.
 * Rutas estáticas declaradas antes de `/:id/cerrar`.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('sesiones-garzon')
export class SesionesGarzonController {
  constructor(private readonly sesionesService: SesionesGarzonService) {}

  @Post('iniciar')
  @RequiresPermiso('Salones', 'Operar')
  iniciar(@Req() req: Request, @Body() dto: IniciarSesionDto) {
    const user = req.user as { tenantId: string };
    return this.sesionesService.iniciar(user.tenantId, dto);
  }

  @Post('cerrar')
  @RequiresPermiso('Salones', 'Operar')
  cerrar(@Req() req: Request, @Body() dto: PinDto) {
    const user = req.user as { tenantId: string };
    return this.sesionesService.cerrarPorPin(user.tenantId, dto.pin);
  }

  @Post('activa')
  @RequiresPermiso('Salones', 'Operar')
  activa(@Req() req: Request, @Body() dto: PinDto) {
    const user = req.user as { tenantId: string };
    return this.sesionesService.activaPorPin(user.tenantId, dto.pin);
  }

  @Get('abiertas')
  @RequiresPermiso('Salones', 'Leer')
  listarAbiertas(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.sesionesService.listarAbiertas(user.tenantId);
  }

  @Get()
  @RequiresPermiso('Salones', 'Leer')
  historial(@Req() req: Request, @Query() query: QuerySesionesDto) {
    const user = req.user as { tenantId: string };
    return this.sesionesService.historial(user.tenantId, query);
  }

  @Post(':id/cerrar')
  @RequiresPermiso('Salones', 'Actualizar')
  cerrarAdmin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string; id: string };
    return this.sesionesService.cerrarAdmin(user.tenantId, id, user.id);
  }
}
