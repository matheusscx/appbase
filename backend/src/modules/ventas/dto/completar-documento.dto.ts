import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { ClaseDocumentoMaquina } from '../../venta-documentos/entities/venta-documento.entity';

/**
 * Completar después el número de un documento de la máquina o hecho por fuera
 * (spec `2026-10-01-emision-por-venta`, § 3.4). El cliente manda lo que tipeó:
 * nunca quién emitió ni a qué venta pertenece (eso lo dicen la ruta y el token).
 */
export class CompletarDocumentoDto {
  /**
   * Mismas reglas que `numeroDocumento` de `PagoVentaDto`, y además no vacío:
   * este endpoint existe para escribir un número, así que "" no tiene qué hacer
   * (en el cobro "sin número" se expresa omitiéndolo).
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'numero no puede estar vacío' })
  @MaxLength(40)
  // Sin caracteres de control: un salto de línea o un NUL en el número llegaría
  // a la base y a lo que se imprima. Con el `trim` de arriba, los de los
  // extremos ya no están; acá se rechazan los del medio.
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001F\u007F]*$/, {
    message: 'numero no puede llevar caracteres de control',
  })
  numero: string;

  /**
   * Qué emitió la máquina. Solo vale con un documento de la máquina (con uno
   * `externo` el servidor responde 400). Ausente deja la clase como estaba; por
   * eso `@ValidateIf` y no `@IsOptional`: este último deja pasar `null`, que no
   * es "ausente" y el servicio no sabría si borrar la clase o conservarla.
   */
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsIn(['voucher', 'boleta'])
  clase?: ClaseDocumentoMaquina;
}
