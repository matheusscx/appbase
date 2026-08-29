import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Consulta inversa a `GET /items/:id/uso`: dada una regla (descuento, recargo
 * o impuesto), los ítems vivos que la usan. Alimenta el modal de confirmación
 * al pausar ("deja de aplicarse en N ítems") — `descuentos`, `recargos` e
 * `impuestos` son gemelos, así que un solo spec cubre los tres, igual que
 * `reglas-valor.e2e-spec.ts` cubre descuentos y recargos juntos.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' };
// `contacto@falabella.cl` es el correo de contacto del tenant (no un usuario
// logueable); el admin real es_fijo de Falabella es `admin@sistema.com`
// (mismo patrón que cajones.e2e-spec.ts / recuentos.e2e-spec.ts).
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

// "Promo fija $5.000" y "Interés cuotas 5%": ambos con `condicionTipo:
// NINGUNA` en el seed de Paris (ver papelera.e2e-spec.ts), se asocian a un
// ítem sin depender de ninguna condición de venta.
const DESCUENTO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440338';
const RECARGO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440115';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';

interface TokenResponse {
  access_token: string;
}
interface UsoResponse {
  /** Ausente en impuestos, que no tienen nivel. */
  nivel?: 'linea' | 'venta';
  /**
   * `eliminado` solo lo devuelven descuentos y recargos, desde el 2026-08-25:
   * su `/uso` incluye los ítems en la papelera **marcados**, porque el guard del
   * cambio de nivel los cuenta y el admin no tenía forma de saber cuáles eran.
   * El de impuestos **sigue filtrando** los borrados, así que ahí no viene.
   */
  items: { id: string; nombre: string; eliminado?: boolean }[];
}
interface IdResponse {
  id: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Uso de reglas (e2e) — GET /descuentos|recargos|impuestos/:id/uso', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenFalabella: string;
  let itemId: string;
  let impuestoId: string;
  let descuentoSinUsoId: string;
  let recargoSinUsoId: string;
  let descuentoDeVentaId: string;

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

