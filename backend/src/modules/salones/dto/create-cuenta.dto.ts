import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateCuentaDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  // PIN del garzón que abre la cuenta (identificación operativa).
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;
}
