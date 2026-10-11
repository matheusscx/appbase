import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { randomUUID } from 'node:crypto';

/**
 * **Lo que el plato consumió se congela al pedirlo** (owner, 2026-09-29: B).
 *
 * Anular un plato con un motivo que descuenta, y cobrar la cuenta, consumen la
 * receta, los componentes, los extras y las opciones **de cuando se pidió**,
 * aunque el catálogo haya cambiado después. Hasta el 2026-10-11 los dos leían
 * la receta y el combo en vivo, y salteaban la opción borrada: la anulación
 * quedaba con un costo más bajo, y sin marca.
 *
 * Spec: `docs/superpowers/specs/2026-10-11-consumo-congelado-linea-cuenta-design.md`.
 *
 * Catálogo, garzón, salón, mesa y caja son PROPIOS de este archivo: la sesión
 * de garzón es única y varias suites la comparten.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };

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
interface CuentaDetalle {
  id: string;
  lineas: { id: string; itemId: string; cantidad: string }[];
  anulaciones: { id: string; itemId: string }[];
}
interface FilaReporte {
  id: string;
  costoEstado: string;
  costo: { monedaId: string; monto: string }[];
}

describe('Salones — el consumo del plato se congela al pedirlo (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let mesaId: string;
  let garzon: GarzonCreado;
  let cajaId: string;
  let catCocinaId: string;
  let motivoMermaId: string;
  let marca: number;
  let n = 0;

  async function enviar(
    metodo: 'post' | 'patch' | 'delete',
    url: string,
    body: Record<string, unknown> = {},
  ) {
    return request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await enviar('post', url, body);
    // El body en el mensaje: un 400 del fixture dice por qué sin re-correr.
    if (res.status !== esperado) {
      throw new Error(
        `POST ${url} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body as T;
  }

  async function editar(url: string, body: Record<string, unknown>) {
    const res = await enviar('patch', url, body);
    expect(res.status).toBe(200);
  }

  async function borrar(itemId: string) {
    const res = await enviar('delete', `/api/items/${itemId}`);
    expect(res.status).toBe(200);
  }

  /** Ingrediente con costo propio: el costo distingue qué se consumió. */
  async function ingrediente(
    nombre: string,
    costo: string,
    stock = '1000',
    tipo: 'ingrediente' | 'producto' = 'ingrediente',
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} congelado E2E ${marca}-${++n}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo,
        unidadMedida: 'unidad',
        stock,
        costo,
      })
    ).id;
  }

  const usa = (ingredienteItemId: string, cantidad: string) => ({
    ingredienteItemId,
    cantidad,
    unidadCodigo: 'unidad',
    bloqueante: true,
  });

  async function receta(
    nombre: string,
    ingredientes: ReturnType<typeof usa>[],
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: `${nombre} congelado E2E ${marca}-${++n}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        categoriaId: catCocinaId,
        ingredientes,
        ...extra,
      })
    ).id;
  }

  async function abrirCuenta(): Promise<string> {
    return (
      await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;
  }

  async function pedir(
    cuentaId: string,
    itemId: string,
    personalizacion?: Record<string, unknown>,
  ): Promise<CuentaDetalle> {
    return post<CuentaDetalle>(`/api/cuentas/${cuentaId}/lineas`, {
      itemId,
      cantidad: '1',
      ...(personalizacion ? { personalizacion } : {}),
    });
  }

  async function despachar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/comanda/reclamar`, {});
  }

  /** Anula la única línea del ítem, entera, como merma. Devuelve la anulación. */
  async function anularComoMerma(
    cuenta: CuentaDetalle,
    itemId: string,
  ): Promise<string> {
    const linea = cuenta.lineas.find((l) => l.itemId === itemId)!;
    const detalle = await post<CuentaDetalle>(
      `/api/cuentas/${cuenta.id}/lineas/${linea.id}/anular`,
      { cantidad: linea.cantidad, motivoBajaId: motivoMermaId },
    );
    return detalle.anulaciones.find((a) => a.itemId === itemId)!.id;
  }

  /** Lo que el kardex sacó por una anulación o una venta, por ítem. */
  async function salidas(
    columna: 'cuenta_linea_anulacion_id' | 'venta_id',
    id: string,
  ): Promise<Record<string, string>> {
    const filas: { item_id: string; cantidad: string }[] = await ds.query(
      `SELECT item_id, SUM(cantidad)::numeric(18,4)::text AS cantidad
         FROM movimientos_inventario
        WHERE ${columna} = $1 AND tipo = 'salida' AND eliminado_el IS NULL
        GROUP BY item_id`,
      [id],
    );
    return Object.fromEntries(filas.map((f) => [f.item_id, f.cantidad]));
  }

  async function filaReporte(anulacionId: string): Promise<FilaReporte> {
    const res = await request(app.getHttpServer())
      .get(`/api/salones/anulaciones?pageSize=50&garzonId=${garzon.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fila = (res.body as { data: FilaReporte[] }).data.find(
      (f) => f.id === anulacionId,
    );
    expect(fila).toBeDefined();
    return fila!;
  }

  async function cerrar(cuentaId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin, pagos: [] });
    expect(res.status).toBe(201);
    return (res.body as { ventaId: string }).ventaId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.pass });
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
    token = (enTenant.body as TokenResponse).access_token;

    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    motivoMermaId = (motivos.body as { id: string; tipo: string }[]).find(
      (m) => m.tipo === 'merma',
    )!.id;

    marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamar` no avanza `cantidadEnviada` y
    // no habría nada despachado que anular.
    const cocinaId = (
      await post<IdResponse>('/api/impresoras', {
        nombre: `Cocina congelado E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-congelado-e2e-${marca}`,
      })
    ).id;
    catCocinaId = (
      await post<IdResponse>('/api/categorias', {
        nombre: `Cocina congelado E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón congelado consumo E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón consumo congelado E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa consumo congelado',
      })
    ).id;

    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${token}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    expect(cajonId).toBeTruthy();
    cajaId = (
      await post<IdResponse>('/api/caja/abrir', {
        cajonId,
        saldoInicial: '0.0000',
        comentario: 'Apertura E2E consumo congelado',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    const limpiar = async (que: string, ejecutar: () => Promise<number>) => {
      try {
        const status = await ejecutar();
        if (![200, 201].includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };
    try {
      await limpiar(
        'cerrar sesión del garzón',
        async () =>
          (
            await enviar('post', '/api/sesiones-garzon/cerrar', {
              garzonId: garzon.id,
              pin: garzon.pin,
            })
          ).status,
      );
      await limpiar('cerrar caja', async () => {
        const conteo = await enviar('post', `/api/caja/${cajaId}/conteo`, {
          lineas: [{ metodoPagoId: null, montoContado: '0' }],
        });
        if (![200, 201].includes(conteo.status)) return conteo.status;
        if ((conteo.body as { estado?: string }).estado !== 'en_conciliacion') {
          return 200;
        }
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${token}`);
        // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        return (
          await enviar('post', `/api/caja/${cajaId}/cerrar`, {
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

  it('un extra pedido por una mesa abierta no se puede borrar: la escena "extra borrado" no se alcanza', async () => {
    // La entrada del backlog decía que el extra se borraba en un paso. Medido el
    // 2026-10-11: la rama `'cuenta'` de `obtenerUsoItem` lo bloquea mientras la
    // línea siga en una cuenta abierta, que es todo el tiempo en que se puede
    // anular. Sacarlo de la lista de extras de la receta no cambia nada: el
    // extra viaja en el snapshot de la línea.
    const base = await ingrediente('Arroz extra', '100');
    const champinon = await ingrediente('Champiñón extra', '300');
    const risotto = await receta('Risotto extra', [usa(base, '1')], {
      extrasPermitidos: [
        {
          ingredienteItemId: champinon,
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '500',
        },
      ],
    });
    const cuentaId = await abrirCuenta();
    const cuenta = await pedir(cuentaId, risotto, {
      omitidos: [],
      extras: [{ ingredienteItemId: champinon, unidades: 1 }],
    });
    await despachar(cuentaId);
    await editar(`/api/items/${risotto}`, { extrasPermitidos: [] });

    const res = await enviar('delete', `/api/items/${champinon}`);
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'está pedido en',
    );

    const anulacionId = await anularComoMerma(cuenta, risotto);
    expect(await salidas('cuenta_linea_anulacion_id', anulacionId)).toEqual({
      [base]: '1.0000',
      [champinon]: '1.0000',
    });
  });

  it('la opción de grupo que se sacó del grupo y se borró se descuenta al anular, y el reporte da el costo completo', async () => {
    const arroz = await ingrediente('Arroz opción', '100');
    const salsa = await ingrediente('Salsa opción', '700');
    const otra = await ingrediente('Otra salsa opción', '50');
    const { grupoModificadorId: grupoId } = await post<{
      grupoModificadorId: string;
    }>('/api/grupos-modificadores', {
      nombre: `Salsas congelado E2E ${marca}-${++n}`,
      opciones: [
        {
          itemId: salsa,
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '0',
        },
        {
          itemId: otra,
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '0',
        },
      ],
    });
    const risotto = await receta('Risotto opción', [usa(arroz, '1')], {
      gruposModificadores: [{ grupoModificadorId: grupoId, min: 1, max: 1 }],
    });
    const cuentaId = await abrirCuenta();
    const cuenta = await pedir(cuentaId, risotto, {
      omitidos: [],
      extras: [],
      grupos: [{ grupoId, opciones: [{ itemId: salsa, unidades: 1 }] }],
    });
    await despachar(cuentaId);

    await editar(`/api/grupos-modificadores/${grupoId}`, {
      opciones: [
        {
          itemId: otra,
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '0',
        },
      ],
    });
    await borrar(salsa);

    const anulacionId = await anularComoMerma(cuenta, risotto);
    expect(await salidas('cuenta_linea_anulacion_id', anulacionId)).toEqual({
      [arroz]: '1.0000',
      [salsa]: '1.0000',
    });
    const fila = await filaReporte(anulacionId);
    expect(fila.costoEstado).toBe('valorizado');
    // 1 × 100 de arroz + 1 × 700 de la salsa borrada.
    expect(fila.costo).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '800.0000' },
    ]);
  });

  it('una receta editada después de pedir: la anulación consume la receta pedida, no la de hoy', async () => {
    const arborio = await ingrediente('Arborio', '400');
    const grado1 = await ingrediente('Grado 1', '90');
    const risotto = await receta('Risotto editado', [usa(arborio, '2')]);
    const cuentaId = await abrirCuenta();
    const cuenta = await pedir(cuentaId, risotto);
    await despachar(cuentaId);

    await editar(`/api/items/${risotto}`, {
      ingredientes: [usa(grado1, '3')],
    });

    const anulacionId = await anularComoMerma(cuenta, risotto);
    expect(await salidas('cuenta_linea_anulacion_id', anulacionId)).toEqual({
      [arborio]: '2.0000',
    });
    const fila = await filaReporte(anulacionId);
    expect(fila.costo).toEqual([
      { monedaId: CLP_MONEDA_ID, monto: '800.0000' },
    ]);
  });

  it('un combo editado después de pedir: la anulación consume el componente pedido', async () => {
    // Productos: un combo no acepta ingredientes como componente.
    const papas = await ingrediente('Papas combo', '200', '1000', 'producto');
    const ensalada = await ingrediente(
      'Ensalada combo',
      '150',
      '1000',
      'producto',
    );
    const combo = (
      await post<IdResponse>('/api/items', {
        nombre: `Combo editado congelado E2E ${marca}-${++n}`,
        precioBase: '8000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        categoriaId: catCocinaId,
        componentes: [
          { componenteItemId: papas, cantidad: '1', bloqueante: true },
        ],
      })
    ).id;
    const cuentaId = await abrirCuenta();
    const cuenta = await pedir(cuentaId, combo);
    await despachar(cuentaId);

    await editar(`/api/items/${combo}`, {
      componentes: [
        { componenteItemId: ensalada, cantidad: '1', bloqueante: true },
      ],
    });

    const anulacionId = await anularComoMerma(cuenta, combo);
    expect(await salidas('cuenta_linea_anulacion_id', anulacionId)).toEqual({
      [papas]: '1.0000',
    });
  });

  it('al cobrar, la venta descuenta la receta pedida, aunque un ingrediente se haya sacado de la receta y borrado', async () => {
    const arborio = await ingrediente('Arborio cobro', '400');
    const caldo = await ingrediente('Caldo cobro', '60');
    const risotto = await receta('Risotto cobro', [
      usa(arborio, '1'),
      usa(caldo, '2'),
    ]);
    const cuentaId = await abrirCuenta();
    await pedir(cuentaId, risotto);

    await editar(`/api/items/${risotto}`, { ingredientes: [usa(caldo, '2')] });
    await borrar(arborio);

    const ventaId = await cerrar(cuentaId);
    expect(await salidas('venta_id', ventaId)).toEqual({
      [arborio]: '1.0000',
      [caldo]: '2.0000',
    });
  });

  it('en el POS, un producto borrado sigue sin poder venderse', async () => {
    const producto = (
      await post<IdResponse>('/api/items', {
        nombre: `Producto borrado POS congelado E2E ${marca}-${++n}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '100',
      })
    ).id;
    await borrar(producto);

    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId: producto, cantidad: '1' }], pagos: [] });
    // El POS lo rechaza antes de tocar stock: la marca que deja salir un
    // borrado por `venta` (`consumoDePlatoPedido`) no se alcanza desde acá. El
    // guard del chokepoint lo cubre `inventario.service.spec.ts`.
    expect(res.status).toBe(404);
    expect((res.body as { message: string }).message).toBe(
      'Item no encontrado',
    );
    const [{ salidas: cuantas }]: { salidas: string }[] = await ds.query(
      `SELECT COUNT(*)::text AS salidas FROM movimientos_inventario
        WHERE item_id = $1 AND tipo = 'salida'`,
      [producto],
    );
    expect(cuantas).toBe('0');
  });

  it('pedir el mismo plato antes y después de editar su receta da dos líneas, no una de cantidad 2', async () => {
    const arborio = await ingrediente('Arborio líneas', '400');
    const grado1 = await ingrediente('Grado 1 líneas', '90');
    const risotto = await receta('Risotto líneas', [usa(arborio, '1')]);
    const cuentaId = await abrirCuenta();
    await pedir(cuentaId, risotto);
    await editar(`/api/items/${risotto}`, { ingredientes: [usa(grado1, '1')] });
    const cuenta = await pedir(cuentaId, risotto);

    const lineas = cuenta.lineas.filter((l) => l.itemId === risotto);
    expect(lineas.map((l) => l.cantidad)).toEqual(['1.0000', '1.0000']);
    // Y cada una se cobra con lo suyo.
    const ventaId = await cerrar(cuentaId);
    expect(await salidas('venta_id', ventaId)).toEqual({
      [arborio]: '1.0000',
      [grado1]: '1.0000',
    });
  });

  it('fusionar dos cuentas tampoco junta el mismo plato con consumos congelados distintos', async () => {
    // La otra puerta del mismo merge: `fusionarCuentas` arma su propia clave, y
    // el criterio tiene que moverse junto con el de `agregarLinea`.
    const arborio = await ingrediente('Arborio fusión', '400');
    const grado1 = await ingrediente('Grado 1 fusión', '90');
    const risotto = await receta('Risotto fusión', [usa(arborio, '1')]);
    const cuentaA = await abrirCuenta();
    await pedir(cuentaA, risotto);
    await editar(`/api/items/${risotto}`, { ingredientes: [usa(grado1, '1')] });
    const cuentaB = await abrirCuenta();
    await pedir(cuentaB, risotto);

    const fusionada = await post<CuentaDetalle>(
      `/api/mesas/${mesaId}/cuentas/fusionar`,
      { cuentaIds: [cuentaA, cuentaB] },
    );
    expect(
      fusionada.lineas
        .filter((l) => l.itemId === risotto)
        .map((l) => l.cantidad),
    ).toEqual(['1.0000', '1.0000']);

    await post(`/api/cuentas/${fusionada.id}/cancelar`, {});
  });

  it('lo que reserva una mesa abierta es lo congelado: la receta editada no libera el ingrediente pedido', async () => {
    // El único arborio que hay ya lo pidió la mesa. Editar la receta no lo
    // devuelve: esa mesa lo va a consumir al cobrar, así que otro plato que lo
    // pide tiene que rebotar.
    const arborio = await ingrediente('Arborio reserva', '400', '1');
    const grado1 = await ingrediente('Grado 1 reserva', '90');
    const risotto = await receta('Risotto reserva', [usa(arborio, '1')]);
    const otroPlato = await receta('Otro plato reserva', [usa(arborio, '1')]);
    const cuentaId = await abrirCuenta();
    await pedir(cuentaId, risotto);
    await editar(`/api/items/${risotto}`, { ingredientes: [usa(grado1, '1')] });

    const res = await enviar('post', `/api/cuentas/${cuentaId}/lineas`, {
      itemId: otroPlato,
      cantidad: '1',
    });
    expect(res.status).toBe(400);

    await post(`/api/cuentas/${cuentaId}/cancelar`, {});
  });
});
