import { Body, Controller, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MeService } from './me.service';
import { UpdatePerfilDto } from './dto/update-perfil.dto';
import { UpdateContrasenaDto } from './dto/update-contrasena.dto';
import { UpdatePreferenciasDto } from './dto/update-preferencias.dto';

interface JwtRequest extends Request {
  user: { id: string };
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Patch('perfil')
  updatePerfil(@Req() req: JwtRequest, @Body() dto: UpdatePerfilDto) {
    return this.meService.updatePerfil(req.user.id, dto);
  }

  @Patch('contrasena')
  updateContrasena(@Req() req: JwtRequest, @Body() dto: UpdateContrasenaDto) {
    return this.meService.updateContrasena(req.user.id, dto);
  }

  @Patch('preferencias')
  updatePreferencias(
    @Req() req: JwtRequest,
    @Body() dto: UpdatePreferenciasDto,
  ) {
    return this.meService.updatePreferencias(req.user.id, dto);
  }
}
