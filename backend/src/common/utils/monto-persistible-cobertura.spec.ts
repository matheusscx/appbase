import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { getMetadataStorage } from 'class-validator';
import { getMetadataArgsStorage } from 'typeorm';
import {
  ESCALA_COSTO_KEY,
  ESCALA_MONEDA_KEY,
} from '../decorators/escala-moneda.decorator';
import { Caja } from '../../modules/caja/entities/caja.entity';
import { Cajon } from '../../modules/cajones/entities/cajon.entity';
import { CajaArqueoMedio } from '../../modules/caja/entities/caja-arqueo-medio.entity';
import { MovimientoCaja } from '../../modules/caja/entities/movimiento-caja.entity';
import { Compra } from '../../modules/compras/entities/compra.entity';
import { PresentacionCompra } from '../../modules/compras/entities/presentacion-compra.entity';
import { CompraLinea } from '../../modules/compras/entities/compra-linea.entity';
import { PagoProveedor } from '../../modules/compras/entities/pago-proveedor.entity';
import { PagoProveedorAplicacion } from '../../modules/compras/entities/pago-proveedor-aplicacion.entity';
import { Descuento } from '../../modules/descuentos/entities/descuento.entity';
import { DescuentoTramo } from '../../modules/descuentos/entities/descuento-tramo.entity';
import { GrupoModificadorOpcion } from '../../modules/grupos-modificadores/entities/grupo-modificador-opcion.entity';
import { MovimientoInventario } from '../../modules/inventario/entities/movimiento-inventario.entity';
import { Item } from '../../modules/items/entities/item.entity';
import { ItemGrupoModificadorOpcion } from '../../modules/items/entities/item-grupo-modificador-opcion.entity';
import { ItemProducto } from '../../modules/items/entities/item-producto.entity';
import { RecetaIngrediente } from '../../modules/items/entities/receta-ingrediente.entity';
import { StockUbicacion } from '../../modules/items/entities/stock-ubicacion.entity';
import { RecetaExtraPermitido } from '../../modules/items/entities/receta-extra-permitido.entity';
import { Pago } from '../../modules/pagos/entities/pago.entity';
import { Paquete } from '../../modules/paqueteria/entities/paquete.entity';
import { TarifaPago } from '../../modules/paqueteria/entities/tarifa-pago.entity';
import { PaqueteConfiguracion } from '../../modules/paqueteria/entities/paquete-configuracion.entity';
import { Promocion } from '../../modules/promociones/entities/promocion.entity';
import { LiquidacionPropinasGrupo } from '../../modules/propinas/entities/liquidacion-propinas-grupo.entity';
import { LiquidacionPropinasParticipante } from '../../modules/propinas/entities/liquidacion-propinas-participante.entity';
import { PropinaGrupoDistribucion } from '../../modules/propinas/entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from '../../modules/propinas/entities/propina-grupo-peso-manual.entity';
import { VentaPropina } from '../../modules/propinas/entities/venta-propina.entity';
import { Recargo } from '../../modules/recargos/entities/recargo.entity';
import { RecuentoInventarioLinea } from '../../modules/recuentos/entities/recuento-inventario-linea.entity';
import { RecargoTramo } from '../../modules/recargos/entities/recargo-tramo.entity';
import { TenantMoneda } from '../../modules/monedas/entities/tenant-moneda.entity';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';

/**
 * Todo campo `@EsMontoCobrado()` o `@EsCosto()` de un DTO que se guarda lleva
 * `@IsMontoPersistible(escala)` con la escala de SU columna; sin él, un monto que
 * no cabe pasaba el DTO y daba 500 en el `INSERT` (medido el 2026-10-12 campo
 * por campo: `docs/agent/resueltos.md`, "Los ~40 campos `@EsMontoCobrado` no
 * tienen techo"). La entrada del backlog nombraba los cobrados y no los costos:
 * por eso el barrido es por la MARCA, no por una lista, y un DTO nuevo con la
 * marca y sin techo rompe acá.
 *
 * Dos chequeos. El primero: ninguna marca sin techo salvo las exentas, cada una
 * con su porqué. El segundo: la escala del techo es la de la columna a la que
 * llega el campo, leída de la metadata de la entity (no del `.sql`, que no
 * manda: el esquema sale de las entities).
 */

