// backend/test/pasarela-oneclick.e2e-spec.ts
import { OneclickProvider } from '../src/modules/pasarela/providers/oneclick/oneclick.provider';

const cred = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  mallCommerceCode: '597055555541',
  apiKeySecret:
    '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
  commerceCodeHijo: '597055555542',
};

const correr = process.env.RUN_TRANSBANK_E2E === '1' ? describe : describe.skip;

correr('OneclickProvider e2e (integración Transbank real)', () => {
  const provider = new OneclickProvider();

  it('inicia una inscripción real y recibe token + url_webpay', async () => {
    const res = await provider.iniciarInscripcion(cred, {
      username: `insc-e2e${Date.now().toString(36)}`,
      email: 'e2e@test.cl',
      responseUrl: 'http://localhost:3000/api/pasarela/retorno/inscripcion',
    });
    expect(res.tokenExterno).toBeTruthy();
    expect(res.urlRedireccion).toContain('transbank');
  }, 15000);

  it('consultar una orden inexistente responde fallida/desconocido (no explota)', async () => {
    const res = await provider.consultarEstado(
      cred,
      `ONOEXISTE${Date.now().toString(36)}`.toUpperCase(),
    );
    expect(['fallida', 'desconocido']).toContain(res.estado);
  }, 15000);
});
