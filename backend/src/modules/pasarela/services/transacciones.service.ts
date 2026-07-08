import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
  // también la escritura de la transacción REFUND). Sin él, usa el repo normal.
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
}
