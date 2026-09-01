import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Todo descuento y todo recargo tiene que expresar CUÁNTO descuenta o recarga.
 * Decisión del owner (2026-08-01): *"los descuentos tienen que tener valor, no
 * se me ocurre para qué puede servir un descuento sin valor"*.
 *
 * Existe como e2e y no solo como unit porque el unit mockea el repositorio y
 * **no ejercita el `ValidationPipe` ni el DTO**, que es justo por donde entraba
 * el agujero: `valor` es `@IsOptional()`, así que un `{ "valor": null }` pasa
 * la validación de forma y llega al service. Las dos puertas se verificaron
 * ABIERTAS contra esta misma API antes de cerrarlas — las CUATRO: crear un
 * `directo` sin valor (201), vaciar el valor con `PATCH { valorPorcentaje: null }` (200),
 * y cambiar el `tipoReglaId` a uno que exige valor o tramas sin mandarlos (200
 * las dos). Estos tests fijan conducta que estuvo rota, no hipótesis.
 *
 * Las dos últimas son la lección: no alcanza con validar el campo que llega,
 * porque cambiar el TIPO cambia qué campos hacen falta. Se valida el estado
 * con el que la fila queda.
 *
 * No vive en `calculo-precios.e2e-spec.ts` (que consume estas reglas) porque
 * esto es validación de CRUD, no aritmética de precios; y no había ningún e2e
 * de descuentos/recargos donde meterlo.
 *
 * Desde el 2026-09-01 cubre una segunda garantía del mismo CRUD —por eso el
 * `describe` dice "CRUD" y ya no solo "todo expresa su monto"—: editar la lista
 * de métodos de pago de una regla no puede dejarla sin ninguno. Vive acá por el
 * mismo motivo que el resto: el unit mockea el repositorio, y lo que fallaba era
 * la decisión INSERT-vs-UPDATE del ORM contra Postgres real.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

// Tipos sembrados (`seeder.service.ts` → `seedTiposRegla`).
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_DESCUENTO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
const TIPO_RECARGO_POR_MONTO = '550e8400-e29b-41d4-a716-446655440353';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TIPO_DESCUENTO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440118';
const TIPO_RECARGO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440124';

// Métodos de pago del catálogo global (`seeder.service.ts` → `seedMetodosPago`).
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';

