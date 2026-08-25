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
 *
 * 📌 **`campoValor` y `campoTramos` en `true` a la vez NO muestra los dos
 * campos**: significa que el tipo admite las dos formas de cobrar y el drawer
 * hace elegir una (ver `eligeForma` en las dos pantallas). Hoy pasa solo en los
 * dos tipos de método de pago, y el backend enforcea lo mismo del otro lado con
 * `validarFormaDeImporte`.
 */
export const DESCUENTO_CONFIG: Record<string, TipoConfig> = {
  // `directo` faltaba hasta el 2026-08-01: el tipo más básico ("Descuento
  // directo", el de propósito general) no mostraba ni modo ni valor. Se
  // encontró haciendo un smoke de otra feature, no por un test.
  directo:         { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: true,  campoFechaFin: true,  fechasRequeridas: false },
  // Las DOS formas: "3% con tarjeta" y "3% con tarjeta, 1,5% arriba de $100.000"
  // son la misma regla dicha distinto. El método de pago es la CONDICIÓN, no la
  // forma de importe, así que se combina con cualquiera de las dos (decisión del
  // owner, 2026-08-25). Hasta esa fecha `campoTramos` estaba en `false` y los
  // escalones solo eran alcanzables por API — y el motor ni los miraba.
  metodo_pago:     { modo: 'libre',      campoValor: true,  campoMetodos: true,  campoTramos: true,  labelTramos: 'Monto mínimo', campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  pronto_pago:     { modo: 'porcentaje', campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: true,  labelDias: 'Días antes del vencimiento', diasMin: 1, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  por_mayor:       { modo: 'libre',      campoValor: false, campoMetodos: false, campoTramos: true,  labelTramos: 'Cantidad mínima', campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  por_monto_venta: { modo: 'libre',      campoValor: false, campoMetodos: false, campoTramos: true,  labelTramos: 'Monto mínimo',    campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: true,  campoFechaFin: true,  fechasRequeridas: false },
}

export const RECARGO_CONFIG: Record<string, TipoConfig> = {
  general:             { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  mora:                { modo: 'libre',      campoValor: true,  campoMetodos: false, campoTramos: false, campoDias: true,  diasMin: 0, diasMax: 365,  campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  // Gemelo de `metodo_pago` del lado de los descuentos: los dos se mueven
  // juntos, siempre. Ver el comentario de allá.
  recargo_metodo_pago: { modo: 'libre',      campoValor: true,  campoMetodos: true,  campoTramos: true,  labelTramos: 'Monto mínimo', campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  interes_simple:      { modo: 'porcentaje', campoValor: true,  labelValor: 'Tasa mensual', campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  interes_compuesto:   { modo: 'porcentaje', campoValor: true,  labelValor: 'Tasa mensual', campoMetodos: false, campoTramos: false, campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: false, campoFechaFin: false, fechasRequeridas: false },
  // Espejo de `por_monto_venta` del lado de los descuentos: se expresa por
  // escalones, así que no lleva `valor` único (pedirlo sería pedir dos veces lo
  // mismo, y el backend lo rechaza).
  recargo_por_monto_venta: { modo: 'libre', campoValor: false, campoMetodos: false, campoTramos: true, labelTramos: 'Monto mínimo', campoDias: false, diasMin: 0, diasMax: 9999, campoFechaInicio: true, campoFechaFin: true, fechasRequeridas: false },
}
