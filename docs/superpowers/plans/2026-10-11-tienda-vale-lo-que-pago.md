# Plan: la venta online vale lo que se pagó

**Status**: Draft · **Date**: 2026-10-11 · **Owner**: Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `POST /online/pagar` congele en la orden el resultado del motor, y que el callback de
Webpay cree la venta con eso, sin recalcular.

**Architecture:** `pagar` convierte los precios (como ya lo hace la venta) y se los pasa al motor por
el canal interno. Guarda en `metadata.checkout.congelado` el `ResultadoVenta` y, por línea, origen,
moneda, tasa y clasificación. `VentasService.crearEnTransaccion` gana un parámetro interno,
`ventaCongelada`: cuando viene, no carga config, no convierte y no llama a `calcular`.
`OnlineCallbackHandler` lo pasa por `crear`.

**Tech Stack:** NestJS + TypeORM + Postgres, Decimal.js, Jest (unit) y Jest + supertest (e2e de API).

**Spec:** [`docs/superpowers/specs/2026-10-11-tienda-vale-lo-que-pago-design.md`](../specs/2026-10-11-tienda-vale-lo-que-pago-design.md)

## Context

Entrada de [`pendientes.md`](../../agent/pendientes.md) § 3, *"La tienda calcula el total dos
veces, con dos 'ahora'…"*, opción **A** (owner, 2026-10-09). La medición del 2026-10-09
([`tienda-dos-ahoras.e2e-spec.ts`](../../../backend/test/tienda-dos-ahoras.e2e-spec.ts)) deja 6 de 7
casos sin venta. D y E están hechas (`63628bef`). El porqué de cada decisión está en la spec: leerla
antes de empezar.

## Global Constraints

- **Frente de motor y fiscal: va solo, con el sistema quieto** (`CLAUDE.md`). No se escribe código
  de `backend/src/` hasta el OK de la orquestadora (Tarea 0).
- Dinero con Decimal.js; nada de `number` para montos. Porcentajes en decimal.
- `ventaCongelada` es un **canal interno**: nunca entra en un DTO ni en un body.
- No se agrega ninguna consulta por línea (N+1). `pagar` suma lecturas **por carrito**, no por línea.
- Sin fallback a recalcular en el callback: una orden sin `congelado` falla y queda sin venta, con
  el aviso de D.
- No se toca `CobrosService.verificar`, la rama demo de `pagar`, ni el "ligar la orden a una venta".
- El pre-commit exige el recibo de `verify-feature` sobre lo staged. **Nunca `--no-verify`.**
- Suites pesadas (`npm run test:e2e` entero, Playwright entero): **turno de la orquestadora por
  SendMessage**, y avisar al terminar.
- Escribir en español: código, comentarios, commits y mensajes.

## Review Focus

1. **Receta o combo vendidos online.** La personalización se sigue resolviendo viva, porque decide
   el stock, pero el precio persistido es el congelado y no `precioBase + extras`. Lo prueba la
   Tarea 1, test "receta".
2. **El UUID del carrito en mayúsculas.** El snapshot guarda el `itemId` del body, y el resultado
   guarda el canónico. El chequeo de coherencia no distingue mayúsculas. Lo prueba la Tarea 1, test
   "mayúsculas".
3. **Cantidad escrita distinto** (`'1'` contra `'1.0000'`): coherente por Decimal, no por string. Lo
   prueba la Tarea 1, test "cantidad".
4. **El reintento por deadlock** vuelve a correr la transacción con el mismo congelado, y tampoco
   llama al motor. Lo prueba la Tarea 1, test "deadlock".
5. **Dos líneas del mismo ítem** con precios congelados distintos: el cruce es por posición, nunca
   por `itemId`. Lo prueba la Tarea 1, test "dos líneas".

---

### Tarea 0: precondición — sistema quieto

- [ ] **Paso 1:** confirmar por SendMessage con la orquestadora que la sesión "Tienda: verificar
  marca la orden pagada sin venta" ya se integró a `main`. **No seguir sin ese OK.**
- [ ] **Paso 2:** traer `main` al worktree con la herramienta `sync_with_base_branch` (ccd_host).
  Resolver conflictos si los hay.
- [ ] **Paso 3:** levantar el entorno base y correr la línea de base:

```bash
./scripts/entorno.sh db
cd backend && npm test -- --testPathPattern='online|ventas.service' 2>&1 | tail -5
```

Expected: verde. Si no lo está, parar y reportar: no es de este frente.

---

### Tarea 1: `VentasService` acepta una venta congelada

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts`: el tipo nuevo (junto a `LineaCongelada`,
  ~:392), `crear` (~:530), `crearConReintento`, `crearEnTransaccion` (~:602, parámetros ~:622, paso 2b
  ~:760, `configCalculo` ~:928, `lineasConversion` ~:933, `calcular` ~:1023, detalles ~:1099).
- Test: `backend/src/modules/ventas/ventas.service.spec.ts`: un `describe` nuevo después de
  `describe('crear() — canal online')` (~:2777) y un test en `reintento ante deadlock (40P01)`
  (~:710).

**Interfaces:**
- Produce (lo usan las Tareas 2 y 3):

```ts
// ventas.service.ts
import type { ResultadoVenta } from '../calculo-precios/calculo-precios.engine';

export interface VentaCongelada {
  resultado: ResultadoVenta;
  lineas: LineaVentaCongelada[];
}
export interface LineaVentaCongelada {
  precioUnitarioOrigen: string;
  monedaIdOrigen: string;
  tasaCambio: string;
  clasificacionTributaria: string | null;
}

