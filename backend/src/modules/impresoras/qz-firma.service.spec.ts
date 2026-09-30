import { type ConfigService } from '@nestjs/config';
import { BadRequestException, Logger } from '@nestjs/common';
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

  // Caso real del demo (2026-09-30): a la variable de entorno le quedó pegado
  // adelante el texto `QZ_PRIVATE_KEY=` (de un copy-paste de la línea entera del
  // .env) y un salto de línea al final. El `=` corta la decodificación base64
  // mucho antes de llegar al PEM real y quedan ~10 bytes de basura.
  const claveRotaEnv = {
    QZ_PRIVATE_KEY: `QZ_PRIVATE_KEY=${Buffer.from(privateKey).toString('base64')}\n`,
    QZ_CERTIFICATE: Buffer.from(CERT_PEM).toString('base64'),
  };

  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('getCertificado', () => {
    it('devuelve el certificado PEM decodificado cuando está configurado', () => {
      const service = buildService(configuredEnv);
      expect(service.getCertificado()).toBe(CERT_PEM);
    });

    it('devuelve null cuando QZ_CERTIFICATE no está', () => {
      const service = buildService({});
      expect(service.getCertificado()).toBeNull();
    });

    it('devuelve null cuando QZ_PRIVATE_KEY está mal cargada, aunque QZ_CERTIFICATE sí esté', () => {
      const service = buildService(claveRotaEnv);
      expect(service.getCertificado()).toBeNull();
    });
  });

  describe('llave inválida al construir (QZ_PRIVATE_KEY mal cargada)', () => {
    it('no tira al construir', () => {
      expect(() => buildService(claveRotaEnv)).not.toThrow();
    });

    it('loguea el error nombrando la variable, sin el valor de la llave', () => {
      buildService(claveRotaEnv);

      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      const mensaje = loggerErrorSpy.mock.calls[0]?.[0] as string;
      expect(mensaje).toContain('QZ_PRIVATE_KEY');
      expect(mensaje).not.toContain(claveRotaEnv.QZ_PRIVATE_KEY);
      expect(mensaje).not.toContain(privateKey);
    });

    it('firmar() falla igual que "no configurado" (BadRequest), no con el error OpenSSL crudo', () => {
      const service = buildService(claveRotaEnv);
      expect(() => service.firmar('x')).toThrow(BadRequestException);
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
