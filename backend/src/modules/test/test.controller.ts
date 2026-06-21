import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermisosGuard } from '../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../common/decorators/requires-permiso.decorator';
import { TestService } from './test.service';

@ApiTags('test')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('test')
export class TestController {
  constructor(private readonly testService: TestService) {}

  @Get('leer')
  @RequiresPermiso('Test', 'Leer')
  leer() {
    return this.testService.leer();
  }

  @Post('crear')
  @RequiresPermiso('Test', 'Crear')
  crear() {
    return this.testService.crear();
  }

  @Patch('actualizar')
  @RequiresPermiso('Test', 'Actualizar')
  actualizar() {
    return this.testService.actualizar();
  }

  @Delete('eliminar')
  @RequiresPermiso('Test', 'Eliminar')
  eliminar() {
    return this.testService.eliminar();
  }
}
