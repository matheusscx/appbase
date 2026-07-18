import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnularLiquidacionDto } from './dto/anular-liquidacion.dto';
import { CreateLiquidacionDto } from './dto/create-liquidacion.dto';
import { LiquidarDto } from './dto/liquidar.dto';
import { PreviewLiquidacionDto } from './dto/preview-liquidacion.dto';
import { UpdateLiquidacionDto } from './dto/update-liquidacion.dto';
import { LiquidacionPropinasService } from './liquidacion-propinas.service';

@ApiTags('propinas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('propinas/liquidaciones')
export class LiquidacionPropinasController {
  constructor(private readonly liquidaciones: LiquidacionPropinasService) {}

  @Post()
  @RequiresPermiso('Propinas', 'Liquidar')
  crear(@Req() req: Request, @Body() dto: CreateLiquidacionDto) {
    const user = req.user as JwtUser;
    return this.liquidaciones.crear(user.tenantId!, user.id, dto);
  }

  @Post('preview')
  @RequiresPermiso('Propinas', 'Leer')
  preview(@Req() req: Request, @Body() dto: PreviewLiquidacionDto) {
    const user = req.user as JwtUser;
    return this.liquidaciones.computarReparto(
      user.tenantId!,
      new Date(dto.fechaDesde),
      new Date(dto.fechaHasta),
      dto.turnoIds ?? [],
      dto.ajustes,
    );
  }

  @Post('liquidar')
  @RequiresPermiso('Propinas', 'Liquidar')
  liquidar(@Req() req: Request, @Body() dto: LiquidarDto) {
    const user = req.user as JwtUser;
    return this.liquidaciones.liquidar(user.tenantId!, user.id, dto);
  }

  @Get()
  @RequiresPermiso('Propinas', 'Leer')
  listar(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.liquidaciones.listar(user.tenantId!);
  }

  @Get(':id')
  @RequiresPermiso('Propinas', 'Leer')
  detalle(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.liquidaciones.detalle(user.tenantId!, id);
  }

  @Patch(':id')
  @RequiresPermiso('Propinas', 'Liquidar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateLiquidacionDto,
  ) {
    const user = req.user as JwtUser;
    return this.liquidaciones.actualizar(user.tenantId!, user.id, id, dto);
  }

  @Post(':id/actualizar-config')
  @RequiresPermiso('Propinas', 'Liquidar')
  actualizarConfig(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.liquidaciones.actualizarConfig(user.tenantId!, user.id, id);
  }

  @Post(':id/confirmar')
  @RequiresPermiso('Propinas', 'Liquidar')
  confirmar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.liquidaciones.confirmar(user.tenantId!, user.id, id);
  }

  @Post(':id/anular')
  @RequiresPermiso('Propinas', 'Liquidar')
  anular(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AnularLiquidacionDto,
  ) {
    const user = req.user as JwtUser;
    return this.liquidaciones.anular(user.tenantId!, user.id, id, dto);
  }
}
