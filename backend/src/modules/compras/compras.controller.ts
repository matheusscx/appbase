import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { ComprasService } from './compras.service';
import { CompraBorradorDto } from './dto/compra-borrador.dto';
import { FindComprasDto } from './dto/find-compras.dto';
import { AnularCompraDto } from './dto/anular-compra.dto';
import {
  CorregirDescuentoDto,
  CorregirLineaDto,
} from './dto/corregir-compra.dto';

/**
 * Módulo propio `Compras` (spec compras-recepcion § 5): el que recibe no es
 * el que paga, y colgarlo de Inventario daría compras a todo el que cuenta
 * stock. `Crear` cubre el borrador entero (crear, editar, descartar) porque
 * es un solo trabajo que todavía no movió nada.
 *
 * ⚠️ Las rutas fijas van ANTES de `/:id`, o Nest las toma como un id.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('compras')
export class ComprasController {
  constructor(private readonly comprasService: ComprasService) {}

  @Get('tipos-documento')
  @RequiresPermiso('Compras', 'Leer')
  tiposDocumento(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.tiposDocumento(tenantId);
  }

  @Get('proveedores')
  @RequiresPermiso('Compras', 'Leer')
  proveedores(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.proveedores(tenantId);
  }

  @Get()
  @RequiresPermiso('Compras', 'Leer')
  findAll(@Req() req: Request, @Query() query: FindComprasDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequiresPermiso('Compras', 'Leer')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.findOne(tenantId, id);
  }

  @Post()
  @RequiresPermiso('Compras', 'Crear')
  crear(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CompraBorradorDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.crearBorrador(tenantId, usuarioId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Compras', 'Crear')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CompraBorradorDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.actualizarBorrador(tenantId, id, dto);
  }

  /**
   * Mueve stock y costo: una entrada por línea. `Crear` y no un permiso
   * aparte, porque recibir la mercadería es el mismo trabajo que cargarla
   * (spec compras-recepcion § 5).
   */
  @Post(':id/confirmar')
  @RequiresPermiso('Compras', 'Crear')
  confirmar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.confirmar(tenantId, usuarioId, id);
  }

  /**
   * Completa o corrige el precio de una línea ya confirmada (spec
   * compras-recepcion § 4.4). `Actualizar` y no `Crear`: cambia el costo de
   * mercadería que ya entró, y puede tocar lo que se vendió después.
   */
  @Patch(':id/lineas/:lineaId')
  @RequiresPermiso('Compras', 'Actualizar')
  corregirLinea(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('lineaId', ParseUUIDPipe) lineaId: string,
    @Body(EscalaMonedaPipe) dto: CorregirLineaDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.corregirLinea(
      tenantId,
      usuarioId,
      id,
      lineaId,
      dto,
    );
  }

  /** El descuento al total de una confirmada. Mismo permiso que la línea. */
  @Patch(':id/descuento')
  @RequiresPermiso('Compras', 'Actualizar')
  corregirDescuento(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: CorregirDescuentoDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.corregirDescuento(tenantId, usuarioId, id, dto);
  }

  /**
   * Anula una confirmada (spec compras-recepcion § 4.5). `Anular` va aparte
   * porque es la acción que más mueve: saca del stock todo lo que entró.
   */
  @Post(':id/anular')
  @RequiresPermiso('Compras', 'Anular')
  anular(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularCompraDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.comprasService.anular(tenantId, usuarioId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Compras', 'Crear')
  descartar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.comprasService.descartarBorrador(tenantId, id);
  }
}