type Entidad = abstract new (...args: never[]) => unknown;

/** `<módulo>/<Clase>.<campo>` → las columnas donde se guarda tal cual. */
const COLUMNAS: Record<string, [Entidad, string][]> = {
  'caja/CrearMovimientoDto.monto': [[MovimientoCaja, 'monto']],
  'caja/LineaCierreDto.montoContado': [
    [CajaArqueoMedio, 'contado'],
    [Caja, 'montoContado'],
  ],
  'cajones/CreateCajonDto.fondoSugerido': [[Cajon, 'fondoSugerido']],
  'cajones/UpdateCajonDto.fondoSugerido': [[Cajon, 'fondoSugerido']],
  'compras/AplicacionPagoProveedorDto.monto': [
    [PagoProveedorAplicacion, 'monto'],
  ],
  'compras/CrearPagoProveedorDto.monto': [[PagoProveedor, 'monto']],
  'compras/PagoAlConfirmarDto.monto': [[PagoProveedor, 'monto']],
  'compras/CompraBorradorDto.descuentoTotal': [[Compra, 'descuentoTotal']],
  'compras/CompraBorradorDto.totalDocumento': [[Compra, 'totalDocumento']],
  'compras/LineaCompraDto.precioUnitario': [[CompraLinea, 'precioUnitario']],
  'compras/CorregirDescuentoDto.descuentoTotal': [[Compra, 'descuentoTotal']],
  'compras/ActualizarDocumentoDto.totalDocumento': [[Compra, 'totalDocumento']],
  'compras/CorregirLineaDto.precioUnitario': [[CompraLinea, 'precioUnitario']],
  'descuentos/CreateDescuentoDto.valorMonto': [[Descuento, 'valorMonto']],
  'descuentos/TramoDto.minimoMonto': [[DescuentoTramo, 'minimoMonto']],
  'descuentos/TramoDto.valorMonto': [[DescuentoTramo, 'valorMonto']],
  'grupos-modificadores/GrupoOpcionInputDto.precioExtra': [
    [GrupoModificadorOpcion, 'precioExtra'],
  ],
  'grupos-modificadores/AplicarOverridesDto.precioExtra': [
    [ItemGrupoModificadorOpcion, 'precioExtra'],
  ],
  'inventario/AjusteCostoDto.costoNuevo': [
    [ItemProducto, 'costoActual'],
    [MovimientoInventario, 'costoUnitario'],
  ],
  'items/AjusteStockDto.costoUnitario': [
    [MovimientoInventario, 'costoUnitario'],
  ],
  'items/AplicarDesfaseItemDto.precioBase': [[Item, 'precioBase']],
  'items/CreateItemDto.precioBase': [[Item, 'precioBase']],
  'items/CreateItemDto.costo': [
    [ItemProducto, 'costoActual'],
    [MovimientoInventario, 'costoUnitario'],
  ],
  'items/UpdateItemDto.precioBase': [[Item, 'precioBase']],
  'items/RecetaExtraInputDto.precioExtra': [
    [RecetaExtraPermitido, 'precioExtra'],
  ],
  'items/ItemGrupoOpcionOverrideInputDto.precioExtra': [
    [ItemGrupoModificadorOpcion, 'precioExtra'],
  ],
  'pagos/PagoItemDto.monto': [[Pago, 'monto']],
  'paqueteria/CreatePaqueteDto.precioEnvio': [[Paquete, 'precioEnvio']],
  'paqueteria/CreatePaqueteDto.pagoRepartidor': [[Paquete, 'pagoRepartidor']],
  'paqueteria/UpdatePaqueteDto.precioEnvio': [[Paquete, 'precioEnvio']],
  'paqueteria/UpdatePaqueteDto.pagoRepartidor': [[Paquete, 'pagoRepartidor']],
  'paqueteria/PutPaqueteConfiguracionDto.precioEnvioDefecto': [
    [PaqueteConfiguracion, 'precioEnvioDefecto'],
  ],
  'paqueteria/PutPaqueteConfiguracionDto.pagoRepartidorDefecto': [
    [PaqueteConfiguracion, 'pagoRepartidorDefecto'],
  ],
  'paqueteria/CreateTarifaPagoDto.monto': [[TarifaPago, 'monto']],
  'paqueteria/UpdateTarifaPagoDto.monto': [[TarifaPago, 'monto']],
  'promociones/CreatePromocionDto.valorMonto': [[Promocion, 'valorMonto']],
  'propinas/MontoManualDto.monto': [[LiquidacionPropinasParticipante, 'monto']],
  'propinas/UpdateLiquidacionParticipanteDto.monto': [
    [LiquidacionPropinasParticipante, 'monto'],
  ],
  'recargos/CreateRecargoDto.valorMonto': [[Recargo, 'valorMonto']],
  'recargos/TramoDto.minimoMonto': [[RecargoTramo, 'minimoMonto']],
  'recargos/TramoDto.valorMonto': [[RecargoTramo, 'valorMonto']],
  'salones/CerrarCuentaDto.propinaMonto': [[VentaPropina, 'montoPagado']],
  'salones/CerrarCuentaDto.propinaSugerida': [[VentaPropina, 'montoSugerido']],
  'tenants/UpdatePreferenciasFinancierasDto.montoTolerancia': [
    [Tenant, 'montoTolerancia'],
  ],
  'tenants/UpdatePreferenciasFinancierasDto.umbralDescuadreAviso': [
    [Tenant, 'umbralDescuadreAviso'],
  ],
  'tenants/UpdatePreferenciasFinancierasDto.umbralDescuadreAlto': [
    [Tenant, 'umbralDescuadreAlto'],
  ],
  'ventas/PagoVentaDto.monto': [[Pago, 'monto']],
  'ventas/PropinaCierreMesaDto.montoPagado': [[VentaPropina, 'montoPagado']],
  'ventas/PropinaCierreMesaDto.montoSugerido': [
    [VentaPropina, 'montoSugerido'],
  ],
  'ventas/PropinaDirectaDto.montoPagado': [[VentaPropina, 'montoPagado']],
  'ventas/PropinaDirectaDto.montoSugerido': [[VentaPropina, 'montoSugerido']],
};

