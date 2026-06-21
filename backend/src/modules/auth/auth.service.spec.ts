import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { Usuario } from '../users/usuario.entity';

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
