import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../common/interfaces/jwt-user.interface';
import { RbacService } from '../rbac/rbac.service';
import { CajaService } from './caja.service';
import { CajaTestigoService } from './caja-testigo.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { QueryMovimientosCajaDto } from './dto/query-movimientos-caja.dto';
import { QueryHistorialCajaDto } from './dto/query-historial-caja.dto';
import { SetArqueoCiegoDto } from './dto/set-arqueo-ciego.dto';
import { JustificarDiferenciasDto } from './dto/justificar-diferencias.dto';
import { FinalizarCierreDto } from './dto/finalizar-cierre.dto';
import { SolicitarTestigoDto } from './dto/solicitar-testigo.dto';
import { ResolverTestigoDto } from './dto/resolver-testigo.dto';
import { CredencialGarzonOpcionalDto } from '../../common/dto/credencial-garzon.dto';

@ApiTags('caja')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('caja')
export class CajaController {
  constructor(
    private readonly cajaService: CajaService,
    private readonly cajaTestigoService: CajaTestigoService,
    private readonly rbacService: RbacService,
  ) {}

  /**
   * Endpoints de lectura que sirven tanto al dueño (módulo MiCaja) como al
   * supervisor (módulo Cajas). Devuelve `verTodas=true` si el usuario tiene
   * `Cajas:Leer`; lanza 403 si no tiene ni `MiCaja:Leer` ni `Cajas:Leer`.
   * El alcance (propia vs. todas) y la escritura owner-only los sigue
   * resolviendo el service.
   */
  private async resolverLecturaCompartida(u: JwtUser): Promise<boolean> {
    const [tieneMiCaja, tieneCajas] = await Promise.all([
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'MiCaja', 'Leer'),
      this.rbacService.userHasPermiso(u.id, u.tenantId!, 'Cajas', 'Leer'),
    ]);
    if (!tieneMiCaja && !tieneCajas) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    return tieneCajas;
  }

  /**
   * ¿Al usuario NO le aplica el modo ciego? El admin del tenant y el superadmin
   * ven el esperado/movimientos en vivo aun en caja abierta (§3.4 del spec
   * header-caja-ciego): el dueño no es el objetivo del anti-fraude. El superadmin
   * sale del token; el admin del tenant vía RBAC (mismo criterio que `cerrar`).
   */
  private async esAdminTenant(u: JwtUser): Promise<boolean> {
    return (
      u.esSuperadmin ||
      (await this.rbacService.userIsTenantAdmin(u.id, u.tenantId!))
    );
  }

  @Get()
  async historial(@Req() req: Request, @Query() query: QueryHistorialCajaDto) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    const consultaOtroUsuario =
      query.usuarioId != null && query.usuarioId !== u.id;
    const scope =
      query.todas || consultaOtroUsuario || query.cajonId != null
        ? verTodas
        : false;
    return this.cajaService.historial(u.tenantId!, u.id, query, scope);
  }

  @Get('activa')
  @RequiresPermiso('MiCaja', 'Leer')
  activa(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.findActiva(u.tenantId!, u.id);
  }

  @Get('cajones-estado')
  @RequiresPermiso('Cajas', 'Leer')
  async cajonesEstado(@Req() req: Request) {
    const u = req.user as JwtUser;
    // Endpoint exclusivo de supervisión: quien llega tiene Cajas:Leer → ve todos.
    // `esAdmin` no gatea el acceso, solo si el modo ciego le retiene el esperado.
    const esAdmin = await this.esAdminTenant(u);
    return this.cajaService.cajonesEstado(u.tenantId!, u.id, esAdmin);
  }

  @Get('cajones-disponibles')
  @RequiresPermiso('MiCaja', 'Crear')
  cajonesDisponibles(@Req() req: Request) {
    const u = req.user as JwtUser;
    return this.cajaService.cajonesDisponibles(u.tenantId!, u.id);
  }

  @Get('arqueo-ciego')
  @RequiresPermiso('Cajas', 'Leer')
  async getArqueoCiego(@Req() req: Request) {
    const u = req.user as JwtUser;
    const arqueoCiego = await this.cajaService.getArqueoCiego(u.tenantId!);
    return { arqueoCiego };
  }

  @Put('arqueo-ciego')
  @UseGuards(TenantAdminGuard)
  async setArqueoCiego(@Req() req: Request, @Body() dto: SetArqueoCiegoDto) {
    const u = req.user as JwtUser;
    await this.cajaService.setArqueoCiego(u.tenantId!, dto.arqueoCiego);
    return { arqueoCiego: dto.arqueoCiego };
  }

  @Get(':id/arqueo')
  async arqueo(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const [verTodas, esAdmin] = await Promise.all([
      this.resolverLecturaCompartida(u),
      this.esAdminTenant(u),
    ]);
    return this.cajaService.obtenerArqueo(
      u.tenantId!,
      u.id,
      cajaId,
      verTodas,
      esAdmin,
    );
  }

  @Patch(':id/arqueo/motivos')
  @UseGuards(TenantAdminGuard)
  justificarDiferencias(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: JustificarDiferenciasDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.justificarDiferencias(
      u.tenantId!,
      cajaId,
      dto.lineas,
    );
  }

  @Get(':id')
  async detalle(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const verTodas = await this.resolverLecturaCompartida(u);
    return this.cajaService.findOne(u.tenantId!, u.id, cajaId, verTodas);
  }

  @Post('abrir')
  @RequiresPermiso('MiCaja', 'Crear')
  abrir(@Req() req: Request, @Body() dto: AbrirCajaDto) {
    const u = req.user as JwtUser;
    return this.cajaService.abrir(u.tenantId!, u.id, dto);
  }

  @Post(':id/movimientos')
  @RequiresPermiso('MiCaja', 'Crear')
  registrarMovimiento(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CrearMovimientoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.registrarMovimiento(u.tenantId!, u.id, cajaId, dto);
  }

  /**
   * Cierre forzado: NO lleva `TenantAdminGuard` (bloquearía al cajero dueño)
   * por la misma razón que `cerrar` — el piso de permiso es
   * `MiCaja:Actualizar` y `esAdmin` se computa aparte para permitir además a
   * un admin no-dueño cerrar la caja de otro.
   */
  @Post(':id/conteo')
  @RequiresPermiso('MiCaja', 'Actualizar')
  async enviarConteo(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    const u = req.user as JwtUser;
    const esAdmin = await this.rbacService.userIsTenantAdmin(u.id, u.tenantId!);
    return this.cajaService.enviarConteo(
      u.tenantId!,
      u.id,
      cajaId,
      dto,
      esAdmin,
    );
  }

  /**
   * Fase 2 del cierre: finaliza una caja `en_conciliacion`. Owner-o-admin, por
   * eso NO lleva `TenantAdminGuard` (bloquearía al cajero dueño) — el piso de
   * permiso es `MiCaja:Actualizar` y `esAdmin` se computa aparte, con el mismo
   * criterio que `TenantAdminGuard` (`rbacService.userIsTenantAdmin`), para
   * permitir además a un admin no-dueño finalizar la conciliación.
   */
  @Post(':id/cerrar')
  @RequiresPermiso('MiCaja', 'Actualizar')
  async cerrar(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: FinalizarCierreDto,
  ) {
    const u = req.user as JwtUser;
    const esAdmin = await this.rbacService.userIsTenantAdmin(u.id, u.tenantId!);
    return this.cajaService.cerrar(u.tenantId!, u.id, cajaId, esAdmin, dto);
  }

  /** El encargado pide la firma. Requiere `Cajas:Actualizar` — primera ruta que lo usa. */
  @Post(':id/testigos')
  @RequiresPermiso('Cajas', 'Actualizar')
  solicitarTestigos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: SolicitarTestigoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.solicitar(
      u.tenantId!,
      u.id,
      cajaId,
      dto.garzonIds,
    );
  }

  /**
   * El garzón resuelve la SUYA. Ojo: NO lleva `Cajas:Actualizar` a propósito
   * — el garzón no tiene permisos de caja. Sí lleva `Salones:Operar`
   * (revisión independiente, ronda 3 — CRITICAL: sin ningún guard, cualquier
   * token válido del tenant llegaba al handler): es el mismo piso que
   * `salones.controller.ts` exige para el resto de esa pantalla, y el seed
   * se lo da tanto al tótem como a la cuenta personal, así que no bloquea a
   * nadie que hoy pueda operar el salón. El permiso de módulo NO reemplaza
   * la prueba de identidad — son ortogonales: `Salones:Operar` decide quién
   * puede pisar la pantalla, `resolver` decide de qué garzón puede hablar
   * (cuenta vinculada o PIN). Se manda `u.id` (quién llamó) como el dato que
   * `resolver` necesita para las dos vías: si el garzón está vinculado a una
   * cuenta, esa cuenta TIENE que ser `u.id` (prueba fuerte); si no, la
   * identidad se prueba con el PIN y `u.id` solo queda como el hecho crudo
   * de qué cuenta lo tecleó — casi siempre la del tótem, no la de un garzón
   * sin cuenta propia.
   */
  @Post('testigos/:testigoId/resolver')
  @RequiresPermiso('Salones', 'Operar')
  resolverTestigo(
    @Req() req: Request,
    @Param('testigoId') testigoId: string,
    @Body() dto: ResolverTestigoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.resolver(u.tenantId!, testigoId, u.id, dto);
  }

  /**
   * Lo que el garzón ve al entrar a su pantalla (`/salones`). `Salones:Operar`
   * (mismo motivo que `resolverTestigo` arriba — CRITICAL de la ronda 3: sin
   * guard exponía montos contados de cualquier caja a cualquier usuario del
   * tenant).
   *
   * POST con `CredencialGarzonOpcionalDto` en el body, no GET con `garzonId`
   * de ruta (revisión independiente, ronda 4 — CRITICAL: la cuenta del
   * tótem, que SÍ tiene `Salones:Operar`, podía pedir las pendientes de
   * CUALQUIER `garzonId` enumerado del selector del salón). Mismo patrón que
   * `sesiones-garzon.controller.ts` → `activa`: sin vínculo personal, el
   * service EXIGE `garzonId` + PIN verificado por `bcrypt.compare` — la
   * misma pantalla de siempre (elegir nombre, PIN, ver lo tuyo), no un paso
   * nuevo.
   */
  @Post('testigos/pendientes')
  @RequiresPermiso('Salones', 'Operar')
  pendientesDeGarzon(
    @Req() req: Request,
    @Body() dto: CredencialGarzonOpcionalDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.pendientesDeGarzon(u.tenantId!, u.id, dto);
  }

  /**
   * Estado de las solicitudes de testigo de una caja (Task 6): lo que el
   * encargado mira mientras espera la firma. `Cajas:Leer` — lectura de
   * supervisión, igual que `arqueo`/`cajones-estado`. Nunca `esperado` ni
   * monto: eso lo cubre `arqueo`, esto es solo estado.
   */
  @Get(':id/testigos')
  @RequiresPermiso('Cajas', 'Leer')
  listarTestigos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.listar(u.tenantId!, cajaId);
  }

  @Get(':id/movimientos/resumen')
  async resumenMovimientos(@Req() req: Request, @Param('id') cajaId: string) {
    const u = req.user as JwtUser;
    const [verTodas, esAdmin] = await Promise.all([
      this.resolverLecturaCompartida(u),
      this.esAdminTenant(u),
    ]);
    return this.cajaService.resumenMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      verTodas,
      esAdmin,
    );
  }

  @Get(':id/movimientos')
  async listarMovimientos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Query() query: QueryMovimientosCajaDto,
  ) {
    const u = req.user as JwtUser;
    const [verTodas, esAdmin] = await Promise.all([
      this.resolverLecturaCompartida(u),
      this.esAdminTenant(u),
    ]);
    return this.cajaService.listarMovimientos(
      u.tenantId!,
      u.id,
      cajaId,
      query,
      verTodas,
      esAdmin,
    );
  }
}
