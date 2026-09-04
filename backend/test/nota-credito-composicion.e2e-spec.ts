import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

const TENANT_DEMO = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO = '550e8400-e29b-41d4-a716-446655440105';

/**
 * La venta mixta de todos los casos de abajo, con los números elegidos para que
 * discriminen (nada de 50/50 ni de divisiones exactas):
 *
 *   7 × producto afecto de 1.000 → neto 7.000 + IVA 1.330 = 8.330
 *   1 × servicio exento de 3.000 →                          3.000
 *                                                    total 11.330
 *
 * CLP tiene 0 decimales: la escala que más residuo produce y la que hace fallar
 * un reparto mal escrito.
 */
const PRECIO_AFECTO = '1000';
const CANTIDAD_AFECTA = '7';
const PRECIO_EXENTO = '3000';
const TOTAL_VENTA = '11330';

/**
 * La receta: 4.000 neto + 19% = 4.760. Afecta, como el producto.
 *
 * Su venta lleva ADEMÁS las 7 unidades del producto afecto (8.330), y no por
 * completar: sin esa plata sobrante, el tope global —`total_final` menos las
 * notas previas— tapa el caso del tope por CANTIDAD y no se puede probar.
 */
const PRECIO_RECETA = '4000';
const TOTAL_RECETA = '4760';
const TOTAL_VENTA_RECETA = '13090';

interface TokenResponse {
  access_token: string;
}

/**
 * La nota de crédito deja de ser un monto suelto: se compone de líneas con neto
 * e IVA derivados del documento que corrige.
 */