/** Las marcas sin techo, y por qué no lo necesitan (medido el 2026-10-12). */
const EXENTOS: Record<string, string> = {
  'caja/AbrirCajaDto.saldoInicial':
    'lo frena `CajaService.abrir` con 400 (caja-esperado-no-cabe.e2e-spec.ts, "la apertura")',
  'impuestos/CreateImpuestoDto.porcentaje':
    'su columna es `NUMERIC(7,4)`, no de plata: el techo es `@IsDecimalHasta(TOPE_PORCENTAJE_IMPUESTO)` = 1 (100%)',
  'impuestos/UpdateImpuestoDto.porcentaje':
    'su columna es `NUMERIC(7,4)`, no de plata: el techo es `@IsDecimalHasta(TOPE_PORCENTAJE_IMPUESTO)` = 1 (100%)',
  'items/DescartarDesfaseItemDto.costoPropuestoVisto':
    'no se guarda: solo se compara con el costo recalculado, y lo que se guarda es ese',
  'ventas/CreateNotaCreditoDto.monto':
    'lo frena el service con 400 ("excede lo disponible para nota de crédito"); lo fiscal va en su propio frente',
};

function dtos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return dtos(ruta);
    return nombre.endsWith('.dto.ts') ? [ruta] : [];
  });
}

/**
 * Lo que no es plata no lleva marca, así que `IsDecimalPersistible` no se barre
 * por una: cada uso está anotado acá con sus columnas, y el chequeo es que la
 * precisión y la escala del techo sean las de cada una (medido el 2026-10-13,
 * `docs/agent/resueltos.md`, "Decimales por body sin techo").
 */
