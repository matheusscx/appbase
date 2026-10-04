import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';

const CLAVES_SENSIBLES = new Set([
  'tbk-api-key-secret',
  'tbk-api-key-id',
  'authorization',
  'tbk_user',
  'token',
  'apikeysecret',
  'api_key_secret',
]);

@Injectable()
export class TransaccionesService {
  constructor(
    @InjectRepository(PasarelaTransaccion)
    private readonly repo: Repository<PasarelaTransaccion>,
  ) {}

  /** Enmascara recursivamente credenciales y tokens — nunca persisten en claro. */
  redactar(obj: Record<string, unknown>): Record<string, unknown> {
    const limpiar = (valor: unknown): unknown => {
      if (Array.isArray(valor)) return valor.map(limpiar);
      if (valor && typeof valor === 'object') {
        return Object.fromEntries(
          Object.entries(valor as Record<string, unknown>).map(([k, v]) =>
            CLAVES_SENSIBLES.has(k.toLowerCase())
              ? [k, '[REDACTADO]']
              : [k, limpiar(v)],
          ),
        );
      }
      return valor;
    };
    return limpiar(obj) as Record<string, unknown>;
  }

  // `manager` opcional: cuando se pasa, la operación corre dentro de esa
  // transacción (necesario para que el lock pesimista del reembolso proteja
  // también la escritura de la transacción REFUND).
  //
  // ⚠️ Omitirlo NO significa "fuera de la transacción" — el contrato se dio
  // vuelta con ADR-020. `this.repo` es el proxy context-aware de
  // `RepositoriosModule`: sin `manager` participa de la transacción ambiente
  // que haya en el contexto ALS, y un rollback se lleva puesta la fila. Antes
  // la rama `else` sí era una conexión propia — por eso el rastro de auditoría
  // de un timeout se registraba así. Hoy correr deliberadamente fuera se pide
  // explícito: `db.sinTransaccion(() => ...)`. El único llamador que lo
  // necesita (`cobros.service.ts`, el `catch` del timeout de reembolso) ya
  // quedó léxicamente fuera del callback de la transacción.
  // Vale para las dos apariciones de este idioma en el archivo.
  registrar(
    datos: Partial<PasarelaTransaccion>,
    manager?: EntityManager,
  ): Promise<PasarelaTransaccion> {
    const repo = manager
      ? manager.getRepository(PasarelaTransaccion)
      : this.repo;
    // Historial inmutable: jamás aceptar un transaccionId externo — save() con
    // PK existente haría UPDATE y rompería la garantía de solo-INSERT.
    const resto = { ...datos };
    delete resto.transaccionId;
    return repo.save(
      repo.create({
        ...resto,
        request: this.redactar(datos.request ?? {}),
        response: this.redactar(datos.response ?? {}),
        fechaTransaccion: datos.fechaTransaccion ?? new Date(),
      }),
    );
  }

  listarPorOrden(
    tenantId: string,
    ordenId: string,
    manager?: EntityManager,
  ): Promise<PasarelaTransaccion[]> {
    const repo = manager
      ? manager.getRepository(PasarelaTransaccion)
      : this.repo;
    return repo.find({
      where: { tenantId, ordenId },
      order: { fechaTransaccion: 'ASC' },
    });
  }

  /**
   * Liga un REFUND con la corrección que dejó en ventas. Es lo ÚNICO que se
   * escribe sobre una fila ya registrada: el vínculo nace después del commit del
   * REFUND (lo crea el hook post-commit), y no toca `estado` ni nada de lo que la
   * pasarela informó. Escribe una sola vez (`correccion_venta_id IS NULL`) y
   * acotado al tenant del token, no al id suelto. Devuelve si ligó una fila: `false`
   * es que no había ninguna que ligar (otro tenant, ya ligada, borrada).
   *
   * Corre con el `manager` de la transacción que crea la corrección, antes de su
   * commit: corrección y vínculo existen los dos o ninguno.
   */
  async vincularCorreccion(
    tenantId: string,
    transaccionId: string,
    correccionVentaId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const repo = manager
      ? manager.getRepository(PasarelaTransaccion)
      : this.repo;
    const res = await repo.update(
      {
        transaccionId,
        tenantId,
        eliminadoEl: IsNull(),
        correccionVentaId: IsNull(),
      },
      { correccionVentaId },
    );
    return res.affected === 1;
  }

