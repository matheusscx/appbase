import { IsEmail, IsString, IsUrl, Length, Matches } from 'class-validator';

export class CreateInscripcionDto {
  @IsString()
  @Length(1, 100)
  @Matches(/^\S+$/, { message: 'pagadorRef no admite espacios' })
  pagadorRef: string;

  @IsEmail()
  email: string;

  @IsUrl({ require_tld: false }) // permite http://localhost en dev
  urlRetorno: string;
}
