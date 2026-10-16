import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateImpresoraDto } from './create-impresora.dto';
import { UpdateImpresoraDto } from './update-impresora.dto';

const red = (host: string) => ({
  nombre: 'Cocina',
  rol: 'comanda',
  tipoConexion: 'red',
  host,
  puerto: 9100,
});

const errorDeHost = async (host: string) =>
  (await validate(plainToInstance(CreateImpresoraDto, red(host)))).filter(
    (e) => e.property === 'host',
  );

// Auditoría UX 07.17: el host de una impresora de red se validaba solo como "no vacío"; el dueño
// se enteraba de que la IP estaba mal cuando la cocina no recibía la primera comanda.
describe('host de una impresora de red', () => {
  it.each([
    '192.168.1.50',
    '10.0.0.9',
    'cocina.local',
    'impresora-1.lan.local',
    // Un nombre de una sola palabra es válido en una red local.
    'cocina',
  ])('acepta %s', async (host) => {
    expect(await errorDeHost(host)).toHaveLength(0);
  });

  it.each([
    'cocina principal',
    '999.1.1.1',
    '192.168.1',
    '192.168.1.50.7',
    'con espacio.local',
    'http://10.0.0.9',
  ])('rechaza %s', async (host) => {
    expect(await errorDeHost(host)).toHaveLength(1);
  });

  it('la impresora de sistema no pide host', async () => {
    const dto = plainToInstance(CreateImpresoraDto, {
      nombre: 'Cocina',
      rol: 'comanda',
      tipoConexion: 'sistema',
      nombreCola: 'EPSON',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('el PATCH también valida el host si viene', async () => {
    const mal = await validate(
      plainToInstance(UpdateImpresoraDto, { host: '999.1.1.1' }),
    );
    expect(mal.some((e) => e.property === 'host')).toBe(true);
    const bien = await validate(
      plainToInstance(UpdateImpresoraDto, { host: '10.0.0.9' }),
    );
    expect(bien).toHaveLength(0);
  });
});
