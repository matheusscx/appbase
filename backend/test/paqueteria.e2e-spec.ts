import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import type {
  HojaRutaDetalle,
  HojaRutaFila,
  PaqueteConfiguracionRespuesta,
  PaqueteFila,
  RepartidorFila,
  TarifaPagoFila,
  RendicionDetalle,
  RendicionFila,
  RespuestaEscaneo,
  ResumenPaqueteria,
  EntregaRepartidorFila,
} from '../src/modules/paqueteria/paqueteria.types';
import type { PaginatedResponse } from '../src/common/interfaces/paginated-response.interface';
import { fechaMenosDias } from '../src/common/utils/rango-fecha.util';
import { MOTIVOS_BAJA_FIJOS } from '../src/modules/motivos-baja/motivos-baja.defaults';
import { MOTIVOS_DIFERENCIA_DEFAULTS } from '../src/modules/motivos-diferencia/motivos-diferencia.defaults';
import { MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS } from '../src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.defaults';
import { MOTIVOS_TRASLADO_FIJOS } from '../src/modules/motivos-traslado/motivos-traslado.defaults';
import { SeederService } from '../src/modules/seeder/seeder.service';
import { correrCarrera } from './helpers/carrera';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' }; // no es admin del tenant

interface TokenResponse {
  access_token: string;
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

describe('Paquetería — configuración y repartidores (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenSegundoTenant: string;
  const creados: string[] = [];

  const llamar = (
    metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
    ruta: string,
    token = tokenAdmin,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  // Las tarifas de pago que los describes necesitan para crear paquetes y entregar. Se piden por
  // monto (una por monto y tenant) y se marcan borradas con SQL al terminar: la API no deja borrar
  // la por defecto. La primera que se crea en un tenant queda por defecto, así que cada describe
  // pide primero la de 5.000 (el pago de siempre).
  const tarifasDePrueba = new Map<string, string>();
  const sufijoTarifas = Date.now();
  const tarifaPorMonto = async (
    monto: string,
    token = tokenAdmin,
  ): Promise<string> => {
    const clave = `${token}:${monto}`;
    const hecha = tarifasDePrueba.get(clave);
    if (hecha) return hecha;
    const res = await llamar('post', '/api/tarifas-pago', token, {
      nombre: `E2E pago ${monto} ${sufijoTarifas}`,
      monto,
    });
    expect(res.status).toBe(201);
    const id = (res.body as TarifaPagoFila).id;
    tarifasDePrueba.set(clave, id);
    return id;
  };
  /** Una tarifa solo de este caso (nombre único), para poder cambiarle el monto sin tocar la de los demás. */
  const tarifaPropia = async (
    etiqueta: string,
    monto: string,
  ): Promise<TarifaPagoFila> => {
    const res = await llamar('post', '/api/tarifas-pago', tokenAdmin, {
      nombre: `E2E ${etiqueta} ${sufijoTarifas}`,
      monto,
    });
    expect(res.status).toBe(201);
    const fila = res.body as TarifaPagoFila;
    tarifasDePrueba.set(`propia:${etiqueta}:${sufijoTarifas}`, fila.id);
    return fila;
  };
  const limpiarTarifasDePrueba = async () => {
    if (!tarifasDePrueba.size) return;
    await app
      .get(DataSource)
      .query(
        `UPDATE tarifas_pago SET eliminado_el = now() WHERE tarifa_pago_id = ANY($1)`,
        [[...tarifasDePrueba.values()]],
      );
    tarifasDePrueba.clear();
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
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
    tokenSegundoTenant = await loginSegundoTenant(app);
  });

  afterAll(async () => {
    // El `close` va en un `finally` y la aserción DESPUÉS (molde: `cajones.e2e-spec.ts`).
    const fallos: string[] = [];
    try {
      for (const id of creados) {
        const res = await llamar('delete', `/api/repartidores/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE repartidor ${id} → ${res.status}`);
        }
      }
    } finally {
      await limpiarTarifasDePrueba();
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('el vendedor (no admin) recibe 403 en las rutas del módulo', async () => {
    for (const [metodo, ruta] of [
      ['get', '/api/paquetes/configuracion'],
      ['put', '/api/paquetes/configuracion'],
      ['get', '/api/tarifas-pago'],
      ['post', '/api/tarifas-pago'],
      ['get', '/api/repartidores'],
      ['post', '/api/repartidores'],
      ['get', '/api/paquetes'],
      ['post', '/api/paquetes'],
      ['post', '/api/hojas-ruta/escanear'],
      ['post', '/api/hojas-ruta/asignar'],
      ['get', '/api/hojas-ruta?desde=2026-10-01&hasta=2026-10-31'],
      ['get', '/api/entregas-repartidor'],
      ['post', '/api/entregas-repartidor'],
      ['get', '/api/rendiciones?desde=2026-10-01&hasta=2026-10-31'],
      [
        'get',
        '/api/rendiciones/previa?repartidorId=550e8400-e29b-41d4-a716-446655440999&hojaIds=550e8400-e29b-41d4-a716-446655440998',
      ],
      ['post', '/api/rendiciones'],
      ['get', '/api/rendiciones/550e8400-e29b-41d4-a716-446655440999'],
    ] as const) {
      const res = await llamar(metodo, ruta, tokenVendedor, {});
      expect(res.status).toBe(403);
    }
  });

  describe('configuración', () => {
    // Estado único del tenant Paris: este describe lo deja siempre en 10000 (el valor del seed),
    // así ningún otro spec ve otra cosa. El pago al repartidor ya no se configura acá: son las
    // tarifas de pago, y `configurada` exige una por defecto.
    it('PUT guarda y GET lo devuelve; sin tarifa por defecto no está configurada; un monto con decimales en CLP es 400', async () => {
      const ok = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '10000' },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        configurada: false,
        precioEnvioDefecto: '10000.0000',
      });
      expect(ok.body).not.toHaveProperty('pagoRepartidorDefecto');

      await tarifaPorMonto('5000');
      const leida = await llamar('get', '/api/paquetes/configuracion');
      expect(leida.status).toBe(200);
      expect(leida.body as PaqueteConfiguracionRespuesta).toEqual({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
      });

      const malo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '10000.5' },
      );
      expect(malo.status).toBe(400);
    });

    it('el pago por defecto ya no es un campo de la configuración: mandarlo es 400', async () => {
      const res = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(res.status).toBe(400);
    });

