import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { CreateGrupoModificadorDto } from './dto/create-grupo-modificador.dto';
import { UpdateGrupoModificadorDto } from './dto/update-grupo-modificador.dto';

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

  @Get()
  findAll(@Req() req: Request) {
    const { tenantId } = req.user as { tenantId: string };
    return this.service.findAll(tenantId);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.service.findOne(tenantId, id);
  }

  @Patch(':id')
  @UseGuards(TenantAdminGuard)
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateGrupoModificadorDto,
  ) {
    const { tenantId } = req.user as { tenantId: string };
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(TenantAdminGuard)
  @HttpCode(204)
  remove(@Req() req: Request, @Param('id') id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.service.remove(tenantId, id);
  }
}
