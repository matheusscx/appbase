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

/**
 * Retorno de Webpay tras la inscripción. Público: la credencial es el
 * TBK_TOKEN de un solo uso emitido por Transbank. Redirige (302) a la
 * url_retorno de la app consumidora con inscripcionId + estado.
 * Transbank puede volver por GET o por POST según el flujo.
 */
@ApiTags('pasarela')
@Controller('pasarela/retorno')
export class PasarelaRetornoController {
  constructor(private readonly inscripciones: InscripcionesService) {}

  private async procesar(token: string | undefined, res: Response) {
    if (!token) throw new BadRequestException('TBK_TOKEN requerido');
    const { urlRedireccion } = await this.inscripciones.confirmarRetorno(token);
    res.redirect(302, urlRedireccion);
  }

  @Get('inscripcion')
  retornoGet(
    @Query('TBK_TOKEN') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesar(token, res);
  }

  @Post('inscripcion')
  retornoPost(
    @Body('TBK_TOKEN') token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesar(token, res);
  }
}
