import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { MermasService } from './mermas.service';
import { CausasMermaService } from './causas-merma.service';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';

const TENANT = 'tenant-uuid';
const USER = 'user-uuid';
const ITEM = 'item-uuid';
const CAUSA = 'causa-uuid';

// No incluye `costo_actual`: desde el fix de concurrencia (revisión
// independiente, fix round 1) el SELECT de `mermas.service.ts` ya no lo
// selecciona — lockea `items` (`FOR UPDATE OF i`), no `item_producto`, así
// que sería una lectura pre-lock. El costo congelado sale de
// `mov.costoActualPrevio`, que devuelve el mock de `registrarMovimiento`
// abajo. Un test puntual agrega `costo_actual` como override para probar
// justamente que, si estuviera, `registrar` lo ignora.
const itemRow = (overrides: Record<string, unknown> = {}) => ({
  tipo: 'producto',
  nombre: 'Harina',
  unidad_medida: 'kg',
  modo_inventario: 'cantidad',
  ...overrides,
});

// Devuelve el shape completo de `registrarMovimiento` incluyendo
// `costoActualPrevio`/`costoActual` (la lectura bajo `FOR UPDATE OF ip`,
// inventario.service.ts:155) — el valor que `mermas.service.ts` usa para
// congelar la respuesta. Sin este helper, un mock que solo trajera
// `movimientoId`/`stockResultante` dejaría `costoActualPrevio` en
// `undefined` y el test no distinguiría "sin costo" (`null`, correcto) de
// "mock incompleto" (`undefined`, un olvido).
const movimientoResult = (overrides: Record<string, unknown> = {}) => ({
  movimientoId: 'mov-1',
  stockAnterior: '10',
  stockResultante: '9',
  costoActualPrevio: '100',
  costoActual: '100',
  ...overrides,
});

