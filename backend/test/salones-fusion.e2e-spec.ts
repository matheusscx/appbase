import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Turno del seed. El garzón, en cambio, lo crea el spec: ver el comentario del
// `beforeAll`.
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  /** El PIN se genera en el backend y se devuelve **una sola vez**, acá. */
  pin: string;
}
interface LineaDetalle {
  id: string;
  itemId: string;
  cantidad: string;
  cantidadEnviada?: string;
  cantidadPresentacion?: string | null;
  unidadCodigoPresentacion?: string | null;
}
interface CuentaAnulacionDetalle {
  id: string;
  itemNombre: string;
  cantidad: string;
  motivoTipo: string;
}
interface CuentaDetalle {
  id: string;
  numero: number;
  estado: string;
  lineas: LineaDetalle[];
  anulaciones: CuentaAnulacionDetalle[];
}
interface MotivoBajaItem {
  id: string;
  tipo: string;
}

/**
 * Primer e2e de `POST /mesas/:id/cuentas/fusionar`.
 *
 * Existe porque hasta 2026-08-09 esa ruta **no tenía ninguno**: `grep fusionar
 * backend/test/` no devolvía nada, y el único test que recorría el camino
 * mockeaba `manager.query`, así que su SQL nunca llegaba a Postgres. No es
 * teórico: el 2026-08-07 un `SELECT` nuevo de esa ruta filtraba `eliminado_el`
 * sobre `item_producto`, que no tiene esa columna. Habría reventado la fusión
 * con un 500 sosteniendo el `pessimistic_write` de todas las cuentas de la mesa,
 * y el gate entero pasó en verde igual.
 *
 * Ese `SELECT` solo se emite **si alguna línea tiene presentación**, así que el
 * caso mínimo la lleva: un producto en `kg` cargado en dos cuentas con unidades
 * de presentación distintas.
 *
 * Fixtures propios (salón, mesa, ítems creados acá) y no del seed: una fusión
 * cancela cuentas y borra líneas, y el seeder no repara lo que una corrida
 * previa dejó movido.
 */
