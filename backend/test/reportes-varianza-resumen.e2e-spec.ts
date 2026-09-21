import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { contarYAplicar } from './helpers/recuentos';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ItemBreveResp {
  itemId: string;
  nombre: string;
}
interface ResumenResp {
  totales: Record<string, { monedaId: string; monto: string }[]>;
  top: { itemId: string; merma: string; sinExplicacion: string }[];
  fueraDelTop: number;
  faltaCosto: boolean;
  sinConteo: {
    nuncaContado: { total: number; items: ItemBreveResp[] };
    contadoUnaSolaVez: { total: number; items: ItemBreveResp[] };
  };
}

/**
 * El `/resumen` de varianza contra Postgres real: los totales por moneda, el
 * despeje de «Otros», el faltante de conteo abierto en dos y el aviso de teórico
 * incompleto.
 *
 * ⛔ **Es el único lugar donde estas consultas se pueden probar.** El spec
 * unitario tiene `Db` mockeado y le dicta las filas: lo que cubre es el mapeo y
 * la validación del rango. Acá se prueba el SQL — los `HAVING`, el `LEFT JOIN`
 * cuyo filtro va en el `ON`, y el `NOT EXISTS` de las recetas.
 *
 * 📌 **Casi todo se afirma con `itemId` puesto.** El faltante de conteo mira
 * **todos** los productos activos del tenant, así que sin acotar, los números
 * dependerían de lo que sembró el seed y de lo que dejó cualquier otra suite.
 * Con el filtro, la respuesta habla de un producto que este test creó.
 */