interface TokenResponse {
  access_token: string;
}
interface ReglaResponse {
  id: string;
  nombre: string;
  valorMonto: string | null;
  valorPorcentaje: string | null;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

describe('Descuentos y recargos (e2e) — CRUD', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const crearDescuento = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  // ─── Puerta 1: crear ──────────────────────────────────────────────────────

  it('crear un descuento `directo` SIN valor es 400', async () => {
    const res = await crearDescuento({
      nombre: `Directo sin valor E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
    });

    expect(res.status).toBe(400);
  });

  it('crear un descuento `directo` CON valor sigue funcionando', async () => {
    // Ancla positiva: sin esto, el test de arriba pasaría igual si el endpoint
    // estuviera roto para cualquier `directo`.
    const res = await crearDescuento({
      nombre: `Directo con valor E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
    });

    expect(res.status).toBe(201);
    // El POST devuelve el valor TAL CUAL se mandó; el normalizado a 4 decimales
    // de la columna aparece recién al releerlo.
    expect((res.body as ReglaResponse).valorPorcentaje).toBe('0.10');
  });

  it('mandar la columna equivocada dice CUÁL corresponde, no "falta el valor"', async () => {
    // El cliente mandó un importe: contestarle "el valor es requerido" lo manda
    // a buscar donde no está. Depende del ORDEN de las validaciones en el
    // service, y por eso se fija acá.
    const res = await crearDescuento({
      nombre: `Columna equivocada E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorMonto: '5000',
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /el importe va en valorPorcentaje/,
    );
  });

  // ─── El borde de escala sobre el importe en plata ─────────────────────────

  it('rechaza un monto fijo con decimales que la moneda no admite', async () => {
    // El tenant Paris opera en CLP, que no tiene centavos (`decimales = 0`).
    // Sin el pipe esto entra y Postgres recorta con su propia regla: el número
    // guardado deja de ser el que se tecleó.
    const res = await crearDescuento({
      nombre: `Descuento con centavos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'monto_fijo',
      valorMonto: '1000.55',
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimales/);
  });

  it('acepta el mismo monto sin decimales', async () => {
    const res = await crearDescuento({
      nombre: `Descuento redondo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'monto_fijo',
      valorMonto: '1000',
    });

    expect(res.status).toBe(201);
  });

  it('el porcentaje NO se valida contra la escala de la moneda', async () => {
    // `0.0750` tiene 4 decimales y CLP admite 0: si el pipe mirara esta
    // columna sería 400. No es plata — es la razón de que sean dos columnas.
    const res = await crearDescuento({
      nombre: `Descuento 7,5% E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.0750',
    });

    expect(res.status).toBe(201);
  });

  it('valida también el monto de un tramo, que viaja anidado', async () => {
    // El pipe no recorre anidados sin `@Type()` en el padre; `CreateDescuentoDto`
    // ya lo tiene, y esto es lo que lo fija.
    const res = await crearDescuento({
      nombre: `Tramo con centavos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'monto_fijo',
      tramos: [{ minimoCantidad: '10', valorMonto: '500.25' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimales/);
  });

  it('el MÍNIMO en plata también pasa por el borde de escala', async () => {
    // Es el pago del corte de `minimo` (2026-08-24). Antes el umbral vivía en
    // una sola columna que significaba kilos o pesos según el tipo, y por eso
    // no se podía marcar: `@EsMontoCobrado()` habría rechazado un "2,5 kg"
    // legítimo. Partido en dos, el de plata sí se marca.
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Umbral con centavos E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_POR_MONTO,
        modo: 'monto_fijo',
        tramos: [{ minimoMonto: '20000.50', valorMonto: '500' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimales/);
  });

  it('el MÍNIMO en cantidad conserva sus decimales (2,5 kg es legítimo)', async () => {
    // La contracara, y la que evita que el arreglo se pase de largo: un local
    // que vende al peso pone "llevando 2,5 kg o más". Si esta columna llevara
    // la marca de plata, en un tenant CLP esto sería 400.
    const res = await crearDescuento({
      nombre: `Por mayor al peso E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '2.5', valorPorcentaje: '0.10' }],
    });

    expect(res.status).toBe(201);
  });

