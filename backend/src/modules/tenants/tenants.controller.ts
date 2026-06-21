import {
  Controller,
  Get,
  Post,
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
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { AddModuleDto } from './dto/add-module.dto';

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

  @Get('members')
  findMembers(@Req() req: Request) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.findMembers(user.tenantId);
  }

  @Post('members')
  addMember(@Req() req: Request, @Body() dto: AddMemberDto) {
    const user = req.user as { tenantId: string };
    return this.tenantsService.addMember(user.tenantId, dto.usuarioId);
  }

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
}
