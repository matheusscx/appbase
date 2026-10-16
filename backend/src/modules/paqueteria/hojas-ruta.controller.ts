import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { MarcarLineaDto } from './dto/marcar-linea.dto';
import { QueryHojasRutaDto } from './dto/query-hojas-ruta.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('hojas-ruta')
export class HojasRutaController {
  constructor(private readonly service: HojasRutaService) {}

  @Get()
  lista(@Req() req: Request, @Query() q: QueryHojasRutaDto) {
    const user = req.user as JwtUser;
    return this.service.lista(user.tenantId!, q);
  }

  // Las rutas estáticas (`resumen`, `escanear`, `asignar`) van antes de `:id`.
  @Get('resumen')
  resumen(@Req() req: Request, @Query() q: QueryHojasRutaDto) {
    const user = req.user as JwtUser;
    return this.service.resumen(user.tenantId!, q);
  }

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

  @Get(':id')
  detalle(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.detalle(user.tenantId!, id);
  }

  @Patch(':id/paquetes/:paqueteId')
  marcar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paqueteId', ParseUUIDPipe) paqueteId: string,
    @Body() dto: MarcarLineaDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.marcar(
      user.tenantId!,
      id,
      paqueteId,
      dto.estado,
      dto.medioCobro,
    );
  }

  @Post(':id/entregar-todos')
  @HttpCode(200)
  entregarTodos(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.entregarTodos(user.tenantId!, id);
  }

  @Delete(':id/paquetes/:paqueteId')
  quitar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paqueteId', ParseUUIDPipe) paqueteId: string,
  ) {
    const user = req.user as JwtUser;
    return this.service.quitar(user.tenantId!, id, paqueteId);
  }
}
