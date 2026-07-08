import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { OneclickProvider } from './oneclick/oneclick.provider';

@Injectable()
export class ProviderFactory {
  constructor(private readonly oneclick: OneclickProvider) {}

  get(codigo: string): PaymentProvider {
    switch (codigo) {
      case 'oneclick':
        return this.oneclick;
      default:
        throw new BadRequestException(`Pasarela no soportada: ${codigo}`);
    }
  }
}
