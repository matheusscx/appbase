import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  disponible: number | null;
  stock: string | null;
}
interface VentaResponse {
  id: string;
  estado: string;
  advertencias?: string[];
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

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E recetas',
    });
  return (res.body as CajaResponse).id;
}

/**
 * Cierra la caja por las DOS fases reales: `POST /:id/conteo` congela el arqueo y
 * auto-cierra si cuadra; si alguna línea descuadra pasa a `en_conciliacion` y hay
 * que finalizar con `POST /:id/cerrar` + un motivo por línea descuadrada.
 * Antes esto llamaba SOLO a la fase 2 sobre una caja `abierta` e ignoraba el
 * status: no cerraba nada, el cajón quedaba ocupado y la fuga reaparecía como un
 * `409` críptico al abrir en otra suite. Por eso asevera las dos fases.
 * Patrón de referencia: `cerrarEnDosFases` en `caja.e2e-spec.ts`.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '100000' }] });
  expect([200, 201]).toContain(conteo.status);

  if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
    // El conteo declara un monto fijo, así que las ventas en efectivo de esta
    // suite descuadran. La fase 2 exige motivo por línea descuadrada: mandar
    // `lineas: []` da 400 y deja el cajón ocupado. El comentario va siempre para
    // no depender de si el primer motivo activo pide `requiereComentario`.
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    const cierre = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            metodoPagoId: null,
            motivoDiferenciaId: motivoId,
            comentarioDiferencia: 'Cierre de la suite e2e',
          },
        ],
      });
    expect([200, 201]).toContain(cierre.status);
  }
}

async function crearIngrediente(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  unidad: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo: 'ingrediente',
      unidadMedida: unidad,
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Recetas — flujo completo (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let panId: string;
  let carneId: string;
  let quesoId: string;

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
    ds = app.get(DataSource);

    token = await login(app);
    cajaId = await abrirCaja(app, token);
    panId = await crearIngrediente(
      app,
      token,
      'Pan E2E',
      'unidad',
      '10',
      '500',
    );
    carneId = await crearIngrediente(
      app,
      token,
      'Carne E2E',
      'kg',
      '1',
      '8000',
    );
    quesoId = await crearIngrediente(
      app,
      token,
      'Queso E2E',
      'kg',
      '0.01',
      '6000',
    );
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('1. crea la receta y calcula el costo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
          {
            ingredienteItemId: quesoId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });

    expect(res.status).toBe(201);
    const recetaId = (res.body as ItemResponse).id;

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`);
    // 500*1 + 8000*0.15 + 6000*0.02 = 1820
    expect((resGet.body as ItemResponse).costoActual).toBe('1820.0000');
  });

  it('2-3-4-5. vende con stock suficiente, sin queso (no bloqueante), sin carne (bloqueante) y refleja disponible', async () => {
    const localPan = await crearIngrediente(
      app,
      token,
      'Pan local',
      'unidad',
      '10',
      '500',
    );
    // 1 kg = 1000 g; a 150 g/venta alcanzan para 6 ventas exactas (floor(1000/150)=6).
    const localCarne = await crearIngrediente(
      app,
      token,
      'Carne local',
      'kg',
      '1',
      '8000',
    );
    // 30 g: alcanza para la primera venta (20 g) pero no para la segunda.
    const localQueso = await crearIngrediente(
      app,
      token,
      'Queso local',
      'kg',
      '0.03',
      '6000',
    );

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa local ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: localPan,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
          {
            ingredienteItemId: localCarne,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
          {
            ingredienteItemId: localQueso,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });
    const recetaId = (resReceta.body as ItemResponse).id;

    // 5. Disponible: pan floor(10/1)=10, carne floor(1000g/150g)=6 → mínimo 6.
    // Queso no cuenta (no bloqueante), aunque ya sepamos que solo alcanza para 1 venta.
    const resListado = await request(app.getHttpServer())
      .get('/api/items?tipo=receta&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    const recetaListada = (
      resListado.body as { data: ItemResponse[] }
    ).data.find((i) => i.id === recetaId);
    expect(recetaListada?.disponible).toBe(6);

    async function venderUna() {
      return request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: recetaId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500' }],
        });
    }

    // 2. Venta con stock suficiente de TODO (queso recién sembrado con 30 g) →
    // sin advertencias. Esta es venta #1 de las 6 que la carne permite.
    const resVenta1 = await venderUna();
    expect(resVenta1.status).toBe(201);
    expect((resVenta1.body as VentaResponse).advertencias ?? []).toEqual([]);

    // 4. Venta #2: queso quedó en 10 g (30-20), no alcanza para los 20 g
    // requeridos → no bloqueante, se omite con advertencia; pan y carne sí se descuentan.
    const resVenta2 = await venderUna();
    expect(resVenta2.status).toBe(201);
    expect((resVenta2.body as VentaResponse).advertencias?.length).toBe(1);

    // Ventas #3-#6: la carne todavía alcanza (2 de las 6 ya se usaron).
    for (let i = 0; i < 4; i++) {
      const res = await venderUna();
      expect(res.status).toBe(201);
    }

    // 3. Venta #7: la carne ya se agotó (6*150g = 1000g = el stock total) →
    // ingrediente bloqueante sin stock rechaza la venta completa.
    const resVentaFinal = await venderUna();
    expect(resVentaFinal.status).toBe(400);
  });

  it('6. bloquea borrar un ingrediente en uso', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('7. descuenta un extra convirtiendo a la unidad de STOCK del ingrediente', async () => {
    const paltaId = await crearIngrediente(
      app,
      token,
      'Palta E2E',
      'kg',
      '5',
      '4000',
    );
    const panLocalId = await crearIngrediente(
      app,
      token,
      'Pan extras E2E',
      'unidad',
      '10',
      '500',
    );

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa extras E2E ${Date.now()}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panLocalId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: paltaId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    const recetaId = (resReceta.body as ItemResponse).id;

    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: { extras: [{ ingredienteItemId: paltaId }] },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4500' }],
      });
    expect(resVenta.status).toBe(201);
    expect((resVenta.body as VentaResponse).advertencias ?? []).toEqual([]);

    // La porción del extra está en g y el stock de la palta en kg: 5 - 0.02.
    // Si la unidad de stock saliera de la PORCIÓN en vez del ingrediente,
    // convertirUnidad haría g→g y se habrían descontado 20 kg.
    // Alcance real de este test: fija la propiedad (la unidad de stock sale del
    // ingrediente) y ejecuta la query nueva contra Postgres — ningún e2e tocaba
    // `extras`. NO discrimina el fix del código anterior: acá el extra sigue en
    // la carta, así que la búsqueda vieja también resolvía 'kg'. Lo que cubre la
    // regresión son los dos unit de `items.service.spec.ts`. Ver `resueltos.md`.
    const resPalta = await request(app.getHttpServer())
      .get(`/api/items/${paltaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resPalta.body as ItemResponse).stock).toBe('4.9800');
  });

  it('8. /uso reporta como bloqueo el ingrediente que el DELETE rechaza', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${panId}/uso`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const uso = res.body as {
      bloqueos: { tipo: string; nombre: string }[];
      advertencias: { tipo: string; nombre: string }[];
    };
    // Es el mismo item que el test 6 no deja borrar: /uso y remove() tienen que
    // coincidir, porque leen la misma clasificación.
    expect(uso.bloqueos.length).toBeGreaterThan(0);
    expect(uso.bloqueos.every((b) => b.tipo === 'ingrediente')).toBe(true);
  });

  it('9. permite borrar un ingrediente usado solo como extra y soft-deletea la fila', async () => {
    const cheddarId = await crearIngrediente(
      app,
      token,
      'Cheddar solo extra E2E',
      'kg',
      '2',
      '6000',
    );
    const panSoloId = await crearIngrediente(
      app,
      token,
      'Pan solo extra E2E',
      'unidad',
      '10',
      '500',
    );

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Sandwich extras E2E ${Date.now()}`,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panSoloId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: cheddarId,
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '700',
          },
        ],
      });
    expect(resReceta.status).toBe(201);

    const resUso = await request(app.getHttpServer())
      .get(`/api/items/${cheddarId}/uso`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUso.status).toBe(200);
    const uso = resUso.body as {
      bloqueos: { tipo: string; nombre: string }[];
      advertencias: { tipo: string; nombre: string }[];
    };
    expect(uso.bloqueos).toEqual([]);
    expect(uso.advertencias.map((a) => a.tipo)).toEqual(['extra']);

    const resDel = await request(app.getHttpServer())
      .delete(`/api/items/${cheddarId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDel.status).toBe(200);

    // Lo que discrimina del código anterior: que el borrado funcione pasaba
    // igual antes. Que la fila del extra quede soft-deleted, no.
    const filas: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM receta_extras_permitidos
       WHERE ingrediente_item_id = $1`,
      [cheddarId],
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.eliminado_el).not.toBeNull();
  });

  it('10. /uso mixto: el mismo ingrediente es bloqueo de una receta y advertencia de extra en otra', async () => {
    // El caso mixto real (no el de "extra + componente de combo", que
    // `validarYCostearComponentes` y `validarExtrasPermitidos` hacen inalcanzable
    // por la API pública: un componente de combo solo admite tipo
    // producto|receta|servicio, y un extra solo admite tipo ingrediente) es un
    // ingrediente que es ingrediente FIJO de una receta y EXTRA de otra. Se
    // construye íntegramente por `POST /api/items`, sin SQL directo.
    const salsaId = await crearIngrediente(
      app,
      token,
      'Salsa mixta E2E',
      'kg',
      '5',
      '3000',
    );
    const panMixtoId = await crearIngrediente(
      app,
      token,
      'Pan mixto E2E',
      'unidad',
      '10',
      '500',
    );
    const panExtraMixtoId = await crearIngrediente(
      app,
      token,
      'Pan extra mixto E2E',
      'unidad',
      '10',
      '500',
    );

    const nombreRecetaBloqueo = `Choripan mixto E2E ${Date.now()}`;
    const resRecetaBloqueo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreRecetaBloqueo,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panMixtoId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
          {
            ingredienteItemId: salsaId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRecetaBloqueo.status).toBe(201);

    const nombreRecetaExtra = `Sandwich mixto extra E2E ${Date.now()}`;
    const resRecetaExtra = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreRecetaExtra,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panExtraMixtoId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: salsaId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '400',
          },
        ],
      });
    expect(resRecetaExtra.status).toBe(201);

    const resUso = await request(app.getHttpServer())
      .get(`/api/items/${salsaId}/uso`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUso.status).toBe(200);
    const uso = resUso.body as {
      bloqueos: { tipo: string; nombre: string }[];
      advertencias: { tipo: string; nombre: string }[];
    };
    // Ambos arrays vienen poblados a la vez: bloqueo por ser ingrediente fijo
    // de una receta, advertencia por ser extra de otra.
    expect(uso.bloqueos).toEqual([
      { tipo: 'ingrediente', nombre: nombreRecetaBloqueo },
    ]);
    expect(uso.advertencias).toEqual([
      { tipo: 'extra', nombre: nombreRecetaExtra },
    ]);

    const resDel = await request(app.getHttpServer())
      .delete(`/api/items/${salsaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDel.status).toBe(400);
    expect((resDel.body as { message: string }).message).toBe(
      `No se puede eliminar: es ingrediente de ${nombreRecetaBloqueo}`,
    );
  });

  it('11. /uso exige Items:Eliminar — Items:Leer no alcanza', async () => {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'vendedor@paris.cl', password: 'admin' });
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
    const tokenVendedor = (resTenant.body as TokenResponse).access_token;

    // vendedor@paris.cl (rol Vendedor) tiene Items:Leer (sembrado en
    // seedVendedorPermisosCaja para que el POS liste el catálogo) pero nunca
    // Items:Eliminar. Fija la decisión de diseño §2.4 del spec: /uso va detrás
    // de Eliminar, no de Leer, para no abrir una vía lateral de inventariar
    // el catálogo a cualquiera que solo pueda leerlo.
    const res = await request(app.getHttpServer())
      .get(`/api/items/${panId}/uso`)
      .set('Authorization', `Bearer ${tokenVendedor}`);

    expect(res.status).toBe(403);
  });

  // La rama `'cuenta'` del UNION de `obtenerUsoItem` solo se puede verificar
  // ejecutándola: los unit tests parten el SQL y afirman literales, y eso mide
  // presencia, no semántica. Dos mutantes medidos sobrevivían a los unit y
  // mueren acá: quitar `cl.item_id = $1` (todo el catálogo del tenant queda
  // inborrable) y `estado = 'abierta' OR TRUE` (una cuenta cerrada vuelve el
  // ítem inborrable para siempre).
  const MESA_4_ID = '550e8400-e29b-41d4-a716-446655440235';
  // Bruno Díaz, no Ana Torres NI Carla Rojas. Ana: vinculada desde el seed,
  // y vincular invalida el PIN (`GarzonesService.actualizar()`,
  // `6758e7b2`) — su `111111` de dev ya no sirve. Carla: se probó primero
  // (revisión independiente, 2026-08-14) y rompía `liquidacion-propinas.e2e-spec.ts`
  // — ese spec la fuerza al grupo `cocina` vía tip (`:589`) en un test, y
  // una sesión de `recetas` con `tipo_garzon='garzon'` viva en el mismo
  // período la metía en los DOS grupos a la vez, y
  // `assertGarzonEnUnSoloGrupo` cortaba con 400. Medido, no solo leído:
  // `npm run test:e2e` completo con Carla acá daba 1 failed en
  // `liquidacion-propinas`; con Bruno, 0. Bruno nunca cambia de grupo en
  // ese archivo (siempre `tipoGarzon` default = `'garzon'`, grep
  // verificado), así que es inocuo.
  const BRUNO_PIN = '222222';
  const BRUNO_ID = '550e8400-e29b-41d4-a716-446655440239';
  const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

  it('12. un ítem pedido en una cuenta abierta no se puede borrar, y vuelve a poder cuando la cuenta se cierra', async () => {
    const enLaCuentaId = await crearIngrediente(
      app,
      token,
      'Pastel de choclo E2E',
      'unidad',
      '10',
      '8000',
    );
    const sueltoId = await crearIngrediente(
      app,
      token,
      'Item sin cuenta E2E',
      'unidad',
      '10',
      '1000',
    );

    // El cerrar previo deja la sesión idempotente ante corridas locales.
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN, turnoId: TURNO_MANANA_ID });

    const resCuenta = await request(app.getHttpServer())
      .post(`/api/mesas/${MESA_4_ID}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    expect(resCuenta.status).toBe(201);
    const cuentaId = (resCuenta.body as { id: string }).id;

    const resLinea = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: enLaCuentaId, cantidad: '1' });
    expect(resLinea.status).toBe(201);

    type Uso = { bloqueos: { tipo: string; nombre: string }[] };
    const uso = async (id: string): Promise<Uso> => {
      const r = await request(app.getHttpServer())
        .get(`/api/items/${id}/uso`)
        .set('Authorization', `Bearer ${token}`);
      expect(r.status).toBe(200);
      return r.body as Uso;
    };

    // El que está en la cuenta: bloqueado y con la mesa en el nombre.
    const usoEnCuenta = await uso(enLaCuentaId);
    const bloqueoCuenta = usoEnCuenta.bloqueos.find((b) => b.tipo === 'cuenta');
    expect(bloqueoCuenta).toBeDefined();
    expect(bloqueoCuenta?.nombre).toContain('Mesa');

    // El que NO está en ninguna cuenta: sin bloqueo. Es la mitad que mata al
    // mutante de sacar `cl.item_id = $1`, que si no haría que una sola cuenta
    // abierta bloqueara el borrado de todo el catálogo.
    const usoSuelto = await uso(sueltoId);
    expect(usoSuelto.bloqueos.some((b) => b.tipo === 'cuenta')).toBe(false);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${enLaCuentaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDelete.status).toBe(400);
    expect((resDelete.body as { message: string }).message).toContain(
      'está pedido en',
    );

    // Con la cuenta cancelada el bloqueo desaparece: esta mitad mata al mutante
    // que afloja `c.estado = 'abierta'` a `OR TRUE`.
    // ⚠️ Alcance real: usa **cancelada** como proxy de "ya no está abierta".
    // El caso que la doc describe es la cuenta **cerrada**, y montarlo exige
    // caja abierta + pagos. Un mutante quirúrgico `OR c.estado = 'cerrada'`
    // sobrevive a este test: mantiene el literal que afirma el unit y devuelve
    // 0 filas tras el cancel.
    const resCancelar = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCancelar.status).toBe(201);

    const usoTrasCancelar = await uso(enLaCuentaId);
    expect(usoTrasCancelar.bloqueos.some((b) => b.tipo === 'cuenta')).toBe(
      false,
    );

    const resDeleteOk = await request(app.getHttpServer())
      .delete(`/api/items/${enLaCuentaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDeleteOk.status).toBe(200);

    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  });
});
