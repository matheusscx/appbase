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
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { QueryIncluirEliminadosDto } from '../../common/dto/query-incluir-eliminados.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { GarzonesService } from './garzones.service';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { QuerySelectorGarzonesDto } from './dto/query-selector-garzones.dto';
import { CredencialGarzonDto } from '../../common/dto/credencial-garzon.dto';

/**
 * Gestión de garzones. Reutiliza el módulo RBAC `Salones`: el CRUD de
 * administración usa las acciones Leer/Crear/Actualizar/Eliminar; la
 * identificación operativa por PIN usa `Operar`.
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('garzones')
export class GarzonesController {
  constructor(private readonly garzonesService: GarzonesService) {}

  @Get()
  @RequiresPermiso('Salones', 'Leer')
  listar(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.listar(user.tenantId, query.incluirEliminados);
  }

  @Post()
  @RequiresPermiso('Salones', 'Crear')
  crear(@Req() req: Request, @Body() dto: CreateGarzonDto) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.crear(user.tenantId, dto);
  }

  @Patch(':id')
  @RequiresPermiso('Salones', 'Actualizar')
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateGarzonDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.actualizar(user.tenantId, id, dto);
  }

  /** Regenera el PIN del garzón y lo devuelve una sola vez. */
  @Patch(':id/pin')
  @RequiresPermiso('Salones', 'Actualizar')
  regenerarPin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.regenerarPin(user.tenantId, id);
  }

  @Delete(':id')
  @RequiresPermiso('Salones', 'Eliminar')
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.eliminar(user.tenantId!, user.id, id);
  }

  @Post(':id/restaurar')
  @RequiresPermiso('Salones', 'Eliminar')
  restaurar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.restaurar(user.tenantId!, id);
  }

  /**
   * Verifica el PIN **sin ejecutar ninguna acción**. Existe para que el modal
   * muestre "PIN inválido" en línea y el usuario reintente sin perder lo que
   * estaba haciendo: si el PIN se validara recién dentro de la acción, el modal
   * ya se habría cerrado y el error saldría como toast, con la acción
   * descartada.
   *
   * Reemplaza a `POST /identificar`, que hacía lo mismo **sin** `garzonId` y
   * por eso costaba N bcrypt. Acá cuesta 1.
   */
  @Post('verificar-pin')
  @RequiresPermiso('Salones', 'Operar')
  @HttpCode(HttpStatus.OK)
  async verificarPin(@Req() req: Request, @Body() dto: CredencialGarzonDto) {
    const user = req.user as JwtUser;
    const garzon = await this.garzonesService.verificarPin(
      user.tenantId!,
      dto.garzonId,
      dto.pin,
    );
    return { garzonId: garzon.id, nombre: garzon.nombre };
  }

  /**
   * En qué modo está este dispositivo: devuelve el garzón vinculado a la cuenta
   * logueada, o `null` si hay que pedir PIN. Lo consulta la pantalla del salón
   * una vez, al cargar.
   *
   * `Salones:Operar` por el mismo motivo que `para-selector`: lo necesita quien
   * opera, que puede no tener `Leer`.
   */
  @Get('mi-vinculo')
  @RequiresPermiso('Salones', 'Operar')
  miVinculo(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.garzonesService.miVinculo(user.tenantId!, user.id);
  }

  /**
   * La lista del selector previo al teclado de PIN. `Salones:Operar` y no
   * `Leer`: los roles son configurables por tenant, así que nada impide un rol
   * que opere el salón sin poder leer el catálogo de garzones — y es
   * exactamente quien necesita esta lista.
   */
  @Get('para-selector')
  @RequiresPermiso('Salones', 'Operar')
  listarParaSelector(
    @Req() req: Request,
    @Query() query: QuerySelectorGarzonesDto,
  ) {
    const user = req.user as JwtUser;
    return this.garzonesService.listarParaSelector(
      user.tenantId!,
      query.enTurno,
    );
  }
}
