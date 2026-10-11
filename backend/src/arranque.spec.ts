import { EventEmitter } from 'node:events';
import { type INestApplication, Logger } from '@nestjs/common';
import {
  habilitarApagadoOrdenado,
  origenesCors,
  TOPE_APAGADO_MS,
} from './arranque';

describe('origenesCors', () => {
  it('parte CORS_ORIGINS por coma, recorta y descarta vacíos', () => {
    expect(
      origenesCors({
        CORS_ORIGINS:
          ' https://app.tudominio.cl , ,https://admin.tudominio.cl,',
        FRONTEND_URL: 'https://ignorado.cl',
      }),
    ).toEqual(['https://app.tudominio.cl', 'https://admin.tudominio.cl']);
  });

  it('sin CORS_ORIGINS queda FRONTEND_URL, lo que había antes de la lista', () => {
    expect(
      origenesCors({ FRONTEND_URL: 'https://front.up.railway.app' }),
    ).toEqual(['https://front.up.railway.app']);
    expect(
      origenesCors({
        CORS_ORIGINS: ' , ',
        FRONTEND_URL: 'http://localhost:5176',
      }),
    ).toEqual(['http://localhost:5176']);
  });

  it('sin ninguna de las dos (o vacías), el frontend de desarrollo', () => {
    expect(origenesCors({})).toEqual(['http://localhost:5173']);
    expect(origenesCors({ CORS_ORIGINS: '', FRONTEND_URL: '' })).toEqual([
      'http://localhost:5173',
    ]);
  });

  it.each([
    ['*', 'el comodín no vale con credentials'],
    ['https://app.tudominio.cl/', 'barra final: el navegador no la manda'],
    ['https://app.tudominio.cl/login', 'una ruta no es un origen'],
    ['app.tudominio.cl', 'sin esquema'],
    [
      'https://*.tudominio.cl',
      'un comodín de subdominio tampoco: compara literal',
    ],
    ['wss://app.tudominio.cl', 'un navegador no manda ese esquema como Origin'],
  ])('rechaza al arrancar "%s" (%s)', (valor) => {
    expect(() => origenesCors({ CORS_ORIGINS: valor })).toThrow(
      /no es un origen/,
    );
  });

  it('de FRONTEND_URL toma el origen: puede traer ruta, es base de links', () => {
    expect(
      origenesCors({ FRONTEND_URL: 'https://front.up.railway.app/app/' }),
    ).toEqual(['https://front.up.railway.app']);
  });

  it.each(['localhost:5173', 'no es url'])(
    'un FRONTEND_URL sin origen http(s) ("%s") no frena el arranque: queda tal cual, con aviso',
    (valor) => {
      const aviso = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        expect(origenesCors({ FRONTEND_URL: valor })).toEqual([valor]);
        expect(aviso).toHaveBeenCalledWith(
          expect.stringContaining('CORS_ORIGINS'),
        );
      } finally {
        aviso.mockRestore();
      }
    },
  );
});

describe('habilitarApagadoOrdenado', () => {
  let servidor: EventEmitter;
  let app: {
    enableShutdownHooks: jest.Mock;
    getHttpServer: () => EventEmitter;
  };
  let antes: Record<'SIGTERM' | 'SIGINT', ((...a: unknown[]) => void)[]>;
  let exit: jest.SpyInstance;

  const respuesta = (headersSent = false) =>
    Object.assign(new EventEmitter(), { headersSent, setHeader: jest.fn() });

  beforeEach(() => {
    jest.useFakeTimers();
    exit = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    antes = {
      SIGTERM: process.listeners('SIGTERM'),
      SIGINT: process.listeners('SIGINT'),
    };
    servidor = new EventEmitter();
    app = { enableShutdownHooks: jest.fn(), getHttpServer: () => servidor };
    habilitarApagadoOrdenado(app as unknown as INestApplication);
  });

  afterEach(() => {
    for (const senal of ['SIGTERM', 'SIGINT'] as const)
      for (const l of process.listeners(senal))
        if (!antes[senal].includes(l)) process.removeListener(senal, l);
    exit.mockRestore();
    jest.useRealTimers();
  });

  it('engancha SIGTERM y SIGINT con salida por process.exit (node es PID 1 en prod)', () => {
    expect(app.enableShutdownHooks).toHaveBeenCalledWith(
      ['SIGTERM', 'SIGINT'],
      {
        useProcessExit: true,
      },
    );
  });

  it('desde la señal, lo que está en vuelo y lo que entra después sale con Connection: close', () => {
    const enVuelo = respuesta();
    const yaContestada = respuesta(true);
    const terminada = respuesta();
    servidor.emit('request', {}, enVuelo);
    servidor.emit('request', {}, yaContestada);
    servidor.emit('request', {}, terminada);
    terminada.emit('close');

    expect(enVuelo.setHeader).not.toHaveBeenCalled();
    process.emit('SIGTERM');

    expect(enVuelo.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(yaContestada.setHeader).not.toHaveBeenCalled();
    expect(terminada.setHeader).not.toHaveBeenCalled();

    const nueva = respuesta();
    servidor.emit('request', {}, nueva);
    expect(nueva.setHeader).toHaveBeenCalledWith('Connection', 'close');
  });

  it('si el apagado no termina en el tope, sale con código 1', () => {
    process.emit('SIGTERM');
    jest.advanceTimersByTime(TOPE_APAGADO_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('sin señal no hay tope corriendo', () => {
    jest.advanceTimersByTime(TOPE_APAGADO_MS * 2);
    expect(exit).not.toHaveBeenCalled();
  });
});