crear(tenantId: string, usuarioId: string, dto: CreateVentaDto, clave?: string, ventaCongelada?: VentaCongelada)
crearEnTransaccion(manager, tenantId, usuarioId, dto, cuentaId?, lineasCongeladas?, ventaCongelada?)
```

- [ ] **Paso 1: escribir los tests que fallan.** Agregar este `describe` en `ventas.service.spec.ts`,
  después del de `crear() — canal online`. Si `VentaCongelada` no está importado, agregarlo al
  import de `./ventas.service`.

```ts
  /**
   * "Vale lo que pagó" (pendientes.md § 3, A): la tienda congela en la orden lo
   * que autorizó en Webpay, y la venta se crea con eso sin volver al motor.
   */
  describe('crear() — venta online congelada', () => {
    const resultadoCongelado = {
      ...mockResultadoVenta,
      lineas: [
        {
          ...mockResultadoVenta.lineas[0],
          precioUnitario: '9500.0000',
          subtotalNeto: '9500.0000',
          impuestoAplicado: '1805.0000',
          totalLinea: '11305.0000',
        },
      ],
      totales: {
        ...mockResultadoVenta.totales,
        subtotalNeto: '9500.0000',
        totalImpuestos: '1805.0000',
        totalFinal: '11305.0000',
      },
    };
    const congelada: VentaCongelada = {
      resultado: resultadoCongelado,
      lineas: [
        {
          precioUnitarioOrigen: '10.0000',
          monedaIdOrigen: 'moneda-extranjera',
          tasaCambio: '950.000000',
          clasificacionTributaria: 'exento',
        },
      ],
    };
    const dtoOnline = {
      canal: 'online' as const,
      lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '11305.0000' }],
    };

    const conManager = () => {
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );
      return manager;
    };
    const detallesGuardados = (manager: ReturnType<typeof buildManagerMock>) =>
      manager.save.mock.calls.find(([e]) => e === VentaDetalle)?.[1] as Record<
        string,
        unknown
      >[];

    it('no vuelve al motor: ni config ni conversión ni calcular', async () => {
      conManager();
      await service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, congelada);

      expect(calculoPreciosService.calcular).not.toHaveBeenCalled();
      expect(calculoPreciosService.cargarConfig).not.toHaveBeenCalled();
      expect(calculoPreciosService.convertirAMonedaOficial).not.toHaveBeenCalled();
    });

    it('persiste lo congelado: precio, origen, moneda, tasa, clasificación y totales', async () => {
      const manager = conManager();
      const venta = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoOnline,
        undefined,
        congelada,
      );

      expect(detallesGuardados(manager)).toEqual([
        expect.objectContaining({
          precioUnitario: '9500.0000',
          precioUnitarioOrigen: '10.0000',
          monedaIdOrigen: 'moneda-extranjera',
          tasaCambio: '950.000000',
          clasificacionTributaria: 'exento',
          impuestoAplicado: '1805.0000',
          totalLinea: '11305.0000',
        }),
      ]);
      expect(venta.totalFinal).toBe('11305.0000');
      expect(venta.configCalculo).toEqual(resultadoCongelado.config);
    });

    it('rechaza antes de escribir si el ítem congelado no es el de la línea', async () => {
      const manager = conManager();
      const otra: VentaCongelada = {
        ...congelada,
        resultado: {
          ...resultadoCongelado,
          lineas: [{ ...resultadoCongelado.lineas[0], itemId: 'otro-item' }],
        },
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, otra),
      ).rejects.toThrow('La venta congelada no corresponde a las líneas de la venta');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('cantidad: rechaza si difiere, y la compara como número (1 = 1.0000)', async () => {
      conManager();
      const mismaCantidad: VentaCongelada = {
        ...congelada,
        resultado: {
          ...resultadoCongelado,
          lineas: [{ ...resultadoCongelado.lineas[0], cantidad: '1.0000' }],
        },
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, mismaCantidad),
      ).resolves.toBeDefined();

      const manager = conManager();
      const otraCantidad: VentaCongelada = {
        ...congelada,
        resultado: {
          ...resultadoCongelado,
          lineas: [{ ...resultadoCongelado.lineas[0], cantidad: '2' }],
        },
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, otraCantidad),
      ).rejects.toThrow('La venta congelada no corresponde a las líneas de la venta');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rechaza si la cantidad de líneas congeladas no es la del carrito', async () => {
      const manager = conManager();
      const sinLinea: VentaCongelada = { ...congelada, lineas: [] };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, sinLinea),
      ).rejects.toThrow('La venta congelada no corresponde a las líneas de la venta');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('mayúsculas: el UUID del carrito en mayúsculas es el mismo ítem', async () => {
      conManager();
      const dtoMayusculas = {
        ...dtoOnline,
        lineas: [{ itemId: ITEM_ID.toUpperCase(), cantidad: '1' }],
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoMayusculas, undefined, congelada),
      ).resolves.toBeDefined();
    });

    it('dos líneas del mismo ítem: cada detalle lleva SU precio congelado, por posición', async () => {
      const manager = conManager();
      const linea = resultadoCongelado.lineas[0];
      const dosLineas: VentaCongelada = {
        resultado: {
          ...resultadoCongelado,
          lineas: [
            { ...linea, precioUnitario: '9500.0000', totalLinea: '9500.0000' },
            { ...linea, precioUnitario: '1805.0000', totalLinea: '1805.0000' },
          ],
        },
        lineas: [
          { ...congelada.lineas[0], precioUnitarioOrigen: '10.0000' },
          { ...congelada.lineas[0], precioUnitarioOrigen: '1.9000' },
        ],
      };
      await service.crear(
        TENANT_ID,
        USUARIO_ID,
        {
          ...dtoOnline,
          lineas: [
            { itemId: ITEM_ID, cantidad: '1' },
            { itemId: ITEM_ID, cantidad: '1' },
          ],
        },
        undefined,
        dosLineas,
      );

      expect(
        detallesGuardados(manager).map((d) => [
          d.precioUnitario,
          d.precioUnitarioOrigen,
        ]),
      ).toEqual([
        ['9500.0000', '10.0000'],
        ['1805.0000', '1.9000'],
      ]);
    });

    it('receta: la personalización se resuelve viva (stock) pero el precio es el congelado', async () => {
      const manager = conManager();
      itemsService.cargarBasePorIds.mockImplementationOnce(
        mapaDe({ ...mockItem, tipo: 'receta' }),
      );
      const snapshot = { omitidos: [], extras: [] };
      (itemsService.resolverPersonalizacionReceta as jest.Mock).mockResolvedValueOnce({
        snapshot,
        precioExtraTotal: '500.0000',
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoOnline, undefined, congelada);

      expect(detallesGuardados(manager)).toEqual([
        expect.objectContaining({
          precioUnitario: '9500.0000',
          precioUnitarioOrigen: '10.0000',
          personalizacion: snapshot,
        }),
      ]);
      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ snapshot }),
      );
    });
  });
