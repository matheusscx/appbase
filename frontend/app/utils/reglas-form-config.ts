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

/**
 * Qué campos muestra el drawer para cada `codigo` de `tipos_regla`.
 *
 * ⚠️ **Las claves tienen que cubrir TODOS los códigos que siembra el backend**
 * (`seeder.service.ts`, `clase: 'descuento'` / `'recargo'`). Un código sin
 * entrada acá no rompe nada visible: `config` queda `null` y el drawer
 * simplemente **no renderiza modo ni valor**, así que el usuario crea la regla
 * sin importe y no entiende por qué. Ni el build ni el typecheck lo ven —
 * `Record<string, TipoConfig>` acepta cualquier clave, y el `?? null` del
 * consumidor traga el faltante. Lo cubre `reglas-form-config.spec.ts`, que
 * compara estas claves contra la lista de códigos del seed.
 */
export const DESCUENTO_CONFIG: Record<string, TipoConfig> = {
  // `directo` faltaba hasta el 2026-08-01: el tipo más básico ("Descuento
  // directo", el de propósito general) no mostraba ni modo ni valor. Se
  // encontró haciendo un smoke de otra feature, no por un test.
  directo:         { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
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
