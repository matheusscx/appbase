import { extname, join } from 'node:path';
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions.js';
import { Usuario } from '../modules/users/usuario.entity';
import { RefreshToken } from '../modules/auth/entities/refresh-token.entity';
import { TokenAcceso } from '../modules/auth/entities/token-acceso.entity';
import { Pais } from '../modules/catalog/entities/pais.entity';
import { Provincia } from '../modules/catalog/entities/provincia.entity';
import { Moneda } from '../modules/catalog/entities/moneda.entity';
import { UnidadMedida } from '../modules/catalog/entities/unidad-medida.entity';
import { ModuloApp } from '../modules/catalog/entities/modulo-app.entity';
import { Permiso } from '../modules/catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../modules/catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { UsuarioTenant } from '../modules/tenants/entities/usuario-tenant.entity';
import { TenantModulo } from '../modules/tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from '../modules/tenants/entities/tenant-formula-precio.entity';
import { Caja } from '../modules/caja/entities/caja.entity';
import { CajaTestigo } from '../modules/caja/entities/caja-testigo.entity';
import { MovimientoCaja } from '../modules/caja/entities/movimiento-caja.entity';
import { CajaArqueoMedio } from '../modules/caja/entities/caja-arqueo-medio.entity';
import { CajaIntentoRechazado } from '../modules/caja/entities/caja-intento-rechazado.entity';
import { DteCaf } from '../modules/dte/entities/dte-caf.entity';
import { DteCertificado } from '../modules/dte/entities/dte-certificado.entity';
import { DteDocumento } from '../modules/dte/entities/dte-documento.entity';
import { DteEnvio } from '../modules/dte/entities/dte-envio.entity';
import { RazonSocial } from '../modules/tenants/entities/razon-social.entity';
import { Rol } from '../modules/roles/entities/rol.entity';
import { RolUsuario } from '../modules/roles/entities/rol-usuario.entity';
import { ModuloRol } from '../modules/roles/entities/modulo-rol.entity';
import { RolPermisoModulo } from '../modules/roles/entities/rol-permiso-modulo.entity';
import { TenantMoneda } from '../modules/monedas/entities/tenant-moneda.entity';
import { PaisMoneda } from '../modules/monedas/entities/pais-moneda.entity';
import { Categoria } from '../modules/categorias/entities/categoria.entity';
import { Impuesto } from '../modules/impuestos/entities/impuesto.entity';
import { TipoRegla } from '../modules/tipos-regla/entities/tipo-regla.entity';
import { Descuento } from '../modules/descuentos/entities/descuento.entity';
import { DescuentoTramo } from '../modules/descuentos/entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from '../modules/descuentos/entities/descuento-metodo-pago.entity';
import { Recargo } from '../modules/recargos/entities/recargo.entity';
import { RecargoTramo } from '../modules/recargos/entities/recargo-tramo.entity';
import { RecargoMetodoPago } from '../modules/recargos/entities/recargo-metodo-pago.entity';
import { MetodoPago } from '../modules/metodos-pago/entities/metodo-pago.entity';
import { MetodoPagoPais } from '../modules/metodos-pago/entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from '../modules/metodos-pago/entities/tenant-metodo-pago.entity';
import { Item } from '../modules/items/entities/item.entity';
import { ItemProducto } from '../modules/items/entities/item-producto.entity';
import { ItemServicio } from '../modules/items/entities/item-servicio.entity';
import { ItemSuscripcion } from '../modules/items/entities/item-suscripcion.entity';
import { ItemReceta } from '../modules/items/entities/item-receta.entity';
import { RecetaIngrediente } from '../modules/items/entities/receta-ingrediente.entity';
import { RecetaExtraPermitido } from '../modules/items/entities/receta-extra-permitido.entity';
import { ItemImpuesto } from '../modules/items/entities/item-impuesto.entity';
import { ItemRecargo } from '../modules/items/entities/item-recargo.entity';
import { ItemDescuento } from '../modules/items/entities/item-descuento.entity';
import { ItemLote } from '../modules/items/entities/item-lote.entity';
import { ItemUnidad } from '../modules/items/entities/item-unidad.entity';
import { ItemCombo } from '../modules/items/entities/item-combo.entity';
import { ComboComponente } from '../modules/items/entities/combo-componente.entity';
import { ItemGrupoModificador } from '../modules/items/entities/item-grupo-modificador.entity';
import { ItemGrupoModificadorOpcion } from '../modules/items/entities/item-grupo-modificador-opcion.entity';
import { MovimientoInventario } from '../modules/inventario/entities/movimiento-inventario.entity';
import { MovimientoInventarioDetalle } from '../modules/inventario/entities/movimiento-inventario-detalle.entity';
import { MotivoBaja } from '../modules/motivos-baja/entities/motivo-baja.entity';
import { MotivoDiferenciaCaja } from '../modules/motivos-diferencia/entities/motivo-diferencia-caja.entity';
import { Cajon } from '../modules/cajones/entities/cajon.entity';
import { CajonUsuario } from '../modules/cajones/entities/cajon-usuario.entity';
import { Venta } from '../modules/ventas/entities/venta.entity';
import { VentaDetalle } from '../modules/ventas/entities/venta-detalle.entity';
import { VentaDescuento } from '../modules/ventas/entities/venta-descuento.entity';
import { VentaRecargo } from '../modules/ventas/entities/venta-recargo.entity';
import { VentaImpuesto } from '../modules/ventas/entities/venta-impuesto.entity';
import { VentaCustomer } from '../modules/ventas/entities/venta-customer.entity';
import { VentaDocumento } from '../modules/venta-documentos/entities/venta-documento.entity';
import { VentaDocumentoNumeroBorrado } from '../modules/venta-documentos/entities/venta-documento-numero-borrado.entity';
import { Pago } from '../modules/pagos/entities/pago.entity';
import { PagoAplicacion } from '../modules/pagos/entities/pago-aplicacion.entity';
import { VentaPropina } from '../modules/propinas/entities/venta-propina.entity';
import { PropinaConfiguracion } from '../modules/propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../modules/propinas/entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from '../modules/propinas/entities/propina-grupo-peso-manual.entity';
import { LiquidacionPropinas } from '../modules/propinas/entities/liquidacion-propinas.entity';
import { LiquidacionPropinasGrupo } from '../modules/propinas/entities/liquidacion-propinas-grupo.entity';
import { LiquidacionPropinasParticipante } from '../modules/propinas/entities/liquidacion-propinas-participante.entity';
import { LiquidacionPropinasFuente } from '../modules/propinas/entities/liquidacion-propinas-fuente.entity';
import { LiquidacionPropinasEvento } from '../modules/propinas/entities/liquidacion-propinas-evento.entity';
import { TipoDocumentoTributario } from '../modules/ventas/entities/tipo-documento-tributario.entity';
import { UmbralIdentidadPagador } from '../modules/ventas/entities/umbral-identidad-pagador.entity';
import { Tercero } from '../modules/terceros/entities/tercero.entity';
import { PaqueteConfiguracion } from '../modules/paqueteria/entities/paquete-configuracion.entity';
import { Repartidor } from '../modules/paqueteria/entities/repartidor.entity';
import { Paquete } from '../modules/paqueteria/entities/paquete.entity';
import { HojaRuta } from '../modules/paqueteria/entities/hoja-ruta.entity';
import { HojaRutaPaquete } from '../modules/paqueteria/entities/hoja-ruta-paquete.entity';
import { Suscripcion } from '../modules/suscripciones/entities/suscripcion.entity';
import { Pasarela } from '../modules/pasarela/entities/pasarela.entity';
import { TenantPasarela } from '../modules/pasarela/entities/tenant-pasarela.entity';
import { PasarelaApiKey } from '../modules/pasarela/entities/pasarela-api-key.entity';
import { PasarelaInscripcion } from '../modules/pasarela/entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from '../modules/pasarela/entities/pasarela-medio-pago.entity';
import { PasarelaOrden } from '../modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from '../modules/pasarela/entities/pasarela-transaccion.entity';
import { CronEjecucion } from '../modules/cron/entities/cron-ejecucion.entity';
import { Salon } from '../modules/salones/entities/salon.entity';
import { Mesa } from '../modules/salones/entities/mesa.entity';
import { Cuenta } from '../modules/salones/entities/cuenta.entity';
import { CuentaLinea } from '../modules/salones/entities/cuenta-linea.entity';
import { CuentaLineaAnulacion } from '../modules/salones/entities/cuenta-linea-anulacion.entity';
import { CuentaLineaReparto } from '../modules/salones/entities/cuenta-linea-reparto.entity';
import { CuentaAsignacion } from '../modules/salones/entities/cuenta-asignacion.entity';
import { Garzon } from '../modules/garzones/entities/garzon.entity';
import { GarzonPinEvento } from '../modules/garzones/entities/garzon-pin-evento.entity';
import { Turno } from '../modules/turnos/entities/turno.entity';
import { SesionGarzon } from '../modules/turnos/entities/sesion-garzon.entity';
import { MotivoDiferenciaInventario } from '../modules/motivos-diferencia-inventario/entities/motivo-diferencia-inventario.entity';
import { MotivoTraslado } from '../modules/motivos-traslado/entities/motivo-traslado.entity';
import { SolicitudIdempotente } from '../modules/idempotencia/entities/solicitud-idempotente.entity';
import { Impresora } from '../modules/impresoras/entities/impresora.entity';
import { GrupoModificador } from '../modules/grupos-modificadores/entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from '../modules/grupos-modificadores/entities/grupo-modificador-opcion.entity';
import { RecuentoInventario } from '../modules/recuentos/entities/recuento-inventario.entity';
import { RecuentoInventarioLinea } from '../modules/recuentos/entities/recuento-inventario-linea.entity';
import { Promocion } from '../modules/promociones/entities/promocion.entity';
import { PromocionScope } from '../modules/promociones/entities/promocion-scope.entity';
import { PromocionScopeItem } from '../modules/promociones/entities/promocion-scope-item.entity';
import { VentaPromocion } from '../modules/ventas/entities/venta-promocion.entity';
import { Ubicacion } from '../modules/ubicaciones/entities/ubicacion.entity';
import { Traslado } from '../modules/traslados/entities/traslado.entity';
import { StockUbicacion } from '../modules/items/entities/stock-ubicacion.entity';
import { StockMinimo } from '../modules/inventario/entities/stock-minimo.entity';
import { LoteUbicacion } from '../modules/items/entities/lote-ubicacion.entity';
import { Compra } from '../modules/compras/entities/compra.entity';
import { CompraLinea } from '../modules/compras/entities/compra-linea.entity';
import { CompraLineaCambio } from '../modules/compras/entities/compra-linea-cambio.entity';
import { TipoDocumentoCompra } from '../modules/compras/entities/tipo-documento-compra.entity';
import { PresentacionCompra } from '../modules/compras/entities/presentacion-compra.entity';
import { CodigoProveedor } from '../modules/compras/entities/codigo-proveedor.entity';
import { PagoProveedor } from '../modules/compras/entities/pago-proveedor.entity';
import { PagoProveedorAplicacion } from '../modules/compras/entities/pago-proveedor-aplicacion.entity';
/**
 * Lo que la app y la CLI de migraciones tienen que ver IGUAL: qué entities
 * hay, dónde están las migraciones y que el esquema no lo toca `synchronize`
 * (ADR-030). Vive aparte de `app.module.ts` porque `data-source.ts` —la CLI—
 * no puede importar el módulo de Nest sin cargar la app entera; si cada uno
 * tuviera su lista, una entity registrada en uno solo generaría migraciones
 * para un esquema que la app no conoce, o al revés.
 *
 * Una entity nueva se registra en `ENTIDADES` (y su módulo, en los `imports`
 * de `app.module.ts`).
 */
