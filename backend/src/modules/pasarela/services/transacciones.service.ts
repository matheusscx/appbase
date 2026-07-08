import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  registrar(datos: Partial<PasarelaTransaccion>): Promise<PasarelaTransaccion> {
    // Historial inmutable: jamás aceptar un transaccionId externo — save() con
    // PK existente haría UPDATE y rompería la garantía de solo-INSERT.
    const { transaccionId: _ignorado, ...resto } = datos;
    return this.repo.save(
      this.repo.create({
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
  ): Promise<PasarelaTransaccion[]> {
    return this.repo.find({
      where: { tenantId, ordenId },
      order: { fechaTransaccion: 'ASC' },
    });
  }
}