    it('PUT sin uno de los campos, o con un monto negativo: 400', async () => {
      const falta = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {},
      );
      expect(falta.status).toBe(400);
      const negativo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '-1' },
      );
      expect(negativo.status).toBe(400);
    });

    it('cada tenant tiene la suya: el segundo no ve los montos de Paris', async () => {
      const paris = await llamar('get', '/api/paquetes/configuracion');
      expect(paris.status).toBe(200);
      expect((paris.body as PaqueteConfiguracionRespuesta).configurada).toBe(
        true,
      );

      const ajena = await llamar(
        'get',
        '/api/paquetes/configuracion',
        tokenSegundoTenant,
      );
      expect(ajena.status).toBe(200);
      expect(ajena.body).not.toEqual(paris.body);
    });
  });

  describe('tarifas de pago', () => {
    // El describe parte de cero tarifas en Paris y las deja en cero: la API no deja borrar la
    // última (es la del defecto), así que el cierre las marca con SQL, como las marca un soft delete.
    const tarifas: string[] = [];
    const repartidores: string[] = [];
    const paquetesIds: string[] = [];
    const sufijo = Date.now();
    const nuevaTarifa = async (cuerpo: object, token = tokenAdmin) => {
      const res = await llamar('post', '/api/tarifas-pago', token, cuerpo);
      expect(res.status).toBe(201);
      const fila = res.body as TarifaPagoFila;
      tarifas.push(fila.id);
      return fila;
    };
    const listar = async () => {
      const res = await llamar('get', '/api/tarifas-pago');
      expect(res.status).toBe(200);
      return res.body as TarifaPagoFila[];
    };
    const nuevoRepartidor = async (cuerpo: object = {}) => {
      const res = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E tarifa ${sufijo} ${repartidores.length}`,
        ...cuerpo,
      });
      expect(res.status).toBe(201);
      const fila = res.body as RepartidorFila;
      repartidores.push(fila.id);
      return fila;
    };

    // El describe de configuración dejó una tarifa de prueba en Paris: acá se parte de cero.
    beforeAll(async () => {
      await limpiarTarifasDePrueba();
    });

    afterAll(async () => {
      const ds = app.get(DataSource);
      if (paquetesIds.length) {
        await ds.query(
          `UPDATE paquetes SET eliminado_el = now() WHERE paquete_id = ANY($1)`,
          [paquetesIds],
        );
      }
      for (const id of repartidores) {
        await llamar('delete', `/api/repartidores/${id}`);
      }
      await ds.query(
        `UPDATE tarifas_pago SET eliminado_el = now() WHERE tarifa_pago_id = ANY($1)`,
        [tarifas],
      );
    });

    it('sin ninguna tarifa cargada, crear o escanear un paquete nuevo es 400 y no deja nada', async () => {
      expect(await listar()).toEqual([]);
      const codigo = `E2E-SIN-TARIFA-${sufijo}`;
      const alta = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo,
        cobroEnDestino: false,
        precioEnvio: '8000',
      });
      expect(alta.status).toBe(400);
      expect((alta.body as { message: string }).message).toContain(
        'al menos una tarifa de pago',
      );
      const rep = await nuevoRepartidor();
      const escaneo = await llamar(
        'post',
        '/api/hojas-ruta/escanear',
        tokenAdmin,
        {
          repartidorId: rep.id,
          fecha: '2026-10-15',
          codigo,
          cobroEnDestino: false,
        },
      );
      expect(escaneo.status).toBe(400);
      expect((escaneo.body as { message: string }).message).toContain(
        'al menos una tarifa de pago',
      );
      const l = await llamar('get', `/api/paquetes?q=${codigo}`);
      expect(l.status).toBe(200);
      expect((l.body as { data: PaqueteFila[] }).data).toEqual([]);
    });

    it('la primera tarifa queda por defecto aunque no se pida; la segunda no', async () => {
      expect(await listar()).toEqual([]);
      const moto = await nuevaTarifa({
        nombre: `Moto ${sufijo}`,
        monto: '1900',
      });
      expect(moto).toMatchObject({
        esDefecto: true,
        activa: true,
        monto: '1900.0000',
      });
      const auto = await nuevaTarifa({
        nombre: `Auto ${sufijo}`,
        monto: '2500',
      });
      expect(auto.esDefecto).toBe(false);
    });

    it('PATCH { esDefecto: true } sobre otra deja exactamente una por defecto', async () => {
      const [moto, auto] = tarifas;
      const res = await llamar(
        'patch',
        `/api/tarifas-pago/${auto}`,
        tokenAdmin,
        {
          esDefecto: true,
        },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: auto, esDefecto: true });
      const defectos = (await listar()).filter((t) => t.esDefecto);
      expect(defectos.map((t) => t.id)).toEqual([auto]);
      // Devuelve el defecto a la primera: el resto de los casos parte de ahí.
      const vuelta = await llamar(
        'patch',
        `/api/tarifas-pago/${moto}`,
        tokenAdmin,
        {
          esDefecto: true,
        },
      );
      expect(vuelta.status).toBe(200);
      expect(
        (await listar()).filter((t) => t.esDefecto).map((t) => t.id),
      ).toEqual([moto]);
    });

    it('desactivar o borrar la por defecto: 400 con el aviso, y sigue igual', async () => {
      const [moto] = tarifas;
      const off = await llamar(
        'patch',
        `/api/tarifas-pago/${moto}`,
        tokenAdmin,
        {
          activa: false,
        },
      );
      expect(off.status).toBe(400);
      expect(JSON.stringify(off.body)).toContain(
        'Elegí otra tarifa por defecto antes de',
      );
      const del = await llamar('delete', `/api/tarifas-pago/${moto}`);
      expect(del.status).toBe(400);
      expect(JSON.stringify(del.body)).toContain(
        'Elegí otra tarifa por defecto antes de',
      );
      expect((await listar()).find((t) => t.id === moto)).toMatchObject({
        esDefecto: true,
        activa: true,
      });
    });

    it('un monto con más decimales que la moneda oficial (CLP: 1900.5), o negativo: 400', async () => {
      const decimales = await llamar('post', '/api/tarifas-pago', tokenAdmin, {
        nombre: `Decimales ${sufijo}`,
        monto: '1900.5',
      });
      expect(decimales.status).toBe(400);
      const negativo = await llamar('post', '/api/tarifas-pago', tokenAdmin, {
        nombre: `Negativo ${sufijo}`,
        monto: '-1',
      });
      expect(negativo.status).toBe(400);
      const [, auto] = tarifas;
      const patch = await llamar(
        'patch',
        `/api/tarifas-pago/${auto}`,
        tokenAdmin,
        {
          monto: '1900.5',
        },
      );
      expect(patch.status).toBe(400);
    });

    it('nombre repetido, sin distinguir mayúsculas: 409; renombrar a uno existente también', async () => {
      const dup = await llamar('post', '/api/tarifas-pago', tokenAdmin, {
        nombre: `MOTO ${sufijo}`,
        monto: '1000',
      });
      expect(dup.status).toBe(409);
      const [, auto] = tarifas;
      const renombre = await llamar(
        'patch',
        `/api/tarifas-pago/${auto}`,
        tokenAdmin,
        {
          nombre: `moto ${sufijo}`,
        },
      );
      expect(renombre.status).toBe(409);
    });

    it('PATCH del monto y del nombre; un PATCH vacío la deja igual', async () => {
      const [, auto] = tarifas;
      const res = await llamar(
        'patch',
        `/api/tarifas-pago/${auto}`,
        tokenAdmin,
        {
          monto: '2600',
        },
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: auto,
        monto: '2600.0000',
        nombre: `Auto ${sufijo}`,
        esDefecto: false,
      });
      const vacio = await llamar(
        'patch',
        `/api/tarifas-pago/${auto}`,
        tokenAdmin,
        {},
      );
      expect(vacio.status).toBe(200);
      expect(vacio.body).toMatchObject({ id: auto, monto: '2600.0000' });
    });

    it('el repartidor acepta una tarifa propia activa; con null se la saca', async () => {
      const [, auto] = tarifas;
      const rep = await nuevoRepartidor({ tarifaPagoId: auto });
      expect(rep.tarifaPagoId).toBe(auto);

      const otro = await nuevoRepartidor();
      expect(otro.tarifaPagoId).toBeNull();
      const pone = await llamar(
        'patch',
        `/api/repartidores/${otro.id}`,
        tokenAdmin,
        {
          tarifaPagoId: auto,
        },
      );
      expect(pone.status).toBe(200);
      expect(pone.body).toMatchObject({ tarifaPagoId: auto });
      const saca = await llamar(
        'patch',
        `/api/repartidores/${otro.id}`,
        tokenAdmin,
        {
          tarifaPagoId: null,
        },
      );
      expect(saca.status).toBe(200);
      expect(saca.body).toMatchObject({ tarifaPagoId: null });
    });

    it('PATCH /repartidores con una tarifa de otro tenant, inactiva o inexistente: 400 y queda igual', async () => {
      const ajena = await llamar(
        'post',
        '/api/tarifas-pago',
        tokenSegundoTenant,
        {
          nombre: `Ajena ${sufijo}`,
          monto: '1000',
        },
      );
      expect(ajena.status).toBe(201);
      const ajenaId = (ajena.body as TarifaPagoFila).id;
      tarifas.push(ajenaId);

      const inactiva = await nuevaTarifa({
        nombre: `Inactiva ${sufijo}`,
        monto: '700',
      });
      const off = await llamar(
        'patch',
        `/api/tarifas-pago/${inactiva.id}`,
        tokenAdmin,
        {
          activa: false,
        },
      );
      expect(off.status).toBe(200);

      const rep = await nuevoRepartidor();
      for (const tarifaPagoId of [
        ajenaId,
        inactiva.id,
        '550e8400-e29b-41d4-a716-446655440999',
      ]) {
        const res = await llamar(
          'patch',
          `/api/repartidores/${rep.id}`,
          tokenAdmin,
          {
            tarifaPagoId,
          },
        );
        expect(res.status).toBe(400);
        const alta = await llamar('post', '/api/repartidores', tokenAdmin, {
          nombre: `E2E rechazado ${sufijo}`,
          tarifaPagoId,
        });
        expect(alta.status).toBe(400);
      }
      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect(
        (lista.body as RepartidorFila[]).find((r) => r.id === rep.id),
      ).toMatchObject({ tarifaPagoId: null });
      expect(
        (lista.body as RepartidorFila[]).some(
          (r) => r.nombre === `E2E rechazado ${sufijo}`,
        ),
      ).toBe(false);

      const ajenaDelOtro = await llamar(
        'patch',
        `/api/tarifas-pago/${ajenaId}`,
        tokenAdmin,
        {
          nombre: 'x',
        },
      );
      expect(ajenaDelOtro.status).toBe(404);
    });

    it('reenviar la misma tarifa ya desactivada no bloquea editar otro campo del paquete ni del repartidor', async () => {
      const usada = await nuevaTarifa({
        nombre: `Reenviada ${sufijo}`,
        monto: '850',
      });
      const rep = await nuevoRepartidor({ tarifaPagoId: usada.id });
      const paq = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo: `E2E-REENVIO-${sufijo}`,
        cobroEnDestino: false,
        tarifaPagoId: usada.id,
      });
      expect(paq.status).toBe(201);
      const paqId = (paq.body as PaqueteFila).id;
      paquetesIds.push(paqId);
      const off = await llamar(
        'patch',
        `/api/tarifas-pago/${usada.id}`,
        tokenAdmin,
        { activa: false },
      );
      expect(off.status).toBe(200);

      // El formulario reenvía todos los campos: la misma tarifa, ahora inactiva, no es un cambio.
      const editaRep = await llamar(
        'patch',
        `/api/repartidores/${rep.id}`,
        tokenAdmin,
        { nombre: `E2E reenvío ${sufijo}`, tarifaPagoId: usada.id },
      );
      expect(editaRep.status).toBe(200);
      expect(editaRep.body).toMatchObject({ tarifaPagoId: usada.id });
      const editaPaq = await llamar(
        'patch',
        `/api/paquetes/${paqId}`,
        tokenAdmin,
        { direccion: 'Alameda 100', tarifaPagoId: usada.id },
      );
      expect(editaPaq.status).toBe(200);
      expect(editaPaq.body).toMatchObject({
        direccion: 'Alameda 100',
        tarifaPagoId: usada.id,
      });

      // Una tarifa inactiva DISTINTA de la que tiene sigue siendo 400.
      const otraInactiva = await nuevaTarifa({
        nombre: `OtraInactiva ${sufijo}`,
        monto: '860',
      });
      await llamar(
        'patch',
        `/api/tarifas-pago/${otraInactiva.id}`,
        tokenAdmin,
        {
          activa: false,
        },
      );
      expect(
        (
          await llamar('patch', `/api/repartidores/${rep.id}`, tokenAdmin, {
            tarifaPagoId: otraInactiva.id,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await llamar('patch', `/api/paquetes/${paqId}`, tokenAdmin, {
            tarifaPagoId: otraInactiva.id,
          })
        ).status,
      ).toBe(400);
    });

    it('borrar una usada por un repartidor o por un paquete: 400 y se desactiva; sin uso se borra', async () => {
      const enRep = await nuevaTarifa({
        nombre: `EnRepartidor ${sufijo}`,
        monto: '800',
      });
      await nuevoRepartidor({ tarifaPagoId: enRep.id });
      const delRep = await llamar('delete', `/api/tarifas-pago/${enRep.id}`);
      expect(delRep.status).toBe(400);
      const desactiva = await llamar(
        'patch',
        `/api/tarifas-pago/${enRep.id}`,
        tokenAdmin,
        {
          activa: false,
        },
      );
      expect(desactiva.status).toBe(200);
      expect((await listar()).find((t) => t.id === enRep.id)).toMatchObject({
        activa: false,
      });

      const enPaq = await nuevaTarifa({
        nombre: `EnPaquete ${sufijo}`,
        monto: '900',
      });
      const paq = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo: `E2E-TARIFA-${sufijo}`,
        cobroEnDestino: false,
      });
      expect(paq.status).toBe(201);
      const paqId = (paq.body as PaqueteFila).id;
      paquetesIds.push(paqId);
      const asigna = await llamar(
        'patch',
        `/api/paquetes/${paqId}`,
        tokenAdmin,
        {
          tarifaPagoId: enPaq.id,
        },
      );
      expect(asigna.status).toBe(200);
      expect(asigna.body).toMatchObject({
        tarifaPagoId: enPaq.id,
        tarifaPagoNombre: enPaq.nombre,
      });
      const delPaq = await llamar('delete', `/api/tarifas-pago/${enPaq.id}`);
      expect(delPaq.status).toBe(400);

      const libre = await nuevaTarifa({
        nombre: `Libre ${sufijo}`,
        monto: '100',
      });
      const delLibre = await llamar('delete', `/api/tarifas-pago/${libre.id}`);
      expect(delLibre.status).toBe(200);
      expect((await listar()).some((t) => t.id === libre.id)).toBe(false);
      expect(
        (await llamar('delete', `/api/tarifas-pago/${libre.id}`)).status,
      ).toBe(404);
    });

    it('paquete: crear, escanear y editar con una tarifa ajena, inactiva o inexistente es 400 y no escribe', async () => {
      const ajena = await llamar(
        'post',
        '/api/tarifas-pago',
        tokenSegundoTenant,
        {
          nombre: `Ajena de paquete (${sufijo})`,
          monto: '700',
        },
      );
      expect(ajena.status).toBe(201);
      tarifas.push((ajena.body as TarifaPagoFila).id);
      const inactiva = await nuevaTarifa({
        nombre: `Inactiva paquete ${sufijo}`,
        monto: '600',
      });
      const apaga = await llamar(
        'patch',
        `/api/tarifas-pago/${inactiva.id}`,
        tokenAdmin,
        { activa: false },
      );
      expect(apaga.status).toBe(200);
      const rep = await nuevoRepartidor();
      const existente = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo: `E2E-TARIFA-EDIT-${sufijo}`,
        cobroEnDestino: false,
      });
      expect(existente.status).toBe(201);
      const existenteId = (existente.body as PaqueteFila).id;
      paquetesIds.push(existenteId);

      for (const tarifaPagoId of [
        (ajena.body as TarifaPagoFila).id,
        inactiva.id,
        '550e8400-e29b-41d4-a716-446655440998',
      ]) {
        const alta = await llamar('post', '/api/paquetes', tokenAdmin, {
          codigo: `E2E-TARIFA-MALA-${sufijo}`,
          cobroEnDestino: false,
          tarifaPagoId,
        });
        expect(alta.status).toBe(400);
        const escaneo = await llamar(
          'post',
          '/api/hojas-ruta/escanear',
          tokenAdmin,
          {
            repartidorId: rep.id,
            fecha: '2026-10-15',
            codigo: `E2E-TARIFA-MALA-${sufijo}`,
            cobroEnDestino: false,
            tarifaPagoId,
          },
        );
        expect(escaneo.status).toBe(400);
        const edicion = await llamar(
          'patch',
          `/api/paquetes/${existenteId}`,
          tokenAdmin,
          { tarifaPagoId },
        );
        expect(edicion.status).toBe(400);
      }
      const l = await llamar(
        'get',
        `/api/paquetes?q=E2E-TARIFA-MALA-${sufijo}`,
      );
      expect(l.status).toBe(200);
      expect((l.body as { data: PaqueteFila[] }).data).toEqual([]);
      expect(
        (await llamar('get', `/api/paquetes?q=E2E-TARIFA-EDIT-${sufijo}`)).body,
      ).toMatchObject({
        data: [{ id: existenteId, tarifaPagoId: null, tarifaPagoNombre: null }],
      });
    });

    it('aislamiento: el listado de un tenant no trae las del otro; id no UUID es 400', async () => {
      const ajenas = await llamar(
        'get',
        '/api/tarifas-pago',
        tokenSegundoTenant,
      );
      expect(ajenas.status).toBe(200);
      expect(
        (ajenas.body as TarifaPagoFila[]).every(
          (t) =>
            !t.nombre.endsWith(`${sufijo}`) || t.nombre === `Ajena ${sufijo}`,
        ),
      ).toBe(true);
      const malo = await llamar(
        'patch',
        '/api/tarifas-pago/no-es-uuid',
        tokenAdmin,
        {},
      );
      expect(malo.status).toBe(400);
    });

    it('un no admin: 403', async () => {
      const [moto] = tarifas;
      const get = await llamar('get', '/api/tarifas-pago', tokenVendedor);
      expect(get.status).toBe(403);
      const patch = await llamar(
        'patch',
        `/api/tarifas-pago/${moto}`,
        tokenVendedor,
        {
          monto: '1',
        },
      );
      expect(patch.status).toBe(403);
      const del = await llamar(
        'delete',
        `/api/tarifas-pago/${moto}`,
        tokenVendedor,
      );
      expect(del.status).toBe(403);
    });
  });

  describe('repartidores', () => {
    it('alta y desactivar; el listado lo sigue mostrando, inactivo', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56911112222',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);
      expect(r.body).toMatchObject({ activo: true, telefono: '+56911112222' });

      const off = await llamar('patch', `/api/repartidores/${id}`, tokenAdmin, {
        activo: false,
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ id, activo: false });

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect(
        (lista.body as RepartidorFila[]).find((x) => x.id === id),
      ).toMatchObject({
        activo: false,
      });
    });

    it('PATCH con telefono null lo borra; sin la clave lo deja', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56933334444',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const renombre = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          nombre: `E2E renombrado ${Date.now()}`,
        },
      );
      expect(renombre.status).toBe(200);
      expect(renombre.body).toMatchObject({ telefono: '+56933334444' });

      const sinTel = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          telefono: null,
        },
      );
      expect(sinTel.status).toBe(200);
      expect(sinTel.body).toMatchObject({ telefono: null });
    });

    it.each([['nombre'], ['activo']])(
      'PATCH con %s null: 400 y el repartidor queda igual',
      async (campo) => {
        const nombre = `E2E ${Date.now()}`;
        const r = await llamar('post', '/api/repartidores', tokenAdmin, {
          nombre,
        });
        expect(r.status).toBe(201);
        const id = (r.body as RepartidorFila).id;
        creados.push(id);

        const res = await llamar(
          'patch',
          `/api/repartidores/${id}`,
          tokenAdmin,
          {
            [campo]: null,
          },
        );
        expect(res.status).toBe(400);

        const lista = await llamar('get', '/api/repartidores');
        expect(lista.status).toBe(200);
        expect(
          (lista.body as RepartidorFila[]).find((x) => x.id === id),
        ).toMatchObject({ nombre, activo: true });
      },
    );

    it('nombre vacío al crear: 400', async () => {
      const res = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: '',
      });
      expect(res.status).toBe(400);
    });

    it('eliminar: sale del listado (soft delete) y un segundo DELETE es 404', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;

      const del = await llamar('delete', `/api/repartidores/${id}`);
      expect(del.status).toBe(200);

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );

      const otra = await llamar('delete', `/api/repartidores/${id}`);
      expect(otra.status).toBe(404);
    });

    it('aislamiento: el repartidor de un tenant no existe para el otro (404) ni aparece en su listado', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const ajeno = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
        {
          nombre: 'x',
        },
      );
      expect(ajeno.status).toBe(404);
      const ajenoDel = await llamar(
        'delete',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
      );
      expect(ajenoDel.status).toBe(404);

      const lista = await llamar(
        'get',
        '/api/repartidores',
        tokenSegundoTenant,
      );
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );
    });

    it('id con forma no UUID: 400, no 500', async () => {
      const res = await llamar(
        'patch',
        '/api/repartidores/no-es-uuid',
        tokenAdmin,
        {
          nombre: 'x',
        },
      );
      expect(res.status).toBe(400);
    });
  });

  describe('paquetes', () => {
    const marca = Date.now();
    const paquetes: string[] = [];
    const terceros: string[] = [];
    let n = 0;
    const codigoNuevo = () => `E2E-${marca}-${++n}`;
    const lista = (qs: string, token = tokenAdmin) =>
      llamar('get', `/api/paquetes?${qs}`, token);
    const crear = async (cuerpo: object, token = tokenAdmin) => {
      const res = await llamar('post', '/api/paquetes', token, cuerpo);
      if (res.status === 201) {
        paquetes.push((res.body as PaqueteFila).id);
      }
      return res;
    };

    // No depende de otro describe: deja el precio en el valor del seed (10000) y pide la tarifa de 5.000.
    beforeAll(async () => {
      const res = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '10000' },
      );
      expect(res.status).toBe(200);
      await tarifaPorMonto('5000');
    });

    afterAll(async () => {
      const fallos: string[] = [];
      for (const id of paquetes) {
        const res = await llamar('delete', `/api/paquetes/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE paquete ${id} -> ${res.status}`);
        }
      }
      for (const id of terceros) {
        const res = await llamar('delete', `/api/terceros/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE tercero ${id} -> ${res.status}`);
        }
      }
      expect(fallos).toEqual([]);
    });

    it('alta con solo el código: nace con el precio de la configuración, sin tarifa propia, y disponible', async () => {
      const res = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        precioEnvio: '10000.0000',
        tarifaPagoId: null,
        tarifaPagoNombre: null,
        estado: 'disponible',
        bloqueado: false,
        hojaRutaId: null,
        repartidorNombre: null,
        remitenteNombre: null,
        cobroEnDestino: false,
      });
    });

    it('alta con precio y tarifa propios: no copia el default y muestra el nombre de la tarifa', async () => {
      const colina = await tarifaPorMonto('4000');
      const res = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: true,
        precioEnvio: '8000',
        tarifaPagoId: colina,
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        precioEnvio: '8000.0000',
        tarifaPagoId: colina,
        tarifaPagoNombre: `E2E pago 4000 ${sufijoTarifas}`,
        cobroEnDestino: true,
      });
      // El pago ya no es un campo del paquete: mandarlo es 400.
      const viejo = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        pagoRepartidor: '4000',
      });
      expect(viejo.status).toBe(400);
    });

    it('PATCH tarifaPagoId la cambia y null la quita', async () => {
      const colina = await tarifaPorMonto('4000');
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const pone = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        tarifaPagoId: colina,
      });
      expect(pone.status).toBe(200);
      expect(pone.body).toMatchObject({ tarifaPagoId: colina });
      const saca = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        tarifaPagoId: null,
      });
      expect(saca.status).toBe(200);
      expect(saca.body).toMatchObject({
        tarifaPagoId: null,
        tarifaPagoNombre: null,
      });
    });

    it('el QR en JSON se guarda por su id y q lo encuentra, pegado o por el código', async () => {
      const codigo = `E2E-${marca}-qr`;
      const res = await crear({
        codigo: `{"id":"${codigo}"}`,
        cobroEnDestino: false,
      });
      expect(res.status).toBe(201);
      expect((res.body as PaqueteFila).codigo).toBe(codigo);

      for (const q of [codigo, `{"id":"${codigo}"}`, codigo.toLowerCase()]) {
        const l = await lista(`q=${encodeURIComponent(q)}`);
        expect(l.status).toBe(200);
        const data = (l.body as { data: PaqueteFila[] }).data;
        expect(data.map((p) => p.codigo)).toEqual([codigo]);
      }
    });

    it('el mismo código dos veces: 409; borrado el primero, el código se puede reusar', async () => {
      const codigo = codigoNuevo();
      const uno = await crear({ codigo, cobroEnDestino: false });
      expect(uno.status).toBe(201);
      const dos = await crear({ codigo: ` ${codigo} `, cobroEnDestino: false });
      expect(dos.status).toBe(409);

      const del = await llamar(
        'delete',
        `/api/paquetes/${(uno.body as PaqueteFila).id}`,
      );
      expect(del.status).toBe(200);
      const tres = await crear({ codigo, cobroEnDestino: false });
      expect(tres.status).toBe(201);
    });

    it('el código del mismo valor en el otro tenant no choca', async () => {
      const codigo = codigoNuevo();
      const mio = await crear({ codigo, cobroEnDestino: false });
      expect(mio.status).toBe(201);
      // Montos propios: este test no deja configurado al segundo tenant (su tarifa se borra al final).
      const ajeno = await crear(
        {
          codigo,
          cobroEnDestino: false,
          precioEnvio: '1000',
          tarifaPagoId: await tarifaPorMonto('500', tokenSegundoTenant),
        },
        tokenSegundoTenant,
      );
      expect(ajeno.status).toBe(201);
      // El del segundo tenant se limpia con SU token: la lista de arriba es de Paris.
      const del = await llamar(
        'delete',
        `/api/paquetes/${(ajeno.body as PaqueteFila).id}`,
        tokenSegundoTenant,
      );
      expect(del.status).toBe(200);
      paquetes.splice(paquetes.indexOf((ajeno.body as PaqueteFila).id), 1);
    });

    it('porCompletar lo lista; tras completar la dirección y el destinatario ya no', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const antes = await lista('porCompletar=true&pageSize=100');
      expect(antes.status).toBe(200);
      expect(
        (antes.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);

      const parcial = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        direccion: 'Av. Siempreviva 742',
      });
      expect(parcial.status).toBe(200);
      expect(parcial.body).toMatchObject({ direccion: 'Av. Siempreviva 742' });
      const sigue = await lista('porCompletar=true&pageSize=100');
      expect(sigue.status).toBe(200);
      expect(
        (sigue.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);

      const completo = await llamar(
        'patch',
        `/api/paquetes/${id}`,
        tokenAdmin,
        {
          destinatarioNombre: 'Ana Pérez',
        },
      );
      expect(completo.status).toBe(200);
      const despues = await lista('porCompletar=true&pageSize=100');
      expect(despues.status).toBe(200);
      expect(
        (despues.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('los filtros estado y cobroEnDestino reparten el listado', async () => {
      const cobra = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: true,
      });
      expect(cobra.status).toBe(201);
      const id = (cobra.body as PaqueteFila).id;
      const si = await lista(
        'cobroEnDestino=true&estado=disponible&pageSize=100',
      );
      expect(si.status).toBe(200);
      expect(
        (si.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(true);
      const no = await lista('cobroEnDestino=false&pageSize=100');
      expect(no.status).toBe(200);
      expect(
        (no.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
      const enRuta = await lista('estado=en_ruta&pageSize=100');
      expect(enRuta.status).toBe(200);
      expect(
        (enRuta.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('filtros con valor inválido: 400', async () => {
      for (const qs of [
        'estado=perdido',
        'cobroEnDestino=quizas',
        'porCompletar=false',
      ]) {
        const res = await lista(qs);
        expect(res.status).toBe(400);
      }
    });

    it('PATCH con un monto con decimales en CLP: 400', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const res = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        precioEnvio: '10000.5',
      });
      expect(res.status).toBe(400);
    });

    it.each([['cobroEnDestino'], ['precioEnvio'], ['codigo']])(
      'PATCH con %s null: 400 y el paquete queda igual',
      async (campo) => {
        const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
        expect(r.status).toBe(201);
        const original = r.body as PaqueteFila;
        const res = await llamar(
          'patch',
          `/api/paquetes/${original.id}`,
          tokenAdmin,
          {
            [campo]: null,
          },
        );
        expect(res.status).toBe(400);
        const l = await lista(`q=${encodeURIComponent(original.codigo)}`);
        expect(l.status).toBe(200);
        expect((l.body as { data: PaqueteFila[] }).data).toEqual([original]);
      },
    );

    it('PATCH con un campo opcional null lo vacía; sin la clave lo deja', async () => {
      const r = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        direccion: 'Calle 1',
        comuna: 'Ñuñoa',
      });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const res = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        direccion: null,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ direccion: null, comuna: 'Ñuñoa' });
    });

    it('PATCH del código a uno que ya existe: 409', async () => {
      const a = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(a.status).toBe(201);
      const b = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(b.status).toBe(201);
      const res = await llamar(
        'patch',
        `/api/paquetes/${(b.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          codigo: (a.body as PaqueteFila).codigo,
        },
      );
      expect(res.status).toBe(409);
    });

    it('el remitente: uno del tenant se muestra; uno ajeno es 404 (alta y edición)', async () => {
      const propio = await llamar('post', '/api/terceros', tokenAdmin, {
        tipo: 'empresa',
        nombre: `E2E remitente ${marca}`,
      });
      expect(propio.status).toBe(201);
      const propioId = (propio.body as { id: string }).id;
      terceros.push(propioId);
      const ajeno = await llamar('post', '/api/terceros', tokenSegundoTenant, {
        tipo: 'empresa',
        nombre: `E2E ajeno ${marca}`,
      });
      expect(ajeno.status).toBe(201);
      const ajenoId = (ajeno.body as { id: string }).id;

      const ok = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        remitenteTerceroId: propioId,
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        remitenteTerceroId: propioId,
        remitenteNombre: `E2E remitente ${marca}`,
      });

      const alta = await crear({
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        remitenteTerceroId: ajenoId,
      });
      expect(alta.status).toBe(404);
      const patch = await llamar(
        'patch',
        `/api/paquetes/${(ok.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          remitenteTerceroId: ajenoId,
        },
      );
      expect(patch.status).toBe(404);

      const quitar = await llamar(
        'patch',
        `/api/paquetes/${(ok.body as PaqueteFila).id}`,
        tokenAdmin,
        {
          remitenteTerceroId: null,
        },
      );
      expect(quitar.status).toBe(200);
      expect(quitar.body).toMatchObject({
        remitenteTerceroId: null,
        remitenteNombre: null,
      });

      await llamar('delete', `/api/terceros/${ajenoId}`, tokenSegundoTenant);
    });

    it('aislamiento: el paquete de un tenant es 404 para el otro en PATCH y DELETE, y no aparece en su listado', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const patch = await llamar(
        'patch',
        `/api/paquetes/${id}`,
        tokenSegundoTenant,
        {
          direccion: 'x',
        },
      );
      expect(patch.status).toBe(404);
      const del = await llamar(
        'delete',
        `/api/paquetes/${id}`,
        tokenSegundoTenant,
      );
      expect(del.status).toBe(404);
      const l = await lista('pageSize=100', tokenSegundoTenant);
      expect(l.status).toBe(200);
      expect(
        (l.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
    });

    it('DELETE de uno que nunca salió: 200, desaparece del listado y un segundo DELETE es 404', async () => {
      const r = await crear({ codigo: codigoNuevo(), cobroEnDestino: false });
      expect(r.status).toBe(201);
      const id = (r.body as PaqueteFila).id;
      const del = await llamar('delete', `/api/paquetes/${id}`);
      expect(del.status).toBe(200);
      const l = await lista('pageSize=100');
      expect(l.status).toBe(200);
      expect(
        (l.body as { data: PaqueteFila[] }).data.some((p) => p.id === id),
      ).toBe(false);
      const otra = await llamar('delete', `/api/paquetes/${id}`);
      expect(otra.status).toBe(404);
      const editar = await llamar('patch', `/api/paquetes/${id}`, tokenAdmin, {
        nota: 'x',
      });
      expect(editar.status).toBe(404);
    });

    it('id con forma no UUID: 400, no 500; y /paquetes/configuracion sigue siendo la configuración', async () => {
      const res = await llamar(
        'patch',
        '/api/paquetes/no-es-uuid',
        tokenAdmin,
        { nota: 'x' },
      );
      expect(res.status).toBe(400);
      const config = await llamar('get', '/api/paquetes/configuracion');
      expect(config.status).toBe(200);
      expect(config.body).toHaveProperty('configurada');
    });

    it('alta sin código o con cobroEnDestino ausente: 400', async () => {
      expect((await crear({ cobroEnDestino: false })).status).toBe(400);
      expect((await crear({ codigo: codigoNuevo() })).status).toBe(400);
      expect(
        (await crear({ codigo: '   ', cobroEnDestino: false })).status,
      ).toBe(400);
    });
  });
  describe('escaneo y asignación', () => {
    const marca = Date.now();
    const FECHA = '2026-10-15';
    let n = 0;
    const codigoNuevo = () => `E2E-HR-${marca}-${++n}`;
    // Repartidores con hojas: no se pueden borrar, se desactivan al terminar.
    const propios: string[] = [];
    const ajenos: string[] = [];
    const paquetesAjenos: string[] = [];
    const mensajeDe = (res: { body: unknown }) =>
      (res.body as { message: string }).message;

    const nuevoRepartidor = async (token = tokenAdmin, extra: object = {}) => {
      const res = await llamar('post', '/api/repartidores', token, {
        nombre: `E2E HR ${marca}-${++n}`,
        ...extra,
      });
      expect(res.status).toBe(201);
      const fila = res.body as RepartidorFila;
      (token === tokenAdmin ? propios : ajenos).push(fila.id);
      return fila;
    };
    const escanear = async (
      repartidorId: string,
      codigo: string,
      extra: object = {},
      token = tokenAdmin,
    ) =>
      llamar('post', '/api/hojas-ruta/escanear', token, {
        repartidorId,
        fecha: FECHA,
        codigo,
        cobroEnDestino: false,
        ...extra,
      });
    const asignar = async (
      repartidorId: string,
      paqueteIds: string[],
      extra: object = {},
    ) =>
      llamar('post', '/api/hojas-ruta/asignar', tokenAdmin, {
        repartidorId,
        fecha: FECHA,
        paqueteIds,
        ...extra,
      });
    const crearPaquete = async (cuerpo: object) => {
      const res = await llamar('post', '/api/paquetes', tokenAdmin, {
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        ...cuerpo,
      });
      expect(res.status).toBe(201);
      return res.body as PaqueteFila;
    };
    const paquetePorCodigo = async (codigo: string) => {
      const res = await llamar(
        'get',
        `/api/paquetes?q=${encodeURIComponent(codigo)}`,
      );
      expect(res.status).toBe(200);
      const [fila] = (res.body as { data: PaqueteFila[] }).data;
      return fila;
    };

    let rep: RepartidorFila;
    let otro: RepartidorFila;

    // No depende de otro describe: deja el precio en el valor del seed (10000) y pide la tarifa de 5.000.
    beforeAll(async () => {
      const res = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        { precioEnvioDefecto: '10000' },
      );
      expect(res.status).toBe(200);
      await tarifaPorMonto('5000');
      rep = await nuevoRepartidor();
      otro = await nuevoRepartidor();
    });

    afterAll(async () => {
      const fallos: string[] = [];
      for (const id of propios) {
        const res = await llamar(
          'patch',
          `/api/repartidores/${id}`,
          tokenAdmin,
          {
            activo: false,
          },
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`PATCH repartidor ${id} -> ${res.status}`);
        }
      }
      for (const id of ajenos) {
        const res = await llamar(
          'delete',
          `/api/repartidores/${id}`,
          tokenSegundoTenant,
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE repartidor ajeno ${id} -> ${res.status}`);
        }
      }
      for (const id of paquetesAjenos) {
        const res = await llamar(
          'delete',
          `/api/paquetes/${id}`,
          tokenSegundoTenant,
        );
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE paquete ajeno ${id} -> ${res.status}`);
        }
      }
      expect(fallos).toEqual([]);
    });

    it('código nuevo: asignado_nuevo, nace con el cobro en destino del interruptor, el precio de la configuración y el pago estimado de la tarifa por defecto', async () => {
      const codigo = codigoNuevo();
      const res = await escanear(rep.id, codigo, { cobroEnDestino: true });
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo).toMatchObject({ resultado: 'asignado_nuevo', codigo });
      expect(cuerpo.hoja).toMatchObject({
        repartidorId: rep.id,
        repartidorNombre: rep.nombre,
        fecha: FECHA,
        estado: 'abierta',
        rendidaEl: null,
        enRuta: cuerpo.hoja.asignados,
        entregados: 0,
        netoARendir: '0.0000',
      });
      expect(cuerpo.hoja.lineas[0]).toMatchObject({
        codigo,
        cobroEnDestino: true,
        precioEnvio: '10000.0000',
        // Sin tarifa en el paquete ni en el repartidor: la por defecto, como estimado.
        tarifaPagoNombre: `E2E pago 5000 ${sufijoTarifas}`,
        // La propia del paquete es otra cosa que la resuelta: este no tiene.
        tarifaPaqueteId: null,
        pagoRepartidor: '5000.0000',
        pagoEstimado: true,
        medioCobro: null,
        estado: 'en_ruta',
      });

      const fila = await paquetePorCodigo(codigo);
      expect(fila).toMatchObject({
        estado: 'en_ruta',
        hojaRutaId: cuerpo.hoja.id,
        repartidorNombre: rep.nombre,
        cobroEnDestino: true,
      });
    });

    it('existente y disponible con cobro_en_destino=false, escaneado con el interruptor prendido: asignado, y sigue en false', async () => {
      const paquete = await crearPaquete({ cobroEnDestino: false });
      const res = await escanear(rep.id, paquete.codigo, {
        cobroEnDestino: true,
      });
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo.resultado).toBe('asignado');
      expect(
        cuerpo.hoja.lineas.find((l) => l.paqueteId === paquete.id),
      ).toMatchObject({ cobroEnDestino: false, estado: 'en_ruta' });
      expect((await paquetePorCodigo(paquete.codigo)).cobroEnDestino).toBe(
        false,
      );
    });

    it('el mismo código otra vez en la misma hoja: ya_escaneado, sin línea nueva (asignados no cambia)', async () => {
      const codigo = codigoNuevo();
      const primero = await escanear(rep.id, codigo);
      expect(primero.status).toBe(200);
      const antes = (primero.body as RespuestaEscaneo).hoja;

      const segundo = await escanear(rep.id, ` ${codigo} `);
      expect(segundo.status).toBe(200);
      const cuerpo = segundo.body as RespuestaEscaneo;
      expect(cuerpo.resultado).toBe('ya_escaneado');
      expect(cuerpo.hoja.asignados).toBe(antes.asignados);
      expect(
        cuerpo.hoja.lineas.filter((l) => l.codigo === codigo),
      ).toHaveLength(1);
    });

    it('en ruta con otro repartidor: 409 que nombra al repartidor, y la hoja del segundo no queda con ese paquete', async () => {
      const codigo = codigoNuevo();
      expect((await escanear(rep.id, codigo)).status).toBe(200);

      const res = await escanear(otro.id, codigo);
      expect(res.status).toBe(409);
      expect(mensajeDe(res)).toContain(`está con ${rep.nombre}`);

      const fila = await paquetePorCodigo(codigo);
      expect(fila.repartidorNombre).toBe(rep.nombre);
    });

    it('QR en JSON: el código guardado es el id', async () => {
      const codigo = codigoNuevo();
      const res = await escanear(rep.id, `{"id":"${codigo}","sender_id":7}`);
      expect(res.status).toBe(200);
      const cuerpo = res.body as RespuestaEscaneo;
      expect(cuerpo.codigo).toBe(codigo);
      expect(cuerpo.hoja.lineas[0].codigo).toBe(codigo);
    });

    it('asignar: varios disponibles entran juntos, de a una línea cada uno', async () => {
      const dia = '2026-10-17';
      const a = await crearPaquete({});
      const b = await crearPaquete({});
      const res = await asignar(rep.id, [a.id, b.id], { fecha: dia });
      expect(res.status).toBe(200);
      const hoja = res.body as HojaRutaDetalle;
      expect(hoja).toMatchObject({ fecha: dia, asignados: 2, enRuta: 2 });
      expect(hoja.lineas.map((l) => l.paqueteId).sort()).toEqual(
        [a.id, b.id].sort(),
      );

      const otra = await asignar(rep.id, [a.id], { fecha: dia });
      expect(otra.status).toBe(400);
      expect(mensajeDe(otra)).toContain(`${a.codigo} ya está en esta hoja`);
    });

    it('asignar con uno no disponible: 400 que nombra el código y ninguno queda asignado', async () => {
      const libre = await crearPaquete({});
      const ocupado = await crearPaquete({});
      expect((await escanear(rep.id, ocupado.codigo)).status).toBe(200);

      const res = await asignar(otro.id, [libre.id, ocupado.id]);
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain(
        `No se asignó ninguno: ${ocupado.codigo}`,
      );
      expect(mensajeDe(res)).toContain(`está con ${rep.nombre}`);
      expect((await paquetePorCodigo(libre.codigo)).estado).toBe('disponible');
    });

    it('asignar con un paquete que no existe o es de otro tenant: 404, y ninguno queda asignado', async () => {
      const mio = await crearPaquete({});
      const ajeno = await llamar('post', '/api/paquetes', tokenSegundoTenant, {
        codigo: codigoNuevo(),
        cobroEnDestino: false,
        precioEnvio: '1000',
        tarifaPagoId: await tarifaPorMonto('500', tokenSegundoTenant),
      });
      expect(ajeno.status).toBe(201);
      const ajenoId = (ajeno.body as PaqueteFila).id;
      paquetesAjenos.push(ajenoId);

      const res = await asignar(otro.id, [mio.id, ajenoId]);
      expect(res.status).toBe(404);
      expect((await paquetePorCodigo(mio.codigo)).estado).toBe('disponible');
    });

    it('un repartidor de otro tenant, o inactivo, no recibe escaneos', async () => {
      const ajeno = await nuevoRepartidor(tokenSegundoTenant);
      expect((await escanear(ajeno.id, codigoNuevo())).status).toBe(404);

      const inactivo = await nuevoRepartidor();
      const off = await llamar(
        'patch',
        `/api/repartidores/${inactivo.id}`,
        tokenAdmin,
        { activo: false },
      );
      expect(off.status).toBe(200);
      const res = await escanear(inactivo.id, codigoNuevo());
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain('inactivo');
      const sinHoja = await asignar(inactivo.id, [(await crearPaquete({})).id]);
      expect(sinHoja.status).toBe(400);
    });

    it('un escaneo rechazado no deja nada escrito: ni la hoja que iba a crear', async () => {
      const nuevo = await nuevoRepartidor();
      const codigo = codigoNuevo();
      expect((await escanear(rep.id, codigo)).status).toBe(200);
      expect((await escanear(nuevo.id, codigo)).status).toBe(409);
      const ds = app.get(DataSource);
      const [{ n: hojas }] = await ds.query<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM hojas_ruta WHERE repartidor_id = $1`,
        [nuevo.id],
      );
      expect(hojas).toBe(0);
    });

    it('DELETE /repartidores/:id de uno que tiene hojas: 400 (se desactiva)', async () => {
      const conHoja = await nuevoRepartidor();
      expect((await escanear(conHoja.id, codigoNuevo())).status).toBe(200);
      const res = await llamar('delete', `/api/repartidores/${conHoja.id}`);
      expect(res.status).toBe(400);
      expect(mensajeDe(res)).toContain('tiene hojas de ruta');
    });

    it('entradas inválidas: 400, no 500', async () => {
      const base = {
        repartidorId: rep.id,
        fecha: FECHA,
        codigo: codigoNuevo(),
        cobroEnDestino: false,
      };
      for (const malo of [
        { fecha: '15-10-2026' },
        { fecha: '2026-02-31' },
        { repartidorId: 'no-es-uuid' },
        { codigo: '   ' },
        { codigo: 'x'.repeat(501) },
        { cobroEnDestino: undefined },
        { cobroEnDestino: 'si' },
      ]) {
        const res = await llamar(
          'post',
          '/api/hojas-ruta/escanear',
          tokenAdmin,
          {
            ...base,
            ...malo,
          },
        );
        expect(res.status).toBe(400);
      }
      const uno = (await crearPaquete({})).id;
      for (const paqueteIds of [
        [],
        'no-es-lista',
        ['no-es-uuid'],
        [uno, uno],
        [uno, uno.toUpperCase()],
      ]) {
        const res = await asignar(rep.id, paqueteIds as string[], {
          fecha: '2026-10-18',
        });
        expect(res.status).toBe(400);
      }
    });

    describe('carreras', () => {
      const ds = () => app.get(DataSource);

      it('el mismo código nuevo escaneado dos veces a la vez a la misma hoja: un paquete, una línea, ningún 500', async () => {
        const dia = '2026-10-19';
        const sembrado = await escanear(rep.id, codigoNuevo(), { fecha: dia });
        expect(sembrado.status).toBe(200);
        const hojaId = (sembrado.body as RespuestaEscaneo).hoja.id;

        const codigo = codigoNuevo();
        // Compuerta: la fila de la hoja. Los dos escaneos llegan a ella con el mismo repartidor
        // y la misma fecha, así que esperan ahí y se serializan.
        const { respuestas, esperando } = await correrCarrera(
          ds(),
          [
            'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
            [hojaId],
          ],
          [
            async () => escanear(rep.id, codigo, { fecha: dia }),
            async () => escanear(rep.id, codigo, { fecha: dia }),
          ],
        );
        expect(esperando).toBe(2);
        expect(respuestas.map((r) => r.status)).toEqual([200, 200]);
        expect(
          respuestas.map((r) => (r.body as RespuestaEscaneo).resultado).sort(),
        ).toEqual(['asignado_nuevo', 'ya_escaneado']);

        const [{ paquetes, lineas }] = await ds().query<
          { paquetes: number; lineas: number }[]
        >(
          `SELECT COUNT(DISTINCT p.paquete_id)::int AS paquetes,
                  COUNT(l.hoja_ruta_paquete_id)::int AS lineas
             FROM paquetes p
             LEFT JOIN hoja_ruta_paquetes l ON l.paquete_id = p.paquete_id
            WHERE p.codigo = $1 AND p.eliminado_el IS NULL`,
          [codigo],
        );
        expect(paquetes).toBe(1);
        expect(lineas).toBe(1);
      });

      it('el mismo código nuevo escaneado a la vez por dos repartidores: uno lo crea y se queda con él, el otro recibe 409 (nunca un 500) y hay un solo paquete', async () => {
        const uno = await nuevoRepartidor();
        const dos = await nuevoRepartidor();
        const codigo = codigoNuevo();
        // Compuerta: las filas de los dos repartidores. Cada escaneo toma su propia hoja, así que
        // el cerrojo de la hoja no los serializa: el que decide es el índice único de `codigo`.
        const { respuestas, esperando } = await correrCarrera(
          ds(),
          [
            `SELECT 1 FROM repartidores WHERE repartidor_id = ANY($1::uuid[]) FOR UPDATE`,
            [[uno.id, dos.id]],
          ],
          [
            async () => escanear(uno.id, codigo),
            async () => escanear(dos.id, codigo),
          ],
        );
        expect(esperando).toBe(2);
        expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
        const perdedora = respuestas.find((r) => r.status === 409)!;
        expect(mensajeDe(perdedora)).toMatch(/^El paquete .* está con /);
        const ganadora = respuestas.find((r) => r.status === 200)!;
        expect(ganadora.status).toBe(200);
        expect((ganadora.body as RespuestaEscaneo).resultado).toBe(
          'asignado_nuevo',
        );

        const [{ paquetes, lineas }] = await ds().query<
          { paquetes: number; lineas: number }[]
        >(
          `SELECT COUNT(DISTINCT p.paquete_id)::int AS paquetes,
                  COUNT(l.hoja_ruta_paquete_id)::int AS lineas
             FROM paquetes p
             LEFT JOIN hoja_ruta_paquetes l ON l.paquete_id = p.paquete_id
            WHERE p.codigo = $1 AND p.eliminado_el IS NULL`,
          [codigo],
        );
        expect(paquetes).toBe(1);
        expect(lineas).toBe(1);
      });

      // Se prueban las dos llegadas, escalonadas para que el orden sea el que dice el nombre:
      // sin el cerrojo del repartidor en el escaneo, el borrado que llega primero no espera al
      // escaneo (el `SELECT` común no bloquea) y la hoja nace sobre un repartidor ya borrado.
      it.each([
        [
          'el borrado llega primero: gana, y el escaneo ya no encuentra al repartidor',
          'borrado',
          404,
          200,
        ],
        [
          'el escaneo llega primero: gana, y el borrado ve la hoja y rebota',
          'escaneo',
          200,
          400,
        ],
      ] as const)(
        'borrar un repartidor a la vez que se le escanea (%s)',
        async (_titulo, primero, esperadoEscaneo, esperadoBorrado) => {
          const destino = await nuevoRepartidor();
          const escaneo = async () => escanear(destino.id, codigoNuevo());
          const borrado = async () =>
            llamar('delete', `/api/repartidores/${destino.id}`, tokenAdmin);
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            [
              `SELECT 1 FROM repartidores WHERE repartidor_id = $1 FOR UPDATE`,
              [destino.id],
            ],
            primero === 'borrado' ? [borrado, escaneo] : [escaneo, borrado],
            { escalonarMs: 300 },
          );
          expect(esperando).toBe(2);
          const estados = respuestas.map((r) => r.status);
          expect(
            primero === 'borrado'
              ? [estados[1], estados[0]]
              : [estados[0], estados[1]],
          ).toEqual([esperadoEscaneo, esperadoBorrado]);

          const [{ huerfanas }] = await ds().query<{ huerfanas: number }[]>(
            `SELECT COUNT(*)::int AS huerfanas
               FROM hojas_ruta h
               JOIN repartidores r ON r.repartidor_id = h.repartidor_id
              WHERE r.repartidor_id = $1 AND r.eliminado_el IS NOT NULL
                AND h.eliminado_el IS NULL`,
            [destino.id],
          );
          expect(huerfanas).toBe(0);
        },
      );
    });

    describe('marcar, rendir y KPIs', () => {
      const ds = () => app.get(DataSource);
      const AYER = '2026-10-14';
      const uuidAjeno = '550e8400-e29b-41d4-a716-446655440999';

      interface Spec {
        cantidad: number;
        cobroEnDestino: boolean;
        precioEnvio: string;
        pagoRepartidor: string;
      }
      /**
       * Crea los paquetes con precio propio y la tarifa de pago del monto pedido (el pago ya no es un
       * campo del paquete: se resuelve de la tarifa), y los asigna juntos a la hoja del repartidor.
       */
      const armar = async (
        repartidorId: string,
        specs: Spec[],
        fecha = FECHA,
      ) => {
        const grupos: PaqueteFila[][] = [];
        for (const sp of specs) {
          const grupo: PaqueteFila[] = [];
          for (let i = 0; i < sp.cantidad; i++) {
            grupo.push(
              await crearPaquete({
                cobroEnDestino: sp.cobroEnDestino,
                precioEnvio: sp.precioEnvio,
                tarifaPagoId: await tarifaPorMonto(sp.pagoRepartidor),
              }),
            );
          }
          grupos.push(grupo);
        }
        const res = await asignar(
          repartidorId,
          grupos.flat().map((p) => p.id),
          { fecha },
        );
        expect(res.status).toBe(200);
        return { hoja: res.body as HojaRutaDetalle, grupos };
      };
      const marcar = (hojaId: string, paqueteId: string, estado: string) =>
        llamar(
          'patch',
          `/api/hojas-ruta/${hojaId}/paquetes/${paqueteId}`,
          tokenAdmin,
          { estado },
        );
      const rendirHojas = (
        repartidorId: string,
        hojaIds: string[],
        token = tokenAdmin,
      ) => llamar('post', '/api/rendiciones', token, { repartidorId, hojaIds });
      /** Rinde UNA hoja (la rendición de un solo día). Una hoja que no existe rinde con un repartidor que tampoco. */
      const rendir = async (hojaId: string, token = tokenAdmin) => {
        const [fila] = await ds().query<{ repartidor_id: string }[]>(
          `SELECT repartidor_id FROM hojas_ruta WHERE hoja_ruta_id = $1`,
          [hojaId],
        );
        return rendirHojas(fila?.repartidor_id ?? uuidAjeno, [hojaId], token);
      };
      const detalle = async (hojaId: string) => {
        const res = await llamar('get', `/api/hojas-ruta/${hojaId}`);
        expect(res.status).toBe(200);
        return res.body as HojaRutaDetalle;
      };
      const resumen = async (query: string) => {
        const res = await llamar('get', `/api/hojas-ruta/resumen?${query}`);
        expect(res.status).toBe(200);
        return res.body as ResumenPaqueteria;
      };
      const congelado = async (hojaId: string) => {
        const [fila] = await ds().query<
          {
            estado: string;
            rendida_por: string | null;
            monto_total_general: string;
            monto_cobrado_destino: string;
            neto_a_rendir: string;
          }[]
        >(
          `SELECT estado, rendida_por, monto_total_general, monto_cobrado_destino, neto_a_rendir
             FROM hojas_ruta WHERE hoja_ruta_id = $1`,
          [hojaId],
        );
        return fila;
      };

      const lineaDe = (h: HojaRutaDetalle, paqueteId: string) =>
        h.lineas.find((l) => l.paqueteId === paqueteId)!;
      const filaDb = async (hojaId: string, paqueteId: string) => {
        const [fila] = await ds().query<
          {
            estado: string;
            tarifa_pago_id: string | null;
            pago_repartidor: string | null;
            medio_cobro: string | null;
          }[]
        >(
          `SELECT estado, tarifa_pago_id, pago_repartidor, medio_cobro
             FROM hoja_ruta_paquetes
            WHERE hoja_ruta_id = $1 AND paquete_id = $2 AND eliminado_el IS NULL`,
          [hojaId, paqueteId],
        );
        return fila;
      };

      // 10 con cobro en destino a 10.000 (pago 5.000) + dos pagados: uno entregado (7.000 / 3.000)
      // y uno no entregado (9.000 / 4.000, a propósito distinto: si se colara en algún total, se nota).
      const ejemploDelOwner = async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 10,
            cobroEnDestino: true,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '7000',
            pagoRepartidor: '3000',
          },
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '9000',
            pagoRepartidor: '4000',
          },
        ]);
        const [cobros, [pagadoEntregado], [pagadoNo]] = grupos;
        expect(
          (await marcar(hoja.id, pagadoEntregado.id, 'entregado')).status,
        ).toBe(200);
        expect(
          (await marcar(hoja.id, pagadoNo.id, 'no_entregado')).status,
        ).toBe(200);
        const todos = await llamar(
          'post',
          `/api/hojas-ruta/${hoja.id}/entregar-todos`,
          tokenAdmin,
          {},
        );
        expect(todos.status).toBe(200);
        return {
          repartidor,
          hoja,
          cobros,
          pagadoEntregado,
          pagadoNo,
          final: todos.body as HojaRutaDetalle,
        };
      };

      it('10 con cobro en destino a 10.000 y pago 5.000: el repartidor entrega 50.000 (más lo del pagado)', async () => {
        const { final, pagadoNo } = await ejemploDelOwner();
        expect(final).toMatchObject({
          estado: 'abierta',
          asignados: 12,
          enRuta: 0,
          entregados: 11,
          cobroDestino: 10,
          montoCobradoDestino: '100000.0000',
          montoPagoRepartidor: '53000.0000',
          montoTotalGeneral: '107000.0000',
          netoARendir: '47000.0000',
        });
        // entregar-todos no toca lo que ya estaba no entregado
        expect(
          final.lineas.find((l) => l.paqueteId === pagadoNo.id)?.estado,
        ).toBe('no_entregado');
      });

      it('rendir congela; GET /hojas-ruta y GET /:id devuelven lo mismo; los montos de un entregado ya no se editan', async () => {
        const { repartidor, hoja, cobros, final } = await ejemploDelOwner();
        const res = await rendir(hoja.id);
        expect(res.status).toBe(201);
        const rendida = await detalle(hoja.id);
        expect(rendida).toMatchObject({
          estado: 'rendida',
          asignados: 12,
          enRuta: 0,
          entregados: 11,
          cobroDestino: 10,
          montoCobradoDestino: '100000.0000',
          montoPagoRepartidor: '53000.0000',
          montoTotalGeneral: '107000.0000',
          netoARendir: '47000.0000',
        });
        expect(rendida.rendidaEl).not.toBeNull();
        expect(rendida.lineas).toEqual(final.lineas);

        const [fila] = await ds().query<{ email: string }[]>(
          `SELECT u.correo AS email FROM hojas_ruta h JOIN usuarios u ON u.usuario_id = h.rendida_por
            WHERE h.hoja_ruta_id = $1`,
          [hoja.id],
        );
        expect(fila.email).toBe(ADMIN_PARIS.email);
        expect(await congelado(hoja.id)).toMatchObject({
          estado: 'rendida',
          monto_total_general: '107000.0000',
          monto_cobrado_destino: '100000.0000',
          neto_a_rendir: '47000.0000',
        });

        const lista = await llamar(
          'get',
          `/api/hojas-ruta?desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
        );
        expect(lista.status).toBe(200);
        const { lineas, ...sinLineas } = await detalle(hoja.id);
        expect(lineas).toHaveLength(12);
        expect(lista.body as HojaRutaFila[]).toEqual([sinLineas]);
        expect(sinLineas.estado).toBe('rendida');

        // Editar el monto de un entregado: 400 y el paquete queda como estaba.
        const edicion = await llamar(
          'patch',
          `/api/paquetes/${cobros[0].id}`,
          tokenAdmin,
          { precioEnvio: '99999' },
        );
        expect(edicion.status).toBe(400);
        expect(mensajeDe(edicion)).toContain('ya se rindió');
        expect((await paquetePorCodigo(cobros[0].codigo)).precioEnvio).toBe(
          '10000.0000',
        );
        // …pero completar la dirección sigue siendo posible
        const direccion = await llamar(
          'patch',
          `/api/paquetes/${cobros[0].id}`,
          tokenAdmin,
          { direccion: 'Av. Siempre Viva 742' },
        );
        expect(direccion.status).toBe(200);
      });

      it('una hoja rendida no se modifica: marcar, quitar, entregar-todos, rendir de nuevo y asignar a esa fecha dan 400', async () => {
        const { repartidor, hoja, cobros, pagadoNo } = await ejemploDelOwner();
        expect((await rendir(hoja.id)).status).toBe(201);

        const marcado = await marcar(hoja.id, cobros[0].id, 'no_entregado');
        expect(marcado.status).toBe(400);
        expect(mensajeDe(marcado)).toContain('ya está rendida');

        const quitado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${cobros[0].id}`,
        );
        expect(quitado.status).toBe(400);
        const todos = await llamar(
          'post',
          `/api/hojas-ruta/${hoja.id}/entregar-todos`,
          tokenAdmin,
          {},
        );
        expect(todos.status).toBe(400);
        const otraVez = await rendir(hoja.id);
        expect(otraVez.status).toBe(400);
        expect(mensajeDe(otraVez)).toContain('ya está rendida');

        const nuevo = await crearPaquete({});
        expect((await asignar(repartidor.id, [nuevo.id])).status).toBe(400);
        expect((await escanear(repartidor.id, nuevo.codigo)).status).toBe(400);
        // el no entregado de una hoja rendida queda libre para otra hoja
        const otro = await nuevoRepartidor();
        const reintento = await escanear(otro.id, pagadoNo.codigo);
        expect(reintento.status).toBe(200);
      });

      it('quitar un entregado: 400; quitar uno en ruta lo saca de la hoja y lo deja disponible', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 2,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const [uno, dos] = grupos[0];
        expect((await marcar(hoja.id, uno.id, 'entregado')).status).toBe(200);

        const rechazado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${uno.id}`,
        );
        expect(rechazado.status).toBe(400);
        expect(mensajeDe(rechazado)).toBe(
          'Solo se quita un paquete que sigue en ruta.',
        );

        const quitado = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${dos.id}`,
        );
        expect(quitado.status).toBe(200);
        const cuerpo = quitado.body as HojaRutaDetalle;
        expect(cuerpo.asignados).toBe(1);
        expect(cuerpo.lineas.map((l) => l.paqueteId)).toEqual([uno.id]);
        expect((await paquetePorCodigo(dos.codigo)).estado).toBe('disponible');

        const otraVez = await llamar(
          'delete',
          `/api/hojas-ruta/${hoja.id}/paquetes/${dos.id}`,
        );
        expect(otraVez.status).toBe(404);
        // y vuelve a entrar con otro repartidor
        const otro = await nuevoRepartidor();
        expect((await escanear(otro.id, dos.codigo)).status).toBe(200);
      });

      it('neto negativo: un entregado sin cobro en destino → el repartidor cobra 5.000 del negocio', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 1,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const res = await marcar(hoja.id, grupos[0][0].id, 'entregado');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          montoCobradoDestino: '0.0000',
          montoPagoRepartidor: '5000.0000',
          netoARendir: '-5000.0000',
        });
        const rendida = await rendir(hoja.id);
        expect(rendida.status).toBe(201);
        expect(await detalle(hoja.id)).toMatchObject({
          netoARendir: '-5000.0000',
        });
        expect((await congelado(hoja.id)).neto_a_rendir).toBe('-5000.0000');
        expect(
          await resumen(
            `desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
          ),
        ).toEqual({
          asignados: 1,
          entregados: 1,
          cobroDestino: 0,
          montoCobradoDestino: '0.0000',
          montoCobradoTransferencia: '0.0000',
          montoTotalGeneral: '10000.0000',
          montoPagoRepartidor: '5000.0000',
        });
      });

      it('rendir con líneas en ruta: 400 que dice cuántas; una hoja sin paquetes: 400', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 3,
            cobroEnDestino: false,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        expect(
          (await marcar(hoja.id, grupos[0][0].id, 'entregado')).status,
        ).toBe(200);
        const res = await rendir(hoja.id);
        expect(res.status).toBe(400);
        expect(mensajeDe(res)).toContain('Quedan 2 paquetes en ruta');
        expect((await detalle(hoja.id)).estado).toBe('abierta');

        const vacia = await nuevoRepartidor();
        const escaneo = await escanear(vacia.id, codigoNuevo());
        expect(escaneo.status).toBe(200);
        const hojaVacia = (escaneo.body as RespuestaEscaneo).hoja;
        const codigoEscaneado = hojaVacia.lineas[0].paqueteId;
        expect(
          (
            await llamar(
              'delete',
              `/api/hojas-ruta/${hojaVacia.id}/paquetes/${codigoEscaneado}`,
            )
          ).status,
        ).toBe(200);
        const sinPaquetes = await rendir(hojaVacia.id);
        expect(sinPaquetes.status).toBe(400);
        expect(mensajeDe(sinPaquetes)).toBe(
          'La hoja del 15-10 no tiene paquetes.',
        );
      });

      it('marcar: deshacer a en_ruta con la hoja abierta; el estado, los ids y los extraños se validan', async () => {
        const repartidor = await nuevoRepartidor();
        const { hoja, grupos } = await armar(repartidor.id, [
          {
            cantidad: 1,
            cobroEnDestino: true,
            precioEnvio: '10000',
            pagoRepartidor: '5000',
          },
        ]);
        const [p] = grupos[0];
        const entregado = await marcar(hoja.id, p.id, 'entregado');
        expect(entregado.status).toBe(200);
        expect(entregado.body).toMatchObject({
          entregados: 1,
          enRuta: 0,
          netoARendir: '5000.0000',
        });
        const deshecho = await marcar(hoja.id, p.id, 'en_ruta');
        expect(deshecho.status).toBe(200);
        expect(deshecho.body).toMatchObject({
          entregados: 0,
          enRuta: 1,
          netoARendir: '0.0000',
        });

        expect((await marcar(hoja.id, p.id, 'perdido')).status).toBe(400);
        expect((await marcar(hoja.id, 'no-es-uuid', 'entregado')).status).toBe(
          400,
        );
        expect((await marcar('no-es-uuid', p.id, 'entregado')).status).toBe(
          400,
        );
        expect((await marcar(hoja.id, uuidAjeno, 'entregado')).status).toBe(
          404,
        );
        expect((await marcar(uuidAjeno, p.id, 'entregado')).status).toBe(404);
        expect((await rendir(uuidAjeno)).status).toBe(404);
        // otro tenant: la hoja no existe
        expect((await rendir(hoja.id, tokenSegundoTenant)).status).toBe(404);
        const ajeno = await llamar(
          'get',
          `/api/hojas-ruta/${hoja.id}`,
          tokenSegundoTenant,
        );
        expect(ajeno.status).toBe(404);
        const lista = await llamar(
          'get',
          `/api/hojas-ruta?desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
          tokenSegundoTenant,
        );
        expect(lista.status).toBe(200);
        expect(lista.body).toEqual([]);
      });

      it('no entregado ayer, entregado hoy con otro repartidor: la hoja de ayer no lo suma, no se puede volver a marcar acá y el resumen cuenta 1 entrega', async () => {
        const ayer = await nuevoRepartidor();
        const hoy = await nuevoRepartidor();
        const { hoja: hojaAyer, grupos } = await armar(
          ayer.id,
          [
            {
              cantidad: 1,
              cobroEnDestino: true,
              precioEnvio: '10000',
              pagoRepartidor: '5000',
            },
          ],
          AYER,
        );
        const [p] = grupos[0];
        expect((await marcar(hojaAyer.id, p.id, 'no_entregado')).status).toBe(
          200,
        );

        const escaneo = await escanear(hoy.id, p.codigo);
        expect(escaneo.status).toBe(200);
        const hojaHoy = (escaneo.body as RespuestaEscaneo).hoja;
        expect((await marcar(hojaHoy.id, p.id, 'entregado')).status).toBe(200);

        // la hoja de ayer, todavía abierta, no suma ese monto ni puede reclamarlo
        expect(await detalle(hojaAyer.id)).toMatchObject({
          asignados: 1,
          entregados: 0,
          montoTotalGeneral: '0.0000',
          netoARendir: '0.0000',
        });
        for (const estado of ['entregado', 'en_ruta']) {
          const choque = await marcar(hojaAyer.id, p.id, estado);
          expect(choque.status).toBe(409);
          expect(mensajeDe(choque)).toBe(
            `El paquete ${p.codigo} ya salió con ${hoy.nombre}: no se puede marcar acá.`,
          );
        }

        const rango = `desde=${AYER}&hasta=${FECHA}`;
        const deAyer = await resumen(`${rango}&repartidorId=${ayer.id}`);
        const deHoy = await resumen(`${rango}&repartidorId=${hoy.id}`);
        expect(deAyer).toMatchObject({
          asignados: 1,
          entregados: 0,
          montoTotalGeneral: '0.0000',
        });
        expect(deHoy).toMatchObject({
          asignados: 1,
          entregados: 1,
          montoTotalGeneral: '10000.0000',
        });
        expect(deAyer.entregados + deHoy.entregados).toBe(1);
        // sumadas las dos, es una sola entrega: 10.000, no 20.000
        expect(
          new Decimal(deAyer.montoTotalGeneral)
            .plus(deHoy.montoTotalGeneral)
            .toFixed(4),
        ).toBe('10000.0000');
      });

      it('resumen y lista: rango invertido, fecha inexistente y parámetros faltantes son 400; sin hojas, ceros', async () => {
        for (const q of [
          'desde=2026-10-31&hasta=2026-10-01',
          'desde=2026-02-31&hasta=2026-03-01',
          'desde=2026-10-01',
          'hasta=2026-10-01',
          'desde=2026-10-01&hasta=2026-10-31&repartidorId=nada',
        ]) {
          expect(
            (await llamar('get', `/api/hojas-ruta/resumen?${q}`)).status,
          ).toBe(400);
          expect((await llamar('get', `/api/hojas-ruta?${q}`)).status).toBe(
            400,
          );
        }
        const invertido = await llamar(
          'get',
          '/api/hojas-ruta/resumen?desde=2026-10-31&hasta=2026-10-01',
        );
        expect(mensajeDe(invertido)).toBe('El rango de fechas está invertido.');
        const vacio = await nuevoRepartidor();
        expect(
          await resumen(
            `desde=${FECHA}&hasta=${FECHA}&repartidorId=${vacio.id}`,
          ),
        ).toEqual({
          asignados: 0,
          entregados: 0,
          cobroDestino: 0,
          montoCobradoDestino: '0.0000',
          montoCobradoTransferencia: '0.0000',
          montoTotalGeneral: '0.0000',
          montoPagoRepartidor: '0.0000',
        });
      });

      it('lista: abiertas con totales en vivo y rendidas con lo congelado, por fecha descendente', async () => {
        const repartidor = await nuevoRepartidor();
        const dias = ['2026-11-02', '2026-11-03'];
        const hojas: HojaRutaDetalle[] = [];
        for (const dia of dias) {
          const { hoja, grupos } = await armar(
            repartidor.id,
            [
              {
                cantidad: 1,
                cobroEnDestino: true,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ],
            dia,
          );
          expect(
            (await marcar(hoja.id, grupos[0][0].id, 'entregado')).status,
          ).toBe(200);
          hojas.push(hoja);
        }
        expect((await rendir(hojas[0].id)).status).toBe(201);

        const res = await llamar(
          'get',
          `/api/hojas-ruta?desde=${dias[0]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
        );
        expect(res.status).toBe(200);
        const filas = res.body as HojaRutaFila[];
        expect(filas.map((f) => [f.fecha, f.estado])).toEqual([
          [dias[1], 'abierta'],
          [dias[0], 'rendida'],
        ]);
        for (const f of filas) {
          expect(f).toMatchObject({
            entregados: 1,
            montoCobradoDestino: '10000.0000',
            netoARendir: '5000.0000',
          });
        }
        expect(
          await resumen(
            `desde=${dias[0]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
          ),
        ).toEqual({
          asignados: 2,
          entregados: 2,
          cobroDestino: 2,
          montoCobradoDestino: '20000.0000',
          montoCobradoTransferencia: '0.0000',
          montoTotalGeneral: '20000.0000',
          montoPagoRepartidor: '10000.0000',
        });
        // el rango es inclusivo en los dos extremos y excluye lo de afuera
        const soloUno = await resumen(
          `desde=${dias[1]}&hasta=${dias[1]}&repartidorId=${repartidor.id}`,
        );
        expect(soloUno.asignados).toBe(1);
      });

      describe('pago al repartidor (tarifa fijada en la línea) y medio de cobro', () => {
        const entregarTodos = (hojaId: string) =>
          llamar(
            'post',
            `/api/hojas-ruta/${hojaId}/entregar-todos`,
            tokenAdmin,
            {},
          );
        const marcarConMedio = (
          hojaId: string,
          paqueteId: string,
          estado: string,
          medioCobro?: unknown,
        ) =>
          llamar(
            'patch',
            `/api/hojas-ruta/${hojaId}/paquetes/${paqueteId}`,
            tokenAdmin,
            medioCobro === undefined ? { estado } : { estado, medioCobro },
          );
        const patchTarifa = (id: string, cuerpo: object) =>
          llamar('patch', `/api/tarifas-pago/${id}`, tokenAdmin, cuerpo);
        it('entregar fija la tarifa en este orden: la del paquete, si no la del repartidor, si no la por defecto', async () => {
          const defecto = `E2E pago 5000 ${sufijoTarifas}`;
          const moto = await tarifaPropia('orden moto', '1900');
          const colina = await tarifaPropia('orden colina', '4000');
          const conMoto = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const sinTarifa = await nuevoRepartidor();
          const pColina = await crearPaquete({ tarifaPagoId: colina.id });
          const pRepartidor = await crearPaquete({});
          const pDefecto = await crearPaquete({});
          const hojaMoto = (
            await asignar(conMoto.id, [pColina.id, pRepartidor.id])
          ).body as HojaRutaDetalle;
          const hojaSin = (await asignar(sinTarifa.id, [pDefecto.id]))
            .body as HojaRutaDetalle;

          // En ruta: lo que se pagaría hoy, marcado como estimado.
          expect(lineaDe(hojaMoto, pColina.id)).toMatchObject({
            tarifaPagoNombre: colina.nombre,
            tarifaPaqueteId: colina.id,
            pagoRepartidor: '4000.0000',
            pagoEstimado: true,
          });
          // La resuelta es la del repartidor, pero el paquete no tiene propia.
          expect(lineaDe(hojaMoto, pRepartidor.id)).toMatchObject({
            tarifaPagoNombre: moto.nombre,
            tarifaPaqueteId: null,
            pagoRepartidor: '1900.0000',
            pagoEstimado: true,
          });
          expect(hojaMoto.montoPagoRepartidor).toBe('0.0000');

          for (const [hoja, p] of [
            [hojaMoto, pColina],
            [hojaMoto, pRepartidor],
            [hojaSin, pDefecto],
          ] as const) {
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          }
          const dMoto = await detalle(hojaMoto.id);
          const dSin = await detalle(hojaSin.id);
          // La del paquete REEMPLAZA a la del repartidor: no se suman.
          expect(lineaDe(dMoto, pColina.id)).toMatchObject({
            tarifaPagoId: colina.id,
            tarifaPagoNombre: colina.nombre,
            pagoRepartidor: '4000.0000',
            pagoEstimado: false,
          });
          expect(lineaDe(dMoto, pRepartidor.id)).toMatchObject({
            tarifaPagoId: moto.id,
            pagoRepartidor: '1900.0000',
            pagoEstimado: false,
          });
          expect(lineaDe(dSin, pDefecto.id)).toMatchObject({
            tarifaPagoNombre: defecto,
            pagoRepartidor: '5000.0000',
            pagoEstimado: false,
          });
          expect(dMoto.montoPagoRepartidor).toBe('5900.0000');
          expect(dSin.montoPagoRepartidor).toBe('5000.0000');
        });

        it('RF1: cambiar el monto de la tarifa después de entregar no mueve la línea ni los totales; lo que sigue en ruta sí muestra el nuevo', async () => {
          const moto = await tarifaPropia('rf1 moto', '1900');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const [entregado, enRuta] = [
            await crearPaquete({ cobroEnDestino: true }),
            await crearPaquete({}),
          ];
          const hoja = (await asignar(repartidor.id, [entregado.id, enRuta.id]))
            .body as HojaRutaDetalle;
          expect(
            (await marcar(hoja.id, entregado.id, 'entregado')).status,
          ).toBe(200);
          const antes = await detalle(hoja.id);
          expect(antes.montoPagoRepartidor).toBe('1900.0000');

          expect((await patchTarifa(moto.id, { monto: '2500' })).status).toBe(
            200,
          );
          const despues = await detalle(hoja.id);
          expect(lineaDe(despues, entregado.id)).toMatchObject({
            pagoRepartidor: '1900.0000',
            pagoEstimado: false,
          });
          expect(despues.montoPagoRepartidor).toBe('1900.0000');
          expect(despues.netoARendir).toBe(antes.netoARendir);
          expect(lineaDe(despues, enRuta.id)).toMatchObject({
            pagoRepartidor: '2500.0000',
            pagoEstimado: true,
          });
          // Marcar de nuevo la entregada no la vuelve a resolver (conserva lo fijado).
          expect(
            (await marcar(hoja.id, entregado.id, 'entregado')).status,
          ).toBe(200);
          expect((await detalle(hoja.id)).montoPagoRepartidor).toBe(
            '1900.0000',
          );
          // Lo entregado después sí toma el monto de ese momento.
          expect((await marcar(hoja.id, enRuta.id, 'entregado')).status).toBe(
            200,
          );
          expect((await detalle(hoja.id)).montoPagoRepartidor).toBe(
            '4400.0000',
          );
          // Y al rendir queda congelado igual.
          const rendida = await rendir(hoja.id);
          expect(rendida.status).toBe(201);
          expect(await detalle(hoja.id)).toMatchObject({
            montoPagoRepartidor: '4400.0000',
          });
        });

        it('cambiar la tarifa del paquete con la línea entregada y la hoja abierta la vuelve a resolver; rendida, no', async () => {
          const moto = await tarifaPropia('reresolver moto', '1900');
          const colina = await tarifaPropia('reresolver colina', '4000');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const p = await crearPaquete({});
          const hoja = (await asignar(repartidor.id, [p.id]))
            .body as HojaRutaDetalle;
          expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          expect((await detalle(hoja.id)).montoPagoRepartidor).toBe(
            '1900.0000',
          );

          const pone = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              tarifaPagoId: colina.id,
            },
          );
          expect(pone.status).toBe(200);
          const conColina = await detalle(hoja.id);
          expect(lineaDe(conColina, p.id)).toMatchObject({
            tarifaPagoId: colina.id,
            pagoRepartidor: '4000.0000',
            pagoEstimado: false,
          });
          expect(conColina.montoPagoRepartidor).toBe('4000.0000');

          const saca = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              tarifaPagoId: null,
            },
          );
          expect(saca.status).toBe(200);
          expect((await detalle(hoja.id)).montoPagoRepartidor).toBe(
            '1900.0000',
          );

          expect((await rendir(hoja.id)).status).toBe(201);
          const tarde = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              tarifaPagoId: colina.id,
            },
          );
          expect(tarde.status).toBe(400);
          expect(mensajeDe(tarde)).toContain('ya se rindió');
          expect((await detalle(hoja.id)).montoPagoRepartidor).toBe(
            '1900.0000',
          );
        });

        it('RF1: editar otro campo del paquete reenviando la MISMA tarifa (o null → null) no mueve la línea entregada ni los totales', async () => {
          const colina = await tarifaPropia('rf1 reenvio colina', '4000');
          const moto = await tarifaPropia('rf1 reenvio moto', '1900');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const conTarifa = await crearPaquete({ tarifaPagoId: colina.id });
          const sinTarifa = await crearPaquete({});
          const hoja = (
            await asignar(repartidor.id, [conTarifa.id, sinTarifa.id])
          ).body as HojaRutaDetalle;
          for (const p of [conTarifa, sinTarifa]) {
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          }
          const antes = await detalle(hoja.id);
          expect(antes.montoPagoRepartidor).toBe('5900.0000');

          // Suben los montos de las dos tarifas con las entregas ya hechas.
          expect((await patchTarifa(colina.id, { monto: '4500' })).status).toBe(
            200,
          );
          expect((await patchTarifa(moto.id, { monto: '2500' })).status).toBe(
            200,
          );

          // El formulario reenvía todos los campos: misma tarifa y otra cosa editada.
          const mismaTarifa = await llamar(
            'patch',
            `/api/paquetes/${conTarifa.id}`,
            tokenAdmin,
            { tarifaPagoId: colina.id, direccion: 'Av. Nueva 123' },
          );
          expect(mismaTarifa.status).toBe(200);
          expect(mismaTarifa.body).toMatchObject({
            direccion: 'Av. Nueva 123',
          });
          const nulaNula = await llamar(
            'patch',
            `/api/paquetes/${sinTarifa.id}`,
            tokenAdmin,
            { tarifaPagoId: null, direccion: 'Av. Nueva 456' },
          );
          expect(nulaNula.status).toBe(200);

          const despues = await detalle(hoja.id);
          expect(lineaDe(despues, conTarifa.id).pagoRepartidor).toBe(
            '4000.0000',
          );
          expect(lineaDe(despues, sinTarifa.id).pagoRepartidor).toBe(
            '1900.0000',
          );
          expect(despues.montoPagoRepartidor).toBe('5900.0000');
          expect(despues.netoARendir).toBe(antes.netoARendir);
        });

        it('RF2: no entregado con Ana (Moto) y entregado al otro día por Pedro (Auto): la hoja de Pedro suma Auto, la de Ana suma 0', async () => {
          const moto = await tarifaPropia('rf2 moto', '1900');
          const auto = await tarifaPropia('rf2 auto', '2400');
          const ana = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const pedro = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: auto.id,
          });
          const p = await crearPaquete({});
          const hojaAna = (await asignar(ana.id, [p.id], { fecha: AYER }))
            .body as HojaRutaDetalle;
          expect((await marcar(hojaAna.id, p.id, 'no_entregado')).status).toBe(
            200,
          );
          const escaneo = await escanear(pedro.id, p.codigo);
          expect(escaneo.status).toBe(200);
          const hojaPedro = (escaneo.body as RespuestaEscaneo).hoja;
          expect((await marcar(hojaPedro.id, p.id, 'entregado')).status).toBe(
            200,
          );

          const dPedro = await detalle(hojaPedro.id);
          expect(dPedro.montoPagoRepartidor).toBe('2400.0000');
          expect(lineaDe(dPedro, p.id)).toMatchObject({
            tarifaPagoNombre: auto.nombre,
          });
          const dAna = await detalle(hojaAna.id);
          expect(dAna.montoPagoRepartidor).toBe('0.0000');
          // La línea no entregada de Ana no guarda pago: solo lo estima.
          expect(await filaDb(hojaAna.id, p.id)).toMatchObject({
            estado: 'no_entregado',
            tarifa_pago_id: null,
            pago_repartidor: null,
          });
        });

        it('7 cobros en efectivo y 3 por transferencia de 10.000 con pago 5.000: neto 50.000, igual que todo en efectivo', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja, grupos } = await armar(repartidor.id, [
            {
              cantidad: 10,
              cobroEnDestino: true,
              precioEnvio: '10000',
              pagoRepartidor: '5000',
            },
          ]);
          const paquetes = grupos[0];
          for (const [i, p] of paquetes.entries()) {
            const res = await marcarConMedio(
              hoja.id,
              p.id,
              'entregado',
              i < 7 ? undefined : 'transferencia',
            );
            expect(res.status).toBe(200);
          }
          const d = await detalle(hoja.id);
          expect(d).toMatchObject({
            cobroDestino: 10,
            montoCobradoDestino: '100000.0000',
            montoCobradoEfectivo: '70000.0000',
            montoCobradoTransferencia: '30000.0000',
            montoPagoRepartidor: '50000.0000',
            netoARendir: '50000.0000',
          });
          expect(
            d.lineas.filter((l) => l.medioCobro === 'efectivo'),
          ).toHaveLength(7);
          expect(
            d.lineas.filter((l) => l.medioCobro === 'transferencia'),
          ).toHaveLength(3);
          expect(
            await resumen(
              `desde=${FECHA}&hasta=${FECHA}&repartidorId=${repartidor.id}`,
            ),
          ).toMatchObject({
            montoCobradoDestino: '100000.0000',
            montoCobradoTransferencia: '30000.0000',
          });

          // El medio se corrige en la fila mientras la hoja esté abierta, sin tocar el pago.
          const cambia = await marcarConMedio(
            hoja.id,
            paquetes[0].id,
            'entregado',
            'transferencia',
          );
          expect(cambia.status).toBe(200);
          expect(cambia.body).toMatchObject({
            montoCobradoEfectivo: '60000.0000',
            montoCobradoTransferencia: '40000.0000',
            montoPagoRepartidor: '50000.0000',
            netoARendir: '50000.0000',
          });

          // Rendir congela el desglose y la hoja rendida lo lee igual.
          const rendida = await rendir(hoja.id);
          expect(rendida.status).toBe(201);
          expect(await detalle(hoja.id)).toMatchObject({
            estado: 'rendida',
            montoCobradoEfectivo: '60000.0000',
            montoCobradoTransferencia: '40000.0000',
            netoARendir: '50000.0000',
          });
          const [fila] = await ds().query<{ e: string; t: string }[]>(
            `SELECT monto_cobrado_efectivo AS e, monto_cobrado_transferencia AS t
               FROM hojas_ruta WHERE hoja_ruta_id = $1`,
            [hoja.id],
          );
          expect(fila).toEqual({ e: '60000.0000', t: '40000.0000' });
          const tarde = await marcarConMedio(
            hoja.id,
            paquetes[0].id,
            'entregado',
            'efectivo',
          );
          expect(tarde.status).toBe(400);
        });

        it('sin medioCobro en un cobro en destino queda efectivo; sin cobro en destino no lleva medio', async () => {
          const repartidor = await nuevoRepartidor();
          const cobra = await crearPaquete({ cobroEnDestino: true });
          const nada = await crearPaquete({ cobroEnDestino: false });
          const hoja = (await asignar(repartidor.id, [cobra.id, nada.id]))
            .body as HojaRutaDetalle;
          expect((await marcar(hoja.id, cobra.id, 'entregado')).status).toBe(
            200,
          );
          expect((await marcar(hoja.id, nada.id, 'entregado')).status).toBe(
            200,
          );
          const d = await detalle(hoja.id);
          expect(lineaDe(d, cobra.id).medioCobro).toBe('efectivo');
          expect(lineaDe(d, nada.id).medioCobro).toBeNull();
        });

        it('RF5: medioCobro sin cobro en destino, con no_entregado o en_ruta, o con un valor inválido: 400 y no se escribe', async () => {
          const repartidor = await nuevoRepartidor();
          const cobra = await crearPaquete({ cobroEnDestino: true });
          const nada = await crearPaquete({ cobroEnDestino: false });
          const hoja = (await asignar(repartidor.id, [cobra.id, nada.id]))
            .body as HojaRutaDetalle;

          const sinCobro = await marcarConMedio(
            hoja.id,
            nada.id,
            'entregado',
            'transferencia',
          );
          expect(sinCobro.status).toBe(400);
          expect(mensajeDe(sinCobro)).toContain('no tiene cobro en destino');
          for (const estado of ['no_entregado', 'en_ruta']) {
            const res = await marcarConMedio(
              hoja.id,
              cobra.id,
              estado,
              'efectivo',
            );
            expect(res.status).toBe(400);
          }
          for (const malo of ['cheque', null, 7]) {
            const res = await marcarConMedio(
              hoja.id,
              cobra.id,
              'entregado',
              malo,
            );
            expect(res.status).toBe(400);
          }
          // Nada se movió: las dos líneas siguen en ruta, sin pago ni medio.
          expect(await filaDb(hoja.id, cobra.id)).toEqual({
            estado: 'en_ruta',
            tarifa_pago_id: null,
            pago_repartidor: null,
            medio_cobro: null,
          });
          expect((await filaDb(hoja.id, nada.id)).estado).toBe('en_ruta');
        });

        it('volver a en_ruta o no_entregado limpia tarifa, pago y medio; al volver a entregar se resuelven de nuevo', async () => {
          const tarifa = await tarifaPropia('limpia', '2000');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: tarifa.id,
          });
          const p = await crearPaquete({ cobroEnDestino: true });
          const hoja = (await asignar(repartidor.id, [p.id]))
            .body as HojaRutaDetalle;
          expect(
            (await marcarConMedio(hoja.id, p.id, 'entregado', 'transferencia'))
              .status,
          ).toBe(200);
          expect(await filaDb(hoja.id, p.id)).toEqual({
            estado: 'entregado',
            tarifa_pago_id: tarifa.id,
            pago_repartidor: '2000.0000',
            medio_cobro: 'transferencia',
          });

          for (const estado of ['en_ruta', 'no_entregado']) {
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
            expect((await marcar(hoja.id, p.id, estado)).status).toBe(200);
            expect(await filaDb(hoja.id, p.id)).toEqual({
              estado,
              tarifa_pago_id: null,
              pago_repartidor: null,
              medio_cobro: null,
            });
          }
          // Con la tarifa en otro monto, la nueva entrega toma el de ahora.
          expect((await patchTarifa(tarifa.id, { monto: '2200' })).status).toBe(
            200,
          );
          expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          expect(await filaDb(hoja.id, p.id)).toEqual({
            estado: 'entregado',
            tarifa_pago_id: tarifa.id,
            pago_repartidor: '2200.0000',
            medio_cobro: 'efectivo',
          });
        });

        it('entregar-todos resuelve el pago de cada línea según su tarifa y deja los cobros en efectivo', async () => {
          const moto = await tarifaPropia('todos moto', '1900');
          const colina = await tarifaPropia('todos colina', '4000');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const cobraMoto = await crearPaquete({ cobroEnDestino: true });
          const cobraColina = await crearPaquete({
            cobroEnDestino: true,
            tarifaPagoId: colina.id,
          });
          const nada = await crearPaquete({});
          const noEntregado = await crearPaquete({});
          const hoja = (
            await asignar(repartidor.id, [
              cobraMoto.id,
              cobraColina.id,
              nada.id,
              noEntregado.id,
            ])
          ).body as HojaRutaDetalle;
          expect(
            (await marcar(hoja.id, noEntregado.id, 'no_entregado')).status,
          ).toBe(200);
          const res = await entregarTodos(hoja.id);
          expect(res.status).toBe(200);
          const d = res.body as HojaRutaDetalle;
          expect(d).toMatchObject({
            entregados: 3,
            montoPagoRepartidor: '7800.0000',
            montoCobradoEfectivo: '20000.0000',
            montoCobradoTransferencia: '0.0000',
          });
          expect(lineaDe(d, cobraMoto.id)).toMatchObject({
            pagoRepartidor: '1900.0000',
            medioCobro: 'efectivo',
            pagoEstimado: false,
          });
          expect(lineaDe(d, cobraColina.id)).toMatchObject({
            pagoRepartidor: '4000.0000',
            medioCobro: 'efectivo',
          });
          expect(lineaDe(d, nada.id)).toMatchObject({
            pagoRepartidor: '1900.0000',
            medioCobro: null,
          });
          expect(
            (await filaDb(hoja.id, noEntregado.id)).pago_repartidor,
          ).toBeNull();
        });

        it('cambiar el cobro en destino de un paquete entregado ajusta su medio: efectivo al activarlo, vacío al quitarlo', async () => {
          const repartidor = await nuevoRepartidor();
          const p = await crearPaquete({ cobroEnDestino: true });
          const hoja = (await asignar(repartidor.id, [p.id]))
            .body as HojaRutaDetalle;
          expect(
            (await marcarConMedio(hoja.id, p.id, 'entregado', 'transferencia'))
              .status,
          ).toBe(200);
          const mismo = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              cobroEnDestino: true,
            },
          );
          expect(mismo.status).toBe(200);
          expect((await filaDb(hoja.id, p.id)).medio_cobro).toBe(
            'transferencia',
          );

          const quita = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              cobroEnDestino: false,
            },
          );
          expect(quita.status).toBe(200);
          expect((await filaDb(hoja.id, p.id)).medio_cobro).toBeNull();
          expect(await detalle(hoja.id)).toMatchObject({
            montoCobradoDestino: '0.0000',
            montoCobradoEfectivo: '0.0000',
            montoCobradoTransferencia: '0.0000',
          });
          const pone = await llamar(
            'patch',
            `/api/paquetes/${p.id}`,
            tokenAdmin,
            {
              cobroEnDestino: true,
            },
          );
          expect(pone.status).toBe(200);
          expect((await filaDb(hoja.id, p.id)).medio_cobro).toBe('efectivo');
          expect(await detalle(hoja.id)).toMatchObject({
            montoCobradoDestino: '10000.0000',
            montoCobradoEfectivo: '10000.0000',
          });
        });

        it('los CHECK de la línea: entregada sin pago, pago sin entregar y un medio inventado se rechazan en la base', async () => {
          const repartidor = await nuevoRepartidor();
          const p = await crearPaquete({ cobroEnDestino: true });
          const hoja = (await asignar(repartidor.id, [p.id]))
            .body as HojaRutaDetalle;
          const restriccion = async (sql: string) =>
            ds()
              .query(sql, [hoja.id, p.id])
              .then(
                () => null,
                (e: { constraint?: string }) => e.constraint ?? 'otro error',
              );
          expect(
            await restriccion(
              `UPDATE hoja_ruta_paquetes SET estado = 'entregado' WHERE hoja_ruta_id = $1 AND paquete_id = $2`,
            ),
          ).toBe('chk_hoja_ruta_paquetes_pago');
          expect(
            await restriccion(
              `UPDATE hoja_ruta_paquetes SET pago_repartidor = 100 WHERE hoja_ruta_id = $1 AND paquete_id = $2`,
            ),
          ).toBe('chk_hoja_ruta_paquetes_pago');
          expect(
            await restriccion(
              `UPDATE hoja_ruta_paquetes SET medio_cobro = 'cheque' WHERE hoja_ruta_id = $1 AND paquete_id = $2`,
            ),
          ).toBe('chk_hoja_ruta_paquetes_medio_cobro');
          expect(
            await restriccion(
              `UPDATE hoja_ruta_paquetes SET medio_cobro = 'efectivo' WHERE hoja_ruta_id = $1 AND paquete_id = $2`,
            ),
          ).toBe('chk_hoja_ruta_paquetes_medio_entregado');
        });
      });

      describe('entregas de plata y rendición por repartidor', () => {
        const unaEntrega: Spec = {
          cantidad: 1,
          cobroEnDestino: true,
          precioEnvio: '10000',
          pagoRepartidor: '5000',
        };
        const entrega = (
          repartidorId: string,
          monto: string,
          extra: object = {},
          token = tokenAdmin,
        ) =>
          llamar('post', '/api/entregas-repartidor', token, {
            repartidorId,
            fecha: FECHA,
            monto,
            medio: 'efectivo',
            ...extra,
          });
        const entregaOk = async (
          repartidorId: string,
          monto: string,
          extra: object = {},
        ) => {
          const res = await entrega(repartidorId, monto, extra);
          expect(res.status).toBe(201);
          return res.body as EntregaRepartidorFila;
        };
        const pendientesDe = async (repartidorId: string) => {
          const res = await llamar(
            'get',
            `/api/entregas-repartidor?repartidorId=${repartidorId}&pendientes=true`,
          );
          expect(res.status).toBe(200);
          return res.body as EntregaRepartidorFila[];
        };
        const previa = (repartidorId: string, hojaIds: string[]) =>
          llamar(
            'get',
            `/api/rendiciones/previa?repartidorId=${repartidorId}&hojaIds=${hojaIds.join(',')}`,
          );
        const entregarTodos = (hojaId: string) =>
          llamar(
            'post',
            `/api/hojas-ruta/${hojaId}/entregar-todos`,
            tokenAdmin,
            {},
          );
        const marcarMedio = (
          hojaId: string,
          paqueteId: string,
          medioCobro: string,
        ) =>
          llamar(
            'patch',
            `/api/hojas-ruta/${hojaId}/paquetes/${paqueteId}`,
            tokenAdmin,
            { estado: 'entregado', medioCobro },
          );
        /** Una hoja de ese día con todo entregado (los cobros en destino, en efectivo). */
        const hojaEntregada = async (
          repartidorId: string,
          fecha: string,
          specs: Spec[] = [unaEntrega],
        ) => {
          const armada = await armar(repartidorId, specs, fecha);
          expect((await entregarTodos(armada.hoja.id)).status).toBe(200);
          return armada;
        };
        const rendicionDe = async (id: string) => {
          const res = await llamar('get', `/api/rendiciones/${id}`);
          expect(res.status).toBe(200);
          return res.body as RendicionDetalle;
        };
        /** Lo que una rendición escribe, leído de la base: estado y `rendicion_id` de las hojas, y de las entregas del repartidor. */
        const escrito = (hojaIds: string[], repartidorId: string) =>
          ds().query<unknown[]>(
            `SELECT 'hoja' AS t, hoja_ruta_id::text AS id, estado AS a, rendicion_id::text AS b
               FROM hojas_ruta WHERE hoja_ruta_id = ANY($1)
             UNION ALL
             SELECT 'entrega', entrega_repartidor_id::text, eliminado_el::text, rendicion_id::text
               FROM entregas_repartidor WHERE repartidor_id = $2
             UNION ALL
             SELECT 'rendicion', rendicion_id::text, eliminado_el::text, repartidor_id::text
               FROM rendiciones WHERE repartidor_id = $2
             ORDER BY 1, 2`,
            [hojaIds, repartidorId],
          );

        it('el ejemplo del spec: cobrado 100.000 (70.000 efectivo, 30.000 transferencia), pago 50.000 y 40.000 entregados el martes dejan saldo 10.000; previa y rendir dan lo mismo', async () => {
          const repartidor = await nuevoRepartidor();
          const martes = '2026-10-13';
          const { hoja, grupos } = await armar(
            repartidor.id,
            [{ ...unaEntrega, cantidad: 10 }],
            martes,
          );
          for (const [i, p] of grupos[0].entries()) {
            expect(
              (
                await marcarMedio(
                  hoja.id,
                  p.id,
                  i < 7 ? 'efectivo' : 'transferencia',
                )
              ).status,
            ).toBe(200);
          }
          const e = await entregaOk(repartidor.id, '40000', { fecha: martes });

          const antes = await previa(repartidor.id, [hoja.id]);
          expect(antes.status).toBe(200);
          const p = antes.body as RendicionDetalle;
          expect(p).toMatchObject({ id: null, rendidaEl: null });
          expect(p.totales).toEqual({
            entregados: 10,
            montoCobradoDestino: '100000.0000',
            montoCobradoEfectivo: '70000.0000',
            montoCobradoTransferencia: '30000.0000',
            montoPagoRepartidor: '50000.0000',
            montoEntregadoACuenta: '40000.0000',
            saldo: '10000.0000',
          });
          expect(p.entregas.map((x) => x.id)).toEqual([e.id]);
          // La previa no escribe nada.
          expect((await detalle(hoja.id)).estado).toBe('abierta');
          expect(await pendientesDe(repartidor.id)).toHaveLength(1);

          const res = await rendirHojas(repartidor.id, [hoja.id]);
          expect(res.status).toBe(201);
          const r = res.body as RendicionDetalle;
          expect(r.id).not.toBeNull();
          expect(r.totales).toEqual(p.totales);
          expect(r.dias).toEqual(p.dias);
          expect(r.tarifas).toEqual(p.tarifas);
          expect(r.entregas).toEqual([{ ...e, rendicionId: r.id }]);
          expect(await rendicionDe(r.id!)).toEqual(r);
        });

        it('con un pago mayor a lo cobrado el saldo es negativo: la empresa le paga', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja } = await hojaEntregada(repartidor.id, FECHA, [
            { ...unaEntrega, cantidad: 2, cobroEnDestino: false },
          ]);
          const res = await rendirHojas(repartidor.id, [hoja.id]);
          expect(res.status).toBe(201);
          expect((res.body as RendicionDetalle).totales).toMatchObject({
            montoCobradoDestino: '0.0000',
            montoPagoRepartidor: '10000.0000',
            montoEntregadoACuenta: '0.0000',
            saldo: '-10000.0000',
          });
        });

        it('la planilla: una semana de 6 hojas por fecha ascendente, el conteo por tarifa y Σ pago de los días = pago total', async () => {
          const moto = await tarifaPropia('planilla moto', '1900');
          const colina = await tarifaPropia('planilla colina', '4000');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const dias = [
            '2026-11-09',
            '2026-11-10',
            '2026-11-11',
            '2026-11-12',
            '2026-11-13',
            '2026-11-14',
          ];
          const cantidades = [3, 2, 4, 1, 3, 2];
          const colinas = new Map([
            [2, 1],
            [5, 1],
          ]);
          const hojaIds: string[] = [];
          // Se crean en desorden: la planilla las ordena por fecha, no por creación.
          for (const i of [3, 0, 5, 1, 4, 2]) {
            const ids: string[] = [];
            for (let k = 0; k < cantidades[i]; k++) {
              const p = await crearPaquete(
                k < (colinas.get(i) ?? 0)
                  ? { tarifaPagoId: colina.id, cobroEnDestino: k === 0 }
                  : { cobroEnDestino: k === 0 },
              );
              ids.push(p.id);
            }
            const hoja = (await asignar(repartidor.id, ids, { fecha: dias[i] }))
              .body as HojaRutaDetalle;
            expect((await entregarTodos(hoja.id)).status).toBe(200);
            hojaIds.push(hoja.id);
          }

          const res = await previa(repartidor.id, hojaIds);
          expect(res.status).toBe(200);
          const p = res.body as RendicionDetalle;
          expect(p.dias.map((d) => d.fecha)).toEqual(dias);
          expect(p.dias.map((d) => d.porTarifa)).toEqual([
            { [moto.id]: 3 },
            { [moto.id]: 2 },
            { [moto.id]: 3, [colina.id]: 1 },
            { [moto.id]: 1 },
            { [moto.id]: 3 },
            { [moto.id]: 1, [colina.id]: 1 },
          ]);
          expect(p.tarifas).toEqual([
            { id: moto.id, nombre: moto.nombre, monto: '1900.0000' },
            { id: colina.id, nombre: colina.nombre, monto: '4000.0000' },
          ]);
          const sumaDias = p.dias
            .reduce((acc, d) => acc.plus(d.montoPagoRepartidor), new Decimal(0))
            .toFixed(4);
          // 13 × 1.900 + 2 × 4.000
          expect(p.totales.montoPagoRepartidor).toBe('32700.0000');
          expect(sumaDias).toBe(p.totales.montoPagoRepartidor);
          expect(p.dias.reduce((n, d) => n + d.entregados, 0)).toBe(15);
          expect(p.totales.entregados).toBe(15);
          for (const d of p.dias) {
            expect(Object.values(d.porTarifa).reduce((a, b) => a + b, 0)).toBe(
              d.entregados,
            );
          }

          const rendida = await rendirHojas(repartidor.id, hojaIds);
          expect(rendida.status).toBe(201);
          expect((rendida.body as RendicionDetalle).dias).toEqual(p.dias);
          expect(
            await rendicionDe((rendida.body as RendicionDetalle).id!),
          ).toEqual(rendida.body);
        });

        it('después de rendir: las hojas y las entregas apuntan a la rendición, y su detalle no cambia si cambia el monto de una tarifa', async () => {
          const moto = await tarifaPropia('congela moto', '1900');
          const repartidor = await nuevoRepartidor(tokenAdmin, {
            tarifaPagoId: moto.id,
          });
          const uno = await hojaEntregada(repartidor.id, '2026-11-16');
          const dos = await hojaEntregada(repartidor.id, '2026-11-17');
          const e = await entregaOk(repartidor.id, '2500');
          const hojaIds = [uno.hoja.id, dos.hoja.id];
          const res = await rendirHojas(repartidor.id, hojaIds);
          expect(res.status).toBe(201);
          const r = res.body as RendicionDetalle;

          const guardado = await escrito(hojaIds, repartidor.id);
          expect(guardado).toHaveLength(4);
          expect(guardado).toEqual(
            expect.arrayContaining([
              ...hojaIds.map((id) => ({
                t: 'hoja',
                id,
                a: 'rendida',
                b: r.id,
              })),
              { t: 'entrega', id: e.id, a: null, b: r.id },
            ]),
          );
          for (const id of hojaIds) {
            expect((await detalle(id)).estado).toBe('rendida');
          }

          const cambio = await llamar(
            'patch',
            `/api/tarifas-pago/${moto.id}`,
            tokenAdmin,
            { monto: '2500' },
          );
          expect(cambio.status).toBe(200);
          expect(await rendicionDe(r.id!)).toEqual(r);
        });

        it('RF4: hojaIds con una hoja de otro repartidor, una rendida, una con paquetes en ruta, una ajena, repetida o vacío: 400 y ninguna hoja ni entrega cambia', async () => {
          const repartidor = await nuevoRepartidor();
          const otro = await nuevoRepartidor();
          const buena = await hojaEntregada(repartidor.id, '2026-10-20');
          const deOtro = await hojaEntregada(otro.id, '2026-10-20');
          const yaRendida = await hojaEntregada(repartidor.id, '2026-10-21');
          expect(
            (await rendirHojas(repartidor.id, [yaRendida.hoja.id])).status,
          ).toBe(201);
          const enRuta = await armar(
            repartidor.id,
            [{ ...unaEntrega, cantidad: 2 }],
            '2026-10-22',
          );
          expect(
            (await marcar(enRuta.hoja.id, enRuta.grupos[0][0].id, 'entregado'))
              .status,
          ).toBe(200);
          await entregaOk(repartidor.id, '1000');

          const todas = [
            buena.hoja.id,
            deOtro.hoja.id,
            yaRendida.hoja.id,
            enRuta.hoja.id,
          ];
          const antes = await escrito(todas, repartidor.id);
          for (const [hojaIds, mensaje] of [
            [[buena.hoja.id, deOtro.hoja.id], /no es de este repartidor/],
            [[buena.hoja.id, yaRendida.hoja.id], /ya está rendida/],
            [[buena.hoja.id, enRuta.hoja.id], /Quedan 1 paquetes en ruta/],
            [[buena.hoja.id, uuidAjeno], /no existe o no es de este/],
            [[], /hojaIds/],
            [[buena.hoja.id, buena.hoja.id], /hojaIds/],
            [['no-es-uuid'], /hojaIds/],
          ] as const) {
            const res = await rendirHojas(repartidor.id, [...hojaIds]);
            expect(res.status).toBe(400);
            expect(JSON.stringify(res.body)).toMatch(mensaje);
            expect(await escrito(todas, repartidor.id)).toEqual(antes);
          }
          // La previa exige lo mismo.
          expect(
            (await previa(repartidor.id, [buena.hoja.id, enRuta.hoja.id]))
              .status,
          ).toBe(400);

          const bien = await rendirHojas(repartidor.id, [buena.hoja.id]);
          expect(bien.status).toBe(201);
          expect((bien.body as RendicionDetalle).entregas).toHaveLength(1);
        });

        it('RF3: una entrega anulada o corregida después de rendir es 400; una creada después queda pendiente para la próxima', async () => {
          const repartidor = await nuevoRepartidor();
          const uno = await hojaEntregada(repartidor.id, '2026-10-23');
          const e1 = await entregaOk(repartidor.id, '2000');
          const r1 = await rendirHojas(repartidor.id, [uno.hoja.id]);
          expect(r1.status).toBe(201);
          const primera = r1.body as RendicionDetalle;
          expect(primera.totales.montoEntregadoACuenta).toBe('2000.0000');

          const anula = await llamar(
            'delete',
            `/api/entregas-repartidor/${e1.id}`,
          );
          expect(anula.status).toBe(400);
          expect(mensajeDe(anula)).toContain('ya está rendida');
          const corrige = await llamar(
            'patch',
            `/api/entregas-repartidor/${e1.id}`,
            tokenAdmin,
            { monto: '1' },
          );
          expect(corrige.status).toBe(400);
          expect(await rendicionDe(primera.id!)).toEqual(primera);

          const e2 = await entregaOk(repartidor.id, '3000');
          expect(e2.rendicionId).toBeNull();
          expect((await pendientesDe(repartidor.id)).map((x) => x.id)).toEqual([
            e2.id,
          ]);
          const dos = await hojaEntregada(repartidor.id, '2026-10-24');
          const r2 = await rendirHojas(repartidor.id, [dos.hoja.id]);
          expect(r2.status).toBe(201);
          const segunda = r2.body as RendicionDetalle;
          expect(segunda.entregas.map((x) => x.id)).toEqual([e2.id]);
          expect(segunda.totales.montoEntregadoACuenta).toBe('3000.0000');
          expect(await rendicionDe(primera.id!)).toEqual(primera);
        });

        it('RF3: dos POST /rendiciones simultáneos con las mismas hojas: uno rinde, el otro 400, y las entregas suman una sola vez', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja } = await hojaEntregada(repartidor.id, FECHA);
          const e = await entregaOk(repartidor.id, '7000');
          const [a, b] = await Promise.all([
            rendirHojas(repartidor.id, [hoja.id]),
            rendirHojas(repartidor.id, [hoja.id]),
          ]);
          expect([a.status, b.status].sort()).toEqual([201, 400]);
          const ganadora = (a.status === 201 ? a : b).body as RendicionDetalle;
          expect(ganadora.totales.montoEntregadoACuenta).toBe('7000.0000');
          const perdedora = a.status === 400 ? a : b;
          expect(mensajeDe(perdedora)).toContain('ya está rendida');
          const [{ n }] = await ds().query<{ n: number }[]>(
            `SELECT COUNT(*)::int AS n FROM rendiciones WHERE repartidor_id = $1`,
            [repartidor.id],
          );
          expect(n).toBe(1);
          expect(await escrito([hoja.id], repartidor.id)).toEqual([
            { t: 'entrega', id: e.id, a: null, b: ganadora.id },
            { t: 'hoja', id: hoja.id, a: 'rendida', b: ganadora.id },
            { t: 'rendicion', id: ganadora.id, a: null, b: repartidor.id },
          ]);
        });

        it.each([
          [
            'la rendición llega primero: gana, y la corrección rebota con 400',
            'patch',
            'rendir',
            400,
            '5000.0000',
          ],
          [
            'la corrección llega primero: gana, y la rendición suma el monto nuevo',
            'patch',
            'cambio',
            200,
            '9000.0000',
          ],
          [
            'la rendición llega primero: gana, y la anulación rebota con 400',
            'delete',
            'rendir',
            400,
            '5000.0000',
          ],
          [
            'la anulación llega primero: gana, y la rendición no la cuenta',
            'delete',
            'cambio',
            200,
            '0.0000',
          ],
        ] as const)(
          'RF3: corregir o anular una entrega a la vez que se rinde (%s)',
          async (_titulo, accion, primero, esperadoCambio, aCuenta) => {
            const repartidor = await nuevoRepartidor();
            const { hoja } = await hojaEntregada(repartidor.id, FECHA);
            const e = await entregaOk(repartidor.id, '5000');
            const rendicion = async () => rendirHojas(repartidor.id, [hoja.id]);
            const cambio = async () =>
              accion === 'patch'
                ? llamar(
                    'patch',
                    `/api/entregas-repartidor/${e.id}`,
                    tokenAdmin,
                    { monto: '9000' },
                  )
                : llamar('delete', `/api/entregas-repartidor/${e.id}`);
            const { respuestas, esperando } = await correrCarrera(
              ds(),
              [
                'SELECT 1 FROM entregas_repartidor WHERE entrega_repartidor_id = $1 FOR UPDATE',
                [e.id],
              ],
              primero === 'rendir' ? [rendicion, cambio] : [cambio, rendicion],
              { escalonarMs: 300 },
            );
            expect(esperando).toBe(2);
            const [rRendir, rCambio] =
              primero === 'rendir'
                ? [respuestas[0], respuestas[1]]
                : [respuestas[1], respuestas[0]];
            expect([rRendir.status, rCambio.status]).toEqual([
              201,
              esperadoCambio,
            ]);
            if (rCambio.status === 400) {
              expect(mensajeDe(rCambio)).toContain('ya está rendida');
            }
            // Dentro con su monto final o afuera: nunca contada dos veces ni perdida.
            const r = rRendir.body as RendicionDetalle;
            expect(r.totales.montoEntregadoACuenta).toBe(aCuenta);
            expect(r.entregas).toHaveLength(aCuenta === '0.0000' ? 0 : 1);
            expect(await rendicionDe(r.id!)).toEqual(r);
          },
        );

        it('POST /hojas-ruta/:id/rendir ya no existe: 404', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja } = await hojaEntregada(repartidor.id, FECHA);
          const res = await llamar(
            'post',
            `/api/hojas-ruta/${hoja.id}/rendir`,
            tokenAdmin,
            {},
          );
          expect(res.status).toBe(404);
          expect((await detalle(hoja.id)).estado).toBe('abierta');
        });

        it('GET /hojas-ruta?pendientes=true trae solo las hojas sin rendir, sin pedir rango', async () => {
          const repartidor = await nuevoRepartidor();
          const rendida = await hojaEntregada(repartidor.id, '2026-10-26');
          const abierta = await armar(
            repartidor.id,
            [unaEntrega],
            '2026-10-27',
          );
          expect(
            (await rendirHojas(repartidor.id, [rendida.hoja.id])).status,
          ).toBe(201);
          const res = await llamar(
            'get',
            `/api/hojas-ruta?pendientes=true&repartidorId=${repartidor.id}`,
          );
          expect(res.status).toBe(200);
          expect((res.body as HojaRutaFila[]).map((h) => h.id)).toEqual([
            abierta.hoja.id,
          ]);
          // Sin `pendientes` el rango sigue siendo obligatorio.
          expect(
            (
              await llamar(
                'get',
                `/api/hojas-ruta?repartidorId=${repartidor.id}`,
              )
            ).status,
          ).toBe(400);
        });

        it('GET /rendiciones: por rango de las hojas y repartidor; rango inválido, 400; otro tenant no ve nada', async () => {
          const repartidor = await nuevoRepartidor();
          const uno = await hojaEntregada(repartidor.id, '2026-12-01');
          const dos = await hojaEntregada(repartidor.id, '2026-12-03');
          const res = await rendirHojas(repartidor.id, [
            uno.hoja.id,
            dos.hoja.id,
          ]);
          expect(res.status).toBe(201);
          const r = res.body as RendicionDetalle;

          const lista = await llamar(
            'get',
            `/api/rendiciones?desde=2026-12-03&hasta=2026-12-09&repartidorId=${repartidor.id}`,
          );
          expect(lista.status).toBe(200);
          expect(lista.body as RendicionFila[]).toEqual([
            {
              id: r.id,
              repartidorId: repartidor.id,
              repartidorNombre: repartidor.nombre,
              rendidaEl: r.rendidaEl,
              desde: '2026-12-01',
              hasta: '2026-12-03',
              hojas: 2,
              totales: r.totales,
            },
          ]);
          const fuera = await llamar(
            'get',
            `/api/rendiciones?desde=2026-12-04&hasta=2026-12-09&repartidorId=${repartidor.id}`,
          );
          expect(fuera.status).toBe(200);
          expect(fuera.body).toEqual([]);
          for (const q of [
            'desde=2026-12-09&hasta=2026-12-01',
            'desde=2026-12-01',
            'desde=2026-12-01&hasta=2026-12-09&repartidorId=nada',
          ]) {
            expect((await llamar('get', `/api/rendiciones?${q}`)).status).toBe(
              400,
            );
          }
          const ajena = await llamar(
            'get',
            `/api/rendiciones?desde=2026-12-01&hasta=2026-12-09&repartidorId=${repartidor.id}`,
            tokenSegundoTenant,
          );
          expect(ajena.status).toBe(200);
          expect(ajena.body).toEqual([]);
          expect(
            (
              await llamar(
                'get',
                `/api/rendiciones/${r.id}`,
                tokenSegundoTenant,
              )
            ).status,
          ).toBe(404);
          expect(
            (await llamar('get', `/api/rendiciones/${uuidAjeno}`)).status,
          ).toBe(404);
          expect((await previa(uuidAjeno, [uno.hoja.id])).status).toBe(404);
          expect(
            (
              await llamar(
                'get',
                `/api/rendiciones/previa?repartidorId=${repartidor.id}`,
              )
            ).status,
          ).toBe(400);
          // `hojaIds` repetido en vez de separado por comas también vale.
          expect(
            (
              await llamar(
                'get',
                `/api/rendiciones/previa?repartidorId=${repartidor.id}&hojaIds=${uno.hoja.id}&hojaIds=${dos.hoja.id}`,
              )
            ).status,
          ).toBe(400); // ya rendidas: llega al service, que las rechaza
        });

        it('las entregas de plata: se validan, se corrigen, se anulan y no se mezclan entre tenants', async () => {
          const repartidor = await nuevoRepartidor();
          const ajeno = await nuevoRepartidor(tokenSegundoTenant);
          for (const malo of [
            { monto: '0' },
            { monto: '-5' },
            { monto: '1000.5' },
            { monto: 'mucho' },
            { medio: 'cheque' },
            { fecha: '2026-13-45' },
            { nota: 'x'.repeat(501) },
            { repartidorId: 'no-es-uuid' },
            { pagadoPor: 'x' },
          ]) {
            expect((await entrega(repartidor.id, '1000', malo)).status).toBe(
              400,
            );
          }
          expect((await entrega(uuidAjeno, '1000')).status).toBe(404);
          expect((await entrega(ajeno.id, '1000')).status).toBe(404);

          const e = await entregaOk(repartidor.id, '1000', {
            nota: 'Dejó la plata',
            medio: 'transferencia',
          });
          expect(e).toMatchObject({
            repartidorId: repartidor.id,
            repartidorNombre: repartidor.nombre,
            fecha: FECHA,
            monto: '1000.0000',
            medio: 'transferencia',
            nota: 'Dejó la plata',
            rendicionId: null,
          });
          const url = `/api/entregas-repartidor/${e.id}`;
          const editada = await llamar('patch', url, tokenAdmin, {
            monto: '12000',
            medio: 'efectivo',
            fecha: '2026-10-14',
          });
          expect(editada.status).toBe(200);
          expect(editada.body).toMatchObject({
            monto: '12000.0000',
            medio: 'efectivo',
            fecha: '2026-10-14',
            nota: 'Dejó la plata',
          });
          const sinNota = await llamar('patch', url, tokenAdmin, {
            nota: null,
          });
          expect(sinNota.status).toBe(200);
          expect((sinNota.body as EntregaRepartidorFila).nota).toBeNull();
          expect((await llamar('patch', url, tokenAdmin, {})).status).toBe(200);
          for (const malo of [{ monto: '0' }, { medio: 'cheque' }, { x: 1 }]) {
            expect((await llamar('patch', url, tokenAdmin, malo)).status).toBe(
              400,
            );
          }
          expect(
            (await llamar('patch', url, tokenSegundoTenant, { monto: '5' }))
              .status,
          ).toBe(404);
          expect((await llamar('delete', url, tokenSegundoTenant)).status).toBe(
            404,
          );
          const delAjeno = await llamar(
            'get',
            `/api/entregas-repartidor?repartidorId=${repartidor.id}`,
            tokenSegundoTenant,
          );
          expect(delAjeno.status).toBe(200);
          expect(delAjeno.body).toEqual([]);

          // Con entregas el repartidor no se borra: se desactiva (y sigue pudiendo recibir una).
          const borrar = await llamar(
            'delete',
            `/api/repartidores/${repartidor.id}`,
          );
          expect(borrar.status).toBe(400);
          expect(mensajeDe(borrar)).toContain('entregas de plata');
          expect(
            (
              await llamar(
                'patch',
                `/api/repartidores/${repartidor.id}`,
                tokenAdmin,
                { activo: false },
              )
            ).status,
          ).toBe(200);
          expect((await entrega(repartidor.id, '500')).status).toBe(201);

          const anulada = await llamar('delete', url);
          expect(anulada.status).toBe(200);
          expect(anulada.body).toEqual({ success: true });
          expect((await llamar('delete', url)).status).toBe(404);
          expect(
            (await llamar('patch', url, tokenAdmin, { monto: '5' })).status,
          ).toBe(404);
          const todas = await llamar(
            'get',
            `/api/entregas-repartidor?repartidorId=${repartidor.id}`,
          );
          expect(todas.status).toBe(200);
          expect(
            (todas.body as EntregaRepartidorFila[]).map((x) => x.id),
          ).not.toContain(e.id);
        });
      });

      describe('carreras', () => {
        it('rendir dos veces a la vez: una 200 y otra 400, totales sin cambio', async () => {
          const repartidor = await nuevoRepartidor();
          const { hoja, grupos } = await armar(repartidor.id, [
            {
              cantidad: 2,
              cobroEnDestino: true,
              precioEnvio: '10000',
              pagoRepartidor: '5000',
            },
          ]);
          for (const p of grupos[0]) {
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
          }
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            [
              'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
              [hoja.id],
            ],
            [async () => rendir(hoja.id), async () => rendir(hoja.id)],
          );
          expect(esperando).toBe(2);
          expect(respuestas.map((r) => r.status).sort()).toEqual([201, 400]);
          const perdedora = respuestas.find((r) => r.status === 400)!;
          expect(mensajeDe(perdedora)).toContain('ya está rendida');
          expect(await congelado(hoja.id)).toMatchObject({
            estado: 'rendida',
            monto_total_general: '20000.0000',
            neto_a_rendir: '10000.0000',
          });
        });

        it.each([
          [
            'la rendición llega primero: gana, y el cambio de monto rebota con 400',
            'rendir',
            201,
            400,
            '10000.0000',
          ],
          [
            'el cambio de monto llega primero: gana, y la rendición congela el monto nuevo',
            'patch',
            201,
            200,
            '12000.0000',
          ],
        ] as const)(
          'cambiar el monto de un entregado a la vez que se rinde su hoja (%s)',
          async (
            _titulo,
            primero,
            esperadoRendir,
            esperadoPatch,
            montoFinal,
          ) => {
            const repartidor = await nuevoRepartidor();
            const { hoja, grupos } = await armar(repartidor.id, [
              {
                cantidad: 1,
                cobroEnDestino: true,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ]);
            const [p] = grupos[0];
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);

            const rendicion = async () => rendir(hoja.id);
            const cambio = async () =>
              llamar('patch', `/api/paquetes/${p.id}`, tokenAdmin, {
                precioEnvio: '12000',
              });
            const { respuestas, esperando } = await correrCarrera(
              ds(),
              [
                'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
                [hoja.id],
              ],
              primero === 'rendir' ? [rendicion, cambio] : [cambio, rendicion],
              { escalonarMs: 300 },
            );
            expect(esperando).toBe(2);
            const [rRendir, rPatch] =
              primero === 'rendir'
                ? [respuestas[0], respuestas[1]]
                : [respuestas[1], respuestas[0]];
            expect([rRendir.status, rPatch.status]).toEqual([
              esperadoRendir,
              esperadoPatch,
            ]);
            if (rPatch.status === 400) {
              expect(mensajeDe(rPatch)).toContain('ya se rindió');
            }

            // Pase lo que pase en el orden: lo congelado es lo que el paquete valía al rendir.
            const fila = await congelado(hoja.id);
            expect(fila.estado).toBe('rendida');
            expect(fila.monto_total_general).toBe(montoFinal);
            expect(fila.monto_cobrado_destino).toBe(montoFinal);
            expect((await paquetePorCodigo(p.codigo)).precioEnvio).toBe(
              montoFinal,
            );
          },
        );

        it.each([
          [
            'la rendición llega primero: gana, y el cambio de tarifa rebota con 400',
            'rendir',
            201,
            400,
            '5000.0000',
          ],
          [
            'el cambio de tarifa llega primero: gana, y la rendición congela el pago nuevo',
            'patch',
            201,
            200,
            '3000.0000',
          ],
        ] as const)(
          'cambiar la tarifa de un entregado a la vez que se rinde su hoja (%s)',
          async (
            _titulo,
            primero,
            esperadoRendir,
            esperadoPatch,
            pagoFinal,
          ) => {
            const repartidor = await nuevoRepartidor();
            const { hoja, grupos } = await armar(repartidor.id, [
              {
                cantidad: 1,
                cobroEnDestino: true,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ]);
            const [p] = grupos[0];
            expect((await marcar(hoja.id, p.id, 'entregado')).status).toBe(200);
            const otra = await tarifaPorMonto('3000');

            const rendicion = async () => rendir(hoja.id);
            const cambio = async () =>
              llamar('patch', `/api/paquetes/${p.id}`, tokenAdmin, {
                tarifaPagoId: otra,
              });
            const { respuestas, esperando } = await correrCarrera(
              ds(),
              [
                'SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE',
                [hoja.id],
              ],
              primero === 'rendir' ? [rendicion, cambio] : [cambio, rendicion],
              { escalonarMs: 300 },
            );
            expect(esperando).toBe(2);
            const [rRendir, rPatch] =
              primero === 'rendir'
                ? [respuestas[0], respuestas[1]]
                : [respuestas[1], respuestas[0]];
            expect([rRendir.status, rPatch.status]).toEqual([
              esperadoRendir,
              esperadoPatch,
            ]);
            // Lo congelado es lo que la línea pagaba al rendir, y es lo que queda en la línea.
            const rendida = await detalle(hoja.id);
            expect(rendida.estado).toBe('rendida');
            expect(rendida.montoPagoRepartidor).toBe(pagoFinal);
            expect(lineaDe(rendida, p.id).pagoRepartidor).toBe(pagoFinal);
            expect((await filaDb(hoja.id, p.id)).pago_repartidor).toBe(
              pagoFinal,
            );
          },
        );

        it('el mismo paquete marcado entregado a la vez desde dos hojas: uno gana y el otro recibe 409', async () => {
          const ayer = await nuevoRepartidor();
          const hoy = await nuevoRepartidor();
          const { hoja: hojaAyer, grupos } = await armar(
            ayer.id,
            [
              {
                cantidad: 1,
                cobroEnDestino: false,
                precioEnvio: '10000',
                pagoRepartidor: '5000',
              },
            ],
            AYER,
          );
          const [p] = grupos[0];
          expect((await marcar(hojaAyer.id, p.id, 'no_entregado')).status).toBe(
            200,
          );
          const escaneo = await escanear(hoy.id, p.codigo);
          expect(escaneo.status).toBe(200);
          const hojaHoy = (escaneo.body as RespuestaEscaneo).hoja;
          expect((await marcar(hojaHoy.id, p.id, 'no_entregado')).status).toBe(
            200,
          );

          // Compuerta: el paquete. Las dos marcas llegan al cerrojo del paquete y se serializan.
          const { respuestas, esperando } = await correrCarrera(
            ds(),
            ['SELECT 1 FROM paquetes WHERE paquete_id = $1 FOR UPDATE', [p.id]],
            [
              async () => marcar(hojaAyer.id, p.id, 'entregado'),
              async () => marcar(hojaHoy.id, p.id, 'entregado'),
            ],
          );
          expect(esperando).toBe(2);
          expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
          const [{ entregadas }] = await ds().query<{ entregadas: number }[]>(
            `SELECT COUNT(*)::int AS entregadas FROM hoja_ruta_paquetes
              WHERE paquete_id = $1 AND estado = 'entregado' AND eliminado_el IS NULL`,
            [p.id],
          );
          expect(entregadas).toBe(1);
        });
      });
    });
  });

  describe('tenant demo', () => {
    const DEMO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440502';
    const ADMIN_DEMO = { email: 'admin@paquetes.cl', pass: 'admin' };
    let tokenDemo: string;

    beforeAll(async () => {
      tokenDemo = await login(
        app,
        ADMIN_DEMO.email,
        ADMIN_DEMO.pass,
        DEMO_TENANT_ID,
      );
    });

    it('el admin del demo ve solo Paquetería: su único permiso es Paquetería:Leer', async () => {
      const res = await llamar('get', '/api/rbac/mis-permisos', tokenDemo);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(['Paquetería:Leer']);
    });

    it('no es superadmin ni miembro de otro tenant: entrar a Paris es 401/403', async () => {
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: ADMIN_DEMO.email, password: ADMIN_DEMO.pass });
      expect(resLogin.status).toBe(200);
      const res = await request(app.getHttpServer())
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
      expect([401, 403]).toContain(res.status);
    });

    it('abre con números: 8 hojas (la semana de Juan y el día de María rendidos, una abierta hoy con 4 en ruta) y 30 paquetes', async () => {
      const yo = await llamar('get', '/api/tenants/me', tokenDemo);
      expect(yo.status).toBe(200);
      const hoy = (yo.body as { diaNegocioHoy: string }).diaNegocioHoy;

      const res = await llamar(
        'get',
        `/api/hojas-ruta?desde=${fechaMenosDias(hoy, 7)}&hasta=${hoy}`,
        tokenDemo,
      );
      expect(res.status).toBe(200);
      const hojas = res.body as HojaRutaFila[];
      expect(hojas.map((h) => [h.fecha, h.estado])).toEqual([
        [hoy, 'abierta'],
        [fechaMenosDias(hoy, 1), 'rendida'],
        [fechaMenosDias(hoy, 2), 'rendida'],
        [fechaMenosDias(hoy, 3), 'rendida'],
        [fechaMenosDias(hoy, 4), 'rendida'],
        [fechaMenosDias(hoy, 5), 'rendida'],
        [fechaMenosDias(hoy, 6), 'rendida'],
        [fechaMenosDias(hoy, 7), 'rendida'],
      ]);

      const [abierta, ayer, ...semana] = hojas;
      expect(abierta).toMatchObject({ asignados: 4, enRuta: 4, entregados: 0 });
      // La hoja pendiente de hoy es la única que ofrece la pantalla de rendición.
      const pendientes = await llamar(
        'get',
        '/api/hojas-ruta?pendientes=true',
        tokenDemo,
      );
      expect(pendientes.status).toBe(200);
      expect((pendientes.body as HojaRutaFila[]).map((h) => h.id)).toEqual([
        abierta.id,
      ]);
      // María va en Bicicleta (1.800) con 1 "Colina" entre 5 entregados (el 6º no se entregó):
      // 4 × 1.800 + 4.000 = 11.200. Cobró 3 envíos en destino, 1 de ellos por transferencia.
      expect(ayer).toMatchObject({
        asignados: 6,
        enRuta: 0,
        entregados: 5,
        cobroDestino: 3,
        montoCobradoDestino: '30000.0000',
        montoCobradoEfectivo: '20000.0000',
        montoCobradoTransferencia: '10000.0000',
        montoPagoRepartidor: '11200.0000',
        netoARendir: '18800.0000',
      });
      // Juan va en Moto (1.900): 17 entregados (uno no se entregó) y 3 "Colina" → 14 × 1.900 +
      // 3 × 4.000 = 38.600. Cobró 5 envíos en destino, 1 por transferencia.
      expect(semana).toHaveLength(6);
      const suma = (campo: 'montoPagoRepartidor' | 'montoCobradoDestino') =>
        semana
          .reduce((acc, h) => acc.plus(h[campo]), new Decimal(0))
          .toFixed(4);
      expect(suma('montoPagoRepartidor')).toBe('38600.0000');
      expect(suma('montoCobradoDestino')).toBe('50000.0000');

      const paquetes = await llamar(
        'get',
        '/api/paquetes?pageSize=100',
        tokenDemo,
      );
      expect(paquetes.status).toBe(200);
      const pagina = paquetes.body as PaginatedResponse<PaqueteFila>;
      expect(pagina.meta.total).toBe(30);
      expect(pagina.data.every((p) => /^46\d{9}$/.test(p.codigo))).toBe(true);
      // Un tercio con cobro en destino y la mitad con dirección y comuna.
      expect(pagina.data.filter((p) => p.cobroEnDestino)).toHaveLength(10);
      expect(pagina.data.filter((p) => p.direccion && p.comuna)).toHaveLength(
        15,
      );
    });

    it('trae dos rendiciones: la semana de Juan (6 días, una entrega de plata) y el día de María', async () => {
      const yo = await llamar('get', '/api/tenants/me', tokenDemo);
      expect(yo.status).toBe(200);
      const hoy = (yo.body as { diaNegocioHoy: string }).diaNegocioHoy;
      const lista = await llamar(
        'get',
        `/api/rendiciones?desde=${fechaMenosDias(hoy, 7)}&hasta=${hoy}`,
        tokenDemo,
      );
      expect(lista.status).toBe(200);
      const filas = lista.body as RendicionFila[];
      expect(filas.map((f) => [f.repartidorNombre, f.hojas]).sort()).toEqual([
        ['Juan Pérez', 6],
        ['María Soto', 1],
      ]);
      const juan = filas.find((f) => f.repartidorNombre === 'Juan Pérez')!;
      expect([juan.desde, juan.hasta]).toEqual([
        fechaMenosDias(hoy, 7),
        fechaMenosDias(hoy, 2),
      ]);

      const res = await llamar('get', `/api/rendiciones/${juan.id}`, tokenDemo);
      expect(res.status).toBe(200);
      const d = res.body as RendicionDetalle;
      expect(d.dias.map((x) => x.fecha)).toEqual(
        [7, 6, 5, 4, 3, 2].map((n) => fechaMenosDias(hoy, n)),
      );
      expect(d.tarifas.map((t) => [t.nombre, t.monto])).toEqual([
        ['Moto', '1900.0000'],
        ['Colina', '4000.0000'],
      ]);
      expect(d.totales).toEqual({
        entregados: 17,
        montoCobradoDestino: '50000.0000',
        montoCobradoEfectivo: '40000.0000',
        montoCobradoTransferencia: '10000.0000',
        montoPagoRepartidor: '38600.0000',
        montoEntregadoACuenta: '8000.0000',
        saldo: '3400.0000',
      });
      expect(d.entregas).toHaveLength(1);
      expect(d.entregas[0]).toMatchObject({
        monto: '8000.0000',
        medio: 'efectivo',
      });
      expect(juan.totales).toEqual(d.totales);
    });

    it('trae sus tarifas de pago (Auto por defecto), repartidores con la suya y paquetes con Colina; la configuración queda completa', async () => {
      const tarifas = await llamar('get', '/api/tarifas-pago', tokenDemo);
      expect(tarifas.status).toBe(200);
      expect(
        (tarifas.body as TarifaPagoFila[]).map((t) => [
          t.nombre,
          t.monto,
          t.esDefecto,
        ]),
      ).toEqual([
        ['Auto', '1900.0000', true],
        ['Bicicleta', '1800.0000', false],
        ['Colina', '4000.0000', false],
        ['Moto', '1900.0000', false],
      ]);
      const reps = await llamar('get', '/api/repartidores', tokenDemo);
      expect(reps.status).toBe(200);
      expect(
        (reps.body as RepartidorFila[]).every((r) => r.tarifaPagoId !== null),
      ).toBe(true);
      const paquetes = await llamar(
        'get',
        '/api/paquetes?pageSize=100',
        tokenDemo,
      );
      expect(paquetes.status).toBe(200);
      expect(
        (paquetes.body as PaginatedResponse<PaqueteFila>).data.filter(
          (p) => p.tarifaPagoNombre === 'Colina',
        ),
      ).toHaveLength(5);
      const config = await llamar(
        'get',
        '/api/paquetes/configuracion',
        tokenDemo,
      );
      expect(config.status).toBe(200);
      expect(config.body).toEqual({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
      });
    });

    it('nace con lo que le da TenantsService.create: métodos de pago habilitados y los motivos fijos', async () => {
      const [fila] = await app.get(DataSource).query<Record<string, number>[]>(
        `SELECT
           (SELECT COUNT(*)::int FROM tenant_metodo_pago
             WHERE tenant_id = $1 AND habilitada AND eliminado_el IS NULL) AS metodos,
           (SELECT COUNT(*)::int FROM tenant_metodo_pago
             WHERE tenant_id = $1 AND NOT habilitada) AS apagados,
           (SELECT COUNT(*)::int FROM motivo_baja WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS baja,
           (SELECT COUNT(*)::int FROM motivo_diferencia_caja WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS caja,
           (SELECT COUNT(*)::int FROM motivo_diferencia_inventario WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS inventario,
           (SELECT COUNT(*)::int FROM motivo_traslado WHERE tenant_id = $1 AND es_fijo AND eliminado_el IS NULL) AS traslado`,
        [DEMO_TENANT_ID],
      );
      expect(fila).toEqual({
        metodos: 4,
        apagados: 0,
        baja: MOTIVOS_BAJA_FIJOS.length,
        caja: MOTIVOS_DIFERENCIA_DEFAULTS.length,
        inventario: MOTIVOS_DIFERENCIA_INVENTARIO_FIJOS.length,
        traslado: MOTIVOS_TRASLADO_FIJOS.length,
      });
    });

    it('el seed corrido otra vez no duplica ni pisa nada', async () => {
      const contar = async (): Promise<Record<string, number>> => {
        const filas = await app
          .get(DataSource)
          .query<{ tabla: string; n: number }[]>(
            `SELECT 'tenants' AS tabla, COUNT(*)::int AS n FROM tenants
           UNION ALL SELECT 'usuarios', COUNT(*)::int FROM usuarios
           UNION ALL SELECT 'usuarios_tenants', COUNT(*)::int FROM usuarios_tenants
           UNION ALL SELECT 'roles', COUNT(*)::int FROM roles
           UNION ALL SELECT 'roles_usuarios', COUNT(*)::int FROM roles_usuarios
           UNION ALL SELECT 'modulos_app', COUNT(*)::int FROM modulos_app
           UNION ALL SELECT 'modulo_app_permisos', COUNT(*)::int FROM modulo_app_permisos
           UNION ALL SELECT 'tenant_modulos', COUNT(*)::int FROM tenant_modulos
           UNION ALL SELECT 'ubicaciones', COUNT(*)::int FROM ubicaciones
           UNION ALL SELECT 'cajas', COUNT(*)::int FROM cajas
           UNION ALL SELECT 'tenant_moneda', COUNT(*)::int FROM tenant_moneda
           UNION ALL SELECT 'tenant_formula_precio', COUNT(*)::int FROM tenant_formula_precio
           UNION ALL SELECT 'tenant_metodo_pago', COUNT(*)::int FROM tenant_metodo_pago
           UNION ALL SELECT 'motivo_baja', COUNT(*)::int FROM motivo_baja
           UNION ALL SELECT 'motivo_diferencia_caja', COUNT(*)::int FROM motivo_diferencia_caja
           UNION ALL SELECT 'motivo_diferencia_inventario', COUNT(*)::int FROM motivo_diferencia_inventario
           UNION ALL SELECT 'motivo_traslado', COUNT(*)::int FROM motivo_traslado
           UNION ALL SELECT 'paquete_configuracion', COUNT(*)::int FROM paquete_configuracion
           UNION ALL SELECT 'tarifas_pago', COUNT(*)::int FROM tarifas_pago
           UNION ALL SELECT 'repartidores', COUNT(*)::int FROM repartidores
           UNION ALL SELECT 'paquetes', COUNT(*)::int FROM paquetes
           UNION ALL SELECT 'hojas_ruta', COUNT(*)::int FROM hojas_ruta
           UNION ALL SELECT 'hoja_ruta_paquetes', COUNT(*)::int FROM hoja_ruta_paquetes
           UNION ALL SELECT 'rendiciones', COUNT(*)::int FROM rendiciones
           UNION ALL SELECT 'entregas_repartidor', COUNT(*)::int FROM entregas_repartidor`,
          );
        return Object.fromEntries(filas.map((f) => [f.tabla, f.n]));
      };
      const hojasDemo = async () =>
        app.get(DataSource).query<unknown[]>(
          `SELECT hoja_ruta_id, estado, rendida_el, rendicion_id, total_asignados, neto_a_rendir
             FROM hojas_ruta WHERE tenant_id = $1 ORDER BY hoja_ruta_id`,
          [DEMO_TENANT_ID],
        );

      const antes = await contar();
      const hojasAntes = await hojasDemo();
      const tarifasDemo = () =>
        app.get(DataSource).query<unknown[]>(
          `SELECT 'r' AS t, repartidor_id AS id, tarifa_pago_id FROM repartidores WHERE tenant_id = $1
           UNION ALL SELECT 'p', paquete_id, tarifa_pago_id FROM paquetes WHERE tenant_id = $1
           ORDER BY 1, 2`,
          [DEMO_TENANT_ID],
        );
      const tarifasAntes = await tarifasDemo();
      // Un demo sembrado antes de las tarifas: repartidores y paquetes sin tarifa. El seed la
      // completa, salvo en lo entregado en una hoja rendida (regla 7: de solo lectura).
      const [{ ids }] = await app.get(DataSource).query<{ ids: string[] }[]>(
        `SELECT COALESCE(array_agg(DISTINCT l.paquete_id), '{}') AS ids
           FROM hoja_ruta_paquetes l
           JOIN hojas_ruta h ON h.hoja_ruta_id = l.hoja_ruta_id
          WHERE l.tenant_id = $1 AND l.estado = 'entregado' AND h.estado = 'rendida'`,
        [DEMO_TENANT_ID],
      );
      for (const tabla of ['repartidores', 'paquetes']) {
        await app
          .get(DataSource)
          .query(
            `UPDATE ${tabla} SET tarifa_pago_id = NULL WHERE tenant_id = $1`,
            [DEMO_TENANT_ID],
          );
      }
      await app.get(SeederService).onApplicationBootstrap();
      const rendidos = new Set(ids);
      const antesFilas = tarifasAntes as {
        t: string;
        id: string;
        tarifa_pago_id: string | null;
      }[];
      try {
        expect(await tarifasDemo()).toEqual(
          antesFilas.map((f) =>
            f.t === 'p' && rendidos.has(f.id)
              ? { ...f, tarifa_pago_id: null }
              : f,
          ),
        );
      } finally {
        // La base de pruebas queda como estaba: lo de una hoja rendida el seed no lo repone.
        for (const f of antesFilas) {
          if (f.t !== 'p' || !rendidos.has(f.id)) continue;
          await app
            .get(DataSource)
            .query(
              `UPDATE paquetes SET tarifa_pago_id = $2 WHERE paquete_id = $1`,
              [f.id, f.tarifa_pago_id],
            );
        }
      }
      expect(await contar()).toEqual(antes);
      expect(await hojasDemo()).toEqual(hojasAntes);
    });

    // Va al final: deja el demo a medias a propósito (`reset-db.sh` antes de cada corrida).
    it('un demo sembrado por una versión anterior: el seed nunca deja una hoja abierta y vacía', async () => {
      const ds = app.get(DataSource);
      const HOJA_NUEVA = '550e8400-e29b-41d4-a716-446655440590';
      const HOJA_VIEJA = '550e8400-e29b-41d4-a716-446655440516';
      // Estado viejo: los paquetes de la hoja 590 ya tienen su línea en otra hoja y la 590 no existe.
      await ds.query(
        `UPDATE hoja_ruta_paquetes SET hoja_ruta_id = $2 WHERE hoja_ruta_id = $1`,
        [HOJA_NUEVA, HOJA_VIEJA],
      );
      await ds.query(`DELETE FROM hojas_ruta WHERE hoja_ruta_id = $1`, [
        HOJA_NUEVA,
      ]);
      await app.get(SeederService).onApplicationBootstrap();
      const [{ vacias, nueva }] = await ds.query<
        { vacias: number; nueva: number }[]
      >(
        `SELECT
           (SELECT COUNT(*)::int FROM hojas_ruta h
             WHERE h.tenant_id = $1 AND h.eliminado_el IS NULL AND h.estado = 'abierta'
               AND NOT EXISTS (SELECT 1 FROM hoja_ruta_paquetes l
                                WHERE l.hoja_ruta_id = h.hoja_ruta_id AND l.eliminado_el IS NULL)) AS vacias,
           (SELECT COUNT(*)::int FROM hojas_ruta WHERE hoja_ruta_id = $2) AS nueva`,
        [DEMO_TENANT_ID, HOJA_NUEVA],
      );
      expect(vacias).toBe(0);
      expect(nueva).toBe(0);
    });
  });
});
