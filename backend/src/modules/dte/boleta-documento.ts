import Decimal from 'decimal.js';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import { type DatosBoleta, DteError } from './dte.types';
import { verificarMontos } from './montos';
import { escaparXml, validarTexto } from './texto';

/** RUT genérico del receptor cuando la boleta no lo identifica (Formato Boletas v4.2, campo 18). */
const RUT_GENERICO = '66666666-6';

/** Texto de un campo del XML: validado contra su largo y escapado. */
const t = (campo: string, valor: string, max: number) =>
  escaparXml(validarTexto(campo, valor, max));

/** Número sin ceros de relleno ni notación científica: `Decimal`, nunca `number`. */
const num = (v: string) => new Decimal(v).toFixed();

const el = (tag: string, valor: string) => `<${tag}>${valor}</${tag}>`;

function rut(campo: string, valor: string): string {
  if (!rutValido(valor))
    throw new DteError(
      'RUT_INVALIDO',
      `${campo} no es un RUT válido: "${valor}"`,
    );
  return normalizarRut(valor);
}

/**
 * Arma el `<Documento>` de la boleta con el orden del XSD (EnvioBOLETA v11 + campos del
 * formato v4.2). Antes de escribir una línea verifica los montos y valida todo texto:
 * lo que sale es exactamente lo congelado, o no sale. El `<DTE>` y el sobre son de la Task 8.
 */
export function armarDocumento(
  datos: DatosBoleta,
  tedXml: string,
  tmstFirma: string,
): { xml: string; id: string; diferenciaIvaRedondeo: string } {
  const { diferenciaIvaRedondeo } = verificarMontos(datos);

  // Sobre 135 UF (Ley 21.713): el receptor, su nombre y el medio de pago son obligatorios.
  const r = datos.receptor;
  if (
    datos.superaUmbralIdentificacion &&
    (!r ||
      !rutValido(r.rut) ||
      normalizarRut(r.rut) === RUT_GENERICO ||
      !r.nombre?.trim() ||
      datos.medioPago === undefined)
  ) {
    throw new DteError(
      'FALTA_IDENTIFICACION_135_UF',
      'Una venta sobre 135 UF necesita RUT del receptor, su nombre y el medio de pago',
    );
  }

  const e = datos.emisor;
  const rutEmisor = rut('RUTEmisor', e.rut);
  const rutProv = rut('RutProvSW', datos.proveedorSoftware.rut);
  const rutRecep = r ? rut('RUTRecep', r.rut) : RUT_GENERICO;

  const id = `B${datos.tipo}F${datos.folio}`;

  const idDoc =
    el('TipoDTE', String(datos.tipo)) +
    el('Folio', String(datos.folio)) +
    el('FchEmis', t('FchEmis', datos.fechaEmision, 10)) +
    el('IndServicio', '3') +
    (datos.medioPago === undefined
      ? ''
      : el('MedioPago', String(datos.medioPago)));

  const emisor =
    el('RUTEmisor', rutEmisor) +
    el('RznSocEmisor', t('RznSocEmisor', e.razonSocial, 100)) +
    el('GiroEmisor', t('GiroEmisor', e.giro, 80)) +
    (e.cdgSiiSucur
      ? el('CdgSIISucur', t('CdgSIISucur', e.cdgSiiSucur, 9))
      : '') +
    el('DirOrigen', t('DirOrigen', e.direccion, 70)) +
    el('CmnaOrigen', t('CmnaOrigen', e.comuna, 20));

  const receptor =
    el('RUTRecep', rutRecep) +
    (r?.nombre ? el('RznSocRecep', t('RznSocRecep', r.nombre, 100)) : '') +
    (r?.correo ? el('CorreoRecep', t('CorreoRecep', r.correo, 80)) : '') +
    (r?.telefono
      ? el('TelefonoRecep', t('TelefonoRecep', r.telefono, 20))
      : '');

  // Campos 30 y 31 del formato: hijos de Encabezado entre Receptor y Totales (el padre se
  // infiere de la numeración, el SII no lo publica).
  const proveedor =
    el('RutProvSW', rutProv) +
    el(
      'RznSocProvSW',
      t('RznSocProvSW', datos.proveedorSoftware.razonSocial, 100),
    );

  // Sin MntNeto ni IVA en la 41 (y el IVA no admite 0 en el XSD): solo lo que vale algo.
  const m = datos.montos;
  const positivo = (v: string) => new Decimal(v).gt(0);
  const totales =
    (positivo(m.neto) ? el('MntNeto', num(m.neto)) : '') +
    (positivo(m.exento) ? el('MntExe', num(m.exento)) : '') +
    (positivo(m.iva) ? el('IVA', num(m.iva)) : '') +
    el('MntTotal', num(m.total));

  const detalle = datos.lineas
    .map((l, i) =>
      el(
        'Detalle',
        el('NroLinDet', String(i + 1)) +
          (l.exenta ? el('IndExe', '1') : '') +
          el('NmbItem', t(`NmbItem de la línea ${i + 1}`, l.nombre, 80)) +
          (l.cantidad === undefined ? '' : el('QtyItem', num(l.cantidad))) +
          (l.precioUnitario === undefined
            ? ''
            : el('PrcItem', num(l.precioUnitario))) +
          (l.descuentoMonto === undefined
            ? ''
            : el('DescuentoMonto', num(l.descuentoMonto))) +
          (l.recargoMonto === undefined
            ? ''
            : el('RecargoMonto', num(l.recargoMonto))) +
          el('MontoItem', num(l.monto)),
      ),
    )
    .join('');

  const ajustes = datos.ajustesGlobales
    .map((a, i) =>
      el(
        'DscRcgGlobal',
        el('NroLinDR', String(i + 1)) +
          el('TpoMov', a.tipo) +
          (a.glosa
            ? el('GlosaDR', t(`GlosaDR del ajuste ${i + 1}`, a.glosa, 45))
            : '') +
          el('TpoValor', '$') +
          el('ValorDR', num(a.monto)) +
          (a.exento ? el('IndExeDR', '1') : ''),
      ),
    )
    .join('');

  const xml =
    `<Documento ID="${id}">` +
    el(
      'Encabezado',
      el('IdDoc', idDoc) +
        el('Emisor', emisor) +
        el('Receptor', receptor) +
        proveedor +
        el('Totales', totales),
    ) +
    detalle +
    ajustes +
    tedXml +
    el('TmstFirma', t('TmstFirma', tmstFirma, 19)) +
    '</Documento>';

  return { xml, id, diferenciaIvaRedondeo };
}
