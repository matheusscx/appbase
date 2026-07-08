import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from '../services/api-keys.service';

export interface PasarelaAuth {
  tenantId: string;
  apiKeyId: string;
}

/** Autenticación m2m para /pasarela/api/*: resuelve el tenant desde la API key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { pasarelaAuth?: PasarelaAuth }>();
    const auth = req.headers.authorization ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!key) throw new UnauthorizedException('API key requerida');
    const resultado = await this.apiKeysService.validar(key);
    if (!resultado)
      throw new UnauthorizedException('API key inválida o revocada');
    req.pasarelaAuth = resultado;
    return true;
  }
}
