import {
  calcularVenta,
  type ConfigCalculo,
  type ReglaResuelta,
  type LineaResuelta,
  type VentaResuelta,
} from '../../backend/src/modules/calculo-precios/calculo-precios.engine';

// resueltos.md, "En cascada, el orden entre porcentajes…". Correr desde backend/:
//   npx ts-node -T -P tsconfig.json ../docs/agent/medir-orden-porcentajes.ts
// Mide si el orden entre reglas de porcentaje del mismo paso cambia el total.
// Recorre todas las permutaciones de N porcentajes, con bases y porcentajes
// pseudoaleatorios (semilla fija), por nivel (linea/venta), modo de cálculo,
// nivel de redondeo, decimales de moneda y modo de redondeo.
//
// Resultado: hasta el 2026-09-13 el orden movía el total en `compuesto` (la tabla
// está en docs/agent/resueltos.md); con el porcentaje mayor primero da 0 de 384
// combinaciones. Sirve de red si se vuelve a tocar `ordenarReglas`.

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const permutaciones = <T>(xs: T[]): T[][] =>
  xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

const cfg = (over: Partial<ConfigCalculo>): ConfigCalculo => ({
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'compuesto',
  calculoRecargos: 'compuesto',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  decimalesMoneda: 0,
  promosAcumulanDescuentos: false,
  ...over,
});

const regla = (i: number, pct: string): ReglaResuelta => ({
  id: `r${i}`, nombre: `R${i}`, codigo: 'general', modo: 'porcentaje',
  valorMonto: null, valorPorcentaje: pct, tramos: [], metodoPagoIds: [], activo: true, vigente: true,
});

const linea = (precio: string, cantidad: string, desc: ReglaResuelta[], rec: ReglaResuelta[]): LineaResuelta => ({
  itemId: 'i1', cantidad, precioUnitario: precio, precioIncluyeImpuesto: false,
  clasificacionTributaria: 'afecto', descuentos: desc, recargos: rec,
  impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19', activo: true, tipo: 'iva' }],
});

type Caso = { nivel: 'linea' | 'venta'; paso: 'descuentos' | 'recargos'; modoCalc: string; nivelRed: 'linea' | 'documento'; dec: number; modo: ConfigCalculo['modoRedondeo']; n: number };

const resultados: Record<string, { casos: number; difieren: number; maxDelta: string; ejemplo?: string }> = {};

const pctAleatorio = () => (Math.floor(rnd() * 3500) / 10000 + 0.0001).toFixed(4); // 0.01%..35%
const precioAleatorio = (dec: number) => (rnd() * 50000 + 1).toFixed(dec === 0 ? 0 : dec);

for (const nivel of ['linea', 'venta'] as const)
for (const paso of ['descuentos', 'recargos'] as const)
for (const modoCalc of ['compuesto', 'base'])
for (const nivelRed of ['linea', 'documento'] as const)
for (const dec of [0, 2])
for (const modo of ['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'] as const)
for (const n of [2, 3, 4]) {
  const c: Caso = { nivel, paso, modoCalc, nivelRed, dec, modo, n };
  const key = JSON.stringify(c);
  const acc = (resultados[key] = { casos: 0, difieren: 0, maxDelta: '0' });
  for (let k = 0; k < 400; k++) {
    const pcts = Array.from({ length: n }, pctAleatorio);
    const precio = precioAleatorio(dec);
    const cantidad = String(1 + Math.floor(rnd() * 3));
    const totales = new Set<string>();
    let min: number | null = null, max: number | null = null;
    const porPerm: string[] = [];
    for (const perm of permutaciones(pcts.map((p, i) => ({ p, i })))) {
      const reglas = perm.map(({ p, i }) => regla(i, p));
      const config = cfg({
        [paso === 'descuentos' ? 'calculoDescuentos' : 'calculoRecargos']: modoCalc,
        nivelRedondeo: nivelRed, decimalesMoneda: dec, modoRedondeo: modo,
      } as Partial<ConfigCalculo>);
      const v: VentaResuelta = nivel === 'linea'
        ? { lineas: [linea(precio, cantidad, paso === 'descuentos' ? reglas : [], paso === 'recargos' ? reglas : [])], metodoPagoId: null, descuentosVenta: [], recargosVenta: [], promociones: [], config }
        : { lineas: [linea(precio, cantidad, [], [])], metodoPagoId: null, descuentosVenta: paso === 'descuentos' ? reglas : [], recargosVenta: paso === 'recargos' ? reglas : [], promociones: [], config };
      const t = calcularVenta(v).totales.totalFinal;
      totales.add(t);
      porPerm.push(`${perm.map((x) => x.p).join('→')}=${t}`);
      const num = Number(t);
      min = min === null ? num : Math.min(min, num);
      max = max === null ? num : Math.max(max, num);
    }
    acc.casos++;
    if (totales.size > 1) {
      acc.difieren++;
      const delta = (max! - min!).toFixed(dec + 2);
      if (Number(delta) > Number(acc.maxDelta)) acc.maxDelta = delta;
      if (!acc.ejemplo) acc.ejemplo = `precio ${precio} × ${cantidad}: ${porPerm.join(' | ')}`;
    }
  }
}

const filas = Object.entries(resultados).filter(([, r]) => r.difieren > 0);
console.log(`combinaciones con desvío: ${filas.length} de ${Object.keys(resultados).length}`);
for (const [k, r] of filas) { const c = JSON.parse(k); console.log([c.nivel, c.paso, c.modoCalc, c.nivelRed, "dec" + c.dec, c.modo, "n" + c.n].join(" "), `${r.difieren}/${r.casos}`, `maxDelta=${r.maxDelta}`); }
