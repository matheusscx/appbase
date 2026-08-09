import { IsBoolean } from 'class-validator';

/**
 * Marca una cuenta del tenant como **tótem compartido**.
 *
 * Es un booleano explícito y no un endpoint "togglear": el estado que el admin
 * quiere viaja en el body, así que dos clicks simultáneos desde dos pantallas
 * no dejan el marcador en el valor contrario al que muestra ninguna de las dos.
 */
export class MarcarTotemDto {
  @IsBoolean()
  esTotem: boolean;
}
