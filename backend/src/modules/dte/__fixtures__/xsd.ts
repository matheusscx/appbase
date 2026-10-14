import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

const DIR = join(__dirname, '..', 'esquemas');

/** Lee un XSD del SII como latin1: viene en ISO-8859-1 y xmllint recibe texto. */
const leer = (nombre: string) => ({
  fileName: nombre,
  contents: readFileSync(join(DIR, nombre), 'latin1'),
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
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [leer(xsdPrincipal)],
    preload: xsdDependencias.map(leer),
  });
  return { valido: r.valid, errores: r.errors.map((e) => e.message) };
}
