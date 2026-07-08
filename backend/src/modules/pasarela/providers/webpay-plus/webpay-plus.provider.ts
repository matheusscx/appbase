/* eslint-disable @typescript-eslint/no-unused-vars --
 * Esqueleto (seam): los parámetros tienen su firma definitiva pero aún no se
 * usan; el flujo real que los consume es un paso del plan Webpay Plus Mall. */
import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  CredencialesResueltas,
  ProviderPagoRedirect,
  ResultadoCobro,
  ResultadoEstado,
  ResultadoProvider,
} from '../payment-provider.interface';

/**
 * Transbank Webpay Plus Mall — pago único con redirect.
 *
 * ESQUELETO (seam): las firmas son las definitivas, pero la lógica del flujo
 * real (crear → confirmar → estado → reembolso vía REST
 * `/rswebpaytransaction/api/webpay/v1.2`) queda pendiente. Ver el plan
 * `docs/superpowers/plans/2026-07-08-webpay-plus-mall.md` para los pasos y los
 * shapes de request/response, y `docs/superpowers/specs/2026-07-08-webpay-plus-mall-design.md`
 * para el diseño. El seed de `webpay_plus` está `activo:false` hasta que esto
 * se implemente, así que estos métodos no se invocan en producción todavía.
 *
 * Al implementar: replicar el helper `request()` de `OneclickProvider` (fetch +
 * body no-JSON con `<500` = `ProviderComunicacionError`, nunca rechazo) y
 * respetar el invariante de timeout (un error de red deja la orden en_proceso).
 * Las credenciales mall llegan resueltas: `{ baseUrl, mallCommerceCode,
 * apiKeySecret, commerceCodeHijo }`.
 */
@Injectable()
export class WebpayPlusProvider implements ProviderPagoRedirect {
  // Devuelve un Promise RECHAZADO (no lanza síncronamente): así el contrato
  // async se respeta —los consumidores usan await/.catch— sin métodos `async`
  // sin `await`. El flujo real es un paso del plan Webpay Plus Mall.
  private noImplementado<T>(operacion: string): Promise<T> {
    return Promise.reject(
      new NotImplementedException(
        `WebpayPlusProvider.${operacion} aún no implementado (ver plan Webpay Plus Mall)`,
      ),
    );
  }

  iniciarPago(
    _cred: CredencialesResueltas,
    _p: {
      codigoOrden: string;
      monto: string;
      moneda: string;
      returnUrl: string;
    },
  ): Promise<
    { tokenExterno: string; urlRedireccion: string } & ResultadoProvider
  > {
    // TODO: POST /transactions { buy_order, session_id, return_url, details:[{amount, commerce_code, buy_order}] } → { token, url }
    return this.noImplementado('iniciarPago');
  }

  confirmarPago(
    _cred: CredencialesResueltas,
    _token: string,
  ): Promise<ResultadoCobro> {
    // TODO: PUT /transactions/{token} → details[0] (status AUTHORIZED, response_code 0)
    return this.noImplementado('confirmarPago');
  }

  reembolsar(
    _cred: CredencialesResueltas,
    _p: { codigoOrden: string; monto: string },
  ): Promise<ResultadoCobro> {
    // TODO: POST /transactions/{token}/refunds { buy_order, commerce_code, amount }
    return this.noImplementado('reembolsar');
  }

  consultarEstado(
    _cred: CredencialesResueltas,
    _codigoOrden: string,
  ): Promise<ResultadoEstado> {
    // TODO: GET /transactions/{token} → mapear details[0].status
    return this.noImplementado('consultarEstado');
  }
}
