import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Supervisor: rol Administrador, es_fijo=true → short-circuit de permisos,
// incluye Cajas:Leer.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Cajero: rol Vendedor, solo tiene MiCaja (sin Cajas).
// Nota: el seed usa el mismo hash de dev para todos los usuarios (password 'admin');
// ventas.e2e-spec.ts prueba con 'Vendedor1234!' pero ese test se salta en silencio
// si el login falla, por eso ese valor nunca se verificó.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface CajonResponse {
  id: string;
}
interface CajonDisponible {
  cajonId: string;
}
interface Member {
  usuarioId: string;
  correo: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string;
  requiereConteo: boolean;
  contado?: string | null;
  diferencia?: string | null;
  motivoNombre?: string | null;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  // Switch a tenant Paris para que el token cargue tenant_id
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

/**
 * Abre una caja física (sobre un cajón) para el usuario del token. Si ya
 * tiene una abierta (409 — residuo de una corrida local previa abortada),
 * la reutiliza vía GET /api/caja/activa en vez de fallar.
 */
async function abrirOReusarCaja(
  app: INestApplication<App>,
  token: string,
  cajonId: string,
): Promise<string> {
  const resAbrir = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '10000.0000',
      comentario: 'Apertura E2E caja',
    });

  if (resAbrir.status === 201) {
    return (resAbrir.body as CajaResponse).id;
  }

  // 409 esperado: ya existe una caja abierta para este usuario. Reusarla.
  const resActiva = await request(app.getHttpServer())
    .get('/api/caja/activa')
    .set('Authorization', `Bearer ${token}`);
  return (resActiva.body as CajaResponse).id;
}

/**
 * Cierre en dos fases (Task 3): fase 1 (`POST /:id/conteo`) congela el arqueo
 * y auto-cierra si cuadra, o pasa a `en_conciliacion` si alguna línea
 * descuadra. Si descuadra, esta función resuelve la fase 2 (`POST /:id/cerrar`)
 * con los motivos de `justificar` (vacío si no se pasa). Devuelve la respuesta
 * de la fase que terminó cerrando el flujo — `{estado, arqueo}` si auto-cerró
 * en fase 1, o `{caja, arqueo}` si necesitó la fase 2.
 */
async function cerrarEnDosFases(
  app: INestApplication<App>,
  cajaId: string,
  token: string,
  contadas: any[],
  justificar?: any[],
) {
  const c = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: contadas });
  if ((c.body as { estado?: string }).estado === 'en_conciliacion') {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: justificar ?? [] });
  }
  return c;
}

/**
 * Resuelve el usuarioId del dueño de `token` matcheando su correo en
 * GET /api/tenants/members (patrón de cajones.e2e-spec.ts).
 */
async function usuarioIdDe(
  app: INestApplication<App>,
  token: string,
  email: string,
): Promise<string> {
  const resMiembros = await request(app.getHttpServer())
    .get('/api/tenants/members')
    .set('Authorization', `Bearer ${token}`);
  const miembro = (resMiembros.body as Member[]).find(
    (m) => m.correo === email,
  );
  if (!miembro) {
    throw new Error(`No se encontró en /tenants/members el correo ${email}`);
  }
  return miembro.usuarioId;
}

