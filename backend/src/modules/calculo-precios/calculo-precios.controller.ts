import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CalculoPreciosService } from './calculo-precios.service';
import { CalcularVentaDto } from './dto/calcular.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('calculo-precios')
export class CalculoPreciosController {
  constructor(private readonly calculoPreciosService: CalculoPreciosService) {}

  @Post('calcular')
  calcular(@Req() req: Request, @Body() dto: CalcularVentaDto) {
    const user = req.user as { tenantId: string };
    return this.calculoPreciosService.calcular(user.tenantId, dto);
  }
}
