import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { CajaTestigo } from '../src/modules/caja/entities/caja-testigo.entity';

/**
 * Task 1 (esquema y entidades): solo el arranque. No hay endpoints ni lógica
 * todavía — lo único que hay que probar es que la app levanta con `CajaTestigo`
 * registrada. Sin `autoLoadEntities`, olvidar el `entities: [...]` de
 * `app.module.ts` no lo caza ni el unit ni el typecheck, solo un e2e real
 * contra Postgres.
 */
describe('CajaTestigo (e2e) — arranque', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('la app levanta con CajaTestigo registrada en el DataSource', () => {
    const ds = app.get(DataSource);
    expect(ds.isInitialized).toBe(true);
    expect(ds.getMetadata(CajaTestigo).tableName).toBe('caja_testigo');
  });
});
