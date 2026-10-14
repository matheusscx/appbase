import { rutValido } from '../../common/utils/rut.util';
import { DteError, type TipoBoleta } from './dte.types';
import type { AmbienteSii } from './entities/dte-caf.entity';
import { validarTexto } from './texto';

/** Por debajo de esto quedan pocos folios: se avisa para pedir otro CAF a tiempo. */
export const UMBRAL_FOLIOS = 100;
/** Con menos de esto por delante, el certificado se avisa como por vencer. */
export const DIAS_AVISO_CERTIFICADO = 30;

export type CodigoFaltante =
  | 'SIN_EMISOR'
  | 'RUT_INVALIDO'
  | 'SIN_GIRO'
  | 'SIN_COMUNA'
  | 'SIN_DIRECCION'
  | 'SIN_AMBIENTE'
  | 'SIN_RESOLUCION'
  | 'TEXTO_INVALIDO'
  | 'SIN_CERTIFICADO'
  | 'CERTIFICADO_VENCIDO'
  | 'SIN_FOLIOS_39';
export type CodigoAviso = 'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER';

export interface EmisorPerfil {
  razonSocialId: string;
  nombre: string;
  rut: string;
  direccion: string | null;
  giro: string | null;
  comuna: string | null;
  ambiente: AmbienteSii | null;
  fechaResolucion: string | null;
  numeroResolucion: number | null;
}
export interface CafPerfil {
  tipo: TipoBoleta;
  ambiente: AmbienteSii;
  restantes: number;
}
export interface Observacion<C> {
  codigo: C;
  mensaje: string;
}

const MS_DIA = 24 * 60 * 60 * 1000;

const NOMBRE_BOLETA: Record<TipoBoleta, string> = {
  39: 'boleta (39)',
  41: 'boleta exenta (41)',
};

/**
 * `DD-MM-AAAA` del día de Chile en que cae el instante. El certificado vence en un instante
 * (UTC) y al dueño del local se le dice el día que ve en su calendario: a las 22:00 del 15 en
 * Santiago ya es el 16 en UTC.
 */
export function fechaChile(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const de = (tipo: string) => partes.find((p) => p.type === tipo)?.value;
  return `${de('day')}-${de('month')}-${de('year')}`;
}

/**
 * Vacío para el perfil: nulo o solo espacios. Lo comparten `evaluarPerfil` y
 * `credencialesParaFirmar`. El predicado solo promete el lado falso (si no es vacío, es un
 * `string`): cuando da `true` el valor puede ser `'  '`, no `null`.
 */
export const vacio = (valor: string | null): valor is null =>
  valor === null || valor.trim() === '';

/**
 * Qué le falta al emisor para poder emitir boletas (`faltantes`) y qué conviene mirar ya
 * (`avisos`). Pura: sin base y sin reloj, `ahora` viene de afuera. Los mensajes son para el
 * dueño del local.
 */
export function evaluarPerfil(
  emisor: EmisorPerfil | null,
  certificado: { venceEl: Date } | null,
  cafs: CafPerfil[],
  ahora: Date,
): {
  faltantes: Observacion<CodigoFaltante>[];
  avisos: Observacion<CodigoAviso>[];
} {
  const faltantes: Observacion<CodigoFaltante>[] = [];
  const avisos: Observacion<CodigoAviso>[] = [];
  const falta = (codigo: CodigoFaltante, mensaje: string) =>
    faltantes.push({ codigo, mensaje });

  if (emisor === null) {
    falta('SIN_EMISOR', 'Falta cargar los datos de la empresa que emite');
  } else {
    const texto = (campo: string, valor: string | null, max: number) => {
      if (valor === null || vacio(valor)) return;
      try {
        validarTexto(campo, valor, max);
      } catch (e) {
        if (!(e instanceof DteError)) throw e;
        falta('TEXTO_INVALIDO', e.message);
      }
    };
    texto('El nombre de la empresa', emisor.nombre, 100);
    if (!rutValido(emisor.rut))
      falta('RUT_INVALIDO', 'El RUT de la empresa no es válido');
    if (vacio(emisor.giro)) falta('SIN_GIRO', 'Falta el giro de la empresa');
    else texto('El giro', emisor.giro, 80);
    if (vacio(emisor.comuna))
      falta('SIN_COMUNA', 'Falta la comuna de la empresa');
    else texto('La comuna', emisor.comuna, 20);
    if (vacio(emisor.direccion))
      falta('SIN_DIRECCION', 'Falta la dirección de la empresa');
    else texto('La dirección', emisor.direccion, 70);
    if (emisor.ambiente === null)
      falta(
        'SIN_AMBIENTE',
        'Falta elegir si la empresa emite en pruebas o en producción',
      );
    // El número 0 es válido (es el de la resolución de certificación): se pregunta por null.
    if (emisor.fechaResolucion === null || emisor.numeroResolucion === null)
      falta(
        'SIN_RESOLUCION',
        'Falta la fecha y el número de la resolución del SII',
      );
  }

  if (certificado === null) {
    falta('SIN_CERTIFICADO', 'Falta cargar el certificado digital');
  } else if (certificado.venceEl <= ahora) {
    falta(
      'CERTIFICADO_VENCIDO',
      `El certificado digital venció el ${fechaChile(certificado.venceEl)}`,
    );
  } else if (
    certificado.venceEl <
    new Date(ahora.getTime() + DIAS_AVISO_CERTIFICADO * MS_DIA)
  ) {
    avisos.push({
      codigo: 'CERTIFICADO_POR_VENCER',
      mensaje: `El certificado digital vence el ${fechaChile(certificado.venceEl)}`,
    });
  }

  // Solo cuentan los folios del ambiente del emisor: un CAF de pruebas no sirve en producción.
  const ambiente = emisor?.ambiente ?? null;
  const folios = new Map<TipoBoleta, number>();
  if (ambiente !== null) {
    for (const caf of cafs) {
      if (caf.ambiente !== ambiente) continue;
      folios.set(caf.tipo, (folios.get(caf.tipo) ?? 0) + caf.restantes);
    }
  }

  if ((folios.get(39) ?? 0) === 0)
    falta('SIN_FOLIOS_39', 'No hay folios de boleta (39) cargados');

  for (const [tipo, restantes] of folios) {
    // El 39 sin folios ya salió como faltante: no se repite como aviso.
    if (tipo === 39 && restantes === 0) continue;
    if (restantes < UMBRAL_FOLIOS)
      avisos.push({
        codigo: 'POCOS_FOLIOS',
        mensaje: `Quedan ${restantes} folios de ${NOMBRE_BOLETA[tipo]}`,
      });
  }

  return { faltantes, avisos };
}
