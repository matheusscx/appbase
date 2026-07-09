import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  CredencialesResueltas,
  ProviderComunicacionError,
  ProviderTokenizado,
  ResultadoCobro,
  ResultadoEstado,
  ResultadoInscripcion,
  ResultadoProvider,
} from '../payment-provider.interface';

const BASE_PATH = '/rswebpaytransaction/api/oneclick/v1.2';

/** Stringifica valores primitivos provenientes de un JSON externo sin caer en no-base-to-string. */
function toStr(v: unknown): string {
  return String(v);
}

@Injectable()
export class OneclickProvider implements ProviderTokenizado {
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
    // Body vacío (p. ej. DELETE 204) es válido; un body no-JSON con status <500
    // es comunicación rota, NUNCA un rechazo de negocio (no asumir rechazo).
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

  async iniciarInscripcion(
    cred: CredencialesResueltas,
    p: { username: string; email: string; responseUrl: string },
  ): Promise<
    { tokenExterno: string; urlRedireccion: string } & ResultadoProvider
  > {
    const body = {
      username: p.username,
      email: p.email,
      response_url: p.responseUrl,
    };
    const { json, requestInfo } = await this.request(
      cred,
      'POST',
      '/inscriptions',
      body,
    );
    if (!json.token || !json.url_webpay)
      throw new ProviderComunicacionError(
        'Respuesta de inscripción inválida',
        requestInfo,
        json,
      );
    return {
      tokenExterno: toStr(json.token),
      urlRedireccion: toStr(json.url_webpay),
      aprobada: true,
      codigoRespuesta: null,
      request: requestInfo,
      response: json,
    };
  }

  async confirmarInscripcion(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoInscripcion> {
    const { json, requestInfo } = await this.request(
      cred,
      'PUT',
      `/inscriptions/${encodeURIComponent(token)}`,
    );
    const responseCode = json.response_code as number | undefined;
    const aprobada = responseCode === 0 && !!json.tbk_user;
    const cardNumber =
      typeof json.card_number === 'string' ? json.card_number : '';
    return {
      aprobada,
      codigoRespuesta: responseCode != null ? toStr(responseCode) : null,
      identificadorExterno: aprobada ? toStr(json.tbk_user) : null,
      codigoAutorizacion: json.authorization_code
        ? toStr(json.authorization_code)
        : null,
      tarjeta: aprobada
        ? {
            tipo: 'TARJETA',
            marca: json.card_type ? toStr(json.card_type) : null,
            ultimos4: cardNumber.slice(-4),
          }
        : null,
      request: requestInfo,
      response: json,
    };
  }

  async eliminarInscripcion(
    cred: CredencialesResueltas,
    p: { identificadorExterno: string; username: string },
  ): Promise<void> {
    await this.request(cred, 'DELETE', '/inscriptions', {
      tbk_user: p.identificadorExterno,
      username: p.username,
    });
  }

  async autorizarCobro(
    cred: CredencialesResueltas,
    p: {
      username: string;
      identificadorExterno: string;
      codigoOrden: string;
      monto: string;
      moneda: string;
      cuotas: number;
    },
  ): Promise<ResultadoCobro> {
    const amount = this.montoEntero(p.monto, p.moneda);
    const body = {
      username: p.username,
      tbk_user: p.identificadorExterno,
      buy_order: p.codigoOrden,
      details: [
        {
          commerce_code: cred.commerceCodeHijo,
          buy_order: `${p.codigoOrden}-1`,
          amount,
          installments_number: p.cuotas,
        },
      ],
    };
    const { json, requestInfo } = await this.request(
      cred,
      'POST',
      '/transactions',
      body,
    );
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
      identificadorTransaccionExterno: p.codigoOrden, // Oneclick identifica por buy_order
      tipoPago: detalle.payment_type_code
        ? toStr(detalle.payment_type_code)
        : null,
      numeroCuotas:
        typeof detalle.installments_number === 'number'
          ? detalle.installments_number
          : null,
      montoCuota:
        detalle.installments_amount != null
          ? toStr(detalle.installments_amount)
          : null,
      request: requestInfo,
      response: json,
    };
  }

  async reembolsar(
    cred: CredencialesResueltas,
    p: { codigoOrden: string; monto: string; tokenProveedor: string | null },
  ): Promise<ResultadoCobro> {
    // Oneclick identifica por buyOrder (codigoOrden); tokenProveedor no aplica.
    const body = {
      commerce_code: cred.commerceCodeHijo,
      detail_buy_order: `${p.codigoOrden}-1`,
      amount: this.montoEntero(p.monto, 'CLP'),
    };
    const { json, requestInfo } = await this.request(
      cred,
      'POST',
      `/transactions/${encodeURIComponent(p.codigoOrden)}/refunds`,
      body,
    );
    // Respuesta OK trae 'type' (REVERSED | NULLIFIED); si viene response_code != 0 es rechazo
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
      identificadorTransaccionExterno: null,
      tipoPago: json.type ? toStr(json.type) : null,
      numeroCuotas: null,
      montoCuota: null,
      request: requestInfo,
      response: json,
    };
  }

  async consultarEstado(
    cred: CredencialesResueltas,
    referencia: { codigoOrden: string; tokenProveedor: string | null },
  ): Promise<ResultadoEstado> {
    // Oneclick consulta por buyOrder (codigoOrden).
    const { status, json } = await this.request(
      cred,
      'GET',
      `/transactions/${encodeURIComponent(referencia.codigoOrden)}`,
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
