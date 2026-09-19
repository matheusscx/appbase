import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Compra } from './entities/compra.entity';
import { CompraLinea } from './entities/compra-linea.entity';
import { CompraLineaCambio } from './entities/compra-linea-cambio.entity';
import { TipoDocumentoCompra } from './entities/tipo-documento-compra.entity';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Compra,
      CompraLinea,
      CompraLineaCambio,
      TipoDocumentoCompra,
    ]),
  ],
})
export class ComprasModule {}