describe('Caja (e2e) — aislamiento cajero (MiCaja) vs supervisor (Cajas)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let cajaDelCajeroId: string;
  let cajonDelCajeroId: string;

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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenSupervisor = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    // Cajón dedicado para las aperturas de este describe (AbrirCajaDto exige
    // cajonId — ver `describe('apertura sobre cajón (e2e)')` más abajo).
    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenSupervisor}`)
      .send({ nombre: `E2E Owner-only ${Date.now()}` });
    cajonDelCajeroId = (resCajon.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    if (cajonDelCajeroId) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonDelCajeroId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    }
    await app.close();
  });

  describe('GET /caja/cajones-estado', () => {
    it('un cajero (solo MiCaja, sin Cajas) recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .expect(403);
    });

    it('un supervisor (Cajas:Leer) recibe la lista de cajones con su estado', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      for (const item of r.body as Array<Record<string, unknown>>) {
        expect(typeof item.cajonId).toBe('string');
        expect(typeof item.nombre).toBe('string');
        expect('sesion' in item).toBe(true);
      }
    });
  });

  describe('POST /caja/:id/conteo — owner-only (fase 1)', () => {
    it('un supervisor NO puede enviar el conteo de la caja abierta por el cajero', async () => {
      cajaDelCajeroId = await abrirOReusarCaja(
        app,
        tokenCajero,
        cajonDelCajeroId,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });

      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(
        'No tienes acceso a esta caja',
      );
    });

    afterAll(async () => {
      // Higiene de reruns locales: cerrar la caja abierta por el cajero
      // (queda abierta a propósito durante el `it` de arriba, que verifica
      // que el supervisor no puede enviar su conteo). Se cierra acá, antes de
      // que otros describes intenten abrir una caja nueva para el cajero —
      // solo puede tener una física abierta por (tenant, usuario) a la vez.
      if (cajaDelCajeroId) {
        await cerrarEnDosFases(app, cajaDelCajeroId, tokenCajero, [
          { metodoPagoId: null, montoContado: '10000' },
        ]);
      }
    });
  });

  describe('apertura sobre cajón (e2e)', () => {
    let cajonId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Apertura ${Date.now()}` });
      cajonId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      // Soft-delete del cajón dedicado para no dejar residuos entre corridas.
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    // El chequeo aplicativo de `abrir` (findActiva) corre FUERA de la transacción,
    // así que dos aperturas simultáneas sobre cajones DISTINTOS no competían por
    // nada: el mismo cajero quedaba con dos cajas abiertas. La defensa real es el
    // índice único parcial, y lo que este test asevera es que existe con la forma
    // correcta — borrarlo del entity deja pasar la carrera otra vez.
    it('existe el índice único que impide dos cajas activas del mismo usuario', async () => {
      const ds = app.get(DataSource);
      const rows: { indexdef: string }[] = await ds.query(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'cajas' AND indexname = 'ux_cajas_activa_por_usuario'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0].indexdef;
      expect(def).toContain('UNIQUE');
      expect(def).toContain('tenant_id');
      expect(def).toContain('usuario_id');
      // `en_conciliacion` también ocupa al cajero: sin ella, quien dejó una
      // conciliación pendiente podría abrir una segunda caja bajo concurrencia.
      expect(def).toContain('en_conciliacion');
      expect(def).toContain('abierta');
      // Las dos condiciones del `where` que hacen que el índice defienda ALGO:
      // sobre 'virtual' no protegería ninguna caja física, y sin el filtro de
      // borrado bloquearía reabrir tras un soft-delete legítimo.
      expect(def).toContain(`'fisica'`);
      expect(def).toContain('eliminado_el');
    });

    it('el cajón recién creado aparece en cajones-disponibles del admin', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(
        (r.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(true);
    });

    it('abrir sin cajonId es rechazado (400)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ saldoInicial: '0' });
      expect(r.status).toBe(400);
    });

    it('abre sobre el cajón, queda ocupado, y no se puede desactivar con caja abierta (409)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // el cajón ya no aparece disponible mientras tiene una sesión abierta
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(
        (disp.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(false);

      // guard de integridad: no se puede desactivar un cajón con caja abierta
      const desactivar = await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ activo: false });
      expect(desactivar.status).toBe(409);

      // cerrar para dejar limpio (higiene de reruns locales)
      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '0' },
      ]);
      expect([200, 201]).toContain(cerrar.status);
    });

    it('un usuario fuera del allow-list del cajón recibe 403 al abrir', async () => {
      const supervisorId = await usuarioIdDe(app, tokenSupervisor, ADMIN_EMAIL);

      // restringir el cajón al admin: el cajero queda fuera del allow-list
      const restringir = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [supervisorId] });
      expect(restringir.status).toBe(200);

      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(r.status).toBe(403);

      // limpiar el allow-list para no afectar otras corridas
      const limpiar = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [] });
      expect(limpiar.status).toBe(200);
    });

    it('el historial filtrado por cajonId responde 200 y devuelve una lista', async () => {
      const r = await request(app.getHttpServer())
        .get(`/api/caja?cajonId=${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      const data = (r.body as { data: Array<{ cajonNombre: string | null }> })
        .data;
      expect(Array.isArray(data)).toBe(true);
    });
  });

  describe('arqueo multi-medio', () => {
    // Tarjeta de débito (es_efectivo=false, habilitada para Paris vía seed;
    // requiere_conteo=false por defecto).
    const TARJETA_DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
    const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
    const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

    let ds: DataSource;
    let cajonArqueoId: string;
    // Item tipo 'servicio' (sin stock): evita depender de productos con stock
    // compartido/agotable por otros specs (ver `docs/agent/pendientes.md`,
    // caveat de polución local de stock acumulado entre corridas de e2e).
    let itemId: string;

    beforeAll(async () => {
      ds = app.get(DataSource);
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Arqueo ${Date.now()}` });
      cajonArqueoId = (r.body as CajonResponse).id;

      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          nombre: `E2E Arqueo Servicio ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      itemId = (item.body as { id: string }).id;
    });

    afterAll(async () => {
      // Higiene: la política de requiere_conteo es del tenant, no debe quedar
      // alterada para otras corridas/specs que compartan la BD.
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
      if (itemId) {
        await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
      }
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonArqueoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('vender con tarjeta NO infla el esperado de efectivo (fin del faltante fantasma)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      const preview = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(preview.status).toBe(200);
      const lineas = (preview.body as { ciego: boolean; lineas: ArqueoLinea[] })
        .lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      const tarjeta = lineas.find((l) => l.metodoPagoId === TARJETA_DEBITO_ID);
      // El fondo era 0 y no hubo entradas en efectivo: la venta con tarjeta
      // no debe inflar el esperado de efectivo (fin del faltante fantasma).
      expect(efectivo?.esperado).toBe('0.0000');
      expect(tarjeta?.esperado).toBe('5000.0000');

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '0' },
      ]);
      expect(cerrar.status).toBe(201);
      const body = cerrar.body as { estado: string; arqueo: ArqueoLinea[] };
      expect(body.estado).toBe('cerrada'); // cuadró → auto-cierre en fase 1
      const efectivoCerrado = body.arqueo.find((l) => l.esEfectivo);
      expect(efectivoCerrado?.diferencia).toBe('0.0000');
    });

    it('la tarjeta sin requiere_conteo es informativa: cerrar solo con efectivo → 201', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // Movimiento con tarjeta (requiere_conteo=false por defecto): la línea
      // queda informativa, no bloquea el cierre.
      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000.0000' },
      ]);
      expect(cerrar.status).toBe(201);
    });

    it('el historial reporta el descuadre de tarjeta, no solo el de efectivo', async () => {
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = true
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );

      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      // El efectivo CUADRA (0 esperado, 0 contado) y la tarjeta descuadra en
      // -500: es justo el caso que el historial mostraba como "+0".
      const motivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia?soloActivas=true')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      const motivoId = (motivos.body as { id: string }[])[0]?.id;
      const cerrar = await cerrarEnDosFases(
        app,
        cajaId,
        tokenSupervisor,
        [
          { metodoPagoId: null, montoContado: '0' },
          { metodoPagoId: TARJETA_DEBITO_ID, montoContado: '4500.0000' },
        ],
        [{ metodoPagoId: TARJETA_DEBITO_ID, motivoDiferenciaId: motivoId }],
      );
      expect([200, 201]).toContain(cerrar.status);

      const historial = await request(app.getHttpServer())
        .get(`/api/caja?cajonId=${cajonArqueoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(historial.status).toBe(200);
      const fila = (
        historial.body as {
          data: {
            id: string;
            diferencia: string | null;
            diferenciaTotal: string | null;
          }[];
        }
      ).data.find((c) => c.id === cajaId);

      // El campo viejo sigue siendo el del cajón físico: el efectivo cuadró.
      expect(fila?.diferencia).toBe('0.0000');
      // El nuevo suma todas las líneas y por eso sí ve el descuadre de tarjeta.
      expect(fila?.diferenciaTotal).toBe('-500.0000');

      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
    });

    it('con requiere_conteo=true en tarjeta, enviar el conteo sin su contado → 400', async () => {
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = true
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );

      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      // La validación de "falta el conteo de X" (línea obligatoria sin
      // contado) vive en la fase 1 (`enviarConteo`), no en `cerrar`.
      const conteoSinTarjeta = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
      expect(conteoSinTarjeta.status).toBe(400);

      // Higiene: cerrar con el conteo de la tarjeta (ahora obligatoria) para
      // no dejar la caja abierta, y restaurar la política del tenant.
      const cerrarCompleto = await cerrarEnDosFases(
        app,
        cajaId,
        tokenSupervisor,
        [
          { metodoPagoId: null, montoContado: '0' },
          { metodoPagoId: TARJETA_DEBITO_ID, montoContado: '5000.0000' },
        ],
      );
      expect(cerrarCompleto.status).toBe(201);

      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
    });

    it('montoContado admite decimales', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '10000.5000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000.5000' },
      ]);
      expect(cerrar.status).toBe(201);
    });

    it('la caja cerrada devuelve las líneas congeladas en GET /:id/arqueo', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '1000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '1000.0000' },
      ]);
      expect(cerrar.status).toBe(201);

      const arqueoCerrado = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueoCerrado.status).toBe(200);
      const lineas = (
        arqueoCerrado.body as { ciego: boolean; lineas: ArqueoLinea[] }
      ).lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      expect(efectivo?.contado).not.toBeNull();
      expect(efectivo?.diferencia).not.toBeNull();
      expect(efectivo?.contado).toBe('1000.0000');
      expect(efectivo?.diferencia).toBe('0.0000');
    });

    it('modo ciego + caja abierta operada por admin: el admin ve el arqueo completo (ciego no aplica al dueño)', async () => {
      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Venta con tarjeta (informativa: es_efectivo=false, requiere_conteo=false).
        const venta = await request(app.getHttpServer())
          .post('/api/ventas')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            tipoDocumentoId: BOLETA_ID,
            lineas: [{ itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
          });
        expect(venta.status).toBe(201);

        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueo.status).toBe(200);
        const body = arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] };
        // El admin del tenant ve el arqueo completo aun en modo ciego (§3.4): el
        // ciego no aplica al dueño, así que el esperado SÍ viaja.
        expect(body.ciego).toBe(false);
        const efectivo = body.lineas.find((l) => l.esEfectivo);
        // La tarjeta NO infla el esperado de efectivo (fin del faltante fantasma).
        expect(efectivo?.esperado).toBe('10000.0000');

        // El cierre igual cuadra: el server recomputa el esperado (10000).
        const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
          { metodoPagoId: null, montoContado: '10000.0000' },
        ]);
        expect(cerrar.status).toBe(201);
        const cerrarBody = cerrar.body as { arqueo: ArqueoLinea[] };
        const efectivoCerrado = cerrarBody.arqueo.find((l) => l.esEfectivo);
        expect(efectivoCerrado?.esperado).toBe('10000.0000');
        expect(efectivoCerrado?.diferencia).toBe('0.0000');

        // La caja cerrada revela TODO (ciego:false) aunque el tenant sea ciego.
        const revelado = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(revelado.status).toBe(200);
        const revBody = revelado.body as {
          ciego: boolean;
          lineas: ArqueoLinea[];
        };
        expect(revBody.ciego).toBe(false);
        const efectivoRevelado = revBody.lineas.find((l) => l.esEfectivo);
        expect(efectivoRevelado?.esperado).toBe('10000.0000');
        expect(efectivoRevelado?.diferencia).toBe('0.0000');
      } finally {
        // Higiene: restaurar la política para no contaminar otros specs/corridas.
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });

    it('modo ciego + descuadre real: el conteo pasa a en_conciliacion y el GET /arqueo posterior revela; se finaliza con motivo', async () => {
      // Motivo fijo del seed (`seedMotivosDiferencia`, Paris arranca en 291).
      const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Contado ≠ esperado (10000): la caja NO auto-cierra, pasa a conciliación.
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }],
          });
        expect(conteo.status).toBe(201);
        expect((conteo.body as { estado: string }).estado).toBe(
          'en_conciliacion',
        );

        // Aunque el tenant sea ciego, la caja ya no está "abierta": el GET
        // /arqueo revela todo para poder conciliar (ciego solo aplica al
        // preview de una caja abierta).
        const arqueoRevelado = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueoRevelado.status).toBe(200);
        const revBody = arqueoRevelado.body as {
          ciego: boolean;
          lineas: ArqueoLinea[];
        };
        expect(revBody.ciego).toBe(false);
        const efectivoRevelado = revBody.lineas.find((l) => l.esEfectivo);
        expect(efectivoRevelado?.esperado).toBe('10000.0000');
        expect(efectivoRevelado?.diferencia).toBe('-1000.0000');
        expect(efectivoRevelado?.motivoNombre).toBeNull();

        // Fase 2: finalizar la conciliación con motivo.
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
            ],
          });
        expect([200, 201]).toContain(cerrar.status);

        const arqueoFinal = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        const lineasFinal = (arqueoFinal.body as { lineas: ArqueoLinea[] })
          .lineas;
        expect(lineasFinal.find((l) => l.esEfectivo)?.motivoNombre).toBe(
          'falta de efectivo',
        );
      } finally {
        // Higiene: restaurar la política para no contaminar otros specs/corridas.
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });
  });

  describe('cierre normal con descuadre — motivo es un paso aparte', () => {
    // Motivos fijos del seed (`seedMotivosDiferencia`, Paris arranca en 291).
    const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

    let cajonMotivoId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Motivo ${Date.now()}` });
      cajonMotivoId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonMotivoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('conteo con descuadre → en_conciliacion; cerrar sin motivo → 400; con motivo → cierra y GET /arqueo muestra motivoNombre', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonMotivoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // Contado != esperado (10000): fase 1 NO auto-cierra, pasa a conciliación.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const arqueoSinJustificar = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueoSinJustificar.status).toBe(200);
      const lineasSinJustificar = (
        arqueoSinJustificar.body as { ciego: boolean; lineas: ArqueoLinea[] }
      ).lineas;
      const efectivoSinJustificar = lineasSinJustificar.find(
        (l) => l.esEfectivo,
      );
      expect(efectivoSinJustificar?.diferencia).toBe('-1000.0000');
      expect(efectivoSinJustificar?.motivoNombre).toBeNull();

      // Fase 2 (`cerrar`) sin motivo, habiendo motivos activos en el tenant → 400.
      const cerrarSinMotivo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null }] });
      expect(cerrarSinMotivo.status).toBe(400);

      // La caja sigue en_conciliacion: el 400 no finalizó la transacción, la
      // línea sigue sin motivo.
      const arqueoTrasFallo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      const efectivoTrasFallo = (
        arqueoTrasFallo.body as { lineas: ArqueoLinea[] }
      ).lineas.find((l) => l.esEfectivo);
      expect(efectivoTrasFallo?.motivoNombre).toBeNull();

      // Con motivoDiferenciaId válido → cierra.
      const cerrarConMotivo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrarConMotivo.status);

      const arqueo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueo.status).toBe(200);
      const lineas = (arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] })
        .lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      expect(efectivo?.diferencia).toBe('-1000.0000');
      expect(efectivo?.motivoNombre).toBe('falta de efectivo');
    });

    it('cerrar con `lineas: []` NO finaliza una caja descuadrada: 400 y sigue en_conciliacion', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonMotivoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9500.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // El payload no menciona la línea descuadrada. Mientras el recorrido salía
      // de `dto.lineas`, esto devolvía 200 y cerraba la caja con la diferencia
      // sin justificar — el faltante quedaba sin explicación para siempre.
      const cerrarVacio = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [] });
      expect(cerrarVacio.status).toBe(400);

      const detalle = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect((detalle.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // Higiene: cerrar de verdad para liberar el cajón (ver pendientes.md).
      const cerrarOk = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrarOk.status);
    });
  });

  describe('justificación de diferencias — PATCH /caja/:id/arqueo/motivos (admin-only)', () => {
    // Motivo fijo del seed, distinto del usado en el describe anterior
    // para no competir por el mismo registro (maxWorkers:1 en jest-e2e.json
    // hace que los archivos corran en serie, pero los `it` dentro de un mismo
    // describe podrían solaparse con otros describes si Jest los reordena).
    const DIVERGENCIA_TARJETA_ID = '550e8400-e29b-41d4-a716-446655440293';

    let ds: DataSource;
    let cajonJustificacionId: string;

    beforeAll(async () => {
      ds = app.get(DataSource);
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Justificacion ${Date.now()}` });
      cajonJustificacionId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonJustificacionId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('en modo ciego con descuadre: conteo → en_conciliacion, se finaliza con motivo, y el override (PATCH) es admin-only', async () => {
      // Motivo fijo del seed, distinto de DIVERGENCIA_TARJETA_ID (con el que
      // se re-justifica más abajo), para poder verificar que el PATCH
      // realmente reemplaza el motivo aplicado en la fase 2.
      const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonJustificacionId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Contado != esperado (10000): fase 1 pasa a en_conciliacion (el modo
        // ciego del tenant no cambia esta bifurcación).
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '9500.0000' }],
          });
        expect(conteo.status).toBe(201);
        expect((conteo.body as { estado: string }).estado).toBe(
          'en_conciliacion',
        );

        // Fase 2: finaliza con motivo → la caja queda `cerrada`.
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
            ],
          });
        expect([200, 201]).toContain(cerrar.status);

        // No-admin (Vendedor) no puede re-justificar (override admin-only).
        const patchNoAdmin = await request(app.getHttpServer())
          .patch(`/api/caja/${cajaId}/arqueo/motivos`)
          .set('Authorization', `Bearer ${tokenCajero}`)
          .send({
            lineas: [
              {
                metodoPagoId: null,
                motivoDiferenciaId: DIVERGENCIA_TARJETA_ID,
              },
            ],
          });
        expect(patchNoAdmin.status).toBe(403);

        // Admin re-justifica con un motivo distinto.
        const patchAdmin = await request(app.getHttpServer())
          .patch(`/api/caja/${cajaId}/arqueo/motivos`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              {
                metodoPagoId: null,
                motivoDiferenciaId: DIVERGENCIA_TARJETA_ID,
              },
            ],
          });
        expect(patchAdmin.status).toBe(200);

        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueo.status).toBe(200);
        const lineas = (
          arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] }
        ).lineas;
        const efectivo = lineas.find((l) => l.esEfectivo);
        expect(efectivo?.motivoNombre).toBe('divergencia de tarjeta');
      } finally {
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });
  });

  describe('admin finaliza una conciliación ajena — fase 2 (POST /cerrar)', () => {
    // Motivo fijo del seed (`seedMotivosDiferencia`, Paris arranca en 291).
    const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

    it('el cajero deja la caja en_conciliacion y el admin (no dueño) la finaliza con motivo', async () => {
      const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonDelCajeroId);

      // El cajero envía su conteo con descuadre: pasa a en_conciliacion, no
      // auto-cierra, y no puede abrir otra caja hasta que se resuelva.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9999.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // El admin, sin ser dueño de la caja, finaliza la fase 2 con motivo.
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrar.status);

      const arqueo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueo.status).toBe(200);
      const lineas = (arqueo.body as { lineas: ArqueoLinea[] }).lineas;
      expect(lineas.find((l) => l.esEfectivo)?.motivoNombre).toBe(
        'falta de efectivo',
      );
    });
  });
});

