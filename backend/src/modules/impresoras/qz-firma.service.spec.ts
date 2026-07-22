import { type ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { generateKeyPairSync, createVerify } from 'crypto';
import { QzFirmaService } from './qz-firma.service';

// Par RSA de prueba: la llave privada firma, la pública verifica.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const CERT_PEM =
  '-----BEGIN CERTIFICATE-----\nMIIB-fake-cert\n-----END CERTIFICATE-----';

function buildService(env: Record<string, string | undefined>): QzFirmaService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new QzFirmaService(config);
}

describe('QzFirmaService', () => {
  const configuredEnv = {
    QZ_PRIVATE_KEY: Buffer.from(privateKey).toString('base64'),
    QZ_CERTIFICATE: Buffer.from(CERT_PEM).toString('base64'),
  };

  describe('getCertificado', () => {
    it('devuelve el certificado PEM decodificado cuando está configurado', () => {
      const service = buildService(configuredEnv);
      expect(service.getCertificado()).toBe(CERT_PEM);
    });

    it('devuelve null cuando QZ_CERTIFICATE no está', () => {
      const service = buildService({});
      expect(service.getCertificado()).toBeNull();
    });
  });

  describe('firmar', () => {
    it('firma con RSA-SHA512 y la firma verifica con la llave pública', () => {
      const service = buildService(configuredEnv);
      const data = 'contenido-a-firmar-123';

      const firma = service.firmar(data);

      const verifier = createVerify('RSA-SHA512');
      verifier.update(data);
      verifier.end();
      expect(verifier.verify(publicKey, firma, 'base64')).toBe(true);
    });

    it('lanza BadRequest si la llave privada no está configurada', () => {
      const service = buildService({});
      expect(() => service.firmar('x')).toThrow(BadRequestException);
    });
  });
});
