import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TiposReglaService } from './tipos-regla.service';

const CLASES_VALIDAS = ['descuento', 'recargo'];

/**
 * Catálogo global read-only de tipos de regla. No requiere tenant ni admin: es
 * un catálogo de lectura que alimenta el selector de tipo en descuentos/recargos.
 */
@UseGuards(JwtAuthGuard)
@Controller('tipos-regla')
export class TiposReglaController {
  constructor(private readonly tiposReglaService: TiposReglaService) {}

  @Get()
  findAll(@Query('clase') clase?: string) {
    if (clase !== undefined && !CLASES_VALIDAS.includes(clase)) {
      throw new BadRequestException(
        "El parámetro 'clase' debe ser 'descuento' o 'recargo'",
      );
    }
    return this.tiposReglaService.findAll(clase);
  }
}
