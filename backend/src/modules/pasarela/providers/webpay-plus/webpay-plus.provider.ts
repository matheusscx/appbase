import {
  BadRequestException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  CredencialesResueltas,
  ProviderComunicacionError,
  ProviderPagoRedirect,
  ResultadoCobro,
  ResultadoEstado,
  ResultadoProvider,
} from '../payment-provider.interface';

const BASE_PATH = '/rswebpaytransaction/api/webpay/v1.2';

/** Stringifica valores primitivos de un JSON externo sin caer en no-base-to-string. */
function toStr(v: unknown): string {
  return String(v);
}

/**
 * Transbank Webpay Plus Mall — pago único con redirect (crear → redirigir →
 * confirmar). No tokeniza tarjeta. Autentica con el comercio MALL (padre) en el
 * header y factura cada detalle bajo el comercio hijo. Credenciales resueltas:
 * `{ baseUrl, mallCommerceCode, apiKeySecret, commerceCodeHijo }`.
 */
@Injectable()
export class WebpayPlusProvider implements ProviderPagoRedirect {
  private async request(
    cred: CredencialesResueltas,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{
    status: number;
    json: Record<string, unknown>;
    requestInfo: Record<string, unknown>;
  }> {
    const requestInfo = {
      method,
      url: `${cred.baseUrl}${BASE_PATH}${path}`,
      body: body ?? null,
    };
    let res: Response;
    try {
      res = await fetch(`${cred.baseUrl}${BASE_PATH}${path}`, {
        method,
        headers: {
          'Tbk-Api-Key-Id': cred.mallCommerceCode,
          'Tbk-Api-Key-Secret': cred.apiKeySecret,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ProviderComunicacionError(
        `Error de comunicación con Transbank: ${(e as Error).message}`,
        requestInfo,
      );
    }
    // Body no-JSON con status <500 es comunicación rota, NUNCA rechazo de negocio.
    const text = await res.text().catch(() => null);
    if (text === null) {
      throw new ProviderComunicacionError(
        'No se pudo leer la respuesta de Transbank',
        requestInfo,
      );
    }
    let json: Record<string, unknown> = {};
    if (text.trim() !== '') {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ProviderComunicacionError(
          'Respuesta de Transbank no es JSON válido',
          requestInfo,
          { bodyPreview: text.slice(0, 200) },
        );
      }
    }
    if (res.status >= 500) {
      throw new ProviderComunicacionError(
        `Transbank respondió ${res.status}`,
        requestInfo,
        json,
      );
    }
    return { status: res.status, json, requestInfo };
  }

  /** Transbank cobra CLP en enteros: validar y convertir en el borde. */
  private montoEntero(monto: string, moneda: string): number {
    const d = new Decimal(monto);
    if (moneda === 'CLP' && !d.isInteger())
      throw new BadRequestException('CLP no admite decimales en el monto');
    return d.toNumber();
  }

  async iniciarPago(
    cred: CredencialesResueltas,
    p: {
      codigoOrden: string;
      monto: string;
      moneda: string;
      returnUrl: string;
    },
  ): Promise<
    { tokenExterno: string; urlRedireccion: string } & ResultadoProvider
  > {
    const body = {
      buy_order: p.codigoOrden,
      session_id: p.codigoOrden,
      return_url: p.returnUrl,
      details: [
        {
          amount: this.montoEntero(p.monto, p.moneda),
          commerce_code: cred.commerceCodeHijo,
          buy_order: `${p.codigoOrden}-1`,
        },
      ],
    };
    const { json, requestInfo } = await this.request(
      cred,
      'POST',
      '/transactions',
      body,
    );
    if (!json.token || !json.url)
      throw new ProviderComunicacionError(
        'Respuesta de create inválida',
        requestInfo,
        json,
      );
    return {
      tokenExterno: toStr(json.token),
      urlRedireccion: toStr(json.url),
      aprobada: true,
      codigoRespuesta: null,
      request: requestInfo,
      response: json,
    };
  }

  async confirmarPago(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoCobro> {
    const { json, requestInfo } = await this.request(
      cred,
      'PUT',
      `/transactions/${encodeURIComponent(token)}`,
    );
    // Mall: la respuesta trae details[] con el resultado por tienda.
    const detalle =
      (json.details as Record<string, unknown>[] | undefined)?.[0] ?? {};
    const aprobada =
      detalle.response_code === 0 && detalle.status === 'AUTHORIZED';
    return {
      aprobada,
      codigoRespuesta:
        detalle.response_code != null ? toStr(detalle.response_code) : null,
      codigoAutorizacion: detalle.authorization_code
        ? toStr(detalle.authorization_code)
        : null,
      identificadorTransaccionExterno: token, // Webpay identifica por token
      tipoPago: detalle.payment_type_code
        ? toStr(detalle.payment_type_code)
        : null,
      numeroCuotas:
        typeof detalle.installments_number === 'number'
          ? detalle.installments_number
          : null,
      montoCuota: null,
      request: requestInfo,
      response: json,
    };
  }

  /**
   * NO IMPLEMENTADO (follow-up): el refund mall necesita token (URL) + buy_order
   * del detalle hijo + commerce_code juntos, y la firma compartida
   * `reembolsar(cred, { codigoOrden, monto })` solo transporta un identificador.
   * Enriquecer el seam antes de cablearlo. El flujo de pago no lo requiere.
   */
  reembolsar(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- follow-up
    _cred: CredencialesResueltas,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- follow-up
    _p: { codigoOrden: string; monto: string },
  ): Promise<ResultadoCobro> {
    return Promise.reject(
      new NotImplementedException(
        'Reembolso de Webpay Plus aún no implementado (ver plan Webpay Plus Mall)',
      ),
    );
  }

  /** El identificador para Webpay es el `token` (se pasa como `codigoOrden`). */
  async consultarEstado(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoEstado> {
    const { status, json } = await this.request(
      cred,
      'GET',
      `/transactions/${encodeURIComponent(token)}`,
    );
    if (status === 404) return { estado: 'fallida', response: json };
    const detalle = (
      json.details as Record<string, unknown>[] | undefined
    )?.[0];
    if (!detalle) return { estado: 'desconocido', response: json };
    if (detalle.status === 'AUTHORIZED' || detalle.status === 'CAPTURED')
      return { estado: 'pagada', response: json };
    if (
      detalle.status === 'FAILED' ||
      detalle.status === 'REVERSED' ||
      detalle.status === 'NULLIFIED'
    )
      return { estado: 'fallida', response: json };
    return { estado: 'desconocido', response: json };
  }
}
