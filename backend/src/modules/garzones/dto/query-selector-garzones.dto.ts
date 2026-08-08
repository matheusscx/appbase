import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class QuerySelectorGarzonesDto {
  /**
   * Cuál de las dos listas complementarias se pide:
   * - `false` → los que **no** están en turno, para *entrar a turno*.
   * - `true` → los que **sí**, para todo lo demás.
   *
   * **Obligatorio a propósito, sin default.** Si faltara y asumiéramos uno, el
   * llamador que se olvide recibe la lista equivocada **sin ningún error**: le
   * ofrece al usuario gente que no puede hacer la acción, o le esconde a la que
   * sí. Un 400 acá es mucho más barato que un selector que miente.
   */
  // El query string trae 'true'/'false' como texto. Cualquier otra cosa
  // —incluido el param ausente— pasa tal cual para que `@IsBoolean` la rechace.
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value as unknown;
  })
  @IsBoolean({ message: 'enTurno debe ser true o false' })
  enTurno: boolean;
}
