import { CredencialGarzonOpcionalDto } from '../../../common/dto/credencial-garzon.dto';
import { IsUUID } from 'class-validator';
import { IdEnMinusculas } from '../../../common/decorators/id-en-minusculas.decorator';

/**
 * El garzón que **se lleva** la cuenta, no el que la entrega: la transferencia
 * es *pull* y quien se identifica es quien opera. Ver
 * `docs/features/salones-mesas.md`.
 */
export class TransferirCuentaDto extends CredencialGarzonOpcionalDto {}

export class TransferirCuentaAdminDto {
  // En minúsculas: `CuentaAsignacionesService.transferir` lo compara en
  // TypeScript contra el responsable que viene de la base. En mayúsculas el
  // guard "ya es responsable" no saltaba y quedaba un tramo del garzón a sí
  // mismo (medido el 2026-10-08).
  @IdEnMinusculas()
  @IsUUID()
  garzonId: string;
}
