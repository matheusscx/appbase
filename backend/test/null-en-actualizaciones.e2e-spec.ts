import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { bodyPreferencias } from './helpers/preferencias';

// `@IsOptional()` trata `null` igual que ausente y saltea los validadores de
// abajo, así que un `null` explícito en un PATCH/PUT llegaba al service: a una
// columna NOT NULL (500 de Postgres), a un `.map` (TypeError, 500), o a un
// `??`/`!= null` que lo ignoraba (200 sin cambiar nada). Acá, por recurso, cada
// campo en `null` tiene que dar 400; el control es el mismo campo con un valor
// válido, que tiene que dar 200 — sin él, un 400 por otra causa pasaría igual.
//
// Todo lo que se crea nace inactivo cuando el recurso lo permite: un descuento,
// un recargo o una promo activos en Demo Restaurante se aplicarían en las
// ventas de las suites que corren después.

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface Participante {
  id: string;
  garzonId: string;
}
interface Detalle {
  id: string;
  grupos: { id: string }[];
  participantes: Participante[];
}
interface GrupoDistribucion {
  tipoGarzon: string;
  nombre: string;
  porcentaje: string;
  criterio: string;
  baseVentas: string;
  manualModo: string | null;
  activo: boolean;
  orden: number;
  pesos: { garzonId: string; peso: string }[];
}
interface Distribucion {
  porcentajeSugerido: string;
  habilitadoPos: boolean;
  habilitadoSalones: boolean;
  grupos: GrupoDistribucion[];
}

const sufijo = Date.now().toString(36);