describe('Nota de crédito compuesta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemAfectoId: string;
  let itemExentoId: string;
  let itemRecetaId: string;

  /** Una venta mixta nueva, pagada. Cada caso arma la suya: compartirla haría
   *  que el remanente de un test dependiera del que corrió antes. */
  const crearVentaMixta = async (): Promise<string> => {
    const venta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        // `'online'` para no depender de una caja física abierta: acá lo que se
        // prueba es la composición del documento, no la caja.
        canal: 'online',
        lineas: [
          { itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA },
          { itemId: itemExentoId, cantidad: '1' },
        ],
        pagos: [{ metodoPagoId: EFECTIVO, monto: `${TOTAL_VENTA}.0000` }],
      });
    expect(venta.status).toBe(201);
    expect((venta.body as { totalFinal: string }).totalFinal).toBe(
      `${TOTAL_VENTA}.0000`,
    );
    return (venta.body as { id: string }).id;
  };

  /**
   * Una venta con una receta y las 7 unidades del producto afecto, pagada. La
   * receta es el caso que más importa de este frente: no tiene fila en
   * `item_producto`, así que su `modo_inventario` es `null` y hasta el
   * 2026-09-04 no se podía acreditar por línea —la nota decía "Ajuste" en vez
   * del nombre del plato—.
   */
  const crearVentaConReceta = async (): Promise<string> => {
    const venta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [
          { itemId: itemRecetaId, cantidad: '1' },
          { itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA },
        ],
        pagos: [
          { metodoPagoId: EFECTIVO, monto: `${TOTAL_VENTA_RECETA}.0000` },
        ],
      });
    expect(venta.status).toBe(201);
    expect((venta.body as { totalFinal: string }).totalFinal).toBe(
      `${TOTAL_VENTA_RECETA}.0000`,
    );
    return (venta.body as { id: string }).id;
  };

  interface LineaNC {
    itemId: string;
    descripcion: string | null;
    precioUnitario: string;
    clasificacionTributaria: string;
    subtotal: string;
    impuestoAplicado: string;
    totalLinea: string;
  }
  interface NotaCredito {
    detalles: LineaNC[];
    comentario: string | null;
    totalBruto: string;
    totalImpuestos: string;
    totalFinal: string;
    baseVentasTotalFinal: string;
    baseVentasSinImpuestos: string;
  }

  const emitirNC = async (
    ventaId: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string }> => {
    const res = await request(app.getHttpServer())
      .post(`/api/ventas/${ventaId}/notas-credito`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };

  const leerNC = async (ncId: string): Promise<NotaCredito> => {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ncId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body as NotaCredito;
  };

  const suma = (lineas: LineaNC[], campo: keyof LineaNC): string =>
    lineas
      .reduce((a, l) => a.plus(new Decimal(l[campo] as string)), new Decimal(0))
      .toString();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
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
      .send({ tenantId: TENANT_DEMO });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    // Ítems PROPIOS de este spec: reusar los del seed haría que otros e2e
    // muevan el stock y el remanente por debajo de estos casos.
    const sufijo = Date.now();
    const resAfecto = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `NC afecto E2E ${sufijo}`,
        precioBase: PRECIO_AFECTO,
        monedaId: CLP,
        tipo: 'producto',
        // Explícito, invariante 5 de CLAUDE.md.
        clasificacionTributaria: 'afecto',
        modoInventario: 'cantidad',
        unidadMedida: 'unidad',
        // Holgado a propósito: cada venta de este spec se lleva 7 unidades y ya
        // van 13 ventas. Con el stock justo, el próximo caso que se agregue
        // rompe con "stock insuficiente" y se lee como una regresión de la nota
        // de crédito en vez de como un presupuesto de fixture agotado.
        stock: '500',
      });
    expect(resAfecto.status).toBe(201);
    itemAfectoId = (resAfecto.body as { id: string }).id;

    const resExento = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `NC exento E2E ${sufijo}`,
        precioBase: PRECIO_EXENTO,
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria: 'exento',
      });
    expect(resExento.status).toBe(201);
    itemExentoId = (resExento.body as { id: string }).id;

    // Una receta con su ingrediente, copiando el patrón de `combos.e2e-spec.ts`:
    // el ingrediente lleva el stock, la receta no tiene fila en `item_producto`.
    const resIngrediente = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `NC ingrediente E2E ${sufijo}`,
        precioBase: '0',
        monedaId: CLP,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '500',
      });
    expect(resIngrediente.status).toBe(201);

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `NC receta E2E ${sufijo}`,
        precioBase: PRECIO_RECETA,
        monedaId: CLP,
        tipo: 'receta',
        clasificacionTributaria: 'afecto',
        ingredientes: [
          {
            ingredienteItemId: (resIngrediente.body as { id: string }).id,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    itemRecetaId = (resReceta.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('el ítem de sistema "Ajuste"', () => {
    it('es exactamente uno por tenant, de tipo servicio y sin stock', async () => {
      const filas: { item_id: string; tipo: string; activo: boolean }[] =
        await ds.query(
          `SELECT i.item_id, i.tipo, i.activo
             FROM items i
            WHERE i.tenant_id = $1 AND i.es_ajuste_nota_credito = true
              AND i.eliminado_el IS NULL`,
          [TENANT_DEMO],
        );
      expect(filas).toHaveLength(1);
      expect(filas[0].tipo).toBe('servicio');
      expect(filas[0].activo).toBe(false);

      // Solo `tipo='producto'` tiene stock: la línea de ajuste no repone nada.
      const producto: unknown[] = await ds.query(
        `SELECT 1 FROM item_producto WHERE item_id = $1`,
        [filas[0].item_id],
      );
      expect(producto).toHaveLength(0);

      // Y su fila de extensión sí existe: todo `servicio` la tiene.
      const servicio: unknown[] = await ds.query(
        `SELECT 1 FROM item_servicio WHERE item_id = $1`,
        [filas[0].item_id],
      );
      expect(servicio).toHaveLength(1);
    });

    it('no aparece en ningún listado del catálogo', async () => {
      // Nacer pausado NO alcanza: las pantallas de configuración que alimentan
      // los selectores del negocio —scope de promociones, componentes de
      // combo, opciones de un grupo de modificadores— piden el listado SIN
      // filtrar `activo`. Así que el ítem de sistema se excluye del listado
      // entero, igual que el garzón placeholder.
      const marcado: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      const ajusteId = marcado[0].item_id;

      // `ORDER BY nombre ASC`: si no se excluyera, 'Ajuste' sería de las
      // primeras filas de la primera página. La aserción sobre `length` es lo
      // que impide que este test pase por una lista vacía.
      const listado = await request(app.getHttpServer())
        .get('/api/items?pageSize=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = (listado.body as { data: { id: string }[] }).data.map(
        (i) => i.id,
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(ids).not.toContain(ajusteId);

      // Tampoco por la papelera, que es el otro modo de este mismo listado.
      const papelera = await request(app.getHttpServer())
        .get('/api/items?pageSize=100&incluirEliminados=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const idsPapelera = (
        papelera.body as { data: { id: string }[] }
      ).data.map((i) => i.id);
      expect(idsPapelera).not.toContain(ajusteId);
    });

    it('no se puede eliminar: es de sistema', async () => {
      // Sin este corte queda un camino a un 500: borrarlo hace que la
      // siguiente nota de crédito cree otro, y restaurar el borrado dejaría
      // dos vivos contra `uq_item_ajuste_nc_tenant`.
      const marcado: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      const res = await request(app.getHttpServer())
        .delete(`/api/items/${marcado[0].item_id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('sistema');

      const sigueVivo: unknown[] = await ds.query(
        `SELECT 1 FROM items WHERE item_id = $1 AND eliminado_el IS NULL`,
        [marcado[0].item_id],
      );
      expect(sigueVivo).toHaveLength(1);
    });

    it('el índice único no deja dos ítems de ajuste en el mismo tenant', async () => {
      // Con dos filas marcadas, cuál se usa dependería del orden del planner.
      //
      // ⚠️ Transacción que SIEMPRE revierte, por el día en que este test tenga
      // que atrapar la regresión de verdad: sin el índice el INSERT pasa, y la
      // fila sobrante impediría CREAR el índice en el próximo arranque — el
      // backend no levantaría hasta limpiarla a mano. Mismo patrón que
      // `nota-credito-por-pais.e2e-spec.ts`.
      const moneda: { moneda_id: string }[] = await ds.query(
        `SELECT i.moneda_id FROM items i
          WHERE i.tenant_id = $1 AND i.es_ajuste_nota_credito = true
            AND i.eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      let errorDelInsert: unknown;
      await ds
        .transaction(async (m) => {
          try {
            await m.query(
              `INSERT INTO items
                 (item_id, tenant_id, moneda_id, nombre, precio_base,
                  precio_incluye_impuesto, activo, tipo,
                  clasificacion_tributaria, es_ajuste_nota_credito)
               VALUES ($1, $2, $3, 'Ajuste duplicado', 0, false, false,
                       'servicio', 'afecto', true)`,
              [randomUUID(), TENANT_DEMO, moneda[0].moneda_id],
            );
          } catch (e) {
            errorDelInsert = e;
          }
          throw new Error('rollback deliberado');
        })
        .catch(() => undefined);

      // Por el NOMBRE del índice: un INSERT puede fallar por una columna
      // faltante y dar la misma sensación de cobertura sin cobertura.
      expect((errorDelInsert as Error | undefined)?.message).toContain(
        'uq_item_ajuste_nc_tenant',
      );

      const sobrantes: unknown[] = await ds.query(
        `SELECT 1 FROM items WHERE tenant_id = $1 AND nombre = 'Ajuste duplicado'`,
        [TENANT_DEMO],
      );
      expect(sobrantes).toHaveLength(0);
    });
  });

  describe('qué se acredita y qué vuelve al stock', () => {
    it('una receta se acredita por línea, sin mover inventario', async () => {
      const ventaId = await crearVentaConReceta();
      const { id } = await emitirNC(ventaId, {
        monto: TOTAL_RECETA,
        devoluciones: [{ itemId: itemRecetaId, cantidad: '1' }],
      });

      const nc = await leerNC(id);
      const linea = nc.detalles.find((l) => l.itemId === itemRecetaId);
      // Antes de esta tarea la receta caía al balde de ajuste: la nota decía
      // "Ajuste" y no el nombre del plato.
      expect(linea).toBeDefined();
      expect(new Decimal(linea!.totalLinea).toString()).toBe(TOTAL_RECETA);

      const movs: unknown[] = await ds.query(
        `SELECT 1 FROM movimientos_inventario
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(movs).toHaveLength(0);
    });

    it('lo acreditado sin reponer igual gasta las unidades del ítem', async () => {
      const ventaId = await crearVentaConReceta();
      // La receta no mueve stock, así que hasta el 2026-09-04 el contador de
      // "ya devuelto" —que solo miraba `movimientos_inventario`— se quedaba en
      // cero y la MISMA unidad se podía acreditar dos veces. El tope por
      // porción fiscal no lo tapa: mira plata por porción, y las 7 unidades
      // afectas de esta venta le donan capacidad de sobra.
      await emitirNC(ventaId, {
        monto: TOTAL_RECETA,
        devoluciones: [{ itemId: itemRecetaId, cantidad: '1' }],
      });

      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: TOTAL_RECETA,
          devoluciones: [{ itemId: itemRecetaId, cantidad: '1' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'excede lo disponible (0)',
      );
    });

    it('un producto con reponerStock false se acredita y NO vuelve al stock', async () => {
      const ventaId = await crearVentaMixta();
      const { id } = await emitirNC(ventaId, {
        monto: '2000',
        devoluciones: [
          { itemId: itemAfectoId, cantidad: '1', reponerStock: false },
        ],
      });

      const nc = await leerNC(id);
      expect(nc.detalles.some((l) => l.itemId === itemAfectoId)).toBe(true);
      const movs: unknown[] = await ds.query(
        `SELECT 1 FROM movimientos_inventario
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(movs).toHaveLength(0);
    });

    it('sin el flag, un producto por cantidad sigue reponiendo como antes', async () => {
      const ventaId = await crearVentaMixta();
      const { id } = await emitirNC(ventaId, {
        monto: '2000',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '1' }],
      });
      const movs: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM movimientos_inventario
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(movs).toHaveLength(1);
      expect(movs[0].item_id).toBe(itemAfectoId);
    });

    it('pedir que un servicio reponga se rechaza', async () => {
      const ventaId = await crearVentaMixta();
      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '3000',
          devoluciones: [
            { itemId: itemExentoId, cantidad: '1', reponerStock: true },
          ],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'no maneja stock',
      );
    });
  });

  describe('la nota se compone: líneas, neto e IVA', () => {
    it('una NC por monto libre sale con dos líneas y sus totales derivados', async () => {
      const ventaId = await crearVentaMixta();
      const { id } = await emitirNC(ventaId, {
        monto: '1000',
        comentario: 'Cliente insatisfecho',
      });

      const nc = await leerNC(id);
      expect(nc.detalles).toHaveLength(2);

      // 1.000 repartido en la proporción 8.330 / 3.000 → 735 / 265. La
      // proporción es despareja a propósito: con 50/50 un reparto mal escrito
      // pasa igual.
      const afecta = nc.detalles.find(
        (l) => l.clasificacionTributaria === 'afecto',
      )!;
      const exenta = nc.detalles.find(
        (l) => l.clasificacionTributaria === 'exento',
      )!;
      expect(new Decimal(afecta.totalLinea).toString()).toBe('735');
      expect(new Decimal(exenta.totalLinea).toString()).toBe('265');

      // La porción afecta se descompone con la tasa que ESA venta cobró
      // (1.330 / 7.000 = 19%), y el impuesto sale por resta: 735 / 1,19 =
      // 617,64… → neto 618, impuesto 117. Exactamente 735.
      expect(new Decimal(afecta.subtotal).toString()).toBe('618');
      expect(new Decimal(afecta.impuestoAplicado).toString()).toBe('117');
      // La exenta no lleva impuesto: es un estado fiscal, no la ausencia de
      // una tasa que no se pudo calcular.
      expect(new Decimal(exenta.subtotal).toString()).toBe('265');
      expect(new Decimal(exenta.impuestoAplicado).isZero()).toBe(true);

      // La glosa que escribió el operador viaja a las dos líneas de ajuste.
      expect(afecta.descripcion).toBe('Cliente insatisfecho');
      expect(exenta.descripcion).toBe('Cliente insatisfecho');

      // Los totales de la cabecera se DERIVAN de las líneas: no hay un solo
      // número escrito a mano.
      expect(suma(nc.detalles, 'totalLinea')).toBe(
        new Decimal(nc.totalFinal).toString(),
      );
      expect(new Decimal(nc.totalImpuestos).toString()).toBe('117');
      expect(new Decimal(nc.totalBruto).toString()).toBe('883');
      expect(new Decimal(nc.baseVentasTotalFinal).eq(nc.totalFinal)).toBe(true);
      expect(new Decimal(nc.baseVentasSinImpuestos).toString()).toBe('883');
    });

    it('acreditar menos de lo que vale la mercadería: las líneas se escalan', async () => {
      const ventaId = await crearVentaMixta();
      // 2 unidades valen 2.380 en esa boleta; se acreditan 500. Hasta el
      // 2026-09-04 esto se rechazaba con 400.
      const { id } = await emitirNC(ventaId, {
        monto: '500',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '2' }],
        comentario: 'Volvieron abiertas',
      });

      const nc = await leerNC(id);
      // Una sola línea, la de la devolución, escalada al monto. Sin ajuste.
      expect(nc.detalles).toHaveLength(1);
      expect(nc.detalles[0].itemId).toBe(itemAfectoId);
      expect(new Decimal(nc.detalles[0].totalLinea).toString()).toBe('500');
      expect(suma(nc.detalles, 'totalLinea')).toBe(
        new Decimal(nc.totalFinal).toString(),
      );
      // La línea dice las DOS cosas: qué volvió —que es lo que la tarea
      // anterior vino a arreglar— y por qué vale menos que la mercadería.
      expect(nc.detalles[0].descripcion).toContain('NC afecto E2E');
      expect(nc.detalles[0].descripcion).toContain('Volvieron abiertas');
      expect(nc.comentario).toBe('Volvieron abiertas');
      // Y el precio unitario sale del importe ESCALADO: 500 / 2 = 250. Con el
      // valor congelado (1.190) la pantalla afirmaría `2 × $1.190 = $500`.
      expect(new Decimal(nc.detalles[0].precioUnitario).toString()).toBe('250');

      // Y el stock volvió igual, atado a la nota: lo que se escala es la plata,
      // no las unidades.
      const movs: { cantidad: string }[] = await ds.query(
        `SELECT cantidad FROM movimientos_inventario
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(movs).toHaveLength(1);
      expect(new Decimal(movs[0].cantidad).toString()).toBe('2');
    });

    it('sin motivo, acreditar menos de lo que vale se rechaza', async () => {
      const ventaId = await crearVentaMixta();
      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '500',
          devoluciones: [{ itemId: itemAfectoId, cantidad: '2' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('motivo');
    });

    it('el escalado de varias líneas reparte el residuo y no corre la porción', async () => {
      const ventaId = await crearVentaMixta();
      // Se devuelve TODO —7 afectas (8.330) + el servicio exento (3.000)— y se
      // acreditan 501. Un solo ítem no discrimina nada: es acá, con dos
      // porciones y un factor que no divide exacto, donde dividir línea por
      // línea deja la suma corrida.
      const { id } = await emitirNC(ventaId, {
        monto: '501',
        devoluciones: [
          { itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA },
          { itemId: itemExentoId, cantidad: '1' },
        ],
        comentario: 'Se anula el pedido completo',
      });

      const nc = await leerNC(id);
      expect(nc.detalles).toHaveLength(2);
      const afecta = nc.detalles.find(
        (l) => l.clasificacionTributaria === 'afecto',
      )!;
      const exenta = nc.detalles.find(
        (l) => l.clasificacionTributaria === 'exento',
      )!;
      // 501 × 8.330/11.330 = 368,35… → 368; 501 × 3.000/11.330 = 132,65… → 133.
      // Los dos números calculados a mano desde el fixture, no leídos del
      // resultado.
      expect(new Decimal(afecta.totalLinea).toString()).toBe('368');
      expect(new Decimal(exenta.totalLinea).toString()).toBe('133');
      expect(suma(nc.detalles, 'totalLinea')).toBe('501');
      // Y el IVA sale de la línea escalada, no de la cruda: 368 / 1,19 = 309,24
      // → neto 309, impuesto 59.
      expect(new Decimal(afecta.subtotal).toString()).toBe('309');
      expect(new Decimal(afecta.impuestoAplicado).toString()).toBe('59');
      expect(new Decimal(exenta.impuestoAplicado).isZero()).toBe(true);
    });

    it('una línea que el escalado deja en cero no se escribe', async () => {
      const ventaId = await crearVentaMixta();
      // Se devuelve todo acreditando 1: la parte exenta cae a 0 (1 × 3.000 /
      // 11.330 = 0,26). Sin el filtro, la nota saldría diciendo "servicio, 1
      // unidad, total $0".
      const { id } = await emitirNC(ventaId, {
        monto: '1',
        devoluciones: [
          { itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA },
          { itemId: itemExentoId, cantidad: '1' },
        ],
        comentario: 'Cortesía total',
      });

      const nc = await leerNC(id);
      expect(nc.detalles).toHaveLength(1);
      expect(nc.detalles[0].itemId).toBe(itemAfectoId);
      expect(new Decimal(nc.detalles[0].totalLinea).toString()).toBe('1');
      expect(nc.detalles.some((l) => new Decimal(l.totalLinea).isZero())).toBe(
        false,
      );
    });

    it('cuando lo devuelto entra en el monto, nada se escala', async () => {
      const ventaId = await crearVentaMixta();
      // 1 unidad vale 1.190 y se acreditan 2.000: la línea va a su valor real y
      // los 810 restantes salen como ajuste. Es la conducta de antes.
      const { id } = await emitirNC(ventaId, {
        monto: '2000',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '1' }],
      });
      const nc = await leerNC(id);
      const devuelta = nc.detalles.find((l) => l.itemId === itemAfectoId)!;
      expect(new Decimal(devuelta.totalLinea).toString()).toBe('1190');
      expect(nc.detalles.length).toBeGreaterThan(1);
    });

    it('el tope por porción se evalúa sobre las líneas YA escaladas', async () => {
      const ventaId = await crearVentaMixta();
      // Una nota previa por monto libre se lleva 735 de la porción afecta.
      await emitirNC(ventaId, { monto: '1000' });
      // Ahora se devuelven las 7 unidades (8.330) acreditando solo 500:
      // escalado, eso asigna 500 a la porción afecta, que tiene 7.595 libres.
      // Evaluar el tope sobre los valores CRUDOS rechazaría este caso, que es
      // perfectamente válido.
      const { id } = await emitirNC(ventaId, {
        monto: '500',
        devoluciones: [{ itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA }],
        comentario: 'Cortesía',
      });
      const nc = await leerNC(id);
      expect(suma(nc.detalles, 'totalLinea')).toBe('500');
    });

    it('la línea de ajuste no dispara movimiento de inventario', async () => {
      const ventaId = await crearVentaMixta();
      // 1 unidad devuelta (1.190) + 810 de ajuste = 2.000.
      const { id } = await emitirNC(ventaId, {
        monto: '2000',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '1' }],
      });

      // La línea de ajuste cuelga de un `servicio`, y `registrarMovimiento`
      // rechaza con 400 todo lo que no sea producto: sin el corte, esta NC
      // fallaría ENTERA.
      const movs: { item_id: string }[] = await ds.query(
        `SELECT item_id FROM movimientos_inventario
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(movs).toHaveLength(1);
      expect(movs[0].item_id).toBe(itemAfectoId);

      const nc = await leerNC(id);
      // Devolución (1.190) + ajuste sobre el remanente que deja ESTA misma nota
      // —afecto 8.330 − 1.190 = 7.140, exento 3.000— → 570 afecto y 240 exento.
      expect(nc.detalles).toHaveLength(3);
      expect(suma(nc.detalles, 'totalLinea')).toBe(
        new Decimal(nc.totalFinal).toString(),
      );
      expect(suma(nc.detalles, 'subtotal')).toBe(
        new Decimal(nc.totalBruto).toString(),
      );
      expect(suma(nc.detalles, 'impuestoAplicado')).toBe(
        new Decimal(nc.totalImpuestos).toString(),
      );
    });

    it('con una NC previa, la proporción sale del remanente y no de la venta original', async () => {
      const ventaId = await crearVentaMixta();

      // Primera NC: 5 unidades devueltas, 5 × 1.190 = 5.950, sin ajuste. Se
      // lleva casi todo el balde AFECTO y nada del exento, así que el
      // remanente queda 2.380 / 3.000 — la proporción se da vuelta.
      await emitirNC(ventaId, {
        monto: '5950',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '5' }],
      });

      const segunda = await emitirNC(ventaId, { monto: '1000' });

      const nc = await leerNC(segunda.id);
      const exenta = nc.detalles.find(
        (l) => l.clasificacionTributaria === 'exento',
      )!;
      // 1.000 × 3.000 / 5.380 = 557,62 → 558. Calculado a mano desde el
      // fixture, no leído del resultado: una referencia definida en función de
      // lo medido sale por identidad y no prueba nada.
      //
      // Repartir sobre la venta ORIGINAL daría 265: ese es el mutante que este
      // caso mata, y por eso el número va exacto y no como desigualdad.
      expect(new Decimal(exenta.totalLinea).toString()).toBe('558');
      expect(suma(nc.detalles, 'totalLinea')).toBe(
        new Decimal(nc.totalFinal).toString(),
      );
    });

    it('lo que esta misma nota devuelve deja de atraer ajuste: ninguna línea sale negativa', async () => {
      const ventaId = await crearVentaMixta();

      // Se devuelven las 7 unidades afectas (8.330) y se acreditan 9.000: el
      // ajuste son 670. Si el reparto no descontara lo que ESTA nota ya
      // devuelve, esos 670 se repartirían sobre 8.330 / 3.000 y acreditarían de
      // la porción afecta MÁS de lo que la porción tenía — y la nota siguiente
      // arrancaría con un remanente negativo, o sea una línea de nota de
      // crédito con importe e impuesto en negativo.
      const primera = await emitirNC(ventaId, {
        monto: '9000',
        devoluciones: [{ itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA }],
      });
      const nc1 = await leerNC(primera.id);
      const ajuste1 = nc1.detalles.filter((l) => l.itemId !== itemAfectoId);
      expect(ajuste1).toHaveLength(1);
      expect(ajuste1[0].clasificacionTributaria).toBe('exento');
      expect(new Decimal(ajuste1[0].totalLinea).toString()).toBe('670');

      // Y la segunda, sobre lo que queda: afecto 0, exento 3.000 − 670 = 2.330.
      const segunda = await emitirNC(ventaId, { monto: '1000' });
      const nc2 = await leerNC(segunda.id);
      expect(nc2.detalles).toHaveLength(1);
      expect(nc2.detalles[0].clasificacionTributaria).toBe('exento');
      for (const l of [...nc1.detalles, ...nc2.detalles]) {
        expect(new Decimal(l.totalLinea).isNegative()).toBe(false);
        expect(new Decimal(l.impuestoAplicado).isNegative()).toBe(false);
      }
      expect(new Decimal(nc2.totalImpuestos).isZero()).toBe(true);
    });

    it('la SERIE de notas no puede acreditar más IVA del que la venta cobró', async () => {
      const ventaId = await crearVentaMixta();

      // Una nota por monto libre se lleva 735 de la porción afecta.
      const primera = await emitirNC(ventaId, { monto: '1000' });
      const nc1 = await leerNC(primera.id);
      expect(new Decimal(nc1.totalImpuestos).toString()).toBe('117');

      // Y ahora se quieren devolver las 7 unidades, que valen 8.330: más de
      // los 7.595 que le quedan a la porción afecta. Cada documento cerraría
      // bien por separado, pero la SERIE acreditaría 1.447 de IVA contra los
      // 1.330 que la venta cobró. Se rechaza, y el mensaje dice qué queda.
      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '8330',
          devoluciones: [{ itemId: itemAfectoId, cantidad: CANTIDAD_AFECTA }],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('7595');

      // Por lo que SÍ queda, pasa: 6 unidades valen 7.140.
      const segunda = await emitirNC(ventaId, {
        monto: '7140',
        devoluciones: [{ itemId: itemAfectoId, cantidad: '6' }],
      });
      const nc2 = await leerNC(segunda.id);
      const ivaAcreditado = new Decimal(nc1.totalImpuestos).plus(
        nc2.totalImpuestos,
      );
      // 117 + 1.140 = 1.257 ≤ 1.330. La serie nunca pasa el techo.
      expect(ivaAcreditado.lte('1330')).toBe(true);
    });

    it('el mismo ítem dos veces en la devolución se rechaza', async () => {
      const ventaId = await crearVentaMixta();
      // Cada entrada se validaba contra el mismo disponible, así que esto
      // pasaba con 7 vendidas — y ahora además duplicaría el valor devuelto,
      // que es plata en un documento fiscal.
      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '4760',
          devoluciones: [
            { itemId: itemAfectoId, cantidad: '2' },
            { itemId: itemAfectoId, cantidad: '2' },
          ],
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('dos veces');
    });

    // ⚠️ ÚLTIMO del archivo a propósito: borra el ítem de sistema del tenant
    // por SQL —la API lo rechaza— y deja en su lugar el que crea el
    // find-or-create, con otro id. Es un estado consistente (uno solo vivo),
    // pero ya no es el del seed: `reset-db.sh` lo repone.
    it('sin el ítem "Ajuste", el reembolso no se pierde: se crea solo', async () => {
      const ventaId = await crearVentaMixta();
      await ds.query(
        `UPDATE items SET eliminado_el = NOW()
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );

      // El camino del webhook de reembolso no puede fallar por configuración
      // faltante: la plata ya volvió por el proveedor.
      const { id } = await emitirNC(ventaId, { monto: '500' });

      const nc = await leerNC(id);
      expect(nc.detalles.length).toBeGreaterThan(0);
      const vivos: unknown[] = await ds.query(
        `SELECT 1 FROM items
          WHERE tenant_id = $1 AND es_ajuste_nota_credito = true
            AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      expect(vivos).toHaveLength(1);
    });
  });
});
