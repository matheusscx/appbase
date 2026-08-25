import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// "Promo fija $5.000" — descuento monto_fijo sin condiciones (seedDescuentos()),
// de nivel LÍNEA: se asocia a ítems y se descuenta línea por línea.
const DESCUENTO_FIJO_ID = '550e8400-e29b-41d4-a716-446655440338';
// "Promo del total $5.000" — su gemela de nivel VENTA. Los `descuentosVentaIds`
// solo aceptan reglas de este nivel: mandar la de arriba es 400.
const DESCUENTO_FIJO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440360';
// Tipo de regla `directo` y moneda CLP, ambos del seed. Se usan para crear una
// regla y un ítem propios del test, sin depender del estado de los sembrados.
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
// "Papas fritas" — producto, precio_base 1500, precio_incluye_impuesto = false.
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440281';
// Tipo `recargo_metodo_pago` y "Tarjeta de crédito", los dos del seed. Se usan
// para el recargo de tarjeta POR ESCALONES.
const TIPO_RECARGO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440124';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
// "Producto demo (unidad · CLP)" — `clasificacion_tributaria = 'afecto'`, el
// motor le deriva el IVA del país (ya no hay `item_impuestos` asociado). Se usa
// para el caso de casing: un total sin impuesto delata que se perdieron las
// reglas del ítem, que es la mitad del bug que un simple 201 no probaría.
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
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
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
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
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
        descuentosVentaIds: [DESCUENTO_FIJO_VENTA_ID],
      });

    expect(res.status).toBe(201);
    const body = res.body as ResultadoVentaResponse;

    expect(body.advertenciasVenta).toHaveLength(1);
    expect(body.advertenciasVenta[0].titulo).toContain(
      'Promo del total $5.000',
    );
    expect(body.lineas[0].advertencias).toHaveLength(0);
    expect(body.advertencias).toHaveLength(1);
  });

  /**
   * `cantidad` se valida con `<= 0` en `resolverLinea`, `precioUnitario` no: con
   * `@IsNumberString()` a secas un `-100` pasaba y el endpoint devolvía
   * `totalFinal: -100`. Se alinea con el camino real de venta, que exige
   * `IsDecimalPositivo`.
   */
  it('rechaza un precioUnitario negativo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1', precioUnitario: '-100' }],
      });

    expect(res.status).toBe(400);
  });

  /**
   * El contrario del de arriba, y no es simetría decorativa: `LineaVentaDto`
   * pasó a exigir `> 0` el 2026-08-11 y este endpoint **no** lo siguió. Acá el
   * `0` llega de dos composables que mandan el precio ya calculado de la línea
   * (`useVenta.ts:197`, `useSalones.ts:200`), y vale 0 cuando el ítem vale 0 y
   * la personalización no agrega nada pago. Este test fija esa divergencia:
   * endurecerlo por simetría rompe el cobro en silencio — `useCalculoPrecios`
   * se traga el error y el carrito nunca vuelve a estar vigente.
   */
  it('acepta un precioUnitario en 0 (ítem sin precio, personalización sin recargo)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1', precioUnitario: '0' }],
      });

    expect(res.status).toBe(201);
  });

  /**
   * El recargo de tarjeta POR ESCALONES, de punta a punta: el POST lo guarda,
   * `findAll` lo devuelve con sus tramos y el motor cobra el del tramo
   * alcanzado.
   *
   * ⚠️ Por qué hace falta un e2e y no alcanza el unit del motor: hasta el
   * 2026-08-25 los tramos de estos dos tipos **se guardaban y se leían bien**;
   * lo que fallaba era el último tramo del recorrido, `evaluarRegla`, que
   * retornaba con el valor plano antes de mirarlos. Un test que le arma el
   * `ReglaResuelta` al motor a mano no habría probado que el dato sobrevive el
   * viaje — y ese viaje es el que ya rompió antes en otros campos.
   */
  describe('recargo por método de pago con escalones', () => {
    let recargoId: string;
    let itemPropioId: string;

    beforeAll(async () => {
      // "3% con tarjeta, y 1,5% arriba de $2.000". El ítem vale $1.000, así que
      // una unidad cae en el tramo de abajo y tres en el de arriba.
      const resRec = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Tarjeta por tramos E2E ${Date.now()}`,
          tipoReglaId: TIPO_RECARGO_METODO_PAGO,
          modo: 'porcentaje',
          metodoPagoIds: [TARJETA_CREDITO_ID],
          tramos: [
            { minimoMonto: '0', valorPorcentaje: '0.03' },
            { minimoMonto: '2000', valorPorcentaje: '0.015' },
          ],
        });
      expect(resRec.status).toBe(201);
      recargoId = (resRec.body as { id: string }).id;

      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Item tarjeta E2E ${Date.now()}`,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: '10',
          costo: '500',
          recargosIds: [recargoId],
        });
      expect(resItem.status).toBe(201);
      itemPropioId = (resItem.body as { id: string }).id;
    });

    const calcular = (cantidad: string, metodoPagoId?: string) =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: itemPropioId, cantidad }],
          ...(metodoPagoId ? { metodoPagoId } : {}),
        });

    it('los tramos vuelven del GET tal como se guardaron', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/recargos')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const guardado = (
        res.body as { id: string; tramos: { minimoMonto: string | null }[] }[]
      ).find((r) => r.id === recargoId);
      expect(guardado?.tramos).toHaveLength(2);
    });

    it('con tarjeta y $1.000 cobra el 3% del tramo de abajo', async () => {
      const res = await calcular('1', TARJETA_CREDITO_ID);
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalRecargos).toBe('30.000000');
    });

    it('con tarjeta y $3.000 cobra el 1,5% del tramo de arriba', async () => {
      const res = await calcular('3', TARJETA_CREDITO_ID);
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalRecargos).toBe('45.000000');
    });

    it('con efectivo no cobra nada: la condición sigue mandando', async () => {
      const res = await calcular('1', EFECTIVO_ID);
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalRecargos).toBe('0.000000');
    });

    it('sin método de pago tampoco cobra', async () => {
      const res = await calcular('1');
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalRecargos).toBe('0.000000');
    });

    it('la API rechaza guardar las dos formas juntas', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Tarjeta ambigua E2E ${Date.now()}`,
          tipoReglaId: TIPO_RECARGO_METODO_PAGO,
          modo: 'porcentaje',
          metodoPagoIds: [TARJETA_CREDITO_ID],
          valorPorcentaje: '0.03',
          tramos: [{ minimoMonto: '0', valorPorcentaje: '0.02' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'una sola forma',
      );
    });

    it('un PATCH puede volver de escalones a valor único', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/recargos/${recargoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tramos: [], valorPorcentaje: '0.02' });
      expect(res.status).toBe(200);

      const calc = await calcular('1', TARJETA_CREDITO_ID);
      expect(calc.status).toBe(201);
      expect((calc.body as ResultadoVentaResponse).totales.totalRecargos).toBe(
        '20.000000',
      );
    });
  });

  /**
   * Pausar una regla (`activo = false`) tiene que sacarla del total SIN tocar
   * sus asociaciones, y sin romper la venta. La secuencia es el test: aplica →
   * pausada no aplica → la asociación sigue viva → reactivada vuelve a aplicar.
   *
   * El `expect(201)` del caso pausado no es decorativo: la forma descartada de
   * arreglar esto era filtrar `activo` al cargar el catálogo, y eso dejaba al
   * motor con un id ausente del mapa, donde `requerir()` tira 400 y el POS deja
   * de vender. Un test que solo mirara el total daría verde con esa forma rota.
   */
  describe('una regla pausada no se aplica y no rompe la venta', () => {
    let descuentoId: string;
    let itemPropioId: string;

    beforeAll(async () => {
      const resDesc = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Pausable E2E ${Date.now()}`,
          tipoReglaId: TIPO_DESCUENTO_DIRECTO,
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
        });
      expect(resDesc.status).toBe(201);
      descuentoId = (resDesc.body as { id: string }).id;

      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Item pausable E2E ${Date.now()}`,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: '10',
          costo: '500',
          descuentosIds: [descuentoId],
        });
      expect(resItem.status).toBe(201);
      itemPropioId = (resItem.body as { id: string }).id;
    });

    const calcular = () =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId: itemPropioId, cantidad: '1' }] });

    const setActivo = (activo: boolean) =>
      request(app.getHttpServer())
        .patch(`/api/descuentos/${descuentoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ activo });

    it('activa: el descuento asociado se aplica', async () => {
      const res = await calcular();
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalDescuentos).toBe('100.000000');
      expect(body.lineas[0].advertencias).toHaveLength(0);
    });

    it('pausada: no descuenta, responde 201 y avisa', async () => {
      expect((await setActivo(false)).status).toBe(200);

      const res = await calcular();
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalDescuentos).toBe('0.000000');
      expect(body.lineas[0].advertencias).toHaveLength(1);
      expect(body.lineas[0].advertencias[0].detalle).toBe(
        'está en pausa y no se aplicó',
      );
    });

    // Lo que el modal de la pantalla le promete al admin: "las asociaciones se
    // conservan". Si alguna vez pausar vuelve a limpiar `item_descuentos`, este
    // test cae y el modal deja de mentir.
    it('pausada: la asociación con el ítem sigue intacta', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/items/${itemPropioId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect((res.body as { descuentosIds: string[] }).descuentosIds).toContain(
        descuentoId,
      );
    });

    it('reactivada: vuelve a aplicar sin haber tocado nada más', async () => {
      expect((await setActivo(true)).status).toBe(200);

      const res = await calcular();
      expect(res.status).toBe(201);
      const body = res.body as ResultadoVentaResponse;
      expect(body.totales.totalDescuentos).toBe('100.000000');
      expect(body.lineas[0].advertencias).toHaveLength(0);
    });
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
