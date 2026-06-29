import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeederService } from './seeder.service';
import { Moneda } from '../catalog/entities/moneda.entity';
import { Pais } from '../catalog/entities/pais.entity';
import { Provincia } from '../catalog/entities/provincia.entity';
import { ModuloApp } from '../catalog/entities/modulo-app.entity';
import { Permiso } from '../catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from '../tenants/entities/tenant-formula-precio.entity';
import { Usuario } from '../users/usuario.entity';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import { PaisMoneda } from '../monedas/entities/pais-moneda.entity';
import { TenantMoneda } from '../monedas/entities/tenant-moneda.entity';
import { MetodoPago } from '../metodos-pago/entities/metodo-pago.entity';
import { MetodoPagoPais } from '../metodos-pago/entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from '../metodos-pago/entities/tenant-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { Categoria } from '../categorias/entities/categoria.entity';
import { Impuesto } from '../impuestos/entities/impuesto.entity';
import { Descuento } from '../descuentos/entities/descuento.entity';
import { DescuentoTramo } from '../descuentos/entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from '../descuentos/entities/descuento-metodo-pago.entity';
import { Recargo } from '../recargos/entities/recargo.entity';
import { RecargoTramo } from '../recargos/entities/recargo-tramo.entity';
import { RecargoMetodoPago } from '../recargos/entities/recargo-metodo-pago.entity';
import { MovimientoInventario } from '../inventario/entities/movimiento-inventario.entity';
import { TipoDocumentoTributario } from '../ventas/entities/tipo-documento-tributario.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Moneda,
      Pais,
      Provincia,
      ModuloApp,
      Permiso,
      ModuloAppPermiso,
      Tenant,
      TenantModulo,
      TenantFormulaPrecio,
      Usuario,
      RazonSocial,
      PaisMoneda,
      TenantMoneda,
      MetodoPago,
      MetodoPagoPais,
      TenantMetodoPago,
      TipoRegla,
      Categoria,
      Impuesto,
      Descuento,
      DescuentoTramo,
      DescuentoMetodoPago,
      Recargo,
      RecargoTramo,
      RecargoMetodoPago,
      MovimientoInventario,
      TipoDocumentoTributario,
    ]),
  ],
  providers: [SeederService],
})
export class SeederModule {}
