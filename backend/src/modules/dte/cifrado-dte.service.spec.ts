import type { ConfigService } from '@nestjs/config';
import { CifradoDteService } from './cifrado-dte.service';

const clave = Buffer.alloc(32, 7).toString('base64');
const servicio = (valor?: string) =>
  new CifradoDteService({ get: () => valor } as unknown as ConfigService);

describe('CifradoDteService', () => {
  it('ida y vuelta, con un texto latin1 como el de un CAF', () => {
    const s = servicio(clave);
    const texto = '<RS>PANADERÍA ÑUÑOA</RS>';
    const blob = s.cifrar(texto);
    expect(blob.startsWith('v1:')).toBe(true);
    expect(blob).not.toContain('PANADER');
    expect(s.descifrar(blob)).toBe(texto);
  });

  it('dos cifrados del mismo texto no se parecen (IV aleatorio)', () => {
    const s = servicio(clave);
    expect(s.cifrar('x')).not.toBe(s.cifrar('x'));
  });

  it('un blob adulterado no se descifra', () => {
    const s = servicio(clave);
    const [v, iv, tag, data] = s.cifrar('secreto').split(':');
    const otro = Buffer.from(data, 'base64');
    otro[0] ^= 1;
    expect(() =>
      s.descifrar([v, iv, tag, otro.toString('base64')].join(':')),
    ).toThrow();
  });

  it('sin clave o con una que no mide 32 bytes, no construye', () => {
    expect(() => servicio(undefined)).toThrow('DTE_ENCRYPTION_KEY');
    expect(() => servicio(Buffer.alloc(16).toString('base64'))).toThrow(
      '32 bytes',
    );
  });
});
