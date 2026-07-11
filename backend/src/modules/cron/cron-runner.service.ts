import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';

/**
 * Envoltorio común de ejecución de jobs internos: registra cada corrida en
 * cron_ejecuciones, captura errores sin propagarlos (un job roto no debe
 * tumbar el scheduler) y evita solapamiento por job con un set en memoria
 * (instancia única; locking distribuido queda fuera de alcance).
 */
@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger(CronRunnerService.name);
  private readonly enCurso = new Set<string>();

  constructor(
    @InjectRepository(CronEjecucion)
    private readonly ejecucionRepo: Repository<CronEjecucion>,
  ) {}

  async ejecutar(job: string, fn: () => Promise<string>): Promise<void> {
    if (this.enCurso.has(job)) {
      this.logger.debug(`Job "${job}" aún en curso; tick omitido`);
      return;
    }
    this.enCurso.add(job);
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
    } finally {
      this.enCurso.delete(job);
    }
  }
}
