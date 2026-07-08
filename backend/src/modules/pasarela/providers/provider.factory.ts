import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ProviderPagoRedirect,
  ProviderTokenizado,
} from './payment-provider.interface';
import { OneclickProvider } from './oneclick/oneclick.provider';
import { WebpayPlusProvider } from './webpay-plus/webpay-plus.provider';

@Injectable()
export class ProviderFactory {
  constructor(
    private readonly oneclick: OneclickProvider,
    private readonly webpayPlus: WebpayPlusProvider,
  ) {}

  /** Proveedores de flujo tokenizado (inscripción + cobro con token). */
  getTokenizado(codigo: string): ProviderTokenizado {
    switch (codigo) {
      case 'oneclick':
        return this.oneclick;
      default:
        throw new BadRequestException(
          `Pasarela tokenizada no soportada: ${codigo}`,
        );
    }
  }

  /** Proveedores de pago único con redirect (crear → redirigir → confirmar). */
  getPagoRedirect(codigo: string): ProviderPagoRedirect {
    switch (codigo) {
      case 'webpay_plus':
        return this.webpayPlus;
      default:
        throw new BadRequestException(
          `Pasarela de pago redirect no soportada: ${codigo}`,
        );
    }
  }
}
