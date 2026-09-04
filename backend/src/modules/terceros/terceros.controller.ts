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
import { QueryIncluirEliminadosDto } from '../../common/dto/query-incluir-eliminados.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { TercerosService } from './terceros.service';
import { CreateTerceroDto } from './dto/create-tercero.dto';
import { UpdateTerceroDto } from './dto/update-tercero.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('terceros')
export class TercerosController {
  constructor(private readonly tercerosService: TercerosService) {}

  @Get()
  @RequiresPermiso('Terceros', 'Leer')
  findAll(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.findAll(user.tenantId, query.incluirEliminados);
  }

  @Post()
  @RequiresPermiso('Terceros', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateTerceroDto) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.create(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Terceros', 'Actualizar')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTerceroDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Terceros', 'Eliminar')
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.tercerosService.remove(user.tenantId!, user.id, id);
  }

  @Post(':id/restaurar')
  @RequiresPermiso('Terceros', 'Eliminar')
  restaurar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.tercerosService.restaurar(user.tenantId!, id);
  }
}
