import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { unwrap } from '../src/common/utils/pg-returning.util';

// Task 2 de la feature "papelera": categorías es la entidad de referencia —
// familia TypeORM, sin nombre único, sin colaterales. Este spec es el patrón
// que las tareas siguientes (3-6) replican para el resto de los 16 recursos.

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin: rol Administrador, es_fijo=true → short-circuit de permisos, y el
// único que pasa TenantAdminGuard.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Vendedor: no es admin del tenant → TenantAdminGuard lo rechaza tanto en
// DELETE como en restaurar.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

// Fixtures del seed compartidas por varios describes de este archivo.
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
// 'directo' (descuento) y 'general' (recargo): los únicos tipos de regla del
// seed que no exigen tramos/metodoPagoIds/fechas — solo `valor` en el caso de
// 'general'. Minimizan el payload de creación.
const DESCUENTO_DIRECTO_TIPO_ID = '550e8400-e29b-41d4-a716-446655440337';
const RECARGO_GENERAL_TIPO_ID = '550e8400-e29b-41d4-a716-446655440122';

interface TokenResponse {
  access_token: string;
}
interface CategoriaItem {
  id: string;
  nombre: string;
  activo: boolean;
  eliminadoEl: string | null;
  eliminadoPor: string | null;
  eliminadoPorNombre?: string | null;
}
interface CausaMermaItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
}
interface ItemResponse {
  id: string;
  activo: boolean;
  impuestosIds?: string[];
  descuentosIds?: string[];
  recargosIds?: string[];
  extrasPermitidos?: { ingredienteItemId: string }[];
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

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Papelera (e2e) — categorías, patrón de referencia', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let categoriaId: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /categorias con admin → 201 crea la categoría de prueba', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Categoría papelera E2E ${Date.now()}` });

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.id).toBeDefined();
    expect(body.eliminadoEl).toBeNull();
    categoriaId = body.id;
  });

  it('DELETE /categorias/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /categorias/:id con admin → 200 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
  });

  it('GET /categorias sin flag no trae la categoría borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeUndefined();
  });

  it('GET /categorias?incluirEliminados=true trae la categoría con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    const borrada = categorias.find((c) => c.id === categoriaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /categorias/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('POST /categorias/:id/restaurar con admin → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const categorias = listado.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeDefined();
  });

  it('POST /categorias/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

// Revisión final de la feature: decisión del owner — la papelera solo
// expone y restaura lo que borró UNA PERSONA. El seeder soft-deletea filas
// como corrección del sistema (`remapImpuestosOficialesDuplicados`,
// ADR-018) sin `eliminado_por`; esas filas quedan invisibles e
// irrestaurables, igual que cualquier fila borrada ANTES de esta feature
// (también sin `eliminado_por` — indistinguible de un borrado del sistema,
// ver docs/features/papelera.md). Se simula el borrado del sistema con un
// `UPDATE` directo (sin pasar por `DELETE /api/...`, que siempre setea
// `eliminado_por` al usuario autenticado) para no depender de que el seed
// produzca un duplicado de IVA real en el momento exacto de correr el test.
//
// ⚠️ **Corregido el 2026-08-01.** Este bloque cubría 2 de los 16 recursos
// —`categorias` e `items`, una por familia de borrado— y esa muestra fue
// exactamente el agujero: el criterio para elegirlos fue la familia (cómo
// borran), no la forma del `WHERE` (dónde puede fallar el filtro). El único
// recurso cuyo listado arma un `WHERE` de **dos ramas** es `impuestos`
// (tenant OR país), y era el único que se saltaba el filtro entero — sin
// ningún test que lo viera. Ahora corre sobre los 16: la familia no es la
// propiedad que decide quién puede fallar.
describe('Papelera (e2e) — decisión del owner: solo lo que borró una persona', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let salonParaMesaId: string;
  let itemParaOpcionId: string;

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
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    // `mesas` no tiene endpoint de creación propio ni listado propio: cuelga
    // de un salón, que tiene que quedar VIVO para que el listado de la
    // papelera llegue hasta la mesa.
    salonParaMesaId = await crearPorApi('salones', {
      nombre: `Salón contenedor borrado-sistema E2E ${Date.now()}`,
    });
    // `grupos-modificadores` exige al menos una opción válida: un producto
    // vivo del catálogo.
    itemParaOpcionId = await crearPorApi('items', {
      nombre: `Opción borrado-sistema E2E ${Date.now()}`,
      precioBase: '500',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock: '10',
      costo: '500',
    });
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function crearPorApi(
    path: string,
    body: Record<string, unknown>,
    idField = 'id',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/api/${path}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(body);
    expect(res.status).toBe(201);
    const id = (res.body as Record<string, string>)[idField];
    expect(id).toBeDefined();
    return id;
  }

  /** ¿El id aparece en un listado plano (la forma de 14 de los 16)? */
  async function enListadoPlano(
    path: string,
    id: string,
    idField = 'id',
  ): Promise<boolean> {
    const res = await request(app.getHttpServer())
      .get(`/api/${path}?incluirEliminados=true`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return (res.body as Record<string, string>[]).some(
      (f) => f[idField] === id,
    );
  }

  interface RecursoPapelera {
    nombre: string;
    /** Prefijo de `POST /api/<path>/:id/restaurar`. */
    path: string;
    tabla: string;
    pk: string;
    /** Devuelve el id Y el nombre único: `items` necesita el nombre para
     *  buscar en un listado paginado (ver su `enPapelera`). */
    crear: () => Promise<{ id: string; nombreFila: string }>;
    /** Default: listado plano de `path` buscando por `id`. */
    enPapelera?: (id: string, nombreFila: string) => Promise<boolean>;
  }

  const sufijo = () =>
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * Crea la fila con un nombre único y devuelve id + nombre. El nombre se
   * genera acá y no dentro de cada `crearBody` para que la fila sepa con qué
   * nombre quedó: sin eso, un listado paginado solo se puede consultar por
   * página y una aserción de ausencia se cumple sola al pasar de página 1.
   */
  async function crearFila(
    path: string,
    etiqueta: string,
    body: (nombre: string) => Record<string, unknown>,
    idField = 'id',
  ): Promise<{ id: string; nombreFila: string }> {
    const nombreFila = `${etiqueta} borrado-sistema E2E ${sufijo()}`;
    const id = await crearPorApi(path, body(nombreFila), idField);
    return { id, nombreFila };
  }

  const recursos: RecursoPapelera[] = [
    {
      nombre: 'categorias',
      path: 'categorias',
      tabla: 'categorias',
      pk: 'categoria_id',
      crear: () => crearFila('categorias', 'Categoría', (n) => ({ nombre: n })),
    },
    {
      nombre: 'items',
      path: 'items',
      tabla: 'items',
      pk: 'item_id',
      crear: () =>
        crearFila('items', 'Item', (n) => ({
          nombre: n,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        })),
      // El único listado paginado de los 16, y por eso el único que NO puede
      // asertar ausencia sobre una página: ordena por nombre con LIMIT, así
      // que en cuanto el tenant pase de 100 ítems —y cada corrida local crea
      // ítems— el buscado cae fuera de la página 1 y la aserción se cumple
      // sola. Se filtra por su nombre único para que el conjunto sea de 1.
      enPapelera: async (id, nombreFila) => {
        const res = await request(app.getHttpServer())
          .get(
            `/api/items?incluirEliminados=true&search=${encodeURIComponent(nombreFila)}`,
          )
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(200);
        return (res.body as { data: { id: string }[] }).data.some(
          (i) => i.id === id,
        );
      },
    },
    {
      nombre: 'causas-merma',
      path: 'causas-merma',
      tabla: 'causas_merma',
      pk: 'causa_merma_id',
      crear: () => crearFila('causas-merma', 'Causa', (n) => ({ nombre: n })),
    },
    {
      nombre: 'descuentos',
      path: 'descuentos',
      tabla: 'descuentos',
      pk: 'descuento_id',
      crear: () =>
        crearFila('descuentos', 'Descuento', (n) => ({
          nombre: n,
          tipoReglaId: DESCUENTO_DIRECTO_TIPO_ID,
          modo: 'porcentaje',
        })),
    },
    {
      nombre: 'recargos',
      path: 'recargos',
      tabla: 'recargos',
      pk: 'recargo_id',
      crear: () =>
        crearFila('recargos', 'Recargo', (n) => ({
          nombre: n,
          tipoReglaId: RECARGO_GENERAL_TIPO_ID,
          valor: '0.05',
          modo: 'porcentaje',
        })),
    },
    {
      // EL QUE MOTIVÓ ESTA PARAMETRIZACIÓN: único listado con `OR` de dos
      // ramas (impuestos del tenant + impuestos oficiales del país).
      nombre: 'impuestos',
      path: 'impuestos',
      tabla: 'impuestos',
      pk: 'impuesto_id',
      crear: () =>
        crearFila('impuestos', 'Impuesto', (n) => ({
          nombre: n,
          porcentaje: '0.05',
        })),
    },
    {
      nombre: 'terceros',
      path: 'terceros',
      tabla: 'terceros',
      pk: 'tercero_id',
      crear: () =>
        crearFila('terceros', 'Tercero', (n) => ({
          tipo: 'proveedor',
          nombre: n,
        })),
    },
    {
      nombre: 'cajones',
      path: 'cajones',
      tabla: 'cajones',
      pk: 'cajon_id',
      crear: () => crearFila('cajones', 'Cajón', (n) => ({ nombre: n })),
    },
    {
      nombre: 'garzones',
      path: 'garzones',
      tabla: 'garzones',
      pk: 'garzon_id',
      crear: () => crearFila('garzones', 'Garzón', (n) => ({ nombre: n })),
    },
    {
      nombre: 'turnos',
      path: 'turnos',
      tabla: 'turnos',
      pk: 'turno_id',
      crear: () =>
        crearFila('turnos', 'Turno', (n) => ({
          nombre: n,
          horaInicio: '12:00',
          horaFin: '14:00',
        })),
    },
    {
      nombre: 'impresoras',
      path: 'impresoras',
      tabla: 'impresoras',
      pk: 'impresora_id',
      crear: () =>
        crearFila('impresoras', 'Impresora', (n) => ({
          nombre: n,
          rol: 'boleta',
          tipoConexion: 'sistema',
          nombreCola: `COLA_SIST_E2E_${sufijo()}`,
        })),
    },
    {
      nombre: 'salones',
      path: 'salones',
      tabla: 'salones',
      pk: 'salon_id',
      crear: () => crearFila('salones', 'Salón', (n) => ({ nombre: n })),
    },
    {
      nombre: 'mesas',
      path: 'mesas',
      tabla: 'mesas',
      pk: 'mesa_id',
      crear: () =>
        crearFila(`salones/${salonParaMesaId}/mesas`, 'Mesa', (n) => ({
          nombre: n,
        })),
      // Las mesas no tienen listado propio: viajan anidadas en el de salones.
      enPapelera: async (id) => {
        const res = await request(app.getHttpServer())
          .get('/api/salones?incluirEliminados=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        expect(res.status).toBe(200);
        return (res.body as { mesas: { id: string }[] }[]).some((s) =>
          s.mesas.some((m) => m.id === id),
        );
      },
    },
    {
      nombre: 'grupos-modificadores',
      path: 'grupos-modificadores',
      tabla: 'grupos_modificadores',
      pk: 'grupo_modificador_id',
      crear: () =>
        crearFila(
          'grupos-modificadores',
          'Grupo',
          (n) => ({
            nombre: n,
            opciones: [{ itemId: itemParaOpcionId, precioExtra: '0' }],
          }),
          'grupoModificadorId',
        ),
      enPapelera: (id) =>
        enListadoPlano('grupos-modificadores', id, 'grupoModificadorId'),
    },
    {
      nombre: 'motivos-diferencia',
      path: 'motivos-diferencia',
      tabla: 'motivo_diferencia_caja',
      pk: 'motivo_diferencia_id',
      crear: () =>
        crearFila('motivos-diferencia', 'Motivo', (n) => ({ nombre: n })),
    },
    {
      nombre: 'motivos-diferencia-inventario',
      path: 'motivos-diferencia-inventario',
      tabla: 'motivo_diferencia_inventario',
      pk: 'motivo_diferencia_inventario_id',
      crear: () =>
        crearFila('motivos-diferencia-inventario', 'Motivo inv', (n) => ({
          nombre: n,
        })),
    },
  ];

  // El guard de cobertura, derivado del ESQUEMA y no de sí mismo. Un
  // `toHaveLength(16)` —o una lista de nombres escrita acá al lado— solo
  // comprueba que el array coincida consigo mismo: agregar el recurso 17 en
  // el backend sin tocar este spec pasaría en silencio, que es justo el
  // agujero que el guard dice cerrar.
  //
  // `eliminado_por` es la columna que define la regla del owner ("solo lo que
  // borró una persona"), así que cualquier tabla que la tenga es, por
  // construcción, candidata a papelera. Contrastar contra
  // `information_schema` hace que el test lo diga la BD: agregar la columna a
  // una tabla nueva rompe acá hasta que alguien decida —conscientemente— si
  // va a la lista o no.
  it('la lista cubre TODAS las tablas con `eliminado_por` del esquema', async () => {
    const tablas = unwrap<{ table_name: string }>(
      await ds.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'eliminado_por'
          ORDER BY table_name`,
      ),
    ).map((r) => r.table_name);

    expect(tablas).toHaveLength(16);
    expect([...recursos.map((r) => r.tabla)].sort()).toEqual(tablas);
  });

  for (const recurso of recursos) {
    it(`${recurso.nombre}: una fila borrada sin eliminado_por no aparece en la papelera ni se puede restaurar`, async () => {
      const { id, nombreFila } = await recurso.crear();

      // El borrado del sistema: `eliminado_el` sin `eliminado_por`, igual que
      // lo deja el seeder. No pasa por `DELETE /api/...` a propósito.
      // Lo que cubre el `RETURNING` NO es un nombre de tabla o de PK
      // inexistente —eso lo tira Postgres solo, con o sin RETURNING—: cubre el
      // par VÁLIDO PERO CRUZADO, o sea tabla y PK que existen pero cuyo id no
      // es el que devolvió la API (el caso de `grupoModificadorId`). Sin la
      // aserción, ese cruce afecta 0 filas y el test pasa en verde sin haber
      // borrado nada.
      const borradas = unwrap<{ pk: string }>(
        await ds.query(
          `UPDATE ${recurso.tabla} SET eliminado_el = NOW()
            WHERE ${recurso.pk} = $1 RETURNING ${recurso.pk} AS pk`,
          [id],
        ),
      );
      expect(borradas).toHaveLength(1);

      const visible = recurso.enPapelera
        ? await recurso.enPapelera(id, nombreFila)
        : await enListadoPlano(recurso.path, id);
      expect(visible).toBe(false);

      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(404);
    });

    // El segundo camino, el que no se veía: la regla mira `eliminado_por`,
    // así que restaurar tiene que DEJARLO EN NULL. Si sobrevive al restore,
    // el próximo borrado del sistema sobre esa misma fila queda disfrazado de
    // borrado de persona y vuelve a ser restaurable por API. En `impuestos`
    // eso significa revivir un duplicado de IVA que
    // `remapImpuestosOficialesDuplicados` borró — la doble tributación del
    // 38% de ADR-018, con tres llamadas públicas y un reinicio.
    it(`${recurso.nombre}: restaurar deja eliminado_por en NULL, así que un borrado del sistema posterior sigue invisible`, async () => {
      const { id, nombreFila } = await recurso.crear();

      // 1. Borrado de persona por API: deja `eliminado_por` = admin.paris.
      const resBorrar = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect([200, 204]).toContain(resBorrar.status);

      // 2. Restaurar: revive la fila Y limpia el autor del borrado revertido.
      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(201);

      // La aserción directa contra la BD, no contra el cuerpo de la
      // respuesta: varios de los 16 no devuelven `eliminadoPor`, así que un
      // test que solo mirara el JSON pasaría con la columna sucia.
      const [fila] = unwrap<{
        eliminado_el: Date | null;
        eliminado_por: string | null;
      }>(
        await ds.query(
          `SELECT eliminado_el, eliminado_por FROM ${recurso.tabla}
            WHERE ${recurso.pk} = $1`,
          [id],
        ),
      );
      expect(fila).toBeDefined();
      expect(fila.eliminado_el).toBeNull();
      expect(fila.eliminado_por).toBeNull();

      // 3. Ahora el borrado del sistema sobre la MISMA fila: sin el paso 2
      //    correcto, el `eliminado_por` viejo la haría visible y restaurable.
      await ds.query(
        `UPDATE ${recurso.tabla} SET eliminado_el = NOW()
          WHERE ${recurso.pk} = $1`,
        [id],
      );

      const visible = recurso.enPapelera
        ? await recurso.enPapelera(id, nombreFila)
        : await enListadoPlano(recurso.path, id);
      expect(visible).toBe(false);

      const resRestaurarOtraVez = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurarOtraVez.status).toBe(404);
    });
  }
});