const COLUMNAS_NO_PLATA: Record<string, [Entidad, string][]> = {
  // Cantidades de kardex: el campo tal como llega. La convertida a la unidad
  // del producto y el saldo resultante los mira el service (`docs/agent/
  // resueltos.md`, "Una cantidad por body sin techo").
  'compras/CorregirLineaDto.cantidad': [[CompraLinea, 'cantidad']],
  'compras/CrearPresentacionCompraDto.contenido': [
    [PresentacionCompra, 'contenido'],
  ],
  'compras/EditarPresentacionCompraDto.contenido': [
    [PresentacionCompra, 'contenido'],
  ],
  'compras/LineaCompraDto.cantidad': [[CompraLinea, 'cantidad']],
  'grupos-modificadores/AplicarOverridesDto.cantidad': [
    [ItemGrupoModificadorOpcion, 'cantidad'],
  ],
  'grupos-modificadores/GrupoOpcionInputDto.cantidad': [
    [GrupoModificadorOpcion, 'cantidad'],
  ],
  'items/AjusteStockDto.cantidad': [
    [MovimientoInventario, 'cantidad'],
    [StockUbicacion, 'stock'],
  ],
  'items/CreateItemDto.stock': [
    [MovimientoInventario, 'cantidad'],
    [StockUbicacion, 'stock'],
  ],
  'items/ItemGrupoOpcionOverrideInputDto.cantidad': [
    [ItemGrupoModificadorOpcion, 'cantidad'],
  ],
  'items/RecetaExtraInputDto.cantidad': [[RecetaExtraPermitido, 'cantidad']],
  'items/RecetaIngredienteInputDto.cantidad': [[RecetaIngrediente, 'cantidad']],
  'traslados/LineaTrasladoDto.cantidad': [
    [MovimientoInventario, 'cantidad'],
    [StockUbicacion, 'stock'],
  ],
  // Fuera del kardex: el umbral de un tramo `por_mayor`. El de recargos no lo
  // lleva porque ningún tipo de recargo mide cantidad y el service rechaza el
  // campo entero (`docs/agent/resueltos.md`, "El mínimo de un tramo por
  // cantidad que no cabe en su columna").
  'descuentos/TramoDto.minimoCantidad': [[DescuentoTramo, 'minimoCantidad']],
  'monedas/UpdateTenantMonedaDto.valorDelDia': [[TenantMoneda, 'valorDelDia']],
  'promociones/CreatePromocionDto.valorPorcentaje': [
    [Promocion, 'valorPorcentaje'],
  ],
  'propinas/GrupoDistribucionDto.porcentaje': [
    [PropinaGrupoDistribucion, 'porcentaje'],
    [LiquidacionPropinasGrupo, 'porcentaje'],
  ],
  'propinas/PesoManualDto.peso': [[PropinaGrupoPesoManual, 'peso']],
  'propinas/UpdateLiquidacionParticipanteDto.pesoManual': [
    [LiquidacionPropinasParticipante, 'pesoManual'],
  ],
  'recuentos/UpdateRecuentoLineaDto.cantidadContada': [
    [RecuentoInventarioLinea, 'cantidadContada'],
  ],
  'salones/CerrarCuentaDto.propinaPorcentajeSugerido': [
    [VentaPropina, 'porcentajeSugerido'],
  ],
  'ventas/PropinaCierreMesaDto.porcentajeSugerido': [
    [VentaPropina, 'porcentajeSugerido'],
  ],
  'ventas/PropinaDirectaDto.porcentajeSugerido': [
    [VentaPropina, 'porcentajeSugerido'],
  ],
};

