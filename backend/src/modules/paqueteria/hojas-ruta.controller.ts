import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { HojasRutaService } from './hojas-ruta.service';
import { EscanearDto } from './dto/escanear.dto';
import { AsignarDto } from './dto/asignar.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('hojas-ruta')
export class HojasRutaController {
  constructor(private readonly service: HojasRutaService) {}

  // Los dos devuelven la hoja y no crean un recurso con su propia URL: 200, no 201.
  @Post('escanear')
  @HttpCode(200)
  escanear(@Req() req: Request, @Body() dto: EscanearDto) {
    const user = req.user as JwtUser;
    return this.service.escanear(user.tenantId!, dto);
  }

  @Post('asignar')
  @HttpCode(200)
  asignar(@Req() req: Request, @Body() dto: AsignarDto) {
    const user = req.user as JwtUser;
    return this.service.asignar(user.tenantId!, dto);
  }
}
