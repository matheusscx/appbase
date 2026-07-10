import { BadRequestException, Injectable } from '@nestjs/common';
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
    // Webpay espera que el navegador llegue con el token: `url?token_ws=<token>`.
    // Sin él, el formulario hosted carga en blanco. (Alternativa equivalente:
    // POST de un form con campo oculto token_ws; usamos GET para el redirect.)
    const baseUrl = toStr(json.url);
    const sep = baseUrl.includes('?') ? '&' : '?';
    return {
      tokenExterno: toStr(json.token),
      urlRedireccion: `${baseUrl}${sep}token_ws=${toStr(json.token)}`,
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
   * Refund mall: la URL usa el `tokenProveedor`; el body identifica el detalle
   * hijo por su `buy_order` (`${codigoOrden}-1`, igual que en iniciarPago) y su
   * `commerce_code`. Por eso necesita ambos identificadores de la referencia.
   */
  async reembolsar(
    cred: CredencialesResueltas,
    p: { codigoOrden: string; monto: string; tokenProveedor: string | null },
  ): Promise<ResultadoCobro> {
    if (!p.tokenProveedor)
      throw new BadRequestException(
        'Falta el token de la transacción Webpay para reembolsar',
      );
    const body = {
      commerce_code: cred.commerceCodeHijo,
      buy_order: `${p.codigoOrden}-1`,
      amount: this.montoEntero(p.monto, 'CLP'),
    };
    const { json, requestInfo } = await this.request(
      cred,
      'POST',
      `/transactions/${encodeURIComponent(p.tokenProveedor)}/refunds`,
      body,
    );
    // Refund OK trae 'type' (REVERSED | NULLIFIED); response_code != 0 es rechazo.
    const aprobada = !!json.type;
    return {
      aprobada,
      codigoRespuesta:
        json.response_code != null
          ? toStr(json.response_code)
          : aprobada
            ? '0'
            : null,
      codigoAutorizacion: json.authorization_code
        ? toStr(json.authorization_code)
        : null,
      identificadorTransaccionExterno: p.tokenProveedor,
      tipoPago: json.type ? toStr(json.type) : null,
      numeroCuotas: null,
      montoCuota: null,
      request: requestInfo,
      response: json,
    };
  }

  /** El identificador para Webpay es el `tokenProveedor`. */
  async consultarEstado(
    cred: CredencialesResueltas,
    referencia: { codigoOrden: string; tokenProveedor: string | null },
  ): Promise<ResultadoEstado> {
    if (!referencia.tokenProveedor)
      return { estado: 'desconocido', response: {} };
    const { status, json } = await this.request(
      cred,
      'GET',
      `/transactions/${encodeURIComponent(referencia.tokenProveedor)}`,
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
