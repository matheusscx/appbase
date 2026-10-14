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
import { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import { SubirCafDto } from './dto/subir-caf.dto';
import { SubirCertificadoDto } from './dto/subir-certificado.dto';
import { PerfilFiscalService } from './perfil-fiscal.service';

/**
 * Perfil fiscal del emisor de boletas electrónicas. Admin-only: es configuración del tenant
 * (el certificado firma en nombre de la empresa), no una operación de un módulo RBAC.
 */
@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('dte')
export class DteController {
  constructor(private readonly perfil: PerfilFiscalService) {}

  @Get('perfil')
  obtener(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.perfil.obtener(user.tenantId, new Date());
  }

  @Patch('perfil')
  actualizar(@Req() req: Request, @Body() dto: ActualizarPerfilDto) {
    const user = req.user as { tenantId: string };
    return this.perfil.actualizar(user.tenantId, dto);
  }

  @Post('certificado')
  subirCertificado(@Req() req: Request, @Body() dto: SubirCertificadoDto) {
    const user = req.user as { tenantId: string };
    return this.perfil.subirCertificado(user.tenantId, dto, new Date());
  }

  @Post('cafs')
  subirCaf(@Req() req: Request, @Body() dto: SubirCafDto) {
    const user = req.user as { tenantId: string };
    return this.perfil.subirCaf(user.tenantId, dto);
  }

  @Delete('cafs/:id')
  borrarCaf(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as { tenantId: string };
    return this.perfil.borrarCaf(user.tenantId, id);
  }
}