describe('Caja (e2e) — modo ciego oculta resumen y movimientos del turno', () => {
  let app: INestApplication<App>;
  let token: string;
  let adminToken: string;
  let cajonId: string;
  let ds: DataSource;

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

    token = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    adminToken = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: `E2E Ciego Resumen ${Date.now()}` });
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    if (cajonId) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    await app.close();
  });

  it('ciego + caja abierta: resumen oculta cifras (ciego:true, totales null, saldoInicial presente) y movimientos devuelve página vacía', async () => {
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', concepto: 'retiro', monto: '500.0000' });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumen.status).toBe(200);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(true);
    expect(rb.saldoInicial).toBe('10000.0000');
    expect(rb.totalEntradas).toBeNull();
    expect(rb.totalSalidas).toBeNull();
    expect(rb.saldoEsperado).toBeNull();
    expect(rb.totalMovimientos).toBeNull();

    const movs = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect(movs.status).toBe(200);
    const mb = movs.body as { data: unknown[]; meta: { total: number } };
    expect(mb.data).toEqual([]);
    expect(mb.meta.total).toBe(0);

    // Reveal al conciliar: descuadre → en_conciliacion → estado !== 'abierta' → revela.
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '12345.0000' }] });
    expect((conteo.body as { estado: string }).estado).toBe('en_conciliacion');

    const resumenReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    const rr = resumenReveal.body as Record<string, unknown>;
    expect(rr.ciego).toBe(false);
    expect(rr.totalSalidas).toBe('500.0000');
    const movsReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect((movsReveal.body as { meta: { total: number } }).meta.total).toBe(1);

    // Higiene (evita caja colgada en_conciliacion en reruns locales): fase 2 con un
    // motivo real. En descuadre, POST /cerrar exige motivo por línea (sub-proyecto C).
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }] });
  });

  it('arqueo_ciego off: resumen revela cifras y movimientos lista las filas', async () => {
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(false);
    expect(rb.saldoEsperado).toBe('10000.0000');
    await cerrarEnDosFases(app, cajaId, token, [
      { metodoPagoId: null, montoContado: '10000.0000' },
    ]);
  });
});

