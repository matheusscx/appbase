import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

const DIR = join(__dirname, '..', 'esquemas');

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
const leer = (nombre: string) => ({
  fileName: nombre,
  contents: comoUtf8(
    readFileSync(join(DIR, nombre), 'latin1').replace(
      /<xs:minInclusive value="0\.00"\/>/g,
      '<xs:minInclusive value="0.01"/>',
    ),
  ),
});

/**
 * Valida un XML contra un XSD de `esquemas/`. Solo para pruebas
 * (`xmllint-wasm` es dependencia de desarrollo).
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
