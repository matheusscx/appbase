import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';

/**
 * Envoltorio común de ejecución de jobs internos: registra cada corrida en
 * cron_ejecuciones, captura errores sin propagarlos (un job roto no debe
 * tumbar el scheduler) y evita solapamiento por job con un set en memoria
 * (instancia única; locking distribuido queda fuera de alcance).
 *
 * Al apagar (SIGTERM de un deploy) no arranca corridas nuevas y espera las que
 * están en curso antes de que cierre el pool: cortada a mitad, la corrida
 * quedaba en `en_curso` para siempre, porque el registro de cierre ya no tenía
 * conexión. Va en `beforeApplicationShutdown` y no en `onApplicationShutdown`
 * para frenar los ticks antes de que el servidor HTTP empiece a drenar, que
 * puede tardar.
 */
@Injectable()
export class CronRunnerService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(CronRunnerService.name);
  private readonly enCurso = new Map<string, Promise<void>>();
  private apagando = false;

  constructor(
    @InjectRepository(CronEjecucion)
    private readonly ejecucionRepo: Repository<CronEjecucion>,
  ) {}

  async beforeApplicationShutdown(): Promise<void> {
    this.apagando = true;
    await Promise.all(this.enCurso.values());
  }

  async ejecutar(job: string, fn: () => Promise<string>): Promise<void> {
    if (this.apagando) {
      this.logger.debug(`Job "${job}": la app se está apagando; tick omitido`);
      return;
    }
    if (this.enCurso.has(job)) {
      this.logger.debug(`Job "${job}" aún en curso; tick omitido`);
      return;
    }
    const corrida = this.correr(job, fn).finally(() =>
      this.enCurso.delete(job),
    );
    this.enCurso.set(job, corrida);
    await corrida;
  }

  private async correr(job: string, fn: () => Promise<string>): Promise<void> {
    try {
      const ejecucion = await this.ejecucionRepo.save(
        this.ejecucionRepo.create({
          job,
          iniciadoEl: new Date(),
          estado: 'en_curso',
        }),
      );
      let resultado: Pick<CronEjecucion, 'estado' | 'detalle' | 'error'>;
      try {
        resultado = { estado: 'ok', detalle: await fn(), error: null };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        this.logger.error(`Job "${job}" falló: ${error}`);
        resultado = { estado: 'error', detalle: null, error };
      }
      await this.ejecucionRepo.save({
        ...ejecucion,
        ...resultado,
        finalizadoEl: new Date(),
      });
    } catch (e) {
      // Fallo de persistencia del registro: log y seguir; el próximo tick reintenta.
      this.logger.error(
        `No se pudo registrar la ejecución del job "${job}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}