// Task 3: causas de merma — segunda referencia. Familia SQL cruda (no
// softDelete() de TypeORM) y con nombre único por tenant, así que agrega el
// 400 de colisión al restaurar: el índice único es parcial (WHERE
// eliminado_el IS NULL), así que mientras la causa está borrada, otra causa
// puede tomar su nombre y competir cuando se intenta revivirla.
describe('Papelera (e2e) — causas de merma, SQL cruda + colisión de nombre', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let causaId: string;
  let causaNombre: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /causas-merma con admin → 201 crea la causa de prueba', async () => {
    causaNombre = `Vencimiento E2E ${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.id).toBeDefined();
    causaId = body.id;
  });

  it('DELETE /causas-merma/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /causas-merma/:id con admin → 204 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });

  it('GET /causas-merma sin flag no trae la causa borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeUndefined();
  });

  it('GET /causas-merma?incluirEliminados=true trae la causa con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    const borrada = causas.find((c) => c.id === causaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /causas-merma/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('colisión real de Postgres: crear otra causa con el mismo nombre y restaurar la borrada → 400, nada cambia', async () => {
    // Mientras `causaId` estaba borrada, nadie competía por su nombre: se
    // puede crear una causa nueva y activa con el mismo nombre.
    const otra = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });
    expect(otra.status).toBe(201);
    const otraId = (otra.body as CausaMermaItem).id;

    // El 23505 lo tira Postgres de verdad (índice único parcial), no un mock.
    const restaurar = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(restaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    const viva = causas.find((c) => c.id === otraId);
    const borrada = causas.find((c) => c.id === causaId);
    expect(viva?.eliminadoEl).toBeNull();
    expect(borrada?.eliminadoEl).not.toBeNull();

    // Limpieza: sin la causa activa que ocupa el nombre, restaurar sí puede.
    const deleteOtra = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${otraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(deleteOtra.status).toBe(204);
  });

  it('POST /causas-merma/:id/restaurar con admin (sin colisión) → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeDefined();
  });

  it('POST /causas-merma/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

// Task 4: items — la entidad que motivó la feature entera y la más delicada
// de las 16: es la única que se restaura INACTIVA (`remove()` pisa
// `activo = false` y el valor previo no sobrevive en ninguna parte) y una de
// las dos que arrastra colateral (`receta_extras_permitidos`, en las dos
// direcciones — como ingrediente y como receta que ofrece el extra).
//
// El guard no es `TenantAdminGuard` como en categorías/causas de merma: items
// usa `PermisosGuard` + `@RequiresPermiso('Items', 'Eliminar')` (heredado del
// `@Controller`). El usuario "sin permiso" sigue siendo vendedor@paris.cl: el
// seed le da `Items: Leer` (necesita ver el catálogo para el POS) pero no
// `Eliminar` (seedVendedorPermisosCaja, seeder.service.ts).
describe('Papelera (e2e) — items, restaurar INACTIVO + colateral acotado por timestamp', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenSinPermiso: string;
  let itemId: string;

  // Descuento "Promo fija $5.000" y recargo "Interés cuotas 5%": los dos con
  // `condicionTipo: NINGUNA` en el seed de Paris — se asocian al ítem sin
  // depender de ninguna condición de venta.
  const DESCUENTO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440338';
  const RECARGO_SIN_CONDICION_ID = '550e8400-e29b-41d4-a716-446655440115';
  // Efectivo: el único método de pago con `permiteVuelto` en el seed — paga
  // de más sin que la venta rechace el sobrepago.
  const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenSinPermiso = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('la promesa de la feature: item con impuesto propio + descuento + recargo → borrar → restaurar conserva las tres reglas, e inactivo', async () => {
    const resImpuesto = await request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Impuesto papelera E2E ${Date.now()}`,
        porcentaje: '0.05',
      });
    expect(resImpuesto.status).toBe(201);
    const impuestoId = (resImpuesto.body as { id: string }).id;

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Servicio papelera E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        impuestosIds: [impuestoId],
        descuentosIds: [DESCUENTO_SIN_CONDICION_ID],
        recargosIds: [RECARGO_SIN_CONDICION_ID],
      });
    expect(resItem.status).toBe(201);
    const item = resItem.body as ItemResponse;
    itemId = item.id;
    expect(item.activo).toBe(true);
    expect(item.impuestosIds).toEqual([impuestoId]);
    expect(item.descuentosIds).toEqual([DESCUENTO_SIN_CONDICION_ID]);
    expect(item.recargosIds).toEqual([RECARGO_SIN_CONDICION_ID]);

    // Se vende UNA vez antes de borrar, para dejar rastro: el detalle de la
    // venta congela `descripcion`/precios/impuestos en el momento de vender
    // (ADR-010 — el hecho fiscal se congela en la transacción). Borrar y
    // restaurar el ítem no debería tocar ese histórico ya emitido.
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        canal: 'online', // evita depender de una caja abierta
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      });
    expect(resVenta.status).toBe(201);
    const ventaId = (resVenta.body as { id: string }).id;

    // El snapshot "antes" se toma con el MISMO endpoint (`GET /ventas/:id`)
    // que se usa después de restaurar, no con la respuesta de `POST /ventas`:
    // esa devuelve las entities `VentaDetalle` crudas (otros campos, otro
    // shape) mientras que `findOne` arma un objeto propio — compararlas
    // directo habría sido comparar peras con manzanas, no una prueba real de
    // "no cambió".
    const resVentaAntes = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resVentaAntes.status).toBe(200);
    const detallesAntes = (resVentaAntes.body as { detalles: unknown[] })
      .detalles;
    expect(detallesAntes).toHaveLength(1);

    const resDeleteSinPermiso = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resDeleteSinPermiso.status).toBe(403);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(200);

    const resRestaurarSinPermiso = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resRestaurarSinPermiso.status).toBe(403);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);
    const restaurado = resRestaurar.body as ItemResponse;
    // `remove()` es el único de los 16 que pisa `activo = false`, y el valor
    // previo se perdió: `restaurar()` NO lo revierte a `true`.
    expect(restaurado.activo).toBe(false);
    // `remove()` no toca `item_impuestos`/`item_descuentos`/`item_recargos`
    // (esos DELETE físicos viven en `update()`), así que restaurar devuelve
    // el ítem entero con sus tres reglas intactas.
    expect(restaurado.impuestosIds).toEqual([impuestoId]);
    expect(restaurado.descuentosIds).toEqual([DESCUENTO_SIN_CONDICION_ID]);
    expect(restaurado.recargosIds).toEqual([RECARGO_SIN_CONDICION_ID]);

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect((resGet.body as ItemResponse).activo).toBe(false);

    // El histórico de la venta emitida ANTES del borrado no se altera:
    // `remove()`/`restaurar()` no tocan `venta_detalles`, así que el detalle
    // congelado (ADR-010) tiene que ser el mismo objeto, no una versión
    // recalculada con las reglas de precio "restauradas".
    const resVentaDespues = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resVentaDespues.status).toBe(200);
    const detallesDespues = (resVentaDespues.body as { detalles: unknown[] })
      .detalles;
    expect(detallesDespues).toEqual(detallesAntes);
  });

  it('POST /items/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/items/${itemId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  it('el colateral revive SOLO lo que este borrado se llevó, acotado por timestamp', async () => {
    // Ingrediente que se ofrecerá como "extra" de una receta — el caso que
    // dispara el colateral en `receta_extras_permitidos`.
    const resExtra = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Palta papelera E2E ${Date.now()}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'g',
        stock: '1000',
        costo: '2000',
      });
    expect(resExtra.status).toBe(201);
    const extraId = (resExtra.body as ItemResponse).id;

    const resPan = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Pan papelera E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '100',
        costo: '500',
      });
    expect(resPan.status).toBe(201);
    const panId = (resPan.body as ItemResponse).id;

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Receta papelera E2E ${Date.now()}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    const recetaId = (resReceta.body as ItemResponse).id;

    // `update()` con `extrasPermitidos` SIEMPRE soft-deletea las filas vivas
    // e inserta de nuevo (items.service.ts, rama `tipo === 'receta'`): esto
    // deja una fila v1 borrada por ESTE motivo (con SU propio timestamp) y
    // una fila v2 viva, distinta de la v1 aunque referencien el mismo par
    // ingrediente/receta. Es la "otra fila borrada antes, por otro motivo"
    // que NO debe revivir cuando se restaure el ingrediente.
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ],
      });
    expect(resPatch.status).toBe(200);

    // Borra el ingrediente: la ÚNICA fila viva de `receta_extras_permitidos`
    // que lo referencia (la v2) se soft-deletea con ESTE timestamp.
    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${extraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(200);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/items/${extraId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);

    const resGetReceta = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resGetReceta.status).toBe(200);
    const extras = (resGetReceta.body as ItemResponse).extrasPermitidos ?? [];
    // Si el acotamiento por timestamp no existiera (revivir CUALQUIER fila
    // borrada del mismo `item_id`, sin importar cuándo), la v1 —muerta por el
    // PATCH, con otro `eliminado_el`— reviviría también, y el ingrediente
    // aparecería DOS veces en `extrasPermitidos`.
    expect(extras.filter((e) => e.ingredienteItemId === extraId)).toHaveLength(
      1,
    );
  });
});

