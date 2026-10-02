import {
  IsBoolean,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CancelarVentaDto {
  /**
   * Motivo obligatorio: una anulación sin explicación no sirve como auditoría.
   * El mínimo de 10 caracteres viene de la práctica del mercado (Toteat lo exige)
   * y evita el "ok"/"error" que no dice nada. Ver
   * `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.
   */
  @IsString()
  @MinLength(10, {
    message: 'El motivo de la anulación debe tener al menos 10 caracteres',
  })
  motivo: string;

  /**
   * Repone a stock lo que la venta había descontado. Por defecto `true`: lo
   * contrario pierde inventario en silencio. Se pone en `false` cuando la
   * mercadería ya no está vendible (equivalente a la "Anulación no Recuperable"
   * de Toteat) — ahí el descuento original queda en el kardex como pérdida.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;

  /**
   * La respuesta a "¿ya hiciste esta factura en tu facturador?" (E10), cuando la
   * venta tiene un documento hecho por fuera. **`undefined` y `false` son dos
   * conductas distintas**: sin respuesta el servidor la pide (400), con `false`
   * anula y deja registrado quién afirmó que no estaba hecho. Por eso no lleva
   * default: un `?? false` en cualquier capa convertiría "no me preguntaste" en
   * "no lo hice". El servidor la exige porque la pregunta de la pantalla sola no
   * alcanza.
   */
  // `@ValidateIf` y no `@IsOptional`: este último también deja pasar `null`, y
  // `null` no es "no contestó" ni "contestó que no": el servicio lo trataría como
  // una respuesta que nadie dio. Ausente sigue permitido; `null` es 400.
  @ValidateIf((_o: unknown, v: unknown) => v !== undefined)
  @IsBoolean()
  externoHecho?: boolean;
}
