import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { OnlineService } from './online.service';
import { CalcularVentaDto } from '../calculo-precios/dto/calcular.dto';

@ApiTags('online')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('online')
export class OnlineController {
  constructor(private readonly onlineService: OnlineService) {}

  @Post('checkout')
  async checkout(@Req() req: Request, @Body() dto: CalcularVentaDto) {
    const u = req.user as JwtUser;
    return this.onlineService.checkout(u.tenantId ?? '', dto);
  }
}
