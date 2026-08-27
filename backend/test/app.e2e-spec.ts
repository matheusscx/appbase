import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type App } from 'supertest/types';
import { type Server } from 'http';
import { type AddressInfo } from 'net';
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
   * El servidor de los tests **queda atado** a `127.0.0.1`, no al wildcard.
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
   *
   * ⚠️ **Este test afirmaba la LLAMADA (`toHaveBeenCalledWith(0, '127.0.0.1')`)
   * y por eso estaba verde con el sistema roto.** La llamada siempre ocurrió; lo
   * que no ocurría era el bind, porque `listen` con host resuelve el nombre por
   * `dns.lookup` y **bindea asincrónicamente** — para cuando el handle existe,
   * supertest ya bindeó el wildcard en el mismo tick y ganó. Un espía sobre el
   * llamado no puede ver eso. Se afirma sobre `address()`, que es el estado.
   */
  it('el server de los tests queda atado a 127.0.0.1, no al wildcard', async () => {
    const server = app.getHttpServer() as Server;

    // Antes de cualquier request: si el bind no se esperó, acá no hay dirección
    // que preguntar (`null`) o hay una del wildcard (`::`).
    const alIniciar = server.address() as AddressInfo | null;
    expect(alIniciar).not.toBeNull();
    expect(alIniciar?.address).toBe('127.0.0.1');

    await request(app.getHttpServer()).get('/').expect(200);

    // Y sigue siendo el MISMO puerto después del request: con la dirección ya
    // puesta, supertest no levanta server propio y por lo tanto no lo cierra.
    // Si lo cerrara, cada request volvería a sortear puerto y la exposición
    // sería por request y no por archivo.
    const trasRequest = server.address() as AddressInfo | null;
    expect(trasRequest?.address).toBe('127.0.0.1');
    expect(trasRequest?.port).toBe(alIniciar?.port);
  });

  afterEach(async () => {
    await app.close();
  });
});
