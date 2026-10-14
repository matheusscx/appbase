import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * Los límites de intentos (ADR-032) contra la app real: guard global, claves y
 * mensajes. El resto de la suite corre con `LIMITES_ESCALA=1000`
 * (`setup-env.ts`) para no chocarlos; acá la escala es 1 y los conteos se bajan
 * para que cada límite se alcance en pocos requests. **Las ventanas no se
 * tocan**: son las de producción, así que dentro de un test un balde nunca se
 * vacía solo.
 *
 * Cada test pega desde IPs propias (`x-cliente-ip` + el secreto del proxy, como
 * lo haría el frontend), así los baldes por IP de un test no se mezclan con los
 * de otro. La excepción es el test del secreto, que es justamente el que pega
 * sin él.
 */
const SECRETO = 'secreto-del-e2e-de-limites';
const LIMITES = {
  LIMITES_ESCALA: '1',
  PROXY_SECRETO: SECRETO,
  LIMITE_USUARIO_POR_MINUTO: '20',
  LIMITE_ANONIMO_POR_MINUTO: '4',
  LIMITE_LOGIN_POR_CORREO: '3',
  LIMITE_LOGIN_POR_IP: '3',
  LIMITE_REFRESH_POR_MINUTO: '2',
  LIMITE_CORREO_POR_DESTINO: '2',
  LIMITE_CORREO_POR_IP: '3',
  LIMITE_TOKEN_POR_MINUTO: '2',
};

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

let ipSiguiente = 1;
/** Una IP que ningún otro request del spec usó. */
function ipNueva(): string {
  const n = ipSiguiente++;
  return `203.0.${Math.floor(n / 250)}.${(n % 250) + 1}`;
}

