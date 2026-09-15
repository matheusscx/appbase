import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface Respuesta {
  status: number;
  body: unknown;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE SPEC Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRUEBA: las carreras de `pendientes.md` § 5 del molde "no toma lock" entre
 * borrar un ítem y crear una referencia a él. `ItemsService.remove` decide si
 * el ítem está en uso con `obtenerUsoItem`, un `SELECT` sin lock: bajo READ
 * COMMITTED no ve la referencia que otra transacción está escribiendo, así que
 * las dos commitean y queda una fila viva apuntando a un ítem borrado.
 *
 * El arreglo es un par de locks sobre la fila de `items`: `remove()` la toma
 * `FOR UPDATE` antes de mirar el uso, y cada camino que crea una referencia
 * toma `FOR SHARE` sobre los ítems referenciados antes de escribir. Un test por
 * cada mecanismo distinto que toma el `FOR SHARE`:
 *
 *   1. ingrediente de receta   → `filasValidacionPorIds` (PATCH /items/:id)
 *   2. extra permitido         → idem, pero la referencia es advertencia, no
 *                                bloqueo: el borrado pasa y se la lleva
 *   3. opción de grupo         → `validarYResolverOpciones` (PATCH /grupos-…)
 *   4. línea de cuenta         → `agregarLinea`, el ítem de la línea
 *   5. extra pedido en línea   → `agregarLinea`, el ingrediente del extra
 *
 * Y la misma carrera cuando la referencia no se crea sino que REVIVE: restaurar
 * un compuesto de la papelera toma `FOR SHARE` sobre lo que lo compone
 * (`assertComposicionRestaurable`, `assertOpcionesRestaurables`) antes de
 * revivirlo, contra el `FOR UPDATE` del borrado:
 *
 *   6. restaurar una receta    → contra borrar su ingrediente
 *   7. restaurar una receta    → contra borrar su grupo: acá el par es el
 *                                `FOR UPDATE` de `grupos-modificadores.remove()`
 *   8. restaurar un grupo      → contra borrar el ítem de una opción
 *
 * Y las carreras donde lo que se borra es el padre al que otra edición le está
 * colgando filas:
 *
 *   9. editar los extras de una receta → contra borrar la receta: `update()`
 *                                toma `FOR KEY SHARE` sobre el ítem vivo
 *  10. asociar un grupo a una receta   → contra borrar el grupo:
 *                                `asociarGruposModificadores` toma `FOR KEY
 *                                SHARE` sobre el grupo. El alta de un ítem con
 *                                grupos pasa por el mismo método y no tiene
 *                                test de carrera propio.
 *  11. editar las opciones de un grupo → contra borrar el grupo:
 *                                `GruposModificadoresService.update()` toma
 *                                `FOR KEY SHARE` sobre el grupo
 *
 * CÓMO: el interleaving es DETERMINISTA, misma técnica que
 * `traslado-borrado-ubicacion-concurrente.e2e-spec.ts`. Una compuerta (un
 * `QueryRunner` propio, fuera de Nest) retiene con `FOR UPDATE` una fila que
 * el primer request escribe DESPUÉS de haber validado, y el segundo entra
 * mientras el primero está frenado ahí.
 *
 * En 1-4 el que escribe la referencia va primero y el borrado segundo: con el
 * arreglo, el borrado se encola detrás del `FOR SHARE` y cuando entra ve la
 * referencia ya commiteada. En 5 el orden es el inverso —el borrado va primero
 * y la línea segundo—, porque el ítem de un extra es un ingrediente y la única
 * escritura del borrado que se puede retener está después de su chequeo: con
 * el arreglo, la línea se encola detrás del `FOR UPDATE` y cuando entra el
 * extra ya no existe.
 *
 * En 6-8 va primero el restaurar, frenado en su propia escritura (la fila del
 * compuesto que revive, que la compuerta retiene), y el borrado segundo: con el
 * arreglo, el borrado se encola detrás del `FOR SHARE` y cuando entra ve el
 * compuesto ya vivo.
 *
 * Cualquiera de los dos órdenes caza que falte cualquiera de los dos lados del
 * par: sin el `FOR UPDATE` el borrado no espera a nadie antes de su chequeo, y
 * sin el `FOR SHARE` no hay nada que lo haga esperar.
 *
 * `esperando` es lo que separa este verde del verde de una compuerta que no
 * enganchó: las sesiones en `pg_stat_activity` con `wait_event_type = 'Lock'`
 * justo antes de soltar. Con el arreglo son DOS; sin ningún lado del par, una
 * sola. (Sin solo el `FOR UPDATE`, en 1-4 siguen siendo dos —el `UPDATE items`
 * final del borrado espera al `FOR SHARE`— y lo cazan los status y las filas.)
 * Cuenta la base entera, así que una espera ajena da rojo falso, nunca verde
 * falso: cada test afirma además status o filas.
 *
 * NO PRUEBA:
 * - Componente de combo: pasa por el mismo `filasValidacionPorIds` que 1 y 2.
 *   Al restaurar, el componente y el extra van en la misma lectura con lock que
 *   el ingrediente de 6.
 * - El alta (`POST /items`, `POST /grupos-modificadores`): toma el lock por el
 *   mismo método que la edición.
 * - Editar una receta o un grupo mientras se pide una línea (sacar un extra que
 *   una mesa está pidiendo): no hay nada que serializar. Desde el 2026-09-14
 *   esas ediciones no consultan cuentas, y la mesa se cobra con lo que congeló
 *   al pedir (`cuenta-precio-congelado.e2e-spec.ts`, tests 20 a 23).
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Borrado de ítem concurrente con una referencia nueva (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let garzon: GarzonCreado;
  let cuentaId: string;

  function nombreUnico(base: string): string {
    return `${base} carrera E2E ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  }

  async function post<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function crearItem(body: Record<string, unknown>): Promise<string> {
    const { id } = await post<IdResponse>('/api/items', {
      monedaId: CLP_MONEDA_ID,
      ...body,
    });
    return id;
  }

  const crearIngrediente = () =>
    crearItem({
      nombre: nombreUnico('Ingrediente'),
      precioBase: '0',
      tipo: 'ingrediente',
      unidadMedida: 'unidad',
      stock: '10',
      costo: '100',
    });

  const crearProducto = () =>
    crearItem({
      nombre: nombreUnico('Producto'),
      precioBase: '1000',
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock: '10',
      costo: '100',
    });

  const ingrediente = (id: string) => ({
    ingredienteItemId: id,
    cantidad: '1',
    unidadCodigo: 'unidad',
  });
  const extra = (id: string) => ({ ...ingrediente(id), precioExtra: '500' });

  const llamar =
    (metodo: 'POST' | 'PATCH' | 'DELETE', ruta: string, body?: unknown) =>
    async (): Promise<Respuesta> => {
      const res = await fetch(`http://127.0.0.1:${port}/api${ruta}`, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // `DELETE /items/:id` contesta 200 sin cuerpo.
      const texto = await res.text();
      return { status: res.status, body: texto ? JSON.parse(texto) : null };
    };

  /** Sesiones frenadas en un lock ahora mismo. */
  const esperandoLock = async (): Promise<number> => {
    const filas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(filas[0].count);
  };

  /**
   * Retiene la fila de la compuerta, dispara `primero`, le da tiempo a llegar
   * hasta esa fila, dispara `segundo` y suelta. Devuelve cuántas sesiones
   * estaban esperando un lock justo antes de soltar.
   */
  async function correrCarrera(opciones: {
    compuerta: [string, unknown[]];
    primero: () => Promise<Respuesta>;
    segundo: () => Promise<Respuesta>;
  }): Promise<{ esperando: number; primero: Respuesta; segundo: Respuesta }> {
    const compuerta = ds.createQueryRunner();
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      const retenidas: unknown[] = await compuerta.query(...opciones.compuerta);
      // Una compuerta que no retiene ninguna fila no frena a nadie, y el test
      // pasaría a medir otra cosa.
      expect(retenidas.length).toBeGreaterThan(0);

      const primero = opciones.primero();
      await dormir(800);
      const segundo = opciones.segundo();
      await dormir(800);

      const esperando = await esperandoLock();
      await compuerta.rollbackTransaction();
      const [rPrimero, rSegundo] = await Promise.all([primero, segundo]);
      return { esperando, primero: rPrimero, segundo: rSegundo };
    } finally {
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }
  }

  async function itemBorrado(itemId: string): Promise<boolean> {
    const filas: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM items WHERE item_id = $1`,
      [itemId],
    );
    return filas[0].eliminado_el !== null;
  }

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
    ds = app.get(DataSource);

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

    // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y varias
    // specs comparten el sembrado.
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: nombreUnico('Garzón'),
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await post<IdResponse>('/api/salones', {
      nombre: nombreUnico('Salón'),
    });
    const mesa = await post<IdResponse>(`/api/salones/${salon.id}/mesas`, {
      nombre: 'Mesa carrera',
    });
    cuentaId = (
      await post<IdResponse>(`/api/mesas/${mesa.id}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;

    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular y afirmar DESPUÉS de `app.close()`: un expect que tira antes de
    // cerrar deja el pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      if (cuentaId) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (![200, 201].includes(res.status)) {
          fallos.push(`cancelar cuenta → ${res.status}`);
        }
      }
      if (garzon) {
        const res = await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: garzon.id, pin: garzon.pin });
        if (![200, 201].includes(res.status)) {
          fallos.push(`cerrar sesión del garzón → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('1. ingrediente: el PATCH de la receta que lo agrega gana, y el borrado espera y rebota con 400', async () => {
    const base = await crearIngrediente();
    const nuevo = await crearIngrediente();
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(base)],
    });

    // El PATCH valida los ingredientes y después soft-borra la lista vieja: la
    // compuerta retiene esa fila.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM receta_ingredientes
          WHERE receta_item_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
        [recetaId],
      ],
      primero: llamar('PATCH', `/items/${recetaId}`, {
        ingredientes: [ingrediente(base), ingrediente(nuevo)],
      }),
      segundo: llamar('DELETE', `/items/${nuevo}`),
    });

    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('es ingrediente de');
    expect(await itemBorrado(nuevo)).toBe(false);
  }, 60000);

  it('2. extra permitido: el borrado espera al PATCH que lo agrega y se lleva también esa fila, sin dejarla viva', async () => {
    const base = await crearIngrediente();
    const extraViejo = await crearIngrediente();
    const extraNuevo = await crearIngrediente();
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(base)],
      extrasPermitidos: [extra(extraViejo)],
    });

    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM receta_extras_permitidos
          WHERE receta_item_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
        [recetaId],
      ],
      primero: llamar('PATCH', `/items/${recetaId}`, {
        extrasPermitidos: [extra(extraViejo), extra(extraNuevo)],
      }),
      segundo: llamar('DELETE', `/items/${extraNuevo}`),
    });

    // Un extra no bloquea el borrado: el borrado pasa. Lo que el arreglo
    // custodia es que pase DESPUÉS del PATCH, y entonces su limpieza de
    // `receta_extras_permitidos` alcanza la fila recién insertada.
    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 200 });
    const vivas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM receta_extras_permitidos
        WHERE ingrediente_item_id = $1 AND eliminado_el IS NULL`,
      [extraNuevo],
    );
    expect(Number(vivas[0].count)).toBe(0);
  }, 60000);

  it('3. opción de grupo: el PATCH del grupo que la agrega gana, y el borrado espera y rebota con 400', async () => {
    const opcionVieja = await crearProducto();
    const opcionNueva = await crearProducto();
    const { grupoModificadorId } = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      {
        nombre: nombreUnico('Grupo'),
        opciones: [{ itemId: opcionVieja, precioExtra: '0' }],
      },
    );

    // La nueva va PRIMERO en la lista: se valida y se inserta antes de llegar
    // a la vieja, cuyo UPDATE retiene la compuerta. Al revés, el PATCH sin
    // arreglo leería la nueva recién después de soltar, ya borrada, y
    // rebotaría solo — el test no vería la carrera.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM grupo_modificador_opciones
          WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
        [grupoModificadorId],
      ],
      primero: llamar('PATCH', `/grupos-modificadores/${grupoModificadorId}`, {
        opciones: [
          { itemId: opcionNueva, precioExtra: '0' },
          { itemId: opcionVieja, precioExtra: '0' },
        ],
      }),
      segundo: llamar('DELETE', `/items/${opcionNueva}`),
    });

    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('es opción de');
    expect(await itemBorrado(opcionNueva)).toBe(false);
  }, 60000);

  it('4. línea de cuenta: la línea que pide el ítem gana, y el borrado espera y rebota con 400', async () => {
    const productoId = await crearProducto();

    // `agregarLinea` toma el lock de stock (`item_producto`) después del lock
    // del ítem: la compuerta retiene ese.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [productoId],
      ],
      primero: llamar('POST', `/cuentas/${cuentaId}/lineas`, {
        itemId: productoId,
        cantidad: '1',
      }),
      segundo: llamar('DELETE', `/items/${productoId}`),
    });

    expect({
      esperando: r.esperando,
      linea: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, linea: 201, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('está pedido en');
    expect(await itemBorrado(productoId)).toBe(false);
  }, 60000);

  it('5. extra pedido en una línea: el borrado del extra gana, y la línea espera y rebota con 400', async () => {
    const base = await crearIngrediente();
    const extraId = await crearIngrediente();
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(base)],
      extrasPermitidos: [extra(extraId)],
    });

    // El borrado chequea el uso y DESPUÉS soft-borra las filas que ofrecen el
    // ingrediente como extra: la compuerta retiene esa.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM receta_extras_permitidos
          WHERE ingrediente_item_id = $1 AND eliminado_el IS NULL FOR UPDATE`,
        [extraId],
      ],
      primero: llamar('DELETE', `/items/${extraId}`),
      segundo: llamar('POST', `/cuentas/${cuentaId}/lineas`, {
        itemId: recetaId,
        cantidad: '1',
        personalizacion: {
          extras: [{ ingredienteItemId: extraId, unidades: 1 }],
        },
      }),
    });

    expect({
      esperando: r.esperando,
      borrado: r.primero.status,
      linea: r.segundo.status,
    }).toEqual({ esperando: 2, borrado: 200, linea: 400 });
    const lineas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM cuenta_lineas
        WHERE cuenta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [cuentaId, recetaId],
    );
    expect(Number(lineas[0].count)).toBe(0);
  }, 60000);

  it('6. restaurar una receta: el restaurar gana, y el borrado de su ingrediente espera y rebota con 400', async () => {
    const base = await crearIngrediente();
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(base)],
    });
    expect((await llamar('DELETE', `/items/${recetaId}`)()).status).toBe(200);

    // El restaurar toma lo que compone la receta y DESPUÉS revive la fila de
    // la receta: la compuerta retiene esa.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE`,
        [recetaId],
      ],
      primero: llamar('POST', `/items/${recetaId}/restaurar`),
      segundo: llamar('DELETE', `/items/${base}`),
    });

    expect({
      esperando: r.esperando,
      restaurar: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, restaurar: 201, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('es ingrediente de');
    expect(await itemBorrado(base)).toBe(false);
  }, 60000);

  it('7. restaurar una receta: el restaurar gana, y el borrado de su grupo espera y rebota con 400', async () => {
    const opcion = await crearProducto();
    const { grupoModificadorId } = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      {
        nombre: nombreUnico('Grupo'),
        opciones: [{ itemId: opcion, cantidad: '1', precioExtra: '0' }],
      },
    );
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(await crearIngrediente())],
      gruposModificadores: [{ grupoModificadorId, min: 0, max: 1 }],
    });
    expect((await llamar('DELETE', `/items/${recetaId}`)()).status).toBe(200);

    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE`,
        [recetaId],
      ],
      primero: llamar('POST', `/items/${recetaId}/restaurar`),
      segundo: llamar('DELETE', `/grupos-modificadores/${grupoModificadorId}`),
    });

    expect({
      esperando: r.esperando,
      restaurar: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, restaurar: 201, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('está asociado');
    const grupo: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM grupos_modificadores WHERE grupo_modificador_id = $1`,
      [grupoModificadorId],
    );
    expect(grupo[0].eliminado_el).toBeNull();
  }, 60000);

  it('8. restaurar un grupo: el restaurar gana, y el borrado del ítem de una opción espera y rebota con 400', async () => {
    const opcion = await crearProducto();
    const { grupoModificadorId } = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      {
        nombre: nombreUnico('Grupo'),
        opciones: [{ itemId: opcion, cantidad: '1', precioExtra: '0' }],
      },
    );
    expect(
      (await llamar('DELETE', `/grupos-modificadores/${grupoModificadorId}`)())
        .status,
    ).toBe(204);

    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM grupos_modificadores
          WHERE grupo_modificador_id = $1 FOR UPDATE`,
        [grupoModificadorId],
      ],
      primero: llamar(
        'POST',
        `/grupos-modificadores/${grupoModificadorId}/restaurar`,
      ),
      segundo: llamar('DELETE', `/items/${opcion}`),
    });

    expect({
      esperando: r.esperando,
      restaurar: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, restaurar: 201, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('es opción de');
    expect(await itemBorrado(opcion)).toBe(false);
  }, 60000);

  it('9. editar los extras de una receta: la edición gana, y el borrado de la receta espera y se lleva también esos extras', async () => {
    const extraViejo = await crearIngrediente();
    const extraNuevo = await crearIngrediente();
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(await crearIngrediente())],
      extrasPermitidos: [extra(extraViejo)],
    });

    // El PATCH toma el ítem y DESPUÉS `FOR SHARE` sobre los ingredientes de
    // sus extras: la compuerta retiene uno de ellos.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE`,
        [extraNuevo],
      ],
      primero: llamar('PATCH', `/items/${recetaId}`, {
        extrasPermitidos: [extra(extraViejo), extra(extraNuevo)],
      }),
      segundo: llamar('DELETE', `/items/${recetaId}`),
    });

    // Un PATCH de extras no hace rechazar el borrado de la receta: el borrado
    // pasa. Lo que el lock custodia es que pase DESPUÉS del PATCH, y entonces su
    // limpieza de `receta_extras_permitidos` alcanza las filas recién
    // insertadas.
    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 200 });
    const vivos: { count: string }[] = await ds.query(
      `SELECT count(*) FROM receta_extras_permitidos
        WHERE receta_item_id = $1 AND eliminado_el IS NULL`,
      [recetaId],
    );
    expect(Number(vivos[0].count)).toBe(0);
  }, 60000);

  it('10. asociar un grupo a una receta: la asociación gana, y el borrado del grupo espera y rebota con 400', async () => {
    const otroGrupo = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      {
        nombre: nombreUnico('Grupo'),
        opciones: [
          { itemId: await crearProducto(), cantidad: '1', precioExtra: '0' },
        ],
      },
    );
    const grupo = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      {
        nombre: nombreUnico('Grupo'),
        opciones: [
          { itemId: await crearProducto(), cantidad: '1', precioExtra: '0' },
        ],
      },
    );
    const recetaId = await crearItem({
      nombre: nombreUnico('Receta'),
      precioBase: '4000',
      tipo: 'receta',
      ingredientes: [ingrediente(await crearIngrediente())],
      gruposModificadores: [
        { grupoModificadorId: otroGrupo.grupoModificadorId, min: 0, max: 1 },
      ],
    });

    // El PATCH asocia el grupo nuevo y DESPUÉS actualiza la asociación que ya
    // existía: la compuerta retiene esa.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM item_grupos_modificadores
          WHERE item_id = $1 AND grupo_modificador_id = $2
            AND eliminado_el IS NULL FOR UPDATE`,
        [recetaId, otroGrupo.grupoModificadorId],
      ],
      primero: llamar('PATCH', `/items/${recetaId}`, {
        gruposModificadores: [
          { grupoModificadorId: grupo.grupoModificadorId, min: 0, max: 1 },
          { grupoModificadorId: otroGrupo.grupoModificadorId, min: 0, max: 1 },
        ],
      }),
      segundo: llamar(
        'DELETE',
        `/grupos-modificadores/${grupo.grupoModificadorId}`,
      ),
    });

    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 400 });
    expect(JSON.stringify(r.segundo.body)).toContain('está asociado');
    const filas: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM grupos_modificadores WHERE grupo_modificador_id = $1`,
      [grupo.grupoModificadorId],
    );
    expect(filas[0].eliminado_el).toBeNull();
  }, 60000);

  it('11. editar las opciones de un grupo: la edición gana, y el borrado del grupo espera y se lleva también la opción nueva', async () => {
    const opcionVieja = await crearProducto();
    const opcionNueva = await crearProducto();
    const opcion = (itemId: string) => ({
      itemId,
      cantidad: '1',
      precioExtra: '0',
    });
    const { grupoModificadorId } = await post<{ grupoModificadorId: string }>(
      '/api/grupos-modificadores',
      { nombre: nombreUnico('Grupo'), opciones: [opcion(opcionVieja)] },
    );

    // El PATCH lee el grupo y DESPUÉS toma `FOR SHARE` sobre los ítems de sus
    // opciones: la compuerta retiene la opción nueva. Sin renombrar, que es la
    // variante donde la opción quedaba viva en el grupo borrado.
    const r = await correrCarrera({
      compuerta: [
        `SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE`,
        [opcionNueva],
      ],
      primero: llamar('PATCH', `/grupos-modificadores/${grupoModificadorId}`, {
        opciones: [opcion(opcionVieja), opcion(opcionNueva)],
      }),
      segundo: llamar('DELETE', `/grupos-modificadores/${grupoModificadorId}`),
    });

    // Un grupo sin ítems que lo usen se borra: el borrado pasa, y como entra
    // DESPUÉS del PATCH su soft-delete alcanza también la opción nueva.
    expect({
      esperando: r.esperando,
      patch: r.primero.status,
      borrado: r.segundo.status,
    }).toEqual({ esperando: 2, patch: 200, borrado: 204 });
    const vivas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM grupo_modificador_opciones
        WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL`,
      [grupoModificadorId],
    );
    expect(Number(vivas[0].count)).toBe(0);
  }, 60000);
});
