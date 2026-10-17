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
import { TarifasEnvioService } from './tarifas-envio.service';
import { CreateTarifaEnvioDto } from './dto/create-tarifa-envio.dto';
import { UpdateTarifaEnvioDto } from './dto/update-tarifa-envio.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('tarifas-envio')
export class TarifasEnvioController {
  constructor(private readonly service: TarifasEnvioService) {}

  @Get()
  listar(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.service.listar(user.tenantId!);
  }

  @Post()
  crear(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CreateTarifaEnvioDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.crear(user.tenantId!, dto);
  }

  @Patch(':id')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: UpdateTarifaEnvioDto,
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
