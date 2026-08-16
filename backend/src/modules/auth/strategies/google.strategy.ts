import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';

interface GoogleProfile {
  id: string;
  displayName: string;
  /**
   * `verified` lo expone `passport-google-oauth20` desde siempre y esta
   * interfaz **no lo declaraba**, así que el campo se perdía antes de llegar al
   * service: TypeScript no podía avisar de un dato que el tipo negaba.
   */
  emails: Array<{ value: string; verified?: boolean }>;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID:
        config.get<string>('GOOGLE_CLIENT_ID') || 'GOOGLE_CLIENT_ID_NOT_SET',
      clientSecret:
        config.get<string>('GOOGLE_CLIENT_SECRET') ||
        'GOOGLE_CLIENT_SECRET_NOT_SET',
      callbackURL:
        config.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:3000/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ) {
    const { id, displayName, emails } = profile;
    const user = await this.authService.googleLogin({
      googleId: id,
      name: displayName,
      email: emails[0].value,
      // `=== true` y no un truthy: si el proveedor omite el campo, el default
      // seguro es "no verificado". Un `?? true` acá invertiría el sentido del
      // arreglo.
      emailVerificado: emails[0].verified === true,
    });
    done(null, user);
  }
}