    tokenAdmin = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenVendedor = await login(
      app,
      VENDEDOR_PARIS.email,
      VENDEDOR_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenFalabella = await login(
      app,
      ADMIN_FALABELLA.email,
      ADMIN_FALABELLA.pass,
      FALABELLA_TENANT_ID,
    );

    // Impuesto personalizado propio de Paris (no hay uno sembrado además del
    // IVA de sistema, que no es de este tenant — ver impuestos.service.ts).
    const resImpuesto = await request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Impuesto uso E2E ${Date.now()}`,
        porcentaje: '0.05',
      });
    expect(resImpuesto.status).toBe(201);
    impuestoId = (resImpuesto.body as IdResponse).id;

    // Un ítem que usa las tres reglas a la vez: alcanza para probar los tres
    // endpoints con un solo fixture.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Item uso E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        impuestosIds: [impuestoId],
        descuentosIds: [DESCUENTO_SIN_CONDICION_ID],
        recargosIds: [RECARGO_SIN_CONDICION_ID],
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as IdResponse).id;

    // Un descuento y un recargo propios de Paris sin ningún ítem asociado,
    // para el caso "nadie la usa".
    const resDescuentoSinUso = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Descuento sin uso E2E ${Date.now()}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valorPorcentaje: '0.10',
      });
    expect(resDescuentoSinUso.status).toBe(201);
    descuentoSinUsoId = (resDescuentoSinUso.body as IdResponse).id;

    const resRecargoSinUso = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Recargo sin uso E2E ${Date.now()}`,
        tipoReglaId: TIPO_RECARGO_GENERAL,
        modo: 'porcentaje',
        valorPorcentaje: '0.02',
      });
    expect(resRecargoSinUso.status).toBe(201);
    recargoSinUsoId = (resRecargoSinUso.body as IdResponse).id;

    // Un descuento de nivel VENTA: no se asocia a ítems, se elige al cobrar.
    const resDescuentoVenta = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Descuento de venta E2E ${Date.now()}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        valorPorcentaje: '0.05',
        nivel: 'venta',
      });
    expect(resDescuentoVenta.status).toBe(201);
    descuentoDeVentaId = (resDescuentoVenta.body as IdResponse).id;
  }, 60000);

  afterAll(async () => {
    // Acumular en vez de cortar: si un paso falla, los que siguen igual tienen
    // que correr — lo que dejen sin limpiar contamina las suites siguientes. El
    // `close` va en un `finally` y la aserción DESPUÉS: afirmar antes deja la
    // app de Nest viva con su `@Cron` escribiéndole a la base desde un módulo
    // desmontado (medido: cuelga jest para siempre). Molde:
    // `caja-testigo.e2e-spec.ts`. Ver `docs/agent/pendientes.md` § 1.
    const fallos: string[] = [];
    // `404` es legítimo acá: significa que un test ya lo borró antes que la
    // limpieza. Cualquier otro status sí es un problema.
    const limpiar = async (
      que: string,
      ejecutar: () => Promise<number>,
      ok: number[] = [200, 404],
    ) => {
      try {
        const status = await ejecutar();
        if (!ok.includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      if (itemId)
        await limpiar(
          `borrar ítem ${itemId}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/items/${itemId}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
      if (impuestoId)
        await limpiar(
          `borrar impuesto ${impuestoId}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/impuestos/${impuestoId}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
      if (descuentoSinUsoId)
        await limpiar(
          `borrar descuento ${descuentoSinUsoId}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/descuentos/${descuentoSinUsoId}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
      if (descuentoDeVentaId)
        await limpiar(
          `borrar descuento de venta ${descuentoDeVentaId}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/descuentos/${descuentoDeVentaId}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
      if (recargoSinUsoId)
        await limpiar(
          `borrar recargo ${recargoSinUsoId}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/recargos/${recargoSinUsoId}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  // ─── Devuelve los ítems que usan la regla ─────────────────────────────────

  it('descuentos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items.map((i) => i.id)).toContain(itemId);
  });

  it('recargos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items.map((i) => i.id)).toContain(itemId);
  });

  it('impuestos/:id/uso devuelve el ítem que lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/impuestos/${impuestoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const body = res.body as UsoResponse;
    expect(body.items).toEqual([{ id: itemId, nombre: expect.any(String) }]);
  });

  // ─── Lista vacía cuando nadie la usa ──────────────────────────────────────

  it('descuentos/:id/uso devuelve lista vacía cuando nadie lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${descuentoSinUsoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body as UsoResponse).toEqual({ nivel: 'linea', items: [] });
  });

  it('recargos/:id/uso devuelve lista vacía cuando nadie lo usa', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${recargoSinUsoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body as UsoResponse).toEqual({ nivel: 'linea', items: [] });
  });

  // ─── Aislamiento multi-tenant ──────────────────────────────────────────────
  // Falabella no puede ver NI CONTAR los ítems de Paris: el precheck de
  // pertenencia (`{ id, tenantId }`) 404-ea antes de llegar al JOIN, así que
  // ni siquiera se ejecuta la query que podría filtrar por error.

  it('un tenant no ve los ítems de otro: descuento de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  it('un tenant no ve los ítems de otro: recargo de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  it('un tenant no ve los ítems de otro: impuesto personalizado de Paris es 404 para Falabella', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/impuestos/${impuestoId}/uso`)
      .set('Authorization', `Bearer ${tokenFalabella}`);

    expect(res.status).toBe(404);
  });

  // ─── Nivel de la regla ─────────────────────────────────────────────────────

  /**
   * El nivel decide por qué puerta se usa una regla, y las dos puertas lo hacen
   * cumplir: `ItemsService.validarReglas` (asociarla a un ítem) y
   * `CalculoPreciosService.resolverReglas` (mandarla en el cálculo). Sin esto
   * una regla medida contra el total de la venta se podía colgar de un ítem y
   * cobrarse contra la línea, que es otra plata.
   */

  it('el uso de una regla de venta dice su nivel, no solo "0 ítems"', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${descuentoDeVentaId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    // El conteo en 0 es correcto Y es inútil solo: una regla de venta no tiene
    // tabla puente con ítems, así que su 0 no significa "nadie la usa". El
    // `nivel` es lo que deja a la pantalla decir lo que corresponde.
    expect(res.body as UsoResponse).toEqual({ nivel: 'venta', items: [] });
  });

  it('crear un ítem con un descuento de nivel venta es 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Item nivel E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        descuentosIds: [descuentoDeVentaId],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('nivel venta');
  });

  it('asociar por PATCH un descuento de nivel venta a un ítem es 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ descuentosIds: [descuentoDeVentaId] });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('nivel venta');
  });

  it('mandar una regla de línea en descuentosVentaIds es 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: [{ itemId, cantidad: '1' }],
        descuentosVentaIds: [DESCUENTO_SIN_CONDICION_ID],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'es de nivel línea',
    );
  });

  it('mandar una regla de venta en la línea es 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: [{ itemId, cantidad: '1', descuentoIds: [descuentoDeVentaId] }],
      });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'es de nivel venta',
    );
  });

  it('la regla de venta SÍ se aplica por su propia puerta (ancla positiva)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: [{ itemId, cantidad: '1' }],
        descuentosVentaIds: [descuentoDeVentaId],
      });

    // Sin esto, los cuatro 400 de arriba también pasarían con una puerta
    // tapiada de los dos lados.
    expect(res.status).toBe(201);
    expect(
      Number(
        (res.body as { totales: { totalDescuentos: string } }).totales
          .totalDescuentos,
      ),
    ).toBeGreaterThan(0);
  });

  it('pasar a nivel venta una regla que ítems todavía usan es 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nivel: 'venta' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'todavía tienen',
    );
  });

  // ─── Ítems borrados ────────────────────────────────────────────────────────

  /**
   * ⚠️ **Esto cambió el 2026-08-25 y la conducta vieja está en el título de este
   * test, no borrada:** antes `/uso` filtraba los borrados en las tres reglas,
   * porque el conteo alimenta el modal de pausa y ahí un ítem en la papelera
   * infla el número. Sigue siendo cierto **del modal** —hoy los descarta él, en
   * `usePausaRegla`— pero no del endpoint: el guard del cambio de nivel los
   * cuenta, y filtrarlos dejaba al admin leyendo *"1 ítem todavía lo tiene"* sin
   * forma de saber cuál (decisión del owner). Por eso ahora viajan **marcados**,
   * y cada consumidor decide.
   *
   * Impuestos quedó como estaba: no tienen nivel, así que nadie cuenta sus
   * borrados y no hay nada que mostrar.
   *
   * Se prueba borrando de verdad y volviendo a consultar, no afirmando que el
   * SQL contiene `eliminado_el` — un `toContain` sobre la query también matchea
   * el comentario de arriba.
   *
   * ⚠️ Borra el ítem que usan los tests de arriba, así que tiene que quedar
   * DESPUÉS de todos los que dependan de él **con el ítem vivo**. Un test nuevo
   * que consulte `/uso` va ANTES de éste salvo que necesite justo lo contrario
   * —el ítem ya borrado—, que es el caso del de la papelera de más abajo. El del
   * guard cierra la lista porque corta en `TenantAdminGuard` sin llegar al
   * service, así que no mira ningún ítem.
   */
  it('un ítem borrado sigue en el uso de descuentos y recargos, MARCADO; en impuestos no', async () => {
    for (const url of [
      `/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`,
      `/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`,
    ]) {
      const antes = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(antes.status).toBe(200);
      const fila = (antes.body as UsoResponse).items.find(
        (i) => i.id === itemId,
      );
      expect(fila).toBeDefined();
      // Vivo: la marca viaja siempre, no solo cuando es `true`. Sin esto, un
      // endpoint que no devolviera el campo pasaría el resto del test por
      // `undefined !== true`.
      expect(fila!.eliminado).toBe(false);
    }

    const del = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(del.status).toBe(200);

    for (const url of [
      `/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`,
      `/api/recargos/${RECARGO_SIN_CONDICION_ID}/uso`,
    ]) {
      const res = await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      const fila = (res.body as UsoResponse).items.find((i) => i.id === itemId);
      expect(fila).toBeDefined();
      expect(fila!.eliminado).toBe(true);
    }

    // El de impuestos NO cambió: ahí nadie cuenta los borrados —los impuestos no
    // tienen nivel y no hay guard que los mire—, así que sigue listando vivos.
    const imp = await request(app.getHttpServer())
      .get(`/api/impuestos/${impuestoId}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(imp.status).toBe(200);
    expect((imp.body as UsoResponse).items.some((i) => i.id === itemId)).toBe(
      false,
    );
  });

  /**
   * ⚠️ Va DESPUÉS del test de arriba a propósito: necesita el ítem ya borrado,
   * que es justo el estado que el guard no veía. `ItemsService.remove` es un
   * soft delete que **no toca las tablas puente**, así que la fila de
   * `item_descuentos` sigue viva; contando solo los ítems vivos el cambio de
   * nivel pasaba, y al restaurar el ítem su descuento resultaba de nivel venta
   * y el ítem quedaba invendible.
   */
  it('un ítem en la papelera igual bloquea el paso a nivel venta, y el uso lo nombra', async () => {
    // El uso lo lista MARCADO, que es lo que le da al admin la forma de saber
    // cuál es el ítem que el 400 le está contando. Antes del 2026-08-25 acá se
    // afirmaba lo contrario —que el uso ya no lo contaba— y esa era justamente
    // la queja: el admin leía "1 ítem todavía lo tiene" y no tenía de dónde
    // sacar el nombre; la salida era restaurar a ciegas.
    const uso = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(uso.status).toBe(200);
    const fila = (uso.body as UsoResponse).items.find((i) => i.id === itemId);
    expect(fila).toBeDefined();
    expect(fila!.eliminado).toBe(true);
    expect(fila!.nombre).toBeTruthy();

    const res = await request(app.getHttpServer())
      .patch(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nivel: 'venta' });

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain('papelera');
  });

  // ─── Guard: admin-only ─────────────────────────────────────────────────────

  it('un usuario sin rol admin no puede consultar el uso', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/descuentos/${DESCUENTO_SIN_CONDICION_ID}/uso`)
      .set('Authorization', `Bearer ${tokenVendedor}`);

    expect(res.status).toBe(403);
  });
});
