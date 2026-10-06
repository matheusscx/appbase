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
const PROV_CDMX = '550e8400-e29b-41d4-a716-446655440377';
const MODULO_PASARELAS = '550e8400-e29b-41d4-a716-446655440208';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_DESCUENTO_PRONTO_PAGO = '550e8400-e29b-41d4-a716-446655440100';
const TIPO_RECARGO_MORA = '550e8400-e29b-41d4-a716-446655440123';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };

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

  // El 400 tiene que nombrar el campo omitido como su propia causa. Un
  // `toContain` sobre el body no discrimina: "activo" está dentro de "grupos
  // activos", el mensaje de la suma, que también es un 400.
  function rechazaPor(res: { body: unknown }, ruta: string) {
    const { message } = res.body as { message: string | string[] };
    expect([message].flat()).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`^${ruta} `))]),
    );
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

  // Un PATCH de otro campo tiene que devolver la fila entera. Existe por un
  // bug que el arreglo introdujo y la revisión cazó: un campo redeclarado en
  // un Update que hereda de `PartialType` quedaba como propiedad propia en
  // `undefined` en cada instancia del DTO (target ES2023), y el
  // `Object.assign(entidad, dto)` del service lo copiaba a la respuesta, que
  // salía sin `activo` ni `nivel`. Por eso se redeclaran con `declare`.
  function conservaEnLaRespuesta(
    ruta: () => string,
    body: () => object,
    esperado: () => Record<string, unknown>,
    conToken: () => string = () => token,
  ) {
    it('un PATCH de otro campo devuelve los redeclarados con su valor', async () => {
      const res = await enviar('patch', ruta(), body(), conToken());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject(esperado());
    });
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

  // Omitir también es un 400 en estos campos (owner, 2026-10-04): el PUT
  // reemplaza el recurso entero, y omitir escribía el default con un 200 —un
  // grupo apagado que llegaba sin `activo` se volvía a prender—. Por eso cada
  // bloque prueba el null y la ausencia.
  describe('C — un PUT: el null equivalía a omitir, y omitir escribía el default', () => {
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

      it('promosAcumulanDescuentos omitido → 400; con su valor actual → 200', async () => {
        const { promosAcumulanDescuentos, ...sinCampo } = actuales;
        const res = await enviar(
          'put',
          'tenants/preferencias-financieras',
          sinCampo,
        );
        expect(res.status).toBe(400);
        rechazaPor(res, 'promosAcumulanDescuentos');
        const control = await enviar(
          'put',
          'tenants/preferencias-financieras',
          {
            ...sinCampo,
            promosAcumulanDescuentos,
          },
        );
        expect(control.status).toBe(200);
      });
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

      it.each(['baseVentas', 'activo', 'orden', 'pesos'] as const)(
        'grupos[].%s omitido → 400; con su valor actual → 200',
        async (campo) => {
          const sinCampo = {
            ...actual,
            grupos: actual.grupos.map((g, i) =>
              i === 0
                ? Object.fromEntries(
                    Object.entries(g).filter(([clave]) => clave !== campo),
                  )
                : g,
            ),
          };
          const res = await enviar('put', 'propinas/distribucion', sinCampo);
          expect(res.status).toBe(400);
          rechazaPor(res, `grupos\\.0\\.${campo}`);
          const control = await enviar('put', 'propinas/distribucion', actual);
          expect(control.status).toBe(200);
        },
      );

      // Estos dos no entraron en la decisión del 2026-10-04: omitirlos sigue
      // conservando lo guardado. Se guardan primero en `false` (el default es
      // `true`): con lo del seed, conservar y escribir el default darían lo
      // mismo y el test no vería la diferencia.
      it('habilitadoPos y habilitadoSalones omitidos → 200 y conservan lo guardado', async () => {
        const sinFlags = {
          porcentajeSugerido: actual.porcentajeSugerido,
          grupos: actual.grupos,
        };
        try {
          const apagar = await enviar('put', 'propinas/distribucion', {
            ...actual,
            habilitadoPos: false,
            habilitadoSalones: false,
          });
          expect(apagar.status).toBe(200);
          const res = await enviar('put', 'propinas/distribucion', sinFlags);
          expect(res.status).toBe(200);
          expect(res.body).toMatchObject({
            habilitadoPos: false,
            habilitadoSalones: false,
          });
        } finally {
          const restaurar = await enviar(
            'put',
            'propinas/distribucion',
            actual,
          );
          expect(restaurar.status).toBe(200);
        }
      });
    });
  });

  // `ui` es un JSON que se mezcla con lo guardado y después se normaliza: un
  // `null` pasaba `@IsOptional()`, pisaba la clave en el merge y la
  // normalización lo cambiaba por el default (`light` / `15`). Un 200 con la
  // preferencia reseteada. Omitir la clave sigue sin tocar lo guardado.
  describe('D — PATCH /me/preferencias: el null se guardaba como default', () => {
    const validos = { colorMode: 'dark', pageSize: 25 } as const;
    let originales: Record<string, unknown>;
    beforeAll(async () => {
      // Un PATCH sin `ui` no cambia nada y devuelve lo guardado.
      const res = await enviar('patch', 'me/preferencias', {});
      expect(res.status).toBe(200);
      originales = (res.body as { ui: Record<string, unknown> }).ui;
    });
    afterAll(async () => {
      const res = await enviar('patch', 'me/preferencias', { ui: originales });
      expect(res.status).toBe(200);
    });

    it.each(Object.keys(validos))(
      'ui.%s null → 400; con un valor válido → 200',
      async (campo) => {
        const res = await enviar('patch', 'me/preferencias', {
          ui: { [campo]: null },
        });
        expect(res.status).toBe(400);
        const control = await enviar('patch', 'me/preferencias', {
          ui: { [campo]: validos[campo as keyof typeof validos] },
        });
        expect(control.status).toBe(200);
      },
    );

    it('omitir una clave de ui no toca lo guardado', async () => {
      const guardar = await enviar('patch', 'me/preferencias', {
        ui: validos,
      });
      expect(guardar.status).toBe(200);
      const res = await enviar('patch', 'me/preferencias', {
        ui: { colorMode: 'light' },
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ui: { colorMode: 'light', pageSize: 25 } });
    });

    // `ui` entero en `null` no llegaba a pisar nada —el spread del merge
    // ignora un `null`— pero `@IsOptional()` lo dejaba pasar como ausente: un
    // 200 que no había hecho lo que se le mandó.
    it('ui null → 400 y no toca lo guardado; sin ui → 200 sin cambios', async () => {
      const guardar = await enviar('patch', 'me/preferencias', {
        ui: validos,
      });
      expect(guardar.status).toBe(200);
      const res = await enviar('patch', 'me/preferencias', { ui: null });
      expect(res.status).toBe(400);
      expect((res.body as { message: string[] }).message).toContain(
        'nested property ui must be either object or array',
      );
      const sinUi = await enviar('patch', 'me/preferencias', {});
      expect(sinUi.status).toBe(200);
      expect(sinUi.body).toEqual({ ui: validos });
    });

    // No es un `null`, pero es el mismo 200 mintiendo: `@ValidateNested()`
    // acepta un array y valida cada elemento, el spread del merge mete la
    // clave "0" y la normalización la descarta. `[{ colorMode: 'light' }]`
    // pedía un cambio y dejaba `dark` guardado.
    it.each([[[]], [[{ colorMode: 'light' }]]])(
      'ui %j → 400 y no toca lo guardado',
      async (ui) => {
        const guardar = await enviar('patch', 'me/preferencias', {
          ui: validos,
        });
        expect(guardar.status).toBe(200);
        const res = await enviar('patch', 'me/preferencias', { ui });
        expect(res.status).toBe(400);
        rechazaPor(res, 'ui');
        const sinUi = await enviar('patch', 'me/preferencias', {});
        expect(sinUi.status).toBe(200);
        expect(sinUi.body).toEqual({ ui: validos });
      },
    );
  });

  describe('PartialType — heredaba @IsOptional en todos los campos', () => {
    describe('PATCH /roles/:id', () => {
      const alta = { nombre: `Rol null ${sufijo}` };
      let ruta: string;
      beforeAll(async () => {
        ruta = `roles/${await crear('roles', alta)}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        Object.keys(alta),
      );

      // `descripcion` es nullable: el `@IsOptional` propio de `CreateRolDto`
      // tiene que sobrevivir, y `null` la borra.
      it('descripcion null → 200 (nullable: null la borra)', async () => {
        const res = await enviar('patch', ruta, { descripcion: null });
        expect(res.status).toBe(200);
      });
    });

    describe('PATCH /descuentos/:id', () => {
      const alta = {
        nombre: `Descuento null ${sufijo}`,
        tipoReglaId: TIPO_DESCUENTO_DIRECTO,
        modo: 'porcentaje',
        nivel: 'linea',
        activo: false,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `descuentos/${await crear('descuentos', {
          ...alta,
          valorPorcentaje: '0.05',
        })}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => ({ ...alta, metodoPagoIds: [TARJETA_CREDITO_ID], tramos: [] }),
        [...Object.keys(alta), 'metodoPagoIds', 'tramos'],
      );
      conservaEnLaRespuesta(
        () => ruta,
        () => ({ nombre: alta.nombre }),
        () => ({ modo: alta.modo, nivel: alta.nivel, activo: alta.activo }),
      );
    });

    // `diasVencimiento` es de los tipos con días: en el directo no aplica. En
    // pronto pago el `null` ya daba 400 antes del DTO, de casualidad: el
    // service compara `null <= 0`, que en JS es `true`. El caso no mata al
    // mutante del DTO; queda para que el 400 no dependa de esa coerción.
    describe('PATCH /descuentos/:id (pronto pago)', () => {
      const alta = { diasVencimiento: 10 };
      let ruta: string;
      beforeAll(async () => {
        ruta = `descuentos/${await crear('descuentos', {
          nombre: `Pronto pago null ${sufijo}`,
          tipoReglaId: TIPO_DESCUENTO_PRONTO_PAGO,
          valorPorcentaje: '0.02',
          activo: false,
          ...alta,
        })}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        ['diasVencimiento'],
      );
    });

    describe('PATCH /recargos/:id', () => {
      const alta = {
        nombre: `Recargo null ${sufijo}`,
        tipoReglaId: TIPO_RECARGO_MORA,
        modo: 'porcentaje',
        nivel: 'venta',
        diasVencimiento: 30,
        activo: false,
      };
      let ruta: string;
      beforeAll(async () => {
        ruta = `recargos/${await crear('recargos', {
          ...alta,
          valorPorcentaje: '0.02',
        })}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => ({ ...alta, metodoPagoIds: [TARJETA_CREDITO_ID], tramos: [] }),
        [...Object.keys(alta), 'metodoPagoIds', 'tramos'],
      );
      conservaEnLaRespuesta(
        () => ruta,
        () => ({ nombre: alta.nombre }),
        () => ({
          modo: alta.modo,
          nivel: alta.nivel,
          activo: alta.activo,
          diasVencimiento: alta.diasVencimiento,
        }),
      );
    });

    describe('PATCH /promociones/:id', () => {
      let alta: Record<string, unknown>;
      let ruta: string;
      beforeAll(async () => {
        const categoriaId = await crear('categorias', {
          nombre: `Categoría promo null ${sufijo}`,
        });
        alta = {
          nombre: `Promo null ${sufijo}`,
          tipo: 'porcentaje',
          activo: false,
          fechaInicio: '2026-01-01',
          fechaFin: '2026-12-31',
          scopes: [{ tipoScope: 'categoria', categoriaId }],
        };
        ruta = `promociones/${await crear('promociones', {
          ...alta,
          valorPorcentaje: '0.10',
        })}`;
      });

      cadaCampoNull(
        'patch',
        () => ruta,
        () => alta,
        ['nombre', 'tipo', 'activo', 'fechaInicio', 'fechaFin', 'scopes'],
      );
      conservaEnLaRespuesta(
        () => ruta,
        () => ({ nombre: alta.nombre }),
        () => ({ activo: alta.activo }),
      );
    });

    // Un tenant propio, dado de alta por el superadmin: el PATCH de tenants es
    // de superadmin, y la pasarela y la razón social de Demo Restaurante las
    // usan otras suites.
    describe('tenant nuevo: PATCH /admin/tenants/:id, pasarela y razón social', () => {
      const tenant = {
        nombre: `Tenant null ${sufijo}`,
        correo: `null-${sufijo}@e2e.test`,
        provinciaId: PROV_CDMX,
      };
      const pasarela = {
        ambiente: 'pruebas',
        modoIntegracion: 'individual',
        activo: false,
        prioridad: 1,
      };
      const razon = {
        nombre: `Razón null ${sufijo}`,
        rut: `NULL${sufijo}`,
        habilitado: true,
      };
      let tokenSuper: string;
      let tokenTenant: string;
      let tenantId: string;
      let pasarelaId: string;
      let razonId: string;
      beforeAll(async () => {
        tokenSuper = await entrar(SUPERADMIN.email, SUPERADMIN.pass);
        tenantId = await crear('admin/tenants', tenant, 'id', tokenSuper);
        const contratar = await enviar(
          'post',
          `admin/tenants/${tenantId}/modules`,
          { moduloAppId: MODULO_PASARELAS },
          tokenSuper,
        );
        expect(contratar.status).toBe(201);
        tokenTenant = await entrar(SUPERADMIN.email, SUPERADMIN.pass, tenantId);
        const catalogo = await enviar(
          'get',
          'pasarela/admin/pasarelas-disponibles',
          undefined,
          tokenTenant,
        );
        expect(catalogo.status).toBe(200);
        const demo = (
          catalogo.body as { pasarelaId: string; codigo: string }[]
        ).find((p) => p.codigo === 'demo')!;
        pasarelaId = await crear(
          'pasarela/admin/config',
          { pasarelaId: demo.pasarelaId, ...pasarela },
          'tenantPasarelaId',
          tokenTenant,
        );
        razonId = await crear(
          'tenants/razones-sociales',
          razon,
          'id',
          tokenTenant,
        );
      });

      cadaCampoNull(
        'patch',
        () => `admin/tenants/${tenantId}`,
        () => tenant,
        Object.keys(tenant),
        () => tokenSuper,
      );
      cadaCampoNull(
        'patch',
        () => `pasarela/admin/config/${pasarelaId}`,
        () => pasarela,
        Object.keys(pasarela),
        () => tokenTenant,
      );
      cadaCampoNull(
        'patch',
        () => `tenants/razones-sociales/${razonId}`,
        () => razon,
        Object.keys(razon),
        () => tokenTenant,
      );
      conservaEnLaRespuesta(
        () => `pasarela/admin/config/${pasarelaId}`,
        () => ({ ambiente: pasarela.ambiente }),
        () => ({ activo: pasarela.activo, prioridad: pasarela.prioridad }),
        () => tokenTenant,
      );
      conservaEnLaRespuesta(
        () => `tenants/razones-sociales/${razonId}`,
        () => ({ nombre: razon.nombre }),
        () => ({ habilitado: razon.habilitado }),
        () => tokenTenant,
      );
    });
  });
});
