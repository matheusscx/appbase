import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

/**
 * Firma las peticiones que el frontend envía a QZ Tray, para que deje de mostrar
 * el diálogo de confianza. Llave privada + certificado autofirmado en env vars
 * (PEM base64). Si no están configuradas, getCertificado devuelve null y el
 * frontend degrada al modo no-firmado. Ver docs/features/impresion-termica.md.
 */
@Injectable()
export class QzFirmaService {
  private readonly privateKey: string | null;
  private readonly certificate: string | null;

  constructor(config: ConfigService) {
    const key = config.get<string>('QZ_PRIVATE_KEY');
    const cert = config.get<string>('QZ_CERTIFICATE');
    this.privateKey = key ? Buffer.from(key, 'base64').toString('utf8') : null;
    this.certificate = cert
      ? Buffer.from(cert, 'base64').toString('utf8')
      : null;
  }

  getCertificado(): string | null {
    return this.certificate;
  }

  firmar(data: string): string {
    if (!this.privateKey) {
      throw new BadRequestException(
        'Firmado QZ no configurado (falta QZ_PRIVATE_KEY)',
      );
    }
    const sign = createSign('RSA-SHA512');
    sign.update(data);
    sign.end();
    return sign.sign(this.privateKey, 'base64');
  }
}
