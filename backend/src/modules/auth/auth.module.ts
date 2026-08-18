import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { TokenAcceso } from './entities/token-acceso.entity';
import { TokensAccesoService } from './tokens-acceso.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    RepositoriosModule.forFeature([RefreshToken, TokenAcceso]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET')!,
        signOptions: {
          expiresIn: config.get('JWT_EXPIRATION') ?? '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensAccesoService,
    LocalStrategy,
    JwtStrategy,
    GoogleStrategy,
  ],
  // Lo exporta para `tenants`, que emite la invitación dentro de la transacción
  // del alta.
  exports: [TokensAccesoService],
})
export class AuthModule {}
