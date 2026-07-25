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

  describe('POST /caja/:id/cerrar — owner-only', () => {
    it('un supervisor NO puede cerrar la caja abierta por el cajero', async () => {
      cajaDelCajeroId = await abrirOReusarCaja(
        app,
        tokenCajero,
        cajonDelCajeroId,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
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
      // que el supervisor no puede cerrarla). Se cierra acá, antes de que
      // otros describes intenten abrir una caja nueva para el cajero — solo
      // puede tener una física abierta por (tenant, usuario) a la vez.
      if (cajaDelCajeroId) {
        await request(app.getHttpServer())
          .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
          .set('Authorization', `Bearer ${tokenCajero}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });
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
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
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

      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
      expect(cerrar.status).toBe(201);
      const body = cerrar.body as { arqueo: ArqueoLinea[] };
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

      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000.0000' }] });
      expect(cerrar.status).toBe(201);
    });

    it('con requiere_conteo=true en tarjeta, cerrar sin su contado → 400', async () => {
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

      const cerrarSinTarjeta = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
      expect(cerrarSinTarjeta.status).toBe(400);

      // Higiene: cerrar con el conteo de la tarjeta (ahora obligatoria) para
      // no dejar la caja abierta, y restaurar la política del tenant.
      const cerrarCompleto = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, montoContado: '0' },
            { metodoPagoId: TARJETA_DEBITO_ID, montoContado: '5000.0000' },
          ],
        });
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

      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000.5000' }] });
      expect(cerrar.status).toBe(201);
    });

    it('la caja cerrada devuelve las líneas congeladas en GET /:id/arqueo', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '1000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '1000.0000' }] });
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

    it('modo ciego + caja abierta: GET arqueo → ciego:true, sin esperado, solo obligatorias', async () => {
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
        expect(body.ciego).toBe(true);
        // Solo la línea de efectivo (obligatoria); la tarjeta informativa no viaja.
        expect(body.lineas).toHaveLength(1);
        expect(body.lineas[0].esEfectivo).toBe(true);
        // Anti-fraude: el esperado no viaja en la respuesta.
        expect(body.lineas[0].esperado).toBeNull();

        // El cierre igual cuadra: el server recomputa el esperado (10000).
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '10000.0000' }],
          });
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

    it('cerrar con descuadre no exige motivo (201, línea sin justificar); PATCH la justifica después', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonMotivoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // Contado != esperado (10000), sin motivo → cerrar ya no lo exige: 201.
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }] });
      expect(cerrar.status).toBe(201);

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

      // Justificación es un paso aparte: PATCH /caja/:id/arqueo/motivos.
      const patch = await request(app.getHttpServer())
        .patch(`/api/caja/${cajaId}/arqueo/motivos`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect(patch.status).toBe(200);

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

    it('en modo ciego, no-admin recibe 403 y admin puede re-justificar (PATCH) la línea', async () => {
      // `cajaService.cerrar()` ya no exige (ni captura) motivo en ninguna
      // rama — ciega o no. El cierre queda sin justificar y la justificación
      // es un paso admin-only aparte vía `PATCH /caja/:id/arqueo/motivos`.
      // Este caso prueba ese enforcement admin-only y que re-justificar una
      // línea cerrada actualiza el `motivoNombre` que expone el GET.
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

        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '9500.0000' }],
          });
        expect(cerrar.status).toBe(201);

        // No-admin (Vendedor) no puede re-justificar.
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
});
