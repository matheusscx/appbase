import { ValidationPipe } from '@nestjs/common';

/**
 * El `ValidationPipe` global de la API, en un solo lugar: lo usan `main.ts` y
 * cada spec e2e que arma su app. El e2e no ejecuta `main.ts`, y mientras el
 * pipe estuvo copiado en los specs (112 copias) cambiar la línea de `main.ts`
 * dejaba al e2e probando el pipe viejo contra una API que ya era otra.
 *
 * Que nadie vuelva a construir uno propio lo cuida
 * `src/common/invariants/validacion-global.invariant.spec.ts`.
 */
export function validacionGlobal(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, transform: true });
}
