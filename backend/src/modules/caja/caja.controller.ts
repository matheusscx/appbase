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
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { RbacService } from '../rbac/rbac.service';
import { CajaService } from './caja.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';

@ApiTags('caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly rbacService: RbacService,
  ) {}

  @Get()
  @RequiresPermiso('Caja', 'Leer')
  @ApiQuery({ name: 'todas', required: false, type: String })
  async historial(@Req() req: Request, @Query('todas') todas?: string) {
    const u = req.user as JwtUser;
    let tieneVerTodas = false;
    if (todas === 'true') {
      tieneVerTodas = await this.rbacService.userHasPermiso(
        u.id,
        u.tenantId!,
        'Caja',
        'Ver todas',
      );
    }
    return this.cajaService.historial(u.tenantId!, u.id, tieneVerTodas);
  }

  @Get('activa')
  @RequiresPermiso('Caja', 'Leer')
  activa(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.findActiva(u.tenantId!, u.id);
  }

  @Get('abiertas')
  @RequiresPermiso('Caja', 'Leer')
  async abiertas(@Req() req: Request) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.abiertas(u.tenantId!, u.id, tieneVerTodas);
  }

  @Get(':id')
  @RequiresPermiso('Caja', 'Leer')
  async detalle(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.findOne(u.tenantId!, u.id, cajaId, tieneVerTodas);
  }

  @Post('abrir')
  @RequiresPermiso('Caja', 'Crear')
  abrir(@Req() req: Request, @Body() dto: AbrirCajaDto) {
    const u = req.user as JwtUser;
    return this.cajaService.abrir(u.tenantId!, u.id, dto);
  }

  @Post(':id/movimientos')
  @RequiresPermiso('Caja', 'Crear')
  registrarMovimiento(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CrearMovimientoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.registrarMovimiento(u.tenantId!, u.id, cajaId, dto);
  }

  @Post(':id/cerrar')
  @RequiresPermiso('Caja', 'Actualizar')
  cerrar(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.cerrar(u.tenantId!, u.id, cajaId, dto);
  }

  @Get(':id/movimientos/resumen')
  @RequiresPermiso('Caja', 'Leer')
  async resumenMovimientos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.resumenMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      tieneVerTodas,
    );
  }

  @Get(':id/movimientos')
  @RequiresPermiso('Caja', 'Leer')
  async listarMovimientos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Query() query: QueryMovimientosCajaDto,
  ) {
    const u = req.user as JwtUser;
    const tieneVerTodas = await this.rbacService.userHasPermiso(
      u.id,
      u.tenantId!,
      'Caja',
      'Ver todas',
    );
    return this.cajaService.listarMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      query,
      tieneVerTodas,
    );
  }
}
