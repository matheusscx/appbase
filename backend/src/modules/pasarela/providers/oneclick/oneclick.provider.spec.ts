import { OneclickProvider } from './oneclick.provider';
import { ProviderComunicacionError } from '../payment-provider.interface';

const cred = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  mallCommerceCode: '597055555541',
  apiKeySecret: 'SECRET',
  commerceCodeHijo: '597055555542',
};

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('OneclickProvider', () => {
  const provider = new OneclickProvider();

  it('iniciarInscripcion llama al endpoint con headers Tbk y devuelve token+url', async () => {
    mockFetch(200, { token: 'tok-1', url_webpay: 'https://webpay/init' });
    const res = await provider.iniciarInscripcion(cred, {
      username: 'insc-abc',
      email: 'a@b.cl',
      responseUrl: 'http://localhost:3000/api/pasarela/retorno/inscripcion',
    });
    expect(res.tokenExterno).toBe('tok-1');
    expect(res.urlRedireccion).toBe('https://webpay/init');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(
      'https://webpay3gint.transbank.cl/rswebpaytransaction/api/oneclick/v1.2/inscriptions',
    );
    expect(init.headers['Tbk-Api-Key-Id']).toBe('597055555541');
    expect(init.headers['Tbk-Api-Key-Secret']).toBe('SECRET');
  });

  it('confirmarInscripcion aprobada mapea tbk_user y tarjeta', async () => {
    mockFetch(200, {
      response_code: 0,
      tbk_user: 'tbk-u-1',
      authorization_code: '1213',
      card_type: 'Visa',
      card_number: 'XXXXXXXXXXXX6623',
    });
    const res = await provider.confirmarInscripcion(cred, 'tok-1');
    expect(res.aprobada).toBe(true);
    expect(res.identificadorExterno).toBe('tbk-u-1');
    expect(res.tarjeta).toEqual({
      tipo: 'TARJETA',
      marca: 'Visa',
      ultimos4: '6623',
    });
  });

  it('autorizarCobro rechazado (response_code != 0) NO lanza: aprobada=false', async () => {
    mockFetch(200, {
      details: [
        {
          response_code: -1,
          status: 'FAILED',
          amount: 5000,
          authorization_code: null,
          payment_type_code: 'VN',
          installments_number: 0,
        },
      ],
    });
    const res = await provider.autorizarCobro(cred, {
      username: 'insc-abc',
      identificadorExterno: 'tbk-u-1',
      codigoOrden: 'O-1',
      monto: '5000',
      moneda: 'CLP',
      cuotas: 0,
    });
    expect(res.aprobada).toBe(false);
    expect(res.codigoRespuesta).toBe('-1');
  });

  it('autorizarCobro rechaza montos CLP con decimales', async () => {
    await expect(
      provider.autorizarCobro(cred, {
        username: 'u',
        identificadorExterno: 't',
        codigoOrden: 'O-2',
        monto: '5000.50',
        moneda: 'CLP',
        cuotas: 0,
      }),
    ).rejects.toThrow('CLP no admite decimales');
  });

  it('error de red lanza ProviderComunicacionError (no rechazo)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      provider.autorizarCobro(cred, {
        username: 'u',
        identificadorExterno: 't',
        codigoOrden: 'O-3',
        monto: '5000',
        moneda: 'CLP',
        cuotas: 0,
      }),
    ).rejects.toThrow(ProviderComunicacionError);
  });
});
