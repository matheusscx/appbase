import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { MeService } from './me.service';
import { Usuario } from '../users/usuario.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';

const USER_ID = 'usuario-uuid';
const ACTUAL = 'la-vieja-1234';
const NUEVA = 'la-nueva-5678';

describe('MeService', () => {
  let service: MeService;
  let usuarioRepo: { findOneOrFail: jest.Mock; update: jest.Mock };
  let refreshRepo: { delete: jest.Mock };

  beforeEach(async () => {
    const hashActual = await bcrypt.hash(ACTUAL, 4);
    usuarioRepo = {
      findOneOrFail: jest.fn().mockResolvedValue({
        id: USER_ID,
        contrasena: hashActual,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    refreshRepo = { delete: jest.fn().mockResolvedValue({ affected: 2 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: getRepositoryToken(Usuario), useValue: usuarioRepo },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshRepo },
      ],
    }).compile();

    service = module.get<MeService>(MeService);
  });

  describe('updateContrasena', () => {
    const dtoValido = {
      contrasenaActual: ACTUAL,
      contrasenaNueva: NUEVA,
      confirmarContrasena: NUEVA,
    };

    // El test que sostiene el fix: si alguien entra a cambiar su contraseña
    // porque le tomaron la cuenta, el refresh token del intruso tiene que
    // morir. Sin el `delete`, sigue vivo y renovable indefinidamente.
    it('borra los refresh tokens de la cuenta al cambiar la contraseña', async () => {
      await service.updateContrasena(USER_ID, dtoValido);

      expect(refreshRepo.delete).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it('no toca los refresh tokens si la contraseña actual es incorrecta', async () => {
      await expect(
        service.updateContrasena(USER_ID, {
          ...dtoValido,
          contrasenaActual: 'no-es-esta',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(usuarioRepo.update).not.toHaveBeenCalled();
      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });

    it('no toca los refresh tokens si la confirmación no coincide', async () => {
      await expect(
        service.updateContrasena(USER_ID, {
          ...dtoValido,
          confirmarContrasena: 'otra-cosa',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(refreshRepo.delete).not.toHaveBeenCalled();
    });
  });
});
