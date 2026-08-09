import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
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
import { AddModuleDto } from './dto/add-module.dto';
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';
import { UpdatePreferenciasFinancierasDto } from './dto/update-preferencias-financieras.dto';

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
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  @Post(':id/modules')
  addModule(@Param('id') id: string, @Body() dto: AddModuleDto) {
    return this.tenantsService.addModule(id, dto.moduloAppId);
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

  @Get('members')
  findMembers(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findMembers(user.tenantId);
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
   * Devuelve `invitado: true` **solo** cuando la cuenta se creó y salió el mail
   * con el link. Si el correo ya existía, la cuenta es de esa persona: no se le
   * toca la contraseña ni se le manda nada.
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
    @Param('userId') userId: string,
    @Body() dto: MarcarTotemDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.marcarTotem(user.tenantId, userId, dto.esTotem);
  }

  @UseGuards(TenantAdminGuard)
  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(@Req() req: Request, @Param('userId') userId: string) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.removeMember(user.tenantId, userId);
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
    @Param('id') id: string,
    @Body() dto: UpdateRazonSocialDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.updateRazonSocial(user.tenantId, id, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Delete('razones-sociales/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRazonSocial(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.removeRazonSocial(user.tenantId, id);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
  @Patch('razones-sociales/:id/preferida')
  setPreferida(@Req() req: Request, @Param('id') id: string) {
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
    @Body() dto: UpdatePreferenciasFinancierasDto,
  ) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.updatePreferenciasFinancieras(
      user.tenantId,
      dto,
    );
  }
}
