import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';

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
interface CuentaDetalle {
  id: string;
  garzonResponsableId: string;
  lineas: { id: string; cantidad: string; cantidadEnviada: string }[];
}
interface Asignacion {
  garzonId: string;
  origenGarzonId: string | null;
  motivo: string;
}

/**
 * Lo que entra al salón por el body y la ruta lo valida antes de escribir.
 * Cada caso se midió por HTTP el 2026-10-08 antes de arreglarlo (spec
 * `docs/superpowers/specs/2026-10-08-salon-ids-layout-comanda-design.md`), y
 * cada `describe` lleva al lado el control que lo hace falsable: un guard que
 * rechazara todo también pondría en verde el rechazo.
 *
 * Garzones, salón, mesa e ítem son propios del spec: la sesión de un garzón es
 * única (`docs/patterns/backend.md` § 7, "el estado que es único por
 * definición").
 */
describe('Salones — lo que entra por el body (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let mesaId: string;
  let platoId: string;
  let garzonA: GarzonCreado;
  let garzonB: GarzonCreado;

  async function enviar(
    metodo: 'post' | 'patch' | 'delete' | 'get',
    url: string,
    body?: Record<string, unknown>,
  ) {
    const req = request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`);
    return body
      ? req.set('Idempotency-Key', randomUUID()).send(body)
      : req.send();
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await enviar('post', url, body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function abrirCuenta(cantidad = '2'): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzonA.id,
      pin: garzonA.pin,
    });
    return post<CuentaDetalle>(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId: platoId,
      cantidad,
    });
  }

  async function asignaciones(cuentaId: string): Promise<Asignacion[]> {
    const res = await enviar('get', `/api/cuentas/${cuentaId}/asignaciones`);
    expect(res.status).toBe(200);
    return res.body as Asignacion[];
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

    const marca = Date.now();
    platoId = (
      await post<IdResponse>('/api/items', {
        nombre: `Plato entrada E2E ${marca}`,
        tipo: 'producto',
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;

    garzonA = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón A entrada E2E ${marca}`,
    });
    garzonB = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón B entrada E2E ${marca}`,
    });
    for (const g of [garzonA, garzonB]) {
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: g.id,
        pin: g.pin,
        turnoId: TURNO_MANANA_ID,
      });
    }

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón entrada E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa entrada',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Mismo molde que `salones-comanda.e2e-spec.ts`: el status se afirma
    // después del `close`, que va en el `finally`.
    const cierres: (number | string)[] = [];
    try {
      for (const g of [garzonA, garzonB]) {
        if (!g) continue;
        cierres.push(
          (
            await request(app.getHttpServer())
              .post('/api/sesiones-garzon/cerrar')
              .set('Authorization', `Bearer ${token}`)
              .send({ garzonId: g.id, pin: g.pin })
          ).status,
        );
      }
    } catch (e) {
      cierres.push((e as Error).message);
    } finally {
      await app.close();
    }
    for (const c of cierres) expect([200, 201]).toContain(c);
  });

  /**
   * `transferir` compara `cuenta.garzonResponsableId === destinoGarzonId` en
   * TypeScript, contra el casing del cliente. Hasta el 2026-10-08 el
   * responsable en mayúsculas pasaba el guard: 201 y un tramo
   * `transferencia_admin` del garzón a sí mismo en el historial (medido).
   */
  describe('transferir-admin: el responsable en mayúsculas es el mismo garzón', () => {
    it('es 400 "ya es responsable" y el historial no suma un tramo', async () => {
      const cuenta = await abrirCuenta();

      const res = await enviar(
        'post',
        `/api/cuentas/${cuenta.id}/transferir-admin`,
        { garzonId: garzonA.id.toUpperCase() },
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'El garzón ya es responsable de la cuenta',
      );
      const historial = await asignaciones(cuenta.id);
      expect(historial).toHaveLength(1);
      expect(historial[0].motivo).toBe('apertura');
    });

    it('control: a otro garzón en mayúsculas transfiere, y el responsable queda en minúsculas', async () => {
      const cuenta = await abrirCuenta();

      const transferida = await post<CuentaDetalle>(
        `/api/cuentas/${cuenta.id}/transferir-admin`,
        { garzonId: garzonB.id.toUpperCase() },
      );

      expect(transferida.garzonResponsableId).toBe(garzonB.id);
      const historial = await asignaciones(cuenta.id);
      expect(historial.map((a) => [a.motivo, a.garzonId])).toEqual([
        ['apertura', garzonA.id],
        ['transferencia_admin', garzonB.id],
      ]);
    });
  });

  /**
   * `fusionarCuentas` deduplica con un `Set` en TypeScript: `[X, x]` eran dos
   * ids, el lock encontraba una cuenta y el 400 decía que alguna no era de la
   * mesa (medido el 2026-10-08). No escribía nada; el mensaje mentía.
   */
  describe('fusionar: el mismo id en dos casings es una sola cuenta', () => {
    it('es 400 "al menos dos cuentas"', async () => {
      const cuenta = await abrirCuenta();

      const res = await enviar(
        'post',
        `/api/mesas/${mesaId}/cuentas/fusionar`,
        { cuentaIds: [cuenta.id.toUpperCase(), cuenta.id] },
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Selecciona al menos dos cuentas para fusionar',
      );
    });

    it('control: dos cuentas distintas en mayúsculas se fusionan', async () => {
      const a = await abrirCuenta('1');
      const b = await abrirCuenta('1');

      const fusionada = await post<CuentaDetalle>(
        `/api/mesas/${mesaId}/cuentas/fusionar`,
        { cuentaIds: [a.id.toUpperCase(), b.id.toUpperCase()] },
      );

      expect(fusionada.id).toBe(a.id);
      expect(Number(fusionada.lineas[0].cantidad)).toBe(2);
    });
  });
  /**
   * La pantalla del plano (`configuracion/salones.vue`, `guardarDistribucion`)
   * manda TODAS las mesas que cargó en cada arrastre. Hasta el 2026-10-08 una
   * mesa borrada después de cargar recibía la posición y el guardado respondía
   * 200 (medido: quedaba escrita, y se veía así desde la papelera). Cortar con
   * 404 habría hecho fallar cada arrastre del plano hasta recargar, así que la
   * borrada se saltea y el resto se guarda (orquestadora, 2026-10-08). Una mesa
   * que no es del salón sigue siendo 404.
   */
  describe('layout: la mesa borrada se saltea y el resto del plano se guarda', () => {
    let salonId: string;
    let viva: string;
    let borrada: string;
    let deOtroSalon: string;

    interface MesaPlano {
      id: string;
      posX: string;
      posY: string;
    }

    async function mesasDelPlano(): Promise<Map<string, MesaPlano>> {
      const res = await enviar('get', '/api/salones?incluirEliminados=true');
      expect(res.status).toBe(200);
      const salones = res.body as { id: string; mesas: MesaPlano[] }[];
      return new Map(
        salones.flatMap((s) => s.mesas).map((m) => [m.id, m] as const),
      );
    }

    beforeAll(async () => {
      const marca = Date.now();
      salonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Salón plano E2E ${marca}`,
        })
      ).id;
      viva = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Viva',
        })
      ).id;
      borrada = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Borrada',
        })
      ).id;
      const otroSalonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Otro salón plano E2E ${marca}`,
        })
      ).id;
      deOtroSalon = (
        await post<IdResponse>(`/api/salones/${otroSalonId}/mesas`, {
          nombre: 'Ajena',
        })
      ).id;
      const res = await enviar('delete', `/api/mesas/${borrada}`);
      expect(res.status).toBe(200);
    });

    it('200: la viva toma la posición nueva y la borrada conserva la suya', async () => {
      const antes = (await mesasDelPlano()).get(borrada)!;

      const res = await enviar('patch', `/api/salones/${salonId}/layout`, {
        mesas: [
          // En mayúsculas: la lectura del salón la tiene que reconocer igual
          // (la base devuelve los ids en minúsculas).
          { mesaId: viva.toUpperCase(), posX: 0.11, posY: 0.22 },
          { mesaId: borrada, posX: 0.77, posY: 0.66 },
        ],
      });

      expect(res.status).toBe(200);
      const despues = await mesasDelPlano();
      expect(Number(despues.get(viva)!.posX)).toBe(0.11);
      expect(Number(despues.get(viva)!.posY)).toBe(0.22);
      expect(despues.get(borrada)!.posX).toBe(antes.posX);
      expect(despues.get(borrada)!.posY).toBe(antes.posY);
    });

    it.each([
      ['de otro salón', () => deOtroSalon],
      ['que no existe', () => randomUUID()],
    ])(
      'una mesa %s sigue siendo 404, y no escribe ninguna',
      async (_caso, mesaId) => {
        const id = mesaId();
        const res = await enviar('patch', `/api/salones/${salonId}/layout`, {
          mesas: [
            { mesaId: viva, posX: 0.33, posY: 0.44 },
            { mesaId: id, posX: 0.5, posY: 0.5 },
          ],
        });

        expect(res.status).toBe(404);
        expect((res.body as { message: string }).message).toBe(
          `Mesa ${id} no pertenece al salón`,
        );
        expect(Number((await mesasDelPlano()).get(viva)!.posX)).not.toBe(0.33);
      },
    );
  });

  /**
   * `POST /cuentas/:id/comanda`, el confirmar legado de `reclamar`, escribía
   * `cantidad_enviada` con el número que mandara el cliente. Medido el
   * 2026-10-08: negativo, más que la línea (anular después daba 500 en el
   * reparto), más de 4 decimales y un número sin lugar en la columna (500).
   * Se retiró en vez de validarse (owner, 2026-10-08): ninguna pantalla lo
   * llamaba, y ninguna cota cerraba lo peor —marcar despachada una línea que
   * nunca fue a cocina y anularla con un motivo que mueve stock—.
   */
  it('el confirmar legado de la comanda ya no existe: 404, y lo despachado no se mueve', async () => {
    const cuenta = await abrirCuenta('2');
    const [linea] = cuenta.lineas;

    const res = await enviar('post', `/api/cuentas/${cuenta.id}/comanda`, {
      lineas: [{ cuentaLineaId: linea.id, cantidadEnviada: '2' }],
    });

    expect(res.status).toBe(404);
    // El 404 de Nest por ruta inexistente, no el de "línea no encontrada" de
    // un handler que siguiera vivo.
    expect((res.body as { message: string }).message).toBe(
      `Cannot POST /api/cuentas/${cuenta.id}/comanda`,
    );
    const releida = await enviar('get', `/api/mesas/${mesaId}/cuentas`);
    expect(releida.status).toBe(200);
    const enviada = (releida.body as CuentaDetalle[])
      .find((c) => c.id === cuenta.id)!
      .lineas.find((l) => l.id === linea.id)!.cantidadEnviada;
    expect(Number(enviada)).toBe(0);
  });
});
