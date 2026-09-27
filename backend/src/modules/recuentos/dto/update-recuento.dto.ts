import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// ⛔ Deliberadamente SIN `ubicacionId`: una sesión de recuento no puede
// cambiar de ubicación una vez creada — sus líneas ya congelaron
// `stock_sistema` de lo que había EN esa ubicación. El `ValidationPipe`
// global rechaza lo que el DTO no declara, así que un `ubicacionId` en el body
// de este PATCH es un 400 que lo nombra y nunca llega al service (lo fija
// `recuentos.e2e-spec.ts`).
export class UpdateRecuentoDto {
  // null explícito limpia la causa por defecto de la sesión; undefined deja
  // el campo sin tocar.
  @IsOptional()
  @IsUUID()
  motivoDiferenciaDefaultId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comentario?: string;
}
