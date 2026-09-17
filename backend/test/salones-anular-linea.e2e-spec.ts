import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Anular un plato ya despachado a cocina (spec
 * `docs/superpowers/specs/2026-09-16-anular-plato-despachado-design.md`,
 * §§ 3-7). `quitarLinea` rechaza una línea con `cantidad_enviada > 0`; este es
 * el camino CON motivo que esa misma línea de rechazo prometía.
 *
 * Garzón, salón, mesa y catálogo son PROPIOS de este archivo, no del seed: la
 * sesión de garzón es única y varias suites la comparten
 * (`docs/agent/pendientes.md`).
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Operar` + `Salones:Anular` desde el 2026-09-16 (seedRolEncargadoSalon). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Salones:Operar`, SIN `Anular`: el 403 de este spec. */
const SOLO_OPERAR = { email: 'ana.torres@paris.cl', pass: 'admin' };

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
interface MotivoBajaItem {
  id: string;
  nombre: string;
  tipo: string;
}
interface CuentaLineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  cantidadEnviada: string;
}
interface CuentaAnulacionDetalle {
  id: string;
  itemId: string;
  itemNombre: string;
  cantidad: string;
  motivoNombre: string;
  motivoTipo: string;
  autorizadoPorNombre: string;
}
interface CuentaDetalle {
  id: string;
  estado: string;
  ventaId: string | null;
  lineas: CuentaLineaDetalle[];
  anulaciones: CuentaAnulacionDetalle[];
  advertencias?: string[];
}
interface ItemDetalle {
  id: string;
  stockVendible: string | null;
  activo: boolean;
}
interface VentaDetalle {
  totalFinal: string;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('Salones — anular un plato ya despachado (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let tokenSoloOperar: string;
  let mesaId: string;
  let garzon: GarzonCreado;
  let cajaId: string;

  let motivoMermaId: string;
  let motivoCortesiaId: string;
  let motivoNoElaboradoId: string;

  /** Producto con stock, ruteado a una impresora para que `reclamar` avance `cantidadEnviada`. */
  let platoId: string;
  /** Segundo producto de la MISMA cuenta, para que anular el primero entero no cancele la mesa. */
  let guarnicionId: string;
  /** La categoría ruteada a cocina, para sembrar más ítems en los tests. */
  let catCocinaId: string;

  /**
   * La cuenta que el test de aislamiento por tenant crea por SQL directo en
   * OTRO tenant real del seed (Demo Bodega), para probar el filtro de
   * `getCuentaAbiertaConLock`. Queda abierta ahí hasta el `afterAll` — no
   * puede quedar viva en un tenant ajeno.
   */
  let cuentaAjenaId: string | undefined;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    token = tokenAdmin,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function abrirCuentaCon(
    lineas: { itemId: string; cantidad: string }[],
    mesaIdDestino = mesaId,
  ): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(
      `/api/mesas/${mesaIdDestino}/cuentas`,
      {
        garzonId: garzon.id,
        pin: garzon.pin,
      },
    );
    for (const linea of lineas) {
      await post(`/api/cuentas/${cuenta.id}/lineas`, linea);
    }
    return cuenta;
  }

