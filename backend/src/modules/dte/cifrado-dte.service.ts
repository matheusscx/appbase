import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Único punto que cifra los blobs del módulo `dte` (certificado digital y CAF).
 * Formato del blob: 'v1:<iv b64>:<authTag b64>:<data b64>' (AES-256-GCM), el mismo
 * de las credenciales de la pasarela (ADR-008).
 *
 * La clave es propia (`DTE_ENCRYPTION_KEY`) y no la de la pasarela, para que la
 * filtración de una no exponga lo que protege la otra y cada una se rote por separado.
 */
@Injectable()
export class CifradoDteService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('DTE_ENCRYPTION_KEY');
    if (!raw) throw new Error('DTE_ENCRYPTION_KEY no configurada');
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32)
      throw new Error('DTE_ENCRYPTION_KEY debe ser 32 bytes en base64');
  }

  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  descifrar(blob: string): string {
    const [version, ivB64, tagB64, dataB64] = blob.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64)
      throw new Error('Formato de blob cifrado desconocido');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
