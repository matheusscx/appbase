import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, ValidateBy } from 'class-validator';
import { normalizarRut, rutValido } from '../utils/rut.util';

/**
 * El RUT de un tercero (auditoría UX 06.16, owner 2026-10-17): formato y dígito
 * verificador se validan y lo que se guarda tiene siempre la misma forma
 * (`'76.543.210-3'` → `'76543210-3'`, ver `normalizarRut`).
 *
 * Opcional: ausente, `null`, `''` y solo espacios no se validan; el texto en
 * blanco pasa a `null` (en una columna nullable, "sin RUT"), no a `''`. La
 * normalización corre **antes** de validar, así que un RUT con puntos y otro
 * sin ellos son el mismo valor.
 *
 * El mensaje lleva el nombre del campo por delante (`rut El RUT no es válido`)
 * para que la pantalla lo ponga junto al campo (`apiFieldErrors`).
 */
export function RutChileno(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) => {
      if (typeof value !== 'string') return value;
      return value.trim() === '' ? null : normalizarRut(value);
    }),
    IsOptional(),
    ValidateBy({
      name: 'rutChileno',
      validator: {
        validate: (v: unknown) => typeof v === 'string' && rutValido(v),
        defaultMessage: (args) =>
          `${args?.property ?? 'rut'} El RUT no es válido`,
      },
    }),
  );
}
