export type ModoConfig = 'libre' | 'porcentaje'

export interface TipoConfig {
  modo: ModoConfig
  campoValor: boolean
  labelValor?: string
  campoMetodos: boolean
  campoTramos: boolean
  labelTramos?: string
  campoDias: boolean
  labelDias?: string
  diasMin: number
  diasMax: number
  campoFechaInicio: boolean
  campoFechaFin: boolean
  fechasRequeridas: boolean
}

export const DESCUENTO_CONFIG: Record<string, TipoConfig> = {
  metodo_pago:     { modo: 'libre',      campoValor: true,  campoMetodos: true,  campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  pronto_pago:     { modo: 'porcentaje', campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: true,  labelDias: 'Días antes del vencimiento', diasMin: 1, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  por_mayor:       { modo: 'libre',      campoValor: false, campoMetodos: false, campoTramos: true,  labelTramos: 'Cantidad mínima', campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  por_monto_venta: { modo: 'libre',      campoValor: false, campoMetodos: false, campoTramos: true,  labelTramos: 'Monto mínimo',    campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: true,  campoFechaFin: true,  fechasRequeridas: false },
  promocional:     { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: true,  campoFechaFin: true,  fechasRequeridas: true  },
}

export const RECARGO_CONFIG: Record<string, TipoConfig> = {
  general:             { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  mora:                { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: true,  diasMin: 0, diasMax: 365,  campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  recargo_metodo_pago: { modo: 'libre',      campoValor: true,  campoMetodos: true,  campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  interes_simple:      { modo: 'porcentaje', campoValor: true,  labelValor: 'Tasa mensual', campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  interes_compuesto:   { modo: 'porcentaje', campoValor: true,  labelValor: 'Tasa mensual', campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
}