/** Cada clase exportada de un DTO, con su `<módulo>`. */
function clasesDeDto(): [string, Entidad][] {
  const modulos = join(__dirname, '../../modules');
  return dtos(modulos).flatMap((archivo) => {
    const modulo = relative(modulos, archivo).split(sep)[0];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exportado = require(archivo) as Record<string, unknown>;
    return Object.values(exportado)
      .filter((clase): clase is Entidad => typeof clase === 'function')
      .map((clase): [string, Entidad] => [modulo, clase]);
  });
}

/** `<módulo>/<Clase>.<campo>` → la escala del techo, o `null` si no tiene. */
function camposMarcados(): Map<string, number | null> {
  const campos = new Map<string, number | null>();
  for (const [modulo, clase] of clasesDeDto()) {
    const marcados = [ESCALA_MONEDA_KEY, ESCALA_COSTO_KEY].flatMap(
      (clave) =>
        (Reflect.getOwnMetadata(clave, clase) as string[] | undefined) ?? [],
    );
    const techos = getMetadataStorage()
      .getTargetValidationMetadatas(clase, '', true, false)
      .filter((m) => m.name === 'isMontoPersistible');
    for (const campo of marcados) {
      const techo = techos.find((m) => m.propertyName === campo);
      campos.set(
        `${modulo}/${clase.name}.${campo}`,
        techo ? (techo.constraints[0] as number) : null,
      );
    }
  }
  return campos;
}

function columna(entidad: Entidad, propiedad: string) {
  const col = getMetadataArgsStorage().columns.find(
    (c) => c.target === entidad && c.propertyName === propiedad,
  );
  if (!col) throw new Error(`${entidad.name}.${propiedad} no es una columna`);
  return { precision: col.options.precision, scale: col.options.scale };
}

describe('IsMontoPersistible cubre toda marca de plata que se guarda', () => {
  const campos = camposMarcados();

  it('encuentra las marcas (si no, el barrido no está mirando nada)', () => {
    expect(campos.size).toBeGreaterThan(Object.keys(COLUMNAS).length);
  });

  it('ninguna marca queda sin techo salvo las exentas, con su porqué', () => {
    const sinTecho = [...campos]
      .filter(([, escala]) => escala === null)
      .map(([campo]) => campo)
      .sort();
    expect(sinTecho).toEqual(Object.keys(EXENTOS).sort());
  });

  it('cada techo tiene su columna anotada, y las exentas no llevan techo', () => {
    const conTecho = [...campos]
      .filter(([, escala]) => escala !== null)
      .map(([campo]) => campo)
      .sort();
    expect(conTecho).toEqual(Object.keys(COLUMNAS).sort());
  });

  it.each(Object.entries(COLUMNAS))(
    '%s: el techo es el de su columna',
    (campo, columnas) => {
      for (const [entidad, propiedad] of columnas) {
        expect({ campo, ...columna(entidad, propiedad) }).toEqual({
          campo,
          precision: 18,
          scale: campos.get(campo),
        });
      }
    },
  );
});

describe('IsDecimalPersistible lleva la precisión y la escala de su columna', () => {
  const techos = new Map<string, unknown[]>();
  for (const [modulo, clase] of clasesDeDto()) {
    for (const m of getMetadataStorage()
      .getTargetValidationMetadatas(clase, '', true, false)
      .filter((v) => v.name === 'isDecimalPersistible')) {
      // `getTargetValidationMetadatas` trae también lo heredado: el campo se
      // anota en la clase que lo declara.
      if (m.target !== clase) continue;
      techos.set(`${modulo}/${clase.name}.${m.propertyName}`, m.constraints);
    }
  }

  it('cada uso tiene sus columnas anotadas', () => {
    expect([...techos.keys()].sort()).toEqual(
      Object.keys(COLUMNAS_NO_PLATA).sort(),
    );
  });

  it.each(Object.entries(COLUMNAS_NO_PLATA))(
    '%s: el techo es el de su columna',
    (campo, columnas) => {
      const [precision, scale] = techos.get(campo) ?? [];
      for (const [entidad, propiedad] of columnas) {
        expect({ campo, ...columna(entidad, propiedad) }).toEqual({
          campo,
          precision,
          scale,
        });
      }
    },
  );
});
