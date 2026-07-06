import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { SuscripcionesService } from './suscripciones.service';
import { CreateSuscripcionDto } from './dto/create-suscripcion.dto';
import { UpdateSuscripcionDto } from './dto/update-suscripcion.dto';

@ApiTags('suscripciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('suscripciones')
export class SuscripcionesController {
  constructor(private readonly suscripcionesService: SuscripcionesService) {}

  @Post()
  crear(@Req() req: Request, @Body() dto: CreateSuscripcionDto) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.crear(u.tenantId ?? '', u.id, dto);
  }

  @Get()
  findMias(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.findMias(u.tenantId ?? '', u.id);
  }

  @Patch(':id')
  cambiarEstado(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateSuscripcionDto,
  ) {
    const u = req.user as JwtUser;
    return this.suscripcionesService.cambiarEstado(
      u.tenantId ?? '',
      u.id,
      id,
      dto,
    );
  }
}
