import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InscripcionesService } from '../services/inscripciones.service';
import { PagosRedirectService } from '../services/pagos-redirect.service';

/**
 * Retornos de Webpay. Públicos: la credencial es el token de un solo uso emitido
 * por Transbank. Redirigen (302) a la url_retorno de la app consumidora.
 * Transbank puede volver por GET o por POST según el flujo.
 */
@ApiTags('pasarela')
@Controller('pasarela/retorno')
export class PasarelaRetornoController {
  constructor(
    private readonly inscripciones: InscripcionesService,
    private readonly pagosRedirect: PagosRedirectService,
  ) {}

  private async procesarInscripcion(token: string | undefined, res: Response) {
    if (!token) throw new BadRequestException('TBK_TOKEN requerido');
    const { urlRedireccion } = await this.inscripciones.confirmarRetorno(token);
    res.redirect(302, urlRedireccion);
  }

  private async procesarPago(token: string | undefined, res: Response) {
    // Webpay Plus vuelve con token_ws en el flujo normal (POST). Sin él, es un
    // abort/timeout del usuario: no confirmamos nada.
    if (!token) throw new BadRequestException('token_ws requerido');
    const { urlRedireccion } = await this.pagosRedirect.confirmarRetorno(token);
    res.redirect(302, urlRedireccion);
  }

  @Get('inscripcion')
  retornoInscripcionGet(
    @Query('TBK_TOKEN') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarInscripcion(token, res);
  }

  @Post('inscripcion')
  retornoInscripcionPost(
    @Body('TBK_TOKEN') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarInscripcion(token, res);
  }

  @Get('pago')
  retornoPagoGet(
    @Query('token_ws') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarPago(token, res);
  }

  @Post('pago')
  retornoPagoPost(
    @Body('token_ws') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarPago(token, res);
  }
}
