import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * El costo de una receta o un combo que no cabe en `NUMERIC(18,4)` es 400
 * antes de escribir, no 500 (`assertCostoCompuestoCabe`). Es Σ costo ×
 * cantidad: cada costo cabe y el resultado puede no caber. Medido el
 * 2026-10-13: crear y editar una receta o un combo, y aplicar o descartar su
 * desfase, daban 500 (`docs/agent/resueltos.md`, "El costo de una receta no
 * tiene techo").
 *
 * Decisión del owner (2026-10-13): "No guardar, con aviso". El aviso nombra el
 * ingrediente o el componente que más pesa.
 *
 * Al final cada insumo vuelve a su costo: un desfase de $180 billones en la
 * bandeja del tenant compartido no es asunto de las otras suites.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

/** Cabe solo; por 2, no. */
const CARO = '90000000000000';
const OTRO = '80000000000000';
const TECHO =
  'el sistema no puede guardar costos de $100.000.000.000.000 o más';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
type Pedido = [string, () => Promise<Respuesta>, string];

describe('Un costo de receta o combo que no cabe es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let marca: string;

  function pedir(
    metodo: 'post' | 'patch',
    ruta: string,
    body: object = {},
  ): Promise<Respuesta> {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await pedir('post', ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** Todos los pedidos antes de comparar: un rojo dice cuáles fueron. */
  async function rechazados(pedidos: Pedido[]) {
    const obtenido: { que: string; status: number; mensaje: string }[] = [];
    for (const [que, hacer] of pedidos) {
      const res = await hacer();
      const m = (res.body as { message?: string | string[] }).message ?? '';
      obtenido.push({ que, status: res.status, mensaje: [m].flat().join(' ') });
    }
    expect(obtenido).toEqual(
      pedidos.map(([que, , mensaje]) => ({ que, status: 400, mensaje })),
    );
  }

  const nombre = (base: string) =>
    `${base} E2E ${marca} ${randomUUID().slice(0, 4)}`;

  const insumo = async (
    tipo: 'ingrediente' | 'producto',
    unidadMedida: string,
    costo: string,
  ) => {
    const n = nombre(tipo === 'ingrediente' ? 'Insumo' : 'Componente');
    const { id } = await crear('items', {
      nombre: n,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo,
      ...(tipo === 'producto' ? { clasificacionTributaria: 'exento' } : {}),
      unidadMedida,
      costo,
    });
    return { id, nombre: n };
  };

  const ajustarCosto = async (itemId: string, costoNuevo: string) =>
    expect(
      (
        await pedir('post', 'inventario/ajustes-costo', {
          itemId,
          costoNuevo,
          comentario: 'Costo E2E',
        })
      ).status,
    ).toBe(201);

  const receta = (ingredientes: object[]) => ({
    nombre: nombre('Receta'),
    precioBase: '1000',
    monedaId: CLP_MONEDA_ID,
    tipo: 'receta',
    ingredientes,
  });

  const combo = (componentes: object[]) => ({
    nombre: nombre('Combo'),
    precioBase: '1000',
    monedaId: CLP_MONEDA_ID,
    tipo: 'combo',
    componentes,
  });

  /** El costo guardado y el propuesto omitido: lo que no debe moverse. */
  async function costos(tabla: 'item_receta' | 'item_combo', itemId: string) {
    const [fila]: { costo: string | null; omitido: string | null }[] =
      await ds.query(
        `SELECT costo_actual::text AS costo,
                costo_propuesto_omitido::text AS omitido
           FROM ${tabla} WHERE item_id = $1`,
        [itemId],
      );
    return fila;
  }

  async function contarItems(): Promise<string> {
    // Sin `eliminado_el`: lo que se cuenta es si el pedido escribió algo.
    const [fila]: { n: string }[] = await ds.query(
      `SELECT count(*)::text AS n FROM items WHERE tenant_id = $1`,
      [PARIS_TENANT_ID],
    );
    return fila.n;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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
    marca = randomUUID().slice(0, 8);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('crear y editar una receta o un combo', async () => {
    const caro = await insumo('ingrediente', 'kg', CARO);
    const porGramo = await insumo('ingrediente', 'g', '1');
    const barato = await insumo('ingrediente', 'kg', '1');
    const comp1 = await insumo('producto', 'unidad', CARO);
    const comp2 = await insumo('producto', 'unidad', OTRO);
    const recetaBarata = await crear(
      'items',
      receta([
        { ingredienteItemId: barato.id, cantidad: '2', unidadCodigo: 'kg' },
      ]),
    );
    const comboBarato = await crear(
      'items',
      combo([{ componenteItemId: comp2.id, cantidad: '1' }]),
    );
    const antes = {
      items: await contarItems(),
      receta: await costos('item_receta', recetaBarata.id),
      combo: await costos('item_combo', comboBarato.id),
    };

    const deCaro = `El costo de la receta sería de $180.000.000.000.000: ${TECHO}. El ingrediente que más pesa es "${caro.nombre}", con $180.000.000.000.000: revisá su costo y su cantidad`;
    const deCombo = `El costo del combo sería de $170.000.000.000.000: ${TECHO}. El componente que más pesa es "${comp1.nombre}", con $90.000.000.000.000: revisá su costo y su cantidad`;
    await rechazados([
      [
        'crear una receta con 2 kg de un ingrediente caro',
        () =>
          pedir(
            'post',
            'items',
            receta([
              { ingredienteItemId: caro.id, cantidad: '2', unidadCodigo: 'kg' },
            ]),
          ),
        deCaro,
      ],
      [
        'crear una receta con 10^12 kg de un ingrediente por gramo',
        () =>
          pedir(
            'post',
            'items',
            receta([
              {
                ingredienteItemId: porGramo.id,
                cantidad: '1000000000000',
                unidadCodigo: 'kg',
              },
            ]),
          ),
        `El costo de la receta sería de $1.000.000.000.000.000: ${TECHO}. El ingrediente que más pesa es "${porGramo.nombre}", con $1.000.000.000.000.000: revisá su costo y su cantidad`,
      ],
      [
        'editar la receta con el ingrediente caro',
        () =>
          pedir('patch', `items/${recetaBarata.id}`, {
            ingredientes: [
              { ingredienteItemId: caro.id, cantidad: '2', unidadCodigo: 'kg' },
            ],
          }),
        deCaro,
      ],
      [
        'crear un combo con dos componentes caros',
        () =>
          pedir(
            'post',
            'items',
            combo([
              { componenteItemId: comp2.id, cantidad: '1' },
              { componenteItemId: comp1.id, cantidad: '1' },
            ]),
          ),
        deCombo,
      ],
      [
        'editar el combo con dos componentes caros',
        () =>
          pedir('patch', `items/${comboBarato.id}`, {
            componentes: [
              { componenteItemId: comp2.id, cantidad: '1' },
              { componenteItemId: comp1.id, cantidad: '1' },
            ],
          }),
        deCombo,
      ],
    ]);

    expect({
      items: await contarItems(),
      receta: await costos('item_receta', recetaBarata.id),
      combo: await costos('item_combo', comboBarato.id),
    }).toEqual(antes);
  });

  it('aplicar y descartar el desfase de una receta o un combo', async () => {
    const insumoReceta = await insumo('ingrediente', 'kg', '1');
    const comp1 = await insumo('producto', 'unidad', '1');
    const comp2 = await insumo('producto', 'unidad', '1');
    const r = await crear(
      'items',
      receta([
        {
          ingredienteItemId: insumoReceta.id,
          cantidad: '2',
          unidadCodigo: 'kg',
        },
      ]),
    );
    const c = await crear(
      'items',
      combo([
        { componenteItemId: comp1.id, cantidad: '1' },
        { componenteItemId: comp2.id, cantidad: '1' },
      ]),
    );
    // El costo de la receta y el combo no se mueve solo: el insumo caro deja
    // el desfase en la bandeja, con un propuesto que no cabe.
    await ajustarCosto(insumoReceta.id, CARO);
    await ajustarCosto(comp1.id, CARO);
    await ajustarCosto(comp2.id, OTRO);
    const antes = {
      receta: await costos('item_receta', r.id),
      combo: await costos('item_combo', c.id),
    };
    expect(antes.receta.costo).toBe('2.0000');

    const deReceta = `El costo de la receta sería de $180.000.000.000.000: ${TECHO}. El ingrediente que más pesa es "${insumoReceta.nombre}", con $180.000.000.000.000: revisá su costo y su cantidad`;
    const deCombo = `El costo del combo sería de $170.000.000.000.000: ${TECHO}. El componente que más pesa es "${comp1.nombre}", con $90.000.000.000.000: revisá su costo y su cantidad`;
    await rechazados([
      [
        'aplicar el desfase de la receta',
        () => pedir('post', 'desfases/aplicar', { items: [{ itemId: r.id }] }),
        deReceta,
      ],
      [
        'aplicar el desfase del combo',
        () => pedir('post', 'desfases/aplicar', { items: [{ itemId: c.id }] }),
        deCombo,
      ],
      [
        'descartar el desfase de la receta',
        () =>
          pedir('post', 'desfases/descartar', {
            items: [{ itemId: r.id, costoPropuestoVisto: '180000000000000' }],
          }),
        deReceta,
      ],
      [
        'descartar el desfase del combo',
        () =>
          pedir('post', 'desfases/descartar', {
            items: [{ itemId: c.id, costoPropuestoVisto: '170000000000000' }],
          }),
        deCombo,
      ],
    ]);

    expect({
      receta: await costos('item_receta', r.id),
      combo: await costos('item_combo', c.id),
    }).toEqual(antes);

    // Control: con el insumo en el máximo que cabe, el desfase se aplica.
    await ajustarCosto(insumoReceta.id, '49999999999999.9999');
    expect(
      (await pedir('post', 'desfases/aplicar', { items: [{ itemId: r.id }] }))
        .status,
    ).toBe(201);
    expect((await costos('item_receta', r.id)).costo).toBe(
      '99999999999999.9998',
    );

    // De vuelta a costos chicos: la bandeja del tenant queda sin estos desfases.
    await ajustarCosto(insumoReceta.id, '1');
    await ajustarCosto(comp1.id, '1');
    await ajustarCosto(comp2.id, '1');
    expect(
      (await pedir('post', 'desfases/aplicar', { items: [{ itemId: r.id }] }))
        .status,
    ).toBe(201);
  });
});
