import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermisosGuard } from '../../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../../common/interfaces/jwt-user.interface';
import { TenantPasarelaService } from '../services/tenant-pasarela.service';
import { ApiKeysService } from '../services/api-keys.service';
import { CobrosService } from '../services/cobros.service';
import { CreateTenantPasarelaDto } from '../dto/create-tenant-pasarela.dto';
import { UpdateTenantPasarelaDto } from '../dto/update-tenant-pasarela.dto';
import { CreateApiKeyDto } from '../dto/create-api-key.dto';
import { QueryOrdenesDto } from '../dto/query-ordenes.dto';
import { CreateReembolsoDto } from '../dto/create-reembolso.dto';

@ApiTags('pasarela')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('pasarela/admin')
export class PasarelaAdminController {
  constructor(
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly apiKeysService: ApiKeysService,
    private readonly cobrosService: CobrosService,
  ) {}

  private tenantId(req: Request): string {
    return (req.user as JwtUser).tenantId ?? '';
  }

  @Get('pasarelas-disponibles')
  @RequiresPermiso('Pasarelas', 'Leer')
  pasarelasDisponibles() {
    return this.tenantPasarelaService.listarPasarelasGlobales();
  }

  @Get('config')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarConfig(@Req() req: Request) {
    return this.tenantPasarelaService.listar(this.tenantId(req));
  }

  @Post('config')
  @RequiresPermiso('Pasarelas', 'Crear')
  crearConfig(@Req() req: Request, @Body() dto: CreateTenantPasarelaDto) {
    return this.tenantPasarelaService.crear(this.tenantId(req), dto);
  }

  @Patch('config/:id')
  @RequiresPermiso('Pasarelas', 'Actualizar')
  actualizarConfig(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTenantPasarelaDto,
  ) {
    return this.tenantPasarelaService.actualizar(this.tenantId(req), id, dto);
  }

  @Delete('config/:id')
  @RequiresPermiso('Pasarelas', 'Eliminar')
  eliminarConfig(@Req() req: Request, @Param('id') id: string) {
    return this.tenantPasarelaService.eliminar(this.tenantId(req), id);
  }

  @Get('api-keys')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarApiKeys(@Req() req: Request) {
    return this.apiKeysService.listar(this.tenantId(req));
  }

  @Post('api-keys')
  @RequiresPermiso('Pasarelas', 'Crear')
  crearApiKey(@Req() req: Request, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.crear(this.tenantId(req), dto.nombre);
  }

  @Delete('api-keys/:id')
  @RequiresPermiso('Pasarelas', 'Eliminar')
  revocarApiKey(@Req() req: Request, @Param('id') id: string) {
    return this.apiKeysService.revocar(this.tenantId(req), id);
  }

  @Get('ordenes')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarOrdenes(@Req() req: Request, @Query() query: QueryOrdenesDto) {
    return this.cobrosService.listarOrdenes(this.tenantId(req), query);
  }

  @Get('ordenes/:id')
  @RequiresPermiso('Pasarelas', 'Leer')
  obtenerOrden(@Req() req: Request, @Param('id') id: string) {
    return this.cobrosService.obtenerOrden(this.tenantId(req), id);
  }

  @Post('ordenes/:id/reembolsos')
  @RequiresPermiso('Pasarelas', 'Reembolsar')
  reembolsar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: CreateReembolsoDto,
  ) {
    return this.cobrosService.reembolsar(this.tenantId(req), id, dto);
  }
}
