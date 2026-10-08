import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Lo que un DTO deja entrar antes de que el service lo toque (2026-10-06).
 *
 * - **Topes.** Todo array que entra por la API lleva `@ArrayMaxSize`, elegido
 *   por campo (el porqué está al lado de cada decorador). Una fila por
 *   decorador: con el tope + 1 el 400 nombra el campo; con el tope justo ese
 *   mensaje no aparece. El tope justo lleva un campo no declarado (`zz`) para
 *   que el pedido muera en el pipe y no escriba nada.
 * - **`@IsObject()`.** `@ValidateNested()` deja pasar un array: medido por
 *   HTTP, en `liquidar` confirmaba la liquidación sin el ajuste pedido y en
 *   `POST /compras` guardaba `lote: []` en el borrador.
 * - **`@ArrayUnique()`** en los ids de descuentos y recargos que entran al
 *   motor: repetidos, la regla se aplicaba una vez por repetición (`POST
 *   /ventas` con el mismo descuento dos veces se guardaba con total 0).
 * - **Los DTOs del motor** con `lineas` en el tope dan el mismo total que la
 *   suma por línea: el tope no cambia lo que se cobra.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const SMARTPHONE_ID = '550e8400-e29b-41d4-a716-446655440116';
/** "Promo del total $5.000", nivel venta. */
const DESCUENTO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440360';
/** "Recargo por pedido chico", nivel venta. */
const RECARGO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440354';
const ANA_ID = '550e8400-e29b-41d4-a716-446655440238';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface Calculo {
  totales: { totalFinal: string };
}

/** Ids con forma de UUID v4 que no existen: el pipe los acepta, el service no llega. */
const uuids = (n: number): string[] =>
  Array.from(
    { length: n },
    (_, i) => `550e8400-e29b-41d4-a716-${String(900000000000 + i)}`,
  );
const ID = uuids(1)[0];

/**
 * Elementos válidos: si un elemento de un array de primer nivel falla, Nest
 * informa solo los errores de los hijos y se come los del campo (el tope).
 */
const lista = (n: number, elemento: (id: string) => object): object[] =>
  uuids(n).map(elemento);
const pago = (id: string) => ({ metodoPagoId: id, monto: '1' });
const lineaDe = (id: string) => ({ itemId: id, cantidad: '1' });
const ingrediente = (id: string) => ({
  ingredienteItemId: id,
  cantidad: '1',
  unidadCodigo: 'g',
});
const grupoDeItem = (id: string) => ({
  grupoModificadorId: id,
  min: 0,
  max: 1,
});
const grupoElegido = (id: string) => ({ grupoId: id, opciones: [] });
const grupoPropinas = (id: string) => ({
  tipoGarzon: 'garzon',
  nombre: `Grupo ${id.slice(-4)}`,
  porcentaje: '0',
  criterio: 'PARTES_IGUALES',
  baseVentas: 'TOTAL_FINAL',
  activo: false,
  orden: 0,
  pesos: [],
});

type Metodo = 'post' | 'patch' | 'put';

interface FilaTope {
  campo: string;
  tope: number;
  metodo: Metodo;
  ruta: string;
  cuerpo: (n: number) => object;
}

const linea = (extra: object) => ({
  lineas: [{ itemId: SMARTPHONE_ID, cantidad: '1', ...extra }],
});
const personalizacion = (p: object) => linea({ personalizacion: p });

/**
 * Una fila por `@ArrayMaxSize` agregado el 2026-10-06, más los de las
 * devoluciones de la nota de crédito y del reembolso (2026-10-08).
 */
