import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';
import { InventarioModule } from '../inventario/inventario.module';
import { UbicacionesModule } from '../ubicaciones/ubicaciones.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { Compra } from './entities/compra.entity';
import { CompraLinea } from './entities/compra-linea.entity';
import { CompraLineaCambio } from './entities/compra-linea-cambio.entity';
import { TipoDocumentoCompra } from './entities/tipo-documento-compra.entity';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Compra,
      CompraLinea,
      CompraLineaCambio,
      TipoDocumentoCompra,
    ]),
    // `crearConversor`: la unidad de cada línea tiene que ser compatible con
    // la base del producto.
    CatalogModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // este módulo: el `@EsCosto()` del precio no valida nada sin el pipe.
    // Confirmar lo usa además para los decimales de la moneda oficial.
    MonedasModule,
    // Confirmar: cada línea es una entrada por el chokepoint del kardex, y el
    // stock total congelado en la línea sale de la misma función que el CPP.
    InventarioModule,
    // Confirmar: el lock de la ubicación contra su borrado va ANTES del de los
    // productos (orden de `docs/patterns/backend.md` §15).
    UbicacionesModule,
    // Confirmar: `cargarConfig` para repartir el descuento al total a la escala
    // de la moneda.
    CalculoPreciosModule,
  ],
  controllers: [ComprasController],
  providers: [ComprasService],
  exports: [ComprasService],
})
export class ComprasModule {}
