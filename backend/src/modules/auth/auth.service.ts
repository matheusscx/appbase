import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { Usuario } from '../users/usuario.entity';
import { TipoTokenAcceso } from './entities/token-acceso.entity';
import { TokensAccesoService } from './tokens-acceso.service';
import { MailService } from '../mail/mail.service';
import { RefreshToken } from './entities/refresh-token.entity';

/** Cuerpo del mail de reset. El link lleva el token en claro, la única vez que existe. */
function mailDeReset(correo: string, token: string, base: string) {
  return {
    para: correo,
    asunto: 'Elegí una contraseña nueva',
    cuerpo:
      `Pediste recuperar el acceso a tu cuenta.\n\n` +
      `Elegí una contraseña nueva acá (el link vence en 1 hora):\n` +
      `${base}/recuperar/${token}\n\n` +
      `Si no lo pediste, ignorá este mail: tu contraseña actual sigue funcionando.`,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tokens: TokensAccesoService,
    private readonly mail: MailService,
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

  /**
   * Dice si un link sirve, **sin quemarlo**. La pantalla lo consulta al cargar
   * para mostrar "este link venció" en vez de un formulario que va a fallar
   * después de que la persona tipeó dos veces su contraseña.
   *
   * No quemarlo acá es deliberado: un prefetch del navegador o abrir el link
   * dos veces inutilizaría la invitación antes de escribir nada.
   */
  async verificarToken(
    token: string,
    tipo: TipoTokenAcceso,
  ): Promise<{ correo: string }> {
    const fila = await this.tokens.buscarVigente(token, tipo);
    if (!fila) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Pedí uno nuevo.',
      );
    }
    const user = await this.usersService.findById(fila.usuarioId);
    if (!user) throw new BadRequestException('Ese link ya no sirve');
    return { correo: user.correo };
  }

  /**
   * Fija la contraseña desde un link y lo quema, **en una transacción**: si el
   * quemado fallara después de guardar el hash, el link seguiría vivo y
   * serviría de nuevo.
   *
   * Se quema PRIMERO. `quemar()` corta con un `UPDATE ... WHERE usado_el IS
   * NULL`, así que de dos requests simultáneos con el mismo link solo uno
   * sigue; el otro revienta antes de tocar la contraseña.
   */
  async elegirContrasena(
    token: string,
    tipo: TipoTokenAcceso,
    contrasena: string,
  ): Promise<{ message: string }> {
    const fila = await this.tokens.buscarVigente(token, tipo);
    if (!fila) {
      throw new BadRequestException(
        'Ese link ya no sirve: puede estar vencido o ya usado. Pedí uno nuevo.',
      );
    }
    const hashed = await bcrypt.hash(contrasena, 10);
    await this.dataSource.transaction(async (manager) => {
      await this.tokens.quemar(fila.id, manager);
      // Y se matan TODOS los links vivos de esa cuenta, no solo el usado. Un
      // link de invitación vive 7 días: sin esto sobrevive al reset y quien
      // tenga ese mail puede volver a fijar la contraseña y entrar. La cuenta
      // ya tiene dueño; cualquier link pendiente es una llave de reentrada.
      await this.tokens.invalidarTodos(fila.usuarioId, manager);
      // Con `eliminadoEl IS NULL` en el criterio: sin eso, este camino escribe
      // sobre una fila borrada. El `GET` hermano sí filtra (usa `findById`), y
      // la incoherencia entre los dos se ve desde afuera.
      const res = await manager.update(
        Usuario,
        { id: fila.usuarioId, eliminadoEl: IsNull() },
        { contrasena: hashed },
      );
      if (!res.affected) {
        throw new BadRequestException('Ese link ya no sirve');
      }
    });
    // Se cierran las sesiones vivas: si el reset lo pidió alguien porque le
    // tomaron la cuenta, dejar los refresh tokens del intruso vivos vaciaría
    // el sentido del reset.
    await this.refreshRepo.delete({ userId: fila.usuarioId });
    return { message: 'Contraseña actualizada' };
  }

  /**
   * Pide un reset.
   *
   * ⚠️ **Responde lo mismo exista o no el correo.** Si distinguiera, este
   * endpoint —público y sin autenticación— sería un oráculo para averiguar qué
   * direcciones tienen cuenta, o sea para enumerar la base de usuarios.
   */
  async recuperar(correo: string): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(correo);
    if (user) {
      // Pedirlo dos veces deja UN link válido, el último: si no, quedan varios
      // vivos repartidos por la casilla y cualquiera de ellos sirve.
      await this.tokens.invalidarAnteriores(user.id, TipoTokenAcceso.RESET);
      const token = await this.tokens.emitir(user.id, TipoTokenAcceso.RESET);
      await this.mail.enviar(
        mailDeReset(user.correo, token, this.frontendUrl()),
      );
    }
    return {
      message:
        'Si ese correo tiene una cuenta, te llega un link para elegir una contraseña nueva.',
    };
  }

  /**
   * Base del link que va en los mails. Por `ConfigService` y no `process.env`:
   * la clase ya lo inyecta para todo lo demás, y `process.env` no se puede
   * mockear en un test.
   */
  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
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
          apellido: profile.name.split(' ').slice(1).join(' ') || undefined,
          correo: profile.email,
          contrasena: undefined,
          nombreUsuario: profile.email.split('@')[0],
          telefono: undefined,
        });
      }
    }
    return user;
  }

  async generateTokens(
    user: Usuario,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const access_token = this.generateAccessToken(user);
    const refresh_token = await this.createRefreshToken(user.id, null);
    return { access_token, refresh_token };
  }

  generateAccessToken(user: Usuario, tenantId: string | null = null): string {
    return this.jwtService.sign({
      sub: user.id,
      email: user.correo,
      tenant_id: tenantId,
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
    const access_token = this.generateAccessToken(
      existing.user,
      existing.activeTenantId,
    );
    const new_refresh_token = await this.createRefreshToken(
      existing.userId,
      existing.activeTenantId,
    );
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

  async getMyTenants(
    userId: string,
  ): Promise<{ tenantId: string; nombre: string }[]> {
    return this.dataSource.query<{ tenantId: string; nombre: string }[]>(
      `SELECT t.tenant_id as "tenantId", t.nombre
       FROM usuarios_tenants ut
       JOIN tenants t ON t.tenant_id = ut.tenant_id
       WHERE ut.usuario_id = $1
         AND ut.eliminado_el IS NULL
         AND t.eliminado_el IS NULL`,
      [userId],
    );
  }

  async switchTenant(
    userId: string,
    tenantId: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // El JOIN a `tenants` con su `eliminado_el IS NULL` es lo que iguala este
    // método con su hermano `getMyTenants`, que ya lo hacía. Sin él, un tenant
    // soft-borrado por el superadmin con una membresía viva devolvía **200 y un
    // token** para un tenant muerto: el daño quedaba acotado porque
    // `TenantGuard` corta en la ruta siguiente, pero prometía algo que no
    // existe, y el usuario se enteraba un request más tarde y con otro error.
    // Ojo con el alias: acá `eliminado_el` a secas era de `usuarios_tenants`.
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM usuarios_tenants ut
       JOIN tenants t ON t.tenant_id = ut.tenant_id AND t.eliminado_el IS NULL
       WHERE ut.usuario_id = $1
         AND ut.tenant_id = $2
         AND ut.eliminado_el IS NULL`,
      [userId, tenantId],
    );
    if (rows.length === 0)
      throw new ForbiddenException('No perteneces a este tenant');
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException();
    // Revocar todos los refresh tokens anteriores del usuario
    await this.refreshRepo.delete({ userId });
    const access_token = this.generateAccessToken(user, tenantId);
    const refresh_token = await this.createRefreshToken(userId, tenantId);
    return { access_token, refresh_token };
  }

  private async createRefreshToken(
    userId: string,
    activeTenantId: string | null = null,
  ): Promise<string> {
    const token = randomUUID();
    const expiresAt = new Date(
      Date.now() +
        this.parseExpiration(
          this.config.get<string>('JWT_REFRESH_EXPIRATION') ?? '1h',
        ),
    );
    await this.refreshRepo.save({ token, userId, expiresAt, activeTenantId });
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
