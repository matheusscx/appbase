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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperadminGuard } from '../../common/guards/superadmin.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateMyTenantDto } from './dto/update-my-tenant.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { CrearUsuarioTenantDto } from './dto/crear-usuario-tenant.dto';
import { MarcarTotemDto } from './dto/marcar-totem.dto';
import { BajaMiembroDto } from './dto/baja-miembro.dto';
import { AddModuleDto } from './dto/add-module.dto';
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';
import { UpdatePreferenciasFinancierasDto } from './dto/update-preferencias-financieras.dto';
import { EscalaMonedaPipe } from '../../common/pipes/escala-moneda.pipe';

// ─────────────────────────────────────────────────────────────────────────────
// Admin routes — /admin/tenants
// ─────────────────────────────────────────────────────────────────────────────
@UseGuards(JwtAuthGuard, SuperadminGuard)
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  create(@Body() dto: CreateTenantDto, @Req() req: Request) {
    const user = req.user as { id: string };
    return this.tenantsService.create(dto, user.id);
  }

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.remove(id);
  }

  @Post(':id/modules')
  addModule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddModuleDto) {
    return this.tenantsService.addModule(id, dto.moduloAppId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rutas públicas — /tenants/confirmacion
//
// Controller propio y no dos handlers en `TenantsController`: aquel lleva
// `@UseGuards(JwtAuthGuard, TenantGuard)` **a nivel de clase**, y estas dos las
// usa justamente alguien que todavía no es miembro de ese tenant —así que no
// tiene un JWT que lo pruebe—. La prueba de identidad acá es el token del link,
// como en `/auth/invitacion/:token`.
// ─────────────────────────────────────────────────────────────────────────────
@Controller('tenants/confirmacion')
export class TenantsConfirmacionController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * ⚠️ Estos `@Param('token')` van **sin `ParseUUIDPipe`**, y no es un olvido: el
   * resto de los `@Param` del backend sí lo lleva (`docs/patterns/backend.md` § 4).
   *
   * El token de un link **no es un UUID**: sale de
   * `randomBytes(32).toString('base64url')` en `tokens-acceso.service.ts`, o sea
   * 43 caracteres de base64url. Ponerle el pipe devolvería 400 a *todos* los links
   * válidos de verificación, invitación y reset.
   */
  /** Lo que necesita la pantalla para preguntar "¿entrás a X?". No quema nada. */
  @Get(':token')
  verificar(@Param('token') token: string) {
    return this.tenantsService.verificarConfirmacion(token);
  }

  /** El sí: crea la membresía, asigna los roles congelados y quema el link. */
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  confirmar(@Param('token') token: string) {
    return this.tenantsService.confirmarIngreso(token);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tenant-active routes — /tenants
// ─────────────────────────────────────────────────────────────────────────────
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  findMine(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findMine(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Patch('me')
  updateMine(@Req() req: Request, @Body() dto: UpdateMyTenantDto) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.updateMine(user.tenantId, dto);
  }

  /**
   * El roster completo: correo y roles de cada miembro. **Admin-only**, como
   * las tres escrituras de `members/*` que tiene al lado.
   *
   * Era la única ruta de `members/*` sin el guard, y hasta 2026-08-09 el hueco
   * costaba armar la request a mano. Ese día `configuracion/garzones.vue` la
   * empezó a llamar al montar para poblar un selector, y el roster entero
   * —nombre, apellido y **correo** de cada miembro— pasó a renderizarse en un
   * dropdown para cualquier miembro autenticado. Quien necesita nombres y no
   * correos usa `members/para-selector`, acá abajo.
   *
   * La única pantalla que consume esto es `configuracion/usuarios`, que ya es
   * admin-only por middleware.
   */
  @UseGuards(TenantAdminGuard)
  @Get('members')
  findMembers(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findMembers(user.tenantId);
  }

  /**
   * Los nombres de las cuentas del tenant, sin correo ni roles. Lo consumen dos
   * selectores: quién puede abrir un cajón (`Cajas`) y a qué cuenta se vincula
   * un garzón (`Salones`).
   *
   * **Queda abierta a cualquier miembro autenticado del tenant, a propósito.**
   * Los dos consumidores viven en módulos de permiso distintos, así que ningún
   * `@RequiresPermiso` único los cubre; y lo que devuelve —los nombres de tus
   * propios compañeros de trabajo— no es un secreto que la app pueda guardar:
   * quien opera el salón los ve en el selector de garzones igual. Lo que sí es
   * secreto son el correo y los roles, y por eso no salen de acá.
   */
  @Get('members/para-selector')
  findMembersParaSelector(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findMembersParaSelector(user.tenantId);
  }

  // Alta y baja de miembros son administración del tenant, como todo lo que
  // toca `roles` y como `PATCH me` acá al lado: sin este guard bastaba con
  // estar autenticado y pertenecer al tenant. Un cajero podía sumar cuentas
  // y, peor, **eliminar al admin de su propio tenant** con un DELETE.
  @UseGuards(TenantAdminGuard)
  @Post('members')
  addMember(@Req() req: Request, @Body() dto: AddMemberDto) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.addMember(user.tenantId, dto.usuarioId);
  }

  /**
   * Alta de un usuario del tenant. Mismo guard que `members` —es administración
   * del tenant— y por eso **no** lleva `@RequiresPermiso`.
   *
   * Dos banderas en la respuesta, y **las dos pueden venir en `false`**:
   * - `invitado: true` — la cuenta se creó y salió el mail con el link para que
   *   elija contraseña.
   * - `pendienteConfirmacion: true` — el correo ya tenía una cuenta **con
   *   contraseña**, así que no se asoció nada: salió un mail "te están sumando a
   *   X" y la persona **todavía no es miembro**. Aparece igual en
   *   `GET /tenants/members`, marcada, para que el admin no crea que el alta
   *   falló.
   * - las dos en `false` — el correo tenía una cuenta invitada en otro lado que
   *   nunca eligió contraseña: se adopta y queda adentro sin mail.
   *
   * ⚠️ Hasta el 2026-08-15 esto afirmaba *"si el correo ya existía, la cuenta es
   * de esa persona"*, y esa premisa era falsa: cualquiera podía pre-registrar el
   * correo de un futuro empleado y heredar los roles del alta. Que el correo
   * coincida no prueba de quién es la cuenta — lo prueba el clic en el link.
   */
  @UseGuards(TenantAdminGuard)
  @Post('usuarios')
  crearUsuario(@Req() req: Request, @Body() dto: CrearUsuarioTenantDto) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.crearUsuario(user.tenantId, dto);
  }

  /**
   * Marca (o desmarca) una cuenta como **tótem compartido** de este tenant:
   * el dispositivo queda logueado y lo usan varias personas, así que la
   * identidad de quien opera no se presume del JWT y siempre se pide PIN.
   *
   * Administración del tenant, mismo guard que el resto de esta pantalla.
   */
  @UseGuards(TenantAdminGuard)
  @Patch('members/:userId/totem')
  marcarTotem(
    @Req() req: Request,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: MarcarTotemDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.marcarTotem(user.tenantId, userId, dto.esTotem);
  }

  /**
   * Da de baja una membresía.
   *
   * Devuelve `200` con cuerpo y no `204`: cuando la cuenta era la credencial
   * de un garzón que sigue trabajando, la respuesta trae el **PIN nuevo en
   * claro**, y es la única vez que existe fuera de la base. Sin eso, "se le
   * genera un PIN usable" no le sirve a nadie. Con `garzon: null` no pasó nada
   * de eso y el cuerpo es solo la confirmación.
   */
  @UseGuards(TenantAdminGuard)
  @Delete('members/:userId')
  removeMember(
    @Req() req: Request,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() dto: BajaMiembroDto,
  ) {
    const user = req.user as { id: string; tenantId: string };
    return this.tenantsService.removeMember(
      user.tenantId,
      userId,
      user.id,
      dto.garzon,
    );
  }

  @Get('modules')
  findModules(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findModules(user.tenantId);
  }

  @Get('razones-sociales')
  findRazonesSociales(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findRazonesSociales(user.tenantId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Post('razones-sociales')
  createRazonSocial(@Req() req: Request, @Body() dto: CreateRazonSocialDto) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.createRazonSocial(user.tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Patch('razones-sociales/:id')
  updateRazonSocial(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRazonSocialDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.updateRazonSocial(user.tenantId, id, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Delete('razones-sociales/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRazonSocial(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.removeRazonSocial(user.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Patch('razones-sociales/:id/preferida')
  setPreferida(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.setPreferida(user.tenantId, id);
  }

  @UseGuards(TenantAdminGuard)
  @Get('preferencias-financieras')
  getPreferenciasFinancieras(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.getPreferenciasFinancieras(user.tenantId);
  }

  @UseGuards(TenantAdminGuard)
  @Put('preferencias-financieras')
  updatePreferenciasFinancieras(
    @Req() req: Request,
    @Body(EscalaMonedaPipe) dto: UpdatePreferenciasFinancierasDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.updatePreferenciasFinancieras(
      user.tenantId,
      dto,
    );
  }
}
