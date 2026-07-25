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
import { MotivosDiferenciaService } from './motivos-diferencia.service';
import { CreateMotivoDiferenciaDto } from './dto/create-motivo-diferencia.dto';
import { UpdateMotivoDiferenciaDto } from './dto/update-motivo-diferencia.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('motivos-diferencia')
export class MotivosDiferenciaController {
  constructor(private readonly service: MotivosDiferenciaService) {}

  @Get()
  findAll(@Req() req: Request, @Query('soloActivas') soloActivas?: string) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(user.tenantId, soloActivas === 'true');
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateMotivoDiferenciaDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMotivoDiferenciaDto,
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
