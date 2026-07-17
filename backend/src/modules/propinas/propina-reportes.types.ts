import type { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';

export interface ReportePeriodo {
  desde: string;
  hasta: string;
}

export interface PropinaReporteResumen {
  periodo: ReportePeriodo;
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
    tipoGarzon: TipoGarzon | null;
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
  tipoGarzon: TipoGarzon;
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