// Task 5: salones — la segunda entidad con colateral (`salones.remove()`
// soft-deletea todas sus `mesas`), distinta forma que items:
// `manager.softDelete()`/`update()` en vez de SQL crudo, y sin nombre único
// (ni salones ni mesas lo tienen — a diferencia de causas de merma), así que
// no hay 400 de colisión que probar acá.
//
// Guard igual que items: `PermisosGuard` + `@RequiresPermiso('Salones',
// 'Eliminar')` (heredado del `@Controller`, mismo guard que el `DELETE` de
// cada controller — `SalonesController` y `MesasController`, dos
// `@Controller` distintos en el mismo archivo). vendedor@paris.cl no está
// asociado al módulo Salones de Paris en absoluto (seedVendedorPermisosCaja
// no lo incluye), así que el guard lo rechaza tanto en `DELETE` como en
// `restaurar`.
interface MesaListItem {
  id: string;
  nombre: string;
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}
interface SalonListItem {
  id: string;
  nombre: string;
  mesas: MesaListItem[];
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}

describe('Papelera (e2e) — salones y mesas, colateral en cascada acotado por timestamp', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenSinPermiso: string;

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
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenSinPermiso = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('EL MUTANTE OBLIGATORIO: restaurar el salón revive solo las mesas que ESE borrado se llevó', async () => {
    const resSalon = await request(app.getHttpServer())
      .post('/api/salones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Salón papelera E2E ${Date.now()}` });
    expect(resSalon.status).toBe(201);
    const salonId = (resSalon.body as SalonListItem).id;

    const resMesaVieja = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/mesas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Mesa 3' });
    expect(resMesaVieja.status).toBe(201);
    const mesaViejaId = (resMesaVieja.body as MesaListItem).id;

    const resMesaCascada = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/mesas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Mesa 5' });
    expect(resMesaCascada.status).toBe(201);
    const mesaCascadaId = (resMesaCascada.body as MesaListItem).id;

    // "El martes": la mesa 3 se borra SOLA, con SU propio motivo/timestamp —
    // el salón sigue vivo.
    const resDeleteMesaSinPermiso = await request(app.getHttpServer())
      .delete(`/api/mesas/${mesaViejaId}`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resDeleteMesaSinPermiso.status).toBe(403);

    const resDeleteMesaVieja = await request(app.getHttpServer())
      .delete(`/api/mesas/${mesaViejaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDeleteMesaVieja.status).toBe(200);

    // "El viernes": se borra el salón entero. La cascada de
    // `eliminarSalon()` solo debe tocar la mesa 5 (la única viva); la mesa 3
    // ya estaba borrada y conserva SU `eliminado_el` del martes.
    const resDeleteSalonSinPermiso = await request(app.getHttpServer())
      .delete(`/api/salones/${salonId}`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resDeleteSalonSinPermiso.status).toBe(403);

    const resDeleteSalon = await request(app.getHttpServer())
      .delete(`/api/salones/${salonId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDeleteSalon.status).toBe(200);

    // El listado normal ya no muestra el salón borrado.
    const resListarNormal = await request(app.getHttpServer())
      .get('/api/salones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resListarNormal.status).toBe(200);
    expect(
      (resListarNormal.body as SalonListItem[]).find((s) => s.id === salonId),
    ).toBeUndefined();

    // Con `incluirEliminados`, el salón aparece con las DOS mesas borradas
    // (huérfano tolerado en la misma foto) y el nombre de quien borró.
    const resListarPapelera = await request(app.getHttpServer())
      .get('/api/salones?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resListarPapelera.status).toBe(200);
    const salonEnPapelera = (resListarPapelera.body as SalonListItem[]).find(
      (s) => s.id === salonId,
    );
    expect(salonEnPapelera?.eliminadoEl).toBeTruthy();
    expect(salonEnPapelera?.eliminadoPorNombre).toBeTruthy();
    expect(
      salonEnPapelera?.mesas.find((m) => m.id === mesaViejaId)?.eliminadoEl,
    ).toBeTruthy();
    expect(
      salonEnPapelera?.mesas.find((m) => m.id === mesaCascadaId)?.eliminadoEl,
    ).toBeTruthy();

    const resRestaurarSinPermiso = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/restaurar`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resRestaurarSinPermiso.status).toBe(403);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);

    // El corazón de la task: la mesa 5 (cascada del viernes) revive; la
    // mesa 3 (borrada el martes, otro motivo, otro `eliminado_el`) NO — si
    // el acotamiento por timestamp se rompiera (p.ej. acotando solo por
    // `salonId` sin comparar `eliminado_el`), esta aserción es la que lo
    // cazaría.
    const resListarDespues = await request(app.getHttpServer())
      .get('/api/salones?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const salonDespues = (resListarDespues.body as SalonListItem[]).find(
      (s) => s.id === salonId,
    );
    expect(salonDespues?.eliminadoEl).toBeFalsy();
    expect(
      salonDespues?.mesas.find((m) => m.id === mesaCascadaId)?.eliminadoEl,
    ).toBeFalsy();
    expect(
      salonDespues?.mesas.find((m) => m.id === mesaViejaId)?.eliminadoEl,
    ).toBeTruthy();

    // El listado normal (sin el flag) confirma lo mismo: el salón vuelve
    // con solo la mesa 5, la mesa 3 sigue oculta.
    const resListarNormalDespues = await request(app.getHttpServer())
      .get('/api/salones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const salonNormalDespues = (
      resListarNormalDespues.body as SalonListItem[]
    ).find((s) => s.id === salonId);
    expect(salonNormalDespues?.mesas.map((m) => m.id)).toEqual([mesaCascadaId]);

    // La mesa revivida POR CASCADA también tiene que quedar sin autor de
    // borrado. Es la única de las 16 escrituras de `eliminado_por = NULL` que
    // ningún otro test alcanza: el bloque parametrizado de "solo lo que borró
    // una persona" borra un salón SIN mesas, así que su CTE `mesas_restauradas`
    // corre sobre 0 filas, y su caso `mesas` va por `restaurarMesa()`, que es
    // otra sentencia. Sin esta aserción, sacarle `eliminado_por = NULL` a la
    // cascada (salones.service.ts → restaurarSalon) deja los 75 tests en
    // verde, y toda mesa revivida así queda con el agujero original: el autor
    // sobreviviente disfraza el próximo borrado del sistema.
    // Va contra la BD y no contra el JSON porque el listado expone
    // `eliminadoPorNombre`, no `eliminadoPor`, y tras revivir el JOIN a
    // `usuarios` ya no matchea — o sea el nombre da null aunque la columna
    // siga sucia.
    const [mesaRevivida] = unwrap<{ eliminado_por: string | null }>(
      await ds.query(`SELECT eliminado_por FROM mesas WHERE mesa_id = $1`, [
        mesaCascadaId,
      ]),
    );
    expect(mesaRevivida.eliminado_por).toBeNull();
    // Y la mesa 3, que ESE borrado no se llevó, conserva el suyo: la cascada
    // no puede limpiar de más.
    const [mesaVieja] = unwrap<{ eliminado_por: string | null }>(
      await ds.query(`SELECT eliminado_por FROM mesas WHERE mesa_id = $1`, [
        mesaViejaId,
      ]),
    );
    expect(mesaVieja.eliminado_por).not.toBeNull();

    // Restaurar de nuevo (ya no está en la papelera) → 404.
    const resRestaurarOtraVez = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOtraVez.status).toBe(404);
  });

  it('restaurar una mesa suelta no toca el salón — huérfano tolerado', async () => {
    const resSalon = await request(app.getHttpServer())
      .post('/api/salones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Salón huérfano E2E ${Date.now()}` });
    expect(resSalon.status).toBe(201);
    const salonId = (resSalon.body as SalonListItem).id;

    const resMesa = await request(app.getHttpServer())
      .post(`/api/salones/${salonId}/mesas`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Mesa huérfana' });
    expect(resMesa.status).toBe(201);
    const mesaId = (resMesa.body as MesaListItem).id;

    // La mesa se borra SOLA, mientras el salón sigue vivo.
    const resDeleteMesa = await request(app.getHttpServer())
      .delete(`/api/mesas/${mesaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDeleteMesa.status).toBe(200);

    // Y DESPUÉS se borra el salón — como la mesa ya estaba borrada, la
    // cascada de `eliminarSalon()` no la toca (filtra `eliminado_el IS
    // NULL`), así que sigue con su propio `eliminado_el` de más arriba.
    const resDeleteSalon = await request(app.getHttpServer())
      .delete(`/api/salones/${salonId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDeleteSalon.status).toBe(200);

    const resRestaurarMesaSinPermiso = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenSinPermiso}`);
    expect(resRestaurarMesaSinPermiso.status).toBe(403);

    // Restaurar SOLO la mesa: no bloquea porque el salón siga borrado (no
    // hay cascada hacia arriba), y no lo revive de paso.
    const resRestaurarMesa = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarMesa.status).toBe(201);

    const resListar = await request(app.getHttpServer())
      .get('/api/salones?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const salon = (resListar.body as SalonListItem[]).find(
      (s) => s.id === salonId,
    );
    // El salón sigue en la papelera...
    expect(salon?.eliminadoEl).toBeTruthy();
    // ...pero la mesa ya no: huérfana y visible solo porque el listado pidió
    // `incluirEliminados` (su salón sigue borrado), no porque algo la
    // bloqueara o el restaurar del salón la hubiera arrastrado.
    expect(salon?.mesas.find((m) => m.id === mesaId)?.eliminadoEl).toBeFalsy();

    // Restaurar la mesa de nuevo (ya no está en la papelera) → 404.
    const resRestaurarOtraVez = await request(app.getHttpServer())
      .post(`/api/mesas/${mesaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOtraVez.status).toBe(404);
  });
});

// Task 6a: los 8 recursos de la familia `softDelete()` de TypeORM —
// descuentos, recargos, impuestos, terceros, cajones, garzones, turnos,
// impresoras. Seis de los ocho no tienen colateral en cascada ni restricción
// única que dispare un 400 al restaurar, así que un solo spec parametrizado
// sobre esos seis basta.
//
// ⚠️ **Corregido en la "Ronda de fixes 1"**: la entrada original decía que
// NINGUNO de los 8 tenía nombre único con restricción parcial. Era falso — la
// colisión se había asignado por FAMILIA de borrado (softDelete vs SQL cruda)
// en vez de por la propiedad que importa (tener índice único parcial), y dos
// recursos de ESTA familia sí lo tienen y quedaron en la grieta:
// - **`cajones`** tiene `ux_cajones_tenant_nombre` (`(tenant_id, nombre) WHERE
//   eliminado_el IS NULL`), igual que causas-merma/grupos-modificadores/
//   motivos-diferencia — mismo test de colisión, ver más abajo.
// - **`garzones`** tiene `uq_garzones_mostrador_tenant` (`(tenant_id) WHERE
//   es_placeholder = true AND eliminado_el IS NULL`): NO es "nombre único"
//   (garzones no tiene esa columna indexada), es más angosto — un solo
//   placeholder "Mostrador" vivo por tenant. Colisiona por un camino distinto
//   (borrar el Mostrador seedeado + que `asegurarMostrador()` cree otro), así
//   que tiene su PROPIO describe más abajo, no el molde de "crear otro con el
//   mismo nombre" que usan los recursos con nombre único.
// Antes del fix, ambos devolvían 500 (QueryFailedError sin capturar) donde la
// doc prometía 400 — el `restaurar()` de los dos ahora captura `23505` igual
// que `causas-merma.service.ts`.
interface RecursoConAuditoria {
  id: string;
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}

describe('Papelera (e2e) — familia softDelete(): descuentos, recargos, impuestos, terceros, cajones, garzones, turnos, impresoras', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const recursos: {
    nombre: string;
    path: string;
    crearBody: () => Record<string, unknown>;
  }[] = [
    {
      nombre: 'descuentos',
      path: 'descuentos',
      crearBody: () => ({
        nombre: `Descuento papelera E2E ${Date.now()}`,
        tipoReglaId: DESCUENTO_DIRECTO_TIPO_ID,
        modo: 'porcentaje',
      }),
    },
    {
      nombre: 'recargos',
      path: 'recargos',
      crearBody: () => ({
        nombre: `Recargo papelera E2E ${Date.now()}`,
        tipoReglaId: RECARGO_GENERAL_TIPO_ID,
        valor: '0.05',
        modo: 'porcentaje',
      }),
    },
    {
      nombre: 'impuestos',
      path: 'impuestos',
      crearBody: () => ({
        nombre: `Impuesto papelera E2E ${Date.now()}`,
        porcentaje: '0.05',
      }),
    },
    {
      nombre: 'terceros',
      path: 'terceros',
      crearBody: () => ({
        tipo: 'proveedor',
        nombre: `Tercero papelera E2E ${Date.now()}`,
      }),
    },
    {
      nombre: 'cajones',
      path: 'cajones',
      crearBody: () => ({ nombre: `Cajón papelera E2E ${Date.now()}` }),
    },
    {
      nombre: 'garzones',
      path: 'garzones',
      crearBody: () => ({ nombre: `Garzón papelera E2E ${Date.now()}` }),
    },
    {
      nombre: 'turnos',
      path: 'turnos',
      crearBody: () => ({
        nombre: `Turno papelera E2E ${Date.now()}`,
        horaInicio: '12:00',
        horaFin: '14:00',
      }),
    },
    {
      nombre: 'impresoras',
      path: 'impresoras',
      crearBody: () => ({
        nombre: `Impresora papelera E2E ${Date.now()}`,
        rol: 'boleta',
        tipoConexion: 'sistema',
        nombreCola: `COLA_E2E_${Date.now()}`,
      }),
    },
  ];

  for (const recurso of recursos) {
    it(`${recurso.nombre}: crear → borrar → listar con el flag → restaurar → verificar`, async () => {
      const resCrear = await request(app.getHttpServer())
        .post(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(recurso.crearBody());
      expect(resCrear.status).toBe(201);
      const id = (resCrear.body as RecursoConAuditoria).id;
      expect(id).toBeDefined();

      const resBorrar = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBorrar.status).toBe(200);

      const resListarNormal = await request(app.getHttpServer())
        .get(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resListarNormal.status).toBe(200);
      expect(
        (resListarNormal.body as RecursoConAuditoria[]).find(
          (r) => r.id === id,
        ),
      ).toBeUndefined();

      const resListarPapelera = await request(app.getHttpServer())
        .get(`/api/${recurso.path}?incluirEliminados=true`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resListarPapelera.status).toBe(200);
      const borrado = (resListarPapelera.body as RecursoConAuditoria[]).find(
        (r) => r.id === id,
      );
      expect(borrado).toBeDefined();
      expect(borrado?.eliminadoEl).not.toBeNull();
      expect(borrado?.eliminadoPorNombre).toBe('admin.paris');

      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(201);
      expect(
        (resRestaurar.body as RecursoConAuditoria).eliminadoEl,
      ).toBeFalsy();

      const resListarDespues = await request(app.getHttpServer())
        .get(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(
        (resListarDespues.body as RecursoConAuditoria[]).find(
          (r) => r.id === id,
        ),
      ).toBeDefined();

      // Restaurar de nuevo (ya no está en la papelera) → 404.
      const resRestaurarOtraVez = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurarOtraVez.status).toBe(404);
    });
  }

  // Ronda de fixes 1: `cajones` tiene `ux_cajones_tenant_nombre` (nombre único
  // por tenant, índice parcial), igual que causas-merma/grupos-modificadores/
  // motivos-diferencia — mismo molde de colisión que esos, no el genérico de
  // arriba (que no crea un duplicado a propósito).
  it('cajones: colisión real de Postgres — crear otro con el mismo nombre y restaurar el borrado → 400, nada cambia', async () => {
    const nombre = `Cajón papelera E2E colisión ${Date.now()}`;
    const resOriginal = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resOriginal.status).toBe(201);
    const originalId = (resOriginal.body as RecursoConAuditoria).id;

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/cajones/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrar.status).toBe(200);

    // Mientras `originalId` estaba borrado, nadie competía por su nombre: se
    // puede crear un cajón nuevo y vivo con el mismo nombre.
    const resOtro = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resOtro.status).toBe(201);
    const otroId = (resOtro.body as RecursoConAuditoria).id;

    // El 23505 lo tira Postgres de verdad (índice único parcial), no un mock.
    // Antes del fix esto era 500 (QueryFailedError sin capturar en
    // `cajones.service.ts` → `restaurar()`).
    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/cajones/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/cajones?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const cajones = listado.body as RecursoConAuditoria[];
    expect(cajones.find((c) => c.id === otroId)?.eliminadoEl).toBeFalsy();
    expect(cajones.find((c) => c.id === originalId)?.eliminadoEl).toBeTruthy();

    // Limpieza: sin el cajón activo que ocupa el nombre, restaurar sí puede.
    const resBorrarOtro = await request(app.getHttpServer())
      .delete(`/api/cajones/${otroId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrarOtro.status).toBe(200);

    const resRestaurarOk = await request(app.getHttpServer())
      .post(`/api/cajones/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOk.status).toBe(201);
  });

  // Revisión final: `descuentos`/`recargos`/`turnos` NO tienen índice único
  // de nombre en la base (medido: no hay `CREATE UNIQUE INDEX` sobre esas
  // tablas en startup-pos.sql) — la unicidad la garantizan `create()`/
  // `update()` SOLO en código (`validarNombreUnico`/`assertNombreUnico`, que
  // filtran `eliminado_el IS NULL`). `restaurar()` no reusaba esa validación:
  // se podía crear "Black Friday", borrarlo, crear OTRO "Black Friday", y
  // restaurar el viejo — quedando dos vivos con el mismo nombre, un estado
  // que `create()`/`update()` nunca dejan alcanzar. Estos tres tests montan
  // esa secuencia real contra Postgres, igual que el de `cajones` de arriba
  // pero SIN índice único de por medio: si `restaurar()` volviera a saltarse
  // la validación, esto daría 201 en vez de 400 y dejaría el duplicado vivo.
  it('descuentos: colisión de nombre garantizada por código (sin índice único) — crear otro con el mismo nombre y restaurar el borrado → 400, nada cambia', async () => {
    const nombre = `Descuento papelera E2E colisión ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: DESCUENTO_DIRECTO_TIPO_ID,
      modo: 'porcentaje',
    };
    const resOriginal = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOriginal.status).toBe(201);
    const originalId = (resOriginal.body as RecursoConAuditoria).id;

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/descuentos/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrar.status).toBe(200);

    // Mientras `originalId` estaba borrado, `validarNombreUnico` (que filtra
    // `eliminado_el IS NULL`) dejó el nombre libre.
    const resOtro = await request(app.getHttpServer())
      .post('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOtro.status).toBe(201);
    const otroId = (resOtro.body as RecursoConAuditoria).id;

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/descuentos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/descuentos?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const descuentos = listado.body as RecursoConAuditoria[];
    expect(descuentos.find((d) => d.id === otroId)?.eliminadoEl).toBeFalsy();
    expect(
      descuentos.find((d) => d.id === originalId)?.eliminadoEl,
    ).toBeTruthy();

    // Limpieza: sin el descuento activo que ocupa el nombre, restaurar sí puede.
    const resBorrarOtro = await request(app.getHttpServer())
      .delete(`/api/descuentos/${otroId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrarOtro.status).toBe(200);

    const resRestaurarOk = await request(app.getHttpServer())
      .post(`/api/descuentos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOk.status).toBe(201);
  });

  // La salida de la colisión, decidida por el owner (2026-08-01): el 400 no
  // deja al usuario adivinando — trae un nombre libre calculado contra la BD,
  // y `restaurar` acepta ese nombre para revivir y renombrar de una. Contra
  // Postgres real y no solo mockeado porque lo que se prueba es la QUERY: el
  // `LIKE` que junta los nombres que compiten y su `ESCAPE`.
  it('descuentos: el 400 de colisión trae un nombre libre, y restaurar con ese nombre funciona', async () => {
    const nombre = `Descuento sugerencia E2E ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: DESCUENTO_DIRECTO_TIPO_ID,
      modo: 'porcentaje',
    };
    const crear = async (n: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...bodyBase, nombre: n });
      expect(res.status).toBe(201);
      return (res.body as RecursoConAuditoria).id;
    };

    const originalId = await crear(nombre);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/descuentos/${originalId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
      ).status,
    ).toBe(200);

    // Con el original en la papelera, el nombre queda libre: se crea otro con
    // ese nombre Y otro con el sufijo 2, para que la sugerencia tenga que
    // saltear un ocupado en vez de devolver el primer número.
    const otroId = await crear(nombre);
    const otro2Id = await crear(`${nombre} 2`);

    const resColision = await request(app.getHttpServer())
      .post(`/api/descuentos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resColision.status).toBe(400);
    const cuerpo = resColision.body as {
      message: string;
      nombreSugerido: string;
    };
    expect(cuerpo.message).toContain(nombre);
    expect(cuerpo.nombreSugerido).toBe(`${nombre} 3`);

    // Y ese nombre sirve de verdad: restaurar con él revive y renombra.
    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/descuentos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: cuerpo.nombreSugerido });
    expect(resRestaurar.status).toBe(201);
    expect((resRestaurar.body as { nombre: string }).nombre).toBe(
      `${nombre} 3`,
    );

    // Los tres conviven vivos, que es el punto de la salida: nadie tuvo que
    // renombrar a mano ni perder el que ya estaba.
    const listado = await request(app.getHttpServer())
      .get('/api/descuentos')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const nombres = (listado.body as { id: string; nombre: string }[])
      .filter((d) => [originalId, otroId, otro2Id].includes(d.id))
      .map((d) => d.nombre)
      .sort();
    expect(nombres).toEqual([nombre, `${nombre} 2`, `${nombre} 3`].sort());
  });

  it('descuentos: restaurar con un nombre que TAMBIÉN está tomado vuelve a dar 400, con la sugerencia siguiente', async () => {
    const nombre = `Descuento reintento E2E ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: DESCUENTO_DIRECTO_TIPO_ID,
      modo: 'porcentaje',
    };
    const crear = async (n: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...bodyBase, nombre: n });
      expect(res.status).toBe(201);
      return (res.body as RecursoConAuditoria).id;
    };

    const originalId = await crear(nombre);
    await request(app.getHttpServer())
      .delete(`/api/descuentos/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    await crear(nombre);
    await crear(`${nombre} 2`);

    // El usuario edita el campo y manda uno que también está ocupado: el
    // backend no encadena sufijos ("... 2 2"), sugiere el siguiente libre.
    const res = await request(app.getHttpServer())
      .post(`/api/descuentos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `${nombre} 2` });
    expect(res.status).toBe(400);
    expect((res.body as { nombreSugerido: string }).nombreSugerido).toBe(
      `${nombre} 3`,
    );
  });

  it('recargos: colisión de nombre garantizada por código (sin índice único) — crear otro con el mismo nombre y restaurar el borrado → 400, nada cambia', async () => {
    const nombre = `Recargo papelera E2E colisión ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: RECARGO_GENERAL_TIPO_ID,
      valor: '0.05',
      modo: 'porcentaje',
    };
    const resOriginal = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOriginal.status).toBe(201);
    const originalId = (resOriginal.body as RecursoConAuditoria).id;

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/recargos/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrar.status).toBe(200);

    const resOtro = await request(app.getHttpServer())
      .post('/api/recargos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOtro.status).toBe(201);
    const otroId = (resOtro.body as RecursoConAuditoria).id;

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/recargos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/recargos?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const recargos = listado.body as RecursoConAuditoria[];
    expect(recargos.find((r) => r.id === otroId)?.eliminadoEl).toBeFalsy();
    expect(recargos.find((r) => r.id === originalId)?.eliminadoEl).toBeTruthy();

    const resBorrarOtro = await request(app.getHttpServer())
      .delete(`/api/recargos/${otroId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrarOtro.status).toBe(200);

    const resRestaurarOk = await request(app.getHttpServer())
      .post(`/api/recargos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOk.status).toBe(201);
  });

  it('recargos: el 400 de colisión trae un nombre libre, y restaurar con ese nombre funciona', async () => {
    const nombre = `Recargo sugerencia E2E ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: RECARGO_GENERAL_TIPO_ID,
      valor: '0.05',
      modo: 'porcentaje',
    };
    const crear = async (n: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...bodyBase, nombre: n });
      expect(res.status).toBe(201);
      return (res.body as RecursoConAuditoria).id;
    };

    const originalId = await crear(nombre);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/recargos/${originalId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
      ).status,
    ).toBe(200);

    // Con el original en la papelera, el nombre queda libre: se crea otro con
    // ese nombre Y otro con el sufijo 2, para que la sugerencia tenga que
    // saltear un ocupado en vez de devolver el primer número.
    const otroId = await crear(nombre);
    const otro2Id = await crear(`${nombre} 2`);

    const resColision = await request(app.getHttpServer())
      .post(`/api/recargos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resColision.status).toBe(400);
    const cuerpo = resColision.body as {
      message: string;
      nombreSugerido: string;
    };
    expect(cuerpo.message).toContain(nombre);
    expect(cuerpo.nombreSugerido).toBe(`${nombre} 3`);

    // Y ese nombre sirve de verdad: restaurar con él revive y renombra.
    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/recargos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: cuerpo.nombreSugerido });
    expect(resRestaurar.status).toBe(201);
    expect((resRestaurar.body as { nombre: string }).nombre).toBe(
      `${nombre} 3`,
    );

    // Los tres conviven vivos, que es el punto de la salida: nadie tuvo que
    // renombrar a mano ni perder el que ya estaba.
    const listado = await request(app.getHttpServer())
      .get('/api/recargos')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const nombres = (listado.body as { id: string; nombre: string }[])
      .filter((r) => [originalId, otroId, otro2Id].includes(r.id))
      .map((r) => r.nombre)
      .sort();
    expect(nombres).toEqual([nombre, `${nombre} 2`, `${nombre} 3`].sort());
  });

  it('recargos: restaurar con un nombre que TAMBIÉN está tomado vuelve a dar 400, con la sugerencia siguiente', async () => {
    const nombre = `Recargo reintento E2E ${Date.now()}`;
    const bodyBase = {
      nombre,
      tipoReglaId: RECARGO_GENERAL_TIPO_ID,
      valor: '0.05',
      modo: 'porcentaje',
    };
    const crear = async (n: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...bodyBase, nombre: n });
      expect(res.status).toBe(201);
      return (res.body as RecursoConAuditoria).id;
    };

    const originalId = await crear(nombre);
    await request(app.getHttpServer())
      .delete(`/api/recargos/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    await crear(nombre);
    await crear(`${nombre} 2`);

    // El usuario edita el campo y manda uno que también está ocupado: el
    // backend no encadena sufijos ("... 2 2"), sugiere el siguiente libre.
    const res = await request(app.getHttpServer())
      .post(`/api/recargos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `${nombre} 2` });
    expect(res.status).toBe(400);
    expect((res.body as { nombreSugerido: string }).nombreSugerido).toBe(
      `${nombre} 3`,
    );
  });

  it('turnos: colisión de nombre garantizada por código (sin índice único) — crear otro con el mismo nombre y restaurar el borrado → 400, nada cambia', async () => {
    const nombre = `Turno papelera E2E colisión ${Date.now()}`;
    const bodyBase = { nombre, horaInicio: '12:00', horaFin: '14:00' };
    const resOriginal = await request(app.getHttpServer())
      .post('/api/turnos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOriginal.status).toBe(201);
    const originalId = (resOriginal.body as RecursoConAuditoria).id;

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/turnos/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrar.status).toBe(200);

    const resOtro = await request(app.getHttpServer())
      .post('/api/turnos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(bodyBase);
    expect(resOtro.status).toBe(201);
    const otroId = (resOtro.body as RecursoConAuditoria).id;

    // `assertNombreUnico` de turnos lanza `ConflictException` (409) en
    // `crear()`/`actualizar()` — se mantiene así, sin tocar. `restaurar()`
    // traduce esa misma validación a 400, el mismo status accionable que dan
    // los recursos con índice único.
    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/turnos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/turnos?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const turnos = listado.body as RecursoConAuditoria[];
    expect(turnos.find((t) => t.id === otroId)?.eliminadoEl).toBeFalsy();
    expect(turnos.find((t) => t.id === originalId)?.eliminadoEl).toBeTruthy();

    const resBorrarOtro = await request(app.getHttpServer())
      .delete(`/api/turnos/${otroId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrarOtro.status).toBe(200);

    const resRestaurarOk = await request(app.getHttpServer())
      .post(`/api/turnos/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurarOk.status).toBe(201);
  });
});

// `garzones` también tiene una restricción única parcial —
// `uq_garzones_mostrador_tenant`, `(tenant_id) WHERE es_placeholder = true AND
// eliminado_el IS NULL`— pero NO es "nombre único" como los otros 6 recursos
// con colisión: garzones no indexa `nombre`. Es más angosta — un solo garzón
// placeholder "Mostrador" vivo por tenant, creado por `asegurarMostrador()`
// (find-or-create dentro de la transacción de una venta con `propinaDirecta`,
// ver `docs/features/pagos.md`). La colisión no se dispara creando "otro con
// el mismo nombre" (eso no colisiona en absoluto acá: probado en el test
// genérico de la familia softDelete de arriba, que crea un garzón normal sin
// tocar el placeholder), sino borrando un Mostrador vivo y dejando que otra
// venta con propina cree uno nuevo mientras el viejo sigue en la papelera.
// Antes del fix esto era 500; el `restaurar()` de `garzones.service.ts` ahora
// captura `23505` igual que `cajones`/`causas-merma`.
//
// ⚠️ **Reescrito en la "Ronda de fixes 2"**: la primera versión montaba el
// escenario borrando el Mostrador SEMBRADO de Paris (id fijo
// `550e8400-e29b-41d4-a716-446655440339`), que `ventas.e2e-spec.ts:543` y
// `liquidacion-propinas.e2e-spec.ts:21` asumen vivo con ese id exacto. Su
// limpieza corría al final del `it()` sin `try/finally`: si cualquier
// `expect()` intermedio fallaba, el test cortaba ahí y el Mostrador del seed
// quedaba borrado con un huérfano vivo en su lugar — rompiendo esas otras dos
// suites en la corrida siguiente (`maxWorkers: 1`, sin reset entre archivos).
// **La corrección no fue solo agregar `try/finally`: fue no tocar el id del
// seed en absoluto.** Falabella (a diferencia de Paris) no tiene Mostrador
// sembrado — `seeder.service.ts → seedGarzones()` solo crea uno, para Paris—,
// así que corriendo el mismo escenario en Falabella el "Mostrador viejo" lo
// crea ESTE test (id random, recién generado), no el seed: ninguna otra suite
// depende de ese id, así que aunque la limpieza no corriera, no hay id
// compartido que romper. La limpieza igual quedó en `try/finally` —por
// higiene, para que reruns locales sin `reset-db.sh` no acumulen Mostradores
// huérfanos de Falabella— pero ya no es la única red de seguridad. Verificado
// forzando una falla intermedia a propósito (un `expect` imposible entre el
// `DELETE` y el segundo `POST /ventas`): el `finally` corrió igual, dejó
// Falabella con un solo Mostrador vivo (detalle completo en el reporte de la
// task, "Ronda de fixes 2" → punto 3).
describe('Papelera (e2e) — garzones: colisión angosta del placeholder Mostrador', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let cajaId: string;
  let itemId: string;

  // Falabella, NO Paris: a propósito, para no depender de ningún id sembrado
  // (ver el comentario del describe).
  const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
  const ADMIN_FALABELLA_EMAIL = 'admin@sistema.com';
  const ADMIN_FALABELLA_PASS = 'admin';
  const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

  async function loginFalabella(): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_FALABELLA_EMAIL, password: ADMIN_FALABELLA_PASS });
    const initialToken = (resLogin.body as TokenResponse).access_token;
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${initialToken}`)
      .send({ tenantId: FALABELLA_TENANT_ID });
    return (resTenant.body as TokenResponse).access_token;
  }

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
    tokenAdmin = await loginFalabella();

    // Item propio de tipo `servicio` (sin stock): el foco del test es la
    // propina, no la venta — no depende del stock de seed ni interfiere con
    // el de otras suites.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Servicio Mostrador Falabella E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as { id: string }).id;

    // `propinaDirecta` solo dispara `asegurarMostrador()` en canal físico
    // (`ventas.service.ts`: `canal !== 'online'`), que exige caja abierta.
    // Falabella tiene su propio cajón "Mostrador" sembrado
    // (`seeder.service.ts → seedCajones()`, id `…440287`), distinto del
    // garzón placeholder del mismo nombre — homónimos, tablas distintas.
    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    const resCaja = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        cajonId,
        saldoInicial: '10000.0000',
        comentario: 'Apertura E2E papelera — colisión Mostrador Falabella',
      });
    cajaId = (resCaja.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    // Deja la caja cerrada para no bloquear el cajón/usuario en otras suites
    // (mismo patrón defensivo que `ventas.e2e-spec.ts` → `cerrarCaja`).
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });
    if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
      const motivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia?soloActivas=true')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const motivoId = (motivos.body as { id: string }[])[0]?.id;
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }],
        });
    }
    await app.close();
  });

  it('colisión real de Postgres — crear el primer Mostrador de Falabella, borrarlo, que asegurarMostrador() cree otro, restaurar el viejo → 400, nada cambia; limpieza en try/finally', async () => {
    // Falabella NO tiene Mostrador sembrado: la primera venta con propina
    // directa lo crea desde cero (id random, no un id fijo del seed).
    const resVenta1 = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '6000.0000' }],
        propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
      });
    expect(resVenta1.status).toBe(201);
    const venta1Id = (resVenta1.body as { id: string }).id;

    const rows1: { garzon_id: string }[] = await ds.query(
      `SELECT garzon_id FROM venta_propina
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta1Id],
    );
    expect(rows1).toHaveLength(1);
    const mostradorOriginalId = rows1[0].garzon_id;

    // A partir de acá el test EMPIEZA A MUTAR estado compartido de Falabella
    // (borra el Mostrador recién creado): todo lo que sigue va en
    // `try/finally` para que la limpieza corra pase lo que pase, no solo en
    // el camino feliz.
    let mostradorNuevoId: string | null = null;
    try {
      const resBorrar = await request(app.getHttpServer())
        .delete(`/api/garzones/${mostradorOriginalId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBorrar.status).toBe(200);

      const resVenta2 = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '6000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        });
      expect(resVenta2.status).toBe(201);
      const venta2Id = (resVenta2.body as { id: string }).id;

      const rows2: { garzon_id: string }[] = await ds.query(
        `SELECT garzon_id FROM venta_propina
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta2Id],
      );
      expect(rows2).toHaveLength(1);
      mostradorNuevoId = rows2[0].garzon_id;
      // `asegurarMostrador()` creó uno NUEVO (id random): el original estaba
      // borrado, así que el find-or-create no lo encontró.
      expect(mostradorNuevoId).not.toBe(mostradorOriginalId);

      // El 23505 lo tira Postgres de verdad (índice único parcial
      // `uq_garzones_mostrador_tenant`), no un mock: ya hay un "Mostrador"
      // vivo (el nuevo), así que revivir el original colisiona.
      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/garzones/${mostradorOriginalId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(400);

      // Nada cambió: el original sigue borrado, el nuevo sigue vivo.
      const estadoOriginal: { eliminado_el: string | null }[] = await ds.query(
        `SELECT eliminado_el FROM garzones WHERE garzon_id = $1`,
        [mostradorOriginalId],
      );
      expect(estadoOriginal[0]?.eliminado_el).not.toBeNull();
      const estadoNuevo: { eliminado_el: string | null }[] = await ds.query(
        `SELECT eliminado_el FROM garzones WHERE garzon_id = $1`,
        [mostradorNuevoId],
      );
      expect(estadoNuevo[0]?.eliminado_el).toBeNull();
    } finally {
      // Corre SIEMPRE, incluso si un `expect()` de arriba cortó el test a la
      // mitad: sin esto, un fallo intermedio deja Falabella con el Mostrador
      // original borrado y el nuevo huérfano vivo — mismo modo de falla que
      // tenía la versión con el id de Paris, solo que acá no rompe ninguna
      // otra suite (nada más referencia estos ids random), pero igual
      // ensuciaría reruns locales sin `reset-db.sh`.
      if (mostradorNuevoId) {
        await request(app.getHttpServer())
          .delete(`/api/garzones/${mostradorNuevoId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
      await request(app.getHttpServer())
        .post(`/api/garzones/${mostradorOriginalId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
  });
});

