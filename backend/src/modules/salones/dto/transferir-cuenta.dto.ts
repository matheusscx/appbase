import { CredencialGarzonDto } from '../../../common/dto/credencial-garzon.dto';
import { IsUUID } from 'class-validator';

/**
 * El garzón que **se lleva** la cuenta, no el que la entrega: la transferencia
 * es *pull* y quien se identifica es quien opera. Ver
 * `docs/features/salones-mesas.md`.
 */
export class TransferirCuentaDto extends CredencialGarzonDto {}

export class TransferirCuentaAdminDto {
  @IsUUID()
  garzonId: string;
}