const TOPES: FilaTope[] = [
  // caja
  {
    campo: 'lineas',
    tope: 50,
    metodo: 'post',
    ruta: `caja/${ID}/conteo`,
    cuerpo: (n) => ({
      lineas: lista(n, (id) => ({ metodoPagoId: id, montoContado: '0' })),
    }),
  },
  {
    campo: 'lineas',
    tope: 50,
    metodo: 'post',
    ruta: `caja/${ID}/cerrar`,
    cuerpo: (n) => ({ lineas: lista(n, (id) => ({ metodoPagoId: id })) }),
  },
  {
    campo: 'lineas',
    tope: 50,
    metodo: 'patch',
    ruta: `caja/${ID}/arqueo/motivos`,
    cuerpo: (n) => ({ lineas: lista(n, (id) => ({ metodoPagoId: id })) }),
  },
  {
    campo: 'garzonIds',
    tope: 100,
    metodo: 'post',
    ruta: `caja/${ID}/testigos`,
    cuerpo: (n) => ({ garzonIds: uuids(n) }),
  },
  {
    campo: 'usuarioIds',
    tope: 200,
    metodo: 'put',
    ruta: `cajones/${ID}/usuarios`,
    cuerpo: (n) => ({ usuarioIds: uuids(n) }),
  },
  // propinas
  {
    campo: 'turnoIds',
    tope: 50,
    metodo: 'post',
    ruta: 'propinas/liquidaciones',
    cuerpo: (n) => ({ turnoIds: uuids(n) }),
  },
  {
    campo: 'turnoIds',
    tope: 50,
    metodo: 'post',
    ruta: 'propinas/liquidaciones/preview',
    cuerpo: (n) => ({ turnoIds: uuids(n) }),
  },
  {
    campo: 'turnoIds',
    tope: 50,
    metodo: 'post',
    ruta: 'propinas/liquidaciones/liquidar',
    cuerpo: (n) => ({ turnoIds: uuids(n) }),
  },
  {
    campo: 'ajustes.exclusiones',
    tope: 200,
    metodo: 'post',
    ruta: 'propinas/liquidaciones/preview',
    cuerpo: (n) => ({ ajustes: { exclusiones: uuids(n) } }),
  },
  {
    campo: 'ajustes.montosManuales',
    tope: 200,
    metodo: 'post',
    ruta: 'propinas/liquidaciones/preview',
    cuerpo: (n) => ({
      ajustes: {
        montosManuales: lista(n, (id) => ({ garzonId: id, monto: '1' })),
      },
    }),
  },
  {
    campo: 'grupos',
    tope: 20,
    metodo: 'put',
    ruta: 'propinas/distribucion',
    cuerpo: (n) => ({ grupos: lista(n, grupoPropinas) }),
  },
  {
    campo: 'grupos.0.pesos',
    tope: 200,
    metodo: 'put',
    ruta: 'propinas/distribucion',
    cuerpo: (n) => ({
      grupos: [
        {
          ...grupoPropinas(ID),
          pesos: lista(n, (id) => ({ garzonId: id, peso: '1' })),
        },
      ],
    }),
  },
  {
    campo: 'participantes',
    tope: 200,
    metodo: 'patch',
    ruta: `propinas/liquidaciones/${ID}`,
    cuerpo: (n) => ({ participantes: lista(n, (id) => ({ garzonId: id })) }),
  },
  // salones
  {
    campo: 'pagos',
    tope: 50,
    metodo: 'post',
    ruta: `cuentas/${ID}/cerrar`,
    cuerpo: (n) => ({ pagos: lista(n, pago) }),
  },
  {
    campo: 'lineas',
    tope: 500,
    metodo: 'post',
    ruta: `cuentas/${ID}/comanda`,
    cuerpo: (n) => ({
      lineas: lista(n, (id) => ({ cuentaLineaId: id, cantidadEnviada: '1' })),
    }),
  },
  {
    campo: 'cuentaIds',
    tope: 50,
    metodo: 'post',
    ruta: `mesas/${ID}/cuentas/fusionar`,
    cuerpo: (n) => ({ cuentaIds: uuids(n) }),
  },
  {
    campo: 'mesas',
    tope: 200,
    metodo: 'patch',
    ruta: `salones/${ID}/layout`,
    cuerpo: (n) => ({
      mesas: lista(n, (id) => ({ mesaId: id, posX: 0, posY: 0 })),
    }),
  },
  // pagos
  {
    campo: 'pagos',
    tope: 50,
    metodo: 'post',
    ruta: 'ventas',
    cuerpo: (n) => ({ pagos: lista(n, pago) }),
  },
  {
    campo: 'pagos',
    tope: 50,
    metodo: 'post',
    ruta: 'pagos',
    cuerpo: (n) => ({ pagos: lista(n, pago) }),
  },
  // ítems: alta
  {
    campo: 'ingredientes',
    tope: 100,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({ ingredientes: lista(n, ingrediente) }),
  },
  {
    campo: 'extrasPermitidos',
    tope: 100,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({
      extrasPermitidos: lista(n, (id) => ({
        ...ingrediente(id),
        precioExtra: '0',
      })),
    }),
  },
  {
    campo: 'componentes',
    tope: 50,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({
      componentes: lista(n, (id) => ({ componenteItemId: id, cantidad: '1' })),
    }),
  },
  {
    campo: 'gruposModificadores',
    tope: 50,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({ gruposModificadores: lista(n, grupoDeItem) }),
  },
  {
    campo: 'gruposModificadores.0.opciones',
    tope: 100,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({
      gruposModificadores: [
        {
          ...grupoDeItem(ID),
          opciones: lista(n, (id) => ({ grupoOpcionId: id })),
        },
      ],
    }),
  },
  {
    campo: 'impuestosIds',
    tope: 50,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({ impuestosIds: uuids(n) }),
  },
  {
    campo: 'recargosIds',
    tope: 50,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({ recargosIds: uuids(n) }),
  },
  {
    campo: 'descuentosIds',
    tope: 50,
    metodo: 'post',
    ruta: 'items',
    cuerpo: (n) => ({ descuentosIds: uuids(n) }),
  },
  // ítems: edición (`UpdateItemDto` redeclara sus arrays, no los hereda)
  {
    campo: 'ingredientes',
    tope: 100,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({ ingredientes: lista(n, ingrediente) }),
  },
  {
    campo: 'extrasPermitidos',
    tope: 100,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({
      extrasPermitidos: lista(n, (id) => ({
        ...ingrediente(id),
        precioExtra: '0',
      })),
    }),
  },
  {
    campo: 'componentes',
    tope: 50,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({
      componentes: lista(n, (id) => ({ componenteItemId: id, cantidad: '1' })),
    }),
  },
  {
    campo: 'gruposModificadores',
    tope: 50,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({ gruposModificadores: lista(n, grupoDeItem) }),
  },
  {
    campo: 'impuestosIds',
    tope: 50,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({ impuestosIds: uuids(n) }),
  },
  {
    campo: 'recargosIds',
    tope: 50,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({ recargosIds: uuids(n) }),
  },
  {
    campo: 'descuentosIds',
    tope: 50,
    metodo: 'patch',
    ruta: `items/${ID}`,
    cuerpo: (n) => ({ descuentosIds: uuids(n) }),
  },
  // desfases, grupos modificadores
  {
    campo: 'items',
    tope: 500,
    metodo: 'post',
    ruta: 'desfases/aplicar',
    cuerpo: (n) => ({ items: lista(n, (id) => ({ itemId: id })) }),
  },
  {
    campo: 'items',
    tope: 500,
    metodo: 'post',
    ruta: 'desfases/descartar',
    cuerpo: (n) => ({
      items: lista(n, (id) => ({ itemId: id, costoPropuestoVisto: '0' })),
    }),
  },
  {
    campo: 'itemGrupoIds',
    tope: 1000,
    metodo: 'patch',
    ruta: `grupos-modificadores/${ID}/overrides`,
    cuerpo: (n) => ({ itemGrupoIds: uuids(n) }),
  },
  {
    campo: 'opciones',
    tope: 100,
    metodo: 'post',
    ruta: 'grupos-modificadores',
    cuerpo: (n) => ({
      opciones: lista(n, (id) => ({ itemId: id, precioExtra: '0' })),
    }),
  },
  {
    campo: 'opciones',
    tope: 100,
    metodo: 'patch',
    ruta: `grupos-modificadores/${ID}`,
    cuerpo: (n) => ({
      opciones: lista(n, (id) => ({ itemId: id, precioExtra: '0' })),
    }),
  },
  // reglas y promociones
  {
    campo: 'metodoPagoIds',
    tope: 20,
    metodo: 'post',
    ruta: 'descuentos',
    cuerpo: (n) => ({ metodoPagoIds: uuids(n) }),
  },
  {
    campo: 'tramos',
    tope: 50,
    metodo: 'post',
    ruta: 'descuentos',
    cuerpo: (n) => ({ tramos: lista(n, () => ({ minimoCantidad: '1' })) }),
  },
  {
    campo: 'metodoPagoIds',
    tope: 20,
    metodo: 'post',
    ruta: 'recargos',
    cuerpo: (n) => ({ metodoPagoIds: uuids(n) }),
  },
  {
    campo: 'tramos',
    tope: 50,
    metodo: 'post',
    ruta: 'recargos',
    cuerpo: (n) => ({ tramos: lista(n, () => ({ minimoCantidad: '1' })) }),
  },
  {
    campo: 'scopes',
    tope: 50,
    metodo: 'post',
    ruta: 'promociones',
    cuerpo: (n) => ({ scopes: lista(n, () => ({ tipoScope: 'venta' })) }),
  },
  {
    campo: 'scopes.0.itemIds',
    tope: 1000,
    metodo: 'post',
    ruta: 'promociones',
    cuerpo: (n) => ({ scopes: [{ tipoScope: 'items', itemIds: uuids(n) }] }),
  },
  {
    campo: 'diasSemana',
    tope: 7,
    metodo: 'post',
    ruta: 'promociones',
    cuerpo: (n) => ({ diasSemana: Array.from({ length: n }, () => 1) }),
  },
  // inventario, roles, usuarios
  {
    campo: 'itemIds',
    tope: 2000,
    metodo: 'post',
    ruta: 'recuentos',
    cuerpo: (n) => ({ itemIds: uuids(n) }),
  },
  {
    campo: 'moduloAppPermisoIds',
    tope: 100,
    metodo: 'put',
    ruta: `roles/${ID}/modules/${ID}/permissions`,
    cuerpo: (n) => ({ moduloAppPermisoIds: uuids(n) }),
  },
  {
    campo: 'rolIds',
    tope: 50,
    metodo: 'post',
    ruta: 'tenants/usuarios',
    cuerpo: (n) => ({ rolIds: uuids(n) }),
  },
  // ediciones que heredan el tope del alta (`PartialType` + `declare`): no
  // redeclaran el decorador, así que sacarlo del alta pone rojas las dos filas
  {
    campo: 'metodoPagoIds',
    tope: 20,
    metodo: 'patch',
    ruta: `descuentos/${ID}`,
    cuerpo: (n) => ({ metodoPagoIds: uuids(n) }),
  },
  {
    campo: 'tramos',
    tope: 50,
    metodo: 'patch',
    ruta: `descuentos/${ID}`,
    cuerpo: (n) => ({ tramos: lista(n, () => ({ minimoCantidad: '1' })) }),
  },
  {
    campo: 'metodoPagoIds',
    tope: 20,
    metodo: 'patch',
    ruta: `recargos/${ID}`,
    cuerpo: (n) => ({ metodoPagoIds: uuids(n) }),
  },
  {
    campo: 'tramos',
    tope: 50,
    metodo: 'patch',
    ruta: `recargos/${ID}`,
    cuerpo: (n) => ({ tramos: lista(n, () => ({ minimoCantidad: '1' })) }),
  },
  {
    campo: 'scopes',
    tope: 50,
    metodo: 'patch',
    ruta: `promociones/${ID}`,
    cuerpo: (n) => ({ scopes: lista(n, () => ({ tipoScope: 'venta' })) }),
  },
  {
    campo: 'scopes.0.itemIds',
    tope: 1000,
    metodo: 'patch',
    ruta: `promociones/${ID}`,
    cuerpo: (n) => ({ scopes: [{ tipoScope: 'items', itemIds: uuids(n) }] }),
  },
  {
    campo: 'diasSemana',
    tope: 7,
    metodo: 'patch',
    ruta: `promociones/${ID}`,
    cuerpo: (n) => ({ diasSemana: Array.from({ length: n }, () => 1) }),
  },
  // motor: venta
  {
    campo: 'lineas',
    tope: 500,
    metodo: 'post',
    ruta: 'ventas',
    cuerpo: (n) => ({ lineas: lista(n, lineaDe) }),
  },
  {
    campo: 'descuentosVentaIds',
    tope: 50,
    metodo: 'post',
    ruta: 'ventas',
    cuerpo: (n) => ({ descuentosVentaIds: uuids(n) }),
  },
  // devoluciones: una por ítem distinto de la venta, y una venta tiene a lo
  // sumo 500 líneas. Con menos, el tope cortaba una nota válida.
  {
    campo: 'devoluciones',
    tope: 500,
    metodo: 'post',
    ruta: `ventas/${ID}/notas-credito`,
    cuerpo: (n) => ({
      monto: '1',
      devolucion: { sinPlata: true },
      devoluciones: lista(n, lineaDe),
    }),
  },
  {
    campo: 'devoluciones',
    tope: 500,
    metodo: 'post',
    ruta: `pasarela/admin/ordenes/${ID}/reembolsos`,
    cuerpo: (n) => ({ monto: '1', devoluciones: lista(n, lineaDe) }),
  },
  {
    campo: 'devoluciones',
    tope: 500,
    metodo: 'post',
    ruta: `pasarela/admin/ordenes/${ID}/reembolsos/${ID}/nota`,
    cuerpo: (n) => ({ devoluciones: lista(n, lineaDe) }),
  },
  {
    campo: 'recargosVentaIds',
    tope: 50,
    metodo: 'post',
    ruta: 'ventas',
    cuerpo: (n) => ({ recargosVentaIds: uuids(n) }),
  },
  // motor: cálculo
  {
    campo: 'lineas',
    tope: 500,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) => ({ lineas: lista(n, lineaDe) }),
  },
  {
    campo: 'descuentosVentaIds',
    tope: 50,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) => ({ descuentosVentaIds: uuids(n) }),
  },
  {
    campo: 'recargosVentaIds',
    tope: 50,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) => ({ recargosVentaIds: uuids(n) }),
  },
  // motor: personalización de una línea (clase compartida por venta, cálculo y salón)
  {
    campo: 'lineas.0.personalizacion.omitidos',
    tope: 100,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) => personalizacion({ omitidos: uuids(n) }),
  },
  {
    campo: 'lineas.0.personalizacion.extras',
    tope: 100,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) =>
      personalizacion({
        extras: lista(n, (id) => ({ ingredienteItemId: id })),
      }),
  },
  {
    campo: 'lineas.0.personalizacion.grupos',
    tope: 50,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) => personalizacion({ grupos: lista(n, grupoElegido) }),
  },
  {
    campo: 'lineas.0.personalizacion.grupos.0.opciones',
    tope: 100,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) =>
      personalizacion({
        grupos: [{ grupoId: ID, opciones: lista(n, (id) => ({ itemId: id })) }],
      }),
  },
  {
    campo: 'lineas.0.personalizacion.componentes',
    tope: 200,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) =>
      personalizacion({
        componentes: lista(n, (id) => ({
          componenteItemId: id,
          unidad: 1,
          grupos: [],
        })),
      }),
  },
  {
    campo: 'lineas.0.personalizacion.componentes.0.grupos',
    tope: 50,
    metodo: 'post',
    ruta: 'calculo-precios/calcular',
    cuerpo: (n) =>
      personalizacion({
        componentes: [
          { componenteItemId: ID, unidad: 1, grupos: lista(n, grupoElegido) },
        ],
      }),
  },
];

