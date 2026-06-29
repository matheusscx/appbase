import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { VentasService } from './ventas.service';
import { CreateVentaDto } from './dto/create-venta.dto';

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
// TODO: migrar a @RequiresPermiso('ventas.crear') cuando se implemente RBAC granular (decisión G)
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Post()
  async crear(@Req() req: Request, @Body() dto: CreateVentaDto) {
    const u = req.user as JwtUser;
    return this.ventasService.crear(u.tenantId ?? '', u.id, dto);
  }

  @Get()
  async listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.listar(u.tenantId ?? '');
  }

  @Get(':id')
  async findOne(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.ventasService.findOne(u.tenantId ?? '', id);
  }
}

@ApiTags('ventas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('tipos-documento')
export class TiposDocumentoController {
  constructor(private readonly ventasService: VentasService) {}

  @Get()
  async listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.ventasService.findTiposDocumento(u.tenantId ?? '');
  }
}
