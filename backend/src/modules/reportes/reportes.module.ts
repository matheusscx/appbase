import { Module } from '@nestjs/common';
import { VarianzaController } from './varianza/varianza.controller';
import { VarianzaService } from './varianza/varianza.service';

/**
 * Los reportes **de negocio** de la app: los que alguien mira para entender cómo
 * va el local y decidir, no para operar mientras hace la tarea.
 *
 * La línea la fijó el owner el 2026-09-19 (*"el módulo reporte es más de negocio
 * que de operación"*):
 *
 * - **Operación** — lo mira quien está haciendo la tarea AHORA, para actuar:
 *   buscar una boleta, ver qué se movió, aprobar un cierre. Listado filtrable,
 *   vive en su propio módulo aunque tenga filtro de fecha.
 * - **Negocio** — mira hacia atrás sobre un rango, **agrega** y se compara con
 *   otro período. Vive acá.
 *
 * 📌 **Los reportes que ya existían NO se mudaron** (decisión del owner, misma
 * fecha): este módulo nace solo con los nuevos y el criterio se aplica hacia
 * adelante. La clasificación de los que ya están, y cuáles son candidatos a
 * mudarse de a uno, viven en `docs/features/modulo-reportes.md` y en
 * `docs/agent/pendientes.md`.
 *
 * ⚠️ **Cada reporte es su propio `modulo_app`** con permiso `Leer`, agrupados
 * bajo "Reportes" solo en el menú. No hay un `Reportes:Leer` común, y el porqué
 * está en el docblock de `VarianzaController.findAll`.
 *
 * Una carpeta por reporte (`varianza/`), con su controller, su service y sus
 * DTOs. Lo que compartan todos —cuando haya un segundo reporte que lo pida—
 * vive en `dto/` a este nivel; hoy no hay nada ahí, y un DTO base sin ningún
 * consumidor sería código muerto. Las convenciones que todo reporte sigue
 * (rango, paginación, el día del negocio, la plata) están escritas en
 * `docs/patterns/backend.md` § 10c, que es donde el próximo las va a buscar.
 *
 * Sin entidad propia ni `forFeature`: los reportes **leen** con SQL raw tablas
 * que ya registran sus módulos dueños. `Db` es global (`CommonModule`) y
 * `RbacService` —el que resuelve `PermisosGuard`— también, así que este módulo
 * no importa ninguno de los dos; mismo esqueleto que `ResumenNegocioModule`.
 */
@Module({
  controllers: [VarianzaController],
  providers: [VarianzaService],
})
export class ReportesModule {}
