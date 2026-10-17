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
import { ConceptosMovimientoCajaService } from './conceptos-movimiento-caja.service';
import { CreateConceptoMovimientoCajaDto } from './dto/create-concepto-movimiento-caja.dto';
import { UpdateConceptoMovimientoCajaDto } from './dto/update-concepto-movimiento-caja.dto';
import { RestaurarDto } from '../../common/dto/restaurar.dto';
import { QueryConceptosMovimientoCajaDto } from './dto/query-conceptos-movimiento-caja.dto';

// Config del tenant: la lectura es abierta a todo miembro (la cajera los ve como
// atajos en el drawer de movimientos), las escrituras son del admin.
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('conceptos-movimiento-caja')
export class ConceptosMovimientoCajaController {
  constructor(private readonly service: ConceptosMovimientoCajaService) {}

  @Get()
  findAll(
    @Req() req: Request,
    @Query() query: QueryConceptosMovimientoCajaDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.findAll(
      user.tenantId!,
      query.soloActivas ?? false,
      query.incluirEliminados,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Post()
  create(@Req() req: Request, @Body() dto: CreateConceptoMovimientoCajaDto) {
    const user = req.user as JwtUser;
    return this.service.create(user.tenantId!, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConceptoMovimientoCajaDto,
  ) {
    const user = req.user as JwtUser;
    return this.service.update(user.tenantId!, id, dto);
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.service.remove(user.tenantId!, user.id, id);
  }

  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre que la fila ya tenía.
  @UseGuards(TenantAdminGuard)
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