describe('Reporte de varianza — el resumen (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let motivoDiferenciaId: string;
  let bodegaId: string;
  let marca = 0;

  const RANGO = '?desde=2020-01-01&hasta=2020-12-31';

  async function post<T>(url: string, body: object): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** El rango que cubre "hoy", para lo que este spec acaba de escribir. */
  function rangoDeHoy(): string {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = `${hoy.getMonth() + 1}`.padStart(2, '0');
    const d = `${hoy.getDate()}`.padStart(2, '0');
    return `?desde=${y}-${m}-${d}&hasta=${y}-${m}-${d}`;
  }

  async function resumen(query: string): Promise<ResumenResp> {
    const res = await request(app.getHttpServer())
      .get(`/api/reportes/varianza/resumen${query}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as ResumenResp;
  }

  async function crearProducto(opciones: {
    nombre: string;
    stock: string;
    costo?: string;
  }): Promise<string> {
    marca += 1;
    const item = await post<IdResponse>('/api/items', {
      nombre: `${opciones.nombre} ${Date.now()}-${marca}`,
      tipo: 'producto',
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock: '0',
      ...(opciones.costo != null ? { costo: opciones.costo } : {}),
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${item.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: bodegaId,
        cantidad: opciones.stock,
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ...(opciones.costo != null ? { costoUnitario: opciones.costo } : {}),
      });
    expect(res.status).toBe(200);
    return item.id;
  }

  const contar = (itemId: string, cantidadContada: string): Promise<string> =>
    contarYAplicar(app, token, {
      ubicacionId: bodegaId,
      itemId,
      cantidadContada,
      motivoDiferenciaId,
    });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    const resDif = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(resDif.status).toBe(200);
    motivoDiferenciaId = (resDif.body as { id: string }[])[0].id;

    bodegaId = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `Bodega resumen E2E ${Date.now()}`,
        tipo: 'bodega',
      })
    ).id;
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  describe('el rango, que acá es obligatorio', () => {
    /**
     * ⛔ El resumen corre sin `LIMIT` sobre todo el rango: sin fechas, un pedido
     * vacío traería el historial entero del tenant. El listado sí las acepta
     * ausentes — pagina, así que no le cuesta lo mismo.
     */
    it('sin desde/hasta devuelve 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reportes/varianza/resumen')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('con un rango de más de 366 días devuelve 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/reportes/varianza/resumen?desde=2024-01-01&hasta=2026-01-01')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('366');
    });

    /**
     * ⚠️ Esto prueba el `JwtAuthGuard` (sin token, 401), **no** el de permisos.
     * El 403 del módulo no contratado ya está cubierto sobre el listado, y el
     * guard es el mismo a nivel de clase: la etiqueta de este test decía otra
     * cosa y prometía una cobertura que no da.
     */
    it('sin token no se llega al resumen', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/reportes/varianza/resumen${RANGO}`,
      );
      expect(res.status).toBe(401);
    });
  });

  /**
   * ⛔ **Los dos números del faltante, y que cada total cierre con su lista.**
   * Decisión del owner (2026-09-20): al primero le falta empezar a contarse, al
   * segundo le falta cerrar. Son disjuntos por construcción —cero recuentos
   * contra exactamente uno— y esto lo fija contra el `HAVING` real.
   */
  it('el faltante de conteo separa al que nunca se contó del que se contó una vez', async () => {
    const nunca = await crearProducto({
      nombre: 'Resumen nunca contado',
      stock: '10',
      costo: '100',
    });
    const unaVez = await crearProducto({
      nombre: 'Resumen contado una vez',
      stock: '10',
      costo: '100',
    });
    await contar(unaVez, '9');

    const hoy = rangoDeHoy();
    const delNunca = await resumen(`${hoy}&itemId=${nunca}`);
    expect(delNunca.sinConteo.nuncaContado.total).toBe(1);
    expect(delNunca.sinConteo.nuncaContado.items[0].itemId).toBe(nunca);
    expect(delNunca.sinConteo.contadoUnaSolaVez.total).toBe(0);

    const delUnaVez = await resumen(`${hoy}&itemId=${unaVez}`);
    expect(delUnaVez.sinConteo.contadoUnaSolaVez.total).toBe(1);
    expect(delUnaVez.sinConteo.contadoUnaSolaVez.items[0].itemId).toBe(unaVez);
    expect(delUnaVez.sinConteo.nuncaContado.total).toBe(0);
  }, 60000);

  /**
   * ⛔ **El que se contó DOS veces no está en ninguna de las dos listas**: ese sí
   * se puede medir, y aparece en la tabla. Es el control que distingue el
   * `HAVING <= 1` de un `HAVING` que se lleve todo por delante.
   */
  it('el que se puede medir no aparece en el faltante', async () => {
    const medible = await crearProducto({
      nombre: 'Resumen medible',
      stock: '20',
      costo: '100',
    });
    await contar(medible, '19');
    await contar(medible, '17');

    const res = await resumen(`${rangoDeHoy()}&itemId=${medible}`);

    expect(res.sinConteo.nuncaContado.total).toBe(0);
    expect(res.sinConteo.contadoUnaSolaVez.total).toBe(0);
  }, 60000);

  /**
   * ⛔ **Con `ubicacionId` puesto, el faltante se lee POR ESA UBICACIÓN.** Un
   * producto contado dos veces en otra bodega figura como "nunca contado" acá, y
   * es lo correcto: la tabla y el resumen se filtran por ubicación de punta a
   * punta, así que el faltante tiene que describir el mismo universo.
   *
   * ⚠️ **Se fija con un test porque no es obvio y se ve en pantalla**: el mismo
   * producto puede estar "medido" en una vista y "sin contar" en otra, y sin esto
   * el próximo que lo vea lo va a leer como un bug.
   */
  it('el faltante se lee por ubicación: contado en otra bodega es sin contar acá', async () => {
    const otraBodega = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `Bodega resumen otra E2E ${Date.now()}`,
        tipo: 'bodega',
      })
    ).id;

    const itemId = await crearProducto({
      nombre: 'Resumen contado en otra bodega',
      stock: '30',
      costo: '100',
    });
    // Se cuenta DOS veces, pero en la bodega que no vamos a pedir.
    const res1 = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: otraBodega,
        cantidad: '30',
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        costoUnitario: '100',
      });
    expect(res1.status).toBe(200);
    for (const contada of ['29', '27']) {
      await contarYAplicar(app, token, {
        ubicacionId: otraBodega,
        itemId,
        cantidadContada: contada,
        motivoDiferenciaId,
      });
    }

    const hoy = rangoDeHoy();

    const enLaOtra = await resumen(
      `${hoy}&itemId=${itemId}&ubicacionId=${otraBodega}`,
    );
    expect(enLaOtra.sinConteo.nuncaContado.total).toBe(0);
    expect(enLaOtra.sinConteo.contadoUnaSolaVez.total).toBe(0);

    const enLaDelTest = await resumen(
      `${hoy}&itemId=${itemId}&ubicacionId=${bodegaId}`,
    );
    expect(enLaDelTest.sinConteo.nuncaContado.total).toBe(1);
    expect(enLaDelTest.sinConteo.nuncaContado.items[0].itemId).toBe(itemId);
  }, 60000);

  /**
   * ⛔ **Un conteo en cada bodega NO hace medible al producto, y el faltante
   * tiene que decirlo.** La tabla mide por (producto, ubicación): dos conteos
   * repartidos en dos bodegas dan dos filas, ninguna medible. Si el faltante
   * sumara el producto entero vería "2 conteos" y lo daría por medido — y
   * entonces el producto no estaría ni en la tabla como medible ni en el
   * faltante. Desaparecería de las dos vistas, que es justo lo que el faltante
   * existe para impedir.
   *
   * ⚠️ Este test cae si alguien vuelve a agrupar por ítem sin la ubicación.
   */
  it('un conteo en cada bodega no alcanza: sigue estando en el faltante', async () => {
    const otra = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `Bodega repartida E2E ${Date.now()}`,
        tipo: 'bodega',
      })
    ).id;

    const itemId = await crearProducto({
      nombre: 'Resumen repartido',
      stock: '10',
      costo: '100',
    });
    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: otra,
        cantidad: '10',
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        costoUnitario: '100',
      });
    expect(resStock.status).toBe(200);

    // Un conteo en cada una: dos en total, ninguna ubicación llega a dos.
    await contar(itemId, '9');
    await contarYAplicar(app, token, {
      ubicacionId: otra,
      itemId,
      cantidadContada: '9',
      motivoDiferenciaId,
    });

    const res = await resumen(`${rangoDeHoy()}&itemId=${itemId}`);

    expect(res.sinConteo.contadoUnaSolaVez.total).toBe(1);
    expect(res.sinConteo.contadoUnaSolaVez.items[0].itemId).toBe(itemId);
    expect(res.sinConteo.nuncaContado.total).toBe(0);
  }, 60000);

  /**
   * ⛔ **Un conteo hecho en una ubicación que después se borró NO cuenta como
   * conteo.** El listado descarta esas filas, así que si el faltante las contara,
   * el producto quedaría fuera de las dos vistas: ni "medido" en la tabla, ni
   * "falta contarlo" arriba. Desaparecería.
   *
   * ⚠️ Este test también protege la forma del `EXISTS`: va en el `ON` del
   * `LEFT JOIN` justamente para no romper el `LEFT`. Si alguien lo mueve al
   * `WHERE`, el producto de este test deja de aparecer en `nuncaContado` y el
   * test cae.
   */
  it('un conteo en una ubicación borrada no cuenta, y el producto queda como sin contar', async () => {
    const efimera = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: `Bodega efímera E2E ${Date.now()}`,
        tipo: 'bodega',
      })
    ).id;

    const itemId = await crearProducto({
      nombre: 'Resumen bodega borrada',
      stock: '10',
      costo: '100',
    });
    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: efimera,
        cantidad: '10',
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        costoUnitario: '100',
      });
    expect(resStock.status).toBe(200);

    // Se cuenta en CERO: la bodega queda vacía, que es la condición para poder
    // borrarla — con stock adentro la API lo rechaza con 400, y eso está bien.
    await contarYAplicar(app, token, {
      ubicacionId: efimera,
      itemId,
      cantidadContada: '0',
      motivoDiferenciaId,
    });

    const hoy = rangoDeHoy();
    const antes = await resumen(`${hoy}&itemId=${itemId}`);
    expect(antes.sinConteo.contadoUnaSolaVez.total).toBe(1);

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${efimera}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(resBorrar.status);

    const despues = await resumen(`${hoy}&itemId=${itemId}`);
    expect(despues.sinConteo.contadoUnaSolaVez.total).toBe(0);
    expect(despues.sinConteo.nuncaContado.total).toBe(1);
    expect(despues.sinConteo.nuncaContado.items[0].itemId).toBe(itemId);
  }, 60000);

  /**
   * ⛔ **«Otros» se despeja, y acá se ve contra datos reales.** El ajuste manual
   * no es consumo ni abastecimiento, así que no cae en ningún balde: aparece en
   * «Otros» **sin que ningún motivo esté nombrado en la consulta**.
   *
   * Números: costo 100. Se cuenta, se ajusta −3 a mano (300), se cuenta de nuevo
   * bajando 2 más (200 sin explicación).
   */
  it('un ajuste manual aparece en Otros, sin estar nombrado en ninguna consulta', async () => {
    const itemId = await crearProducto({
      nombre: 'Resumen otros',
      stock: '50',
      costo: '100',
    });
    await contar(itemId, '50');

    const resAjuste = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: bodegaId,
        cantidad: '3',
        tipo: 'salida',
        motivo: 'ajuste_manual',
      });
    expect(resAjuste.status).toBe(200);

    await contar(itemId, '45');

    const res = await resumen(`${rangoDeHoy()}&itemId=${itemId}`);

    expect(res.totales.sinExplicacion).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '200.0000' },
    ]);
    expect(res.totales.otros).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '300.0000' },
    ]);
  }, 60000);
});