  it('el mínimo en la columna que no corresponde al tipo es 400', async () => {
    const res = await crearDescuento({
      nombre: `Umbral cruzado E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoMonto: '10', valorPorcentaje: '0.10' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/minimoCantidad/);
  });

  // ─── Puerta 2: vaciar por PATCH ───────────────────────────────────────────
  // La más grave de las dos, y la que no era exclusiva de `directo`: afectaba
  // a CUALQUIER tipo, en descuentos y en recargos.

  it('vaciar el valor de un descuento por PATCH es 400, y el valor no cambia', async () => {
    const nombre = `Promo PATCH E2E ${Date.now()}`;
    const creado = await crearDescuento({
      nombre,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.15',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorPorcentaje: null });
    expect(res.status).toBe(400);

    // Y no quedó a medias: el valor original sigue ahí.
    const listado = await request(app.getHttpServer())
      .get('/api/descuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(listado.status).toBe(200);
    const fila = (listado.body as ReglaResponse[]).find((d) => d.id === id);
    expect(fila?.valorPorcentaje).toBe('0.1500');
  });

  it('vaciar el valor de un recargo por PATCH es 400, y el valor no cambia', async () => {
    const nombre = `Recargo PATCH E2E ${Date.now()}`;
    const creado = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valorPorcentaje: '0.05',
      });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/recargos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorPorcentaje: null });
    expect(res.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/recargos')
      .set('Authorization', `Bearer ${token}`);
    expect(listado.status).toBe(200);
    const fila = (listado.body as ReglaResponse[]).find((r) => r.id === id);
    expect(fila?.valorPorcentaje).toBe('0.0500');
  });

  // ─── Puertas 3 y 4: cambiar el TIPO ───────────────────────────────────────
  // Las encontró la revisión (la 3) y la reproducción en vivo (la 4). Son la
  // misma clase: cambiar `tipoReglaId` cambia QUÉ campos hacen falta, y mirar
  // solo el campo que llega en el PATCH no lo ve. Las dos devolvían 200.

  it('cambiar el tipo a `directo` sin mandar valor es 400', async () => {
    // `por_mayor` guarda el monto en tramos, así que su `valor` es nulo.
    const creado = await crearDescuento({
      nombre: `Por tramos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.05' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_DIRECTO });

    expect(res.status).toBe(400);
  });

  it('cambiar el tipo a uno por tramos sin mandarlos es 400', async () => {
    const creado = await crearDescuento({
      nombre: `Directo a tramos E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_POR_MAYOR });

    expect(res.status).toBe(400);
  });

  it('cambiar el tipo MANDANDO lo que el nuevo exige sí funciona (ancla positiva)', async () => {
    const creado = await crearDescuento({
      nombre: `Cambio de tipo válido E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.05' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    // El `tramos: []` es parte de "lo que el nuevo exige" desde el 2026-08-26:
    // `update` solo reemplaza los hijos que vengan en el DTO, así que sin él
    // los escalones del `por_mayor` quedan vivos y la fila termina diciendo dos
    // cosas —el motor cobraría el 5% del escalón, no este 25%—. El test de
    // abajo fija esa mitad.
    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        valorPorcentaje: '0.25',
        tramos: [],
      });

    expect(res.status).toBe(200);

    const listado = await request(app.getHttpServer())
      .get('/api/descuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(listado.status).toBe(200);
    const fila = (listado.body as ReglaResponse[]).find((d) => d.id === id);
    expect(fila?.valorPorcentaje).toBe('0.2500');
  });

  // La mitad que el test de arriba no puede fijar: cambiar de tipo SIN limpiar
  // los escalones deja la fila diciendo dos cosas, y eso es 400. Se verificó
  // ABIERTO contra esta API antes de cerrarlo: respondía 200 y dejaba un
  // `directo` al 25% que el motor cobraba al 5% del escalón huérfano.
  it('pero cambiar el tipo SIN limpiar los escalones es 400', async () => {
    const creado = await crearDescuento({
      nombre: `Cambio sin limpiar E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.05' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoReglaId: TIPO_DESCUENTO_DIRECTO, valorPorcentaje: '0.25' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /no admite escalones/,
    );
  });

  // La dirección ESPEJO, que la primera versión de este frente dejó rota: de
  // valor único a un tipo POR ESCALONES. Acá el huérfano es el valor
  // persistido, que `importeResultante` lee cuando el body no manda la columna.
  // Medido contra esta API: antes del guardia era 200, y con el guardia sin su
  // mitad de frontend quedaba en 400 nombrando un campo que la pantalla no
  // muestra (`campoValor: false` en los tipos por escalones).
  it('cambiar un `directo` a un tipo por escalones sin apagar el valor es 400', async () => {
    const creado = await crearDescuento({
      nombre: `Directo a escalones E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.20',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
        tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.05' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /no admite un valor único/,
    );
  });

  it('y apagando esa columna en el mismo body sí funciona (ancla positiva)', async () => {
    const creado = await crearDescuento({
      nombre: `Directo a escalones OK E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.20',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
        valorPorcentaje: null,
        tramos: [{ minimoCantidad: '10', valorPorcentaje: '0.05' }],
      });

    expect(res.status).toBe(200);
  });

  it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
    // Sin esta ancla, los dos tests de arriba pasarían igual si el PATCH
    // estuviera roto para todo.
    const creado = await crearDescuento({
      nombre: `Directo renombrable E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.20',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;
    const nuevoNombre = `Directo renombrado E2E ${Date.now()}`;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nuevoNombre });

    expect(res.status).toBe(200);
    expect((res.body as ReglaResponse).nombre).toBe(nuevoNombre);
  });

  // ─── Puerta 3: el monto de un TRAMO ───────────────────────────────────────
  // Tercera cara de la misma falla: la regla "un porcentaje se expresa en
  // decimal" se enforzaba solo por el camino del `valor` único. Los dos casos
  // de abajo se verificaron ABIERTOS contra esta API antes de cerrarlos (201 y
  // 400 respectivamente, 2026-08-02).

  it('crear un descuento por tramos con un tramo `50` en porcentaje es 400', async () => {
    // El typo natural de quien piensa "50%". Entraba con 201 y producía un
    // descuento del 5000% sobre la línea.
    const res = await crearDescuento({
      nombre: `Tramo 50 E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10', valorPorcentaje: '50' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimal/);
  });

  it('el mismo `5000` en modo monto fijo sí entra (ancla positiva)', async () => {
    // Lo que decide es el modo, no el número: sin esta ancla el test de arriba
    // pasaría igual si los tramos estuvieran rotos para todo.
    const res = await crearDescuento({
      nombre: `Tramo fijo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'monto_fijo',
      tramos: [{ minimoCantidad: '10', valorMonto: '5000' }],
    });

    expect(res.status).toBe(201);
  });

  it('un tramo sin importe es 400, no un 500 contra el CHECK', async () => {
    // Al partir `valor` en dos campos opcionales se perdió el guardia que daba
    // el DTO (`valor` era obligatorio). Sin validación propia, este body llega
    // al CHECK de tabla y Postgres lo rechaza como 500.
    const res = await crearDescuento({
      nombre: `Tramo sin importe E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /tiene que expresar su importe/,
    );
  });

  it('el mismo mensaje sirve en un POST, donde no hay ningún tramo guardado', async () => {
    // El tramo que no cuadra llegó en el body, no de la BD. El texto tiene que
    // ser cierto por los dos caminos con una sola redacción: hasta el
    // 2026-08-23 hablaba de "los tramos guardados" y de "si el PATCH no los
    // reenvía" también acá, donde no hay PATCH ni nada guardado.
    const res = await crearDescuento({
      nombre: `Tramo unidad cruzada E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      tramos: [{ minimoCantidad: '10', valorMonto: '5000' }],
    });

    expect(res.status).toBe(400);
    const mensaje = (res.body as { message: string }).message;
    expect(mensaje).toMatch(/hay un tramo con su importe en valorMonto/);
    expect(mensaje).toMatch(/tienen que expresarlo en valorPorcentaje/);
  });

  it('cambiar SOLO el modo a porcentaje revalida los tramos ya guardados', async () => {
    // El `PATCH` no trae tramos, y hay que leerlos igual. Lo que cambió con
    // las columnas partidas es el MOTIVO del rechazo: antes el 5000 guardado
    // se reinterpretaba como 500.000% y lo frenaba la regla del decimal; ahora
    // ese 5000 vive en `valorMonto` y el modo nuevo no puede leerlo, así que
    // el rechazo dice directamente que la unidad no corresponde. Sigue siendo
    // 400 y sigue siendo por los tramos guardados.
    const creado = await crearDescuento({
      nombre: `Tramo remodo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'monto_fijo',
      tramos: [{ minimoCantidad: '10', valorMonto: '5000' }],
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modo: 'porcentaje' });

    expect(res.status).toBe(400);
    // El mensaje nombra al TRAMO y dice qué hacer: el cliente mandó bien su
    // `modo`, lo que no cuadra es un tramo guardado que el PATCH no reenvió.
    // Se anclan las DOS mitades: la segunda —la que dice qué mandar— es la
    // única accionable, y estuvo sin cubrir mientras decía algo que en un POST
    // no era cierto.
    const mensaje = (res.body as { message: string }).message;
    expect(mensaje).toMatch(/hay un tramo con su importe en valorMonto/);
    expect(mensaje).toMatch(/tienen que expresarlo en valorPorcentaje/);
  });

  it('un PATCH de valor sobre una regla monto_fijo no lo lee como porcentaje', async () => {
    // La cara opuesta: la validación adivinaba `porcentaje` cuando el `PATCH`
    // no reenviaba el modo, y rechazaba con 400 una edición legítima.
    const creado = await crearDescuento({
      nombre: `Cupón fijo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'monto_fijo',
      valorMonto: '1000',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorMonto: '5000' });

    expect(res.status).toBe(200);
    expect((res.body as ReglaResponse).valorMonto).toBe('5000');
  });

  it('un PATCH que apaga la columna correcta y manda la otra dice cuál corresponde', async () => {
    // La forma que arma cualquier cliente que serialice el formulario entero:
    // las dos columnas en el body, la buena en `null` y el número en la que no
    // corresponde. La fila resultante queda sin importe, así que el chequeo de
    // "requerido" contestaba primero —*"El valor es requerido para este tipo"*
    // a quien acababa de mandar un valor— y el mensaje que dice CUÁL columna va
    // no llegaba nunca. El frontend no arma esta forma; muerde a la API.
    const creado = await crearDescuento({
      nombre: `Columna cruzada E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
    });
    expect(creado.status).toBe(201);
    const id = (creado.body as ReglaResponse).id;

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorPorcentaje: null, valorMonto: '5000' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /el importe va en valorPorcentaje/,
    );
  });

  // ─── Recargo por escalones de monto (tipo nuevo, 2026-08-22) ──────────────
  // El owner decidió construir los tramos de recargo en vez de borrar la
  // plomería muerta que los persistía sin que ningún tipo los pidiera.

  it('crear un recargo por monto de venta SIN tramos es 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Rec por monto sin tramos E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_POR_MONTO,
        modo: 'monto_fijo',
        valorMonto: '2000',
      });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /al menos un tramo/,
    );
  });

  it('el motor cobra el tramo que corresponde al monto, sin haber tocado el motor', async () => {
    // Es la prueba de que el tipo nuevo no necesitó cambios en
    // `calculo-precios.engine.ts`: `evaluarRegla` ramifica por
    // `tramos.length > 0` y el código nuevo no está ni en `DIFERIDAS` ni en
    // `METODO_PAGO_CODIGOS`, así que llega a la rama de tramos con la magnitud
    // del monto.
    const creado = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Rec pedido chico E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_POR_MONTO,
        modo: 'monto_fijo',
        tramos: [
          { minimoMonto: '0', valorMonto: '2000' },
          { minimoMonto: '20000', valorMonto: '500' },
        ],
      });
    expect(creado.status).toBe(201);
    const recargoId = (creado.body as ReglaResponse).id;

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Item con recargo por monto E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '500',
        recargosIds: [recargoId],
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as { id: string }).id;

    const calcular = (cantidad: string) =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId, cantidad }] });

    // 1 × 1000 = 1000 → cae en el tramo de $0: recarga 2000.
    const chico = await calcular('1');
    expect(chico.status).toBe(201);
    expect(
      (chico.body as { totales: { totalRecargos: string } }).totales
        .totalRecargos,
    ).toBe('2000.000000');

    // 30 × 1000 = 30.000 → cae en el tramo de $20.000: recarga 500.
    const grande = await calcular('30');
    expect(grande.status).toBe(201);
    expect(
      (grande.body as { totales: { totalRecargos: string } }).totales
        .totalRecargos,
    ).toBe('500.000000');
  });

  it('un recargo con un tramo `50` en porcentaje también es 400', async () => {
    // Ningún tipo de recargo pide tramos, pero la plomería es alcanzable por
    // API y el motor los evalúa mirando `tramos.length` antes que el código.
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Recargo tramo 50 E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valorPorcentaje: '0.05',
        tramos: [{ minimoMonto: '10', valorPorcentaje: '50' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/decimal/);
  });

  it('"envío gratis sobre $30.000": el tramo en 0 entra y el motor NO cobra', async () => {
    // El caso que originó la entrada del backlog. Los tramos son abiertos
    // hacia arriba —no hay `maximo`—, así que el escalón que deja de cobrar
    // solo se puede expresar poniéndolo en 0. Hasta el 2026-08-24 esto era un
    // 400 y el caso más común de un recargo por envío no se podía cargar.
    //
    // Va por la API entera a propósito: el `> 0` que se aflojó vive en una
    // función, pero que un `'0'` sobreviva depende además del DTO
    // (`@IsNumberString`), del CHECK de tabla y de que `aplicarValor` corte
    // por `== null` y no por falsy. Un test sobre la función sola no ve nada
    // de eso.
    const creado = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Rec envio gratis E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_POR_MONTO,
        modo: 'monto_fijo',
        tramos: [
          { minimoMonto: '0', valorMonto: '2000' },
          { minimoMonto: '30000', valorMonto: '0' },
        ],
      });
    expect(creado.status).toBe(201);
    const recargoId = (creado.body as ReglaResponse).id;

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Item con envio gratis E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '500',
        recargosIds: [recargoId],
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as { id: string }).id;

    const calcular = (cantidad: string) =>
      request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId, cantidad }] });

    // 1 × 1000 = 1000 → tramo de $0: cobra el envío.
    const chico = await calcular('1');
    expect(chico.status).toBe(201);
    expect(
      (chico.body as { totales: { totalRecargos: string } }).totales
        .totalRecargos,
    ).toBe('2000.000000');

    // 40 × 1000 = 40.000 → tramo de $30.000, que vale 0: el envío no se cobra.
    // El total tiene que ser el neto pelado, no el neto + 2000: si el tramo en
    // cero no se eligiera, acá seguiría aplicando el de abajo.
    const grande = await calcular('40');
    expect(grande.status).toBe(201);
    const totales = (
      grande.body as {
        totales: { totalRecargos: string; subtotalNeto: string };
      }
    ).totales;
    expect(totales.totalRecargos).toBe('0.000000');
    expect(totales.subtotalNeto).toBe('40000.000000');
  });

  it('pero el valor PLANO en 0 sigue siendo 400: para apagar una regla se pausa', async () => {
    // La asimetría decidida por el owner el 2026-08-24. Una regla plana en 0
    // se aplicaría en cada venta sin cobrar nada y sin avisarle a nadie;
    // pausarla hace lo mismo y el POS sí avisa ("está en pausa y no se
    // aplicó"). Dos formas de apagar una regla, una silenciosa, es lo que
    // esto evita.
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Recargo plano 0 E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'monto_fijo',
        valorMonto: '0',
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/mayor a 0/);
  });

  // ─── Una regla dice su importe de UNA forma ───────────────────────────────
  // Los tipos que no eligen: `directo` cobra un valor único, `por_monto_venta`
  // cobra por escalones. Hasta el 2026-08-26 los dos aceptaban las dos formas
  // juntas con 201, y el motor —que ramifica por `tramos.length > 0` antes de
  // mirar el valor plano— dejaba muerta la perdedora sin avisar.
  //
  // Va como e2e por el mismo motivo que el resto del archivo: `tramos` y
  // `valorPorcentaje` son los dos `@IsOptional()`, así que el `ValidationPipe`
  // deja pasar el body con las dos y el service es el ÚNICO enforcement. El
  // unit mockea el repositorio y no ejercita esa puerta.
  //
  // Las anclas positivas ya están en este archivo y no se duplican: *"crear un
  // descuento `directo` CON valor sigue funcionando"* y *"el motor cobra el
  // tramo que corresponde al monto"*.

  it('un descuento `directo` con valor único Y escalones es 400', async () => {
    const res = await crearDescuento({
      nombre: `Directo ambiguo E2E ${Date.now()}`,
      tipoReglaId: TIPO_DESCUENTO_DIRECTO,
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
      tramos: [{ minimoMonto: '100', valorPorcentaje: '0.03' }],
    });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /no admite escalones/,
    );
  });

  it('y un recargo por monto de venta con escalones Y valor plano también', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Rec por monto ambiguo E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_POR_MONTO,
        modo: 'monto_fijo',
        valorMonto: '2000',
        tramos: [{ minimoMonto: '500', valorMonto: '1000' }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /no admite un valor único/,
    );
  });

  it('el tipo `promocional` ya no existe en el catálogo', async () => {
    // Se eliminó el 2026-08-23: su caso se mudó al módulo de promociones, y
    // `directo` con fechas cubre el descuento con vigencia. Sin este test, el
    // tipo puede volver por un merge del seeder y nadie se entera.
    const res = await request(app.getHttpServer())
      .get('/api/tipos-regla?clase=descuento')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const codigos = (res.body as { codigo: string }[]).map((t) => t.codigo);
    expect(codigos).not.toContain('promocional');
    expect(codigos).toContain('directo');
  });
  // ─── Editar los métodos de pago no puede dejar la regla muda ──────────────

  describe('los métodos de pago sobreviven al PATCH', () => {
    // `PATCH { metodoPagoIds }` reemplaza la lista entera: apaga las filas
    // viejas de la tabla puente y guarda las nuevas. La puente tiene PK
    // compuesta `(descuento_id, metodo_pago_id)`, así que un método que ya
    // estuvo en la lista **reusa su fila** —no hay una nueva que insertar— y
    // ahí es donde se perdía.
    //
    // Por qué es plata y no cosmética: `evaluarRegla` exige que el método de
    // pago del cobro esté en la lista de la regla. Un método que desaparece de
    // la lista deja de descontar en ese método **y no lo dice**: el PATCH
    // contesta 200 con la lista que le mandaron, porque la respuesta hace eco
    // del DTO en vez de releer la tabla. Por eso los tests leen del `GET`.
    //
    // Va como e2e y no como unit porque lo que decide el resultado es el ORM
    // contra Postgres real —INSERT de una fila nueva vs UPDATE de la que ya
    // está—; el unit mockea el repositorio y esa decisión no existe.

    const metodosDe = async (
      recurso: 'descuentos' | 'recargos',
      id: string,
    ): Promise<string[]> => {
      const res = await request(app.getHttpServer())
        .get(`/api/${recurso}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const regla = (
        res.body as { id: string; metodoPagoIds: string[] }[]
      ).find((r) => r.id === id);
      expect(regla).toBeDefined();
      return [...regla!.metodoPagoIds].sort();
    };

    const crearPorMetodoPago = async (
      recurso: 'descuentos' | 'recargos',
      metodoPagoIds: string[],
    ): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post(`/api/${recurso}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Por metodo de pago E2E ${recurso} ${Date.now()}`,
          tipoReglaId:
            recurso === 'descuentos'
              ? TIPO_DESCUENTO_METODO_PAGO
              : TIPO_RECARGO_METODO_PAGO,
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
          metodoPagoIds,
        });
      expect(res.status).toBe(201);
      return (res.body as ReglaResponse).id;
    };

    const editarMetodos = async (
      recurso: 'descuentos' | 'recargos',
      id: string,
      metodoPagoIds: string[],
    ): Promise<void> => {
      const res = await request(app.getHttpServer())
        .patch(`/api/${recurso}/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ metodoPagoIds });
      expect(res.status).toBe(200);
    };

    it('agregar un método conserva el que el descuento ya tenía', async () => {
      // La escena: el descuento aplica en tarjeta de crédito y el local decide
      // que también aplique en efectivo. Lo que no puede pasar es que sumar
      // efectivo le saque la tarjeta.
      const id = await crearPorMetodoPago('descuentos', [TARJETA_CREDITO_ID]);
      await editarMetodos('descuentos', id, [TARJETA_CREDITO_ID, EFECTIVO_ID]);

      expect(await metodosDe('descuentos', id)).toEqual(
        [TARJETA_CREDITO_ID, EFECTIVO_ID].sort(),
      );
    });

    it('sacar un método y volver a ponerlo lo revive', async () => {
      // El caso que obliga a revivir en vez de insertar: la fila
      // `(descuento, efectivo)` ya existe apagada, y su PK compuesta no deja
      // meter otra igual.
      const id = await crearPorMetodoPago('descuentos', [
        TARJETA_CREDITO_ID,
        EFECTIVO_ID,
      ]);
      await editarMetodos('descuentos', id, [TARJETA_CREDITO_ID]);
      expect(await metodosDe('descuentos', id)).toEqual([TARJETA_CREDITO_ID]);

      await editarMetodos('descuentos', id, [TARJETA_CREDITO_ID, EFECTIVO_ID]);
      expect(await metodosDe('descuentos', id)).toEqual(
        [TARJETA_CREDITO_ID, EFECTIVO_ID].sort(),
      );
    });

    it('reemplazar la lista entera deja exactamente la nueva', async () => {
      // Ancla del otro lado: revivir no puede convertir el reemplazo en una
      // suma. El método que se sacó tiene que quedar afuera.
      const id = await crearPorMetodoPago('descuentos', [TARJETA_CREDITO_ID]);
      await editarMetodos('descuentos', id, [EFECTIVO_ID]);

      expect(await metodosDe('descuentos', id)).toEqual([EFECTIVO_ID]);
    });

    it('el mismo método repetido en el body es 400, no un 500 de Postgres', async () => {
      // La lista se guarda con un `ON CONFLICT DO UPDATE`, que en Postgres no
      // puede tocar la misma fila dos veces en una sentencia; y en el `POST` el
      // repetido ya reventaba contra la PK compuesta de la puente desde
      // siempre. Lo ataja el `@ArrayUnique()` del DTO —el mismo decorador que
      // usan las listas de ids de propinas y recuentos—, así que los dos verbos
      // contestan igual en vez de un 500 en uno y un 200 a medias en el otro.
      const creado = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Metodos repetidos E2E ${Date.now()}`,
          tipoReglaId: TIPO_DESCUENTO_METODO_PAGO,
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
          metodoPagoIds: [EFECTIVO_ID, EFECTIVO_ID],
        });
      expect(creado.status).toBe(400);

      const id = await crearPorMetodoPago('descuentos', [TARJETA_CREDITO_ID]);
      const patch = await request(app.getHttpServer())
        .patch(`/api/descuentos/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ metodoPagoIds: [EFECTIVO_ID, EFECTIVO_ID] });
      expect(patch.status).toBe(400);
      // Y la regla queda como estaba. Lo que esta línea fija es el estado, que
      // es lo que le importa a quien editaba: NO distingue de dónde vino el
      // rechazo —`update` corre en transacción, así que un 400 del service
      // después del soft-stamp dejaría lo mismo—. Que sea del pipe lo dice el
      // mensaje (`All metodoPagoIds's elements must be unique`).
      expect(await metodosDe('descuentos', id)).toEqual([TARJETA_CREDITO_ID]);
    });

    it('y en recargos, que copian la misma forma, pasa lo mismo', async () => {
      const id = await crearPorMetodoPago('recargos', [TARJETA_CREDITO_ID]);
      await editarMetodos('recargos', id, [TARJETA_CREDITO_ID, EFECTIVO_ID]);
      expect(await metodosDe('recargos', id)).toEqual(
        [TARJETA_CREDITO_ID, EFECTIVO_ID].sort(),
      );

      await editarMetodos('recargos', id, [EFECTIVO_ID]);
      expect(await metodosDe('recargos', id)).toEqual([EFECTIVO_ID]);
    });
  });
});
