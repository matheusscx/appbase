import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('modulos')
  findAllModulos() {
    return this.catalogService.findAllModulos();
  }

  @Get('permisos')
  findAllPermisos() {
    return this.catalogService.findAllPermisos();
  }

  @Get('paises')
  findAllPaises() {
    return this.catalogService.findAllPaises();
  }

  @Get('provincias')
  findAllProvincias(@Query('paisId') paisId?: string) {
    return this.catalogService.findAllProvincias(paisId);
  }
}
