import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { MermasService } from './mermas.service';
import { CreateMermaDto } from './dto/create-merma.dto';
import { FindMermasDto } from './dto/find-mermas.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('mermas')
export class MermasController {
  constructor(private readonly mermasService: MermasService) {}

  @Get()
  @RequiresPermiso('Inventario', 'Leer')
  findAll(@Req() req: Request, @Query() query: FindMermasDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.mermasService.findAll(tenantId, query);
  }

  @Post()
  @RequiresPermiso('Inventario', 'Crear')
  create(@Req() req: Request, @Body() dto: CreateMermaDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.mermasService.registrar(tenantId, usuarioId, dto);
  }
}
