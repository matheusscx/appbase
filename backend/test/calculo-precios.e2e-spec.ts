import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// "Promo fija $5.000" — descuento monto_fijo sin condiciones (seedDescuentos()).
const DESCUENTO_FIJO_ID = '550e8400-e29b-41d4-a716-446655440338';
// "Papas fritas" — producto, precio_base 1500, precio_incluye_impuesto = false.
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440281';
// "Producto demo (unidad · CLP)" — el ÚNICO ítem del tenant con impuesto
// asociado (`item_impuestos`). Se usa para el caso de casing: un total sin
// impuesto delata que se perdieron las reglas del ítem, que es la mitad del bug
// que un simple 201 no probaría.
const ITEM_CON_IMPUESTO_ID = '550e8400-e29b-41d4-a716-446655440116';

interface TokenResponse {
  access_token: string;
}

interface AdvertenciaResponse {
  titulo: string;
  detalle: string;
}

interface ResultadoLineaResponse {
  advertencias: AdvertenciaResponse[];
}

interface ResultadoVentaResponse {
  lineas: ResultadoLineaResponse[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  advertencias: AdvertenciaResponse[];
  advertenciasVenta: AdvertenciaResponse[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Cálculo de precios (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('descuento de línea topeado avisa en la línea, no en la venta', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: ITEM_ID,
            cantidad: '1',
            descuentoIds: [DESCUENTO_FIJO_ID],
          },
        ],
      });

    expect(res.status).toBe(201);
    const body = res.body as ResultadoVentaResponse;

    expect(body.lineas[0].advertencias).toHaveLength(1);
    expect(body.lineas[0].advertencias[0].titulo).toContain(
      'Promo fija $5.000',
    );
    expect(body.advertenciasVenta).toHaveLength(0);
    expect(body.advertencias).toHaveLength(1);
  });

  it('descuento de venta topeado avisa en la venta, no en la línea', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: ITEM_ID,
            cantidad: '1',
          },
        ],
        descuentosVentaIds: [DESCUENTO_FIJO_ID],
      });

    expect(res.status).toBe(201);
    const body = res.body as ResultadoVentaResponse;

    expect(body.advertenciasVenta).toHaveLength(1);
    expect(body.advertenciasVenta[0].titulo).toContain('Promo fija $5.000');
    expect(body.lineas[0].advertencias).toHaveLength(0);
    expect(body.advertencias).toHaveLength(1);
  });

  /**
   * `@IsUUID('4')` acepta el UUID en mayúsculas y Postgres castea igual, pero la
   * BD lo devuelve en su forma canónica minúscula: los mapas por id que arma
   * `ItemsService` quedaban indexados en minúsculas mientras el chequeo y las
   * búsquedas usaban el string tal cual lo mandó el cliente. Daba 404 en un
   * ítem que existe. Se compara contra el cálculo en minúsculas —no contra
   * números escritos a mano— porque lo que hay que sostener es que el casing es
   * indiferente, y el `totalImpuestos > 0` es lo que le da dientes: sin él, dos
   * cálculos igualmente vacíos pasarían el `toEqual`.
   */
  it('un itemId en mayúsculas calcula igual que en minúsculas', async () => {
    const calcular = (itemId: string) =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });

    const minusculas = await calcular(ITEM_CON_IMPUESTO_ID);
    expect(minusculas.status).toBe(201);
    const totales = (minusculas.body as ResultadoVentaResponse).totales;
    expect(Number(totales.totalImpuestos)).toBeGreaterThan(0);

    const mayusculas = await calcular(ITEM_CON_IMPUESTO_ID.toUpperCase());
    expect(mayusculas.status).toBe(201);
    expect((mayusculas.body as ResultadoVentaResponse).totales).toEqual(
      totales,
    );
  });
});
