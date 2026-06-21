import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantAdminGuard } from '../../common/guards/tenant-admin.guard';
import { RolesService } from './roles.service';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';
import { AssignUserDto } from './dto/assign-user.dto';
import { JwtUser } from '../../common/interfaces/jwt-user.interface';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  findAll(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.rolesService.findAll(user.tenantId!);
  }

  @Get('modulos-disponibles')
  findModulosDisponibles(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.rolesService.findModulosDisponibles(user.tenantId!);
  }

  @Post()
  @UseGuards(TenantAdminGuard)
  create(@Req() req: Request, @Body() dto: CreateRolDto) {
    const user = req.user as JwtUser;
    return this.rolesService.create(user.tenantId!, dto);
  }

  @Patch(':id')
  @UseGuards(TenantAdminGuard)
  update(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: UpdateRolDto,
  ) {
    const user = req.user as JwtUser;
    return this.rolesService.update(id, user.tenantId!, dto);
  }

  @Delete(':id')
  @UseGuards(TenantAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.rolesService.remove(id, user.tenantId!);
  }

  @Post(':id/users')
  @UseGuards(TenantAdminGuard)
  assignUser(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() dto: AssignUserDto,
  ) {
    const user = req.user as JwtUser;
    return this.rolesService.assignUser(id, user.tenantId!, dto.usuarioId);
  }

  @Delete(':id/users/:userId')
  @UseGuards(TenantAdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeUser(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    const user = req.user as JwtUser;
    return this.rolesService.removeUser(id, user.tenantId!, userId);
  }

  @Get(':id/permissions')
  findPermissions(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as JwtUser;
    return this.rolesService.findPermissions(id, user.tenantId!);
  }

  @Put(':id/modules/:moduloTenantId/permissions')
  @UseGuards(TenantAdminGuard)
  setPermissions(
    @Param('id') id: string,
    @Param('moduloTenantId') moduloTenantId: string,
    @Req() req: Request,
    @Body() body: { moduloAppPermisoIds: string[] },
  ) {
    const user = req.user as JwtUser;
    return this.rolesService.setPermissions(
      id,
      moduloTenantId,
      user.tenantId!,
      body.moduloAppPermisoIds,
    );
  }
}