describe('Caja (e2e) — el modo ciego NO aplica al admin (ve en vivo)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenAdmin: string;
  let cajonId: string;
  let ds: DataSource;

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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Ciego Admin ${Date.now()}` });
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    if (cajonId) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    await app.close();
  });

  it('caja abierta del cajero en tenant ciego: el cajero la ve ciega, el admin (verTodas) la ve completa', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ tipo: 'salida', concepto: 'retiro', monto: '500.0000' });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    // Cajero (no-admin, su propia caja) → ciega.
    const rCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect((rCajero.body as { ciego: boolean }).ciego).toBe(true);
    expect((rCajero.body as { totalSalidas: unknown }).totalSalidas).toBeNull();
    const mCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect((mCajero.body as { meta: { total: number } }).meta.total).toBe(0);

    // Admin del tenant (verTodas) → completo, aun estando la caja abierta y el tenant ciego.
    const rAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const adminBody = rAdmin.body as { ciego: boolean; totalSalidas: unknown };
    expect(adminBody.ciego).toBe(false);
    expect(typeof adminBody.totalSalidas).toBe('string');
    const mAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(
      (mAdmin.body as { meta: { total: number } }).meta.total,
    ).toBeGreaterThanOrEqual(1);

    // GET /arqueo respeta el mismo eje: el cajero lo ve ciego (esperado null), el
    // admin lo ve revelado.
    const aCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect((aCajero.body as { ciego: boolean }).ciego).toBe(true);
    const aAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect((aAdmin.body as { ciego: boolean }).ciego).toBe(false);

    // Higiene: apagar ciego y cerrar la caja (con motivo por si descuadra).
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    await cerrarEnDosFases(
      app,
      cajaId,
      tokenCajero,
      [{ metodoPagoId: null, montoContado: '0' }],
      [{ metodoPagoId: null, motivoDiferenciaId: motivoId }],
    );
  });
});
