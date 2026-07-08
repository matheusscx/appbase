import { BadRequestException, NotImplementedException } from '@nestjs/common';
import { ProviderFactory } from './provider.factory';
import { OneclickProvider } from './oneclick/oneclick.provider';
import { WebpayPlusProvider } from './webpay-plus/webpay-plus.provider';

describe('ProviderFactory (seam de proveedores)', () => {
  const oneclick = new OneclickProvider();
  const webpayPlus = new WebpayPlusProvider();
  const factory = new ProviderFactory(oneclick, webpayPlus);

  it('getTokenizado resuelve oneclick', () => {
    expect(factory.getTokenizado('oneclick')).toBe(oneclick);
  });

  it('getTokenizado rechaza un código no tokenizado', () => {
    expect(() => factory.getTokenizado('webpay_plus')).toThrow(
      BadRequestException,
    );
  });

  it('getPagoRedirect resuelve webpay_plus', () => {
    expect(factory.getPagoRedirect('webpay_plus')).toBe(webpayPlus);
  });

  it('getPagoRedirect rechaza un código no redirect', () => {
    expect(() => factory.getPagoRedirect('oneclick')).toThrow(
      BadRequestException,
    );
  });

  it('el reembolso de Webpay Plus aún no está implementado (follow-up)', async () => {
    await expect(
      webpayPlus.reembolsar(
        { baseUrl: 'x' },
        { codigoOrden: 'tok', monto: '1' },
      ),
    ).rejects.toThrow(NotImplementedException);
  });
});
