import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { RbacService } from '../rbac/rbac.service';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { VentasService } from './ventas.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { QueryVentasDto } from './dto/query-ventas.dto';
import { CreateNotaCreditoDto } from './dto/create-nota-credito.dto';
import { CancelarVentaDto } from './dto/cancelar-venta.dto';

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('ventas')
export class VentasController {
  constructor(
    private readonly ventasService: VentasService,
    private readonly rbacService: RbacService,
  ) {}

  @Post()
  @RequiresPermiso('Ventas', 'Crear')
  async crear(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CreateVentaDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.crear(u.tenantId ?? '', u.id, dto);
  }

  @Post(':id/notas-credito')
  @RequiresPermiso('Ventas', 'Nota de crédito')
  async crearNotaCredito(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CreateNotaCreditoDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.crearNotaCreditoDesdeVenta({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      ventaOriginalId: id,
      monto: dto.monto,
      comentario: dto.comentario,
      devoluciones: dto.devoluciones,
      devolverDinero: dto.devolverDinero === true,
    });
  }

  @Post(':id/anular')
  @RequiresPermiso('Ventas', 'Anular')
  async anular(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelarVentaDto,
  ) {
    const u = req.user as JwtUser;
    return this.ventasService.cancelar({
      tenantId: u.tenantId ?? '',
      usuarioId: u.id,
      ventaId: id,
      motivo: dto.motivo,
      // Por defecto repone: no hacerlo pierde inventario en silencio.
      reponerStock: dto.reponerStock !== false,
    });
  }

  /**
   * Alcance de lectura: `Ventas:Leer` es el piso —dice si podés entrar—, y el eje
   * **`Cajas:Leer`** dice CUÁNTO ves — `MiCaja` NO entra en la regla, ver el
   * docblock de `resolverAlcanceDerivadoDeCaja`. Sin esto, un cajero con `Ventas:Leer` leía
   * TODAS las ventas del tenant y el detalle de cualquiera de ellas, que trae
   * `caja_id`, `monto` y `vuelto` por pago: era el camino largo para reconstruir
   * el esperado de una caja ajena (auditoría del 2026-08-22, ver
   * `docs/superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md`).
   */
  @Get('resumen')
  @RequiresPermiso('Ventas', 'Leer')
  async resumen(@Req() req: Request) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.resumen(u.tenantId ?? '', u.id, verTodas);
  }

  @Get()
  @RequiresPermiso('Ventas', 'Leer')
  async listar(@Req() req: Request, @Query() query: QueryVentasDto) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.listar(u.tenantId ?? '', query, u.id, verTodas);
  }

  @Get(':id')
  @RequiresPermiso('Ventas', 'Leer')
  async findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.rbacService.resolverAlcanceDerivadoDeCaja(
      u.id,
      u.tenantId!,
    );
    return this.ventasService.findOne(u.tenantId ?? '', id, u.id, verTodas);
  }
}

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('tipos-documento')
export class TiposDocumentoController {
  constructor(private readonly ventasService: VentasService) {}

  @Get()
  @RequiresPermiso('Ventas', 'Leer')
  async listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.findTiposDocumento(u.tenantId ?? '');
  }
}
