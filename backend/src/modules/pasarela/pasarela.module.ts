import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pasarela } from './entities/pasarela.entity';
import { TenantPasarela } from './entities/tenant-pasarela.entity';
import { PasarelaApiKey } from './entities/pasarela-api-key.entity';
import { PasarelaInscripcion } from './entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from './entities/pasarela-medio-pago.entity';
import { PasarelaOrden } from './entities/pasarela-orden.entity';
import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import { CredencialesService } from './services/credenciales.service';
import { ApiKeysService } from './services/api-keys.service';
import { TenantPasarelaService } from './services/tenant-pasarela.service';
import { TransaccionesService } from './services/transacciones.service';
import { InscripcionesService } from './services/inscripciones.service';
import { CobrosService } from './services/cobros.service';
import { PagosRedirectService } from './services/pagos-redirect.service';
import { CallbackDispatcherService } from './services/callback-dispatcher.service';
import { PagoCallbackRegistry } from './services/pago-callback.registry';
import { ReembolsoCallbackRegistry } from './services/reembolso-callback.registry';
import { OneclickProvider } from './providers/oneclick/oneclick.provider';
import { WebpayPlusProvider } from './providers/webpay-plus/webpay-plus.provider';
import { ProviderFactory } from './providers/provider.factory';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PasarelaAdminController } from './controllers/pasarela-admin.controller';
import { PasarelaApiController } from './controllers/pasarela-api.controller';
import { PasarelaRetornoController } from './controllers/pasarela-retorno.controller';

/**
 * Módulo pasarela — "junto pero no revuelto":
 * NO importa módulos de negocio (ventas/pagos/suscripciones/...).
 * Los módulos de negocio que quieran cobrar importan PasarelaModule e
 * inyectan InscripcionesService / CobrosService.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Pasarela,
      TenantPasarela,
      PasarelaApiKey,
      PasarelaInscripcion,
      PasarelaMedioPago,
      PasarelaOrden,
      PasarelaTransaccion,
    ]),
  ],
  controllers: [
    PasarelaAdminController,
    PasarelaApiController,
    PasarelaRetornoController,
  ],
  providers: [
    CredencialesService,
    ApiKeysService,
    TenantPasarelaService,
    TransaccionesService,
    InscripcionesService,
    CobrosService,
    PagosRedirectService,
    CallbackDispatcherService,
    PagoCallbackRegistry,
    ReembolsoCallbackRegistry,
    OneclickProvider,
    WebpayPlusProvider,
    ProviderFactory,
    ApiKeyGuard,
  ],
  exports: [
    CredencialesService,
    InscripcionesService,
    CobrosService,
    PagosRedirectService,
    TenantPasarelaService,
    PagoCallbackRegistry,
    ReembolsoCallbackRegistry,
  ],
})
export class PasarelaModule {}
