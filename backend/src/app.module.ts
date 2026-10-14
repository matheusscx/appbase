import { Module } from '@nestjs/common';
import { MailModule } from './modules/mail/mail.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { opcionesTypeOrm } from './database/typeorm.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { LimitesModule } from './common/limites/limites.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RolesModule } from './modules/roles/roles.module';
import { MeModule } from './modules/me/me.module';
import { MonedasModule } from './modules/monedas/monedas.module';
import { SeederModule } from './modules/seeder/seeder.module';
import { CategoriasModule } from './modules/categorias/categorias.module';
import { ImpuestosModule } from './modules/impuestos/impuestos.module';
import { TiposReglaModule } from './modules/tipos-regla/tipos-regla.module';
import { DescuentosModule } from './modules/descuentos/descuentos.module';
import { RecargosModule } from './modules/recargos/recargos.module';
import { MetodosPagoModule } from './modules/metodos-pago/metodos-pago.module';
import { ItemsModule } from './modules/items/items.module';
import { MotivosDiferenciaModule } from './modules/motivos-diferencia/motivos-diferencia.module';
import { InventarioModule } from './modules/inventario/inventario.module';
import { CalculoPreciosModule } from './modules/calculo-precios/calculo-precios.module';
import { CajaModule } from './modules/caja/caja.module';
import { CajonesModule } from './modules/cajones/cajones.module';
import { VentasModule } from './modules/ventas/ventas.module';
import { VentaDocumentosModule } from './modules/venta-documentos/venta-documentos.module';
import { PropinasModule } from './modules/propinas/propinas.module';
import { PagosModule } from './modules/pagos/pagos.module';
import { TercerosModule } from './modules/terceros/terceros.module';
import { OnlineModule } from './modules/online/online.module';
import { SuscripcionesModule } from './modules/suscripciones/suscripciones.module';
import { PasarelaModule } from './modules/pasarela/pasarela.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CronModule } from './modules/cron/cron.module';
import { SalonesModule } from './modules/salones/salones.module';
import { GarzonesModule } from './modules/garzones/garzones.module';
import { TurnosModule } from './modules/turnos/turnos.module';
import { ImpresorasModule } from './modules/impresoras/impresoras.module';
import { MermasModule } from './modules/mermas/mermas.module';
import { MotivosBajaModule } from './modules/motivos-baja/motivos-baja.module';
import { MotivosDiferenciaInventarioModule } from './modules/motivos-diferencia-inventario/motivos-diferencia-inventario.module';
import { MotivosTrasladoModule } from './modules/motivos-traslado/motivos-traslado.module';
import { ResumenNegocioModule } from './modules/resumen-negocio/resumen-negocio.module';
import { IdempotenciaModule } from './modules/idempotencia/idempotencia.module';
import { GruposModificadoresModule } from './modules/grupos-modificadores/grupos-modificadores.module';
import { RecuentosModule } from './modules/recuentos/recuentos.module';
import { PromocionesModule } from './modules/promociones/promociones.module';
import { TrasladosModule } from './modules/traslados/traslados.module';
import { UbicacionesModule } from './modules/ubicaciones/ubicaciones.module';
import { ComprasModule } from './modules/compras/compras.module';
// Reportes de negocio. Sin entidades que sumar a `ENTIDADES` (typeorm.config.ts):
// los reportes solo LEEN tablas que ya registran sus módulos dueños.
import { ReportesModule } from './modules/reportes/reportes.module';

@Module({
  imports: [
    MailModule,
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...opcionesTypeOrm(config.get<string>('DATABASE_URL')),
        // Pool explícito: el default mudo de pg (10) es exactamente lo que el
        // deadlock de conexiones explotaba sin que nadie supiera el número.
        poolSize: Number(config.get<string>('DB_POOL_SIZE') ?? 10),
        // Defensa en profundidad, NO el fix: si algún día algo vuelve a pedir
        // una segunda conexión dentro de una transacción, esto lo convierte en
        // un 500 ruidoso con stack trace en vez de una API muerta hasta
        // reiniciar (pendientes.md, entrada del deadlock).
        connectTimeoutMS: 5000,
        // Las migraciones pendientes corren al arrancar, en todos los entornos:
        // así lo que prueba el CI es lo mismo que arranca en Railway (ADR-030).
        migrationsRun: true,
      }),
    }),
    SeederModule,
    CommonModule,
    LimitesModule,
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
    CajonesModule,
    VentasModule,
    VentaDocumentosModule,
    PagosModule,
    PropinasModule,
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
    MotivosBajaModule,
    GruposModificadoresModule,
    MotivosDiferenciaModule,
    MotivosDiferenciaInventarioModule,
    MotivosTrasladoModule,
    RecuentosModule,
    PromocionesModule,
    UbicacionesModule,
    TrasladosModule,
    ResumenNegocioModule,
    IdempotenciaModule,
    ComprasModule,
    ReportesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
