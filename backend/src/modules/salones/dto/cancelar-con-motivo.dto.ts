import { IsUUID } from 'class-validator';

/**
 * `POST /cuentas/:id/cancelar-con-motivo` (spec
 * `2026-09-16-anular-plato-despachado-design.md` § 6): cancela una cuenta con
 * algo despachado, anulando cada línea viva con `cantidad_enviada > 0` por su
 * `cantidad_enviada`, con este motivo. Mismo molde que `AnularLineaDto`: acá
 * no viaja `cantidad` porque la decide el servidor (la despachada de CADA
 * línea), no quien llama.
 */
export class CancelarConMotivoDto {
  @IsUUID()
  motivoBajaId: string;
}
