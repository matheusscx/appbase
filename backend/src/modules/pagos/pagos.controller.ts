import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { PagosService } from './pagos.service';
import { CreatePagoDto } from './dto/create-pago.dto';
import { QueryPagosDto } from './dto/query-pagos.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';

@ApiTags('pagos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('pagos')
export class PagosController {
  constructor(private readonly pagosService: PagosService) {}

  @Get('resumen')
  @RequiresPermiso('Pagos', 'Leer')
  resumen(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.pagosService.resumen(user.tenantId!);
  }

  @Get()
  @RequiresPermiso('Pagos', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryPagosDto) {
    const user = req.user as JwtUser;
    return this.pagosService.listar(user.tenantId!, query);
  }

  @Post()
  @RequiresPermiso('Pagos', 'Crear')
  registrarAbono(@Req() req: Request, @Body() dto: CreatePagoDto) {
    const user = req.user as JwtUser;
    return this.pagosService.registrarAbono(user.tenantId!, user.id, dto);
  }
}
