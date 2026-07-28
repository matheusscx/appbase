import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
  advertenciasReceta?: string[];
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

async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/cerrar`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '100000' }] });
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
    expect((resVenta1.body as VentaResponse).advertenciasReceta ?? []).toEqual(
      [],
    );

    // 4. Venta #2: queso quedó en 10 g (30-20), no alcanza para los 20 g
    // requeridos → no bloqueante, se omite con advertencia; pan y carne sí se descuentan.
    const resVenta2 = await venderUna();
    expect(resVenta2.status).toBe(201);
    expect((resVenta2.body as VentaResponse).advertenciasReceta?.length).toBe(
      1,
    );

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
    expect((resVenta.body as VentaResponse).advertenciasReceta ?? []).toEqual(
      [],
    );

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

  it('10. /uso mixto: el mismo ingrediente es bloqueo de combo y advertencia de extra a la vez', async () => {
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

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Choripan mixto E2E ${Date.now()}`,
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
    expect(resReceta.status).toBe(201);

    // `validarYCostearComponentes` solo admite tipo producto|receta|servicio como
    // componente de combo (items.service.ts ~2998), así que un ingrediente jamás
    // llega a ser componente de combo por la API pública: el caso mixto que /uso
    // tiene que clasificar (bloqueo de combo + advertencia de extra sobre el MISMO
    // item) no es alcanzable end-to-end con las rutas de creación. Se arma un combo
    // real con un producto válido y se agrega la fila de `combo_componentes` que
    // referencia a la salsa directamente por SQL, para ejercer la clasificación de
    // `/uso` en sí — que es lo que este test cubre — sin simular la creación.
    const resProducto = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto combo mixto E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resProducto.status).toBe(201);
    const productoComboId = (resProducto.body as ItemResponse).id;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo mixto E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          {
            componenteItemId: productoComboId,
            cantidad: '1',
            bloqueante: true,
          },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboId = (resCombo.body as ItemResponse).id;

    await ds.query(
      `INSERT INTO combo_componentes
         (tenant_id, combo_item_id, componente_item_id, cantidad, bloqueante)
       VALUES ($1, $2, $3, '1', true)`,
      [PARIS_TENANT_ID, comboId, salsaId],
    );

    const resUso = await request(app.getHttpServer())
      .get(`/api/items/${salsaId}/uso`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUso.status).toBe(200);
    const uso = resUso.body as {
      bloqueos: { tipo: string; nombre: string }[];
      advertencias: { tipo: string; nombre: string }[];
    };
    expect(uso.bloqueos.length).toBeGreaterThan(0);
    expect(uso.bloqueos.every((b) => b.tipo === 'combo')).toBe(true);
    expect(uso.advertencias.map((a) => a.tipo)).toEqual(['extra']);

    const resDel = await request(app.getHttpServer())
      .delete(`/api/items/${salsaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDel.status).toBe(400);
  });

  it('11. /uso exige Items:Eliminar — Items:Leer no alcanza', async () => {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'vendedor@paris.cl', password: 'admin' });
    const initialToken = (resLogin.body as TokenResponse).access_token;
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${initialToken}`)
      .send({ tenantId: PARIS_TENANT_ID });
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
});
