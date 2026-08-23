import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { RbacService } from '../rbac/rbac.service';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { QueryPagosDto } from './dto/query-pagos.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@ApiTags('pagos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('pagos')
export class PagosController {
  constructor(
    private readonly pagosService: PagosService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * Alcance de lectura: `Pagos:Leer` es el piso —dice si podés entrar—, y el eje
   * **`Cajas:Leer`** dice CUÁNTO ves — `MiCaja` NO entra en la regla, ver el
   * docblock de `resolverAlcanceDerivadoDeCaja`. Sin esto, un cajero con `Pagos:Leer` leía
   * todos los pagos del tenant, y con el modo ciego activo eso le devolvía el
   * esperado de su propia caja en un request (medido el 2026-08-22, ver
   * `docs/superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md`).
   */
  @Get('resumen')
  @RequiresPermiso('Pagos', 'Leer')
  async resumen(@Req() req: Request) {
    const user = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      user.id,
      user.tenantId!,
    );
    return this.pagosService.resumen(user.tenantId!, user.id, verTodas);
  }

  @Get()
  @RequiresPermiso('Pagos', 'Leer')
  async listar(@Req() req: Request, @Query() query: QueryPagosDto) {
    const user = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      user.id,
      user.tenantId!,
    );
    return this.pagosService.listar(user.tenantId!, query, user.id, verTodas);
  }

  @Post()
  @RequiresPermiso('Pagos', 'Crear')
  registrarAbono(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CreatePagoDto,
  ) {
    const user = req.user as JwtUser;
    return this.pagosService.registrarAbono(user.tenantId!, user.id, dto);
  }
}
