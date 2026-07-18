import { useApiFetch } from './useApiFetch';

export type TipoTrabajador = 'garzon' | 'cocina' | 'barra';
export type ReporteTab = 'resumen' | 'trabajadores';

export interface PropinaReporteFiltrosUi {
  desde: string;
  hasta: string;
  turnoIds: string[];
  tipoGarzon?: TipoTrabajador;
}

export interface PropinaReporteResumen {
  periodo: { desde: string; hasta: string };
  cobranza: {
    cierres: number;
    conPropina: number;
    sinPropina: number;
    sugerenciaAceptada: number;
    montoCobrado: string;
    montoSugerido: string;
    promedioConPropina: string;
    tasaConPropina: string;
    tasaSugerenciaAceptada: string;
  };
  estadoActual: {
    pendienteLibreCantidad: number;
    pendienteLibreMonto: string;
    enBorradorCantidad: number;
    enBorradorMonto: string;
    liquidadaCantidad: number;
    liquidadaMonto: string;
  };
  anulaciones: {
    liquidaciones: number;
    montoLiberadoHistorico: string;
  };
  tendencia: Array<{
    fecha: string;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  porTurno: Array<{
    turnoId: string | null;
    turnoNombre: string;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  porTipo: Array<{
    tipoGarzon: TipoTrabajador | null;
    cierres: number;
    conPropina: number;
    montoCobrado: string;
  }>;
  advertencias: {
    liquidacionesParcialmenteSolapadas: number;
  };
}

export interface PropinaReporteTrabajador {
  garzonId: string;
  nombre: string;
  tipoGarzon: TipoTrabajador;
  origen: {
    cierres: number;
    conPropina: number;
    monto: string;
  };
  asignacionConfirmada: {
    monto: string;
    horas: string;
    ventasBase: string;
    cuentas: string;
    liquidaciones: number;
    ultimaLiquidacionEl: string | null;
  };
}

export interface PropinaReporteTrabajadores {
  data: PropinaReporteTrabajador[];
  totales: {
    trabajadores: number;
    montoOriginado: string;
    montoAsignado: string;
    horas: string;
    ventasBase: string;
    cuentas: string;
  };
  advertencias: {
    liquidacionesParcialmenteSolapadas: number;
    liquidacionesTodosLosTurnosExcluidas: number;
  };
}

export interface PropinaReporteQuery {
  desde: string;
  hasta: string;
  turnoIds?: string;
  tipoGarzon?: TipoTrabajador;
}

function validarFecha(value: string): number {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Las fechas deben usar YYYY-MM-DD');
  }
  return timestamp;
}

export function serializarFiltrosReporte(
  filtros: PropinaReporteFiltrosUi,
): PropinaReporteQuery {
  if (!filtros.desde || !filtros.hasta) {
    throw new Error('Selecciona un rango de fechas');
  }
  const desdeMs = validarFecha(filtros.desde);
  const hastaInclusivoMs = validarFecha(filtros.hasta);
  if (hastaInclusivoMs < desdeMs) {
    throw new Error('La fecha hasta debe ser igual o posterior a desde');
  }
  const hastaExclusivo = new Date(hastaInclusivoMs);
  hastaExclusivo.setUTCDate(hastaExclusivo.getUTCDate() + 1);

  return {
    desde: filtros.desde,
    hasta: hastaExclusivo.toISOString().slice(0, 10),
    ...(filtros.turnoIds.length
      ? { turnoIds: [...filtros.turnoIds].sort().join(',') }
      : {}),
    ...(filtros.tipoGarzon ? { tipoGarzon: filtros.tipoGarzon } : {}),
  };
}

export function crearCachePropinaReportes() {
  const resumen = new Map<string, PropinaReporteResumen>();
  const trabajadores = new Map<string, PropinaReporteTrabajadores>();

  return {
    get(tab: ReporteTab, key: string) {
      return tab === 'resumen' ? resumen.get(key) : trabajadores.get(key);
    },
    set(
      tab: ReporteTab,
      key: string,
      value: PropinaReporteResumen | PropinaReporteTrabajadores,
    ) {
      if (tab === 'resumen') {
        resumen.set(key, value as PropinaReporteResumen);
      } else {
        trabajadores.set(key, value as PropinaReporteTrabajadores);
      }
    },
    clear() {
      resumen.clear();
      trabajadores.clear();
    },
  };
}

const cache = crearCachePropinaReportes();

function queryString(filtros: PropinaReporteFiltrosUi): string {
  const query = serializarFiltrosReporte(filtros);
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => params.set(key, value));
  return params.toString();
}

export function claveFiltrosReporte(filtros: PropinaReporteFiltrosUi): string {
  return JSON.stringify(serializarFiltrosReporte(filtros));
}

export function claveCachePropinaReportes(
  tenantId: string | null | undefined,
  filtros: PropinaReporteFiltrosUi,
): string {
  return `${tenantId ?? 'sin-tenant'}:${claveFiltrosReporte(filtros)}`;
}

export function usePropinaReportes() {
  const apiUrl = useRuntimeConfig().public.apiUrl;
  const authStore = useAuthStore();

  const resumen = (filtros: PropinaReporteFiltrosUi) =>
    useApiFetch<PropinaReporteResumen>(
      `${apiUrl}/propinas/reportes/resumen?${queryString(filtros)}`,
    );

  const trabajadores = (filtros: PropinaReporteFiltrosUi) =>
    useApiFetch<PropinaReporteTrabajadores>(
      `${apiUrl}/propinas/reportes/trabajadores?${queryString(filtros)}`,
    );

  return {
    resumen,
    trabajadores,
    cache,
    claveFiltros: (filtros: PropinaReporteFiltrosUi) =>
      claveCachePropinaReportes(authStore.activeTenantId, filtros),
  };
}
