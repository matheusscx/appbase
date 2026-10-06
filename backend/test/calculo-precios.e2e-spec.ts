import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

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
// Tipo `general` de recargo y "Recargo por pedido chico", de nivel VENTA, los
// dos del seed.
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
const RECARGO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440354';
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
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('descuento de línea topeado avisa en la línea, no en la venta', async () => {
    // La regla y el ítem son del test: la línea toma los descuentos de su ítem,
    // y asociar "Promo fija $5.000" a un ítem le movería el uso a las suites
    // que lo cuentan.
    const nombre = `Fijo $5.000 E2E ${randomUUID()}`;
    const resDesc = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'monto_fijo',
        valorMonto: '5000',
      });
    expect(resDesc.status).toBe(201);
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio de $1.500 E2E ${randomUUID()}`,
        precioBase: '1500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        descuentosIds: [(resDesc.body as { id: string }).id],
      });
    expect(resItem.status).toBe(201);

    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          { itemId: (resItem.body as { id: string }).id, cantidad: '1' },
        ],
      });

    expect(res.status).toBe(201);
    const body = res.body as ResultadoVentaResponse;

    expect(body.lineas[0].advertencias).toHaveLength(1);
    expect(body.lineas[0].advertencias[0].titulo).toContain(nombre);
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
   * El contrato que reemplaza a los dos tests que vivían acá —"rechaza un
   * `precioUnitario` negativo" y "acepta un `precioUnitario` en 0"—: **el campo
   * ya no existe**, así que no hay signo ni cero que validar. Lo que hay que
   * proteger es que su desaparición sea real y no cosmética.
   *
   * Hasta el 2026-09-27 el pipe corría sin `forbidNonWhitelisted` y el campo se
   * ignoraba en silencio (201 en las dos, mismos totales). Desde entonces un
   * cliente viejo que lo siga mandando recibe 400 nombrando el campo: el número
   * del cliente no llega nunca al motor. El control es el mismo pedido sin el
   * campo, que calcula: el 400 es por el campo y no por otra cosa.
   */
  it('rechaza un precioUnitario en el body: el precio sale del catálogo', async () => {
    const pedir = (linea: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId: ITEM_ID, cantidad: '1', ...linea }] });

    const sinCampo = await pedir({});
    const conCampo = await pedir({ precioUnitario: '999999' });

    expect(sinCampo.status).toBe(201);
    expect(conCampo.status).toBe(400);
    expect(JSON.stringify(conCampo.body)).toContain(
      'property precioUnitario should not exist',
    );
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

  /**
   * Las reglas de una línea salen del ítem (owner, 2026-10-06). Hasta esa fecha
   * `descuentoIds`/`recargoIds` de la línea **reemplazaban** los del ítem: un
   * celular de $11.900 salía a $5.950 con un descuento que no tenía asociado, y
   * `recargoIds: []` le sacaba a un servicio su recargo. Ahora el campo no existe
   * en ninguna de las cuatro puertas y el pipe global contesta 400 nombrándolo.
   *
   * Las filas usan las dos formas medidas: meter una regla ajena (`descuentoIds`
   * con "Promo fija $5.000", que el ítem no tiene) y sacar la propia
   * (`recargoIds: []` contra un ítem con su recargo). El control —mismo pedido
   * sin el campo— prueba que el 400 es por el campo y que la línea sigue
   * cobrando las reglas de su ítem.
   *
   * ⚠️ Se afirma el MENSAJE y no solo el status: sin caja abierta, o sin
   * pasarela, la puerta también da 400 por otra cosa. Con el campo devuelto al
   * DTO, un test que mirara solo el status seguiría verde.
   */
  describe('las reglas de una línea salen del ítem: mandar otras es 400', () => {
    let ds: DataSource;
    let caja: CajaAbierta | undefined;
    let recargoId: string;
    /** Servicio: no tiene stock, así que las ventas del spec no gastan nada. */
    let itemConRecargoId: string;

    beforeAll(async () => {
      ds = app.get(DataSource);
      const resRec = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Recargo del ítem E2E ${randomUUID()}`,
          tipoReglaId: TIPO_RECARGO_GENERAL,
          modo: 'porcentaje',
          valorPorcentaje: '0.04',
        });
      expect(resRec.status).toBe(201);
      recargoId = (resRec.body as { id: string }).id;

      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Servicio con recargo E2E ${randomUUID()}`,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
          clasificacionTributaria: 'exento',
          recargosIds: [recargoId],
        });
      expect(resItem.status).toBe(201);
      itemConRecargoId = (resItem.body as { id: string }).id;

      caja = await abrirCaja(app, token, {
        comentario: 'Apertura E2E reglas de línea',
      });
    });

    afterAll(async () => {
      if (caja) await cerrarCaja(app, token, caja);
    });

    const PUERTAS = [
      'ventas',
      'calculo-precios/calcular',
      'online/checkout',
      'online/pagar',
    ] as const;
    type Puerta = (typeof PUERTAS)[number];

    const pedir = (puerta: Puerta, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/${puerta}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send(
          puerta === 'ventas'
            ? {
                ...body,
                pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
              }
            : body,
        );

    // Los mensajes de un rechazo: afirma el 400 antes de leer el body, para que
    // otro status no llegue como una lista vacía.
    const mensajesDel400 = (res: {
      status: number;
      body: unknown;
    }): string[] => {
      expect(res.status).toBe(400);
      return [
        (res.body as { message?: string | string[] }).message ?? [],
      ].flat();
    };

    const contarVentas = async (): Promise<string> => {
      // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el
      // pedido escribió algo, y una fila borrada también sería una escritura.
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      return filas[0].n;
    };

    const FILAS = PUERTAS.flatMap((puerta) => [
      { puerta, campo: 'descuentoIds', valor: [DESCUENTO_FIJO_ID] },
      { puerta, campo: 'recargoIds', valor: [] as string[] },
    ]);

    it.each(FILAS)(
      'POST /$puerta con lineas.0.$campo: 400 nombrando el campo, y no escribe',
      async ({ puerta, campo, valor }) => {
        const antes = await contarVentas();
        const res = await pedir(puerta, {
          lineas: [{ itemId: itemConRecargoId, cantidad: '2', [campo]: valor }],
        });
        expect(res.status).toBe(400);
        expect(mensajesDel400(res)).toContain(
          `lineas.0.property ${campo} should not exist`,
        );
        expect(await contarVentas()).toBe(antes);
      },
    );

    // `/online/pagar` queda afuera del control: con una pasarela activa abre una
    // orden, y lo que esta fila prueba ya lo prueba el 400 del pipe.
    it.each(['ventas', 'calculo-precios/calcular', 'online/checkout'] as const)(
      'control en /%s: sin el campo, la línea cobra el recargo de su ítem y ningún descuento',
      async (puerta) => {
        const res = await pedir(puerta, {
          lineas: [{ itemId: itemConRecargoId, cantidad: '2' }],
        });
        expect(res.status).toBe(201);
        const body = res.body as Record<string, unknown>;
        const totales =
          puerta === 'online/checkout'
            ? (body.resultado as ResultadoVentaResponse).totales
            : puerta === 'ventas'
              ? (body as unknown as ResultadoVentaResponse['totales'])
              : (body as unknown as ResultadoVentaResponse).totales;
        // $2.000 exentos con 4%: $80 de recargo, nada de descuento.
        expect(Number(totales.totalRecargos)).toBe(80);
        expect(Number(totales.totalDescuentos)).toBe(0);
        expect(Number(totales.totalFinal)).toBe(2080);
      },
    );

    /**
     * Las reglas de nivel VENTA se quedan abiertas en la caja y se cierran en
     * la tienda (revisado por la Sesión de esfuerzo máximo, 2026-10-06): son la
     * única puerta de esas reglas, que esperan su pantalla, pero el comprador
     * online no elige reglas. Además, `/online/pagar` las metía en el total que
     * se autoriza contra la tarjeta y el callback crea la venta sin ellas.
     */
    describe('las reglas de nivel venta y por método: abiertas en la caja, cerradas en la tienda', () => {
      const VENTA = [
        { campo: 'descuentosVentaIds', id: DESCUENTO_FIJO_VENTA_ID },
        { campo: 'recargosVentaIds', id: RECARGO_VENTA_ID },
      ];
      // $10.000: el descuento de venta de $5.000 no deja la venta en cero.
      const lineas = () => [{ itemId: itemConRecargoId, cantidad: '10' }];

      it.each(
        (['online/checkout', 'online/pagar'] as const).flatMap((puerta) =>
          VENTA.map((v) => ({ puerta, ...v })),
        ),
      )(
        'POST /$puerta con $campo: 400 nombrando el campo',
        async ({ puerta, campo, id }) => {
          const res = await pedir(puerta, { lineas: lineas(), [campo]: [id] });
          expect(res.status).toBe(400);
          expect(mensajesDel400(res)).toContain(
            `property ${campo} should not exist`,
          );
        },
      );

      // Mismo cierre, misma razón (Sesión de esfuerzo máximo, 2026-10-06; lo
      // encontró la revisión de seguridad de este frente): `metodoPagoId` del
      // body prendía las reglas por método en el total que se autoriza, y el
      // callback crea la venta sin él. Autorizar de menos terminaba en un cargo
      // en Webpay sin venta. El control por `/calcular` con `metodoPagoId` es
      // el describe del recargo de tarjeta por escalones, más arriba.
      it.each(['online/checkout', 'online/pagar'] as const)(
        'POST /%s con metodoPagoId: 400 nombrando el campo',
        async (puerta) => {
          const res = await pedir(puerta, {
            lineas: lineas(),
            metodoPagoId: TARJETA_CREDITO_ID,
          });
          expect(res.status).toBe(400);
          expect(mensajesDel400(res)).toContain(
            'property metodoPagoId should not exist',
          );
        },
      );

      it.each(
        (['ventas', 'calculo-precios/calcular'] as const).flatMap((puerta) =>
          VENTA.map((v) => ({ puerta, ...v })),
        ),
      )(
        'POST /$puerta con $campo: se sigue aplicando',
        async ({ puerta, campo, id }) => {
          const res = await pedir(puerta, { lineas: lineas(), [campo]: [id] });
          expect(res.status).toBe(201);
          const body = res.body as Record<string, unknown>;
          const totales =
            puerta === 'ventas'
              ? (body as unknown as ResultadoVentaResponse['totales'])
              : (body as unknown as ResultadoVentaResponse).totales;
          // Sin la regla de venta serían $400 de recargo (4% del ítem) y $0 de
          // descuento. "Recargo por pedido chico" suma $2.000 bajo $20.000.
          if (campo === 'descuentosVentaIds') {
            expect(Number(totales.totalDescuentos)).toBe(5000);
          } else {
            expect(Number(totales.totalRecargos)).toBe(2400);
          }
        },
      );
    });
  });
});