```

  Y dentro de `describe('reintento ante deadlock (40P01)')`, después del primer `it`:

```ts
      it('deadlock: el reintento usa el mismo congelado y tampoco llama al motor', async () => {
        const manager = buildManagerMock();
        dataSourceMock.transaction
          .mockRejectedValueOnce(deadlock)
          .mockImplementationOnce((cb: (m: unknown) => unknown) => cb(manager));
        const congelada = {
          resultado: mockResultadoVenta,
          lineas: [
            {
              precioUnitarioOrigen: '100.0000',
              monedaIdOrigen: MONEDA_OFICIAL_ID,
              tasaCambio: '1.000000',
              clasificacionTributaria: 'afecto',
            },
          ],
        };

        await service.crear(
          TENANT_ID,
          USUARIO_ID,
          { ...baseDto, canal: 'online' as const },
          undefined,
          congelada,
        );

        expect(dataSourceMock.transaction).toHaveBeenCalledTimes(2);
        expect(calculoPreciosService.calcular).not.toHaveBeenCalled();
      });
```

- [ ] **Paso 2: correr y ver que fallan.**

Run: `cd backend && npx jest src/modules/ventas/ventas.service.spec.ts -t 'congelad'`
Expected: FAIL. Primero por tipo (`VentaCongelada` no existe); con el tipo agregado, porque
`calcular` sí se llama y los detalles llevan los precios del catálogo.

- [ ] **Paso 3: implementar.** En `ventas.service.ts`:

  (a) Junto a `LineaCongelada`, el tipo y su import (`import type { ResultadoVenta } from
  '../calculo-precios/calculo-precios.engine';`):

```ts
/**
 * Lo que la tienda cobró, congelado en la orden al pagar (pendientes.md § 3, A:
 * "vale lo que pagó"). Ver el parámetro `ventaCongelada` de `crearEnTransaccion`.
 * Canal **interno**, nunca un campo de DTO: lleva plata ya resuelta.
 */
export interface VentaCongelada {
  /** El resultado del motor tal como se autorizó en Webpay. */
  resultado: ResultadoVenta;
  /** 1:1 con `resultado.lineas` y con `dto.lineas`, en el mismo orden. */
  lineas: LineaVentaCongelada[];
}

/** Lo que `venta_detalles` guarda de la línea y el motor no devuelve. */
export interface LineaVentaCongelada {
  /** En la moneda del ítem; con `tasaCambio` da `resultado.lineas[i].precioUnitario`. */
  precioUnitarioOrigen: string;
  monedaIdOrigen: string;
  tasaCambio: string;
  /** La que decidió el IVA cobrado. */
  clasificacionTributaria: string | null;
}
```

  (b) `crear` y `crearConReintento` reciben `ventaCongelada?: VentaCongelada` al final y lo pasan:
  `this.crearConReintento(tenantId, usuarioId, dto, clave, ventaCongelada)`, y en el loop
  `this.crearEnTransaccion(manager, tenantId, usuarioId, dto, undefined, undefined, ventaCongelada)`.
  En el docblock de `crear`, al lado del de `clave`:

```ts
    /**
     * Lo que la tienda cobró, congelado al pagar: con esto la venta no vuelve
     * al motor. Solo `OnlineCallbackHandler` lo pasa. Ver `crearEnTransaccion`.
     */
    ventaCongelada?: VentaCongelada,
```

  (c) `crearEnTransaccion`: parámetro nuevo después de `lineasCongeladas`:

```ts
    /**
     * **Lo que la tienda cobró, congelado en la orden al pagar** (pendientes.md
     * § 3, A: "vale lo que pagó"). Cuando viene, esta venta **no vuelve al
     * motor**: no carga la config, no convierte y no llama a `calcular`. El
     * resultado, los impuestos, las reglas y las promos son los que se
     * autorizaron en Webpay. Recalcular al retorno era lo que dejaba el cargo
     * sin venta cuando algo cambiaba en el medio: la hora, el precio, la tasa.
     *
     * Sigue vivo lo que no es plata: que el ítem exista, el stock, la caja
     * virtual, el umbral de identidad. Por eso un ítem borrado entre el pago y
     * el retorno sigue dejando la orden sin venta, con su aviso.
     *
     * Mismo régimen que `lineasCongeladas`: parámetro y no DTO, porque lleva
     * plata. Solo `OnlineCallbackHandler` lo pasa (vía `crear`).
     */
    ventaCongelada?: VentaCongelada,
```

  (d) Después del bloque `2b` (unidades con número de serie) y antes del paso 3 (moneda oficial):

```ts
    // 2c. Lo congelado tiene que ser ESTE carrito, línea por línea y en orden:
    //     los detalles se cruzan por posición. No calzar es un error del
    //     servidor —el snapshot lo armó `pagar`—, así que se corta antes de
    //     escribir nada. El ítem sin distinguir mayúsculas (el carrito trae el
    //     UUID como lo escribió el cliente) y la cantidad como número.
    if (ventaCongelada) {
      const { resultado: r, lineas: lc } = ventaCongelada;
      const calza =
        r.lineas.length === dto.lineas.length &&
        lc.length === dto.lineas.length &&
        r.lineas.every(
          (rl, i) =>
            rl.itemId.toLowerCase() === items[i].id.toLowerCase() &&
            new Decimal(rl.cantidad).equals(
              cantidadesResueltas[i].cantidadCanonica,
            ),
        );
      if (!calza) {
        throw new Error(
          'La venta congelada no corresponde a las líneas de la venta',
        );
      }
    }
