import { Transform } from 'class-transformer';

const aMinusculas = (v: unknown): unknown =>
  typeof v === 'string' ? v.toLowerCase() : v;

/**
 * Un UUID del body pasa a minúsculas **antes de validar**: un string suelto o
 * cada string de un array. Lo que no es string pasa intacto y lo rechaza el
 * decorador de tipo que lo acompaña (`@IsUUID`, `@IsArray`).
 *
 * `@IsUUID` acepta `A1B2…` y la base devuelve los ids en minúsculas, así que en
 * cuanto el id se compara en TypeScript deja de encontrarse. Medido el
 * 2026-10-08: un `metodoPagoId` en mayúsculas cobraba **sin** el recargo por
 * método de pago, y los ids de reglas y de la personalización daban 400 "no
 * encontrado" o "no pertenece".
 *
 * Es la forma para **el borde**: cuando el propio DTO compara —`@ArrayUnique`
 * corre en el pipe, antes que cualquier service, y sin esto `[x, X]` pasa como
 * dos ids distintos— o cuando el mismo campo lo leen varias funciones. Las otras
 * dos formas del repo, y cuándo va cada una: `docs/patterns/backend.md` § "Un
 * UUID validado puede venir en mayúsculas".
 */
export const IdEnMinusculas = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map(aMinusculas) : aMinusculas(value),
  );
