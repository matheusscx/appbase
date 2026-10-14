import { readFileSync } from 'fs';
import { join } from 'path';

/** Del ejemplo oficial del SII salen las firmas y el TED que el XSD acepta tal cual. */
const EJEMPLO = readFileSync(
  join(__dirname, 'sii', 'F60T33-ejemplo.xml'),
  'latin1',
);
const firmas = EJEMPLO.match(/<Signature[\s\S]*?<\/Signature>/g)!;
const FIRMA_DTE = firmas[0];
const FIRMA_ENVIO = firmas[firmas.length - 1];
const TED = EJEMPLO.match(/<TED[\s\S]*?<\/TED>/)![0];

/**
 * Un `<TED>` armado a mano que cumple el XSD (no tiene firma válida): el del
 * ejemplo del SII con el tipo y el folio de la boleta. Solo para pruebas del XSD.
 */
export function tedParaXsd(tipo: 39 | 41, folio: number): string {
  return TED.replace(/<TD>33<\/TD>/g, `<TD>${tipo}</TD>`).replace(
    '<F>60</F>',
    `<F>${folio}</F>`,
  );
}

/**
 * Envuelve un `<Documento>` en un `EnvioBOLETA` mínimo que el XSD acepta, con
 * firmas de relleno. `Documento` no es un elemento global del esquema: solo
 * se puede validar dentro de su envío. El sobre real es de la Task 8.
 */
export function envolverParaXsd(documentoXml: string, tipo: 39 | 41): string {
  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>' +
    '<EnvioBOLETA xmlns="http://www.sii.cl/SiiDte" version="1.0">' +
    '<SetDTE ID="SetDoc"><Caratula version="1.0">' +
    '<RutEmisor>76543210-3</RutEmisor><RutEnvia>76543210-3</RutEnvia>' +
    '<RutReceptor>60803000-K</RutReceptor><FchResol>2026-01-01</FchResol>' +
    '<NroResol>0</NroResol><TmstFirmaEnv>2026-10-14T12:00:00</TmstFirmaEnv>' +
    `<SubTotDTE><TpoDTE>${tipo}</TpoDTE><NroDTE>1</NroDTE></SubTotDTE>` +
    '</Caratula>' +
    `<DTE version="1.0">${documentoXml}${FIRMA_DTE}</DTE>` +
    '</SetDTE>' +
    `${FIRMA_ENVIO}</EnvioBOLETA>`
  );
}
