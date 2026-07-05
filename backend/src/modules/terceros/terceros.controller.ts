import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { TercerosService } from './terceros.service';
import { CreateTerceroDto } from './dto/create-tercero.dto';
import { UpdateTerceroDto } from './dto/update-tercero.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('terceros')
export class TercerosController {
  constructor(private readonly tercerosService: TercerosService) {}

  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.findAll(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateTerceroDto) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateTerceroDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.tercerosService.remove(user.tenantId, id);
  }
}
