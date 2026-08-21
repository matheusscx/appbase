import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { ItemsService } from './items.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { AjusteStockDto } from './dto/ajuste-stock.dto';
import { QueryItemsDto } from './dto/query-items.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @RequiresPermiso('Items', 'Leer')
  findAll(@Req() req: Request, @Query() query: QueryItemsDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findAll(tenantId, query);
  }

  @Get(':id/afectados')
  @RequiresPermiso('Items', 'Leer')
  afectados(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.itemsAfectadosPorInsumo(tenantId, id);
  }

  @Get(':id')
  @RequiresPermiso('Items', 'Leer')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findOne(tenantId, id);
  }

  @Post()
  @RequiresPermiso('Items', 'Crear')
  create(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CreateItemDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.create(tenantId, usuarioId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Items', 'Actualizar')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.update(tenantId, usuarioId, id, dto);
  }

  /**
   * `Items:Eliminar` y no `Items:Leer`, a diferencia de su ruta hermana
   * `:id/afectados`. **Es deliberado, no una asimetría olvidada:** este
   * endpoint existe para mostrar el impacto de un borrado, así que lo pide quien
   * puede borrar.
   *
   * Si algún día el frontend quiere el dato de uso **fuera** del flujo de
   * borrado —por ejemplo en la ficha del ítem—, este guard no le va a alcanzar y
   * hay que decidir ahí si se relaja o si se expone por otra ruta. Se anota acá y
   * no en el backlog porque no hay nada pendiente que hacer: es el porqué de una
   * línea que parece un error y no lo es.
   */
  @Get(':id/uso')
  @RequiresPermiso('Items', 'Eliminar')
  obtenerUso(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.obtenerUso(tenantId, id);
  }

  @Delete(':id')
  @RequiresPermiso('Items', 'Eliminar')
  remove(@Req() req: Request, @Param('id') id: string) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.remove(tenantId, usuarioId, id);
  }

  // Papelera: mismo guard que el DELETE, heredado del `@Controller`
  // (JwtAuthGuard, TenantGuard, PermisosGuard) más el mismo permiso puntual
  // — restaurar es la otra cara del mismo borrado, no una operación de
  // lectura.
  @Post(':id/restaurar')
  @RequiresPermiso('Items', 'Eliminar')
  restaurar(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.restaurar(tenantId, id);
  }

  @Patch(':id/stock')
  @RequiresPermiso('Items', 'Actualizar')
  ajustarStock(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(EscalaMonedaPipe) dto: AjusteStockDto,
  ) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.itemsService.ajustarStock(tenantId, usuarioId, id, dto);
  }

  @Get(':id/unidades')
  @RequiresPermiso('Items', 'Leer')
  findUnidades(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('estado') estado?: string,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findUnidades(tenantId, id, estado);
  }

  @Get(':id/lotes')
  @RequiresPermiso('Items', 'Leer')
  findLotes(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.itemsService.findLotes(tenantId, id);
  }
}
