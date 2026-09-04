import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { MonedasService } from './monedas.service';
import { UpdateTenantMonedaDto } from './dto/update-tenant-moneda.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('monedas')
export class MonedasController {
  constructor(private readonly monedasService: MonedasService) {}

  @Get()
  findMonedas(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.monedasService.findMonedas(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':monedaId')
  updateMoneda(
    @Req() req: Request,
    @Param('monedaId', ParseUUIDPipe) monedaId: string,
    @Body() dto: UpdateTenantMonedaDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.monedasService.updateMoneda(user.tenantId, monedaId, dto);
  }
}
