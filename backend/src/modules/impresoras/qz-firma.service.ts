import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createSign } from 'crypto';

/**
 * Firma las peticiones que el frontend envía a QZ Tray, para que deje de mostrar
 * el diálogo de confianza. Llave privada + certificado autofirmado en env vars
 * (PEM base64). Si no están configuradas —o la llave no decodifica a un PEM
 * válido—, getCertificado devuelve null y el frontend degrada al modo
 * no-firmado. Ver docs/features/impresion-termica.md.
 */
@Injectable()
export class QzFirmaService {
  private readonly logger = new Logger(QzFirmaService.name);
  private readonly privateKey: string | null;
  private readonly certificate: string | null;

  constructor(config: ConfigService) {
    const key = config.get<string>('QZ_PRIVATE_KEY');
    const cert = config.get<string>('QZ_CERTIFICATE');
    const claveDecodificada = key
      ? Buffer.from(key, 'base64').toString('utf8')
      : null;
    this.privateKey =
      claveDecodificada && this.esPemValido(claveDecodificada)
        ? claveDecodificada
        : null;
    if (claveDecodificada && !this.privateKey) {
      // No loguear `claveDecodificada` ni fragmentos: aunque esté rota, sigue
      // siendo material de la llave privada.
      this.logger.error(
        'QZ_PRIVATE_KEY inválida: no decodifica a una llave privada PEM ' +
          '(revisar el valor en el entorno — suele ser un base64 cortado o ' +
          'con texto pegado por error). El firmado QZ queda desactivado: ' +
          'la app opera en modo no firmado.',
      );
    }
    this.certificate = cert
      ? Buffer.from(cert, 'base64').toString('utf8')
      : null;
  }

  private esPemValido(pem: string): boolean {
    try {
      createPrivateKey(pem);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * El cert solo tiene sentido junto con una llave privada utilizable: QZ lo usa
   * para verificar las firmas que llegan de `firmar()`. Si la llave falta o es
   * inválida, servir igual el cert dejaría al frontend armando el modo firmado
   * (`setCertificatePromise` + `setSignaturePromise`) para que cada firma
   * reviente — degrada peor que no tener nada configurado. Por eso, sin llave
   * utilizable, el cert también es null: mismo estado que "firmado no
   * configurado" (modo no-firmado, diálogo de QZ en cada conexión, pero imprime).
   */
  getCertificado(): string | null {
    return this.privateKey ? this.certificate : null;
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
