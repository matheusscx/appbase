import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: {
    sub: string;
    email: string;
    tenant_id: string | null;
    es_superadmin: boolean;
  }) {
    return {
      id: payload.sub,
      email: payload.email,
      tenantId: payload.tenant_id ?? null,
      esSuperadmin: payload.es_superadmin ?? false,
    };
  }
}
