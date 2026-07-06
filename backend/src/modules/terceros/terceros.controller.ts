import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { TercerosService } from './terceros.service';
import { CreateTerceroDto } from './dto/create-tercero.dto';
import { UpdateTerceroDto } from './dto/update-tercero.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('terceros')
export class TercerosController {
  constructor(private readonly tercerosService: TercerosService) {}

  @Get()
  @RequiresPermiso('Terceros', 'Leer')
  findAll(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.findAll(user.tenantId);
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
    @Param('id') id: string,
    @Body() dto: UpdateTerceroDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequiresPermiso('Terceros', 'Eliminar')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.remove(user.tenantId, id);
  }
}
