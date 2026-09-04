import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { QueryIncluirEliminadosDto } from '../../common/dto/query-incluir-eliminados.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { CajonesService } from './cajones.service';
import { RestaurarDto } from '../../common/dto/restaurar.dto';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';
import { SetCajonUsuariosDto } from './dto/set-cajon-usuarios.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('cajones')
export class CajonesController {
  constructor(private readonly cajonesService: CajonesService) {}

  @RequiresPermiso('Cajas', 'Leer')
  @Get()
  findAll(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.findAll(user.tenantId, query.incluirEliminados);
  }

  @RequiresPermiso('Cajas', 'Crear')
  @Post()
  create(@Req() req: Request, @Body() dto: CreateCajonDto) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.create(user.tenantId, dto);
  }

  @RequiresPermiso('Cajas', 'Actualizar')
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCajonDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.update(user.tenantId, id, dto);
  }

  @RequiresPermiso('Cajas', 'Eliminar')
  @Delete(':id')
  remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as JwtUser;
    return this.cajonesService.remove(user.tenantId!, user.id, id);
  }

  // `RestaurarDto` es 100% opcional: sin body se restaura con el nombre que la
  // fila ya tenía, que es como llaman las pantallas sin colisión.
  @RequiresPermiso('Cajas', 'Eliminar')
  @Post(':id/restaurar')
  restaurar(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestaurarDto,
  ) {
    const user = req.user as JwtUser;
    return this.cajonesService.restaurar(user.tenantId!, id, dto.nombre);
  }

  @RequiresPermiso('Cajas', 'Leer')
  @Get(':id/usuarios')
  getUsuarios(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.getUsuarios(user.tenantId, id);
  }

  @RequiresPermiso('Cajas', 'Actualizar')
  @Put(':id/usuarios')
  setUsuarios(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetCajonUsuariosDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.cajonesService.setUsuarios(user.tenantId, id, dto.usuarioIds);
  }
}