export const ENTIDADES = [
  Usuario,
  RefreshToken,
  TokenAcceso,
  Pais,
  Provincia,
  Moneda,
  UnidadMedida,
  ModuloApp,
  Permiso,
  ModuloAppPermiso,
  Tenant,
  UsuarioTenant,
  TenantModulo,
  TenantFormulaPrecio,
  Caja,
  CajaTestigo,
  Cajon,
  CajonUsuario,
  RazonSocial,
  DteCertificado,
  DteCaf,
  DteDocumento,
  DteEnvio,
  Rol,
  RolUsuario,
  ModuloRol,
  RolPermisoModulo,
  TenantMoneda,
  PaisMoneda,
  Categoria,
  Impuesto,
  TipoRegla,
  Descuento,
  DescuentoTramo,
  DescuentoMetodoPago,
  Recargo,
  RecargoTramo,
  RecargoMetodoPago,
  MetodoPago,
  MetodoPagoPais,
  TenantMetodoPago,
  Item,
  ItemProducto,
  ItemServicio,
  ItemSuscripcion,
  ItemReceta,
  RecetaIngrediente,
  RecetaExtraPermitido,
  ItemImpuesto,
  ItemRecargo,
  ItemDescuento,
  ItemLote,
  ItemUnidad,
  ItemCombo,
  ComboComponente,
  MotivoBaja,
  MotivoDiferenciaCaja,
  MotivoDiferenciaInventario,
  MotivoTraslado,
  MovimientoInventario,
  MovimientoInventarioDetalle,
  MovimientoCaja,
  CajaArqueoMedio,
  CajaIntentoRechazado,
  SolicitudIdempotente,
  Venta,
  VentaDetalle,
  VentaDescuento,
  VentaRecargo,
  VentaImpuesto,
  VentaDocumento,
  VentaDocumentoNumeroBorrado,
  VentaCustomer,
  Pago,
  PagoAplicacion,
  VentaPropina,
  PropinaConfiguracion,
  PropinaGrupoDistribucion,
  PropinaGrupoPesoManual,
  LiquidacionPropinas,
  LiquidacionPropinasGrupo,
  LiquidacionPropinasParticipante,
  LiquidacionPropinasFuente,
  LiquidacionPropinasEvento,
  PaqueteConfiguracion,
  Repartidor,
  Paquete,
  HojaRuta,
  HojaRutaPaquete,
  TipoDocumentoTributario,
  UmbralIdentidadPagador,
  Tercero,
  Suscripcion,
  Pasarela,
  TenantPasarela,
  PasarelaApiKey,
  PasarelaInscripcion,
  PasarelaMedioPago,
  PasarelaOrden,
  PasarelaTransaccion,
  CronEjecucion,
  Salon,
  Mesa,
  Cuenta,
  CuentaAsignacion,
  CuentaLinea,
  CuentaLineaAnulacion,
  CuentaLineaReparto,
  Garzon,
  GarzonPinEvento,
  Turno,
  SesionGarzon,
  Impresora,
  GrupoModificador,
  GrupoModificadorOpcion,
  ItemGrupoModificador,
  ItemGrupoModificadorOpcion,
  RecuentoInventario,
  RecuentoInventarioLinea,
  Promocion,
  PromocionScope,
  PromocionScopeItem,
  VentaPromocion,
  Ubicacion,
  StockUbicacion,
  StockMinimo,
  LoteUbicacion,
  Traslado,
  TipoDocumentoCompra,
  Compra,
  CompraLinea,
  CompraLineaCambio,
  PresentacionCompra,
  CodigoProveedor,
  PagoProveedor,
  PagoProveedorAplicacion,
];

/**
 * El glob toma la extensión de ESTE archivo: `.ts` cuando corre desde el fuente
 * (ts-jest, la CLI con ts-node) y `.js` desde `dist/`. Un `*.{ts,js}` fijo
 * levantaría en `dist/` también los `.d.ts` que emite `declaration: true`, y
 * `require` de un `.d.ts` revienta.
 */
const MIGRACIONES = join(__dirname, 'migrations', `*${extname(__filename)}`);

export const opcionesTypeOrm = (
  url: string | undefined,
): PostgresDataSourceOptions => ({
  type: 'postgres',
  url,
  entities: ENTIDADES,
  migrations: [MIGRACIONES],
  // El esquema sale de las migraciones, en todos los entornos (ADR-030).
  synchronize: false,
});
