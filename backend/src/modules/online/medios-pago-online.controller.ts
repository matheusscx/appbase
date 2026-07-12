import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { MediosPagoOnlineService } from './medios-pago-online.service';

@ApiTags('online')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('online/medios-pago')
export class MediosPagoOnlineController {
  constructor(private readonly mediosPago: MediosPagoOnlineService) {}

  @Get()
  @RequiresPermiso('Tienda Online', 'Leer')
  listar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.mediosPago.listar(u.tenantId ?? '', u.id);
  }

  @Post()
  @RequiresPermiso('Tienda Online', 'Crear')
  iniciar(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.mediosPago.iniciar(u.tenantId ?? '', u.id, u.email);
  }

  @Delete(':id')
  @RequiresPermiso('Tienda Online', 'Crear')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.mediosPago.eliminar(u.tenantId ?? '', u.id, id);
  }

  @Patch(':id/preferida')
  @RequiresPermiso('Tienda Online', 'Crear')
  marcarPreferida(@Req() req: Request, @Param('id') id: string) {
    const u = req.user as JwtUser;
    return this.mediosPago.marcarPreferida(u.tenantId ?? '', u.id, id);
  }
}
