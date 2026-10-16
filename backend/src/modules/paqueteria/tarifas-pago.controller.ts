import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { TarifasPagoService } from './tarifas-pago.service';
import { CreateTarifaPagoDto } from './dto/create-tarifa-pago.dto';
import { UpdateTarifaPagoDto } from './dto/update-tarifa-pago.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('tarifas-pago')
export class TarifasPagoController {
  constructor(private readonly service: TarifasPagoService) {}

  @Get()
  listar(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.service.listar(user.tenantId!);
  }

  @Post()
  crear(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CreateTarifaPagoDto) {
    const user = req.user as JwtUser;
    return this.service.crear(user.tenantId!, dto);
  }

  @Patch(':id')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: UpdateTarifaPagoDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.actualizar(user.tenantId!, id, dto);
  }

  @Delete(':id')
  eliminar(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.eliminar(user.tenantId!, id);
  }
}
