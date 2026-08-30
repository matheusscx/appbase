import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface ItemResponse {
  id: string;
  disponible: number | null;
  disponibleCondicional?: boolean;
}
interface GrupoModificadorResponse {
  grupoModificadorId: string;
}
interface VentaResponse {
  id: string;
  estado: string;
  totalFinal: string;
  advertencias?: string[];
}
interface MovimientoInventario {
  tipo: string;
  motivo: string;
  item_id: string;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  expect(disp.status).toBe(200);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E grupos-modificadores',
    });
  expect(res.status).toBe(201);
  return (res.body as CajaResponse).id;
}

/**
 * Cierra la caja por las DOS fases reales: `POST /:id/conteo` congela el arqueo y
 * auto-cierra si cuadra; si alguna línea descuadra pasa a `en_conciliacion` y hay
 * que finalizar con `POST /:id/cerrar` + un motivo por línea descuadrada.
 * Antes esto llamaba SOLO a la fase 2 sobre una caja `abierta` e ignoraba el
 * status: no cerraba nada, el cajón quedaba ocupado y la fuga reaparecía como un
 * `409` críptico al abrir en otra suite. Por eso asevera las dos fases.
 * Patrón de referencia: `cerrarEnDosFases` en `caja.e2e-spec.ts`.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '100000' }] });
  expect([200, 201]).toContain(conteo.status);

  if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
    // El conteo declara un monto fijo, así que las ventas en efectivo de esta
    // suite descuadran. La fase 2 exige motivo por línea descuadrada: mandar
    // `lineas: []` da 400 y deja el cajón ocupado. El comentario va siempre para
    // no depender de si el primer motivo activo pide `requiereComentario`.
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    const cierre = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            metodoPagoId: null,
            motivoDiferenciaId: motivoId,
            comentarioDiferencia: 'Cierre de la suite e2e',
          },
        ],
      });
    expect([200, 201]).toContain(cierre.status);
  }
}

async function crearProducto(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  stock: string,
  costo: string,
  /** `'ingrediente'` para lo que va a ser ingrediente de una receta: ese campo
   *  no acepta productos. Todo lo demás es idéntico. */
  tipo: 'producto' | 'ingrediente' = 'producto',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo,
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Grupos de modificadores — venta descuenta stock de opciones elegidas (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let componenteFijoId: string;
  let bebidaId: string;
  let grupoBebidaId: string;
  let comboId: string;

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

    ds = app.get(DataSource);
    token = await login(app);
    cajaId = await abrirCaja(app, token);

    // 1. Producto con stock: componente fijo del combo, y la Bebida (opción de grupo).
    componenteFijoId = await crearProducto(
      app,
      token,
      'Papas fijas GM E2E',
      '30',
      '500',
    );
    bebidaId = await crearProducto(app, token, 'Bebida GM E2E', '20', '300');
  }, 60000);

  afterAll(async () => {
    // `close` en un `finally`: `cerrarCaja` afirma sus status adentro, así que
    // si la caja no cierra **tira**, y sin esto la app de Nest quedaba viva con
    // su `@Cron` escribiéndole a la base durante las suites siguientes. El
    // fallo sigue propagando; lo que cambia es que ya no se lleva el cierre
    // puesto. Ver `docs/agent/pendientes.md` § 1.
    try {
      if (cajaId) await cerrarCaja(app, token, cajaId);
    } finally {
      await app.close();
    }
  });

  it('2. crea el grupo de modificadores "Bebida" (familia vendible, opción con precioExtra 800)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bebida GM E2E ${Date.now()}`,
        opciones: [{ itemId: bebidaId, cantidad: '1', precioExtra: '800' }],
      });

    expect(res.status).toBe(201);
    grupoBebidaId = (res.body as GrupoModificadorResponse).grupoModificadorId;
  });

  it('3. crea el combo con un componente fijo + el grupo de modificadores obligatorio (min:1, max:1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo GM E2E ${Date.now()}`,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          {
            componenteItemId: componenteFijoId,
            cantidad: '1',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          { grupoModificadorId: grupoBebidaId, min: 1, max: 1 },
        ],
      });

    expect(res.status).toBe(201);
    comboId = (res.body as ItemResponse).id;
  });

  it('4. GET /items?tipo=combo → disponibleCondicional: true', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=combo&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const combo = (res.body as { data: ItemResponse[] }).data.find(
      (i) => i.id === comboId,
    );
    expect(combo?.disponibleCondicional).toBe(true);
  });

  it('5-6-7. vende 1 combo eligiendo la Bebida del grupo: descuenta stock del componente fijo Y de la Bebida, cobra precioBase + precioExtra', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: comboId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoBebidaId,
                  opciones: [{ itemId: bebidaId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        // Combo afecto (default): (3000 + 800) + 19% IVA = 4522 (Task 1, ADR-018).
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4522.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertencias ?? []).toEqual([]);
    // 7. Total = (precioBase del combo (3000) + precioExtra de la opción
    // elegida (800)) + 19% IVA (afecto por default)
    expect(venta.totalFinal).toBe('4522.0000');

    // 6. Movimientos de inventario: salida del componente fijo Y de la opción de grupo (Bebida)
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id FROM movimientos_inventario
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta.id],
    );

    const movFijo = movs.find((m) => m.item_id === componenteFijoId);
    expect(movFijo?.tipo).toBe('salida');
    expect(movFijo?.motivo).toBe('venta');

    const movBebida = movs.find((m) => m.item_id === bebidaId);
    expect(movBebida?.tipo).toBe('salida');
    expect(movBebida?.motivo).toBe('venta');

    // Stock resultante: componente fijo 30-1=29, bebida 20-1=19
    const stockFijoRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [componenteFijoId],
    );
    expect(stockFijoRows[0]?.stock).toBe('29.0000');

    const stockBebidaRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [bebidaId],
    );
    expect(stockBebidaRows[0]?.stock).toBe('19.0000');
  });

  it('8. (negativo) vender el combo sin elegir opción del grupo obligatorio → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: comboId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3000.0000' }],
      });

    expect(res.status).toBe(400);
  });

  // ─── El índice de nombre único es CASE-INSENSITIVE ────────────────────────
  // No es un detalle de esquema: es la única defensa del lado del motor, y hay
  // un camino que NO pasa por `assertNombreLibre` — el `restaurar()` de la
  // papelera. Mientras la entity declaraba el índice con `@Index`, TypeORM lo
  // creaba en dev sobre `nombre` PELADO (no sabe expresar `LOWER()`), así que
  // dev enforzaba una regla distinta de la de `startup-pos.sql`. Ahora lo crea
  // el seeder con SQL cruda, igual que `causas_merma`.

  // ── Lo que una mesa ya eligió no se saca del grupo ───────────────────────
  //
  // Tercera puerta del mismo agujero que `dce84899` y `d42a36e7` cerraron por
  // el lado de los extras: `PATCH /grupos-modificadores/:id` soft-borra las
  // opciones que desaparecen y nunca consultaba cuentas. Si una mesa ya eligió
  // esa opción, la línea deja de poder tasarse —"La opción X no pertenece al
  // grupo"— en la precuenta y al cerrar: la mesa queda incobrable.
  //
  // El fixture es de este test y no del seed a propósito: el grupo Proteína del
  // seed lo comparten varias suites, y sacarle una opción las rompería.
  //
  // Un solo combo cubre los DOS niveles del snapshot, que son dos ramas
  // distintas de la consulta: `grupos[]` (el grupo propio del combo) y
  // `componentes[].grupos[]` (el grupo de su componente receta). Sin el segundo,
  // un mutante que borre esa rama pasa.
  const MESA_1_ID = '550e8400-e29b-41d4-a716-446655440232';
  // Bruno, no Ana: Ana está vinculada desde el seed y vincular invalida el PIN.
  const BRUNO_PIN = '222222';
  const BRUNO_ID = '550e8400-e29b-41d4-a716-446655440239';
  const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

  it('sacar del grupo una opción que una mesa ya eligió se rechaza — en los dos niveles del snapshot', async () => {
    const sufijo = Date.now();
    const salsaId = await crearProducto(
      app,
      token,
      'Salsa GM E2E',
      '20',
      '200',
    );
    // El reemplazo tiene que ser de la MISMA familia que la salsa (vendible):
    // `validarYResolverOpciones` exige homogeneidad dentro del grupo.
    const ketchupId = await crearProducto(
      app,
      token,
      'Ketchup GM E2E',
      '20',
      '250',
    );
    const panId = await crearProducto(
      app,
      token,
      'Pan GM E2E',
      '20',
      '400',
      'ingrediente',
    );
    // Grupo propio también para el nivel de arriba: `grupoBebidaId` lo crea el
    // test 2 y usarlo ataría este test al orden de la suite (con `-t` no corre)
    // además de mutar un fixture compartido.
    const jugoId = await crearProducto(app, token, 'Jugo GM E2E', '20', '300');
    const aguaId = await crearProducto(app, token, 'Agua GM E2E', '20', '300');
    const resGrupoJugo = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Jugo GM E2E ${sufijo}`,
        opciones: [{ itemId: jugoId, cantidad: '1', precioExtra: '300' }],
      });
    expect(resGrupoJugo.status).toBe(201);
    const grupoJugoId = (resGrupoJugo.body as GrupoModificadorResponse)
      .grupoModificadorId;

    const resGrupoSalsa = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Salsa GM E2E ${sufijo}`,
        opciones: [{ itemId: salsaId, cantidad: '1', precioExtra: '200' }],
      });
    expect(resGrupoSalsa.status).toBe(201);
    const grupoSalsaId = (resGrupoSalsa.body as GrupoModificadorResponse)
      .grupoModificadorId;

    // Receta con el grupo de salsa asociado: va a ser el componente del combo,
    // y es la que produce el nivel `componentes[].grupos[]`.
    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa GM E2E ${sufijo}`,
        precioBase: '2000',
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
        gruposModificadores: [
          { grupoModificadorId: grupoSalsaId, min: 1, max: 1 },
        ],
      });
    expect(resReceta.status).toBe(201);
    const recetaId = (resReceta.body as ItemResponse).id;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo dos niveles GM E2E ${sufijo}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: recetaId, cantidad: '1', bloqueante: true },
        ],
        gruposModificadores: [
          { grupoModificadorId: grupoJugoId, min: 1, max: 1 },
        ],
      });
    expect(resCombo.status).toBe(201);
    const comboDosNivelesId = (resCombo.body as ItemResponse).id;

    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN, turnoId: TURNO_MANANA_ID });

    const resCuenta = await request(app.getHttpServer())
      .post(`/api/mesas/${MESA_1_ID}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    expect(resCuenta.status).toBe(201);
    const cuentaId = (resCuenta.body as { id: string }).id;

    // Una sola línea que elige en los dos niveles.
    const resLinea = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: comboDosNivelesId,
        cantidad: '1',
        personalizacion: {
          grupos: [
            {
              grupoId: grupoJugoId,
              opciones: [{ itemId: jugoId, unidades: 1 }],
            },
          ],
          componentes: [
            {
              componenteItemId: recetaId,
              unidad: 1,
              grupos: [
                {
                  grupoId: grupoSalsaId,
                  opciones: [{ itemId: salsaId, unidades: 1 }],
                },
              ],
            },
          ],
        },
      });
    expect(resLinea.status).toBe(201);

    const patchGrupo = (grupoId: string, opciones: unknown[]) =>
      request(app.getHttpServer())
        .patch(`/api/grupos-modificadores/${grupoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ opciones });

    // Control: repreciar la opción elegida no la saca del grupo. Tiene que
    // pasar, o el guard bloquearía por "la lista cambió" en vez de por "esta
    // opción se saca".
    const resRepreciar = await patchGrupo(grupoSalsaId, [
      { itemId: salsaId, cantidad: '1', precioExtra: '500' },
    ]);
    expect(resRepreciar.status).toBe(200);

    // Nivel `componentes[].grupos[]`: sacar la salsa que la mesa eligió.
    const resSacarSalsa = await patchGrupo(grupoSalsaId, [
      { itemId: ketchupId, cantidad: '1', precioExtra: '250' },
    ]);
    expect(resSacarSalsa.status).toBe(400);
    expect((resSacarSalsa.body as { message: string }).message).toContain(
      'Mesa',
    );

    // Control del `grupoId` DENTRO de la containment, para las DOS ramas. Un
    // mismo ítem puede ser opción de varios grupos (`uq_grupo_opcion_item_vivo`
    // es por grupo+ítem), así que este grupo ajeno ofrece el jugo Y la salsa que
    // la mesa eligió — pero en OTRO grupo, que nadie eligió. Sacarlos de acá
    // tiene que pasar.
    //
    // Va una vez por rama a propósito: el mutante que saca el `grupoId` de la
    // containment se aplica a una rama por vez, y un control que solo toque la
    // otra lo deja vivo (medido: pasó dos veces antes de partirlo en dos).
    const resGrupoAjeno = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Grupo ajeno GM E2E ${sufijo}`,
        opciones: [
          { itemId: jugoId, cantidad: '1', precioExtra: '300' },
          { itemId: salsaId, cantidad: '1', precioExtra: '200' },
          { itemId: ketchupId, cantidad: '1', precioExtra: '250' },
        ],
      });
    expect(resGrupoAjeno.status).toBe(201);
    const grupoAjenoId = (resGrupoAjeno.body as GrupoModificadorResponse)
      .grupoModificadorId;

    // Rama `grupos[]`: el jugo está elegido, pero en `grupoJugoId`.
    const resSacarJugoAjeno = await patchGrupo(grupoAjenoId, [
      { itemId: salsaId, cantidad: '1', precioExtra: '200' },
      { itemId: ketchupId, cantidad: '1', precioExtra: '250' },
    ]);
    expect(resSacarJugoAjeno.status).toBe(200);

    // Rama `componentes[].grupos[]`: la salsa está elegida, pero en `grupoSalsaId`.
    const resSacarSalsaAjena = await patchGrupo(grupoAjenoId, [
      { itemId: ketchupId, cantidad: '1', precioExtra: '250' },
    ]);
    expect(resSacarSalsaAjena.status).toBe(200);

    // Nivel `grupos[]`: sacar el jugo que la misma línea eligió.
    const resSacarJugo = await patchGrupo(grupoJugoId, [
      { itemId: aguaId, cantidad: '1', precioExtra: '300' },
    ]);
    expect(resSacarJugo.status).toBe(400);
    expect((resSacarJugo.body as { message: string }).message).toContain(
      'Mesa',
    );

    // Cancelada la cuenta, la salsa se puede sacar: el bloqueo es por mesa
    // viva.
    const resCancelar = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCancelar.status).toBe(201);

    const resSacarTrasCancelar = await patchGrupo(grupoSalsaId, [
      { itemId: ketchupId, cantidad: '1', precioExtra: '250' },
    ]);
    expect(resSacarTrasCancelar.status).toBe(200);

    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  });

  // La quinta puerta, y la última: no hace falta tocar el grupo para romper la
  // mesa, alcanza con **desasociarlo del ítem** (`PATCH /items/:id` con
  // `gruposModificadores`). Los dos niveles del snapshot se prueban en ítems
  // DISTINTOS a propósito —el grupo propio en el combo, el del componente en la
  // receta—, así cada rama de la consulta tiene un testigo que solo ella
  // encuentra y un mutante que borre una de las dos no sobrevive.
  const MESA_2_ID = '550e8400-e29b-41d4-a716-446655440233';

  it('desasociar del ítem un grupo que una mesa ya eligió se rechaza — en los dos niveles del snapshot', async () => {
    const sufijo = Date.now();
    const jugoId = await crearProducto(
      app,
      token,
      'Jugo desa E2E',
      '20',
      '300',
    );
    const salsaId = await crearProducto(
      app,
      token,
      'Salsa desa E2E',
      '20',
      '200',
    );
    const panId = await crearProducto(
      app,
      token,
      'Pan desa E2E',
      '20',
      '400',
      'ingrediente',
    );

    const crearGrupo = async (
      nombre: string,
      itemId: string,
      precio: string,
    ) => {
      const res = await request(app.getHttpServer())
        .post('/api/grupos-modificadores')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `${nombre} ${sufijo}`,
          opciones: [{ itemId, cantidad: '1', precioExtra: precio }],
        });
      expect(res.status).toBe(201);
      return (res.body as GrupoModificadorResponse).grupoModificadorId;
    };
    const grupoJugoId = await crearGrupo('Jugo desa E2E', jugoId, '300');
    const grupoSalsaId = await crearGrupo('Salsa desa E2E', salsaId, '200');

    const crearReceta = async (nombre: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `${nombre} ${sufijo}`,
          precioBase: '2000',
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
          gruposModificadores: [
            { grupoModificadorId: grupoSalsaId, min: 1, max: 1 },
          ],
        });
      expect(res.status).toBe(201);
      return (res.body as ItemResponse).id;
    };
    const recetaId = await crearReceta('Hamburguesa desa E2E');

    const crearCombo = async (nombre: string, componenteId: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `${nombre} ${sufijo}`,
          precioBase: '4000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'combo',
          componentes: [
            { componenteItemId: componenteId, cantidad: '1', bloqueante: true },
          ],
          gruposModificadores: [
            { grupoModificadorId: grupoJugoId, min: 1, max: 1 },
          ],
        });
      expect(res.status).toBe(201);
      return (res.body as ItemResponse).id;
    };
    const comboId = await crearCombo('Combo desa E2E', recetaId);

    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN, turnoId: TURNO_MANANA_ID });

    const resCuenta = await request(app.getHttpServer())
      .post(`/api/mesas/${MESA_2_ID}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
    expect(resCuenta.status).toBe(201);
    const cuentaId = (resCuenta.body as { id: string }).id;

    // Una línea que elige en los dos niveles: el jugo es del combo, la salsa
    // del componente receta.
    const resLinea = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: comboId,
        cantidad: '1',
        personalizacion: {
          grupos: [
            {
              grupoId: grupoJugoId,
              opciones: [{ itemId: jugoId, unidades: 1 }],
            },
          ],
          componentes: [
            {
              componenteItemId: recetaId,
              unidad: 1,
              grupos: [
                {
                  grupoId: grupoSalsaId,
                  opciones: [{ itemId: salsaId, unidades: 1 }],
                },
              ],
            },
          ],
        },
      });
    expect(resLinea.status).toBe(201);

    const patchGrupos = (itemId: string, grupos: unknown[]) =>
      request(app.getHttpServer())
        .patch(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ gruposModificadores: grupos });

    // Control 1: cambiarle el min/max al grupo elegido no lo desasocia. Pasa,
    // o el guard estaría bloqueando por "la lista cambió".
    const resMinMax = await patchGrupos(recetaId, [
      { grupoModificadorId: grupoSalsaId, min: 1, max: 2 },
    ]);
    expect(resMinMax.status).toBe(200);

    // Control 2: agregarle otro grupo a la receta. `min: 0` a propósito — con
    // `min: 1` el PATCH pasa igual pero la línea abierta deja de poder tasarse,
    // y eso es otro agujero (ver `pendientes.md`), no lo que mide este test.
    const grupoExtraId = await crearGrupo('Extra desa E2E', jugoId, '300');
    const resAgregar = await patchGrupos(recetaId, [
      { grupoModificadorId: grupoSalsaId, min: 1, max: 2 },
      { grupoModificadorId: grupoExtraId, min: 0, max: 1 },
    ]);
    expect(resAgregar.status).toBe(200);

    // Control 3: sacar el grupo que NADIE eligió. Pasa: se compara el diff.
    const resSacarNoElegido = await patchGrupos(recetaId, [
      { grupoModificadorId: grupoSalsaId, min: 1, max: 2 },
    ]);
    expect(resSacarNoElegido.status).toBe(200);

    // Controles del alcance por ítem, uno por rama. Un grupo cuelga de muchos
    // ítems: que la mesa lo haya elegido en ESTE combo no puede congelar los
    // grupos de todos los demás.
    const otraRecetaId = await crearReceta('Sandwich desa E2E');
    const otroComboId = await crearCombo('Combo ajeno desa E2E', otraRecetaId);

    // Rama `grupos[]`: el jugo está elegido, pero en el combo de la mesa.
    const resSacarJugoAjeno = await patchGrupos(otroComboId, []);
    expect(resSacarJugoAjeno.status).toBe(200);

    // Rama `componentes[].grupos[]`: la salsa está elegida, pero en el
    // componente del combo de la mesa, no en esta receta.
    const resSacarSalsaAjena = await patchGrupos(otraRecetaId, []);
    expect(resSacarSalsaAjena.status).toBe(200);

    // Rama `componentes[].grupos[]`: desasociar de la RECETA la salsa que el
    // componente de la línea eligió.
    //
    // ⚠️ Acá la receta queda con CERO grupos, y ése es el caso feo: sin el
    // guard esto no daría 400 sino 200 con la salsa borrada del precio
    // —`resolverPersonalizacionCombo` saltea el componente entero cuando no le
    // queda ningún grupo asociado (`if (!catalogo.asociados.length) continue`)—.
    // El 400 que se afirma abajo es el del guard, no el del resolver. Medido el
    // 2026-08-30: 4500 con todo vivo, 4300 sacando el último grupo a mano.
    const resSacarSalsa = await patchGrupos(recetaId, []);
    expect(resSacarSalsa.status).toBe(400);
    expect((resSacarSalsa.body as { message: string }).message).toContain(
      'Mesa',
    );

    // Rama `grupos[]`: desasociar del COMBO el jugo que la línea eligió. El
    // combo conserva su componente, así que no queda huérfano.
    const resSacarJugo = await patchGrupos(comboId, []);
    expect(resSacarJugo.status).toBe(400);
    expect((resSacarJugo.body as { message: string }).message).toContain(
      'Mesa',
    );

    // Cancelada la cuenta, las dos se pueden desasociar.
    const resCancelar = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCancelar.status).toBe(201);

    expect((await patchGrupos(recetaId, [])).status).toBe(200);
    expect((await patchGrupos(comboId, [])).status).toBe(200);

    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  });

  it('el índice único de nombre existe y es sobre lower(nombre)', async () => {
    const rows: { indexdef: string }[] = await ds.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'grupos_modificadores'
          AND indexname = 'uq_grupo_modificador_nombre_vivo'`,
    );
    expect(rows).toHaveLength(1);
    const def = rows[0].indexdef;
    expect(def).toContain('UNIQUE');
    expect(def).toContain('tenant_id');
    // Lo que este test existe para fijar: `lower(...)`, no `nombre` pelado.
    // Volver a poner el `@Index` en la entity lo pone rojo.
    expect(def).toMatch(/lower\(/i);
    // Parcial: sin esto bloquearía recrear un grupo tras un borrado legítimo.
    expect(def).toContain('eliminado_el');
  });

  it('restaurar un grupo cuyo nombre lo tomó otro que solo difiere en mayúsculas es 400', async () => {
    // Este camino NO pasa por `assertNombreLibre` (el `restaurar()` de la
    // papelera escribe directo), así que lo único que lo frena es el índice.
    const base = `Extras CI E2E ${Date.now()}`;
    const crear = async (nombre: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/grupos-modificadores')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          opciones: [{ itemId: bebidaId, cantidad: '1', precioExtra: '800' }],
        });
      expect(res.status).toBe(201);
      return (res.body as GrupoModificadorResponse).grupoModificadorId;
    };

    const originalId = await crear(base);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/grupos-modificadores/${originalId}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
      // 204, no 200: este DELETE no devuelve cuerpo.
    ).toBe(204);

    // Con el original en la papelera el nombre queda libre, así que otro lo
    // toma — en MINÚSCULA, que es el caso que un índice case-sensitive dejaría
    // pasar.
    await crear(base.toLowerCase());

    const res = await request(app.getHttpServer())
      .post(`/api/grupos-modificadores/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    // Y trae la salida: un nombre libre para reintentar.
    expect((res.body as { nombreSugerido?: string }).nombreSugerido).toBe(
      `${base} 2`,
    );
  });
});
