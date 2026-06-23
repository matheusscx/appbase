import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { MetodosPagoService } from './metodos-pago.service';
import { UpdateTenantMetodoPagoDto } from './dto/update-tenant-metodo-pago.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('metodos-pago')
export class MetodosPagoController {
  constructor(private readonly metodosPagoService: MetodosPagoService) {}

  @Get()
  findMetodosPago(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.metodosPagoService.findMetodosPago(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':metodoPagoId')
  updateMetodoPago(
    @Req() req: Request,
    @Param('metodoPagoId') metodoPagoId: string,
    @Body() dto: UpdateTenantMetodoPagoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.metodosPagoService.updateMetodoPago(
      user.tenantId,
      metodoPagoId,
      dto,
    );
  }
}
