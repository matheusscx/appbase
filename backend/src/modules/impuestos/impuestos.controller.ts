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
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { ImpuestosService } from './impuestos.service';
import { CreateImpuestoDto } from './dto/create-impuesto.dto';
import { UpdateImpuestoDto } from './dto/update-impuesto.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('impuestos')
export class ImpuestosController {
  constructor(private readonly impuestosService: ImpuestosService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.impuestosService.findAll(
      user.tenantId,
      query.incluirEliminados,
    );
  }

  // Consulta inversa a GET /items/:id/uso: alimenta el modal de confirmación
  // al pausar ("deja de aplicarse en N ítems"). Admin-only porque respalda
  // una acción admin-only (pausar, ya guardado detrás de TenantAdminGuard).
  @UseGuards(TenantAdminGuard)
  @Get(':id/uso')
  obtenerUso(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.impuestosService.obtenerUso(user.tenantId, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateImpuestoDto) {
    const user = req.user as { tenantId: string };
    return this.impuestosService.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateImpuestoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.impuestosService.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.impuestosService.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post(':id/restaurar')
  restaurar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.impuestosService.restaurar(user.tenantId!, id);
  }
}
