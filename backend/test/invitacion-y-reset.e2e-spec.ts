import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { MailService } from '../src/modules/mail/mail.service';

/**
 * Invitación por link y reset de contraseña, contra Postgres real.
 *
 * Lo que ningún unit puede probar acá: que el token emitido dentro de la
 * transacción del alta sobreviva al commit, que el `UPDATE ... WHERE usado_el
 * IS NULL` realmente impida el segundo uso, y que en la base **solo** quede el
 * hash.
 *
 * ⚠️ Ningún test manda mail: `SMTP_HOST` está vacío en el entorno de test, así
 * que `MailService` loguea. Eso se afirma explícitamente más abajo — si dejara
 * de ser cierto, cada corrida de la suite dispararía mails reales.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

describe('Invitación y reset (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tokenAdmin: string;
  let rolId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    dataSource = app.get(DataSource);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
    expect(login.status).toBe(200);
    const conTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(conTenant.status).toBe(200);
    tokenAdmin = (conTenant.body as TokenResponse).access_token;

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(roles.status).toBe(200);
    rolId = (roles.body as { id: string; nombre: string }[]).find(
      (r) => r.nombre === 'Salón',
    )!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * El token en claro NO sale por la API —ese es el punto—, así que para
   * ejercer el flujo hay que emitir uno acá y quedarse con el claro. Se usa el
   * mismo servicio que usa producción: falsificar el hash a mano probaría otra
   * cosa.
   */
  async function invitar(): Promise<{ correo: string; token: string }> {
    const correo = `invitado-${Date.now()}-${Math.floor(
      Number(process.hrtime.bigint() % 1000n),
    )}@paris.cl`;
    const res = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Invitado', correo, rolIds: [rolId] });
    expect(res.status).toBe(201);

    // El claro no se puede recuperar de la base (solo está el hash), así que se
    // emite uno nuevo para este test: mismo camino de código.
    const tokens = app.get(TokensAccesoService);
    const [{ usuario_id: usuarioId }] = await dataSource.query<
      { usuario_id: string }[]
    >(`SELECT usuario_id FROM usuarios WHERE correo = $1`, [correo]);
    const token = await tokens.emitir(usuarioId, TipoTokenAcceso.INVITACION);
    return { correo, token };
  }

  describe('el par que define la feature', () => {
    it('el link deja elegir contraseña, y con ella se entra', async () => {
      const { correo, token } = await invitar();

      const previo = await request(app.getHttpServer()).get(
        `/api/auth/invitacion/${token}`,
      );
      expect(previo.status).toBe(200);
      expect((previo.body as { correo: string }).correo).toBe(correo);

      const elegir = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${token}`)
        .send({ contrasena: 'mi-clave-elegida' });
      expect(elegir.status).toBe(200);

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: 'mi-clave-elegida' });
      expect(login.status).toBe(200);
    });

    // El reuso secuencial, que corta `buscarVigente` con `usadoEl: IsNull()`.
    //
    // ⚠️ Este test NO sostiene la guarda de concurrencia de `quemar`: medido,
    // queda verde con esa guarda borrada. La cubre el de más abajo, contra el
    // servicio. Se aclara acá porque el comentario anterior se atribuía esa
    // protección y era falso — dos comentarios reclamando lo mismo, y solo uno
    // cierto, es peor que ninguno.
    it('el mismo link NO sirve dos veces', async () => {
      const { token } = await invitar();

      const primera = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${token}`)
        .send({ contrasena: 'primera-clave-1' });
      expect(primera.status).toBe(200);

      const segunda = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${token}`)
        .send({ contrasena: 'intruso-clave-2' });
      expect(segunda.status).toBe(400);

      // Y la verificación previa también deja de darlo por bueno.
      const previo = await request(app.getHttpServer()).get(
        `/api/auth/invitacion/${token}`,
      );
      expect(previo.status).toBe(400);
    });

    it('un link vencido no sirve', async () => {
      const { token } = await invitar();
      // Se lo envejece en la base: esperar 7 días no es una opción.
      await dataSource.query(
        `UPDATE tokens_acceso SET expira_el = NOW() - INTERVAL '1 minute'
          WHERE usado_el IS NULL AND tipo = 'invitacion'
            AND token_id = (SELECT token_id FROM tokens_acceso
                             WHERE usado_el IS NULL AND tipo = 'invitacion'
                             ORDER BY creado_el DESC LIMIT 1)`,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${token}`)
        .send({ contrasena: 'no-deberia-entrar' });

      expect(res.status).toBe(400);
    });

    // ⚠️ Toma de cuenta, medida. El link de invitación vive 7 DÍAS y queda en la
    // casilla. Si sobrevive al reset, cualquiera que tenga ese primer mail
    // —reenvío, casilla compartida, buzón comprometido antes del reset— vuelve
    // a fijar la contraseña y entra. Matar los refresh tokens del intruso no
    // alcanza si se le deja una llave de reentrada.
    it('el link de invitación viejo NO sobrevive a un reset', async () => {
      const { correo, token: invitacion } = await invitar();
      const [{ usuario_id: usuarioId }] = await dataSource.query<
        { usuario_id: string }[]
      >(`SELECT usuario_id FROM usuarios WHERE correo = $1`, [correo]);

      // La persona nunca usa la invitación: pide reset y elige su contraseña.
      const tokens = app.get(TokensAccesoService);
      const reset = await tokens.emitir(usuarioId, TipoTokenAcceso.RESET);
      const propia = await request(app.getHttpServer())
        .post(`/api/auth/recuperar/${reset}`)
        .send({ contrasena: 'la-mia-de-verdad' });
      expect(propia.status).toBe(200);

      // El link viejo tiene que estar muerto.
      const intruso = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${invitacion}`)
        .send({ contrasena: 'clave-del-intruso' });
      expect(intruso.status).toBe(400);

      // Y no solo el 400: la contraseña de la persona sigue siendo la suya.
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: 'clave-del-intruso' });
      expect(login.status).toBe(401);
    });

    // ⚠️ Este sostiene el `UPDATE ... WHERE usado_el IS NULL` de `quemar`, y va
    // contra el SERVICIO, no contra HTTP. Por HTTP no se puede: probé dos POST
    // en `Promise.all` y **no se solapan** —el segundo falla antes, en
    // `buscarVigente`, con otro mensaje—, así que ese test pasaba igual con la
    // guarda borrada. El mutante lo demostró.
    //
    // Quemar dos veces el mismo token tiene que fallar la segunda. Sin la
    // condición y sin mirar `affected`, el segundo `UPDATE` no toca ninguna
    // fila y **nadie se entera**: el doble submit fija la contraseña dos veces
    // y "un solo uso" queda decorativo.
    it('quemar el mismo token dos veces falla la segunda', async () => {
      const { token } = await invitar();
      const tokens = app.get(TokensAccesoService);
      const fila = await tokens.buscarVigente(
        token,
        TipoTokenAcceso.INVITACION,
      );

      await tokens.quemar(fila!.id);

      await expect(tokens.quemar(fila!.id)).rejects.toThrow(
        'Ese link ya fue usado',
      );
    });

    // El `update` va con `eliminadoEl: IsNull()` en el criterio y mira
    // `affected`. Sin eso, este camino escribe la contraseña sobre una fila
    // borrada —el `GET` hermano sí filtra, así que los dos endpoints del mismo
    // link se contradicen— y responde 200 como si hubiera pasado algo.
    it('sobre una cuenta borrada no escribe: 400 y la contraseña sigue nula', async () => {
      const { correo, token } = await invitar();
      await dataSource.query(
        `UPDATE usuarios SET eliminado_el = NOW() WHERE correo = $1`,
        [correo],
      );

      const res = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${token}`)
        .send({ contrasena: 'sobre-una-cuenta-muerta' });

      expect(res.status).toBe(400);
      const [{ contrasena }] = await dataSource.query<
        { contrasena: string | null }[]
      >(`SELECT contrasena FROM usuarios WHERE correo = $1`, [correo]);
      expect(contrasena).toBeNull();
    });

    it('un token de invitación no sirve como token de reset', async () => {
      const { token } = await invitar();

      // Mismo string, otra ruta: si el `tipo` no se chequeara, un link de
      // invitación de 7 días valdría como reset y al revés.
      const res = await request(app.getHttpServer())
        .post(`/api/auth/recuperar/${token}`)
        .send({ contrasena: 'clave-cruzada-1' });

      expect(res.status).toBe(400);
    });
  });

  describe('lo que se guarda', () => {
    it('en la base queda el HASH, nunca el token en claro', async () => {
      const { token } = await invitar();

      const filas = await dataSource.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM tokens_acceso WHERE token_hash = $1`,
        [token],
      );

      // Si se guardara el claro, esta búsqueda encontraría la fila.
      expect(Number(filas[0].n)).toBe(0);
      // Y con el hash sí aparece: la fila existe, lo que no está es el claro.
      // El hash se calcula acá y no con `digest()` de Postgres: eso ataría el
      // test a la extensión pgcrypto, que no está instalada.
      const porHash = await dataSource.query<{ n: string }[]>(
        `SELECT count(*) AS n FROM tokens_acceso WHERE token_hash = $1`,
        [createHash('sha256').update(token).digest('hex')],
      );
      expect(Number(porHash[0].n)).toBe(1);
    });
  });

  describe('recuperar contraseña', () => {
    // ⚠️ El endpoint es público y sin autenticación: si distinguiera, cualquiera
    // podría averiguar qué direcciones tienen cuenta probándolas de a una.
    it('responde IGUAL para un correo que existe y uno que no', async () => {
      const existe = await request(app.getHttpServer())
        .post('/api/auth/recuperar')
        .send({ correo: ADMIN_PARIS.email });
      const noExiste = await request(app.getHttpServer())
        .post('/api/auth/recuperar')
        .send({ correo: `fantasma-${Date.now()}@paris.cl` });

      expect(existe.status).toBe(noExiste.status);
      expect(existe.body).toEqual(noExiste.body);
    });

    it('pedirlo dos veces deja vivo solo el último link', async () => {
      const tokens = app.get(TokensAccesoService);
      const [{ usuario_id: usuarioId }] = await dataSource.query<
        { usuario_id: string }[]
      >(`SELECT usuario_id FROM usuarios WHERE correo = $1`, [
        ADMIN_PARIS.email,
      ]);

      const viejo = await tokens.emitir(usuarioId, TipoTokenAcceso.RESET);
      await request(app.getHttpServer())
        .post('/api/auth/recuperar')
        .send({ correo: ADMIN_PARIS.email });

      // El primero quedó invalidado por el segundo pedido: si no, la casilla
      // acumula links válidos y cualquiera de ellos abre la cuenta.
      const res = await request(app.getHttpServer()).get(
        `/api/auth/recuperar/${viejo}`,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('el entorno de test no manda mail', () => {
    // Si esto se pusiera rojo, cada corrida de la suite estaría disparando
    // mails reales y comiéndose el tope diario de la cuenta.
    it('MailService está en modo log, no en envío real', async () => {
      expect(app.get(MailService).envioReal).toBe(false);
    });
  });
});
