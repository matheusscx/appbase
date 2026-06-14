# Session Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace localStorage JWT storage with short-lived access tokens (15min) + httpOnly refresh tokens (1hr sliding) so sessions survive reloads, SSR works correctly, and stolen tokens have a limited damage window.

**Architecture:** Backend issues two tokens on login: an access token (JWT, 15min) returned in the response body, and a refresh token (UUID in DB, 1hr) set as an httpOnly cookie. The frontend stores the access token in a Nuxt `useCookie` ref (SSR-safe, fixes the reload redirect bug). When any API call returns 401, a `useApiFetch` composable transparently calls `POST /auth/refresh`, updates the access token, and retries. On inactivity past 1hr the refresh token expires in DB and the user is sent to login.

**Tech Stack:** NestJS + TypeORM + PostgreSQL, `cookie-parser` (npm), Nuxt 3 + Pinia (`useCookie`)

---

## File Map

**Create:**
- `backend/src/modules/auth/entities/refresh-token.entity.ts`
- `backend/src/modules/auth/auth.service.spec.ts`
- `frontend/app/composables/useApiFetch.ts`

**Modify:**
- `.env` + `.env.example` — env vars
- `backend/src/main.ts` — cookie-parser middleware
- `backend/src/app.module.ts` — register RefreshToken entity
- `backend/src/modules/auth/auth.module.ts` — TypeOrmModule.forFeature
- `backend/src/modules/auth/auth.service.ts` — token rotation logic
- `backend/src/modules/auth/auth.controller.ts` — refresh/logout endpoints + cookie responses
- `frontend/app/stores/auth.ts` — useCookie (setup store syntax)

---

### Task 1: Update env vars

**Files:**
- Modify: `.env`
- Modify: `.env.example`

- [ ] **Step 1: Update `.env`**

Change `JWT_EXPIRATION=7d` to `15m` and add two new vars. The JWT block should look like:

```
# JWT
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your_super_secret_refresh_key_change_in_production
JWT_REFRESH_EXPIRATION=1h
```

- [ ] **Step 2: Update `.env.example`** with the same JWT block:

```
# JWT
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your_super_secret_refresh_key_change_in_production
JWT_REFRESH_EXPIRATION=1h
```

- [ ] **Step 3: Commit**

```bash
git add .env .env.example
git commit -m "chore: configure short-lived access tokens and refresh token env vars"
```

---

### Task 2: Install cookie-parser and add to main.ts

**Files:**
- Modify: `backend/package.json` (via npm install)
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Install the package**

```bash
cd backend && npm install cookie-parser @types/cookie-parser
```

Expected: `added N packages` with no errors.

- [ ] **Step 2: Add cookie-parser to `backend/src/main.ts`**

Add the import and `app.use(cookieParser())` call. The file should become:

```typescript
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const config = new DocumentBuilder()
    .setTitle('Prueba Técnica API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/main.ts backend/package.json backend/package-lock.json
git commit -m "chore: add cookie-parser middleware to NestJS app"
```

---

### Task 3: Create RefreshToken entity and register it

**Files:**
- Create: `backend/src/modules/auth/entities/refresh-token.entity.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/modules/auth/auth.module.ts`

- [ ] **Step 1: Create `backend/src/modules/auth/entities/refresh-token.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  token: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: Register entity in `backend/src/app.module.ts`**

Add the import and add `RefreshToken` to the entities array:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { User } from './modules/users/user.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, RefreshToken],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

- [ ] **Step 3: Add TypeOrmModule.forFeature to `backend/src/modules/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { RefreshToken } from './entities/refresh-token.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET')!,
        signOptions: { expiresIn: (config.get('JWT_EXPIRATION') ?? '15m') as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, GoogleStrategy],
})
export class AuthModule {}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/auth/entities/ backend/src/app.module.ts backend/src/modules/auth/auth.module.ts
git commit -m "feat: add RefreshToken entity and register in TypeORM modules"
```

---

### Task 4: Write failing tests for AuthService

**Files:**
- Create: `backend/src/modules/auth/auth.service.spec.ts`

- [ ] **Step 1: Create `backend/src/modules/auth/auth.service.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/user.entity';

