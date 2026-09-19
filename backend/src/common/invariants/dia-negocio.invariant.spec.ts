import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// Invariante Task 3 de `hora-de-corte` (spec § 3.2): "hoy" y cualquier
// filtro por fecha tienen que pasar por el día del NEGOCIO (zona + hora de
// corte del tenant) resuelto en `common/utils/rango-fecha.util.ts` — nunca
// por un día armado a mano en SQL o colapsado en JS con la hora de RELOJ.
// Un lector nuevo que escriba su propio `AT TIME ZONE`/`CURRENT_DATE`
// reintroduce el bug que esta feature entera existe para cerrar, y en
// silencio: compila, pasa lint, y solo se nota el día que alguien lo
// compara contra un reporte que sí usa el corte.

const SRC_MODULES = join(__dirname, '..', '..', 'modules');

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Quita comentarios de bloque y de línea, preservando la CANTIDAD de saltos
 * de línea (para que los `archivo:línea` reportados abajo sigan siendo
 * correctos). Hace falta: varios docblocks de este mismo frente CITAN el SQL
 * viejo (`AT TIME ZONE $N` sin corte, `CURRENT_DATE`) como el bug que
 * arreglan — esas citas no son una ofensa, son la explicación de por qué la
 * regla existe.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, ''))
    .replace(/\/\/.*$/gm, '');
}

// Hora de reloj, no día de negocio (spec § 3.2): el motor de precios y las
// promociones colapsan un instante a su fecha y hora LOCAL sin corte.
const RELOJ_ALLOWLIST = [
  'calculo-precios/calculo-precios.service.ts',
  'promociones/',
];

const PATRONES: { nombre: string; regex: RegExp; soloReloj: boolean }[] = [
  {
    nombre: 'AT TIME ZONE $n armado a mano (día armado a mano en SQL)',
    regex: /AT TIME ZONE \$/,
    soloReloj: false,
  },
  {
    nombre: 'CURRENT_DATE (el día en la zona de la SESIÓN, no del tenant)',
    regex: /CURRENT_DATE/,
    soloReloj: false,
  },
  {
    nombre:
      'instanteLocalEnZona/instanteLocalTenant/fechaLocalTenant fuera de la allowlist de reloj',
    regex: /\b(instanteLocalEnZona|instanteLocalTenant|fechaLocalTenant)\(/,
    soloReloj: true,
  },
];

describe('Invariante: nadie arma el día del negocio a mano', () => {
  it('todo lector de "hoy"/fecha pasa por rango-fecha.util, no por SQL o Intl sueltos', () => {
    const ofensores: string[] = [];

    for (const file of findTsFiles(SRC_MODULES)) {
      const relativo = file.slice(SRC_MODULES.length + 1);
      const enAllowlistDeReloj = RELOJ_ALLOWLIST.some((prefijo) =>
        relativo.startsWith(prefijo),
      );
      const lineas = sinComentarios(readFileSync(file, 'utf-8')).split('\n');

      for (const patron of PATRONES) {
        if (patron.soloReloj && enAllowlistDeReloj) continue;
        lineas.forEach((linea, i) => {
          if (patron.regex.test(linea)) {
            ofensores.push(`${relativo}:${i + 1} — ${patron.nombre}`);
          }
        });
      }
    }

    expect(ofensores).toEqual([]);
  });
});
