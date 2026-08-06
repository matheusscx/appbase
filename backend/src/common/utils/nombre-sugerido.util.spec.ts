import { BadRequestException } from '@nestjs/common';
import {
  baseSinSufijo,
  sugerirNombreLibre,
  patronLikeNombre,
  traducirColisionDeNombre,
} from './nombre-sugerido.util';

describe('nombre-sugerido.util', () => {
  describe('baseSinSufijo', () => {
    it('saca el sufijo numérico', () => {
      expect(baseSinSufijo('Black Friday 2')).toBe('Black Friday');
      expect(baseSinSufijo('Black Friday 47')).toBe('Black Friday');
    });

    it('deja intacto un nombre sin sufijo', () => {
      expect(baseSinSufijo('Black Friday')).toBe('Black Friday');
    });

    it('solo saca el número FINAL, no uno del medio', () => {
      expect(baseSinSufijo('Promo 2x1 verano')).toBe('Promo 2x1 verano');
    });

    it('un número pegado al nombre no es sufijo (hace falta el espacio)', () => {
      expect(baseSinSufijo('Turno2')).toBe('Turno2');
    });
  });

  describe('sugerirNombreLibre', () => {
    it('arranca en 2, porque el 1 implícito es la fila viva que ocupa la base', () => {
      expect(sugerirNombreLibre('Black Friday', ['Black Friday'])).toBe(
        'Black Friday 2',
      );
    });

    it('saltea los que ya están tomados', () => {
      expect(
        sugerirNombreLibre('Black Friday', [
          'Black Friday',
          'Black Friday 2',
          'Black Friday 3',
        ]),
      ).toBe('Black Friday 4');
    });

    it('llena el hueco del medio en vez de ir al final', () => {
      expect(
        sugerirNombreLibre('Black Friday', [
          'Black Friday',
          'Black Friday 2',
          'Black Friday 4',
        ]),
      ).toBe('Black Friday 3');
    });

    it('reintentar sobre un nombre YA sufijado no encadena sufijos', () => {
      // El usuario editó a "Black Friday 2", que también estaba tomado: la
      // sugerencia siguiente es "Black Friday 3", nunca "Black Friday 2 2".
      // Se puede pelar el "2" porque "Black Friday" está vivo: esa es la señal
      // de que el sufijo lo pusimos nosotros.
      expect(
        sugerirNombreLibre('Black Friday 2', [
          'Black Friday',
          'Black Friday 2',
        ]),
      ).toBe('Black Friday 3');
    });

    // Lo encontró el e2e contra Postgres real, no el diseño: la fixture se
    // llamaba "... E2E <timestamp>" y la primera versión le arrancaba los
    // dígitos, sugiriendo un nombre de otra familia.
    it('NO pela el número cuando es parte del nombre y no un sufijo nuestro', () => {
      // No existe ningún "Descuento" vivo, así que el 50 no puede ser un
      // sufijo que hayamos generado: numerar sobre "Descuento" daría
      // "Descuento 2", que pierde el significado del nombre.
      expect(sugerirNombreLibre('Descuento 50', ['Descuento 50'])).toBe(
        'Descuento 50 2',
      );
    });

    it('el mismo nombre se pela o no según si su base está viva', () => {
      // "Turno 2" con un "Turno" vivo: el 2 es sufijo → numera sobre "Turno".
      expect(sugerirNombreLibre('Turno 2', ['Turno', 'Turno 2'])).toBe(
        'Turno 3',
      );
      // "Turno 2" sin ningún "Turno" vivo: el 2 es parte del nombre.
      expect(sugerirNombreLibre('Turno 2', ['Turno 2'])).toBe('Turno 2 2');
    });

    it('nunca devuelve un nombre de la lista de tomados', () => {
      const tomados = ['X', 'X 2', 'X 3', 'X 4', 'X 5'];
      expect(tomados).not.toContain(sugerirNombreLibre('X', tomados));
    });

    // 3 de los 5 recursos con índice único lo tienen sobre `lower(nombre)`
    // (`causas_merma`, `motivo_diferencia_caja`,
    // `motivo_diferencia_inventario` — medido con `pg_indexes`). Sin este
    // modo, la sugerencia devolvería un nombre que la BASE considera tomado y
    // el usuario recibiría el mismo 400 después de confirmar el modal.
    describe('ignorarMayusculas (tablas indexadas por lower(nombre))', () => {
      it('saltea un tomado que solo difiere en mayúsculas', () => {
        expect(sugerirNombreLibre('Merma', ['merma', 'MERMA 2'], true)).toBe(
          'Merma 3',
        );
      });

      it('sin el flag ese mismo caso devolvería un nombre que choca', () => {
        // Documenta por qué el flag existe: es el comportamiento correcto para
        // una tabla indexada por `nombre` pelado, y el incorrecto para las tres
        // indexadas por `lower(nombre)`.
        expect(sugerirNombreLibre('Merma', ['merma', 'MERMA 2'], false)).toBe(
          'Merma 2',
        );
      });

      it('pela el sufijo comparando sin mayúsculas', () => {
        // "Merma 2" con un "MERMA" vivo: el 2 es sufijo nuestro, así que
        // numera sobre "Merma" y no sobre "Merma 2".
        expect(sugerirNombreLibre('Merma 2', ['MERMA', 'merma 2'], true)).toBe(
          'Merma 3',
        );
      });

      it('con el flag no devuelve nada que colisione ignorando mayúsculas', () => {
        const tomados = ['x', 'X 2', 'x 3'];
        const sugerido = sugerirNombreLibre('X', tomados, true).toLowerCase();
        expect(tomados.map((t) => t.toLowerCase())).not.toContain(sugerido);
      });
    });
  });

  describe('patronLikeNombre', () => {
    it('arma el patrón de los nombres que compiten', () => {
      expect(patronLikeNombre('Black Friday')).toBe('Black Friday %');
    });

    it('escapa los comodines de LIKE', () => {
      // Sin escapar, "50%" matchearía cualquier nombre que empiece con "50",
      // así que la sugerencia contaría como tomados nombres ajenos y saltearía
      // números que en realidad estaban libres.
      expect(patronLikeNombre('50%_off')).toBe('50\\%\\_off %');
      expect(patronLikeNombre('a\\b')).toBe('a\\\\b %');
    });
  });

  // Estos tres viven acá y no en un service: son la SEMÁNTICA del helper, que
  // decide qué error se traduce y cuál no. Probándola en un módulo concreto,
  // el mock del módulo decide medio resultado; acá no hay dónde esconderse.
  describe('traducirColisionDeNombre', () => {
    const err23505 = () =>
      Object.assign(new Error('duplicate key'), { code: '23505' });

    it('devuelve el resultado cuando la escritura no falla', async () => {
      const revalidar = jest.fn();
      await expect(
        traducirColisionDeNombre(Promise.resolve('ok'), revalidar),
      ).resolves.toBe('ok');
      expect(revalidar).not.toHaveBeenCalled();
    });

    it('con 23505 y el nombre tomado, sale el error de quien revalida', async () => {
      await expect(
        traducirColisionDeNombre(Promise.reject(err23505()), () =>
          Promise.reject(new BadRequestException('Ya existe un descuento')),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('con 23505 pero el nombre libre, relanza el original', async () => {
      // El competidor abortó, o el 23505 vino de OTRO índice único: decir
      // "nombre repetido" mandaría a renombrar algo que no es la causa.
      const revalidar = jest.fn().mockResolvedValue(undefined);
      await expect(
        traducirColisionDeNombre(Promise.reject(err23505()), revalidar),
      ).rejects.toThrow('duplicate key');
      expect(revalidar).toHaveBeenCalled();
    });

    it('un error que no es 23505 ni siquiera pasa por revalidar', async () => {
      // Es la mitad que un test de service NO puede fijar: si el guard de
      // `code !== '23505'` desaparece, con el nombre libre igual sale el error
      // original y el test de arriba pasa lo mismo. Lo que lo delata es que
      // `revalidar` se llame — una query de más en CADA fallo de escritura.
      const revalidar = jest.fn();
      await expect(
        traducirColisionDeNombre(
          Promise.reject(new Error('db caída')),
          revalidar,
        ),
      ).rejects.toThrow('db caída');
      expect(revalidar).not.toHaveBeenCalled();
    });

    it('con el guard sacado, un no-23505 con el nombre tomado saldría como 400', async () => {
      // El contraejemplo explícito del punto anterior: si el helper dejara de
      // filtrar por código, este caso devolvería "Ya existe…" para una caída de
      // BD. Acá se fija que NO pasa.
      await expect(
        traducirColisionDeNombre(Promise.reject(new Error('db caída')), () =>
          Promise.reject(new BadRequestException('Ya existe un descuento')),
        ),
      ).rejects.toThrow('db caída');
    });
  });
});
