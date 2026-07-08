import { type ConfigService } from '@nestjs/config';
import { CredencialesService } from './credenciales.service';
import { type Pasarela } from '../entities/pasarela.entity';
import { type TenantPasarela } from '../entities/tenant-pasarela.entity';

// 32 bytes en base64 para tests
const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString(
  'base64',
);

function makeService(): CredencialesService {
  const config = {
    get: jest.fn().mockReturnValue(TEST_KEY),
  } as unknown as ConfigService;
  return new CredencialesService(config);
}

describe('CredencialesService', () => {
  it('cifra y descifra texto (round-trip)', () => {
    const svc = makeService();
    const blob = svc.cifrarTexto('tbk-user-secreto');
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain('tbk-user-secreto');
    expect(svc.descifrarTexto(blob)).toBe('tbk-user-secreto');
  });

  it('dos cifrados del mismo texto producen blobs distintos (IV aleatorio)', () => {
    const svc = makeService();
    expect(svc.cifrarTexto('x')).not.toBe(svc.cifrarTexto('x'));
  });

  it('rechaza un blob adulterado (auth tag)', () => {
    const svc = makeService();
    const blob = svc.cifrarTexto('secreto');
    const partes = blob.split(':');
    partes[3] = Buffer.from('adulterado!!').toString('base64');
    expect(() => svc.descifrarTexto(partes.join(':'))).toThrow();
  });

  it('lanza si PASARELA_ENCRYPTION_KEY falta o no mide 32 bytes', () => {
    const sinKey = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    expect(() => new CredencialesService(sinKey)).toThrow(
      'PASARELA_ENCRYPTION_KEY',
    );
    const corta = {
      get: jest.fn().mockReturnValue(Buffer.from('corta').toString('base64')),
    } as unknown as ConfigService;
    expect(() => new CredencialesService(corta)).toThrow('32 bytes');
  });

  describe('resolver', () => {
    const pasarela = {
      urlPruebas: 'https://webpay3gint.transbank.cl',
      urlProduccion: 'https://webpay3g.transbank.cl',
    } as Pasarela;

    it('MALL: mezcla credenciales de plataforma + commerce code hijo del tenant', () => {
      const svc = makeService();
      const p = {
        ...pasarela,
        configuracionPruebas: svc.cifrarJson({
          mallCommerceCode: '597055555541',
          apiKeySecret: 'S3CR3T',
        }),
      } as Pasarela;
      const tp = {
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
        configuracion: svc.cifrarJson({ commerceCodeHijo: '597055555542' }),
      } as TenantPasarela;
      expect(svc.resolver(tp, p)).toEqual({
        baseUrl: 'https://webpay3gint.transbank.cl',
        mallCommerceCode: '597055555541',
        apiKeySecret: 'S3CR3T',
        commerceCodeHijo: '597055555542',
      });
    });

    it('INDIVIDUAL: usa solo la configuración del tenant + baseUrl según ambiente', () => {
      const svc = makeService();
      const tp = {
        ambiente: 'produccion',
        modoIntegracion: 'individual',
        configuracion: svc.cifrarJson({
          mallCommerceCode: 'M-TENANT',
          apiKeySecret: 'K-TENANT',
          commerceCodeHijo: 'H-TENANT',
        }),
      } as TenantPasarela;
      const resultado = svc.resolver(tp, pasarela);
      expect(resultado.baseUrl).toBe('https://webpay3g.transbank.cl');
      expect(resultado.mallCommerceCode).toBe('M-TENANT');
    });

    it('lanza BadRequest si faltan credenciales', () => {
      const svc = makeService();
      const tp = {
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
        configuracion: null,
      } as TenantPasarela;
      const p = { ...pasarela, configuracionPruebas: null } as Pasarela;
      expect(() => svc.resolver(tp, p)).toThrow('credenciales');
    });
  });
});
