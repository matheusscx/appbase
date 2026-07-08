import { WebpayPlusProvider } from './webpay-plus.provider';
import { ProviderComunicacionError } from '../payment-provider.interface';

const cred = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  mallCommerceCode: '597055555535',
  apiKeySecret: 'secret',
  commerceCodeHijo: '597055555536',
};

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

describe('WebpayPlusProvider', () => {
  const provider = new WebpayPlusProvider();
  afterEach(() => jest.restoreAllMocks());

  it('iniciarPago: create devuelve token + url (mall detail con comercio hijo)', async () => {
    mockFetch(200, { token: 'tok-1', url: 'https://webpay/redirect' });
    const r = await provider.iniciarPago(cred, {
      codigoOrden: 'O-1',
      monto: '10000',
      moneda: 'CLP',
      returnUrl: 'https://app/retorno',
    });
    expect(r.tokenExterno).toBe('tok-1');
    expect(r.urlRedireccion).toBe('https://webpay/redirect');
    expect(r.aprobada).toBe(true);
    const call = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { body: string },
    ];
    const sent = JSON.parse(call[1].body) as {
      details: { commerce_code: string; amount: number }[];
    };
    expect(sent.details[0].commerce_code).toBe('597055555536');
    expect(sent.details[0].amount).toBe(10000);
  });

  it('iniciarPago: CLP con decimales es rechazado', async () => {
    mockFetch(200, { token: 't', url: 'u' });
    await expect(
      provider.iniciarPago(cred, {
        codigoOrden: 'O-1',
        monto: '100.5',
        moneda: 'CLP',
        returnUrl: 'https://app/retorno',
      }),
    ).rejects.toThrow('CLP no admite decimales');
  });

  it('confirmarPago: commit aprobado (details[0] AUTHORIZED + response_code 0)', async () => {
    mockFetch(200, {
      details: [
        {
          status: 'AUTHORIZED',
          response_code: 0,
          authorization_code: '1213',
          payment_type_code: 'VN',
          amount: 10000,
        },
      ],
    });
    const r = await provider.confirmarPago(cred, 'tok-1');
    expect(r.aprobada).toBe(true);
    expect(r.codigoAutorizacion).toBe('1213');
    expect(r.tipoPago).toBe('VN');
    expect(r.identificadorTransaccionExterno).toBe('tok-1');
  });

  it('confirmarPago: commit rechazado (response_code != 0) NO aprueba', async () => {
    mockFetch(200, {
      details: [{ status: 'FAILED', response_code: -1 }],
    });
    const r = await provider.confirmarPago(cred, 'tok-1');
    expect(r.aprobada).toBe(false);
    expect(r.codigoRespuesta).toBe('-1');
  });

  it('confirmarPago: timeout de red → ProviderComunicacionError (nunca rechazo)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(provider.confirmarPago(cred, 'tok-1')).rejects.toBeInstanceOf(
      ProviderComunicacionError,
    );
  });

  it('confirmarPago: respuesta 5xx → ProviderComunicacionError', async () => {
    mockFetch(503, { error: 'unavailable' });
    await expect(provider.confirmarPago(cred, 'tok-1')).rejects.toBeInstanceOf(
      ProviderComunicacionError,
    );
  });

  it('consultarEstado: AUTHORIZED → pagada; 404 → fallida', async () => {
    mockFetch(200, { details: [{ status: 'AUTHORIZED' }] });
    expect((await provider.consultarEstado(cred, 'tok-1')).estado).toBe(
      'pagada',
    );
    mockFetch(404, {});
    expect((await provider.consultarEstado(cred, 'tok-1')).estado).toBe(
      'fallida',
    );
  });
});