describe('MermasService', () => {
  let service: MermasService;
  let transactionQueryMock: jest.Mock;
  let transactionMock: jest.Mock;
  let dataSourceQueryMock: jest.Mock;
  let inventarioService: { registrarMovimiento: jest.Mock };
  let catalogService: { convertirUnidad: jest.Mock };
  let causasService: { assertCausaActiva: jest.Mock };

  beforeEach(async () => {
    transactionQueryMock = jest.fn();
    transactionMock = jest.fn(
      (cb: (manager: { query: jest.Mock }) => unknown) =>
        cb({ query: transactionQueryMock }),
    );
    dataSourceQueryMock = jest.fn();
    inventarioService = { registrarMovimiento: jest.fn() };
    catalogService = { convertirUnidad: jest.fn() };
    causasService = { assertCausaActiva: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MermasService,
        {
          provide: Db,
          useValue: {
            transaccion: transactionMock,
            query: dataSourceQueryMock,
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
        { provide: InventarioService, useValue: inventarioService },
        { provide: CatalogService, useValue: catalogService },
        { provide: CausasMermaService, useValue: causasService },
      ],
    }).compile();

    service = module.get<MermasService>(MermasService);
  });

  describe('registrar', () => {
    it('congela costoUnitario/costoPerdido con lo que devuelve el movimiento, y no se lo pasa como override', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({ movimientoId: 'mov-1', stockResultante: '9' }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      // `registrar` ya no le pasa `costoUnitario` a `registrarMovimiento` en
      // absoluto (ni siquiera `undefined` explícito): que congele con su
      // propia lectura bajo `FOR UPDATE OF ip` (inventario.service.ts:155),
      // el chokepoint real de `item_producto.costo_actual`. Fix de
      // concurrencia — revisión independiente, fix round 1. Ver
      // docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md
      const [, params] = inventarioService.registrarMovimiento.mock
        .calls[0] as [unknown, Record<string, unknown>];
      expect(params).not.toHaveProperty('costoUnitario');
      expect(params).toMatchObject({
        tenantId: TENANT,
        itemId: ITEM,
        usuarioId: USER,
        tipo: 'salida',
        motivo: 'merma',
        cantidad: '1',
        causaMermaId: CAUSA,
      });
      expect(result).toMatchObject({
        movimientoId: 'mov-1',
        stockResultante: '9',
        costoUnitario: '100',
        costoPerdido: '100.0000',
        causaNombre: 'Vencimiento',
        merma: {
          id: 'mov-1',
          itemId: ITEM,
          costoPerdido: '100.0000',
          causaNombre: 'Vencimiento',
        },
      });
    });

    it('el costo congelado en la respuesta sale de mov.costoActualPrevio, no de la lectura previa del ítem', async () => {
      // itemRow trae costo_actual: '999' — una lectura pre-lock que ya no
      // selecciona el SELECT real (ver comentario de `itemRow` arriba), pero
      // que este mock igual puede simular. registrarMovimiento resuelve
      // costoActualPrevio: '100' — la lectura bajo FOR UPDATE OF ip, la que
      // de verdad quedó en el kardex. Si `registrar` tomara el costo de
      // `itemRows` en vez de `mov.costoActualPrevio`, este test vería '999'
      // y fallaría: es la única forma de que la aserción distinga una
      // fuente de la otra.
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ costo_actual: '999' }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({ costoActualPrevio: '100', costoActual: '100' }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      expect(result.costoUnitario).toBe('100');
      expect(result.costoPerdido).toBe('100.0000');
      expect(result.merma.costoPerdido).toBe('100.0000');
    });

    // El costo se maneja en el producto, no se tipea al mermar (owner, 2026-08-28).
    // Regla 1: la merma sin costo se registra igual, sin valorizar — nunca se
    // inventa un costo. Antes esto era un 400 ("rechaza sin costo_actual ni
    // costoUnitario"); el test se borró junto con el override de `costoUnitario`
    // en el DTO. Ver docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md
    it('registra la merma sin valorizar cuando el producto no tiene costo', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({
          movimientoId: 'mov-2',
          stockAnterior: '5',
          stockResultante: '3',
          costoActualPrevio: null,
          costoActual: null,
        }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '2',
        causaMermaId: CAUSA,
      });

      const [, params] = inventarioService.registrarMovimiento.mock
        .calls[0] as [unknown, Record<string, unknown>];
      expect(params).not.toHaveProperty('costoUnitario');
      expect(result.costoUnitario).toBeNull();
      expect(result.costoPerdido).toBeNull();
      expect(result.merma.costoPerdido).toBeNull();
    });

    it('costo_actual = "0" se registra valorizado en cero, sin pasar costoUnitario a registrarMovimiento', async () => {
      // '0' YA es un estado alcanzable por API: desde el 2026-08-29 se puede
      // crear un ítem con `costo: '0'` y comprar a costo 0 (mercadería de
      // donación o muestra, distinta de "sin costo" = null, Regla 1). Cuando
      // este test se escribió no lo era —`validarCostoPositivo` y el guard de
      // `costoUnitario` en `registrarMovimiento` exigían `> 0` y contradecían
      // al propio `CreateItemDto`—, así que era un valor límite del mock; el
      // fix de esa contradicción no cambió nada acá, solo volvió real el caso.
      // Lo que este test fija: `registrar` nunca pasa `costoUnitario` a
      // `registrarMovimiento` (mockeado acá), sea cual sea el costo leído
      // — así que ese callee no puede rebotar, ni con este costo ni con
      // ninguno. El e2e de la Task 2 cubre el camino contra el
      // servicio real.
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({ costoActualPrevio: '0', costoActual: '0' }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      const [, params] = inventarioService.registrarMovimiento.mock
        .calls[0] as [unknown, Record<string, unknown>];
      expect(params).not.toHaveProperty('costoUnitario');
      expect(result.costoUnitario).toBe('0');
      expect(result.costoPerdido).toBe('0.0000');
    });

    it('valoriza con el costo del producto, sin que nadie lo tipee', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({
          movimientoId: 'mov-3',
          stockAnterior: '2',
          stockResultante: '1.5',
          costoActualPrevio: '100.0000',
          costoActual: '100.0000',
        }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '0.5',
        causaMermaId: CAUSA,
      });

      expect(result.costoUnitario).toBe('100.0000');
      expect(result.costoPerdido).toBe('50.0000');
    });

    it('convierte unidad cuando unidadCodigo difiere de la base', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      catalogService.convertirUnidad.mockResolvedValueOnce('0.5');
      inventarioService.registrarMovimiento.mockResolvedValueOnce({
        movimientoId: 'mov-3',
        stockAnterior: '2',
        stockResultante: '1.5',
      });

      await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '500',
        unidadCodigo: 'g',
        causaMermaId: CAUSA,
      });

      expect(catalogService.convertirUnidad).toHaveBeenCalledWith(
        '500',
        'g',
        'kg',
      );
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cantidad: '0.5' }),
      );
    });

    // El test que conmutaba costoUnitario explícito + conversión de unidad
    // ('convierte costoUnitario junto con la cantidad preservando el valor
    // total') se borró: `convertirCostoUnitario` solo se llamaba desde la
    // rama de override que la regla 3 elimina — el costo ya no se tipea, así
    // que no hay costo por convertir. La conversión de CANTIDAD sigue
    // cubierta arriba ('convierte unidad cuando unidadCodigo difiere...').

    it('con conversión de unidad, el costo congelado sigue viniendo de mov.costoActualPrevio sin convertir', async () => {
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ unidad_medida: 'kg' }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      catalogService.convertirUnidad.mockResolvedValueOnce('0.5'); // 500 g → 0.5 kg
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({
          movimientoId: 'mov-5',
          stockAnterior: '10',
          stockResultante: '9.5',
          costoActualPrevio: '100',
          costoActual: '100',
        }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '500',
        unidadCodigo: 'g',
        causaMermaId: CAUSA,
      });

      const [, params] = inventarioService.registrarMovimiento.mock
        .calls[0] as [unknown, Record<string, unknown>];
      expect(params).not.toHaveProperty('costoUnitario');
      expect(params).toMatchObject({ cantidad: '0.5' });
      // costo_actual ya está en unidad base (kg): no se convierte junto con
      // la cantidad, a diferencia de lo que hacía el viejo override tipeado.
      expect(result.costoUnitario).toBe('100');
      expect(result.costoPerdido).toBe('50.0000'); // 0.5 kg × 100/kg
    });

    it('rechaza causa inactiva vía assertCausaActiva', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockRejectedValueOnce(
        new BadRequestException('Causa de merma no válida o inactiva'),
      );

      await expect(
        service.registrar(TENANT, USER, {
          itemId: ITEM,
          cantidad: '1',
          causaMermaId: CAUSA,
        }),
      ).rejects.toThrow('Causa de merma no válida o inactiva');
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('acepta item tipo ingrediente con mismo flujo que producto cantidad', async () => {
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ tipo: 'ingrediente', nombre: 'Harina premium' }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce(
        movimientoResult({
          movimientoId: 'mov-ing',
          stockAnterior: '10',
          stockResultante: '9',
        }),
      );

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT,
          itemId: ITEM,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
        }),
      );
      expect(result).toMatchObject({
        movimientoId: 'mov-ing',
        stockResultante: '9',
        costoUnitario: '100',
        costoPerdido: '100.0000',
        causaNombre: 'Vencimiento',
        merma: { id: 'mov-ing', itemId: ITEM },
      });
    });

    it('expone unidadMedida del producto en la merma registrada', async () => {
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ unidad_medida: 'l' }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '9',
      });

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      expect(result.merma.unidadMedida).toBe('l');
    });
  });

  describe('findAll', () => {
    it('mapea filas snake_case a camelCase incluyendo unidadMedida', async () => {
      dataSourceQueryMock
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM,
            item_nombre: 'Harina',
            cantidad: '2.5000',
            costo_unitario: '1000',
            causa_merma_id: CAUSA,
            causa_nombre: 'Vencimiento',
            comentario: null,
            creado_el: new Date('2026-07-18T00:00:00Z'),
            usuario_nombre: 'Admin',
            unidad_medida: 'kg',
          },
        ]);

      const res = await service.findAll(TENANT, {});

      expect(res.data[0]).toMatchObject({
        id: 'mov-1',
        itemId: ITEM,
        itemNombre: 'Harina',
        cantidad: '2.5000',
        unidadMedida: 'kg',
        costoPerdido: '2500.0000',
      });
      expect(dataSourceQueryMock).toHaveBeenCalledWith(
        expect.stringContaining('unidad_medida'),
        expect.any(Array),
      );
    });
  });
});
