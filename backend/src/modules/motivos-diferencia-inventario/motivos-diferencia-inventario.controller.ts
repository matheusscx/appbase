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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { MotivosDiferenciaInventarioService } from './motivos-diferencia-inventario.service';
import { CreateMotivoDiferenciaInventarioDto } from './dto/create-motivo-diferencia-inventario.dto';
import { UpdateMotivoDiferenciaInventarioDto } from './dto/update-motivo-diferencia-inventario.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('motivos-diferencia-inventario')
export class MotivosDiferenciaInventarioController {
  constructor(private readonly service: MotivosDiferenciaInventarioService) {}

  @Get()
  findAll(@Req() req: Request, @Query('soloActivas') soloActivas?: string) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(user.tenantId, soloActivas === 'true');
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(
    @Req() req: Request,
    @Body() dto: CreateMotivoDiferenciaInventarioDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMotivoDiferenciaInventarioDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.service.remove(user.tenantId, id);
  }
}
