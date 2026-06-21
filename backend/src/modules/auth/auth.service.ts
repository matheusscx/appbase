import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { Usuario } from '../users/usuario.entity';
import { RefreshToken } from './entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async validateUser(email: string, password: string): Promise<Usuario | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.contrasena) return null;
    const valid = await bcrypt.compare(password, user.contrasena);
    return valid ? user : null;
  }

  async register(
    dto: RegisterDto,
  ): Promise<{ access_token: string; refresh_token: string; user: Usuario }> {
    const existing = await this.usersService.findByEmail(dto.correo);
    if (existing) throw new ConflictException('El correo ya esta registrado');
    const hashed = await bcrypt.hash(dto.contrasena, 10);
    const user = await this.usersService.create({ ...dto, contrasena: hashed });
    const { access_token, refresh_token } = await this.generateTokens(user);
    return { access_token, refresh_token, user };
  }

  async login(
    user: Usuario,
  ): Promise<{ access_token: string; refresh_token: string; user: Usuario }> {
    const { access_token, refresh_token } = await this.generateTokens(user);
    return { access_token, refresh_token, user };
  }

  async googleLogin(profile: {
    googleId: string;
    name: string;
    email: string;
  }): Promise<Usuario> {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
      if (user) {
        user = await this.usersService.linkGoogleId(user.id, profile.googleId);
      } else {
        user = await this.usersService.create({
          googleId: profile.googleId,
          nombre: profile.name.split(' ')[0] || profile.name,
          apellido: profile.name.split(' ').slice(1).join(' ') || null,
          correo: profile.email,
          contrasena: null,
          nombreUsuario: profile.email.split('@')[0],
          telefono: null,
        });
      }
    }
    return user;
  }

  async generateTokens(
    user: Usuario,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const access_token = this.generateAccessToken(user);
    const refresh_token = await this.createRefreshToken(user.id);
    return { access_token, refresh_token };
  }

  private generateAccessToken(user: Usuario): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.correo,
      tenant_id: null,
      es_superadmin: user.esSuperadmin,
    });
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const existing = await this.refreshRepo.findOne({
      where: { token: refreshToken },
      relations: { user: true },
    });
    if (!existing) throw new UnauthorizedException('Refresh token inválido');
    if (existing.expiresAt < new Date()) {
      await this.refreshRepo.delete({ id: existing.id });
      throw new UnauthorizedException('Refresh token expirado');
    }
    await this.refreshRepo.delete({ id: existing.id });
    const access_token = this.generateAccessToken(existing.user);
    const new_refresh_token = await this.createRefreshToken(existing.userId);
    return { access_token, refresh_token: new_refresh_token };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshRepo.delete({ token: refreshToken });
  }

  async getMe(userId: string): Promise<Usuario> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const token = randomUUID();
    const expiresAt = new Date(
      Date.now() +
        this.parseExpiration(
          this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '1h',
        ),
    );
    await this.refreshRepo.save({ token, userId, expiresAt });
    return token;
  }

  private parseExpiration(expiration: string): number {
    const match = expiration.match(/^(\d+)([smhd])$/);
    if (!match) return 3_600_000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return value * multipliers[unit];
  }
}
