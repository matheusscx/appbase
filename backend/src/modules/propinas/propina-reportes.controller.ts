import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { QueryPropinaReporteDto } from './dto/query-propina-reporte.dto';
import { PropinaReportesService } from './propina-reportes.service';

@ApiTags('propinas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('propinas/reportes')
export class PropinaReportesController {
  constructor(private readonly reportes: PropinaReportesService) {}

  @Get('resumen')
  @RequiresPermiso('Propinas', 'Leer')
  resumen(@Req() req: Request, @Query() query: QueryPropinaReporteDto) {
    const user = req.user as JwtUser;
    return this.reportes.resumen(user.tenantId!, query);
  }

  @Get('trabajadores')
  @RequiresPermiso('Propinas', 'Leer')
  trabajadores(@Req() req: Request, @Query() query: QueryPropinaReporteDto) {
    const user = req.user as JwtUser;
    return this.reportes.trabajadores(user.tenantId!, query);
  }
}
