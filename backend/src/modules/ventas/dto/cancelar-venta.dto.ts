import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

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
}
