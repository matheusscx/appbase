import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

const DIR = join(__dirname, 'esquemas');

/**
 * xmllint recibe un string de JS, que llega como UTF-8 al sistema de archivos del wasm.
 * Si el prólogo sigue diciendo ISO-8859-1 lo lee como latin1 y cada Ñ cuenta por dos
 * (medido: 20 Ñ daban "largo 40" en un campo de 20). Los caracteres ya son los
 * correctos, así que se declara UTF-8 solo en memoria.
 */
const comoUtf8 = (texto: string) =>
  texto.replace(/^(<\?xml[^>]*encoding=")ISO-8859-1(")/i, '$1UTF-8$2');

/**
 * Lee un XSD del SII como latin1: viene en ISO-8859-1 y xmllint recibe texto.
 *
 * Una sola corrección: el EnvioBOLETA_v11 del SII restringe `PctType` (mínimo 0,01)
 * con `DescuentoPct`/`RecargoPct` de mínimo 0,00, y libxml2 se niega a compilar un
 * esquema así. Se sube el 0,00 a 0,01 solo en memoria, para el v11 y su copia por
 * igual; los archivos de `esquemas/` quedan como los publicó el SII.
 */
const leidos = new Map<string, { fileName: string; contents: string }>();
const leer = (nombre: string) => {
  let xsd = leidos.get(nombre);
  if (!xsd) {
    xsd = {
      fileName: nombre,
      contents: comoUtf8(
        readFileSync(join(DIR, nombre), 'latin1').replace(
          /<xs:minInclusive value="0\.00"\/>/g,
          '<xs:minInclusive value="0.01"/>',
        ),
      ),
    };
    leidos.set(nombre, xsd);
  }
  return xsd;
};

/**
 * Valida un XML contra un XSD de `esquemas/`. Cada XSD se lee del disco una sola vez por proceso.
 */
export async function validarContraXsd(
  xml: string,
  xsdPrincipal: string,
  xsdDependencias: string[],
): Promise<{ valido: boolean; errores: string[] }> {
  const r = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: comoUtf8(xml) }],
    schema: [leer(xsdPrincipal)],
    preload: xsdDependencias.map(leer),
  });
  return { valido: r.valid, errores: r.errors.map((e) => e.message) };
}

const XSD_SOBRE = 'EnvioBOLETA_v11_formato42.xsd';
const XSD_DEPENDENCIAS = ['xmldsignature_v10.xsd'];
const MAX_ERRORES = 5;
const MAX_LARGO_ERROR = 300;

export interface DteInvalido {
  tipo: number;
  folio: number;
  errores: string[];
}
export type RevisionSobre =
  | { valido: true }
  | { valido: false; errores: string[]; invalidos: DteInvalido[] };

const recortar = (errores: string[]) =>
  errores.slice(0, MAX_ERRORES).map((e) => e.slice(0, MAX_LARGO_ERROR));

/** Lo único que dice libxml de un sobre sin `<DTE>` cuando su carátula está bien. */
const SIN_DTE = /Element '\{[^}]*\}SetDTE': Missing child element/;

/**
 * El sobre real se valida una vez. Si falla, cada `<DTE>` se valida envuelto en el mismo sobre
 * (su carátula y su firma: el XSD mira la forma de la firma, no la verifica) para saber cuál es el
 * malo. Pero esa carátula viaja con cada una, así que un error de la carátula haría fallar a todas:
 * antes se valida el sobre sin ningún `<DTE>` (medido: con la carátula buena solo dice que falta un
 * `<DTE>`) y, si dice algo más, el error es del sobre mismo y `invalidos` queda vacío.
 */
export async function revisarSobreBoleta(
  sobre: string,
): Promise<RevisionSobre> {
  const todo = await validarContraXsd(sobre, XSD_SOBRE, XSD_DEPENDENCIAS);
  if (todo.valido) return { valido: true };
  const bloques = [...sobre.matchAll(/<DTE\b[\s\S]*?<\/DTE>/g)];
  const invalidos: DteInvalido[] = [];
  if (bloques.length > 0) {
    const primero = bloques[0];
    const ultimo = bloques[bloques.length - 1];
    const antes = sobre.slice(0, primero.index);
    const despues = sobre.slice(ultimo.index + ultimo[0].length);
    const caratula = await validarContraXsd(
      antes + despues,
      XSD_SOBRE,
      XSD_DEPENDENCIAS,
    );
    if (caratula.errores.every((e) => SIN_DTE.test(e))) {
      for (const b of bloques) {
        const solo = await validarContraXsd(
          antes + b[0] + despues,
          XSD_SOBRE,
          XSD_DEPENDENCIAS,
        );
        if (solo.valido) continue;
        invalidos.push({
          tipo: Number(/<TipoDTE>(\d+)<\/TipoDTE>/.exec(b[0])?.[1]),
          folio: Number(/<Folio>(\d+)<\/Folio>/.exec(b[0])?.[1]),
          errores: recortar(solo.errores),
        });
      }
    }
  }
  return { valido: false, errores: recortar(todo.errores), invalidos };
}
