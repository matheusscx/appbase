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
import {
  RequiresPermiso,
  RequiresAlgunPermiso,
} from '../../common/decorators/requires-permiso.decorator';
import { QueryListarGarzonesDto } from './dto/query-listar-garzones.dto';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { GarzonesService } from './garzones.service';
import { CreateGarzonDto } from './dto/create-garzon.dto';
import { UpdateGarzonDto } from './dto/update-garzon.dto';
import { FijarPinDto } from './dto/fijar-pin.dto';
import { QuerySelectorGarzonesDto } from './dto/query-selector-garzones.dto';
import { CredencialGarzonDto } from '../../common/dto/credencial-garzon.dto';

/**
 * Gestión de garzones. **Dos grupos de rutas con reglas distintas, y la
 * distinción es lo que importa acá** (2026-08-22):
 *
 * - **Administración** (listar, crear, editar, PIN, permiso-operar, borrar,
 *   restaurar): la habilita `Salones` **o** `Propinas`, cualquiera de los dos.
 *   El garzón no es una entidad de salones que las propinas usan de prestado:
 *   lo crea el alta de TODO tenant (`asegurarMostrador`), atiende mesas y cobra
 *   propinas. Colgarlo solo de `Salones` dejaba a un tenant que solo cobra
 *   propina directa sin poder abrir su propia pantalla de liquidación —esa
 *   pantalla lista garzones—, y colgarlo solo de `Propinas` habría roto en
 *   espejo al tenant con mesas y sin ese módulo.
 * - **Operación del salón** (`verificar-pin`, `mi-vinculo`, `para-selector`):
 *   siguen pidiendo `Salones:Operar`, y NO se les agregó la alternativa. Son el
 *   teclado de PIN de la pantalla del salón; el POS no las usa (la propina
 *   directa no toca ninguna ruta de garzones: el backend resuelve el Mostrador
 *   por su cuenta dentro de la venta).
 */
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('garzones')
export class GarzonesController {
  constructor(private readonly garzonesService: GarzonesService) {}

  /**
   * El garzón fija su propio PIN. **Sin `@RequiresPermiso`**: `PermisosGuard`
   * es `return true` sin el decorador (`permisos.guard.ts:24`), así que quedan
   * `JwtAuthGuard` + `TenantGuard`, que es exactamente lo que hace falta — un
   * garzón puede no tener ningún permiso de módulo.
   *
   * Vive acá y no en `MeController` porque ese controller **no tiene
   * `TenantGuard`**, y un garzón es por tenant: la misma persona puede ser
   * garzón en dos locales con PIN distintos.
   *
   * ⚠️ Declarada ANTES de `@Patch(':id')`: Nest resuelve por orden de
   * declaración, así que si `:id` fuera primero, `PATCH /garzones/mi-pin`
   * entraría por `actualizar` con `id = 'mi-pin'` y moriría en un 404 confuso.
   */
  @Patch('mi-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  fijarMiPin(@Req() req: Request, @Body() dto: FijarPinDto) {
    const user = req.user as JwtUser;
    return this.garzonesService.fijarMiPin(user.tenantId!, user.id, dto);
  }

  /**
   * Su propio estado e historia de PIN. Mismo criterio de guards que el PATCH,
   * y misma advertencia de orden respecto de cualquier `@Get(':id')` futuro.
   */
  @Get('mi-pin')
  miPin(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.garzonesService.miPin(user.tenantId!, user.id);
  }

  @Get()
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Leer' },
    { modulo: 'Propinas', permiso: 'Leer' },
  )
  listar(@Req() req: Request, @Query() query: QueryListarGarzonesDto) {
    const user = req.user as { tenantId: string };
    return this.garzonesService.listar(
      user.tenantId,
      query.incluirEliminados,
      query.conPermisos,
    );
  }

  @Post()
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Crear' },
    { modulo: 'Propinas', permiso: 'Crear' },
  )
  crear(@Req() req: Request, @Body() dto: CreateGarzonDto) {
    const user = req.user as JwtUser;
    return this.garzonesService.crear(user.tenantId!, user.id, dto);
  }

  @Patch(':id')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Actualizar' },
    { modulo: 'Propinas', permiso: 'Actualizar' },
  )
  actualizar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: UpdateGarzonDto,
  ) {
    const user = req.user as JwtUser;
    return this.garzonesService.actualizar(user.tenantId!, user.id, id, dto);
  }

  /**
   * Le da a la cuenta vinculada el permiso de operar el salón.
   *
   * El permiso de administración (`Salones` o `Propinas`, acción `Actualizar`)
   * y **no** `TenantAdminGuard`: es el mismo permiso con el que se vincula la
   * cuenta, y el aviso que dice *"…hasta que se lo des"*
   * se le muestra exactamente a quien tiene este permiso. Que ese aviso fuera
   * una instrucción que su lector podía no poder ejecutar es lo que esta ruta
   * cierra (decisión del owner, 2026-08-15).
   *
   * ⚠️ **No es "el encargado puede editar roles".** El alcance está fijado por
   * construcción: el permiso que se concede es uno solo, el rol que lo
   * transporta es de sistema —nadie puede agregarle nada, ni el admin— y la
   * cuenta que lo recibe sale de la fila del garzón, no del request.
   */
  @Post(':id/permiso-operar')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Actualizar' },
    { modulo: 'Propinas', permiso: 'Actualizar' },
  )
  otorgarPermisoOperar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.otorgarPermisoOperar(user.tenantId!, id);
  }

  /** Regenera el PIN del garzón y lo devuelve una sola vez. */
  @Patch(':id/pin')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Actualizar' },
    { modulo: 'Propinas', permiso: 'Actualizar' },
  )
  regenerarPin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.regenerarPin(user.tenantId!, user.id, id);
  }

  /**
   * La historia de PIN del garzón, para la ficha. `Salones:Leer` — el mismo
   * permiso con el que se lee el resto de la ficha.
   */
  @Get(':id/pin-eventos')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Leer' },
    { modulo: 'Propinas', permiso: 'Leer' },
  )
  listarEventosPin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.listarEventosPin(user.tenantId!, id);
  }

  @Delete(':id')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Eliminar' },
    { modulo: 'Propinas', permiso: 'Eliminar' },
  )
  eliminar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.eliminar(user.tenantId!, user.id, id);
  }

  @Post(':id/restaurar')
  @RequiresAlgunPermiso(
    { modulo: 'Salones', permiso: 'Eliminar' },
    { modulo: 'Propinas', permiso: 'Eliminar' },
  )
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
