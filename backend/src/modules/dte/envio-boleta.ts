import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import { armarDocumento } from './boleta-documento';
import type { CafLeido } from './caf';
import { type DatosBoleta, DteError, type TipoBoleta } from './dte.types';
import { type CertificadoLeido, firmarNodo } from './firma';
import { armarTed } from './ted';
import { escaparXml, validarTexto } from './texto';

const SII = 'http://www.sii.cl/SiiDte';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';

/** Tope de boletas por `EnvioBOLETA` (el SII rechaza más de 500). */
const MAX_BOLETAS_POR_ENVIO = 500;

export interface BoletaEmitida {
  /** El <DTE> firmado, como texto; los bytes al SII salen de aLatin1. */
  xml: string;
  folio: number;
  tipo: TipoBoleta;
  diferenciaIvaRedondeo: string;
}

export interface CaratulaEnvio {
  rutEmisor: string;
  /** El SII es siempre quien recibe el envío. */
  rutReceptor: '60803000-K';
  /** AAAA-MM-DD */
  fchResol: string;
  nroResol: number;
}

const el = (tag: string, valor: string) => `<${tag}>${valor}</${tag}>`;

/**
 * Emite una boleta: TED, `<Documento>` y `<DTE>` con el `Documento` firmado. Todo `DteError`
 * de las etapas sale tal cual; el motor no envuelve ni traga nada. `ahora` es la hora de
 * Chile (AAAA-MM-DDTHH:MM:SS) que decide quien llama: TSTED y TmstFirma.
 */
export function emitirBoleta(
  datos: DatosBoleta,
  credenciales: { caf: CafLeido; certificado: CertificadoLeido },
  ahora: string,
): BoletaEmitida {
  const ted = armarTed(datos, credenciales.caf, ahora);
  const { xml, id, diferenciaIvaRedondeo } = armarDocumento(datos, ted, ahora);

  // Mismos namespaces que la raíz del sobre (Task 1): así la forma canónica inclusiva del
  // Documento es la misma suelto y dentro del EnvioBOLETA, y la firma verifica en los dos.
  const dte = `<DTE xmlns="${SII}" xmlns:xsi="${XSI}" version="1.0">${xml}</DTE>`;

  return {
    xml: firmarNodo(dte, id, credenciales.certificado),
    folio: datos.folio,
    tipo: datos.tipo,
    diferenciaIvaRedondeo,
  };
}

function rut(campo: string, valor: string): string {
  if (!rutValido(valor))
    throw new DteError(
      'RUT_INVALIDO',
      `${campo} no es un RUT válido: "${valor}"`,
    );
  return normalizarRut(valor);
}

/**
 * Arma el `EnvioBOLETA` firmado con las boletas ya emitidas: Carátula con un subtotal por
 * tipo, los `<DTE>` dentro del `SetDTE ID="SetDoc"` y la firma del `SetDTE` al final, ya con
 * los `<DTE>` adentro (firmarlo antes los dejaría fuera de lo firmado).
 */
export function armarEnvioBoleta(
  boletas: BoletaEmitida[],
  caratula: CaratulaEnvio,
  certificado: CertificadoLeido,
  ahora: string,
): string {
  if (boletas.length === 0)
    throw new DteError('ENVIO_VACIO', 'El envío no tiene boletas');
  if (boletas.length > MAX_BOLETAS_POR_ENVIO)
    throw new DteError(
      'ENVIO_DEMASIADAS_BOLETAS',
      `Un envío admite ${MAX_BOLETAS_POR_ENVIO.toString()} boletas y trae ${boletas.length.toString()}`,
    );

  const porTipo = new Map<TipoBoleta, number>();
  for (const b of boletas) porTipo.set(b.tipo, (porTipo.get(b.tipo) ?? 0) + 1);
  const subtotales = [...porTipo.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tipo, n]) =>
      el(
        'SubTotDTE',
        el('TpoDTE', tipo.toString()) + el('NroDTE', n.toString()),
      ),
    )
    .join('');

  const cabecera =
    el('RutEmisor', rut('RutEmisor', caratula.rutEmisor)) +
    el('RutEnvia', certificado.rut) +
    el('RutReceptor', caratula.rutReceptor) +
    el(
      'FchResol',
      escaparXml(validarTexto('FchResol', caratula.fchResol, 10)),
    ) +
    el('NroResol', caratula.nroResol.toString()) +
    el('TmstFirmaEnv', escaparXml(validarTexto('TmstFirmaEnv', ahora, 19))) +
    subtotales;

  const envio =
    `<EnvioBOLETA xmlns="${SII}" xmlns:xsi="${XSI}" ` +
    `xsi:schemaLocation="${SII} EnvioBOLETA_v11.xsd" version="1.0">` +
    `<SetDTE ID="SetDoc"><Caratula version="1.0">${cabecera}</Caratula>` +
    boletas.map((b) => b.xml).join('') +
    '</SetDTE></EnvioBOLETA>';

  return (
    '<?xml version="1.0" encoding="ISO-8859-1"?>' +
    firmarNodo(envio, 'SetDoc', certificado)
  );
}