  /** El REFUND que escribió el reclamo de `Idempotency-Key` (ADR-029). */
  reembolsoDeSolicitud(
    tenantId: string,
    solicitudIdempotenteId: string,
  ): Promise<PasarelaTransaccion | null> {
    return this.repo.findOne({
      where: {
        tenantId,
        solicitudIdempotenteId,
        tipo: 'REFUND',
        eliminadoEl: IsNull(),
      },
    });
  }

  /**
   * Cierra un REFUND "sin confirmar" (`iniciada` o `error`) en `aprobada` o
   * `rechazada`, una sola vez. Es la SEGUNDA excepción al solo-INSERT del
   * historial, al lado de `vincularCorreccion`, y con el mismo cuidado:
   * - **compare-and-set**: un solo `UPDATE` cuyo `WHERE` exige el estado de
   *   origen. Nunca vuelve atrás ni pasa de un final a otro, ni siquiera con
   *   dos escritores a la vez: el segundo no encuentra fila. `false` = otro ya
   *   la resolvió (o es de otro tenant, o está borrada) y no se tocó nada; el
   *   llamador relee y responde eso;
   * - acotada al tenant del token y al tipo REFUND;
   * - deja **cómo** se resolvió (`resolucion`), quién y cuándo.
   *
   * Existe porque el REFUND se escribe en `iniciada` ANTES de llamar al
   * proveedor (write-ahead): si el proceso cae después de que Transbank
   * devolvió la plata, la fila es la única huella de que el intento existió
   * (ADR-029).
   */
  async resolverReembolso(
    tenantId: string,
    transaccionId: string,
    r: {
      estado: 'aprobada' | 'rechazada';
      resolucion: 'proveedor' | 'saldo' | 'manual' | 'no_enviado';
      resueltaPor: string | null;
      codigoRespuesta?: string | null;
      codigoAutorizacion?: string | null;
      tipoPago?: string | null;
      request?: Record<string, unknown>;
      response?: Record<string, unknown>;
      /** Se suma a la `metadata` de la fila (p. ej. el motivo de un "no salió"). */
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    // El cast es por los `jsonb`: TypeORM tipa su update en profundidad y un
    // `Record<string, unknown>` no entra en ese tipo, aunque es lo que guarda.
    const cambios = {
      estado: r.estado,
      resolucion: r.resolucion,
      resueltaPor: r.resueltaPor,
      resueltaEl: new Date(),
      ...(r.codigoRespuesta !== undefined && {
        codigoRespuesta: r.codigoRespuesta,
      }),
      ...(r.codigoAutorizacion !== undefined && {
        codigoAutorizacion: r.codigoAutorizacion,
      }),
      ...(r.tipoPago !== undefined && { tipoPago: r.tipoPago }),
      ...(r.request && { request: this.redactar(r.request) }),
      ...(r.response && { response: this.redactar(r.response) }),
      // Se suma en la misma sentencia: leerla antes y escribirla después
      // dejaría una ventana para pisar lo que otro escribió en el medio.
      ...(r.metadata && {
        metadata: () =>
          "COALESCE(metadata, '{}'::jsonb) || CAST(:metadataNueva AS jsonb)",
      }),
    } as QueryDeepPartialEntity<PasarelaTransaccion>;
    const res = await this.repo
      .createQueryBuilder()
      .update(PasarelaTransaccion)
      .set(cambios)
      .where('transaccion_id = :transaccionId', { transaccionId })
      .andWhere('tenant_id = :tenantId', { tenantId })
      .andWhere("tipo = 'REFUND'")
      .andWhere("estado IN ('iniciada', 'error')")
      .andWhere('eliminado_el IS NULL')
      .setParameter('metadataNueva', JSON.stringify(r.metadata ?? {}))
      .execute();
    return res.affected === 1;
  }

  /**
   * Guarda el `request`/`response` de una llamada que no llegó a confirmarse
   * (error de red, 5xx, timeout) sobre el REFUND que sigue en `iniciada`: la
   * fila no es final, así que es mutable. No cambia el estado: "sin
   * confirmar" no es rechazo (el proveedor pudo haber devuelto la plata).
   */
  async registrarIntentoSinConfirmar(
    tenantId: string,
    transaccionId: string,
    intento: {
      request: Record<string, unknown>;
      response: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.repo.update(
      {
        transaccionId,
        tenantId,
        tipo: 'REFUND',
        estado: 'iniciada',
        eliminadoEl: IsNull(),
      },
      {
        request: this.redactar(intento.request),
        response: this.redactar(intento.response),
      } as QueryDeepPartialEntity<PasarelaTransaccion>,
    );
  }
}
