import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  /**
   * El servidor de los tests escucha en `127.0.0.1`, no en el wildcard.
   *
   * Vive acá porque es la única red del arreglo de `test/setup-supertest.ts`, y
   * ese arreglo es **invisible**: si alguien saca el parche, nada se pone rojo
   * en el momento — vuelve un `401` fantasma cada tantas corridas, en un spec
   * distinto cada vez, que ya costó seis avistajes y varias sesiones de
   * forense.
   *
   * Lo que el parche evita, medido: supertest bindea `listen(0)` —o sea el
   * wildcard `::`— pero después le habla a `http://127.0.0.1:<puerto>`. En
   * macOS un bind al wildcard **convive** con un bind ajeno a `127.0.0.1` en el
   * mismo puerto, y la conexión se la lleva el más específico. Si ese puerto
   * efímero lo tiene cualquier otro programa de la máquina, sus respuestas
   * pasan por nuestras. Detalle completo en el docblock de `setup-supertest.ts`.
   */
  it('el server de los tests se ata a 127.0.0.1, no al wildcard', async () => {
    // Se afirma sobre la LLAMADA y no sobre `address()`: supertest cierra el
    // server al terminar el request, así que después ya no tiene dirección que
    // preguntar. Sin el parche esto sale llamado con `(0)` a secas.
    const server = app.getHttpServer() as { listen: (...a: unknown[]) => void };
    const espia = jest.spyOn(server, 'listen');

    await request(app.getHttpServer()).get('/').expect(200);

    expect(espia).toHaveBeenCalledWith(0, '127.0.0.1');
    espia.mockRestore();
  });

  afterEach(async () => {
    await app.close();
  });
});
