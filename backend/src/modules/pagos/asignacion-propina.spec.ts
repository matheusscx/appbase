import { BadRequestException } from '@nestjs/common';
import { EstrategiaAsignacionPropina } from '../propinas/enums/estrategia-asignacion-propina.enum';
import {
  calcularAplicacionesNoVuelto,
  dispatchAsignacionPropina,
  type PagoNetoInput,
} from './asignacion-propina';

const EFECTIVO = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA = '550e8400-e29b-41d4-a716-446655440200';

describe('calcularAplicacionesNoVuelto', () => {
  it('asigna tip entero a un solo pago con tarjeta', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '55000',
      },
    ];
    const apps = calcularAplicacionesNoVuelto(pagos, '5000');
    expect(apps).toEqual([
      { pagoIdx: 0, tipo: 'venta', monto: '50000.0000' },
      { pagoIdx: 0, tipo: 'propina', monto: '5000.0000' },
    ]);
  });

  it('da el mismo resultado con efectivo+tarjeta en distinto orden de ingreso', () => {
    const ordenA: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: EFECTIVO,
        permiteVuelto: true,
        neto: '30000',
      },
      {
        pagoIdx: 1,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '25000',
      },
    ];
    const ordenB: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '25000',
      },
      {
        pagoIdx: 1,
        metodoPagoId: EFECTIVO,
        permiteVuelto: true,
        neto: '30000',
      },
    ];

    const appsA = calcularAplicacionesNoVuelto(ordenA, '5000');
    const appsB = calcularAplicacionesNoVuelto(ordenB, '5000');

    const byMetodo = (apps: typeof appsA, pagos: PagoNetoInput[]) => {
      const map = new Map<string, { venta: string; propina: string }>();
      for (const a of apps) {
        const mid = pagos[a.pagoIdx].metodoPagoId;
        const cur = map.get(mid) ?? { venta: '0', propina: '0' };
        if (a.tipo === 'venta') cur.venta = a.monto;
        else cur.propina = a.monto;
        map.set(mid, cur);
      }
      return map;
    };

    expect(byMetodo(appsA, ordenA).get(TARJETA)).toEqual({
      venta: '20000.0000',
      propina: '5000.0000',
    });
    expect(byMetodo(appsA, ordenA).get(EFECTIVO)).toEqual({
      venta: '30000.0000',
      propina: '0',
    });
    expect(byMetodo(appsB, ordenB).get(TARJETA)).toEqual({
      venta: '20000.0000',
      propina: '5000.0000',
    });
    expect(byMetodo(appsB, ordenB).get(EFECTIVO)).toEqual({
      venta: '30000.0000',
      propina: '0',
    });
  });

  /**
   * El **spillover**: la propina no cabe entera en el primer pago y se derrama
   * al siguiente. Era la rama sin cobertura de este archivo, y es la que decide
   * plata: sin ella, el algoritmo podría asignar de más al primer medio —o
   * perder el resto— y los tests de arriba, todos con la propina cabiendo
   * cómoda, seguirían verdes.
   *
   * Tarjeta (sin vuelto) va primero por regla, absorbe sus 3.000 completos, y
   * los 2.000 que sobran caen sobre el efectivo. Del efectivo, entonces, solo
   * 8.000 son venta.
   */
  it('la propina que no cabe en el primer medio se derrama al siguiente', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: EFECTIVO,
        permiteVuelto: true,
        neto: '10000',
      },
      {
        pagoIdx: 1,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '3000',
      },
    ];

    const apps = calcularAplicacionesNoVuelto(pagos, '5000');

    expect(apps).toEqual([
      { pagoIdx: 0, tipo: 'venta', monto: '8000.0000' },
      { pagoIdx: 0, tipo: 'propina', monto: '2000.0000' },
      // La tarjeta queda íntegra como propina: no le sobra nada para venta, y
      // por eso NO emite aplicación de tipo 'venta'.
      { pagoIdx: 1, tipo: 'propina', monto: '3000.0000' },
    ]);
    // Conservación: lo repartido es exactamente lo pagado, ni un peso de más.
    const total = apps.reduce((acc, a) => acc + Number(a.monto), 0);
    expect(total).toBe(13000);
  });

  // El borde del spillover: la propina supera la suma de TODOS los netos. No
  // puede inventar plata que nadie pagó — el remanente simplemente no se asigna.
  it('una propina mayor que todo lo pagado no crea aplicaciones de más', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '1000',
      },
    ];

    const apps = calcularAplicacionesNoVuelto(pagos, '99999');

    expect(apps).toEqual([{ pagoIdx: 0, tipo: 'propina', monto: '1000.0000' }]);
  });

  it('asigna tip a efectivo cuando es el único medio', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: EFECTIVO,
        permiteVuelto: true,
        neto: '55000',
      },
    ];
    const apps = calcularAplicacionesNoVuelto(pagos, '5000');
    expect(apps).toEqual([
      { pagoIdx: 0, tipo: 'venta', monto: '50000.0000' },
      { pagoIdx: 0, tipo: 'propina', monto: '5000.0000' },
    ]);
  });

  it('con propina 0 solo genera aplicaciones venta', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '50000',
      },
    ];
    const apps = calcularAplicacionesNoVuelto(pagos, '0');
    expect(apps).toEqual([{ pagoIdx: 0, tipo: 'venta', monto: '50000.0000' }]);
  });
});

describe('dispatchAsignacionPropina', () => {
  it('NO_VUELTO delega al algoritmo', () => {
    const pagos: PagoNetoInput[] = [
      {
        pagoIdx: 0,
        metodoPagoId: TARJETA,
        permiteVuelto: false,
        neto: '100',
      },
    ];
    expect(
      dispatchAsignacionPropina(
        EstrategiaAsignacionPropina.NO_VUELTO,
        pagos,
        '0',
      ),
    ).toEqual([{ pagoIdx: 0, tipo: 'venta', monto: '100.0000' }]);
  });

  it('estrategia no implementada lanza BadRequestException', () => {
    expect(() =>
      dispatchAsignacionPropina(
        EstrategiaAsignacionPropina.PROPORCIONAL,
        [],
        '0',
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      dispatchAsignacionPropina(
        EstrategiaAsignacionPropina.PROPORCIONAL,
        [],
        '0',
      ),
    ).toThrow('Estrategia de asignación no soportada');
  });
});