```

  (e) `configCalculo`: con congelado no se carga, porque solo sirve para convertir:

```ts
    const configCalculo =
      ventaCongelada?.resultado.config ??
      (await this.calculoPreciosService.cargarConfig(
        tenantId,
        Number(monedaOficial.decimales),
      ));
```

  (f) En `lineasConversion`, al principio de la función de la línea:
  `const congelada = ventaCongelada?.lineas[i];`. Lo congelado de la tienda gana sobre el de salón y
  sobre el catálogo:

```ts
      const precioOrigen =
        congelada?.precioUnitarioOrigen ??
        lineasCongeladas?.[i]?.precioUnitarioOrigen ??
        (pers != null
          ? new Decimal(item.precioBase).plus(pers.precioExtraTotal).toFixed(4)
          : item.precioBase);
      const precioConvertido =
        ventaCongelada?.resultado.lineas[i].precioUnitario ??
        lineasCongeladas?.[i]?.precioUnitario ??
        this.calculoPreciosService.convertirAMonedaOficial(
          precioOrigen,
          item.monedaId,
          tasaMap,
          configCalculo.modoRedondeo,
        );
```

  y en el objeto que devuelve, `tasa: congelada?.tasaCambio ?? lineasCongeladas?.[i]?.tasaCambio ??
  tasa.toFixed(6)`, más dos campos nuevos:

```ts
        // De lo cobrado, no del catálogo del retorno: la moneda con la que se
        // leen origen y tasa, y la clasificación que decidió el IVA cobrado.
        monedaIdOrigen: congelada?.monedaIdOrigen ?? item.monedaId,
        clasificacionTributaria:
          congelada?.clasificacionTributaria ?? item.clasificacionTributaria,
```

  (g) El cálculo:

```ts
    // 5. Calcular importes (sin persistencia). Con lo cobrado congelado no se
    //    recalcula: el total es el que se autorizó.
    const resultado =
      ventaCongelada?.resultado ??
      (await this.calculoPreciosService.calcular(
        tenantId,
        calcularDto,
        configCalculo,
      ));
