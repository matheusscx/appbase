import { Test, type TestingModule } from '@nestjs/testing';
import { TokensAccesoService } from './tokens-acceso.service';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { type Usuario } from '../users/usuario.entity';

const mockUser: Usuario = {
  id: 'user-uuid',
  nombre: 'Test',
  apellido: 'User',
  correo: 'test@example.com',
  contrasena: null,
  nombreUsuario: null,
  telefono: null,
  googleId: null,
  esSuperadmin: false,
  preferencias: {},
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let refreshRepo: {
    save: jest.Mock;
    findOne: jest.Mock;
    delete: jest.Mock;
  };
  let dataSource: { query: jest.Mock };
  let usersService: { findById: jest.Mock; [k: string]: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    refreshRepo = {
      save: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: TokensAccesoService,
          useValue: {
            emitir: jest.fn().mockResolvedValue('tok'),
            buscarVigente: jest.fn(),
            quemar: jest.fn(),
            invalidarAnteriores: jest.fn(),
            invalidarTodos: jest.fn(),
          },
        },
        // Mockeado: un unit no manda mail.
        { provide: MailService, useValue: { enviar: jest.fn() } },
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
          useValue: (usersService = {
            findByEmail: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            linkGoogleId: jest.fn(),
            findByGoogleId: jest.fn(),
          }),
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshRepo,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
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

  describe('switchTenant', () => {
    // Su hermano `getMyTenants` ya filtraba tenants borrados; éste no. Con un
    // tenant soft-borrado y una membresía viva devolvía 200 y un token para un
    // tenant muerto. `TenantGuard` cortaba en la ruta SIGUIENTE, así que el
    // usuario se enteraba un request después y con otro error.
    it('exige que el tenant no esté borrado, no solo que exista la membresía', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      usersService.findById.mockResolvedValue({ id: 'usuario-uuid' });

      await service.switchTenant('usuario-uuid', 'tenant-uuid');

      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      const plano = sql.replace(/\s+/g, ' ');
      expect(plano).toContain(
        'JOIN tenants t ON t.tenant_id = ut.tenant_id AND t.eliminado_el IS NULL',
      );
      // Y la membresía sigue filtrando su propio borrado, con el alias puesto:
      // sin `ut.`, `eliminado_el` quedaba ambiguo entre las dos tablas.
      expect(plano).toContain('ut.eliminado_el IS NULL');
      expect(params).toEqual(['usuario-uuid', 'tenant-uuid']);
    });

    it('rechaza con Forbidden cuando la consulta no devuelve filas', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.switchTenant('usuario-uuid', 'tenant-uuid'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
