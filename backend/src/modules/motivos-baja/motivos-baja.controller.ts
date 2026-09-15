import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { MotivosBajaService } from './motivos-baja.service';
import { CreateMotivoBajaDto } from './dto/create-motivo-baja.dto';
import { UpdateMotivoBajaDto } from './dto/update-motivo-baja.dto';
import { QueryMotivosBajaDto } from './dto/query-motivos-baja.dto';
import { RestaurarDto } from '../../common/dto/restaurar.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('motivos-baja')
export class MotivosBajaController {
  constructor(private readonly service: MotivosBajaService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: QueryMotivosBajaDto) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(
      user.tenantId,
      query.soloActivas ?? false,
      query.incluirEliminados,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateMotivoBajaDto) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMotivoBajaDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre
  // que la fila ya tenía, que es como llaman las pantallas sin colisión.
  @Post(':id/restaurar')
  restaurar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestaurarDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.restaurar(user.tenantId!, id, dto.nombre);
  }
}