describe('Topes y forma de los arrays y objetos de los DTOs (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta | undefined;
  /** Un servicio no tiene stock: las ventas del spec no dependen de lo que otras suites vendieron. */
  let servicioId: string;

  function enviar(metodo: Metodo, ruta: string, body: object) {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function mensajes(res: { body: unknown }): string[] {
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  async function crear(ruta: string, body: object): Promise<string> {
    const res = await enviar('post', ruta, body);
    expect(res.status).toBe(201);
    return (res.body as IdResponse).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

    servicioId = await crear('items', {
      nombre: `Servicio topes E2E ${randomUUID()}`,
      precioBase: '1000',
      precioIncluyeImpuesto: true,
      monedaId: CLP_MONEDA_ID,
      tipo: 'servicio',
    });
    caja = await abrirCaja(app, token, { comentario: 'Apertura E2E topes' });
  }, 60000);

  afterAll(async () => {
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  describe('@ArrayMaxSize: el tope + 1 es 400 nombrando el campo', () => {
    it.each(TOPES)(
      '$metodo /$ruta $campo: $tope pasa el tope, uno más no',
      async ({ campo, tope, metodo, ruta, cuerpo }) => {
        const esperado = `${campo} must contain no more than ${tope} elements`;

        const pasado = await enviar(metodo, ruta, cuerpo(tope + 1));
        expect(pasado.status).toBe(400);
        expect(mensajes(pasado)).toContain(esperado);

        const justo = await enviar(metodo, ruta, { ...cuerpo(tope), zz: 1 });
        expect(justo.status).toBe(400);
        expect(mensajes(justo)).toContain('property zz should not exist');
        expect(mensajes(justo)).not.toContain(esperado);
      },
    );
  });

  // Sin `@IsArray()`, `@IsUUID(..., { each: true })` aceptaba un id suelto y el
  // motor lo recorría como lista: un 500 (medido en `POST /ventas`).
  describe('@IsArray: una lista que llega como un valor suelto es 400', () => {
    const FILAS: { campo: string; ruta: string; cuerpo: object }[] = [
      {
        campo: 'descuentosVentaIds',
        ruta: 'ventas',
        cuerpo: { ...linea({}), descuentosVentaIds: DESCUENTO_VENTA_ID },
      },
      {
        campo: 'recargosVentaIds',
        ruta: 'ventas',
        cuerpo: { ...linea({}), recargosVentaIds: RECARGO_VENTA_ID },
      },
      {
        campo: 'tramos',
        ruta: 'descuentos',
        cuerpo: { tramos: { minimoCantidad: '1' } },
      },
      {
        campo: 'tramos',
        ruta: 'recargos',
        cuerpo: { tramos: { minimoCantidad: '1' } },
      },
    ];

    it.each(FILAS)(
      'POST /$ruta $campo suelto: 400',
      async ({ campo, ruta, cuerpo }) => {
        const res = await enviar('post', ruta, cuerpo);
        expect(res.status).toBe(400);
        expect(mensajes(res)).toContain(`${campo} must be an array`);
      },
    );
  });

  describe('@IsObject: un objeto único que llega como array es 400', () => {
    let localId: string;
    let proveedorId: string;
    let facturaId: string;
    let itemLoteId: string;

    beforeAll(async () => {
      const ubicaciones = await request(app.getHttpServer())
        .get('/api/ubicaciones')
        .set('Authorization', `Bearer ${token}`);
      expect(ubicaciones.status).toBe(200);
      localId = (ubicaciones.body as { id: string; tipo: string }[]).find(
        (u) => u.tipo === 'local',
      )!.id;
      const tipos = await request(app.getHttpServer())
        .get('/api/compras/tipos-documento')
        .set('Authorization', `Bearer ${token}`);
      expect(tipos.status).toBe(200);
      facturaId = (tipos.body as { id: string; codigo: string | null }[]).find(
        (t) => t.codigo === '33',
      )!.id;
      proveedorId = await crear('terceros', {
        tipo: 'proveedor',
        nombre: `Proveedor topes E2E ${randomUUID()}`,
      });
      itemLoteId = await crear('items', {
        nombre: `Lote topes E2E ${randomUUID()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        modoInventario: 'lote',
      });
    });

    const compra = (folio: string, lote: unknown) => ({
      proveedorId,
      tipoDocumentoCompraId: facturaId,
      folio,
      fechaDocumento: '2026-10-01',
      ubicacionId: localId,
      totalDocumento: '1000',
      lineas: [
        {
          itemId: itemLoteId,
          cantidad: '2',
          unidadCodigo: 'unidad',
          precioUnitario: '500',
          lote,
        },
      ],
    });

    // El folio tiene tope de 40 caracteres: un UUID entero no cabe.
    const folioNuevo = () => `TOPES-${randomUUID().slice(0, 18)}`;

    async function comprasConFolio(folio: string): Promise<number> {
      // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el pedido
      // escribió algo, y una fila borrada también sería una escritura.
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM compras WHERE tenant_id = $1 AND folio = $2`,
        [PARIS_TENANT_ID, folio],
      );
      return Number(filas[0].n);
    }

    it('POST /compras con lineas[].lote como array: 400 y el borrador no se guarda', async () => {
      const folio = folioNuevo();
      const res = await enviar(
        'post',
        'compras',
        compra(folio, [{ codigoLote: 'L1' }]),
      );
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('lineas.0.lote must be an object');
      expect(await comprasConFolio(folio)).toBe(0);

      const control = folioNuevo();
      const ok = await enviar(
        'post',
        'compras',
        compra(control, { codigoLote: 'L1' }),
      );
      expect(ok.status).toBe(201);
      expect(await comprasConFolio(control)).toBe(1);
    });

    it('POST /compras/:id/confirmar con pago como array: 400 y la compra sigue en borrador', async () => {
      const compraId = await crear(
        'compras',
        compra(folioNuevo(), { codigoLote: 'L2' }),
      );
      const res = await enviar('post', `compras/${compraId}/confirmar`, {
        pago: [{ monto: '100', metodoPagoId: EFECTIVO_ID }],
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('pago must be an object');
      const leida = await request(app.getHttpServer())
        .get(`/api/compras/${compraId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(leida.status).toBe(200);
      expect((leida.body as { estado: string }).estado).toBe('borrador');
    });

    it('PATCH /items/:id/stock con lote como array: 400', async () => {
      const res = await enviar('patch', `items/${itemLoteId}/stock`, {
        ubicacionId: localId,
        cantidad: '3',
        tipo: 'entrada',
        motivo: 'ajuste_manual',
        lote: [{ codigoLote: 'AJ' }],
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('lote must be an object');
    });

    it('POST /items con lote como array: 400', async () => {
      const res = await enviar('post', 'items', {
        nombre: `Lote topes E2E ${randomUUID()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        modoInventario: 'lote',
        stock: '5',
        lote: [{ codigoLote: 'INI' }],
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('lote must be an object');
    });

    async function liquidaciones(): Promise<number> {
      // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el pedido
      // escribió algo, y una fila borrada también sería una escritura.
      const filas: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM liquidacion_propinas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      return Number(filas[0].n);
    }

    it('POST /propinas/liquidaciones/liquidar con ajustes como array: 400 y no se liquida nada', async () => {
      const antes = await liquidaciones();
      const res = await enviar('post', 'propinas/liquidaciones/liquidar', {
        fechaDesde: '2026-10-01',
        fechaHasta: '2026-10-01',
        ajustes: [{ exclusiones: [ANA_ID] }],
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('ajustes must be an object');
      expect(await liquidaciones()).toBe(antes);
    });

    it('POST /propinas/liquidaciones/preview con ajustes como array: 400', async () => {
      const res = await enviar('post', 'propinas/liquidaciones/preview', {
        fechaDesde: '2026-10-01',
        fechaHasta: '2026-10-01',
        ajustes: [{ exclusiones: [ANA_ID] }],
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain('ajustes must be an object');
    });

    it.each(['propinaDirecta', 'propinaCierreMesa'])(
      'POST /ventas con %s como array: 400',
      async (campo) => {
        const res = await enviar('post', 'ventas', {
          ...linea({}),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          [campo]:
            campo === 'propinaDirecta'
              ? [{ montoPagado: '5000' }]
              : [{ montoPagado: '5000', garzonId: ANA_ID }],
        });
        expect(res.status).toBe(400);
        expect(mensajes(res)).toContain(`${campo} must be an object`);
      },
    );
  });

  describe('motor: ids de reglas repetidos son 400, no una regla aplicada dos veces', () => {
    // 200 unidades de $1.000: el descuento fijo de $5.000 no deja el total en 0.
    const venta = (extra: object) => ({
      lineas: [{ itemId: servicioId, cantidad: '200' }],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
      ...extra,
    });

    const REPETIDOS: {
      campo: string;
      ruta: string;
      cuerpo: (ids: string[]) => object;
      id: string;
    }[] = [
      {
        campo: 'descuentosVentaIds',
        ruta: 'ventas',
        id: DESCUENTO_VENTA_ID,
        cuerpo: (ids) => venta({ descuentosVentaIds: ids }),
      },
      {
        campo: 'recargosVentaIds',
        ruta: 'ventas',
        id: RECARGO_VENTA_ID,
        cuerpo: (ids) => venta({ recargosVentaIds: ids }),
      },
      {
        campo: 'descuentosVentaIds',
        ruta: 'calculo-precios/calcular',
        id: DESCUENTO_VENTA_ID,
        cuerpo: (ids) => ({ ...linea({}), descuentosVentaIds: ids }),
      },
      {
        campo: 'recargosVentaIds',
        ruta: 'calculo-precios/calcular',
        id: RECARGO_VENTA_ID,
        cuerpo: (ids) => ({ ...linea({}), recargosVentaIds: ids }),
      },
    ];

    it.each(REPETIDOS)(
      'POST /$ruta $campo: repetido es 400; una vez, pasa',
      async ({ campo, ruta, cuerpo, id }) => {
        const repetido = await enviar('post', ruta, cuerpo([id, id]));
        expect(repetido.status).toBe(400);
        expect(mensajes(repetido)).toContain(
          `${campo.replace(/[^.]+$/, '')}All ${campo.split('.').pop()}'s elements must be unique`,
        );

        const unaVez = await enviar('post', ruta, cuerpo([id]));
        expect(unaVez.status).toBe(201);
      },
    );

    it('POST /ventas con el mismo descuento dos veces no se guarda', async () => {
      // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el pedido
      // escribió algo, y una fila borrada también sería una escritura.
      const ventasAntes: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      const res = await enviar(
        'post',
        'ventas',
        venta({ descuentosVentaIds: [DESCUENTO_VENTA_ID, DESCUENTO_VENTA_ID] }),
      );
      expect(res.status).toBe(400);
      // Mismo conteo sin filtro de borrado, por la misma razón.
      const ventasDespues: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      expect(ventasDespues[0].n).toBe(ventasAntes[0].n);
    });
  });

  describe('nota de crédito: las devoluciones en el tope se emiten', () => {
    // Una venta con 500 ítems distintos es el máximo que una nota puede tener
    // que devolver entera. Servicios: no dependen del stock que dejan otras suites.
    it('POST /ventas/:id/notas-credito con 500 devoluciones es 201; con 501, 400 y no escribe nada', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 500; i++)
        ids.push(
          await crear('items', {
            nombre: `Servicio devolución E2E ${i} ${randomUUID()}`,
            precioBase: '1000',
            precioIncluyeImpuesto: true,
            monedaId: CLP_MONEDA_ID,
            tipo: 'servicio',
          }),
        );
      const ventaId = await crear('ventas', {
        lineas: ids.map((itemId) => ({ itemId, cantidad: '1' })),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
      });
      const leida = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(leida.status).toBe(200);
      const venta = leida.body as { totalFinal: string; pagos: IdResponse[] };
      const nota = (devoluciones: string[]) =>
        enviar('post', `ventas/${ventaId}/notas-credito`, {
          monto: venta.totalFinal,
          devolucion: { pagoId: venta.pagos[0].id },
          devoluciones: devoluciones.map((itemId) => ({
            itemId,
            cantidad: '1',
          })),
        });
      const notas = async (): Promise<number> =>
        (
          await ds.query<{ n: number }[]>(
            `SELECT count(*)::int AS n FROM ventas
             WHERE venta_referencia_id = $1 AND eliminado_el IS NULL`,
            [ventaId],
          )
        )[0].n;

      const pasada = await nota([...ids, ID]);
      expect(pasada.status).toBe(400);
      expect(mensajes(pasada)).toContain(
        'devoluciones must contain no more than 500 elements',
      );
      expect(await notas()).toBe(0);

      const tope = await nota(ids);
      expect(tope.status).toBe(201);
      const lineas = await ds.query<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM venta_detalles
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [(tope.body as IdResponse).id],
      );
      expect(lineas[0].n).toBe(500);
      expect(await notas()).toBe(1);
    }, 120000);
  });

  describe('motor: con lineas en el tope el total es la suma por línea', () => {
    it('POST /calculo-precios/calcular con 500 líneas cobra 500 veces una', async () => {
      const calcular = (n: number) =>
        enviar('post', 'calculo-precios/calcular', {
          lineas: Array.from({ length: n }, () => ({
            itemId: SMARTPHONE_ID,
            cantidad: '1',
          })),
        });
      const una = await calcular(1);
      expect(una.status).toBe(201);
      const tope = await calcular(500);
      expect(tope.status).toBe(201);
      expect((tope.body as Calculo).totales.totalFinal).toBe(
        new Decimal((una.body as Calculo).totales.totalFinal)
          .times(500)
          .toFixed(6),
      );
    });

    it('POST /ventas con 500 líneas guarda 500 veces el total de una', async () => {
      const vender = async (n: number): Promise<string> => {
        const res = await enviar('post', 'ventas', {
          lineas: Array.from({ length: n }, () => ({
            itemId: servicioId,
            cantidad: '1',
          })),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
        });
        expect(res.status).toBe(201);
        const leida = await request(app.getHttpServer())
          .get(`/api/ventas/${(res.body as IdResponse).id}`)
          .set('Authorization', `Bearer ${token}`);
        expect(leida.status).toBe(200);
        return (leida.body as { totalFinal: string }).totalFinal;
      };
      const una = await vender(1);
      const tope = await vender(500);
      expect(tope).toBe(new Decimal(una).times(500).toFixed(4));
    }, 60000);
  });
});
