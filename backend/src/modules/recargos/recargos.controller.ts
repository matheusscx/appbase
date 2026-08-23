import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { QueryIncluirEliminadosDto } from '../../common/dto/query-incluir-eliminados.dto';
import { RestaurarDto } from '../../common/dto/restaurar.dto';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { RecargosService } from './recargos.service';
import { CreateRecargoDto } from './dto/create-recargo.dto';
import { UpdateRecargoDto } from './dto/update-recargo.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('recargos')
export class RecargosController {
  constructor(private readonly recargosService: RecargosService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.recargosService.findAll(user.tenantId, query.incluirEliminados);
  }

  // Must be registered BEFORE :id to avoid NestJS resolving 'nombre-disponible' as an id param
  @Get('nombre-disponible')
  nombreDisponible(
    @Req() req: Request,
    @Query('nombre') nombre: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const user = req.user as { tenantId: string };
    return this.recargosService.nombreDisponible(
      user.tenantId,
      nombre,
      excludeId,
    );
  }

  // Consulta inversa a GET /items/:id/uso: alimenta el modal de confirmación
  // al pausar ("deja de aplicarse en N ítems"). Admin-only porque respalda
  // una acción admin-only (pausar, ya guardado detrás de TenantAdminGuard).
  @UseGuards(TenantAdminGuard)
  @Get(':id/uso')
  obtenerUso(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.recargosService.obtenerUso(user.tenantId, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CreateRecargoDto) {
    const user = req.user as { tenantId: string };
    return this.recargosService.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body(EscalaMonedaPipe) dto: UpdateRecargoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.recargosService.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.recargosService.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre que la
  // fila ya tenía, que es como llaman las pantallas sin colisión.
  @Post(':id/restaurar')
  restaurar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RestaurarDto,
  ) {
    const user = req.user as JwtUser;
    return this.recargosService.restaurar(user.tenantId!, id, dto.nombre);
  }
}