describe('Salones — fusionar cuentas (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let mesaId: string;
  let itemKgId: string;
  let itemOtroId: string;
  /** Ruteado a una impresora, para que `reclamar` avance `cantidadEnviada` y se pueda anular. */
  let itemAnulableId: string;
  let motivoId: string;
  let garzon: GarzonCreado;

  async function abrirCuenta(): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin });
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

  async function despachar(cuentaId: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/comanda/reclamar`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
  }

  async function agregarLinea(
    cuentaId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
  }

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

    const resSalon = await request(app.getHttpServer())
      .post('/api/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Salón fusión E2E ${Date.now()}` });
    expect(resSalon.status).toBe(201);

    const resMesa = await request(app.getHttpServer())
      .post(`/api/salones/${(resSalon.body as IdResponse).id}/mesas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Mesa fusión' });
    expect(resMesa.status).toBe(201);
    mesaId = (resMesa.body as IdResponse).id;

    // Unidad base `kg`: cargar 500 g deja canónico 0,5 y presentación 500 g.
    // Es lo que hace que la fusión tenga algo que reconvertir.
    const resItemKg = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto fusión kg E2E ${Date.now()}`,
        tipo: 'producto',
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'kg',
        // ⚠️ `stock` explícito desde el 2026-09-01: agregar una línea verifica
        // que quede stock (`ItemsService.validarStockAlPedir`), y sin carga
        // inicial el `POST` de línea rebota con 400.
        stock: '1000',
        costo: '100',
      });
    expect(resItemKg.status).toBe(201);
    itemKgId = (resItemKg.body as IdResponse).id;

    const resItemOtro = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto fusión suelto E2E ${Date.now()}`,
        tipo: 'producto',
        precioBase: '2500',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        // Ver el ⚠️ del ítem de arriba.
        stock: '1000',
        costo: '100',
      });
    expect(resItemOtro.status).toBe(201);
    itemOtroId = (resItemOtro.body as IdResponse).id;

    // Ruteo a cocina + ítem propio, para el test de fusión con anulaciones:
    // solo se puede anular lo YA despachado (`cantidad_enviada > 0`), y eso
    // necesita una categoría con impresora para que `reclamar` avance.
    const marca = Date.now();
    const resImpresora = await request(app.getHttpServer())
      .post('/api/impresoras')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Cocina fusión E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-fusion-e2e-${marca}`,
      });
    expect(resImpresora.status).toBe(201);
    const resCategoria = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Cocina fusión E2E ${marca}`,
        impresoraId: (resImpresora.body as IdResponse).id,
      });
    expect(resCategoria.status).toBe(201);
    const resItemAnulable = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto fusión anulable E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
        categoriaId: (resCategoria.body as IdResponse).id,
      });
    expect(resItemAnulable.status).toBe(201);
    itemAnulableId = (resItemAnulable.body as IdResponse).id;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    // `no_elaborado` a propósito: este test es sobre la anulación
    // SOBREVIVIENDO a la fusión, no sobre el descuento de stock (ya cubierto
    // en `salones-anular-linea.e2e-spec.ts`), así que no hace falta tocar
    // inventario acá.
    motivoId = (resMotivos.body as MotivoBajaItem[]).find(
      (m) => m.tipo === 'no_elaborado',
    )!.id;
    expect(motivoId).toBeTruthy();

    // ⚠️ Garzón PROPIO, no el del seed. La sesión es única por garzón y hoy
    // seis specs comparten a Ana, así que el estado se filtra de un spec al
    // siguiente: `jest-e2e.json` corre con `maxWorkers: 1`, y el que deja su
    // sesión abierta le rompe el `iniciar` al que viene con un 400 "ya tiene
    // una sesión abierta". Medido: `garzon-modo-personal` se cayó así al
    // sumarse el segundo spec de salones. Con garzón propio no hace falta
    // ningún cierre defensivo previo.
    const resGarzon = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Garzón fusión E2E ${Date.now()}` });
    expect(resGarzon.status).toBe(201);
    garzon = resGarzon.body as GarzonCreado;

    const resSesion = await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });
    expect(resSesion.status).toBe(201);
  }, 60000);

  afterAll(async () => {
    // El garzón es propio, así que dejar la sesión abierta no le cambiaría el
    // escenario a nadie. Se cierra igual: una sesión abierta para siempre es
    // ruido en el historial de turnos de la base de dev.
    //
    // El status se afirma **después** del `close`, que va en un `finally`: una
    // limpieza que falla en silencio es la que después aparece como un error
    // lejos de acá, y una que tira antes del cierre deja la app viva con su
    // `@Cron` pegándole a la base durante las suites siguientes. Ver
    // `docs/agent/pendientes.md` § 1.
    let cierre: number | string;
    try {
      cierre = (
        await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: garzon.id, pin: garzon.pin })
      ).status;
    } catch (e) {
      cierre = (e as Error).message;
    } finally {
      await app.close();
    }
    expect([200, 201]).toContain(cierre);
  });

  it('mergea la línea repetida reconvirtiendo a la presentación del destino, y muda la que no matchea', async () => {
    const destino = await abrirCuenta();
    const origen = await abrirCuenta();
    // El destino es la de menor `numero`, no la primera del array del request.
    expect(destino.numero).toBeLessThan(origen.numero);

    // Destino: 1 kg, presentado en kg.
    await agregarLinea(destino.id, {
      itemId: itemKgId,
      cantidad: '1',
      cantidadPresentacion: '1',
      unidadCodigoPresentacion: 'kg',
    });
    // Origen: el MISMO ítem pero presentado en g, más uno que no matchea.
    await agregarLinea(origen.id, {
      itemId: itemKgId,
      cantidad: '0.5',
      cantidadPresentacion: '500',
      unidadCodigoPresentacion: 'g',
    });
    await agregarLinea(origen.id, { itemId: itemOtroId, cantidad: '2' });

    const res = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/cuentas/fusionar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cuentaIds: [origen.id, destino.id] });

    expect(res.status).toBe(201);
    const fusionada = res.body as CuentaDetalle;
    expect(fusionada.id).toBe(destino.id);

    // Dos líneas, no tres: la repetida se sumó, la distinta se mudó.
    expect(fusionada.lineas).toHaveLength(2);

    const merged = fusionada.lineas.find((l) => l.itemId === itemKgId)!;
    // 1 kg + 500 g = 1,5 kg en canónico…
    expect(Number(merged.cantidad)).toBeCloseTo(1.5, 6);
    // …y la presentación queda en la unidad del DESTINO, reconvertida. Sin la
    // reconversión el número seguiría diciendo "1 kg" sobre una línea que ahora
    // pesa kilo y medio.
    expect(merged.unidadCodigoPresentacion).toBe('kg');
    expect(Number(merged.cantidadPresentacion)).toBeCloseTo(1.5, 6);

    const mudada = fusionada.lineas.find((l) => l.itemId === itemOtroId)!;
    expect(Number(mudada.cantidad)).toBeCloseTo(2, 6);

    // Y la de origen queda cancelada, sin venta: la absorbió el destino.
    const resCuentas = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCuentas.status).toBe(200);
    const abiertas = (resCuentas.body as CuentaDetalle[]).filter(
      (c) => c.estado === 'abierta',
    );
    expect(abiertas.map((c) => c.id)).toEqual([destino.id]);
  });

  it('rechaza fusionar una cuenta de otra mesa sin tocar las demás', async () => {
    const propia = await abrirCuenta();

    const resOtroSalon = await request(app.getHttpServer())
      .post('/api/salones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Salón fusión ajena E2E ${Date.now()}` });
    expect(resOtroSalon.status).toBe(201);
    const resOtraMesa = await request(app.getHttpServer())
      .post(`/api/salones/${(resOtroSalon.body as IdResponse).id}/mesas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Mesa ajena' });
    expect(resOtraMesa.status).toBe(201);
    const ajenaMesaId = (resOtraMesa.body as IdResponse).id;

    const resAjena = await request(app.getHttpServer())
      .post(`/api/mesas/${ajenaMesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: garzon.pin });
    expect(resAjena.status).toBe(201);
    const ajena = resAjena.body as CuentaDetalle;

    const res = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/cuentas/fusionar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cuentaIds: [propia.id, ajena.id] });

    expect(res.status).toBe(400);

    // El 400 es lo que cubre este `it`. Que la ajena siga abierta es más débil
    // de lo que parece: la guarda corta ANTES de tocar nada —la cuenta de otra
    // mesa ni siquiera entra al `find`, que filtra por `mesaId`— así que esto
    // solo mataría una implementación que cancelara antes de validar. Se deja
    // por eso mismo: es la que hay que impedir.
    const resAjenaDespues = await request(app.getHttpServer())
      .get(`/api/mesas/${ajenaMesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(resAjenaDespues.status).toBe(200);
    expect(
      (resAjenaDespues.body as CuentaDetalle[]).find((c) => c.id === ajena.id)
        ?.estado,
    ).toBe('abierta');
  });

  /**
   * Spec `2026-09-16-anular-plato-despachado-design.md` § 8: las filas de
   * `cuenta_linea_anulaciones` de la cuenta de ORIGEN se mudan a la de
   * destino. Sin esto, el aviso de la pantalla y la precuenta pierden lo
   * anulado antes de fusionar — sobrevive al borrado de SU línea, pero no a
   * una fusión que no la mueva.
   */
  it('fusionar una cuenta con una anulación deja esa anulación en el detalle de la cuenta de destino', async () => {
    const destino = await abrirCuenta();
    const origen = await abrirCuenta();

    // El origen necesita quedar ABIERTA después de anular: si la anulación se
    // llevara la única línea viva, `anularLinea` cancelaría la cuenta ella
    // misma (spec § 7) y `fusionarCuentas` la rechazaría por no estar
    // `abierta`. `itemOtroId` es lo que la mantiene con algo vivo.
    await agregarLinea(origen.id, { itemId: itemAnulableId, cantidad: '1' });
    await agregarLinea(origen.id, { itemId: itemOtroId, cantidad: '1' });
    await despachar(origen.id);

    const detalleOrigen = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalleOrigen.status).toBe(200);
    const lineaAnulable = (detalleOrigen.body as CuentaDetalle[])
      .find((c) => c.id === origen.id)!
      .lineas.find((l) => l.itemId === itemAnulableId)!;

    const anulado = await request(app.getHttpServer())
      .post(`/api/cuentas/${origen.id}/lineas/${lineaAnulable.id}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad: '1', motivoBajaId: motivoId });
    expect(anulado.status).toBe(201);
    const anulacionOrigen = (anulado.body as CuentaDetalle).anulaciones[0];
    expect(anulacionOrigen).toBeDefined();

    const res = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/cuentas/fusionar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cuentaIds: [origen.id, destino.id] });
    expect(res.status).toBe(201);

    const fusionada = res.body as CuentaDetalle;
    expect(fusionada.anulaciones).toHaveLength(1);
    expect(fusionada.anulaciones[0].id).toBe(anulacionOrigen.id);
    expect(fusionada.anulaciones[0].itemNombre).toBe(
      anulacionOrigen.itemNombre,
    );
    expect(fusionada.anulaciones[0].cantidad).toMatch(/^1(\.0+)?$/);

    // Y releída desde cero (no solo la respuesta de la fusión): el detalle de
    // la cuenta fusionada, vía el mismo camino que usa la pantalla del salón.
    const relectura = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(relectura.status).toBe(200);
    const destinoReleido = (relectura.body as CuentaDetalle[]).find(
      (c) => c.id === fusionada.id,
    )!;
    expect(destinoReleido.anulaciones).toHaveLength(1);
    expect(destinoReleido.anulaciones[0].id).toBe(anulacionOrigen.id);
  });
});
