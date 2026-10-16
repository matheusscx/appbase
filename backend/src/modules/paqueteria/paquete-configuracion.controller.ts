import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';
import { PutPaqueteConfiguracionDto } from './dto/put-paquete-configuracion.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('paquetes/configuracion')
export class PaqueteConfiguracionController {
  constructor(private readonly service: PaqueteConfiguracionService) {}

  @Get()
  obtener(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.service.obtener(user.tenantId!);
  }

  @Put()
  guardar(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: PutPaqueteConfiguracionDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.guardar(user.tenantId!, dto);
  }
}