// Task 6b: los 3 últimos recursos de la familia SQL cruda — grupos
// de modificadores y los dos motivos de diferencia (caja e inventario). Los
// tres tienen nombre único por tenant (índice parcial WHERE eliminado_el IS
// NULL), así que —a diferencia de la familia softDelete() de Task 6a—
// agregan el 400 de colisión real de Postgres al restaurar (mismo patrón que
// causas-merma, Task 3), y por eso van en su propio bloque parametrizado en
// vez de sumarse al de Task 6a.
//
// `grupos_modificadores` tiene un hijo (`grupo_modificador_opciones`), y es
// el único de los 16 con esa forma: `remove()`/`restaurar()` cascadean esa
// tabla dentro de la misma transacción/sentencia, acotando por el
// `eliminado_el` exacto que dejó `remove()`. El flujo
// crear→borrar→listar→restaurar del loop de abajo NO ejercita ese
// acotamiento (solo tiene una opción, así que nunca hay una segunda fila
// borrada antes por otro motivo con la que confundirse). Por eso, igual que
// `items` (línea ~484) y `salones` (línea ~645), tiene su PROPIO test
// dedicado contra Postgres real más abajo — no alcanza con el mock de
// `grupos-modificadores.service.spec.ts`, que no prueba que Postgres
// realmente distinga los dos timestamps.
interface RecursoSqlCrudoItem {
  id?: string;
  grupoModificadorId?: string;
  nombre: string;
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}

