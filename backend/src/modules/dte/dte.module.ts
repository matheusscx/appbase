import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { CronModule } from '../cron/cron.module';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import { CifradoDteService } from './cifrado-dte.service';
import { ColaDteService } from './cola-dte.service';
import { DteController } from './dte.controller';
import { DteCaf } from './entities/dte-caf.entity';
import { DteCertificado } from './entities/dte-certificado.entity';
import { DteDocumento } from './entities/dte-documento.entity';
import { DteEnvio } from './entities/dte-envio.entity';
import { FoliosService } from './folios.service';
import { ConsultarEnviosJob } from './jobs/consultar-envios.job';
import { EnviarBoletasJob } from './jobs/enviar-boletas.job';
import { PerfilFiscalService } from './perfil-fiscal.service';
import { SiiBoletaCliente } from './sii-boleta.cliente';

@Module({
  imports: [
    CronModule,
    RepositoriosModule.forFeature([
      DteCertificado,
      DteCaf,
      DteDocumento,
      DteEnvio,
      RazonSocial,
    ]),
  ],
  controllers: [DteController],
  providers: [
    PerfilFiscalService,
    CifradoDteService,
    FoliosService,
    ColaDteService,
    SiiBoletaCliente,
    EnviarBoletasJob,
    ConsultarEnviosJob,
  ],
  exports: [
    PerfilFiscalService,
    CifradoDteService,
    FoliosService,
    ColaDteService,
  ],
})
export class DteModule {}
