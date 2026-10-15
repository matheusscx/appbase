import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperadminGuard } from '../../common/guards/superadmin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  type BoletaConProblemaSoporte,
  ColaDteService,
} from './cola-dte.service';

/**
 * El panel de soporte de las boletas electrónicas: lo que anda mal en el SII, de todos los
 * tenants. Mismo par de guards que `AdminTenantsController` de `/admin/tenants`: es el eje
 * superadmin, por eso no lleva `TenantGuard` ni recibe tenant de ningún lado.
 */
@UseGuards(JwtAuthGuard, SuperadminGuard)
@Controller('admin/dte')
export class SoporteDteController {
  constructor(private readonly cola: ColaDteService) {}

  @Get('boletas-con-problemas')
  boletasConProblemas(): Promise<BoletaConProblemaSoporte[]> {
    return this.cola.problemasDeTodos();
  }
}
