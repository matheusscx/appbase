import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EmisionBoletaService } from './emision-boleta.service';

/**
 * Emitir después y el estado de la emisión (spec `2026-10-14-boleta-desde-la-venta`, § 5 y § 8).
 * Vive en este módulo y no en `DteController` porque `dte` no puede importar a `venta-documentos`
 * (al revés sí), y comparte el prefijo `/dte`. Los guards van por ruta, no por clase: emitir,
 * listar y ver las boletas con problemas son de administración (`TenantAdminGuard`), pero el
 * estado lo lee quien vende.
 * El `tenant_id` sale siempre del token; ninguna ruta recibe uno.
 */
@ApiTags('dte')
@ApiBearerAuth()
@Controller('dte')
export class EmisionBoletaController {
  constructor(private readonly emision: EmisionBoletaService) {}

  @Post('emitir-pendientes')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  emitirPendientes(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.emision.emitirPendientes(u.tenantId ?? '', new Date());
  }

  @Get('boletas-sin-emitir')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  sinEmitir(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.emision.sinEmitir(u.tenantId ?? '');
  }

  /**
   * Las boletas atrasadas, rechazadas y con reparos en el SII, cruzadas con su venta. Es
   * `TenantAdminGuard` y no un permiso de módulo por lo mismo que `boletas-sin-emitir`: es una
   * pantalla de configuración de la emisión, de quien administra el local, no una operación de
   * caja. El cajero solo ve el conteo (`estado-emision`).
   */
  @Get('boletas-con-problemas')
  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  conProblemas(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.emision.boletasConProblemas(u.tenantId ?? '');
  }

  /**
   * La lee el POS y el salón: `Ventas:Crear` y NO `TenantAdminGuard` (`GET /dte/perfil` es de
   * admin y el cajero recibe 403). Devuelve avisos y conteos, nunca datos del emisor.
   */
  @Get('estado-emision')
  @UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
  @RequiresPermiso('Ventas', 'Crear')
  estadoEmision(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.emision.estadoEmision(u.tenantId ?? '', new Date());
  }
}
