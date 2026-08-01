import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { MotivosDiferenciaInventarioService } from './motivos-diferencia-inventario.service';
import { CreateMotivoDiferenciaInventarioDto } from './dto/create-motivo-diferencia-inventario.dto';
import { UpdateMotivoDiferenciaInventarioDto } from './dto/update-motivo-diferencia-inventario.dto';
import { QueryMotivosDiferenciaInventarioDto } from './dto/query-motivos-diferencia-inventario.dto';
import { RestaurarDto } from '../../common/dto/restaurar.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('motivos-diferencia-inventario')
export class MotivosDiferenciaInventarioController {
  constructor(private readonly service: MotivosDiferenciaInventarioService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query() query: QueryMotivosDiferenciaInventarioDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.findAll(
      user.tenantId,
      query.soloActivas ?? false,
      query.incluirEliminados,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(
    @Req() req: Request,
    @Body() dto: CreateMotivoDiferenciaInventarioDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.create(user.tenantId, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateMotivoDiferenciaInventarioDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.service.update(user.tenantId, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.service.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre
  // que la fila ya tenía, que es como llaman las pantallas sin colisión.
  @Post(':id/restaurar')
  restaurar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: RestaurarDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.restaurar(user.tenantId!, id, dto.nombre);
  }
}
