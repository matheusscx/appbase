import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { PersonalizacionRecetaSnapshot } from '../src/common/dto/personalizacion-receta.dto';

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
}
interface VentaResponse {
  id: string;
  estado: string;
  totalFinal: string;
  advertenciasReceta?: string[];
}
interface MovimientoInventario {
  tipo: string;
  motivo: string;
  item_id: string;
  cantidad?: string;
}
interface GrupoOpcionDetalle {
  itemId: string;
  precioExtra: string;
}
interface GrupoDetalle {
  grupoModificadorId: string;
  min: number;
  max: number;
  opciones: GrupoOpcionDetalle[];
}
interface ComboComponenteDetalle {
  componenteItemId: string;
  cantidad: string;
  grupos: GrupoDetalle[];
}
interface ComboDetalleResponse {
  id: string;
  componentes: ComboComponenteDetalle[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ saldoInicial: '100000.0000', comentario: 'Apertura E2E combos' });
  return (res.body as CajaResponse).id;
}

async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/cerrar`)
    .set('Authorization', `Bearer ${token}`)
    .send({ montoContado: '100000.0000' });
}

async function crearProducto(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

async function crearIngrediente(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: '0',
      monedaId: CLP_MONEDA_ID,
      tipo: 'ingrediente',
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Combos — venta descuenta stock de componentes (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let papasId: string;
  let panId: string;
  let hamburguesaId: string;
  let comboId: string;
  let comboDobleId: string;

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
    token = await login(app);
    cajaId = await abrirCaja(app, token);

    // 1. Producto con stock (componente directo del combo)
    papasId = await crearProducto(app, token, 'Papas combo E2E', '20', '500');

    // Ingrediente con stock, usado por la receta que será componente del combo
    panId = await crearIngrediente(app, token, 'Pan combo E2E', '10', '500');

    // Receta con un ingrediente bloqueante (componente del combo)
    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa combo E2E ${Date.now()}`,
        precioBase: '3500',
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
      });
    expect(resReceta.status).toBe(201);
    hamburguesaId = (resReceta.body as ItemResponse).id;
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('1-2. crea el combo con producto y receta como componentes bloqueantes', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo Papas + Hamburguesa E2E ${Date.now()}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: papasId, cantidad: '1', bloqueante: true },
          { componenteItemId: hamburguesaId, cantidad: '1', bloqueante: true },
        ],
      });

    expect(res.status).toBe(201);
    comboId = (res.body as ItemResponse).id;
  });

  it('3. disponible = mínimo entre componentes bloqueantes (papas 20, hamburguesa limitada por pan=10)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=combo&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const combo = (res.body as { data: ItemResponse[] }).data.find(
      (i) => i.id === comboId,
    );
    // papas: floor(20/1)=20 ; hamburguesa: floor(pan=10/1)=10 → mínimo 10
    expect(combo?.disponible).toBe(10);
  });

  it('4-5-6. vende 1 combo, descuenta stock de papas y de pan (vía receta), cobra el precio del combo', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: comboId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4000.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    // 6. Total cobrado = precio del combo
    expect(venta.totalFinal).toBe('4000.0000');

    // 5. Movimientos de inventario: salida del producto directo (papas) y
    // salida del ingrediente de la receta (pan), ambos motivo 'venta'.
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id FROM movimientos_inventario
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta.id],
    );

    const movPapas = movs.find((m) => m.item_id === papasId);
    expect(movPapas?.tipo).toBe('salida');
    expect(movPapas?.motivo).toBe('venta');

    const movPan = movs.find((m) => m.item_id === panId);
    expect(movPan?.tipo).toBe('salida');
    expect(movPan?.motivo).toBe('venta');

    // Stock resultante: papas 20-1=19, pan 10-1=9
    const stockRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [papasId],
    );
    expect(stockRows[0]?.stock).toBe('19.0000');

    const stockPanRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [panId],
    );
    expect(stockPanRows[0]?.stock).toBe('9.0000');
  });

  // Grupos anidados en combos (un nivel) — seed "Combo Especial":
  // Hamburguesa Especial (receta, ya trae el grupo "Proteína") + Papas
  // fritas (producto). Ver docs/features/grupos-modificadores.md
  // § "Grupos anidados en combos (un nivel)" y seeder.service.ts
  // seedComboEspecial().
  const COMBO_ESPECIAL_ID = '550e8400-e29b-41d4-a716-446655440313';
  const HAMBURGUESA_ESPECIAL_ID = '550e8400-e29b-41d4-a716-446655440294';
  const PROTEINA_GRUPO_ID = '550e8400-e29b-41d4-a716-446655440290';
  const CHULETA_ID = '550e8400-e29b-41d4-a716-446655440288';
  const CARNE_MOLIDA_ID = '550e8400-e29b-41d4-a716-446655440257';

  it('7. GET /items/:id del "Combo Especial" expone el grupo "Proteína" (min:1, max:1) de su componente receta "Hamburguesa Especial", con la opción chuleta a +$1.500', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${COMBO_ESPECIAL_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const detalle = res.body as ComboDetalleResponse;
    const componenteHamburguesa = detalle.componentes.find(
      (c) => c.componenteItemId === HAMBURGUESA_ESPECIAL_ID,
    );
    expect(componenteHamburguesa).toBeDefined();

    const grupoProteina = componenteHamburguesa?.grupos.find(
      (g) => g.grupoModificadorId === PROTEINA_GRUPO_ID,
    );
    expect(grupoProteina?.min).toBe(1);
    expect(grupoProteina?.max).toBe(1);

    const opcionChuleta = grupoProteina?.opciones.find(
      (o) => o.itemId === CHULETA_ID,
    );
    expect(opcionChuleta?.precioExtra).toBe('1500.0000');
  });

  it('8. vende el "Combo Especial" eligiendo chuleta en la unidad 1 de la Hamburguesa Especial → total = precioBase (4300) + precioExtra chuleta (1500), descuenta 150 g de chuleta', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: COMBO_ESPECIAL_ID,
            cantidad: '1',
            personalizacion: {
              componentes: [
                {
                  componenteItemId: HAMBURGUESA_ESPECIAL_ID,
                  unidad: 1,
                  grupos: [
                    {
                      grupoId: PROTEINA_GRUPO_ID,
                      opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
                    },
                  ],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '5800.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    // Total = precioBase del Combo Especial (4300) + precioExtra de la chuleta (1500)
    expect(venta.totalFinal).toBe('5800.0000');

    // Movimiento de salida de la proteína elegida (chuleta), 150 g — default
    // del grupo "Proteína" para "Hamburguesa Especial" (sin override, a
    // diferencia de "Hamburguesa Especial XL") — convertidos a la unidad base
    // del ingrediente (kg): 150 g = 0.15 kg (mismo `CatalogService.convertirUnidad`
    // que usan los ingredientes de receta).
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id, cantidad FROM movimientos_inventario
       WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [venta.id, CHULETA_ID],
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('salida');
    expect(movs[0].motivo).toBe('venta');
    expect(movs[0].cantidad).toBe('0.1500');
  });

  it('9. (negativo) POST /ventas con un componenteItemId que no es componente del "Combo Especial" → 400', async () => {
    const ajenoId = await crearProducto(
      app,
      token,
      'Ajeno combo especial E2E',
      '5',
      '100',
    );

    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: COMBO_ESPECIAL_ID,
            cantidad: '1',
            personalizacion: {
              componentes: [
                {
                  componenteItemId: ajenoId,
                  unidad: 1,
                  grupos: [
                    {
                      grupoId: PROTEINA_GRUPO_ID,
                      opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
                    },
                  ],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4300.0000' }],
      });

    expect(res.status).toBe(400);
  });

  // Componente cantidad>1 con elección de proteínas DISTINTAS por unidad —
  // combo self-contained (no toca el seed) creado con la receta
  // "Hamburguesa Especial" (grupo "Proteína", min:1 max:1) como componente
  // en cantidad 2. Cierra el gap de evidencia: hasta ahora solo había
  // cobertura mockeada de cantidad>1 + elecciones distintas por unidad.
  it('10. crea un combo self-contained con "Hamburguesa Especial" x2 como componente bloqueante', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo Doble Hamburguesa E2E ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          {
            componenteItemId: HAMBURGUESA_ESPECIAL_ID,
            cantidad: '2',
            bloqueante: true,
          },
        ],
      });

    expect(res.status).toBe(201);
    comboDobleId = (res.body as ItemResponse).id;
  });

  it('11. (sanity) GET /items/:id del combo doble expone cantidad=2 y el grupo "Proteína" con la opción chuleta a +$1.500', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${comboDobleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const detalle = res.body as ComboDetalleResponse;
    const componenteHamburguesa = detalle.componentes.find(
      (c) => c.componenteItemId === HAMBURGUESA_ESPECIAL_ID,
    );
    expect(componenteHamburguesa).toBeDefined();
    expect(componenteHamburguesa?.cantidad).toBe('2.0000');

    const grupoProteina = componenteHamburguesa?.grupos.find(
      (g) => g.grupoModificadorId === PROTEINA_GRUPO_ID,
    );
    expect(grupoProteina?.min).toBe(1);
    expect(grupoProteina?.max).toBe(1);

    const opcionChuleta = grupoProteina?.opciones.find(
      (o) => o.itemId === CHULETA_ID,
    );
    expect(opcionChuleta?.precioExtra).toBe('1500.0000');

    const opcionCarne = grupoProteina?.opciones.find(
      (o) => o.itemId === CARNE_MOLIDA_ID,
    );
    expect(opcionCarne).toBeDefined();
  });

  it('12. vende el combo doble eligiendo chuleta en la unidad 1 y carne molida en la unidad 2 → total = precioBase(5000) + chuleta(1500) + carne(0), persiste dos entradas de snapshot (una por unidad, cada una con su propia proteína) y descuenta stock por separado de AMBAS proteínas', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: comboDobleId,
            cantidad: '1',
            personalizacion: {
              componentes: [
                {
                  componenteItemId: HAMBURGUESA_ESPECIAL_ID,
                  unidad: 1,
                  grupos: [
                    {
                      grupoId: PROTEINA_GRUPO_ID,
                      opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
                    },
                  ],
                },
                {
                  componenteItemId: HAMBURGUESA_ESPECIAL_ID,
                  unidad: 2,
                  grupos: [
                    {
                      grupoId: PROTEINA_GRUPO_ID,
                      opciones: [{ itemId: CARNE_MOLIDA_ID, unidades: 1 }],
                    },
                  ],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '6500.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    // Total = precioBase del combo doble (5000) + precioExtra chuleta (1500)
    // + precioExtra carne molida (0)
    expect(venta.totalFinal).toBe('6500.0000');

    // Snapshot congelado persistido por unidad: `componentes` debe tener DOS
    // entradas (unidad 1 y unidad 2), cada una con la proteína elegida en
    // esa unidad — sin mezclarse ni pisarse entre sí.
    const detalleRows: {
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[] = await ds.query(
      `SELECT personalizacion FROM venta_detalles
       WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [venta.id, comboDobleId],
    );
    expect(detalleRows).toHaveLength(1);
    const snapshot = detalleRows[0].personalizacion;
    expect(snapshot?.componentes).toHaveLength(2);

    const snapshotUnidad1 = snapshot?.componentes?.find((c) => c.unidad === 1);
    const snapshotUnidad2 = snapshot?.componentes?.find((c) => c.unidad === 2);
    expect(snapshotUnidad1?.grupos[0]?.opciones[0]?.itemId).toBe(CHULETA_ID);
    expect(snapshotUnidad2?.grupos[0]?.opciones[0]?.itemId).toBe(
      CARNE_MOLIDA_ID,
    );

    // Stock descontado por unidad, por ítem distinto: una salida separada
    // para la chuleta (150 g → 0.15 kg) y otra separada para la carne
    // molida (150 g → 0.15 kg), ambas ligadas a esta venta — prueba que
    // cada unidad descontó el stock de SU propia elección.
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id, cantidad FROM movimientos_inventario
       WHERE venta_id = $1 AND item_id = ANY($2) AND eliminado_el IS NULL`,
      [venta.id, [CHULETA_ID, CARNE_MOLIDA_ID]],
    );
    expect(movs).toHaveLength(2);

    const movChuleta = movs.find((m) => m.item_id === CHULETA_ID);
    expect(movChuleta?.tipo).toBe('salida');
    expect(movChuleta?.motivo).toBe('venta');
    expect(movChuleta?.cantidad).toBe('0.1500');

    const movCarne = movs.find((m) => m.item_id === CARNE_MOLIDA_ID);
    expect(movCarne?.tipo).toBe('salida');
    expect(movCarne?.motivo).toBe('venta');
    expect(movCarne?.cantidad).toBe('0.1500');
  });

  // Regresión: cierre de cuenta de salón (mesa) con un combo cuya elección de
  // grupo vive POR COMPONENTE (Proteína en la Hamburguesa Especial). El bug:
  // `cerrarCuenta` armaba el CreateVentaDto desde la línea persistida pero
  // omitía `componentes` al mapear la personalización → la venta se creaba sin
  // la proteína y el combo la rechazaba con "El grupo Proteína requiere elegir
  // entre 1 y 1 unidades" (400). La venta directa por POST /ventas (tests 8/12)
  // nunca ejercita esta ruta; solo el flujo de salones lo hace.
  const MESA_1_ID = '550e8400-e29b-41d4-a716-446655440232';
  const ANA_PIN = '111111';
  const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

  it('13. cierra una cuenta de mesa con "Combo Especial" (Proteína: carne molida, elegida por componente) → 201 y la venta persiste la elección en `componentes`', async () => {
    // Sesión de garzón abierta. El cerrar previo la deja idempotente ante
    // corridas locales que hayan dejado una sesión abierta (en CI no hay).
    await request(app.getHttpServer())
      .post('/api/sesiones-garzon/cerrar')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: ANA_PIN });
    const resSesion = await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: ANA_PIN, turnoId: TURNO_MANANA_ID });
    expect(resSesion.status).toBe(201);

    // Abre una cuenta en la mesa (Ana queda como garzón responsable).
    const resCuenta = await request(app.getHttpServer())
      .post(`/api/mesas/${MESA_1_ID}/cuentas`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pin: ANA_PIN });
    expect(resCuenta.status).toBe(201);
    const cuentaId = (resCuenta.body as { id: string }).id;

    // Agrega el Combo Especial con la proteína elegida en su componente receta.
    const resLinea = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: COMBO_ESPECIAL_ID,
        cantidad: '1',
        personalizacion: {
          componentes: [
            {
              componenteItemId: HAMBURGUESA_ESPECIAL_ID,
              unidad: 1,
              grupos: [
                {
                  grupoId: PROTEINA_GRUPO_ID,
                  opciones: [{ itemId: CARNE_MOLIDA_ID, unidades: 1 }],
                },
              ],
            },
          ],
        },
      });
    expect(resLinea.status).toBe(201);

    // Cierra y cobra. Antes del fix esto respondía 400 ("El grupo Proteína
    // requiere elegir entre 1 y 1 unidades"): la proteína del componente se
    // perdía al mapear la línea persistida → CreateVentaDto.
    const resCerrar = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        pin: ANA_PIN,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4300.0000' }],
      });
    expect(resCerrar.status).toBe(201);
    const cierre = resCerrar.body as {
      cuenta: { estado: string; ventaId: string | null };
      ventaId: string;
    };
    expect(cierre.cuenta.estado).toBe('cerrada');
    expect(cierre.ventaId).toBeTruthy();

    // El snapshot congelado en la venta conserva la elección por componente.
    const detalleRows: {
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[] = await ds.query(
      `SELECT personalizacion FROM venta_detalles
       WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [cierre.ventaId, COMBO_ESPECIAL_ID],
    );
    expect(detalleRows).toHaveLength(1);
    const snapshot = detalleRows[0].personalizacion;
    expect(snapshot?.componentes).toHaveLength(1);
    expect(snapshot?.componentes?.[0]?.grupos[0]?.opciones[0]?.itemId).toBe(
      CARNE_MOLIDA_ID,
    );
  });
});
