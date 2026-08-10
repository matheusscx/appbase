import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  /**
   * Ventana en la que un `ok` ya medido se reusa sin volver a pegarle a la base.
   * Corta a propósito: la sonda tiene que seguir detectando una caída en
   * segundos, no en minutos.
   */
  private static readonly VENTANA_SALUD_MS = 2_000;
  private saludOkHasta = 0;

  /**
   * Sonda en vuelo, para que las requests concurrentes esperen la misma query en
   * vez de lanzar una cada una. Sin esto la ventana solo frena el abuso por tasa
   * sostenida: en el borde de cada expiración, todo lo que llegue durante el
   * round-trip pasa el `if` y pega a la base en paralelo, que es justo la forma
   * que tiene un flood.
   */
  private sondaEnVuelo: Promise<void> | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * Ruta del `healthcheckPath` de Railway (ver `backend/railway.json`). Contesta
   * 200 solo si la base responde; si no, 503, que es lo que —según la doc de
   * Railway— frena la promoción del deployment.
   *
   * Consulta `usuarios` en vez de un `SELECT 1` a secas a propósito: un
   * `DATABASE_URL` apuntado a un Postgres equivocado —vacío pero vivo— pasa un
   * `SELECT 1` y deja la app inservible con el semáforo en verde. Pedirle una fila
   * a una tabla que el seed siempre puebla distingue "hay conexión" de "hay
   * conexión a NUESTRA base". El `LIMIT 1` la hace despreciable.
   *
   * El `eliminado_el IS NULL` no cambia el resultado —la sonda mira si la query
   * tira, no cuántas filas vuelven— pero mantiene el invariante sin excepciones
   * que después haya que discutir, y de paso cubre una columna más del esquema.
   *
   * ⚠️ Es anónima y toca la base, y encima cualquiera de internet sabe su URL
   * —está en `railway.json`—. Sin defensa, un flood compite por las ~10
   * conexiones del pool de `pg` —el default, `app.module.ts` no lo sube— con el
   * tráfico autenticado real. Son dos defensas y hacen falta las dos: la ventana
   * corta el abuso por **tasa**, el single-flight corta el de **concurrencia**.
   * El fallo NO se cachea: una base caída tiene que reportarse en la request
   * siguiente. (No es la única ruta anónima que consulta la base:
   * `pasarela/retorno/*` también lo es, con su propio modelo de credencial —el
   * token de un solo uso de Transbank— y sin esta protección.)
   *
   * Alcance honesto: ambas son **por proceso**. Con varias réplicas, cada una
   * tiene su propia ventana.
   */
  async verificarSalud(): Promise<{ estado: string; base: string }> {
    if (Date.now() < this.saludOkHasta) return { estado: 'ok', base: 'ok' };

    this.sondaEnVuelo ??= this.sondear().finally(() => {
      this.sondaEnVuelo = null;
    });
    await this.sondaEnVuelo;

    return { estado: 'ok', base: 'ok' };
  }

  private async sondear(): Promise<void> {
    try {
      await this.dataSource.query(
        'SELECT 1 FROM usuarios WHERE eliminado_el IS NULL LIMIT 1',
      );
    } catch (error) {
      // El detalle va al log, no a la respuesta: la ruta es pública y sin auth,
      // y el error de conexión trae host y usuario de la base.
      this.logger.error('Healthcheck: la base no respondió', error);
      throw new ServiceUnavailableException('La base de datos no responde');
    }
    this.saludOkHasta = Date.now() + AppService.VENTANA_SALUD_MS;
  }
}
