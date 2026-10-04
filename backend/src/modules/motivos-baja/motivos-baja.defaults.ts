import { TipoMotivoBaja } from './tipo-motivo-baja.enum';

/** El nombre con que nace la causa fija de la merma de una nota de crédito. */
export const NOMBRE_DEVOLUCION = 'Devolución';

export const MOTIVOS_BAJA_FIJOS: readonly {
  nombre: string;
  tipo: TipoMotivoBaja;
  /** La causa de la merma de una nota de crédito (`motivo_baja.es_devolucion`). */
  esDevolucion?: true;
}[] = [
  { nombre: 'Vencimiento', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Deterioro', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Robo', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Error operativo', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Otro', tipo: TipoMotivoBaja.MERMA },
  { nombre: 'Cortesía de la casa', tipo: TipoMotivoBaja.CORTESIA },
  { nombre: 'No se llegó a hacer', tipo: TipoMotivoBaja.NO_ELABORADO },
  {
    nombre: 'Comida del personal (dentro del local)',
    tipo: TipoMotivoBaja.CONSUMO_PERSONAL,
  },
  { nombre: NOMBRE_DEVOLUCION, tipo: TipoMotivoBaja.MERMA, esDevolucion: true },
];
