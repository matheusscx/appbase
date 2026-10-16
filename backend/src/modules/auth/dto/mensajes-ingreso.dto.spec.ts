import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { UpdatePerfilDto } from '../../me/dto/update-perfil.dto';
import { UpdateContrasenaDto } from '../../me/dto/update-contrasena.dto';

// Auditoría UX 08.2 y 08.16: el validador no puede devolver su texto por defecto
// ("contrasena must be longer than…"): sale en inglés y con el nombre interno del
// campo. Y la contraseña lleva 8 caracteres como mínimo en las tres entradas.
async function mensajes<T extends object>(
  Dto: new () => T,
  datos: Record<string, unknown>,
): Promise<string[]> {
  const errores = await validate(plainToInstance(Dto, datos));
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('mensajes de validación del ingreso y de Mi cuenta', () => {
  const registroValido = {
    nombre: 'Ana',
    correo: 'ana@example.com',
    contrasena: '12345678',
  };

  it('el registro acepta 8 caracteres', async () => {
    expect(await mensajes(RegisterDto, registroValido)).toEqual([]);
  });

  it('el registro rechaza 7 caracteres, en español', async () => {
    expect(
      await mensajes(RegisterDto, { ...registroValido, contrasena: '1234567' }),
    ).toEqual(['La contraseña debe tener al menos 8 caracteres']);
  });

  it('el registro pide nombre y correo válido, en español', async () => {
    const msgs = await mensajes(RegisterDto, {
      nombre: undefined,
      correo: 'no-es-correo',
      contrasena: '12345678',
    });
    expect(msgs).toContain('Escribe tu nombre');
    expect(msgs).toContain('Escribe un correo válido');
  });

  it('el perfil con nombre vacío dice qué falta, en español', async () => {
    expect(await mensajes(UpdatePerfilDto, { nombre: '   ' })).toEqual([
      'Escribe tu nombre',
    ]);
  });

  it('cambiar la contraseña: los tres rechazos, en español', async () => {
    const msgs = await mensajes(UpdateContrasenaDto, {
      contrasenaActual: '',
      contrasenaNueva: 'corta',
      confirmarContrasena: '',
    });
    expect(msgs).toEqual(
      expect.arrayContaining([
        'Escribe tu contraseña actual',
        'La contraseña debe tener al menos 8 caracteres',
        'Repite la contraseña nueva',
      ]),
    );
    expect(msgs).toHaveLength(3);
  });
});
