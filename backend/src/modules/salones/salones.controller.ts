import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { SalonesService } from './salones.service';
import { CreateSalonDto } from './dto/create-salon.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { CreateMesaDto } from './dto/create-mesa.dto';
import { UpdateMesaDto } from './dto/update-mesa.dto';
import { UpdateLayoutDto } from './dto/update-layout.dto';
import { CreateCuentaDto } from './dto/create-cuenta.dto';
import { AddLineaDto } from './dto/add-linea.dto';
import { UpdateLineaDto } from './dto/update-linea.dto';
import { CerrarCuentaDto } from './dto/cerrar-cuenta.dto';

@ApiTags('salones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('salones')
export class SalonesController {
  constructor(private readonly salonesService: SalonesService) {}

  // ── Operación (garzón) ─────────────────────────────────────────────────
  @Get('operacion')
  @RequiresPermiso('Salones', 'Operar')
  operacion(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.salonesService.listarSalonesOperacion(u.tenantId ?? '');
  }

  // ── Administración: salones ────────────────────────────────────────────
  @Get()
  @RequiresPermiso('Salones', 'Leer')
  listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.salonesService.listarSalones(u.tenantId ?? '');
  }

  @Post()
  @RequiresPermiso('Salones', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateSalonDto) {
    const u = req.user as JwtUser;
    return this.salonesService.crearSalon(u.tenantId ?? '', dto);
  }

  @Patch(':id')
  @RequiresPermiso('Salones', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSalonDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.actualizarSalon(u.tenantId ?? '', id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Salones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.salonesService.eliminarSalon(u.tenantId ?? '', id);
  }

  // ── Administración: mesas ──────────────────────────────────────────────
  @Post(':salonId/mesas')
  @RequiresPermiso('Salones', 'Crear')
  crearMesa(
    @Req() req: Request,
    @Param('salonId') salonId: string,
    @Body() dto: CreateMesaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.crearMesa(u.tenantId ?? '', salonId, dto);
  }

  @Patch(':salonId/layout')
  @RequiresPermiso('Salones', 'Actualizar')
  guardarLayout(
    @Req() req: Request,
    @Param('salonId') salonId: string,
    @Body() dto: UpdateLayoutDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.guardarLayout(u.tenantId ?? '', salonId, dto);
  }
}

@ApiTags('salones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('mesas')
export class MesasController {
  constructor(private readonly salonesService: SalonesService) {}

  @Patch(':id')
  @RequiresPermiso('Salones', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMesaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.actualizarMesa(u.tenantId ?? '', id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Salones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.salonesService.eliminarMesa(u.tenantId ?? '', id);
  }

  @Get(':id/cuentas')
  @RequiresPermiso('Salones', 'Operar')
  cuentas(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.salonesService.listarCuentasDeMesa(u.tenantId ?? '', id);
  }

  @Post(':id/cuentas')
  @RequiresPermiso('Salones', 'Operar')
  abrirCuenta(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateCuentaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.abrirCuenta(u.tenantId ?? '', id, dto);
  }
}

@ApiTags('salones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('cuentas')
export class CuentasController {
  constructor(private readonly salonesService: SalonesService) {}

  @Post(':id/lineas')
  @RequiresPermiso('Salones', 'Operar')
  agregarLinea(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: AddLineaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.agregarLinea(u.tenantId ?? '', id, dto);
  }

  @Patch(':id/lineas/:lineaId')
  @RequiresPermiso('Salones', 'Operar')
  actualizarLinea(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineaId') lineaId: string,
    @Body() dto: UpdateLineaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.actualizarLinea(
      u.tenantId ?? '',
      id,
      lineaId,
      dto,
    );
  }

  @Delete(':id/lineas/:lineaId')
  @RequiresPermiso('Salones', 'Operar')
  quitarLinea(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('lineaId') lineaId: string,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.quitarLinea(u.tenantId ?? '', id, lineaId);
  }

  @Post(':id/cancelar')
  @RequiresPermiso('Salones', 'Operar')
  cancelar(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.salonesService.cancelarCuenta(u.tenantId ?? '', id);
  }

  @Post(':id/cerrar')
  @RequiresPermiso('Salones', 'Operar')
  cerrar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CerrarCuentaDto,
  ) {
    const u = req.user as JwtUser;
    return this.salonesService.cerrarCuenta(u.tenantId ?? '', u.id, id, dto);
  }
}
