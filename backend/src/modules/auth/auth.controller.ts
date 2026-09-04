import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ElegirContrasenaDto } from './dto/elegir-contrasena.dto';
import { RecuperarContrasenaDto } from './dto/recuperar-contrasena.dto';
import { TipoTokenAcceso } from './entities/token-acceso.entity';
import { SwitchTenantDto } from './dto/switch-tenant.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { Usuario } from '../users/usuario.entity';

interface AuthenticatedRequest extends Request {
  user: Usuario;
}

interface JwtRequest extends Request {
  user: { id: string };
}

const REFRESH_COOKIE = 'refresh_token';

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000,
    path: '/',
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * ⚠️ Responde **lo mismo** exista o no el correo, igual que `recuperar` acá
   * abajo (ver `AuthService.register`). El `200` fijo y sin tokens es parte del
   * contrato: un `409` acá —lo que había— convertía el endpoint en un
   * enumerador público de cuentas, y devolver sesión haría distinguibles los
   * casos por la sola presencia del token.
   */
  @Post('register')
  @HttpCode(HttpStatus.OK)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * ⚠️ Estos `@Param('token')` van **sin `ParseUUIDPipe`**, y no es un olvido: el
   * resto de los `@Param` del backend sí lo lleva (`docs/patterns/backend.md` § 4).
   *
   * El token de un link **no es un UUID**: sale de
   * `randomBytes(32).toString('base64url')` en `tokens-acceso.service.ts`, o sea
   * 43 caracteres de base64url. Ponerle el pipe devolvería 400 a *todos* los links
   * válidos de verificación, invitación y reset.
   */
  @Post('verificar/:token')
  @HttpCode(HttpStatus.OK)
  verificarCorreo(@Param('token') token: string) {
    return this.authService.verificarCorreo(token);
  }

  /**
   * Los endpoints de link son **públicos**: quien los usa justamente no puede
   * autenticarse todavía —o no puede más—. La prueba de identidad es el token
   * del link, no un JWT.
   */
  @Get('invitacion/:token')
  verificarInvitacion(@Param('token') token: string) {
    return this.authService.verificarToken(token, TipoTokenAcceso.INVITACION);
  }

  @Post('invitacion/:token')
  @HttpCode(HttpStatus.OK)
  aceptarInvitacion(
    @Param('token') token: string,
    @Body() dto: ElegirContrasenaDto,
  ) {
    return this.authService.elegirContrasena(
      token,
      TipoTokenAcceso.INVITACION,
      dto.contrasena,
    );
  }

  @Get('recuperar/:token')
  verificarReset(@Param('token') token: string) {
    return this.authService.verificarToken(token, TipoTokenAcceso.RESET);
  }

  /**
   * ⚠️ Responde **lo mismo** exista o no el correo (ver `AuthService.recuperar`).
   * El `200` fijo es parte del contrato: un 404 acá convertiría el endpoint en
   * un enumerador público de cuentas.
   */
  @Post('recuperar')
  @HttpCode(HttpStatus.OK)
  recuperar(@Body() dto: RecuperarContrasenaDto) {
    return this.authService.recuperar(dto.correo);
  }

  @Post('recuperar/:token')
  @HttpCode(HttpStatus.OK)
  restablecer(@Param('token') token: string, @Body() dto: ElegirContrasenaDto) {
    return this.authService.elegirContrasena(
      token,
      TipoTokenAcceso.RESET,
      dto.contrasena,
    );
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refresh_token, ...response } = await this.authService.login(
      req.user,
    );
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    return response;
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // passport redirects to Google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const { access_token, refresh_token } =
      await this.authService.generateTokens(req.user);
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    const frontendUrl = this.config.get<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/auth/callback?token=${access_token}`);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token');
    const { access_token, refresh_token } =
      await this.authService.refresh(token);
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    return { access_token };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (token) await this.authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Logged out' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: JwtRequest) {
    return this.authService.getMe(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('my-tenants')
  async getMyTenants(@Req() req: JwtRequest) {
    return this.authService.getMyTenants(req.user.id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('switch-tenant')
  @HttpCode(HttpStatus.OK)
  async switchTenant(
    @Req() req: JwtRequest,
    @Body() dto: SwitchTenantDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Ver el docblock de `AuthService.switchTenant`: esta ruta emite un refresh
    // nuevo, así que no alcanza con estar autenticado. El access token solo
    // convertía una filtración en sesión renovable.
    const refreshToken = (req.cookies as Record<string, string>)?.[
      REFRESH_COOKIE
    ];
    if (!refreshToken) throw new UnauthorizedException('No refresh token');
    const { access_token, refresh_token } = await this.authService.switchTenant(
      req.user.id,
      dto.tenantId,
      refreshToken,
    );
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    return { access_token };
  }
}
