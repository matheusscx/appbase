import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
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
import { RbacService } from '../rbac/rbac.service';
import { CajaService } from './caja.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import { QueryHistorialCajaDto } from './dto/query-historial-caja.dto';

@ApiTags('caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * Endpoints de lectura que sirven tanto al dueño (módulo MiCaja) como al
   * supervisor (módulo Cajas). Devuelve `verTodas=true` si el usuario tiene
   * `Cajas:Leer`; lanza 403 si no tiene ni `MiCaja:Leer` ni `Cajas:Leer`.
   * El alcance (propia vs. todas) y la escritura owner-only los sigue
   * resolviendo el service.
   */
  private async resolverLecturaCompartida(u: JwtUser): Promise<boolean> {
    const [tieneMiCaja, tieneCajas] = await Promise.all([
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'MiCaja', 'Leer'),
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'Cajas', 'Leer'),
    ]);
    if (!tieneMiCaja && !tieneCajas) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    return tieneCajas;
  }

  @Get()
  async historial(@Req() req: Request, @Query() query: QueryHistorialCajaDto) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    const consultaOtroUsuario =
      query.usuarioId != null && query.usuarioId !== u.id;
    const scope = query.todas || consultaOtroUsuario ? verTodas : false;
    return this.cajaService.historial(u.tenantId!, u.id, query, scope);
  }

  @Get('activa')
  @RequiresPermiso('MiCaja', 'Leer')
  activa(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.findActiva(u.tenantId!, u.id);
  }

  @Get('abiertas')
  @RequiresPermiso('Cajas', 'Leer')
  abiertas(@Req() req: Request) {
    const u = req.user as JwtUser;
    // Endpoint exclusivo de supervisión: quien llega tiene Cajas:Leer → ve todas.
    return this.cajaService.abiertas(u.tenantId!, u.id, true);
  }

  @Get(':id')
  async detalle(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.findOne(u.tenantId!, u.id, cajaId, verTodas);
  }

  @Post('abrir')
  @RequiresPermiso('MiCaja', 'Crear')
  abrir(@Req() req: Request, @Body() dto: AbrirCajaDto) {
    const u = req.user as JwtUser;
    return this.cajaService.abrir(u.tenantId!, u.id, dto);
  }

  @Post(':id/movimientos')
  @RequiresPermiso('MiCaja', 'Crear')
  registrarMovimiento(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CrearMovimientoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.registrarMovimiento(u.tenantId!, u.id, cajaId, dto);
  }

  @Post(':id/cerrar')
  @RequiresPermiso('MiCaja', 'Actualizar')
  cerrar(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.cerrar(u.tenantId!, u.id, cajaId, dto);
  }

  @Get(':id/movimientos/resumen')
  async resumenMovimientos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.resumenMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      verTodas,
    );
  }

  @Get(':id/movimientos')
  async listarMovimientos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Query() query: QueryMovimientosCajaDto,
  ) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.listarMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      query,
      verTodas,
    );
  }
}
