import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { CreateGrupoModificadorDto } from './dto/create-grupo-modificador.dto';

@Controller('grupos-modificadores')
@UseGuards(JwtAuthGuard, TenantGuard)
export class GruposModificadoresController {
  constructor(private readonly service: GruposModificadoresService) {}

  @Post()
  @UseGuards(TenantAdminGuard)
  create(@Req() req: Request, @Body() dto: CreateGrupoModificadorDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.service.create(tenantId, dto);
  }
}