describe('Papelera (e2e) — familia SQL cruda con nombre único: grupos-modificadores, motivos-diferencia, motivos-diferencia-inventario', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let itemOpcionId: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);

    // `grupos-modificadores` exige al menos una opción válida: un producto
    // vivo del catálogo.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Opción papelera E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resItem.status).toBe(201);
    itemOpcionId = (resItem.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const recursos: {
    nombre: string;
    path: string;
    idField: 'id' | 'grupoModificadorId';
    crearBody: (nombre: string) => Record<string, unknown>;
  }[] = [
    {
      nombre: 'grupos-modificadores',
      path: 'grupos-modificadores',
      idField: 'grupoModificadorId',
      crearBody: (nombre) => ({
        nombre,
        opciones: [{ itemId: itemOpcionId, precioExtra: '0' }],
      }),
    },
    {
      nombre: 'motivos-diferencia',
      path: 'motivos-diferencia',
      idField: 'id',
      crearBody: (nombre) => ({ nombre }),
    },
    {
      nombre: 'motivos-diferencia-inventario',
      path: 'motivos-diferencia-inventario',
      idField: 'id',
      crearBody: (nombre) => ({ nombre }),
    },
  ];

  for (const recurso of recursos) {
    it(`${recurso.nombre}: crear → borrar → listar con el flag → restaurar → verificar`, async () => {
      const nombre = `${recurso.nombre} papelera E2E ${Date.now()}`;
      const resCrear = await request(app.getHttpServer())
        .post(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(recurso.crearBody(nombre));
      expect(resCrear.status).toBe(201);
      const id = (resCrear.body as RecursoSqlCrudoItem)[
        recurso.idField
      ] as string;
      expect(id).toBeDefined();

      const resDeleteSinPermiso = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${id}`)
        .set('Authorization', `Bearer ${tokenNoAdmin}`);
      expect(resDeleteSinPermiso.status).toBe(403);

      const resBorrar = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBorrar.status).toBe(204);

      const resListarNormal = await request(app.getHttpServer())
        .get(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resListarNormal.status).toBe(200);
      expect(
        (resListarNormal.body as RecursoSqlCrudoItem[]).find(
          (r) => r[recurso.idField] === id,
        ),
      ).toBeUndefined();

      const resListarPapelera = await request(app.getHttpServer())
        .get(`/api/${recurso.path}?incluirEliminados=true`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resListarPapelera.status).toBe(200);
      const borrado = (resListarPapelera.body as RecursoSqlCrudoItem[]).find(
        (r) => r[recurso.idField] === id,
      );
      expect(borrado).toBeDefined();
      expect(borrado?.eliminadoEl).not.toBeNull();
      expect(borrado?.eliminadoPorNombre).toBe('admin.paris');

      const resRestaurarSinPermiso = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenNoAdmin}`);
      expect(resRestaurarSinPermiso.status).toBe(403);

      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(201);
      expect(
        (resRestaurar.body as RecursoSqlCrudoItem).eliminadoEl,
      ).toBeFalsy();

      const resListarDespues = await request(app.getHttpServer())
        .get(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(
        (resListarDespues.body as RecursoSqlCrudoItem[]).find(
          (r) => r[recurso.idField] === id,
        ),
      ).toBeDefined();

      // Restaurar de nuevo (ya no está en la papelera) → 404.
      const resRestaurarOtraVez = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${id}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurarOtraVez.status).toBe(404);
    });

    it(`${recurso.nombre}: colisión real de Postgres — crear otro con el mismo nombre y restaurar el borrado → 400, nada cambia`, async () => {
      const nombre = `${recurso.nombre} papelera E2E colisión ${Date.now()}`;
      const resOriginal = await request(app.getHttpServer())
        .post(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(recurso.crearBody(nombre));
      expect(resOriginal.status).toBe(201);
      const originalId = (resOriginal.body as RecursoSqlCrudoItem)[
        recurso.idField
      ] as string;

      const resBorrar = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${originalId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBorrar.status).toBe(204);

      // Mientras `originalId` estaba borrado, nadie competía por su nombre:
      // se puede crear otro recurso vivo con el mismo nombre.
      const resOtra = await request(app.getHttpServer())
        .post(`/api/${recurso.path}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(recurso.crearBody(nombre));
      expect(resOtra.status).toBe(201);
      const otraId = (resOtra.body as RecursoSqlCrudoItem)[
        recurso.idField
      ] as string;

      // El 23505 lo tira Postgres de verdad (índice único parcial), no un mock.
      const resRestaurar = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${originalId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurar.status).toBe(400);

      const listado = await request(app.getHttpServer())
        .get(`/api/${recurso.path}?incluirEliminados=true`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const items = listado.body as RecursoSqlCrudoItem[];
      const viva = items.find((r) => r[recurso.idField] === otraId);
      const borrada = items.find((r) => r[recurso.idField] === originalId);
      expect(viva?.eliminadoEl).toBeFalsy();
      expect(borrada?.eliminadoEl).toBeTruthy();

      // Limpieza: sin la otra viva que ocupa el nombre, restaurar sí puede.
      const resBorrarOtra = await request(app.getHttpServer())
        .delete(`/api/${recurso.path}/${otraId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resBorrarOtra.status).toBe(204);

      const resRestaurarOk = await request(app.getHttpServer())
        .post(`/api/${recurso.path}/${originalId}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resRestaurarOk.status).toBe(201);
    });
  }

  it('EL MUTANTE OBLIGATORIO: restaurar el grupo revive solo la opción que ESE borrado se llevó', async () => {
    const crearOpcion = async (nombre: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `${nombre} ${Date.now()}`,
          precioBase: '500',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: '10',
          costo: '500',
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };

    const opcionViejaItemId = await crearOpcion('Opción vieja GM E2E');
    const opcionCascadaItemId = await crearOpcion('Opción cascada GM E2E');

    const resGrupo = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Grupo colateral E2E ${Date.now()}`,
        opciones: [
          { itemId: opcionViejaItemId, precioExtra: '0' },
          { itemId: opcionCascadaItemId, precioExtra: '0' },
        ],
      });
    expect(resGrupo.status).toBe(201);
    const grupoId = (resGrupo.body as { grupoModificadorId: string })
      .grupoModificadorId;

    // "El martes": se quita la opción vieja del grupo (PATCH con la lista sin
    // ella) — `update()` la soft-borra SOLA, con SU propio `eliminado_el`; el
    // grupo sigue vivo.
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/grupos-modificadores/${grupoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        opciones: [{ itemId: opcionCascadaItemId, precioExtra: '0' }],
      });
    expect(resPatch.status).toBe(200);
    expect(
      (resPatch.body as { opciones: { itemId: string }[] }).opciones.map(
        (o) => o.itemId,
      ),
    ).toEqual([opcionCascadaItemId]);

    // "El viernes": se borra el grupo entero. La cascada de `remove()` solo
    // debe tocar la opción "cascada" (la única viva); la opción "vieja" ya
    // estaba borrada y conserva SU `eliminado_el` del martes.
    const resDeleteGrupo = await request(app.getHttpServer())
      .delete(`/api/grupos-modificadores/${grupoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDeleteGrupo.status).toBe(204);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/grupos-modificadores/${grupoId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);

    // El corazón de la task: la opción cascada revive; la opción vieja
    // (borrada el martes, otro motivo, otro `eliminado_el`) NO — si el
    // acotamiento por timestamp se rompiera (p. ej. acotando solo por
    // `grupo_modificador_id` sin comparar `eliminado_el`), esta aserción es
    // la que lo cazaría.
    const resGet = await request(app.getHttpServer())
      .get(`/api/grupos-modificadores/${grupoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resGet.status).toBe(200);
    const opciones = (resGet.body as { opciones: { itemId: string }[] })
      .opciones;
    expect(opciones.map((o) => o.itemId)).toEqual([opcionCascadaItemId]);
  });
});
