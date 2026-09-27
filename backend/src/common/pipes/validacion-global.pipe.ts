import { ValidationPipe } from '@nestjs/common';

/**
 * El `ValidationPipe` global de la API, en un solo lugar: lo usan `main.ts` y
 * cada spec e2e que arma su app. El e2e no ejecuta `main.ts`, y mientras el
 * pipe estuvo copiado en los specs (112 copias) cambiar la línea de `main.ts`
 * dejaba al e2e probando el pipe viejo contra una API que ya era otra.
 *
 * Que nadie vuelva a construir uno propio lo cuida
 * `src/common/invariants/validacion-global.invariant.spec.ts`.
 *
 * `forbidNonWhitelisted` (owner, 2026-09-27): lo que el DTO no declara es un
 * 400 que nombra el campo. Hasta esa fecha `whitelist` lo borraba en silencio y
 * la request contestaba 200, así que un cliente que mandaba un campo mal
 * escrito —o un filtro que el DTO no tenía— creía que se había aplicado. Lo
 * fija `test/validacion-global.e2e-spec.ts`, junto con lo que no toca: el login
 * y los retornos de Webpay, que no pasan un DTO.
 */
export function validacionGlobal(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
