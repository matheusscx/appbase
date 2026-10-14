import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import { CifradoDteService } from './cifrado-dte.service';
import { DteController } from './dte.controller';
import { DteCaf } from './entities/dte-caf.entity';
import { DteCertificado } from './entities/dte-certificado.entity';
import { PerfilFiscalService } from './perfil-fiscal.service';

@Module({
  imports: [
    RepositoriosModule.forFeature([DteCertificado, DteCaf, RazonSocial]),
  ],
  controllers: [DteController],
  providers: [PerfilFiscalService, CifradoDteService],
  exports: [PerfilFiscalService, CifradoDteService],
})
export class DteModule {}
