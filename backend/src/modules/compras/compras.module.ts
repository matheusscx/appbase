import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';
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
    MonedasModule,
  ],
  controllers: [ComprasController],
  providers: [ComprasService],
  exports: [ComprasService],
})
export class ComprasModule {}