describe('null explícito en PATCH/PUT → 400 (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  async function entrar(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(resLogin.status).toBe(200);
    const inicial = (resLogin.body as TokenResponse).access_token;
    if (!tenantId) return inicial;
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set('Authorization', `Bearer ${inicial}`)
      .send({ tenantId });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as TokenResponse).access_token;
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
    token = await entrar(ADMIN_PARIS.email, ADMIN_PARIS.pass, PARIS_TENANT_ID);
  });

  afterAll(async () => {
    await app.close();
  });

  function enviar(
    metodo: 'get' | 'post' | 'patch' | 'put',
    ruta: string,
    body?: object,
    conToken = token,
  ) {
    const req = request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${conToken}`);
    return body === undefined ? req : req.send(body);
  }

  async function crear(
    ruta: string,
    body: object,
    clave = 'id',
    conToken = token,
  ): Promise<string> {
    const res = await enviar('post', ruta, body, conToken);
    expect(res.status).toBe(201);
    return (res.body as Record<string, string>)[clave];
  }

  // Producto sin stock inicial: alcanza para ser opción de un grupo, y no
  // escribe movimientos de inventario.
  function crearProducto(nombre: string): Promise<string> {
    return crear('items', {
      nombre: `${nombre} ${sufijo}`,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
    });
  }

  // Un `it` por campo: el campo en `null` → 400, y el mismo campo con un valor
  // válido → 200. Un PATCH manda el campo solo; un PUT reemplaza el recurso
  // entero, así que manda todo `validos()` con ese campo pisado. `ruta`,
  // `validos` y `conToken` son funciones porque el recurso (y a veces el
  // tenant) se crea en el `beforeAll` del bloque, después de declarar los `it`.
  function cadaCampoNull(
    metodo: 'patch' | 'put',
    ruta: () => string,
    validos: () => Record<string, unknown>,
    campos: string[],
    conToken: () => string = () => token,
  ) {
    it.each(campos)(
      '%s null → 400; con un valor válido → 200',
      async (campo) => {
        const base = metodo === 'put' ? validos() : {};
        const res = await enviar(
          metodo,
          ruta(),
          { ...base, [campo]: null },
          conToken(),
        );
        expect(res.status).toBe(400);
        const control = await enviar(
          metodo,
          ruta(),
          { ...base, [campo]: validos()[campo] },
          conToken(),
        );
        expect(control.status).toBe(200);
      },
    );
  }

  describe('A — el null llegaba a una columna NOT NULL (500)', () => {
    describe('PATCH /turnos/:id', () => {
      const alta = {
        nombre: `Turno null ${sufijo}`,
        horaInicio: '08:00',
        horaFin: '16:00',
        activo: true,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `turnos/${await crear('turnos', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });

    // La moneda oficial: existe siempre y su fila se puede re-habilitar.
    describe('PATCH /monedas/:monedaId', () => {
      cadaCampoNull(
        'patch',
        () => `monedas/${CLP_MONEDA_ID}`,
        () => ({ habilitada: true }),
        ['habilitada'],
      );
    });

    describe('PATCH /impresoras/:id', () => {
      const alta = {
        nombre: `Impresora null ${sufijo}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: 'cola-null',
        activo: false,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `impresoras/${await crear('impresoras', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        ['nombre', 'rol', 'tipoConexion', 'activo'],
      );
    });

    describe('PATCH /categorias/:id', () => {
      const alta = {
        nombre: `Categoría null ${sufijo}`,
        aplicaA: 'ambos',
        activo: true,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `categorias/${await crear('categorias', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });

    describe('PATCH /terceros/:id', () => {
      const alta = {
        tipo: 'proveedor',
        nombre: `Tercero null ${sufijo}`,
        activo: true,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `terceros/${await crear('terceros', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });

    describe('PATCH /garzones/:id', () => {
      const alta = {
        nombre: `Garzón null ${sufijo}`,
        activo: false,
        tipo: 'garzon',
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `garzones/${await crear('garzones', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });

    describe('PATCH /salones/:id y /mesas/:id', () => {
      const salon = { nombre: `Salón null ${sufijo}` };
      const mesa = {
        nombre: `Mesa null ${sufijo}`,
        posX: 0.1,
        posY: 0.1,
        forma: 'redonda',
        tamano: 'mediano',
      };
      let rutaSalon: string;
      let rutaMesa: string;
      beforeAll(async () => {
        const salonId = await crear('salones', salon);
        rutaSalon = `salones/${salonId}`;
        rutaMesa = `mesas/${await crear(`salones/${salonId}/mesas`, mesa)}`;
      });

      cadaCampoNull(
        'patch',
        () => rutaSalon,
        () => salon,
        ['nombre'],
      );
      cadaCampoNull(
        'patch',
        () => rutaMesa,
        () => mesa,
        Object.keys(mesa),
      );
    });

    describe('PATCH /impuestos/:id', () => {
      const alta = {
        nombre: `Impuesto null ${sufijo}`,
        porcentaje: '0.05',
        activo: false,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `impuestos/${await crear('impuestos', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });

    // Una liquidación de un rango sin ventas, con un participante agregado a
    // mano: es la forma de tener un participante sin sembrar propinas. Queda
    // en borrador —solo se anula una confirmada— y no toca ninguna venta.
    describe('PATCH /propinas/liquidaciones/:id', () => {
      let ruta: string;
      let participanteId: string;
      beforeAll(async () => {
        const garzonId = await crear('garzones', {
          nombre: `Garzón liquidación null ${sufijo}`,
          tipo: 'garzon',
        });
        const alta = await enviar('post', 'propinas/liquidaciones', {
          fechaDesde: '2001-01-01',
          fechaHasta: '2001-01-02',
        });
        expect(alta.status).toBe(201);
        const detalle = alta.body as Detalle;
        ruta = `propinas/liquidaciones/${detalle.id}`;
        const conManual = await enviar('patch', ruta, {
          participantes: [
            {
              garzonId,
              grupoId: detalle.grupos[0].id,
              motivoAjuste: 'e2e null',
            },
          ],
          recalcular: false,
        });
        expect(conManual.status).toBe(200);
        participanteId = (conManual.body as Detalle).participantes.find(
          (p) => p.garzonId === garzonId,
        )!.id;
      });

      it.each([
        ['incluido', true],
        ['monto', '0'],
      ] as const)(
        'participantes[].%s null → 400; con un valor válido → 200',
        async (campo, valido) => {
          const cambio = (v: unknown) => ({
            participantes: [{ id: participanteId, [campo]: v }],
            recalcular: false,
          });
          expect((await enviar('patch', ruta, cambio(null))).status).toBe(400);
          expect((await enviar('patch', ruta, cambio(valido))).status).toBe(
            200,
          );
        },
      );

      cadaCampoNull(
        'patch',
        () => ruta,
        () => ({ participantes: [], recalcular: false }),
        ['participantes', 'recalcular'],
      );
    });
  });

  describe("A' — el null llegaba a un array del service (TypeError, 500)", () => {
    describe('PATCH /grupos-modificadores/:id', () => {
      let ruta: string;
      let opciones: object[];
      beforeAll(async () => {
        const itemId = await crearProducto('Opción grupo null');
        opciones = [{ itemId, cantidad: '1', precioExtra: '0' }];
        const id = await crear(
          'grupos-modificadores',
          { nombre: `Grupo null ${sufijo}`, opciones },
          'grupoModificadorId',
        );
        ruta = `grupos-modificadores/${id}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => ({ nombre: `Grupo null ${sufijo}`, opciones }),
        ['nombre', 'opciones'],
      );
    });

    describe('PATCH /items/:id', () => {
      const base = { precioBase: '1000', monedaId: CLP_MONEDA_ID };
      const producto = {
        nombre: `Producto null ${sufijo}`,
        ...base,
        precioIncluyeImpuesto: true,
        activo: true,
        modoInventario: 'cantidad',
        unidadMedida: 'unidad',
        impuestosIds: [],
        recargosIds: [],
        descuentosIds: [],
        ingredientes: [],
        extrasPermitidos: [],
        componentes: [],
        gruposModificadores: [],
      };
      let rutaProducto: string;
      let rutaServicio: string;
      let rutaSuscripcion: string;
      beforeAll(async () => {
        rutaProducto = `items/${await crear('items', {
          nombre: producto.nombre,
          ...base,
          tipo: 'producto',
          unidadMedida: 'unidad',
        })}`;
        rutaServicio = `items/${await crear('items', {
          nombre: `Servicio null ${sufijo}`,
          ...base,
          tipo: 'servicio',
        })}`;
        rutaSuscripcion = `items/${await crear('items', {
          nombre: `Suscripción null ${sufijo}`,
          ...base,
          tipo: 'suscripcion',
          frecuencia: 'mensual',
        })}`;
      });

      cadaCampoNull(
        'patch',
        () => rutaProducto,
        () => producto,
        Object.keys(producto),
      );
      cadaCampoNull(
        'patch',
        () => rutaServicio,
        () => ({ requiereCita: false }),
        ['requiereCita'],
      );
      cadaCampoNull(
        'patch',
        () => rutaSuscripcion,
        () => ({ frecuencia: 'mensual' }),
        ['frecuencia'],
      );
    });
  });

  describe('B — el null se ignoraba (200 sin cambiar nada)', () => {
    describe('PATCH /cajones/:id', () => {
      const alta = { nombre: `Cajón null ${sufijo}`, activo: true };
      let ruta: string;
      beforeAll(async () => {
        ruta = `cajones/${await crear('cajones', { nombre: alta.nombre })}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );
    });
  });

  describe('C — un PUT: el null equivalía a omitir, y omitir escribe el default', () => {
    describe('PUT /tenants/preferencias-financieras', () => {
      // El PUT reemplaza la config entera: mandar la actual sin cambios no
      // mueve nada, y el control del 200 no deja estado sucio.
      let actuales: Record<string, unknown>;
      beforeAll(async () => {
        const res = await enviar('get', 'tenants/preferencias-financieras');
        expect(res.status).toBe(200);
        actuales = bodyPreferencias(res.body as object);
      });

      cadaCampoNull(
        'put',
        () => 'tenants/preferencias-financieras',
        () => actuales,
        ['promosAcumulanDescuentos'],
      );
    });

    // Igual que preferencias: se reenvía la config actual, así que el control
    // no la cambia. `habilitadoPos`/`habilitadoSalones` son de la forma A (van
    // a una columna NOT NULL); los del grupo, de la C.
    describe('PUT /propinas/distribucion', () => {
      let actual: Distribucion;
      beforeAll(async () => {
        const res = await enviar('get', 'propinas/distribucion');
        expect(res.status).toBe(200);
        const leida = res.body as Distribucion;
        actual = {
          porcentajeSugerido: leida.porcentajeSugerido,
          habilitadoPos: leida.habilitadoPos,
          habilitadoSalones: leida.habilitadoSalones,
          grupos: leida.grupos.map((g) => ({
            tipoGarzon: g.tipoGarzon,
            nombre: g.nombre,
            porcentaje: g.porcentaje,
            criterio: g.criterio,
            baseVentas: g.baseVentas,
            manualModo: g.manualModo,
            activo: g.activo,
            orden: g.orden,
            pesos: g.pesos,
          })),
        };
      });

      cadaCampoNull(
        'put',
        () => 'propinas/distribucion',
        () => ({ ...actual }),
        ['habilitadoPos', 'habilitadoSalones'],
      );

      it.each(['baseVentas', 'activo', 'orden', 'pesos'] as const)(
        'grupos[].%s null → 400; con su valor actual → 200',
        async (campo) => {
          const conGrupo = (v: unknown) => ({
            ...actual,
            grupos: actual.grupos.map((g, i) =>
              i === 0 ? { ...g, [campo]: v } : g,
            ),
          });
          const res = await enviar(
            'put',
            'propinas/distribucion',
            conGrupo(null),
          );
          expect(res.status).toBe(400);
          const control = await enviar(
            'put',
            'propinas/distribucion',
            conGrupo(actual.grupos[0][campo]),
          );
          expect(control.status).toBe(200);
        },
      );
    });
  });
});