  /** Reclama la comanda pendiente: avanza `cantidadEnviada` de TODA la cuenta. */
  async function despachar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/comanda/reclamar`, {});
  }

  async function detalleCuenta(
    cuentaId: string,
    mesaIdDestino = mesaId,
  ): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaIdDestino}/cuentas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const cuenta = (res.body as CuentaDetalle[]).find((c) => c.id === cuentaId);
    expect(cuenta).toBeDefined();
    return cuenta!;
  }

  async function anular(
    cuentaId: string,
    lineaId: string,
    body: { cantidad: string; motivoBajaId: string },
    token = tokenEncargado,
  ) {
    return request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function cancelarConMotivo(
    cuentaId: string,
    body: { motivoBajaId: string },
    token = tokenEncargado,
  ) {
    return request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar-con-motivo`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  /** La ruta simple de cancelar (`Salones:Operar`), sin motivo. */
  async function cancelar(cuentaId: string, token = tokenAdmin) {
    return request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  /** Cierra sin cobrar (pagos vacíos): alcanza para leer el total congelado. */
  async function cerrarSinCobrar(
    cuentaId: string,
  ): Promise<{ ventaId: string; cuenta: CuentaDetalle }> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: garzon.id, pin: garzon.pin, pagos: [] });
    expect(res.status).toBe(201);
    return res.body as { ventaId: string; cuenta: CuentaDetalle };
  }

  async function ventaDetalle(ventaId: string): Promise<VentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return res.body as VentaDetalle;
  }

  async function stockVendibleDe(itemId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return (res.body as ItemDetalle).stockVendible!;
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
    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);
    tokenSoloOperar = await entrar(app, SOLO_OPERAR.email, SOLO_OPERAR.pass);

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as MotivoBajaItem[];
    motivoMermaId = motivos.find((m) => m.tipo === 'merma')!.id;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
    motivoNoElaboradoId = motivos.find((m) => m.tipo === 'no_elaborado')!.id;
    expect(motivoMermaId).toBeTruthy();
    expect(motivoCortesiaId).toBeTruthy();
    expect(motivoNoElaboradoId).toBeTruthy();

    const marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada` (spec § 9, "Líneas sin impresora") y el tope de la
    // anulación —lo despachado— quedaría siempre en cero.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina anular E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-anular-e2e-${marca}`,
      })
    ).id;
    catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina anular E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    const item = (nombre: string, stock: string) => ({
      nombre: `${nombre} E2E ${marca}`,
      tipo: 'producto',
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      unidadMedida: 'unidad',
      stock,
      costo: '100',
      categoriaId: catCocinaId,
    });
    platoId = (await post<IdResponse>('/api/items', item('Lomo', '1000'))).id;
    guarnicionId = (await post<IdResponse>('/api/items', item('Papas', '1000')))
      .id;

    // Garzón PROPIO: la sesión es única por garzón y varios specs la
    // comparten (`docs/agent/pendientes.md`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón anular E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón anular E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa anular',
      })
    ).id;

    // Caja propia: cerrar una cuenta genera una venta `canal='fisico'`, que
    // exige caja abierta.
    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    expect(cajonId).toBeTruthy();
    cajaId = (
      await post<IdResponse>('/api/caja/abrir', {
        cajonId,
        saldoInicial: '0.0000',
        comentario: 'Apertura E2E anular línea',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // La cuenta ajena de "una CUENTA y una LÍNEA de OTRO tenant..." vive en
    // Demo Bodega, no en el tenant de esta suite: no puede quedar `abierta`
    // ahí. `console.warn` y no `expect`/`fallos` a propósito — es un fixture
    // de un tenant ajeno, no algo que el garzón/caja de ESTA suite dejaron a
    // medias, y no vale la pena tumbar el resto de la limpieza por esto.
    if (cuentaAjenaId) {
      try {
        await ds.query(
          `UPDATE cuentas SET estado = 'cancelada', cerrada_el = NOW()
            WHERE cuenta_id = $1`,
          [cuentaAjenaId],
        );
      } catch (e) {
        console.warn(
          `No se pudo cerrar la cuenta ajena ${cuentaAjenaId} (Demo Bodega): ${(e as Error).message}`,
        );
      }
    }

    const fallos: string[] = [];
    const limpiar = async (
      que: string,
      ejecutar: () => Promise<number>,
      ok: number[] = [200, 201],
    ) => {
      try {
        const status = await ejecutar();
        if (!ok.includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      await limpiar(
        'cerrar sesión del garzón',
        async () =>
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${tokenAdmin}`)
              .send({ garzonId: garzon.id, pin: garzon.pin })
          ).status,
      );

      await limpiar('cerrar caja', async () => {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        if (motivos.status !== 200) return motivos.status;
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        return (
          await request(app.getHttpServer())
            .post(`/api/caja/${cajaId}/cerrar`)
            .set('Authorization', `Bearer ${tokenAdmin}`)
            .send({
              lineas: [
                {
                  metodoPagoId: null,
                  motivoDiferenciaId: motivoId,
                  comentarioDiferencia: 'Cierre de la suite e2e',
                },
              ],
            })
        ).status;
      });
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('un usuario con Operar y sin Anular recibe 403; el encargado (Operar + Anular) recibe 201', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '2' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const rechazado = await anular(
      cuenta.id,
      linea.id,
      { cantidad: '1', motivoBajaId: motivoNoElaboradoId },
      tokenSoloOperar,
    );
    expect(rechazado.status).toBe(403);

    const aceptado = await anular(
      cuenta.id,
      linea.id,
      { cantidad: '1', motivoBajaId: motivoNoElaboradoId },
      tokenEncargado,
    );
    expect(aceptado.status).toBe(201);
  });

  it('anula parcial (1 de una línea 3/3): baja cantidad y cantidad_enviada, y el aviso aparece en `anulaciones`', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '3' }]);
    await despachar(cuenta.id);

    const res = await anular(
      cuenta.id,
      (await detalleCuenta(cuenta.id)).lineas.find((l) => l.itemId === platoId)!
        .id,
      { cantidad: '1', motivoBajaId: motivoCortesiaId },
    );
    expect(res.status).toBe(201);

    const detalle = res.body as CuentaDetalle;
    const lineaRestante = detalle.lineas.find((l) => l.itemId === platoId)!;
    expect(Number(lineaRestante.cantidad)).toBe(2);
    expect(Number(lineaRestante.cantidadEnviada)).toBe(2);
    expect(detalle.anulaciones).toHaveLength(1);
    expect(detalle.anulaciones[0]).toMatchObject({
      // El id del ítem, para que el frontend resuelva su unidad contra el
      // catálogo y formatee la cantidad fraccionaria (fix round 1, 2026-09-17:
      // sin esto una anulación de 0,3 kg se leía "0" en pantalla).
      itemId: platoId,
      cantidad: expect.stringMatching(/^1(\.0+)?$/),
      motivoNombre: expect.any(String),
      motivoTipo: 'cortesia',
      // El nombre para mostrar (usuarios.nombre), no el identificador de
      // login (nombre_usuario = 'encargado.salon') — ronda de fixes 1,
      // domain I3 / security M-1.
      autorizadoPorNombre: 'Encargado',
    });
    expect(detalle.anulaciones[0].itemNombre).toContain('Lomo');
  });

  it('anula el total de una línea que NO es la única: la cuenta sigue abierta y la línea desaparece', async () => {
    const cuenta = await abrirCuentaCon([
      { itemId: platoId, cantidad: '2' },
      { itemId: guarnicionId, cantidad: '1' },
    ]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '2',
      motivoBajaId: motivoNoElaboradoId,
    });
    expect(res.status).toBe(201);

    const detalle = res.body as CuentaDetalle;
    expect(detalle.estado).toBe('abierta');
    expect(detalle.lineas.some((l) => l.itemId === platoId)).toBe(false);
    expect(detalle.lineas.some((l) => l.itemId === guarnicionId)).toBe(true);
    expect(detalle.anulaciones).toHaveLength(1);
    expect(detalle.anulaciones[0]).toMatchObject({
      itemNombre: expect.stringContaining('Lomo'),
      cantidad: expect.stringMatching(/^2(\.0+)?$/),
      motivoNombre: expect.any(String),
      motivoTipo: 'no_elaborado',
      // Nombre para mostrar, no el login (ver el test de arriba).
      autorizadoPorNombre: 'Encargado',
    });
  });

  it('cortesía sobre un producto con stock: descuenta exactamente lo anulado y el movimiento queda enlazado', async () => {
    const antes = await stockVendibleDe(platoId);
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '2' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(201);
    const detalle = res.body as CuentaDetalle;
    const anulacionId = detalle.anulaciones.find((a) =>
      a.itemNombre.includes('Lomo'),
    )!.id;

    const despues = await stockVendibleDe(platoId);
    expect(parseFloat(despues)).toBeCloseTo(parseFloat(antes) - 1, 4);

    const mov: {
      motivo: string;
      motivo_baja_id: string;
      cuenta_linea_anulacion_id: string;
    }[] = await ds.query(
      `SELECT motivo, motivo_baja_id, cuenta_linea_anulacion_id
         FROM movimientos_inventario
        WHERE cuenta_linea_anulacion_id = $1`,
      [anulacionId],
    );
    expect(mov).toHaveLength(1);
    expect(mov[0].motivo).toBe('merma');
    expect(mov[0].motivo_baja_id).toBe(motivoCortesiaId);
    expect(mov[0].cuenta_linea_anulacion_id).toBe(anulacionId);
  });

  it('no_elaborado: el stock no se mueve, porque ese plato nunca salió', async () => {
    const antes = await stockVendibleDe(platoId);
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoNoElaboradoId,
    });
    expect(res.status).toBe(201);
    const anulacionId = (res.body as CuentaDetalle).anulaciones.find((a) =>
      a.itemNombre.includes('Lomo'),
    )!.id;

    const despues = await stockVendibleDe(platoId);
    expect(despues).toBe(antes);

    const mov: unknown[] = await ds.query(
      `SELECT 1 FROM movimientos_inventario WHERE cuenta_linea_anulacion_id = $1`,
      [anulacionId],
    );
    expect(mov).toHaveLength(0);
  });

  it('el total cobrado al cerrar baja exactamente lo anulado', async () => {
    // Cuenta A: pide 3, se despachan las 3, se anula 1 → paga por 2.
    const cuentaA = await abrirCuentaCon([{ itemId: platoId, cantidad: '3' }]);
    await despachar(cuentaA.id);
    const lineaA = (await detalleCuenta(cuentaA.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;
    await anular(cuentaA.id, lineaA.id, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
    }).then((r) => expect(r.status).toBe(201));

    // Cuenta B: pide 2 directo, sin anular nada. Mismo cobro esperado.
    const cuentaB = await abrirCuentaCon([{ itemId: platoId, cantidad: '2' }]);

    const [cierreA, cierreB] = await Promise.all([
      cerrarSinCobrar(cuentaA.id),
      cerrarSinCobrar(cuentaB.id),
    ]);
    const [ventaA, ventaB] = await Promise.all([
      ventaDetalle(cierreA.ventaId),
      ventaDetalle(cierreB.ventaId),
    ]);

    expect(ventaA.totalFinal).toBe(ventaB.totalFinal);
  });

  it('anular lo último deja la cuenta cancelada, sin venta, y la mesa libre en el listado de operación', async () => {
    // Mesa PROPIA de este test, no la compartida por el resto de la suite: el
    // resto deja sus cuentas abiertas a propósito (las usan tests
    // posteriores), así que solo una mesa dedicada permite afirmar "sin
    // ninguna cuenta abierta" sin depender del orden de ejecución.
    const marca = Date.now();
    const salonPropioId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón anular-último E2E ${marca}`,
      })
    ).id;
    const mesaPropiaId = (
      await post<IdResponse>(`/api/salones/${salonPropioId}/mesas`, {
        nombre: 'Mesa anular-último',
      })
    ).id;

    const cuenta = await abrirCuentaCon(
      [{ itemId: platoId, cantidad: '1' }],
      mesaPropiaId,
    );
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id, mesaPropiaId)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(201);

    const detalle = res.body as CuentaDetalle;
    expect(detalle.estado).toBe('cancelada');
    expect(detalle.ventaId).toBeNull();
    expect(detalle.lineas).toHaveLength(0);
    expect(detalle.anulaciones).toHaveLength(1);

    // La mesa queda libre de verdad: el listado que usa la pantalla de
    // operación (`GET /mesas/:id/cuentas`, filtra `estado = 'abierta'`) ya no
    // muestra ninguna cuenta — no solo que ESTA quedó cancelada.
    const listado = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaPropiaId}/cuentas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(listado.status).toBe(200);
    expect(listado.body as CuentaDetalle[]).toEqual([]);
  });

  it('un producto borrado del catálogo: la anulación pasa y descuenta su stock', async () => {
    const marca = Date.now();
    const descartableId = (
      await post<IdResponse>('/api/items', {
        nombre: `Descartable anular E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '50',
        costo: '100',
        categoriaId: catCocinaId,
      })
    ).id;

    const cuenta = await abrirCuentaCon([
      { itemId: descartableId, cantidad: '1' },
    ]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === descartableId,
    )!;

    // ⚠️ El borrado se fuerza por SQL directo y no por `DELETE /items/:id`:
    // `ItemsService.obtenerUsoItem` bloquea ese endpoint mientras el ítem siga
    // referenciado por una línea VIVA de una cuenta ABIERTA (la cláusula
    // `'cuenta'` de `items.service.ts`), así que hoy no hay un camino de API
    // para llegar al estado que describe la spec —"un ítem se borró con la
    // cuenta ya abierta"— sin salir primero de la cuenta. Lo que este test
    // verifica es el comportamiento de `anularLinea` ANTE ese estado (ya
    // cubierto a nivel unitario con el SQL mockeado), no el camino completo
    // para producirlo; ese hueco —¿cómo se llega hoy a un `itemEliminado` en
    // una cuenta abierta?— queda anotado para el owner, no corregido acá.
    await ds.query(`UPDATE items SET eliminado_el = NOW() WHERE item_id = $1`, [
      descartableId,
    ]);

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(201);
    const anulacionId = (res.body as CuentaDetalle).anulaciones.find((a) =>
      a.itemNombre.includes('Descartable'),
    )!.id;

    const mov: { motivo: string; item_id: string }[] = await ds.query(
      `SELECT motivo, item_id FROM movimientos_inventario
        WHERE cuenta_linea_anulacion_id = $1`,
      [anulacionId],
    );
    expect(mov).toHaveLength(1);
    expect(mov[0].motivo).toBe('merma');
    expect(mov[0].item_id).toBe(descartableId);
  });

  /**
   * Ronda de fixes 1 (security I-1 / domain Minor 1): las tres columnas que
   * esto mueve son `numeric(18,4)`. Sin el guard de escala, "0.00005" pasa el
   * tope (`<= cantidad_enviada` en una línea 1/1), Postgres la redondea a
   * "0.0001" al guardar y la resta nunca baja la línea a cero — se podría
   * repetir sin límite. Acá se prueba en la API real: 400, y NINGUNA fila
   * nueva en `cuenta_linea_anulaciones`.
   */
  it('cantidad con más de 4 decimales: 400 y no escribe ninguna anulación', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const antes: { cnt: string }[] = await ds.query(
      `SELECT COUNT(*)::text AS cnt FROM cuenta_linea_anulaciones WHERE cuenta_id = $1`,
      [cuenta.id],
    );

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '0.00005',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'La cantidad admite como máximo 4 decimales.',
    );

    const despues: { cnt: string }[] = await ds.query(
      `SELECT COUNT(*)::text AS cnt FROM cuenta_linea_anulaciones WHERE cuenta_id = $1`,
      [cuenta.id],
    );
    expect(despues[0].cnt).toBe(antes[0].cnt);
  });

  /**
   * Ronda de fixes 2: el nombre anterior de este test ("una línea de OTRO
   * tenant da 404") era engañoso — pasaba por el `cuenta_id` que no
   * calzaba, no por el filtro de tenant: la línea ajena vivía bajo una
   * cuenta DISTINTA de `cuenta.id`, así que el `WHERE cuenta_id = $cuentaId`
   * ya la descartaba sin que `tenant_id` hiciera nada. Cero SQL directo acá:
   * dos cuentas reales de ESTE tenant alcanzan para probar que `lineaId` no
   * cruza de una cuenta a otra. El ataque de tenant de verdad es el test de
   * abajo.
   */
  it('una línea de OTRA cuenta da 404, aunque la cuenta destino sea válida', async () => {
    const cuentaA = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuentaA.id);
    const cuentaB = await abrirCuentaCon([
      { itemId: guarnicionId, cantidad: '1' },
    ]);
    await despachar(cuentaB.id);
    const lineaDeB = (await detalleCuenta(cuentaB.id)).lineas.find(
      (l) => l.itemId === guarnicionId,
    )!;

    // lineaDeB.cuentaId = cuentaB.id, no cuentaA.id: el WHERE de tres campos
    // (id, tenantId, cuentaId) tiene que rechazarla.
    const res = await anular(cuentaA.id, lineaDeB.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(404);
  });

  /**
   * El ataque real de aislamiento (ronda de fixes 2, § 5): una cuenta Y una
   * línea que existen de verdad, las DOS en OTRO tenant (Demo Bodega), pedidas
   * con el token de ESTE tenant. El corte pasa por `getCuentaAbiertaConLock`
   * —el primer `findOne` de `escribirAnulacionDeLinea`, que filtra
   * `{ id, tenantId }`—, no por una casualidad de ids que no calzan.
   *
   * Se construye por SQL directo (salón → mesa → cuenta → línea, los cuatro
   * en `OTRO_TENANT`) porque no hay ningún camino de API para crear un
   * recurso en un tenant al que no pertenece este token — mismo criterio que
   * `items-pausados.e2e-spec.ts` con `terceros`. La cuenta ajena se registra
   * en `cuentaAjenaId` para que el `afterAll` la cierre: no puede quedar
   * abierta en un tenant que no es el de esta suite.
   */
  it('una CUENTA y una LÍNEA de OTRO tenant dan 404 (getCuentaAbiertaConLock, no una casualidad de ids)', async () => {
    const OTRO_TENANT = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega
    const marca = Date.now();

    const filas: { cuenta_id: string; cuenta_linea_id: string }[] =
      await ds.query(
        `WITH s AS (
           INSERT INTO salones (tenant_id, nombre) VALUES ($1, $2)
           RETURNING salon_id
         ), m AS (
           INSERT INTO mesas (tenant_id, salon_id, nombre)
           SELECT $1, salon_id, $2 FROM s
           RETURNING mesa_id
         ), c AS (
           INSERT INTO cuentas (tenant_id, mesa_id, numero, estado)
           SELECT $1, mesa_id, 1, 'abierta' FROM m
           RETURNING cuenta_id
         ), cl AS (
           INSERT INTO cuenta_lineas (
             tenant_id, cuenta_id, item_id, cantidad, cantidad_enviada,
             precio_unitario, precio_unitario_origen, tasa_cambio, reglas_congeladas
           )
           SELECT $1, cuenta_id, $3, '1', '1', '1000', '1000', '1', '{}'::jsonb FROM c
           RETURNING cuenta_linea_id
         )
         SELECT c.cuenta_id, cl.cuenta_linea_id FROM c, cl`,
        [OTRO_TENANT, `Ajeno anular E2E ${marca}`, platoId],
      );
    const cuentaAjena = filas[0].cuenta_id;
    const lineaAjena = filas[0].cuenta_linea_id;
    cuentaAjenaId = cuentaAjena;

    const res = await anular(cuentaAjena, lineaAjena, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(404);
    // El mensaje EXACTO de `getCuentaAbiertaConLock` (no un `toContain('no
    // encontrada')` genérico, que también matchearía el 404 de la línea): la
    // cuenta ajena tiene que rebotar ACÁ, primero, antes de llegar siquiera a
    // mirar la línea.
    expect((res.body as { message: string }).message).toBe(
      `Cuenta ${cuentaAjena} no encontrada`,
    );

    // `cancelar-con-motivo` pasa por el mismo `getCuentaAbiertaConLock`: la
    // cuenta ajena rebota igual y sigue abierta en su tenant.
    const cancelada = await cancelarConMotivo(cuentaAjena, {
      motivoBajaId: motivoCortesiaId,
    });
    expect(cancelada.status).toBe(404);
    expect((cancelada.body as { message: string }).message).toBe(
      `Cuenta ${cuentaAjena} no encontrada`,
    );
    const estado: { estado: string }[] = await ds.query(
      `SELECT estado FROM cuentas WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
      [cuentaAjena],
    );
    expect(estado[0].estado).toBe('abierta');
  });

  it('un motivoBajaId de OTRO tenant da 400 (motivo no válido)', async () => {
    const OTRO_TENANT = '550e8400-e29b-41d4-a716-446655440040'; // Demo Bodega
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const filas: { motivo_baja_id: string }[] = await ds.query(
      `INSERT INTO motivo_baja (tenant_id, nombre, activo, es_fijo, tipo)
       VALUES ($1, $2, true, false, 'merma')
       RETURNING motivo_baja_id`,
      [OTRO_TENANT, `Motivo ajeno E2E ${Date.now()}`],
    );
    const motivoAjenoId = filas[0].motivo_baja_id;

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoAjenoId,
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'Motivo de baja no válido',
    );
  });

  it('un motivo inactivo da 400', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    const motivoInactivo = await post<{ id: string }>('/api/motivos-baja', {
      nombre: `Motivo inactivo E2E ${Date.now()}`,
      tipo: 'cortesia',
      activo: false,
    });

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoInactivo.id,
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'Motivo de baja no válido',
    );
  });

  /**
   * El caso REAL de "ítem no vendible" — el borrado de más arriba se fuerza
   * por SQL porque no hay camino de API; pausar SÍ lo hay
   * (`PATCH /items/:id` con `activo: false`), y es justo lo que
   * `getItemVendibleOrThrow` bloquearía en `actualizarLinea`. Acá no debe
   * bloquear nada (spec § 4.2).
   */
  it('un ítem PAUSADO (activo=false) igual se puede anular y descuenta stock', async () => {
    const marca = Date.now();
    const pausadoId = (
      await post<IdResponse>('/api/items', {
        nombre: `Pausable anular E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '50',
        costo: '100',
        categoriaId: catCocinaId,
      })
    ).id;
    const antes = await stockVendibleDe(pausadoId);

    const cuenta = await abrirCuentaCon([{ itemId: pausadoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === pausadoId,
    )!;

    const pausado = await request(app.getHttpServer())
      .patch(`/api/items/${pausadoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(pausado.status).toBe(200);

    // Confirma la premisa del test contra la API real, no solo el 200 del
    // PATCH: el ítem tiene que estar realmente pausado antes de anular.
    const itemPausado = await request(app.getHttpServer())
      .get(`/api/items/${pausadoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(itemPausado.status).toBe(200);
    expect((itemPausado.body as ItemDetalle).activo).toBe(false);

    const res = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    expect(res.status).toBe(201);

    const despues = await stockVendibleDe(pausadoId);
    expect(parseFloat(despues)).toBeCloseTo(parseFloat(antes) - 1, 4);
  });

  /**
   * Ronda de fixes 1 (domain Minor 4, promovido): la parte 1 dice que "en uso"
   * también cuenta las anulaciones (spec motivos-de-baja-con-tipo § 4.3).
   * `no_elaborado` a propósito: NO descuenta stock, así que no queda ningún
   * movimiento en `movimientos_inventario` con este motivo — lo único que lo
   * usa es la fila de `cuenta_linea_anulaciones`. Si el 400 de abajo pasara
   * igual con un motivo `cortesia`/`merma`, no probaría nada: el chequeo viejo
   * (solo sobre `movimientos_inventario`) ya bloquea esos casos porque la
   * anulación TAMBIÉN mueve stock con ese motivo. Este test aísla la fuente
   * nueva.
   */
  it('un motivo propio usado SOLO en una anulación no_elaborado (sin kardex): no se puede borrar ni cambiarle el tipo', async () => {
    const motivoPropio = await post<{ id: string }>('/api/motivos-baja', {
      nombre: `Motivo en uso por anulación E2E ${Date.now()}`,
      tipo: 'no_elaborado',
    });

    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
    await despachar(cuenta.id);
    const linea = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;
    const anulado = await anular(cuenta.id, linea.id, {
      cantidad: '1',
      motivoBajaId: motivoPropio.id,
    });
    expect(anulado.status).toBe(201);

    // Confirma la premisa: `no_elaborado` no mueve stock, así que ningún
    // movimiento del kardex referencia este motivo.
    const movimientos: unknown[] = await ds.query(
      `SELECT 1 FROM movimientos_inventario
        WHERE motivo_baja_id = $1 AND eliminado_el IS NULL`,
      [motivoPropio.id],
    );
    expect(movimientos).toHaveLength(0);

    const borrado = await request(app.getHttpServer())
      .delete(`/api/motivos-baja/${motivoPropio.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(borrado.status).toBe(400);

    const cambioTipo = await request(app.getHttpServer())
      .patch(`/api/motivos-baja/${motivoPropio.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tipo: 'merma' });
    expect(cambioTipo.status).toBe(400);
  });

  /**
   * `POST /cuentas/:id/cancelar-con-motivo` (spec § 6): cancela una cuenta con
   * algo despachado, con permiso y motivo — la Task 4 del mismo frente.
   */
  describe('cancelar-con-motivo', () => {
    it('sin Anular da 403; con Anular cancela la cuenta, sin líneas vivas, y sus anulaciones persisten', async () => {
      const cuenta = await abrirCuentaCon([
        { itemId: platoId, cantidad: '2' },
        { itemId: guarnicionId, cantidad: '1' },
      ]);
      await despachar(cuenta.id);

      const rechazado = await cancelarConMotivo(
        cuenta.id,
        { motivoBajaId: motivoCortesiaId },
        tokenSoloOperar,
      );
      expect(rechazado.status).toBe(403);

      const res = await cancelarConMotivo(cuenta.id, {
        motivoBajaId: motivoCortesiaId,
      });
      expect(res.status).toBe(201);

      const detalle = res.body as CuentaDetalle;
      expect(detalle.estado).toBe('cancelada');
      expect(detalle.ventaId).toBeNull();
      expect(detalle.lineas).toHaveLength(0);
      // Una anulación por línea despachada, cada una por lo que esa línea
      // tenía enviado (2 y 1), no por un total fusionado.
      expect(detalle.anulaciones).toHaveLength(2);
      const cantidades = detalle.anulaciones
        .map((a) => Number(a.cantidad))
        .sort((a, b) => a - b);
      expect(cantidades).toEqual([1, 2]);
      expect(
        detalle.anulaciones.every((a) => a.motivoTipo === 'cortesia'),
      ).toBe(true);

      // La mesa queda libre de verdad.
      const listado = await request(app.getHttpServer())
        .get(`/api/mesas/${mesaId}/cuentas`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(listado.status).toBe(200);
      expect(
        (listado.body as CuentaDetalle[]).some((c) => c.id === cuenta.id),
      ).toBe(false);
    });

    it('una línea parcialmente despachada (3 pedidas, 1 enviada): anula y descuenta solo lo despachado, y la cuenta queda cancelada igual', async () => {
      const antes = await stockVendibleDe(platoId);

      // 1 pedida y despachada…
      const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
      await despachar(cuenta.id);
      // …y 2 más del mismo ítem, agregadas DESPUÉS de despachar: el merge de
      // `agregarLinea` solo suma `cantidad`, nunca `cantidad_enviada`, así que
      // la línea queda 3 pedidas / 1 despachada — el mismo escenario 3/1 que
      // prueba el unitario, acá contra la API real.
      await post(`/api/cuentas/${cuenta.id}/lineas`, {
        itemId: platoId,
        cantidad: '2',
      });
      const linea = (await detalleCuenta(cuenta.id)).lineas.find(
        (l) => l.itemId === platoId,
      )!;
      expect(linea.cantidad).toBe('3.0000');
      expect(linea.cantidadEnviada).toBe('1.0000');

      const res = await cancelarConMotivo(cuenta.id, {
        motivoBajaId: motivoMermaId,
      });
      expect(res.status).toBe(201);

      const detalle = res.body as CuentaDetalle;
      expect(detalle.estado).toBe('cancelada');
      expect(detalle.lineas).toHaveLength(0);
      expect(detalle.anulaciones).toHaveLength(1);
      expect(detalle.anulaciones[0].cantidad).toMatch(/^1(\.0+)?$/);

      // El stock bajó exactamente 1 (lo despachado), no 3 (lo pedido).
      const despues = await stockVendibleDe(platoId);
      expect(parseFloat(despues)).toBeCloseTo(parseFloat(antes) - 1, 4);

      const anulacionId = detalle.anulaciones[0].id;
      const mov: { motivo: string; motivo_baja_id: string }[] = await ds.query(
        `SELECT motivo, motivo_baja_id FROM movimientos_inventario
            WHERE cuenta_linea_anulacion_id = $1`,
        [anulacionId],
      );
      expect(mov).toHaveLength(1);
      expect(mov[0].motivo).toBe('merma');
      expect(mov[0].motivo_baja_id).toBe(motivoMermaId);
    });

    it('no_elaborado: cancela y anula, pero no mueve stock — ese plato nunca salió', async () => {
      const antes = await stockVendibleDe(platoId);
      const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
      await despachar(cuenta.id);

      const res = await cancelarConMotivo(cuenta.id, {
        motivoBajaId: motivoNoElaboradoId,
      });
      expect(res.status).toBe(201);

      const detalle = res.body as CuentaDetalle;
      expect(detalle.estado).toBe('cancelada');
      expect(detalle.anulaciones).toHaveLength(1);
      expect(detalle.anulaciones[0].motivoTipo).toBe('no_elaborado');

      const despues = await stockVendibleDe(platoId);
      expect(despues).toBe(antes);

      const mov: unknown[] = await ds.query(
        `SELECT 1 FROM movimientos_inventario
          WHERE cuenta_linea_anulacion_id = $1`,
        [detalle.anulaciones[0].id],
      );
      expect(mov).toHaveLength(0);
    });

    it('sin nada despachado: 400, y manda a la ruta simple de cancelar', async () => {
      const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
      // Sin `despachar`: nada tiene `cantidad_enviada > 0`.

      const res = await cancelarConMotivo(cuenta.id, {
        motivoBajaId: motivoCortesiaId,
      });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(/cancelar/i);

      // La cuenta sigue abierta: el 400 no tocó nada.
      const detalle = await detalleCuenta(cuenta.id);
      expect(detalle.estado).toBe('abierta');
      expect(detalle.lineas).toHaveLength(1);
    });
  });

  /**
   * `POST /cuentas/:id/cancelar` (Task 6, spec § 6): la ruta simple, con
   * `Salones:Operar`, deja de servir de puerta de atrás para descartar algo
   * despachado sin motivo ni permiso `Anular`.
   */
  describe('cancelar (ruta simple, sin motivo)', () => {
    it('con algo despachado: 400, y manda a cancelar-con-motivo', async () => {
      const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
      await despachar(cuenta.id);

      const res = await cancelar(cuenta.id);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(
        /cancelar-con-motivo/,
      );

      // La cuenta sigue abierta y con su línea despachada intacta.
      const detalle = await detalleCuenta(cuenta.id);
      expect(detalle.estado).toBe('abierta');
      expect(detalle.lineas).toHaveLength(1);
      expect(detalle.lineas[0].cantidadEnviada).toBe('1.0000');
    });

    it('sin nada despachado: sigue cancelando, 200/201', async () => {
      const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '1' }]);
      // Sin `despachar`: la línea nunca llegó a cocina.

      const res = await cancelar(cuenta.id);
      expect([200, 201]).toContain(res.status);
      expect((res.body as CuentaDetalle).estado).toBe('cancelada');
    });
  });
});
