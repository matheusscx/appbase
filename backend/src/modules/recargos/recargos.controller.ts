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
import { RecargosService } from './recargos.service';
import { CreateRecargoDto } from './dto/create-recargo.dto';
import { UpdateRecargoDto } from './dto/update-recargo.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('recargos')
export class RecargosController {
  constructor(private readonly recargosService: RecargosService) {}

  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.recargosService.findAll(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateRecargoDto) {
    const user = req.user as { tenantId: string };
    return this.recargosService.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateRecargoDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.recargosService.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.recargosService.remove(user.tenantId, id);
  }
}
