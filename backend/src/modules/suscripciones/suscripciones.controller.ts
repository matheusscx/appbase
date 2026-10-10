import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ClaveIdempotencia } from '../../common/decorators/clave-idempotencia.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { SuscripcionesService } from './suscripciones.service';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';
import { CambiarTarjetaDto } from './dto/cambiar-tarjeta.dto';

@ApiTags('suscripciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('suscripciones')
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}

  // ── Administración (módulo RBAC "Suscripciones") ──────────────────────────

  @Get('admin')
  @RequiresPermiso('Suscripciones', 'Leer')
  findTodas(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.findTodas(u.tenantId ?? '');
  }

  @Patch('admin/:id')
  @RequiresPermiso('Suscripciones', 'Actualizar')
  cambiarEstadoAdmin(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuscripcionDto,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.cambiarEstado(
      u.tenantId ?? '',
      null,
      id,
      dto,
    );
  }

  @Delete('admin/:id')
  @RequiresPermiso('Suscripciones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.eliminar(u.tenantId ?? '', id);
  }

  // ── Suscripciones propias del usuario (nivel Tienda Online) ───────────────

  @Post()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'UUID por intento de alta: el reintento con la misma clave no vuelve a cobrar (ADR-029)',
  })
  crear(
    @Req() req: Request,
    @Body() dto: CreateSuscripcionDto,
    @ClaveIdempotencia() clave: string,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.crear(u.tenantId ?? '', u.id, dto, clave);
  }

  @Get()
  findMias(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.findMias(u.tenantId ?? '', u.id);
  }

  @Patch(':id')
  cambiarEstado(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSuscripcionDto,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.cambiarEstado(
      u.tenantId ?? '',
      u.id,
      id,
      dto,
    );
  }

  @Patch(':id/tarjeta')
  cambiarTarjeta(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarTarjetaDto,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.cambiarTarjeta(
      u.tenantId ?? '',
      u.id,
      id,
      dto.inscripcionId,
    );
  }
}
