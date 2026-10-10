import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { SalonesService } from './salones.service';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import { AnulacionesReporteService } from './anulaciones-reporte.service';
import {
  SalonesController,
  MesasController,
  CuentasController,
} from './salones.controller';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta } from './entities/cuenta.entity';
import { CuentaAsignacion } from './entities/cuenta-asignacion.entity';
import { CuentaLineaAnulacion } from './entities/cuenta-linea-anulacion.entity';
import { CuentaLineaReparto } from './entities/cuenta-linea-reparto.entity';
import { VentasModule } from '../ventas/ventas.module';
import { GarzonesModule } from '../garzones/garzones.module';
import { ItemsModule } from '../items/items.module';
import { CatalogModule } from '../catalog/catalog.module';
import { TurnosModule } from '../turnos/turnos.module';
import { MonedasModule } from '../monedas/monedas.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { MotivosBajaModule } from '../motivos-baja/motivos-baja.module';
import { UbicacionesModule } from '../ubicaciones/ubicaciones.module';
import { InventarioModule } from '../inventario/inventario.module';
import { IdempotenciaModule } from '../idempotencia/idempotencia.module';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Salon,
      Mesa,
      Cuenta,
      CuentaAsignacion,
      CuentaLineaAnulacion,
      CuentaLineaReparto,
    ]),
    VentasModule,
    GarzonesModule,
    ItemsModule,
    CatalogModule,
    TurnosModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    // El detalle priceado de la personalización se devuelve convertido a
    // moneda oficial: `convertirAMonedaOficial` + `cargarConfig` salen de acá.
    CalculoPreciosModule,
    // `anularLinea` valida el motivo con `assertMotivoActivo`. Ninguno de los
    // dos importa `SalonesModule` — no hay ciclo.
    MotivosBajaModule,
    // `anularLinea` resuelve `UbicacionesService.localDe` para el
    // `ubicacionLocalId` que le pasa a `ItemsService.consumirLineaAnulada`.
    UbicacionesModule,
    // `agregarLinea`/`actualizarLinea` validan y lockean las unidades con número
    // de serie con `InventarioService.bloquearUnidadesParaSalida`, la misma
    // regla que usa la venta al sacarlas.
    InventarioModule,
    IdempotenciaModule,
    // `cerrarCuenta` deja el rastro del tope del esperado con
    // `CajaService.conRastroDeRechazo`. `CajaModule` no llega a `SalonesModule`
    // por ningún import —no hay ciclo—.
    CajaModule,
  ],
  controllers: [SalonesController, MesasController, CuentasController],
  providers: [
    SalonesService,
    CuentaAsignacionesService,
    AnulacionesReporteService,
  ],
  // `AnulacionesReporteService` exportado para `ResumenNegocioModule` (Task 2,
  // spec 2026-09-18-dashboard-inicio § 4.4): `perdidas.anulaciones` reusa
  // `resumen()` tal cual, sin reescribir su SQL.
  exports: [
    SalonesService,
    CuentaAsignacionesService,
    AnulacionesReporteService,
  ],
})
export class SalonesModule {}
