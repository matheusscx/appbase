import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const CUERPO_CON_SECRETO =
  'Entrá acá para elegir tu contraseña:\n' +
  'https://app.startup-pos.cl/elegir-contrasena/TOKEN-EN-CLARO-abc123';

const MAIL = {
  para: 'alguien@paris.cl',
  asunto: 'Elegí tu contraseña',
  cuerpo: CUERPO_CON_SECRETO,
};

/** Construye el service con el entorno dado, sin `SMTP_HOST`. */
async function construir(nodeEnv: string | undefined): Promise<MailService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MailService,
      {
        provide: ConfigService,
        useValue: {
          get: (clave: string) => (clave === 'NODE_ENV' ? nodeEnv : undefined),
        },
      },
    ],
  }).compile();

  return module.get<MailService>(MailService);
}

describe('MailService — sin SMTP_HOST', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Todo lo que el service escribió, por cualquier nivel, en un solo string. */
  const todoLoLogueado = (): string =>
    [log, error, warn]
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.join(' '))
      .join('\n');

  describe('en producción', () => {
    // El agujero que cerró esta entrada: el cuerpo lleva la URL con el token en
    // claro, y el fallback lo escribía entero en el log.
    it('NUNCA escribe el cuerpo en el log', async () => {
      const service = await construir('production');

      await service.enviar(MAIL);

      expect(todoLoLogueado()).not.toContain('TOKEN-EN-CLARO-abc123');
      expect(todoLoLogueado()).not.toContain(CUERPO_CON_SECRETO);
    });

    it('sí registra destinatario y asunto, para poder reenviar a mano', async () => {
      const service = await construir('production');

      await service.enviar(MAIL);

      const escrito = todoLoLogueado();
      expect(escrito).toContain('alguien@paris.cl');
      expect(escrito).toContain('Elegí tu contraseña');
    });

    it('lo registra como error, no como log informativo', async () => {
      const service = await construir('production');
      // Se limpian los tres: el arranque ya escribió su propio `error`, y Nest
      // loguea por su cuenta al compilar el módulo. Sin esto el test afirmaría
      // sobre ruido de construcción en vez de sobre el envío.
      [log, error, warn].forEach((spy) => spy.mockClear());

      await service.enviar(MAIL);

      expect(error).toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('avisa al arrancar que ningún mail va a salir', async () => {
      await construir('production');

      expect(error).toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('fuera de producción', () => {
    // El fallback es el loop de desarrollo y es deliberado: el link aparece
    // clickeable en el log del backend, y los cientos de e2e de cada cierre no
    // pueden disparar mails reales.
    it('escribe el cuerpo completo, que es para lo que existe', async () => {
      const service = await construir('development');

      await service.enviar(MAIL);

      expect(todoLoLogueado()).toContain('TOKEN-EN-CLARO-abc123');
    });

    it('trata la falta de SMTP_HOST como advertencia, no como error', async () => {
      await construir('development');

      expect(warn).toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    // `NODE_ENV` sin definir es el caso de una corrida local a secas: no puede
    // caer en la rama de producción por accidente.
    it('sin NODE_ENV se comporta como desarrollo', async () => {
      const service = await construir(undefined);

      await service.enviar(MAIL);

      expect(todoLoLogueado()).toContain('TOKEN-EN-CLARO-abc123');
    });
  });

  it('`envioReal` es false sin SMTP_HOST, en los dos entornos', async () => {
    expect((await construir('production')).envioReal).toBe(false);
    expect((await construir('development')).envioReal).toBe(false);
  });
});
