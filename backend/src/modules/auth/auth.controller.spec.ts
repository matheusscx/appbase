import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

function controller(env: Record<string, string>, authService = {}) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new AuthController(authService as AuthService, config);
}

describe('AuthController', () => {
  describe('proveedores (08.25)', () => {
    it('sin variables de Google: false', () => {
      expect(controller({}).proveedores()).toEqual({ google: false });
    });

    it('con las dos variables: true, y el cuerpo no trae ningún valor', () => {
      const res = controller({
        GOOGLE_CLIENT_ID: 'id-123',
        GOOGLE_CLIENT_SECRET: 's-456',
      }).proveedores();
      expect(res).toEqual({ google: true });
      expect(JSON.stringify(res)).not.toMatch(/123|456/);
    });

    it('con una sola de las dos: false', () => {
      expect(controller({ GOOGLE_CLIENT_ID: 'id' }).proveedores()).toEqual({
        google: false,
      });
      expect(controller({ GOOGLE_CLIENT_SECRET: 'x' }).proveedores()).toEqual({
        google: false,
      });
    });
  });

  describe('aceptarInvitacion (08.3)', () => {
    it('deja la cookie de refresh y no la devuelve en el cuerpo, como el login', async () => {
      const aceptar = jest.fn().mockResolvedValue({
        access_token: 'acc',
        refresh_token: 'ref',
        user: { id: 'u' },
      });
      const cookie = jest.fn();
      const res = await controller(
        {},
        {
          aceptarInvitacion: aceptar,
        },
      ).aceptarInvitacion('tok', { contrasena: 'una-clave-larga' }, {
        cookie,
      } as unknown as Response);

      expect(aceptar).toHaveBeenCalledWith('tok', 'una-clave-larga');
      expect(cookie).toHaveBeenCalledWith(
        'refresh_token',
        'ref',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(res).toEqual({ access_token: 'acc', user: { id: 'u' } });
    });
  });

  describe('restablecer', () => {
    it('el reset NO abre sesión: devuelve solo el mensaje', async () => {
      const elegir = jest
        .fn()
        .mockResolvedValue({ message: 'ok', usuarioId: 'u' });
      const res = await controller(
        {},
        {
          elegirContrasena: elegir,
        },
      ).restablecer('tok', { contrasena: 'una-clave-larga' });
      expect(res).toEqual({ message: 'ok' });
    });
  });
});