const mockUser: User = {
  id: 'user-uuid',
  name: 'Test User',
  email: 'test@example.com',
  password: null,
  googleId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let refreshRepo: {
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    refreshRepo = {
      save: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock.access.token'),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                JWT_REFRESH_EXPIRATION: '1h',
              };
              return map[key];
            }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            linkGoogleId: jest.fn(),
            findByGoogleId: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshRepo,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('generateTokens', () => {
    it('saves a new refresh token to DB and returns both tokens', async () => {
      const result = await service.generateTokens(mockUser);

      expect(result.access_token).toBe('mock.access.token');
      expect(result.refresh_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(refreshRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-uuid' }),
      );
    });
  });

  describe('refresh', () => {
    it('throws UnauthorizedException when token is not found in DB', async () => {
      refreshRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException and deletes when token is expired', async () => {
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        token: 'expired-token',
        userId: 'user-uuid',
        user: mockUser,
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshRepo.delete).toHaveBeenCalledWith({ id: 'rt-id' });
    });

    it('rotates token and returns new access token on valid refresh', async () => {
      refreshRepo.findOne.mockResolvedValue({
        id: 'rt-id',
        token: 'valid-token',
        userId: 'user-uuid',
        user: mockUser,
        expiresAt: new Date(Date.now() + 3_600_000),
        createdAt: new Date(),
      });

      const result = await service.refresh('valid-token');

      expect(result.access_token).toBe('mock.access.token');
      expect(result.refresh_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(refreshRepo.delete).toHaveBeenCalledWith({ id: 'rt-id' });
      expect(refreshRepo.save).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('deletes the refresh token from DB by token value', async () => {
      await service.logout('some-token');

      expect(refreshRepo.delete).toHaveBeenCalledWith({ token: 'some-token' });
    });

    it('does not throw when token does not exist', async () => {
      refreshRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.logout('nonexistent')).resolves.not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend && npm test -- --testPathPattern=auth.service.spec --no-coverage
```

Expected: FAIL — `service.generateTokens is not a function` (methods don't exist yet in the service).

---

### Task 5: Implement AuthService changes (make tests pass)

**Files:**
- Modify: `backend/src/modules/auth/auth.service.ts`

- [ ] **Step 1: Replace `backend/src/modules/auth/auth.service.ts`**

```typescript
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
import { User } from '../users/user.entity';
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

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.password) return null;
    const valid = await bcrypt.compare(password, user.password);
    return valid ? user : null;
  }

  async register(
    dto: RegisterDto,
  ): Promise<{ access_token: string; refresh_token: string; user: User }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('El email ya está registrado');
    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.usersService.create({ ...dto, password: hashed });
    const { access_token, refresh_token } = await this.generateTokens(user);
    return { access_token, refresh_token, user };
  }

  async login(
    user: User,
  ): Promise<{ access_token: string; refresh_token: string; user: User }> {
    const { access_token, refresh_token } = await this.generateTokens(user);
    return { access_token, refresh_token, user };
  }

  async googleLogin(profile: {
    googleId: string;
    name: string;
    email: string;
  }): Promise<User> {
    let user = await this.usersService.findByGoogleId(profile.googleId);
    if (!user) {
      user = await this.usersService.findByEmail(profile.email);
      if (user) {
        user = await this.usersService.linkGoogleId(user.id, profile.googleId);
      } else {
        user = await this.usersService.create({
          googleId: profile.googleId,
          name: profile.name,
          email: profile.email,
        });
      }
    }
    return user;
  }

  async generateTokens(
    user: User,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const access_token = this.generateAccessToken(user);
    const refresh_token = await this.createRefreshToken(user.id);
    return { access_token, refresh_token };
  }

  generateAccessToken(user: User): string {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const existing = await this.refreshRepo.findOne({
      where: { token: refreshToken },
      relations: ['user'],
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

  async getMe(userId: string): Promise<User> {
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
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd backend && npm test -- --testPathPattern=auth.service.spec --no-coverage
```

Expected: PASS — all 6 tests green.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/auth/auth.service.ts backend/src/modules/auth/auth.service.spec.ts
git commit -m "feat: implement refresh token rotation in AuthService (TDD)"
```

---

### Task 6: Update AuthController with cookie responses and new endpoints

**Files:**
- Modify: `backend/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Replace `backend/src/modules/auth/auth.controller.ts`**

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions } from 'express';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';

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

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refresh_token, ...response } = await this.authService.register(dto);
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    return response;
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const { refresh_token, ...response } = await this.authService.login(req.user);
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
  async googleCallback(@Req() req: any, @Res() res: Response) {
    const { access_token, refresh_token } = await this.authService.generateTokens(req.user);
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
    const { access_token, refresh_token } = await this.authService.refresh(token);
    res.cookie(REFRESH_COOKIE, refresh_token, refreshCookieOptions());
    return { access_token };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (token) await this.authService.logout(token);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Logged out' };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: any) {
    return this.authService.getMe(req.user.id);
  }
}
```

- [ ] **Step 2: Verify backend compiles and starts**

```bash
cd backend && npm run lint
```

Expected: no errors (or only pre-existing warnings).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/auth/auth.controller.ts
git commit -m "feat: add /auth/refresh and /auth/logout endpoints with httpOnly cookie"
```

---

### Task 7: Fix frontend auth store (SSR session bug)

**Files:**
- Modify: `frontend/app/stores/auth.ts`

- [ ] **Step 1: Replace `frontend/app/stores/auth.ts`**

The key change: convert from options store to setup store so `useCookie` can be called at the top level. `useCookie` is reactive and available on both server and client — this is what fixes the SSR redirect on reload.

```typescript
import { defineStore } from 'pinia'

interface User {
  id: string
  name: string
  email: string
  createdAt: string
}

export const useAuthStore = defineStore('auth', () => {
  const config = useRuntimeConfig()

  const token = useCookie<string | null>('access_token', {
    maxAge: 60 * 15,
    sameSite: 'lax',
    path: '/',
  })
  const user = ref<User | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function setToken(newToken: string) {
    token.value = newToken
  }

  function clearAuth() {
    token.value = null
    user.value = null
  }

  async function login(email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/login`,
        { method: 'POST', body: { email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: any) {
      error.value = e?.data?.message ?? 'Error al iniciar sesión'
      return false
    } finally {
      loading.value = false
    }
  }

  async function register(name: string, email: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<{ access_token: string; user: User }>(
        `${config.public.apiUrl}/auth/register`,
        { method: 'POST', body: { name, email, password }, credentials: 'include' },
      )
      setToken(data.access_token)
      user.value = data.user
      return true
    } catch (e: any) {
      error.value = e?.data?.message ?? 'Error al registrarse'
      return false
    } finally {
      loading.value = false
    }
  }

  async function fetchMe(): Promise<void> {
    if (!token.value) return
    try {
      user.value = await $fetch<User>(`${config.public.apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
    } catch {
      clearAuth()
    }
  }

  function loginWithGoogle() {
    const apiBase = config.public.apiUrl.replace('/api', '')
    window.location.href = `${apiBase}/api/auth/google`
  }

  async function logout() {
    try {
      await $fetch(`${config.public.apiUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch { /* ignore network errors on logout */ }
    clearAuth()
    navigateTo('/login')
  }

  return {
    token,
    user,
    loading,
    error,
    isAuthenticated,
    setToken,
    clearAuth,
    login,
    register,
    fetchMe,
    loginWithGoogle,
    logout,
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/stores/auth.ts
git commit -m "fix: replace localStorage with useCookie in auth store — fixes SSR session loss on reload"
```

---

### Task 8: Create useApiFetch composable (401 auto-retry)

**Files:**
- Create: `frontend/app/composables/useApiFetch.ts`

- [ ] **Step 1: Create `frontend/app/composables/useApiFetch.ts`**

This composable wraps `$fetch` for authenticated requests. On 401 it calls `/auth/refresh` (the browser sends the httpOnly cookie automatically), updates the access token, and retries once. On refresh failure it clears auth and redirects to login.

```typescript
let refreshing: Promise<string> | null = null

export async function useApiFetch<T>(
  url: string,
  options: Parameters<typeof $fetch>[1] = {},
): Promise<T> {
  const store = useAuthStore()
  const config = useRuntimeConfig()

  const buildOptions = (): Parameters<typeof $fetch>[1] => ({
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
    },
  })

  try {
    return await $fetch<T>(url, buildOptions())
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status
    if (status !== 401) throw err

    try {
      if (!refreshing) {
        refreshing = $fetch<{ access_token: string }>(
          `${config.public.apiUrl}/auth/refresh`,
          { method: 'POST', credentials: 'include' },
        ).then((data) => {
          store.setToken(data.access_token)
          return data.access_token
        }).finally(() => {
          refreshing = null
        })
      }
      await refreshing
      return await $fetch<T>(url, buildOptions())
    } catch {
      store.clearAuth()
      navigateTo('/login')
      throw err
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/composables/useApiFetch.ts
git commit -m "feat: add useApiFetch composable with transparent 401 token refresh"
```

---

### Task 9: Verify the full flow end-to-end

- [ ] **Step 1: Start the stack**

```bash
docker-compose down -v && docker-compose up --build
```

Wait until all three services are healthy (look for `NestJS application listening` and `Nuxt ready`).

- [ ] **Step 2: Log in and reload**

Open `http://localhost:5173`, log in with valid credentials.  
After login, press **F5** or refresh the page.  
Expected: stay on the authenticated page (not redirected to `/login`).

- [ ] **Step 3: Verify httpOnly cookie is set**

Open DevTools → Application → Cookies → `localhost`.  
Expected:
- `access_token` cookie: visible, not httpOnly, 15-minute maxAge
- `refresh_token` cookie: visible, **httpOnly checked**, 1-hour maxAge

- [ ] **Step 4: Verify token refresh works**

In DevTools → Application → Cookies, manually delete the `access_token` cookie (leave `refresh_token`).  
Navigate to a different protected page.  
Expected: the page loads successfully (middleware calls `fetchMe` which triggers a 401, `useApiFetch` will have refreshed if needed; or middleware's direct `fetchMe` gets 401 and... 

Actually: `fetchMe` in the middleware uses plain `$fetch`, not `useApiFetch`. So if the access token is gone, `fetchMe` will 401 and call `clearAuth()`. The middleware will then redirect to login.

To properly test the refresh flow: delete only the `access_token` cookie, then trigger any API call from the app (not `fetchMe`). For pages that use `useApiFetch` for data calls, those will auto-refresh.

For now, the most important behavior is: after reload with valid `access_token` cookie → stay authenticated. ✓

- [ ] **Step 5: Final commit (tag as working)**

```bash
git add -A
git commit -m "feat: complete session persistence — refresh token rotation + SSR-safe cookie storage"
```
