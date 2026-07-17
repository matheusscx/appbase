import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RolesModule } from './modules/roles/roles.module';
import { MeModule } from './modules/me/me.module';
import { Usuario } from './modules/users/usuario.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { Pais } from './modules/catalog/entities/pais.entity';
import { Provincia } from './modules/catalog/entities/provincia.entity';
import { Moneda } from './modules/catalog/entities/moneda.entity';
import { UnidadMedida } from './modules/catalog/entities/unidad-medida.entity';
import { ModuloApp } from './modules/catalog/entities/modulo-app.entity';
import { Permiso } from './modules/catalog/entities/permiso.entity';
import { ModuloAppPermiso } from './modules/catalog/entities/modulo-app-permiso.entity';
import { Tenant } from './modules/tenants/entities/tenant.entity';
import { UsuarioTenant } from './modules/tenants/entities/usuario-tenant.entity';
import { TenantModulo } from './modules/tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './modules/tenants/entities/tenant-formula-precio.entity';
import { Caja } from './modules/caja/entities/caja.entity';
import { MovimientoCaja } from './modules/caja/entities/movimiento-caja.entity';
import { RazonSocial } from './modules/tenants/entities/razon-social.entity';
import { Rol } from './modules/roles/entities/rol.entity';
import { RolUsuario } from './modules/roles/entities/rol-usuario.entity';
import { ModuloRol } from './modules/roles/entities/modulo-rol.entity';
import { RolPermisoModulo } from './modules/roles/entities/rol-permiso-modulo.entity';
import { TenantMoneda } from './modules/monedas/entities/tenant-moneda.entity';
import { PaisMoneda } from './modules/monedas/entities/pais-moneda.entity';
import { MonedasModule } from './modules/monedas/monedas.module';
import { SeederModule } from './modules/seeder/seeder.module';
import { Categoria } from './modules/categorias/entities/categoria.entity';
import { CategoriasModule } from './modules/categorias/categorias.module';
import { Impuesto } from './modules/impuestos/entities/impuesto.entity';
import { ImpuestosModule } from './modules/impuestos/impuestos.module';
import { TipoRegla } from './modules/tipos-regla/entities/tipo-regla.entity';
import { TiposReglaModule } from './modules/tipos-regla/tipos-regla.module';
import { Descuento } from './modules/descuentos/entities/descuento.entity';
import { DescuentoTramo } from './modules/descuentos/entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './modules/descuentos/entities/descuento-metodo-pago.entity';
import { DescuentosModule } from './modules/descuentos/descuentos.module';
import { Recargo } from './modules/recargos/entities/recargo.entity';
import { RecargoTramo } from './modules/recargos/entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './modules/recargos/entities/recargo-metodo-pago.entity';
import { RecargosModule } from './modules/recargos/recargos.module';
import { MetodoPago } from './modules/metodos-pago/entities/metodo-pago.entity';
import { MetodoPagoPais } from './modules/metodos-pago/entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from './modules/metodos-pago/entities/tenant-metodo-pago.entity';
import { MetodosPagoModule } from './modules/metodos-pago/metodos-pago.module';
import { Item } from './modules/items/entities/item.entity';
import { ItemProducto } from './modules/items/entities/item-producto.entity';
import { ItemServicio } from './modules/items/entities/item-servicio.entity';
import { ItemSuscripcion } from './modules/items/entities/item-suscripcion.entity';
import { ItemReceta } from './modules/items/entities/item-receta.entity';
import { RecetaIngrediente } from './modules/items/entities/receta-ingrediente.entity';
import { RecetaExtraPermitido } from './modules/items/entities/receta-extra-permitido.entity';
import { ItemImpuesto } from './modules/items/entities/item-impuesto.entity';
import { ItemRecargo } from './modules/items/entities/item-recargo.entity';
import { ItemDescuento } from './modules/items/entities/item-descuento.entity';
import { ItemLote } from './modules/items/entities/item-lote.entity';
import { ItemUnidad } from './modules/items/entities/item-unidad.entity';
import { ItemsModule } from './modules/items/items.module';
import { MovimientoInventario } from './modules/inventario/entities/movimiento-inventario.entity';
import { MovimientoInventarioDetalle } from './modules/inventario/entities/movimiento-inventario-detalle.entity';
import { CausaMerma } from './modules/mermas/entities/causa-merma.entity';
import { InventarioModule } from './modules/inventario/inventario.module';
import { CalculoPreciosModule } from './modules/calculo-precios/calculo-precios.module';
import { CajaModule } from './modules/caja/caja.module';
import { VentasModule } from './modules/ventas/ventas.module';
import { Venta } from './modules/ventas/entities/venta.entity';
import { VentaDetalle } from './modules/ventas/entities/venta-detalle.entity';
import { VentaDescuento } from './modules/ventas/entities/venta-descuento.entity';
import { VentaRecargo } from './modules/ventas/entities/venta-recargo.entity';
import { VentaImpuesto } from './modules/ventas/entities/venta-impuesto.entity';
import { VentaCustomer } from './modules/ventas/entities/venta-customer.entity';
import { Pago } from './modules/pagos/entities/pago.entity';
import { PagosModule } from './modules/pagos/pagos.module';
import { TipoDocumentoTributario } from './modules/ventas/entities/tipo-documento-tributario.entity';
import { Tercero } from './modules/terceros/entities/tercero.entity';
import { TercerosModule } from './modules/terceros/terceros.module';
import { OnlineModule } from './modules/online/online.module';
import { Suscripcion } from './modules/suscripciones/entities/suscripcion.entity';
import { SuscripcionesModule } from './modules/suscripciones/suscripciones.module';
import { PasarelaModule } from './modules/pasarela/pasarela.module';
import { Pasarela } from './modules/pasarela/entities/pasarela.entity';
import { TenantPasarela } from './modules/pasarela/entities/tenant-pasarela.entity';
import { PasarelaApiKey } from './modules/pasarela/entities/pasarela-api-key.entity';
import { PasarelaInscripcion } from './modules/pasarela/entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from './modules/pasarela/entities/pasarela-medio-pago.entity';
import { PasarelaOrden } from './modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from './modules/pasarela/entities/pasarela-transaccion.entity';
import { CronEjecucion } from './modules/cron/entities/cron-ejecucion.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { CronModule } from './modules/cron/cron.module';
import { SalonesModule } from './modules/salones/salones.module';
import { Salon } from './modules/salones/entities/salon.entity';
import { Mesa } from './modules/salones/entities/mesa.entity';
import { Cuenta } from './modules/salones/entities/cuenta.entity';
import { CuentaLinea } from './modules/salones/entities/cuenta-linea.entity';
import { CuentaAsignacion } from './modules/salones/entities/cuenta-asignacion.entity';
import { GarzonesModule } from './modules/garzones/garzones.module';
import { Garzon } from './modules/garzones/entities/garzon.entity';
import { TurnosModule } from './modules/turnos/turnos.module';
import { Turno } from './modules/turnos/entities/turno.entity';
import { SesionGarzon } from './modules/turnos/entities/sesion-garzon.entity';
import { ImpresorasModule } from './modules/impresoras/impresoras.module';
import { MermasModule } from './modules/mermas/mermas.module';
import { Impresora } from './modules/impresoras/entities/impresora.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        // dev: schema managed by TypeORM synchronize; prod: use migrations
        entities: [
          Usuario,
          RefreshToken,
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
          RazonSocial,
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
          CausaMerma,
          MovimientoInventario,
          MovimientoInventarioDetalle,
          MovimientoCaja,
          Venta,
          VentaDetalle,
          VentaDescuento,
          VentaRecargo,
          VentaImpuesto,
          VentaCustomer,
          Pago,
          TipoDocumentoTributario,
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
          Garzon,
          Turno,
          SesionGarzon,
          Impresora,
        ],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    SeederModule,
    CommonModule,
    CatalogModule,
    UsersModule,
    AuthModule,
    TenantsModule,
    RbacModule,
    RolesModule,
    MeModule,
    MonedasModule,
    CategoriasModule,
    ImpuestosModule,
    TiposReglaModule,
    DescuentosModule,
    RecargosModule,
    MetodosPagoModule,
    ItemsModule,
    InventarioModule,
    CalculoPreciosModule,
    CajaModule,
    VentasModule,
    PagosModule,
    TercerosModule,
    OnlineModule,
    SuscripcionesModule,
    PasarelaModule,
    ScheduleModule.forRoot(),
    CronModule,
    SalonesModule,
    GarzonesModule,
    TurnosModule,
    ImpresorasModule,
    MermasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