```

  (h) En el `manager.create(VentaDetalle, …)` del paso 7b, desestructurar `monedaIdOrigen` y
  `clasificacionTributaria` de `lineasConversion[i]` y usar
  `monedaIdOrigen: monedaIdOrigen` (en lugar de `item.monedaId`) y
  `clasificacionTributaria: clasificacionTributaria!` (en lugar de `item.clasificacionTributaria!`).
  Conservar el comentario del non-null, que sigue valiendo: el guard del paso 2 rechaza los ítems
  sin clasificación.

  (i) Actualizar el docblock de precondición de `crear` (*"los únicos llamadores son…"*): el
  callback ahora pasa también el congelado.

- [ ] **Paso 4: correr y ver que pasan.**

Run: `cd backend && npx jest src/modules/ventas/ventas.service.spec.ts`
Expected: PASS el archivo entero (los tests viejos no pasan `ventaCongelada` y no cambian).

- [ ] **Paso 5: el mutante.** Revertir solo (g) a `await this.calculoPreciosService.calcular(...)`
  y correr `-t 'congelad'`. Tienen que caer "no vuelve al motor" y "persiste lo congelado". Revertir
  solo (d) y comprobar que caen los tres tests de "rechaza". Restaurar el código y volver a correr
  el archivo entero.

- [ ] **Paso 6: typecheck y lint.**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.

- [ ] **Paso 7: stagear** (`git add` por ruta). El commit va al final, con el recibo
  (Tarea 5).

---

### Tarea 2: `pagar` congela lo que autoriza

**Files:**
- Modify: `backend/src/modules/online/online.service.ts`: `CheckoutSnapshot` (~:39),
  constructor, `pagar` (~:107, rama Webpay), `prepararLineasCheckout` (~:241).
- Modify: `backend/src/modules/online/online.module.ts`: importar `MonedasModule`.
- Test: `backend/src/modules/online/online.service.spec.ts`.

**Interfaces:**
- Consume: `VentaCongelada` y `LineaVentaCongelada` de `../ventas/ventas.service` (Tarea 1);
  `CalculoPreciosService.cargarConfig(tenantId, decimales)`,
  `CalculoPreciosService.convertirAMonedaOficial(precio, monedaId, tasaMap, modo)`,
  `MonedasService.decimalesOficiales(tenantId)` y `MonedasService.findMonedas(tenantId)` (devuelve
  `{ monedaId, valorDelDia }[]`, con la oficial en `'1'`).
- Produce (lo usa la Tarea 3): `CheckoutSnapshot.checkout.congelado: VentaCongelada`.

- [ ] **Paso 1: tests que fallan.** En `online.service.spec.ts`:
  - Agregar al mock `calculo` `cargarConfig: jest.fn().mockResolvedValue({ modoRedondeo: 'HALF_UP' })`
    y `convertirAMonedaOficial: jest.fn((p: string, _m: string, t: Map<string, string>) =>
    new Decimal(p).times(t.get(_m) ?? '1').toFixed(4))` (importar `Decimal`).
  - Un mock `monedas = { decimalesOficiales: jest.fn().mockResolvedValue(0), findMonedas:
    jest.fn().mockResolvedValue([{ monedaId: 'clp', valorDelDia: '1' }, { monedaId: 'usd',
    valorDelDia: '950.000000' }]) }`, registrado como `{ provide: MonedasService, useValue: monedas }`.
  - `itemBase` gana `precioBase: '10.0000', monedaId: 'usd', clasificacionTributaria: 'afecto'`.
  - Test nuevo:

```ts
  it('pagar con Webpay: congela en la orden el resultado autorizado y lo que la venta necesita de cada línea', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({ ordenId: 'o', urlWebpay: 'u' });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

    // El motor recibe el precio ya convertido, por el canal interno, y la
    // config con la que se convirtió.
    expect(calculo.calcular).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        lineas: [
          expect.objectContaining({
            precioUnitarioResuelto: '9500.0000',
            precioUnitarioOrigenResuelto: '10.0000',
          }),
        ],
      }),
      { modoRedondeo: 'HALF_UP' },
    );
    const opts = pagosRedirect.iniciar.mock.calls[0][2] as {
      metadataExtra: { checkout: { congelado: unknown } };
    };
    expect(opts.metadataExtra.checkout.congelado).toEqual({
      resultado: mockResultado,
      lineas: [
        {
          precioUnitarioOrigen: '10.0000',
          monedaIdOrigen: 'usd',
          tasaCambio: '950.000000',
          clasificacionTributaria: 'afecto',
        },
      ],
    });
  });

  it('pagar: las tasas y la config se leen una vez por carrito, no por línea', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([]);
    pagosRedirect.iniciar.mockResolvedValue({ ordenId: 'o', urlWebpay: 'u' });
    const tres = {
      lineas: [
        { itemId: '550e8400-e29b-41d4-a716-446655440116', cantidad: '1' },
        { itemId: '550e8400-e29b-41d4-a716-446655440117', cantidad: '1' },
        { itemId: '550e8400-e29b-41d4-a716-446655440118', cantidad: '1' },
      ],
    };
    calculo.calcular.mockResolvedValueOnce({
      ...mockResultado,
      lineas: tres.lineas.map((l) => ({ ...mockResultado.lineas[0], itemId: l.itemId })),
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', tres);

    expect(monedas.findMonedas).toHaveBeenCalledTimes(1);
    expect(monedas.decimalesOficiales).toHaveBeenCalledTimes(1);
    expect(calculo.cargarConfig).toHaveBeenCalledTimes(1);
  });
```

  - Revisar los tests de `pagar` que afirman `calcular` con `toHaveBeenCalledWith(TENANT_ID,
    expect.objectContaining(...))` de dos argumentos: ahora hay un tercero (la config). Agregarles
    `expect.anything()` como tercer argumento. Los de `checkout` y de la rama demo no cambian.

- [ ] **Paso 2: correr y ver que fallan.**

Run: `cd backend && npx jest src/modules/online/online.service.spec.ts`
Expected: FAIL. `MonedasService` no se inyecta y `congelado` es `undefined`.

- [ ] **Paso 3: implementar.**

  (a) `CheckoutSnapshot.checkout` gana:

```ts
    /**
     * Lo que se autorizó en Webpay, resuelto por el servidor (pendientes.md § 3,
     * A: "vale lo que pagó"). El callback crea la venta con esto, sin volver al
     * motor: recalcular al retorno, con otro "ahora", dejaba el cargo sin venta.
     */
    congelado: VentaCongelada;
```

  Corregir también el comentario de `lineas` (*"El monto cobrado se preserva en totalFinal"*): el
  precio cobrado de cada línea va ahora en `congelado`. Import:
  `import type { VentaCongelada, LineaVentaCongelada } from '../ventas/ventas.service';`.

  (b) `prepararLineasCheckout` devuelve también `itemsBase` (el `Map` que ya carga): se agrega al
  tipo de retorno (`itemsBase: Awaited<ReturnType<ItemsService['cargarBasePorIds']>>`) y al `return`.

  (c) Constructor: `private readonly monedasService: MonedasService` (import de
  `../monedas/monedas.service`). En `online.module.ts`, `MonedasModule` en `imports`.

  (d) En `pagar`, la rama Webpay reemplaza el `calcular` actual por esto:

```ts
    const { calcularDto, lineasSnapshot, itemsBase } =
      await this.prepararLineasCheckout(tenantId, dto);

    // "Vale lo que pagó" (pendientes.md § 3, A): lo que se autoriza acá se
    // congela en la orden, y el callback crea la venta con eso. El precio se
    // convierte ACÁ —igual que en `VentasService.crearEnTransaccion`— y entra al
    // motor por el canal interno. Así el origen, la tasa y el convertido que
    // guarda `venta_detalles` salen de la misma lectura y no se contradicen.
    // Una lectura de tasas y una de config por carrito, no por línea.
    const config = await this.calculoPreciosService.cargarConfig(
      tenantId,
      await this.monedasService.decimalesOficiales(tenantId),
    );
    const tasaMap = new Map(
      (await this.monedasService.findMonedas(tenantId)).map((m) => [
        m.monedaId,
        m.valorDelDia ?? '1',
      ]),
    );
    const lineasCongeladas: LineaVentaCongelada[] = calcularDto.lineas.map(
      (l) => {
        const item = itemsBase.get(l.itemId)!;
        return {
          precioUnitarioOrigen: item.precioBase,
          monedaIdOrigen: item.monedaId,
          tasaCambio: new Decimal(tasaMap.get(item.monedaId) ?? '1').toFixed(6),
          clasificacionTributaria: item.clasificacionTributaria,
        };
      },
    );
    const resultado = await this.calculoPreciosService.calcular(
      tenantId,
      {
        ...calcularDto,
        lineas: calcularDto.lineas.map((l, i) => ({
          ...l,
          precioUnitarioResuelto: this.calculoPreciosService.convertirAMonedaOficial(
            lineasCongeladas[i].precioUnitarioOrigen,
            lineasCongeladas[i].monedaIdOrigen,
            tasaMap,
            config.modoRedondeo,
          ),
          precioUnitarioOrigenResuelto: lineasCongeladas[i].precioUnitarioOrigen,
        })),
      },
      config,
    );
```

  y el snapshot suma `congelado: { resultado, lineas: lineasCongeladas }`. Antes de escribir el
  `.toFixed(6)`, confirmar con `ventas.service.ts` que la venta escribe la tasa con esa misma forma
  (`tasa.toFixed(6)`, en `lineasConversion`): si no, se usa la de allá.

  (e) La rama demo (`checkout`) **no cambia**.

- [ ] **Paso 4: correr y ver que pasan.**

Run: `cd backend && npx jest src/modules/online/online.service.spec.ts`
Expected: PASS.

- [ ] **Paso 5: el mutante.** Sacar `precioUnitarioResuelto` del `map` de (d) y comprobar que cae el
  test del congelado. Restaurar.

- [ ] **Paso 6:** `npm run typecheck && npm run lint:check` y stagear por ruta.

---

### Tarea 3: el callback crea la venta con lo congelado

**Files:**
- Modify: `backend/src/modules/online/online-callback.handler.ts`
- Test: `backend/src/modules/online/online-callback.handler.spec.ts`

**Interfaces:**
- Consume: `CheckoutSnapshot.checkout.congelado` (Tarea 2) y
  `VentasService.crear(tenantId, usuarioId, dto, clave?, ventaCongelada?)` (Tarea 1).

- [ ] **Paso 1: tests que fallan.** En el spec, la fixture `orden()` gana en `checkout`:

```ts
          congelado: {
            resultado: { totales: { totalFinal: '100.0000' } },
            lineas: [
              {
                precioUnitarioOrigen: '50.0000',
                monedaIdOrigen: 'clp',
                tasaCambio: '1.000000',
                clasificacionTributaria: 'afecto',
              },
            ],
          },
```

  Los `expect(ventas.crear).toHaveBeenCalledWith('t-1', 'u-1', …)` existentes ganan dos argumentos
  al final: `undefined, o.metadata.checkout.congelado` (o
  `undefined, expect.objectContaining({ lineas: expect.any(Array) })`). Tests nuevos:

```ts
  it('pasa a la venta lo congelado al pagar, y el pago es su total', async () => {
    ventas.crear.mockResolvedValue({ id: 'venta-9' });
    const o = orden();
    const checkout = (o.metadata as { checkout: { congelado: unknown } }).checkout;
    await handler.onOrdenResuelta(o);

    const [, , dto, clave, congelado] = ventas.crear.mock.calls[0] as unknown[];
    expect(clave).toBeUndefined();
    expect(congelado).toBe(checkout.congelado);
    expect((dto as { pagos: { monto: string }[] }).pagos[0].monto).toBe('100.0000');
  });

  it('sin lo congelado (orden de antes del deploy) no recalcula: lanza y no crea la venta', async () => {
    const o = orden();
    delete (o.metadata as { checkout: { congelado?: unknown } }).checkout.congelado;

    await expect(handler.onOrdenResuelta(o)).rejects.toThrow(
      'no trae lo que se cobró',
    );
    expect(ventas.crear).not.toHaveBeenCalled();
    expect(o.ventaId).toBeNull();
  });
```

- [ ] **Paso 2: correr y ver que fallan.**

Run: `cd backend && npx jest src/modules/online/online-callback.handler.spec.ts`
Expected: FAIL.

- [ ] **Paso 3: implementar.** En `onOrdenResuelta`, después del chequeo de `!checkout`:

```ts
    // "Vale lo que pagó" (pendientes.md § 3, A): la venta se crea con lo que
    // `pagar` congeló, nunca recalculando. Una orden sin congelado (creada antes
    // de este cambio) no se recalcula: falla, y el dispatcher la deja pagada
    // sin venta, con su aviso.
    const congelado = checkout.congelado;
    if (!congelado) {
      throw new Error(
        `Orden ${orden.ordenId}: el snapshot no trae lo que se cobró`,
      );
    }
```

  El pago usa `monto: congelado.resultado.totales.totalFinal`, y la llamada pasa a
  `this.ventasService.crear(orden.tenantId, checkout.usuarioId, dto, undefined, congelado)`.
  Actualizar el docblock de la clase: la venta sale de lo congelado, no del recálculo.

- [ ] **Paso 4: correr y ver que pasan**, más `npm run typecheck && npm run lint:check`. Stagear
  por ruta.

---

### Tarea 4: e2e — `tienda-dos-ahoras` se da vuelta

**Files:**
- Modify: `backend/test/tienda-dos-ahoras.e2e-spec.ts`

- [ ] **Paso 1: correr el archivo como está, sobre el código nuevo** (con `entorno.sh db` arriba):

Run: `cd backend && npx jest --config ./test/jest-e2e.json test/tienda-dos-ahoras.e2e-spec.ts`
Expected: FAIL en los 6 casos y en el del aviso al admin: ahora la venta se crea. Es la medición de
que A cambió la conducta. **Anotar la salida**, porque va a `resueltos.md`.

- [ ] **Paso 2: helpers nuevos.** Junto a `afirmarCargoSinVenta`:

```ts
const ITEM_BORRADO = 'Item no encontrado';
```

```ts
  /** Lo que A no cubre: el ítem se borra mientras el comprador está en Webpay. */
  const borrarItem = async (itemId: string) => {
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBeLessThan(300);
    itemsCreados.splice(itemsCreados.indexOf(itemId), 1);
  };

  /**
   * "Vale lo que pagó" (A): lo que cambió entre el pago y el retorno no
   * importa, porque la venta se crea con lo que se cobró. Devuelve la venta.
   */
  const afirmarVentaPorLoCobrado = async (
    ordenId: string,
    location: string,
    ventasAntes: number,
    autorizado: string,
  ): Promise<string> => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('conciliada');
    expect(orden.venta_id).not.toBeNull();
    expect(await ventasOnline()).toBe(ventasAntes + 1);
    // `estado=pagada` y nada más: un `toContain` aceptaría `pagada_sin_venta`.
    expect(location).toMatch(
      new RegExp(`[?&]ordenId=${ordenId}&estado=pagada$`),
    );
    const [venta]: { total_final: string }[] = await ds.query(
      `SELECT total_final FROM ventas WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [orden.venta_id],
    );
    expect(Number(venta.total_final)).toBe(Number(autorizado));
    // Sin vuelto: lo pagado es exactamente el total (E).
    const [pago]: { monto: string; vuelto: string }[] = await ds.query(
      `SELECT sum(monto) AS monto, sum(vuelto) AS vuelto FROM pagos
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [orden.venta_id],
    );
    expect(Number(pago.monto)).toBe(Number(autorizado));
    expect(Number(pago.vuelto)).toBe(0);
    expect(erroresDeLaOrden(ordenId)).toEqual([]);
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    return orden.venta_id!;
  };

  const detalleDe = async (ventaId: string) => {
    const [d]: {
      precio_unitario: string;
      precio_unitario_origen: string;
      tasa_cambio: string;
    }[] = await ds.query(
      `SELECT precio_unitario, precio_unitario_origen, tasa_cambio
         FROM venta_detalles WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    return d;
  };
```

  El control pasa a usar `afirmarVentaPorLoCobrado` en lugar de sus afirmaciones sueltas (son las
  mismas, más la del pago).

- [ ] **Paso 3: dar vuelta los 6 casos.** En cada uno, la preparación queda igual, y
  `afirmarCargoSinVenta(...)` se reemplaza por
  `const ventaId = await afirmarVentaPorLoCobrado(ordenId, location, ventasAntes, autorizado);`
  más lo propio de cada caso. El `expect` de `totalAhora` antes del retorno **se queda**: es la
  prueba de que el catálogo sí cambió.

  - Hora (promo):

```ts
        const [promoAplicada]: { n: string }[] = await ds.query(
          `SELECT count(*) AS n FROM ventas_promociones
            WHERE venta_id = $1 AND promocion_id = $2 AND eliminado_el IS NULL`,
          [ventaId, (promo.body as { id: string }).id],
        );
        expect(Number(promoAplicada.n)).toBe(1);
```

  - Fecha (descuento): lo mismo contra `ventas_descuentos` y `descuento_id = descuentoId`.
  - El precio sube y el precio baja: `expect(Number((await detalleDe(ventaId)).precio_unitario_origen)).toBe(10000)`.
  - El precio baja con `permite_vuelto`: igual, y `afirmarVentaPorLoCobrado` ya afirma vuelto 0.
  - Tasa: `expect(Number((await detalleDe(ventaId)).tasa_cambio)).toBe(Number(tasaOriginal))`.

  Renombrar los `it` para que digan lo que pasa ahora (p. ej. *"el precio sube: la venta se crea
  por lo cobrado"*).

- [ ] **Paso 4: el caso fiscal nuevo**, dentro de `describe('el catálogo cambia…')`:

```ts
    it('la tasa de un impuesto adicional cambia: la venta guarda el impuesto cobrado', async () => {
      const imp = await request(app.getHttpServer())
        .post('/api/impuestos')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `Adicional dos ahoras E2E ${randomUUID()}`, porcentaje: '0.10' });
      expect(imp.status).toBe(201);
      const impuestoId = (imp.body as { id: string }).id;
      const itemId = await crearItem('10000', { impuestosIds: [impuestoId] });
      const ventasAntes = await ventasOnline();
      try {
        const { ordenId, autorizado } = await pagar(itemId);
        const cambio = await request(app.getHttpServer())
          .patch(`/api/impuestos/${impuestoId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ porcentaje: '0.20' });
        expect(cambio.status).toBe(200);
        expect(Number(await totalAhora(itemId))).toBeGreaterThan(Number(autorizado));

        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(ordenId, location, ventasAntes, autorizado);
        const [adicional]: { valor_aplicado: string; porcentaje_aplicado: string }[] =
          await ds.query(
            `SELECT valor_aplicado, porcentaje_aplicado FROM ventas_impuestos
              WHERE venta_id = $1 AND impuesto_id = $2 AND eliminado_el IS NULL`,
            [ventaId, impuestoId],
          );
        expect(Number(adicional.porcentaje_aplicado)).toBe(0.1);
        expect(Number(adicional.valor_aplicado)).toBe(1000);
      } finally {
        await borrarItem(itemId);
        const res = await request(app.getHttpServer())
          .delete(`/api/impuestos/${impuestoId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBeLessThan(300);
      }
    });
```

  Antes de dar por bueno el `1000`, mirar en la salida qué devuelve el `POST /impuestos` (la forma
  del body y si el `id` se llama así) y si la columna es `porcentaje_aplicado`. Si algo difiere, se
  ajusta el test, nunca el código.

- [ ] **Paso 5: lo que A no cubre.** El test del reembolso (hoy "el precio sube") y el del aviso
  al admin dejan de subir el precio y fabrican la orden sin venta borrando el ítem:

```ts
      const { ordenId, autorizado } = await pagar(itemId);
      await borrarItem(itemId);
      const location = await volver(ordenId);
      await afirmarCargoSinVenta(ordenId, location, ventasAntes, ITEM_BORRADO);
```

  El reembolso pasa a ser su propio `it`: *"lo que A no cubre: el ítem se borra mientras el
  comprador está en Webpay; el admin devuelve el cargo"*. Lleva las mismas afirmaciones del
  reembolso que hoy, con `ITEM_BORRADO` donde decía `PAGO_INCOMPLETO`. El del aviso al admin cambia
  `PAGO_INCOMPLETO` por `ITEM_BORRADO`. Las constantes que queden sin uso (`PAGO_INCOMPLETO`,
  `SIN_VUELTO`, `cambiarPrecio` si deja de usarse) se borran.

- [ ] **Paso 6: título y docblock del archivo.** El `describe` raíz pasa a algo como *"Tienda: la
  venta vale lo que se pagó, aunque algo cambie entre el pago y el retorno (e2e)"*. El docblock
  cuenta la medición del 2026-10-09, lo que hizo A y lo que A no cubre (el ítem borrado), y que D y
  E siguen valiendo para eso.

- [ ] **Paso 7: correr el archivo.**

Run: `cd backend && npx jest --config ./test/jest-e2e.json test/tienda-dos-ahoras.e2e-spec.ts`
Expected: PASS. Anotar la tabla re-medida (autorizado, total de la venta, resultado) de los 7 casos
más el fiscal.

- [ ] **Paso 8: el mutante que prueba la conducta.** Revertir la Tarea 3 a `crear(...)` **sin** el
  congelado (con un fallback temporal a recalcular) y volver a correr el archivo. Los 6 casos y el
  fiscal tienen que caer, y el control y los de ítem borrado tienen que seguir verdes. Restaurar.
  Mirar la hora del restart del watcher si hay un backend corriendo (memoria: el watcher se come el
  revert).

- [ ] **Paso 9:** el resto de los e2e de la tienda que podrían afirmar sobre el recálculo:

Run: `cd backend && npx jest --config ./test/jest-e2e.json test/tienda`
Expected: PASS. Si alguno falla porque afirmaba el recálculo, se lee y se decide: si fijaba la
conducta vieja a propósito, se da vuelta igual que acá; si no, es una regresión y se para.

---

### Tarea 5: docs, gate y cierre

**Files:**
- Modify: `docs/agent/pendientes.md` (sacar la entrada de § 3)
- Modify: `docs/agent/resueltos.md` (sección nueva arriba, con `---`)
- Modify: `docs/features/tienda-online.md` (el párrafo "Lo que todavía lo deja abierto", ~:131)
- Modify: `docs/features/ventas.md` (el canal `ventaCongelada`, junto a lo de `lineasCongeladas`)
- Modify: `docs/features/motor-calculo-precios.md` (la tienda no vuelve al motor al crear la venta)
- Modify: `docs/adr/009-callback-pasarela-venta-por-callback.md` (actualización con fecha)
- Modify: `docs/ESTADO.md` (solo si tiene una fila o nota de la tienda que nombre el recálculo)
- Delete: la spec y este plan, al terminar (`docs/superpowers/README.md`: lo implementado se borra;
  la historia queda en git)

- [ ] **Paso 1: `resueltos.md`.** Sección nueva arriba, con título del estilo *"La venta online
  vale lo que se pagó (A de los dos 'ahora', cerrada 2026-10-1x)"*. Lleva:
  - el texto de la decisión del owner;
  - lo construido, en una frase por pieza;
  - la tabla re-medida (Tarea 4, Paso 7) contra la del 2026-10-09;
  - el mutante del Paso 8, con su conteo medido;
  - lo que A no cubre (ítem borrado o sin stock: orden sin venta con aviso, reembolso a mano);
  - los punteros: `verificar` se puede revisar ahora (la razón "crear después es otro ahora" ya no
    vale para el precio, sí para stock e ítem), y "ligar a una venta" retoma solo si siguen
    apareciendo órdenes sin venta.

  En `pendientes.md`, la entrada sale entera. Las entradas de `verificar` y de "ligar" que la citan
  se actualizan para apuntar a `resueltos.md` (grepear `vale lo que pagó` y `dos "ahora"` en el
  archivo entero: memoria *"borrar un número deja la frase colgando"*).

- [ ] **Paso 2: features y ADR.**
  - `tienda-online.md`: "Lo que todavía lo deja abierto" pasa a describir lo que hace A y lo que
    no cubre.
  - `ventas.md`: `ventaCongelada`, qué congela y qué sigue vivo.
  - `motor-calculo-precios.md`: una línea donde se listan los caminos que llaman al motor.
  - ADR-009: *"Actualización 2026-10-1x — el snapshot lleva lo cobrado"*.

  Cortas, el porqué y no el código.

- [ ] **Paso 3: el gate local.**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

  Cada comando en su propia llamada, mirando el exit code (memoria: `| tail` lo descarta).

- [ ] **Paso 4: e2e de API entero, con turno.** Pedir turno a la orquestadora por SendMessage y
  esperar el OK. Después: `./scripts/reset-db.sh`, `cd backend && npm run test:e2e` en background
  (unos 580 s), `./scripts/reset-db.sh --verificar`. Avisar al terminar.

- [ ] **Paso 5: Playwright entero, con turno** (el diff toca `backend/src/`):

```bash
docker inspect --format '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}}' $(docker ps -q)
./scripts/entorno.sh borrar
./scripts/entorno.sh stack
./scripts/reset-db.sh
cd frontend && npm run e2e
docker inspect --format '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}}' $(docker ps -q)
./scripts/entorno.sh borrar
```

  Avisar a la orquestadora al terminar.

- [ ] **Paso 6: `verify-feature` completo.** Correr la skill, con revisión independiente de
  `domain-reviewer` sobre lo staged y una duda concreta delegada: *"¿hay algún camino por el que
  `ventaCongelada` pueda llegar desde un body o desde una orden que no armó `pagar`?"*. Al revisor
  se le prohíben mutantes, suites pesadas y tocar la base. El recibo queda atado al staged.

- [ ] **Paso 7: commit en la rama** (sin push), stageando por ruta y revisando
  `git diff --cached --stat`:

```bash
git commit -m "feat(tienda): la venta online vale lo que se pagó

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Paso 8:** avisar a la orquestadora por SendMessage con el SHA, el resultado de cada parte
  del gate y los dos punteros (`verificar` y "ligar").

## Decisions / Open questions

- **Decidido acá (técnico):** el resultado se congela entero en la orden, en vez de extender
  `lineasCongeladas`. La spec explica por qué el precedente no cubre la hora.
- **Decidido acá (técnico):** sin fallback a recalcular para órdenes sin `congelado`.
- **Hallazgo aparte, sin tocar:** `prepararLineasCheckout` no rechaza un ítem de tipo
  `ingrediente`. Si la tienda lo deja comprar, `pagar` lo cobra y la venta lo rechaza (*"Los
  ingredientes no se pueden vender directamente"*): otro cargo sin venta que A no cubre. Está
  leído, no medido. Se le reporta a la orquestadora; no entra en este frente.
- **Abierto para el owner, después:** si `verificar`, con A, debe crear la venta con lo congelado.
