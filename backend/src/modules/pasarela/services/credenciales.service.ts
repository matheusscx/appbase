import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Pasarela } from '../entities/pasarela.entity';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';

/**
 * Único punto del módulo que toca cifrado y jsonb de credenciales.
 * Formato del blob: 'v1:<iv b64>:<authTag b64>:<data b64>' (AES-256-GCM).
 */
@Injectable()
export class CredencialesService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('PASARELA_ENCRYPTION_KEY');
    if (!raw) throw new Error('PASARELA_ENCRYPTION_KEY no configurada');
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32)
      throw new Error('PASARELA_ENCRYPTION_KEY debe ser 32 bytes en base64');
  }

  cifrarTexto(texto: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  descifrarTexto(blob: string): string {
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

  cifrarJson(obj: Record<string, unknown>): string {
    return this.cifrarTexto(JSON.stringify(obj));
  }

  descifrarJson<T = Record<string, string>>(blob: string): T {
    return JSON.parse(this.descifrarTexto(blob)) as T;
  }

  /**
   * Credenciales listas para el provider según modo + ambiente.
   * MALL: credenciales de la plataforma (pasarelas.configuracion_*) + config del tenant (commerce code hijo).
   * INDIVIDUAL: solo la configuración del tenant.
   */
  resolver(
    tenantPasarela: TenantPasarela,
    pasarela: Pasarela,
  ): Record<string, string> {
    const baseUrl =
      tenantPasarela.ambiente === 'produccion'
        ? pasarela.urlProduccion
        : pasarela.urlPruebas;

    const configTenant = tenantPasarela.configuracion
      ? this.descifrarJson<Record<string, string>>(tenantPasarela.configuracion)
      : {};

    if (tenantPasarela.modoIntegracion === 'individual') {
      if (!tenantPasarela.configuracion)
        throw new BadRequestException(
          'La pasarela no tiene credenciales configuradas',
        );
      return { baseUrl, ...configTenant };
    }

    const blobPlataforma =
      tenantPasarela.ambiente === 'produccion'
        ? pasarela.configuracionProduccion
        : pasarela.configuracionPruebas;
    if (!blobPlataforma)
      throw new BadRequestException(
        'La plataforma no tiene credenciales configuradas para esta pasarela y ambiente',
      );
    const configPlataforma =
      this.descifrarJson<Record<string, string>>(blobPlataforma);
    return { baseUrl, ...configPlataforma, ...configTenant };
  }
}
