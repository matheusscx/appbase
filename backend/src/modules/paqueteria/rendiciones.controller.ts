import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { RendicionesService } from './rendiciones.service';
import { RendirDto } from './dto/rendir.dto';
import {
  QueryPreviaRendicionDto,
  QueryRendicionesDto,
} from './dto/query-rendiciones.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('rendiciones')
export class RendicionesController {
  constructor(private readonly service: RendicionesService) {}

  @Get()
  lista(@Req() req: Request, @Query() q: QueryRendicionesDto) {
    const user = req.user as JwtUser;
    return this.service.lista(user.tenantId!, q);
  }

  // `previa` va antes de `:id`: el orden de registro decide qué ruta gana.
  @Get('previa')
  previa(@Req() req: Request, @Query() q: QueryPreviaRendicionDto) {
    const user = req.user as JwtUser;
    return this.service.previa(user.tenantId!, q.repartidorId, q.hojaIds);
  }

  @Post()
  rendir(@Req() req: Request, @Body() dto: RendirDto) {
    const user = req.user as JwtUser;
    return this.service.rendir(user.tenantId!, dto, user.id);
  }

  @Get(':id')
  detalle(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.detalle(user.tenantId!, id);
  }
}