describe('Límites de intentos (e2e)', () => {
  let app: INestApplication<App>;
  const previas: Record<string, string | undefined> = {};

  function api() {
    return request(app.getHttpServer());
  }

  /** Un request como lo manda el proxy del frontend, desde `ip`. */
  function desde<T extends request.Test>(req: T, ip: string): T {
    return req.set('x-proxy-secreto', SECRETO).set('x-cliente-ip', ip);
  }

  async function tokenDe(email: string, tenantId?: string): Promise<string> {
    const ip = ipNueva();
    const login = await desde(api().post('/api/auth/login'), ip).send({
      email,
      password: 'admin',
    });
    expect(login.status).toBe(200);
    const inicial = (login.body as { access_token: string }).access_token;
    if (!tenantId) return inicial;
    const sw = await desde(api().post('/api/auth/switch-tenant'), ip)
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set('Authorization', `Bearer ${inicial}`)
      .send({ tenantId });
    expect(sw.status).toBe(200);
    return (sw.body as { access_token: string }).access_token;
  }

  beforeAll(async () => {
    for (const [k, v] of Object.entries(LIMITES)) {
      previas[k] = process.env[k];
      process.env[k] = v;
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('global por usuario', () => {
    it('cuenta por persona en TODAS las rutas: el 21º request es 429, con Retry-After y el aviso', async () => {
      const token = await tokenDe('contador@paris.cl');
      // Alternando rutas a propósito: con la clave por defecto de la librería
      // (que incluye la ruta) serían 10 y 10, y ninguno llegaría a 20.
      for (let i = 0; i < 20; i++) {
        const ruta = i % 2 === 0 ? '/api/auth/me' : '/api/auth/my-tenants';
        const res = await desde(api().get(ruta), ipNueva()).set(
          'Authorization',
          `Bearer ${token}`,
        );
        expect(res.status).toBe(200);
      }
      const choque = await desde(api().get('/api/auth/me'), ipNueva()).set(
        'Authorization',
        `Bearer ${token}`,
      );
      expect(choque.status).toBe(429);
      expect(Number(choque.headers['retry-after'])).toBeGreaterThan(0);
      expect((choque.body as { message: string }).message).toMatch(
        /^Demasiadas solicitudes seguidas\. Esperá \d+ segundos y volvé a intentar\.$/,
      );

      // Otra persona, desde la misma IP de recién: su balde está intacto.
      const otro = await tokenDe('admin.paris@paris.cl');
      const res = await desde(api().get('/api/auth/me'), ipNueva()).set(
        'Authorization',
        `Bearer ${otro}`,
      );
      expect(res.status).toBe(200);
    });

    it('un token vencido pero bien firmado sigue contando a su dueño, no a la IP', async () => {
      const jwt = new JwtService({});
      const vencido = jwt.sign(
        { sub: '550e8400-e29b-41d4-a716-446655440999', tenant_id: null },
        { secret: process.env.JWT_SECRET!, expiresIn: -60 },
      );
      // IP distinta en cada request: si contara por IP, nunca llegaría al límite.
      for (let i = 0; i < 20; i++) {
        const res = await desde(api().get('/api/auth/me'), ipNueva()).set(
          'Authorization',
          `Bearer ${vencido}`,
        );
        expect(res.status).toBe(401);
      }
      const choque = await desde(api().get('/api/auth/me'), ipNueva()).set(
        'Authorization',
        `Bearer ${vencido}`,
      );
      expect(choque.status).toBe(429);
    });

    it('un sub sin firma válida NO estrena balde: cuenta como anónimo, por IP', async () => {
      const jwt = new JwtService({});
      const ip = ipNueva();
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        // Un `sub` distinto en cada request, firmado con un secreto inventado.
        const falso = jwt.sign(
          { sub: `atacante-${i}`, tenant_id: null },
          { secret: 'no-es-el-secreto' },
        );
        const res = await desde(api().get('/api/auth/me'), ip).set(
          'Authorization',
          `Bearer ${falso}`,
        );
        estados.push(res.status);
      }
      expect(estados).toEqual([401, 401, 401, 401, 429]);
    });
  });

  describe('global anónimo por IP', () => {
    it('cada IP tiene su balde: la quinta de una IP es 429 y otra IP sigue', async () => {
      const ip = ipNueva();
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        estados.push((await desde(api().get('/api'), ip)).status);
      }
      expect(estados).toEqual([200, 200, 200, 200, 429]);
      expect((await desde(api().get('/api'), ipNueva())).status).toBe(200);
    });

    it('sin el secreto del proxy, x-cliente-ip no cuenta: rotarla no da baldes nuevos', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await api()
          .get('/api')
          .set('x-cliente-ip', ipNueva())
          .set('x-proxy-secreto', 'adivinado');
        estados.push(res.status);
      }
      expect(estados).toEqual([200, 200, 200, 200, 429]);
    });

    it('/api/health no se limita: el healthcheck del deploy pega desde una IP compartida', async () => {
      const ip = ipNueva();
      for (let i = 0; i < 8; i++) {
        expect((await desde(api().get('/api/health'), ip)).status).toBe(200);
      }
    });
  });

  describe('login', () => {
    it('por correo: el cuarto intento es 429 aunque venga de otra IP, y el aviso ofrece recuperar', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await desde(api().post('/api/auth/login'), ipNueva()).send({
          email: 'nadie.limites@ejemplo.cl',
          password: 'equivocada',
        });
        estados.push(res.status);
        // Sin `X-RateLimit-*` del límite por correo: le contaría a cualquiera
        // cuánta actividad tuvo una casilla ajena.
        expect(
          res.headers['x-ratelimit-remaining-login-correo'],
        ).toBeUndefined();
      }
      expect(estados).toEqual([401, 401, 401]);
      // Mayúsculas y espacios son el mismo correo.
      const choque = await desde(api().post('/api/auth/login'), ipNueva()).send(
        {
          email: '  Nadie.Limites@EJEMPLO.cl ',
          password: 'equivocada',
        },
      );
      expect(choque.status).toBe(429);
      expect((choque.body as { message: string }).message).toMatch(
        /^Demasiados intentos de ingreso\. Probá de nuevo en \d+ minutos o recuperá tu contraseña\.$/,
      );
      // Otro correo, otro balde.
      const otro = await desde(api().post('/api/auth/login'), ipNueva()).send({
        email: 'otro.limites@ejemplo.cl',
        password: 'equivocada',
      });
      expect(otro.status).toBe(401);
    });

    it('el correo por query cuenta en el balde del correo, como lo lee passport', async () => {
      // passport-local toma el `email` del body si es un escalar no vacío y,
      // si no, el de la query. Con la clave sacada solo del body, `?email=`
      // autenticaba contra la casilla y contaba en otro balde. Los tres
      // intentos cubren las tres ramas: sin `email` en el body, con `email`
      // vacío (cae a la query igual), y con los dos (gana el body).
      const intentos: { ruta: string; body: Record<string, string> }[] = [
        { ruta: '?email=por.query@ejemplo.cl', body: {} },
        { ruta: '?email=por.query@ejemplo.cl', body: { email: '' } },
        {
          ruta: '?email=otro.query@ejemplo.cl',
          body: { email: 'por.query@ejemplo.cl' },
        },
      ];
      const estados: number[] = [];
      for (const { ruta, body } of intentos) {
        const res = await desde(
          api().post(`/api/auth/login${ruta}`),
          ipNueva(),
        ).send({ ...body, password: 'equivocada' });
        estados.push(res.status);
      }
      expect(estados).toEqual([401, 401, 401]);
      const porBody = await desde(
        api().post('/api/auth/login'),
        ipNueva(),
      ).send({ email: 'por.query@ejemplo.cl', password: 'equivocada' });
      expect(porBody.status).toBe(429);
    });

    it('por IP: probar muchos correos desde la misma IP también corta', async () => {
      const ip = ipNueva();
      const correos = [
        'rociado.0@ejemplo.cl',
        'rociado.1@ejemplo.cl',
        'rociado.2@ejemplo.cl',
        'rociado.nuevo@ejemplo.cl',
      ];
      const estados: number[] = [];
      for (const email of correos) {
        const res = await desde(api().post('/api/auth/login'), ip).send({
          email,
          password: 'equivocada',
        });
        estados.push(res.status);
      }
      expect(estados).toEqual([401, 401, 401, 429]);

      // El cuarto lo cortó el límite por IP, que se evalúa ANTES que el de
      // correo: a `rociado.nuevo` no le sumó nada. Si sumara, cada correo que
      // invente una IP ya bloqueada dejaría una clave en memoria, y el dueño de
      // la casilla pagaría intentos que nunca pasaron. Desde otras IPs le
      // quedan los tres enteros.
      const despues: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await desde(api().post('/api/auth/login'), ipNueva()).send({
          email: 'rociado.nuevo@ejemplo.cl',
          password: 'equivocada',
        });
        despues.push(res.status);
      }
      expect(despues).toEqual([401, 401, 401]);
    });

    it('un correo fuera de ASCII cae en un balde común: Postgres lo minusculiza distinto que JS', async () => {
      // `İ` es `i` para LOWER() de Postgres y `i̇` para JavaScript: con claves
      // por texto, cada variante encontraría la misma cuenta en un balde nuevo.
      const variantes = [
        'vİctima@ejemplo.cl',
        'vİctİma@ejemplo.cl',
        'VİCTIMA@ejemplo.cl',
        'victİma@ejemplo.cl',
      ];
      const estados: number[] = [];
      for (const email of variantes) {
        const res = await desde(api().post('/api/auth/login'), ipNueva()).send({
          email,
          password: 'equivocada',
        });
        estados.push(res.status);
      }
      expect(estados).toEqual([401, 401, 401, 429]);
    });
  });

  describe('correos salientes', () => {
    it('recuperar, por destino: el tercer pedido a la misma casilla es 429, venga de donde venga', async () => {
      const estados: number[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await desde(
          api().post('/api/auth/recuperar'),
          ipNueva(),
        ).send({ correo: 'casilla.ajena@ejemplo.cl' });
        estados.push(res.status);
      }
      expect(estados).toEqual([200, 200, 429]);
    });

    it('recuperar, por IP: muchas casillas desde la misma IP también corta', async () => {
      const ip = ipNueva();
      const respuestas: request.Response[] = [];
      for (let i = 0; i < 4; i++) {
        respuestas.push(
          await desde(api().post('/api/auth/recuperar'), ip).send({
            correo: `casilla.${i}@ejemplo.cl`,
          }),
        );
      }
      expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 429]);
      // El cuarto lo corta el límite de correos, no el anónimo (que es de 4 y
      // recién se gasta en el quinto): por eso el aviso habla de correos.
      expect((respuestas[3].body as { message: string }).message).toMatch(
        /^Ya se enviaron varios correos seguidos\. Esperá \d+ minutos antes de pedir otro\.$/,
      );
    });
  });

  it('los links con token: el tercero desde la misma IP es 429', async () => {
    const ip = ipNueva();
    const estados: number[] = [];
    for (let i = 0; i < 3; i++) {
      estados.push(
        (await desde(api().get(`/api/auth/recuperar/token-${i}`), ip)).status,
      );
    }
    expect(estados.slice(0, 2)).not.toContain(429);
    expect(estados[2]).toBe(429);
  });

  it('el link de confirmación de ingreso a un tenant también: el tercero desde la misma IP es 429', async () => {
    const ip = ipNueva();
    const estados: number[] = [];
    for (let i = 0; i < 3; i++) {
      estados.push(
        (await desde(api().get(`/api/tenants/confirmacion/token-${i}`), ip))
          .status,
      );
    }
    expect(estados.slice(0, 2)).not.toContain(429);
    expect(estados[2]).toBe(429);
  });

  it('refresh: el tercero desde la misma IP es 429', async () => {
    const ip = ipNueva();
    const estados: number[] = [];
    for (let i = 0; i < 3; i++) {
      estados.push((await desde(api().post('/api/auth/refresh'), ip)).status);
    }
    expect(estados).toEqual([401, 401, 429]);
  });

  describe('PIN de garzón', () => {
    it('cinco fallos seguidos por cualquiera de sus puertas lo bloquean, y bloqueado ni el PIN correcto entra', async () => {
      const token = await tokenDe('admin.paris@paris.cl', PARIS_TENANT_ID);
      const auth = { Authorization: `Bearer ${token}` };
      const alta = await desde(api().post('/api/garzones'), ipNueva())
        .set(auth)
        .send({ nombre: `Garzón límites ${Date.now()}` });
      expect(alta.status).toBe(201);
      const garzon = alta.body as { id: string; pin: string };
      const equivocado = garzon.pin === '000000' ? '111111' : '000000';

      try {
        // Cuatro por la puerta de solo lectura, dos con el id en mayúsculas:
        // el DTO lo acepta y la base encuentra al mismo garzón, así que tiene
        // que contar en el mismo cupo…
        for (let i = 0; i < 4; i++) {
          const res = await desde(
            api().post('/api/garzones/verificar-pin'),
            ipNueva(),
          )
            .set(auth)
            .send({
              garzonId: i % 2 === 0 ? garzon.id : garzon.id.toUpperCase(),
              pin: equivocado,
            });
          expect(res.status).toBe(400);
        }
        // …y el quinto por otra: el contador es del garzón, no de la ruta.
        const quinto = await desde(
          api().post('/api/sesiones-garzon/activa'),
          ipNueva(),
        )
          .set(auth)
          .send({ garzonId: garzon.id.toUpperCase(), pin: equivocado });
        expect(quinto.status).toBe(429);
        expect((quinto.body as { message: string }).message).toMatch(
          /^PIN bloqueado por intentos fallidos\. Esperá 5 minutos/,
        );

        const correcto = await desde(
          api().post('/api/garzones/verificar-pin'),
          ipNueva(),
        )
          .set(auth)
          .send({ garzonId: garzon.id, pin: garzon.pin });
        expect(correcto.status).toBe(429);
      } finally {
        await desde(api().delete(`/api/garzones/${garzon.id}`), ipNueva()).set(
          auth,
        );
      }
    });

    // La revisión independiente lo encontró abierto: si el intento se contara
    // recién al fallar, diez en paralelo pasarían el chequeo antes de que el
    // primero falle y llegarían todos al bcrypt.
    it('diez PINes equivocados en paralelo: a lo sumo cuatro llegan a dar 400, y queda bloqueado', async () => {
      const token = await tokenDe('admin@sistema.com', PARIS_TENANT_ID);
      const auth = { Authorization: `Bearer ${token}` };
      const alta = await desde(api().post('/api/garzones'), ipNueva())
        .set(auth)
        .send({ nombre: `Garzón límites paralelo ${Date.now()}` });
      expect(alta.status).toBe(201);
      const garzon = alta.body as { id: string; pin: string };
      const equivocado = garzon.pin === '000000' ? '111111' : '000000';

      try {
        const respuestas = await Promise.all(
          Array.from({ length: 10 }, () =>
            desde(api().post('/api/garzones/verificar-pin'), ipNueva())
              .set(auth)
              .send({ garzonId: garzon.id, pin: equivocado }),
          ),
        );
        const estados = respuestas.map((r) => r.status);
        expect(estados.filter((e) => e !== 400 && e !== 429)).toEqual([]);
        expect(estados.filter((e) => e === 400).length).toBeLessThanOrEqual(4);

        const correcto = await desde(
          api().post('/api/garzones/verificar-pin'),
          ipNueva(),
        )
          .set(auth)
          .send({ garzonId: garzon.id, pin: garzon.pin });
        expect(correcto.status).toBe(429);
      } finally {
        await desde(api().delete(`/api/garzones/${garzon.id}`), ipNueva()).set(
          auth,
        );
      }
    });
  });
});
