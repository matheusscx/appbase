import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { RepartidoresService } from './repartidores.service';
import { CreateRepartidorDto } from './dto/create-repartidor.dto';
import { UpdateRepartidorDto } from './dto/update-repartidor.dto';

@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Controller('repartidores')
export class RepartidoresController {
  constructor(private readonly service: RepartidoresService) {}

  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.service.findAll(user.tenantId!);
  }

  @Post()
  create(@Req() req: Request, @Body() dto: CreateRepartidorDto) {
    const user = req.user as JwtUser;
    return this.service.create(user.tenantId!, dto);
  }

  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepartidorDto,
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
