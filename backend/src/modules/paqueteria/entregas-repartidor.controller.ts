import {
  Body,
  Controller,
  Delete,
  Get,
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
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { EntregasRepartidorService } from './entregas-repartidor.service';
import { CreateEntregaRepartidorDto } from './dto/create-entrega-repartidor.dto';
import { UpdateEntregaRepartidorDto } from './dto/update-entrega-repartidor.dto';
import { QueryEntregasRepartidorDto } from './dto/query-entregas-repartidor.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('entregas-repartidor')
export class EntregasRepartidorController {
  constructor(private readonly service: EntregasRepartidorService) {}

  @Get()
  listar(@Req() req: Request, @Query() q: QueryEntregasRepartidorDto) {
    const user = req.user as JwtUser;
    return this.service.listar(user.tenantId!, q);
  }

  @Post()
  crear(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: CreateEntregaRepartidorDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.crear(user.tenantId!, dto, user.id);
  }

  @Patch(':id')
  actualizar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: UpdateEntregaRepartidorDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.actualizar(user.tenantId!, id, dto);
  }

  @Delete(':id')
  anular(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.anular(user.tenantId!, id);
  }
}
