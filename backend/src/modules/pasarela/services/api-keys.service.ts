import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { PasarelaApiKey } from '../entities/pasarela-api-key.entity';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(PasarelaApiKey)
    private readonly repo: Repository<PasarelaApiKey>,
  ) {}

  async crear(tenantId: string, nombre: string) {
    const apiKey = `pk_${randomBytes(30).toString('base64url')}`; // 'pk_' + 40 chars
    const guardada = await this.repo.save(
      this.repo.create({
        tenantId,
        nombre,
        prefijo: apiKey.slice(0, 10) + '…',
        keyHash: createHash('sha256').update(apiKey).digest('hex'),
      }),
    );
    // La key completa se devuelve SOLO aquí — no vuelve a ser recuperable.
    return {
      apiKeyId: guardada.apiKeyId,
      nombre,
      prefijo: guardada.prefijo,
      apiKey,
    };
  }

  listar(tenantId: string) {
    return this.repo.find({
      where: { tenantId },
      select: {
        apiKeyId: true,
        nombre: true,
        prefijo: true,
        ultimoUsoEl: true,
        revocadaEl: true,
        creadoEl: true,
      },
      order: { creadoEl: 'DESC' },
    });
  }

  async revocar(tenantId: string, apiKeyId: string) {
    const key = await this.repo.findOne({
      where: { apiKeyId, tenantId, revocadaEl: IsNull() },
    });
    if (!key) throw new NotFoundException('API key no encontrada');
    key.revocadaEl = new Date();
    await this.repo.save(key);
    return { apiKeyId, revocadaEl: key.revocadaEl };
  }

  async validar(
    key: string,
  ): Promise<{ tenantId: string; apiKeyId: string } | null> {
    if (!key.startsWith('pk_')) return null;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const encontrada = await this.repo.findOne({ where: { keyHash } });
    if (!encontrada || encontrada.revocadaEl) return null;
    // fire-and-forget: no bloquear la request por el tracking de uso
    // (con catch: un fallo transitorio de BD no debe tumbar el proceso)
    void Promise.resolve(
      this.repo.update(encontrada.apiKeyId, { ultimoUsoEl: new Date() }),
    ).catch(() => undefined);
    return { tenantId: encontrada.tenantId, apiKeyId: encontrada.apiKeyId };
  }
}
