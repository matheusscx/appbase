import { TipoMotivoBaja } from './tipo-motivo-baja.enum';

export const MOTIVOS_BAJA_FIJOS: readonly {
  nombre: string;
  tipo: TipoMotivoBaja;
}[] = [
  { nombre: 'Vencimiento', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Deterioro', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Robo', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Error operativo', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Otro', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Cortesía de la casa', tipo: TipoMotivoBaja.CORTESIA },
  { nombre: 'No se llegó a hacer', tipo: TipoMotivoBaja.NO_ELABORADO },
];
