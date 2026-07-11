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
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { VentasService } from './ventas.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { QueryVentasDto } from './dto/query-ventas.dto';
import { CreateNotaCreditoDto } from './dto/create-nota-credito.dto';

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Post()
  @RequiresPermiso('Ventas', 'Crear')
  async crear(@Req() req: Request, @Body() dto: CreateVentaDto) {
    const u = req.user as JwtUser;
    return this.ventasService.crear(u.tenantId ?? '', u.id, dto);
  }

  @Post(':id/notas-credito')
  @RequiresPermiso('Ventas', 'Nota de crédito')
  async crearNotaCredito(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateNotaCreditoDto,
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

  @Get('resumen')
  @RequiresPermiso('Ventas', 'Leer')
  resumen(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.resumen(u.tenantId ?? '');
  }

  @Get()
  @RequiresPermiso('Ventas', 'Leer')
  async listar(@Req() req: Request, @Query() query: QueryVentasDto) {
    const u = req.user as JwtUser;
    return this.ventasService.listar(u.tenantId ?? '', query);
  }

  @Get(':id')
  @RequiresPermiso('Ventas', 'Leer')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.ventasService.findOne(u.tenantId ?? '', id);
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
