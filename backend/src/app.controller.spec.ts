import { Test, type TestingModule } from '@nestjs/testing';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Db } from './common/db/db.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const query = jest.fn();

  beforeEach(async () => {
    query.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: Db,
          useValue: {
            query,
            transaccion: (fn: (m: unknown) => unknown) => fn(undefined),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('contesta ok cuando la base responde', async () => {
      query.mockResolvedValue([{ '?column?': 1 }]);

      await expect(appController.verificarSalud()).resolves.toEqual({
        estado: 'ok',
        base: 'ok',
      });
    });

    // La razón de ser del endpoint: si esto pasara a 200, Railway volvería a
    // promover un deployment con la base caída, que es el bug que vino a tapar.
    // El `mockImplementation` vacío no es cosmética: sin él el stack trace del
    // fallo simulado se imprime en cada corrida de la suite.
    it('da 503 y deja el detalle en el log cuando la base no responde', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      query.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(appController.verificarSalud()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      // El operador no ve la causa en la respuesta —es pública y sin auth—, así
      // que el log es su único diagnóstico.
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    });

    // Sin esto, un `SELECT 1` a secas pasaría contra cualquier Postgres vivo,
    // incluido uno vacío que no es el nuestro. El filtro de borrado va en la
    // aserción para que sacarlo del service ponga rojo el invariante.
    it('consulta una tabla del esquema, no solo la conexión', async () => {
      query.mockResolvedValue([]);

      await appController.verificarSalud();

      expect(query).toHaveBeenCalledWith(
        'SELECT 1 FROM usuarios WHERE eliminado_el IS NULL LIMIT 1',
      );
    });

    // La ruta es anónima y es la única pre-auth que toca la base: sin ventana,
    // un flood compite por el pool de `pg` con el tráfico autenticado.
    it('reusa el ok dentro de la ventana en vez de repegarle a la base', async () => {
      query.mockResolvedValue([]);

      await appController.verificarSalud();
      await appController.verificarSalud();

      expect(query).toHaveBeenCalledTimes(1);
    });

    // Sin esto, una ventana infinita pasaría el test de arriba: el `ok` quedaría
    // congelado para siempre y la sonda dejaría de sondear.
    it('vuelve a consultar cuando la ventana venció', async () => {
      jest.useFakeTimers();
      try {
        query.mockResolvedValue([]);

        await appController.verificarSalud();
        jest.advanceTimersByTime(2_001);
        await appController.verificarSalud();

        expect(query).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    // La ventana sola no alcanza: en el borde de cada expiración, todo lo que
    // llegue durante el round-trip pasaría el `if` y pegaría a la base en
    // paralelo — que es la forma que tiene un flood, no la tasa sostenida.
    it('funde las requests concurrentes en una sola query', async () => {
      let resolver: (filas: unknown[]) => void = () => {};
      query.mockReturnValue(
        new Promise((resolve) => {
          resolver = resolve;
        }),
      );

      const primera = appController.verificarSalud();
      const segunda = appController.verificarSalud();
      resolver([]);
      await Promise.all([primera, segunda]);

      expect(query).toHaveBeenCalledTimes(1);
    });

    // Cachear el fallo retrasaría la detección de una base caída justo cuando
    // más importa verla.
    it('no cachea el fallo', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      query.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(appController.verificarSalud()).rejects.toThrow();
      await expect(appController.verificarSalud()).rejects.toThrow();

      expect(query).toHaveBeenCalledTimes(2);
      log.mockRestore();
    });
  });
});
