import {
  type ArgumentMetadata,
  BadRequestException,
  Controller,
  Get,
  Injectable,
  type PipeTransform,
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
 * Un campo del retorno de Transbank: texto o ausente. Los campos se leen sueltos
 * (`@Body('x')`/`@Query('x')`) y no con un DTO porque Transbank manda campos que
 * no controlamos (`TBK_ID_SESION`, entre otros) y el pipe global los rechazaría
 * (`validacion-global.e2e-spec.ts`); un parámetro con nombre no pasa por
 * class-validator, así que el tipo lo valida este pipe.
 *
 * Es validación de borde, no un hueco (medido el 2026-10-08): un objeto o un
 * array llegaba al `WHERE` por token u orden de compra, `pg` lo serializaba a
 * texto y no matcheaba nada, así que contestaba el 404 de un token desconocido
 * sin escribir. Ahora es 400 en JSON, como el retorno sin token: la basura no
 * redirige. El tope deja margen sobre lo que manda Transbank (token de 64,
 * orden de compra de hasta 26).
 */
@Injectable()
class CampoDeRetornoPipe implements PipeTransform<unknown, string | undefined> {
  static readonly MAX = 255;

  transform(valor: unknown, { data }: ArgumentMetadata): string | undefined {
    if (valor === undefined) return undefined;
    if (typeof valor !== 'string' || valor.length > CampoDeRetornoPipe.MAX)
      throw new BadRequestException(
        `${data} debe ser un texto de hasta ${CampoDeRetornoPipe.MAX} caracteres`,
      );
    return valor;
  }
}

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

  private async procesarPago(
    p: { tokenWs?: string; tbkToken?: string; ordenCompra?: string },
    res: Response,
  ) {
    // Webpay vuelve de distintas formas según el desenlace:
    // - TBK_TOKEN presente → anulación del usuario o timeout post-autorización:
    //   NO se confirma (aunque venga token_ws), se marca fallida.
    // - token_ws (sin TBK_TOKEN) → flujo normal: se confirma el pago.
    // - solo TBK_ORDEN_COMPRA → timeout en el formulario: se marca fallida.
    if (p.tbkToken) {
      const { urlRedireccion } = await this.pagosRedirect.abortarRetorno({
        tbkToken: p.tbkToken,
        ordenCompra: p.ordenCompra,
      });
      return res.redirect(302, urlRedireccion);
    }
    if (p.tokenWs) {
      const { urlRedireccion } = await this.pagosRedirect.confirmarRetorno(
        p.tokenWs,
      );
      return res.redirect(302, urlRedireccion);
    }
    if (p.ordenCompra) {
      const { urlRedireccion } = await this.pagosRedirect.abortarRetorno({
        ordenCompra: p.ordenCompra,
      });
      return res.redirect(302, urlRedireccion);
    }
    throw new BadRequestException('Retorno de pago sin token');
  }

  @Get('inscripcion')
  retornoInscripcionGet(
    @Query('TBK_TOKEN', CampoDeRetornoPipe) token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarInscripcion(token, res);
  }

  @Post('inscripcion')
  retornoInscripcionPost(
    @Body('TBK_TOKEN', CampoDeRetornoPipe) token: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarInscripcion(token, res);
  }

  @Get('pago')
  retornoPagoGet(
    @Query('token_ws', CampoDeRetornoPipe) tokenWs: string | undefined,
    @Query('TBK_TOKEN', CampoDeRetornoPipe) tbkToken: string | undefined,
    @Query('TBK_ORDEN_COMPRA', CampoDeRetornoPipe)
    ordenCompra: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarPago({ tokenWs, tbkToken, ordenCompra }, res);
  }

  @Post('pago')
  retornoPagoPost(
    @Body('token_ws', CampoDeRetornoPipe) tokenWs: string | undefined,
    @Body('TBK_TOKEN', CampoDeRetornoPipe) tbkToken: string | undefined,
    @Body('TBK_ORDEN_COMPRA', CampoDeRetornoPipe)
    ordenCompra: string | undefined,
    @Res() res: Response,
  ) {
    return this.procesarPago({ tokenWs, tbkToken, ordenCompra }, res);
  }
}
