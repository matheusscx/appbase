import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequiresPermiso } from '../../../common/decorators/requires-permiso.decorator';
import { PermisosGuard } from '../../../common/guards/permisos.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import type { JwtUser } from '../../../common/interfaces/jwt-user.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { QueryVarianzaDto } from './dto/query-varianza.dto';
import { ResumenVarianzaDto } from './dto/resumen-varianza.dto';
import { VarianzaService } from './varianza.service';

@ApiTags('reportes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('reportes/varianza')
export class VarianzaController {
  constructor(private readonly varianza: VarianzaService) {}

  /**
   * Módulo propio `Varianza` y no un `Reportes:Leer` compartido por todos los
   * reportes: el guard solo sabe hacer **O**, nunca **Y**
   * (`requires-permiso.decorator.ts`), así que cada ruta elige un par
   * (módulo, permiso). Con un permiso común, el reporte de márgenes que se
   * agregue más adelante le aparecería al encargado de bodega que hoy tiene la
   * varianza, sin que nadie lo decida. Es el precedente exacto de
   * `Resumen del negocio`, que se sacó de Ventas el 2026-09-18 por este mismo
   * motivo (spec § 2).
   *
   * ⛔ `tenantId` sale del token, nunca de la query.
   */
  @Get()
  @RequiresPermiso('Varianza', 'Leer')
  findAll(@Req() req: Request, @Query() query: QueryVarianzaDto) {
    const user = req.user as JwtUser;
    return this.varianza.findAll(user.tenantId!, query);
  }

  /**
   * Los agregados y los datos de la gráfica, en una sola llamada (spec § 7.2).
   *
   * ⚠️ **Ruta estática.** Este controller no tiene ninguna ruta con `:param`,
   * así que hoy nada se la puede comer — pero va declarada igual con el
   * criterio del repo, estáticas antes que paramétricas, para que agregar un
   * `:id` más adelante no la rompa en silencio.
   *
   * ⛔ Mismo par (módulo, permiso) que el listado, y `tenantId` del token.
   */
  @Get('resumen')
  @RequiresPermiso('Varianza', 'Leer')
  resumen(@Req() req: Request, @Query() query: ResumenVarianzaDto) {
    const user = req.user as JwtUser;
    return this.varianza.resumen(user.tenantId!, query);
  }
}
