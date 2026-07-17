import { IsString, Matches, IsUUID } from 'class-validator';

export class TransferirCuentaDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener 6 dígitos' })
  pin: string;
}

export class TransferirCuentaAdminDto {
  @IsUUID()
  garzonId: string;
}
