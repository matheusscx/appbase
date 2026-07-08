import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard, PasarelaAuth } from '../guards/api-key.guard';
import { InscripcionesService } from '../services/inscripciones.service';
import { CobrosService } from '../services/cobros.service';
import { PagosRedirectService } from '../services/pagos-redirect.service';
import { CreateInscripcionDto } from '../dto/create-inscripcion.dto';
import { CreateCobroDto } from '../dto/create-cobro.dto';
import { CreateReembolsoDto } from '../dto/create-reembolso.dto';
import { CreatePagoDto } from '../dto/create-pago.dto';

type ApiRequest = Request & { pasarelaAuth: PasarelaAuth };

@ApiTags('pasarela')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('pasarela/api')
export class PasarelaApiController {
  constructor(
    private readonly inscripciones: InscripcionesService,
    private readonly cobros: CobrosService,
    private readonly pagosRedirect: PagosRedirectService,
  ) {}

  @Post('inscripciones')
  iniciarInscripcion(
    @Req() req: ApiRequest,
    @Body() dto: CreateInscripcionDto,
  ) {
    return this.inscripciones.iniciar(req.pasarelaAuth.tenantId, dto);
  }

  @Get('inscripciones')
  listarInscripciones(
    @Req() req: ApiRequest,
    @Query('pagadorRef') pagadorRef: string,
  ) {
    return this.inscripciones.listarPorPagador(
      req.pasarelaAuth.tenantId,
      pagadorRef,
    );
  }

  @Get('inscripciones/:id')
  obtenerInscripcion(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.inscripciones.obtener(req.pasarelaAuth.tenantId, id);
  }

  @Delete('inscripciones/:id')
  eliminarInscripcion(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.inscripciones.eliminar(req.pasarelaAuth.tenantId, id);
  }

  @Post('pagos')
  iniciarPago(@Req() req: ApiRequest, @Body() dto: CreatePagoDto) {
    return this.pagosRedirect.iniciar(req.pasarelaAuth.tenantId, dto);
  }

  @Post('cobros')
  cobrar(@Req() req: ApiRequest, @Body() dto: CreateCobroDto) {
    return this.cobros.cobrar(
      req.pasarelaAuth.tenantId,
      dto,
      'api',
      req.pasarelaAuth.apiKeyId,
    );
  }

  @Post('cobros/:ordenId/reembolsos')
  reembolsar(
    @Req() req: ApiRequest,
    @Param('ordenId') ordenId: string,
    @Body() dto: CreateReembolsoDto,
  ) {
    return this.cobros.reembolsar(req.pasarelaAuth.tenantId, ordenId, dto);
  }

  @Post('ordenes/:id/verificar')
  verificar(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.cobros.verificar(req.pasarelaAuth.tenantId, id);
  }

  @Get('ordenes/:id')
  obtenerOrden(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.cobros.obtenerOrden(req.pasarelaAuth.tenantId, id);
  }
}
