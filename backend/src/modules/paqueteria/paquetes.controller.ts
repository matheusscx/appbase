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
import { PaquetesService } from './paquetes.service';
import { CreatePaqueteDto } from './dto/create-paquete.dto';
import { UpdatePaqueteDto } from './dto/update-paquete.dto';
import { QueryPaquetesDto } from './dto/query-paquetes.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('paquetes')
export class PaquetesController {
  constructor(private readonly service: PaquetesService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: QueryPaquetesDto) {
    const user = req.user as JwtUser;
    return this.service.findAll(user.tenantId!, query);
  }

  @Post()
  create(@Req() req: Request, @Body(EscalaMonedaPipe) dto: CreatePaqueteDto) {
    const user = req.user as JwtUser;
    return this.service.create(user.tenantId!, dto);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(EscalaMonedaPipe) dto: UpdatePaqueteDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.update(user.tenantId!, id, dto);
  }

  @Delete(':id')
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.remove(user.tenantId!, id);
  }
}
