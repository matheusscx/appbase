import {
  descontarReparto,
  fusionarRepartos,
  type FilaReparto,
} from './reparto-linea';

const t = (min: number) => new Date(Date.UTC(2026, 8, 27, 12, min));
const fila = (
  id: string,
  garzonId: string | null,
  cantidad: string,
  min: number,
): FilaReparto => ({
  id,
  garzonId,
  cantidad,
  creadoEl: t(min),
});

describe('descontarReparto (spec § 3.3)', () => {
  it('sale primero del responsable vigente, aunque su fila sea la más vieja', () => {
    const filas = [fila('a', 'ana', '2', 0), fila('b', 'beto', '1', 5)];
    expect(descontarReparto(filas, 'ana', '1')).toEqual([
      { id: 'a', cantidad: '1.0000' },
    ]);
  });

  it('si el responsable no alcanza, sigue por la fila más reciente', () => {
    const filas = [
      fila('a', 'ana', '2', 0),
      fila('c', 'carla', '1', 3),
      fila('b', 'beto', '1', 5),
    ];
    expect(descontarReparto(filas, 'beto', '2')).toEqual([
      { id: 'b', cantidad: '0.0000' },
      { id: 'c', cantidad: '0.0000' },
    ]);
  });

  it('el responsable sin fila en la línea no frena: descuenta de las demás', () => {
    const filas = [fila('a', 'ana', '3', 0)];
    expect(descontarReparto(filas, 'beto', '2')).toEqual([
      { id: 'a', cantidad: '1.0000' },
    ]);
  });

  it('con el mismo creado_el desempata por id ascendente', () => {
    const filas = [fila('z', 'ana', '1', 0), fila('m', 'carla', '1', 0)];
    expect(descontarReparto(filas, 'beto', '1')).toEqual([
      { id: 'm', cantidad: '0.0000' },
    ]);
  });

  it('las filas en 0 se saltean', () => {
    const filas = [fila('b', 'beto', '0', 9), fila('a', 'ana', '1', 0)];
    expect(descontarReparto(filas, 'beto', '1')).toEqual([
      { id: 'a', cantidad: '0.0000' },
    ]);
  });

  it('cantidades con decimales, sin number nativo', () => {
    const filas = [fila('a', 'ana', '0.3', 0), fila('b', 'beto', '0.2', 5)];
    expect(descontarReparto(filas, 'beto', '0.35')).toEqual([
      { id: 'b', cantidad: '0.0000' },
      { id: 'a', cantidad: '0.1500' },
    ]);
  });

  it('si el reparto no alcanza, es un error: la invariante se rompió antes', () => {
    expect(() =>
      descontarReparto([fila('a', 'ana', '1', 0)], 'ana', '2'),
    ).toThrow();
  });

  it('el responsable null matchea la fila null', () => {
    const filas = [fila('a', 'ana', '1', 5), fila('n', null, '1', 0)];
    expect(descontarReparto(filas, null, '1')).toEqual([
      { id: 'n', cantidad: '0.0000' },
    ]);
  });
});

describe('fusionarRepartos (spec § 3.3, la línea que se junta)', () => {
  it('suma a la fila del mismo garzón en el destino, y la de origen se borra', () => {
    const r = fusionarRepartos(
      [{ ...fila('o1', 'ana', '2', 0), cuentaLineaId: 'LO' }],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([['LO', 'LD']]),
    );
    expect(r).toEqual({
      actualizar: [{ id: 'd1', cantidad: '3.0000' }],
      reapuntar: [],
      borrar: ['o1'],
    });
  });

  it('sin fila del mismo garzón en el destino, la de origen se re-apunta', () => {
    const r = fusionarRepartos(
      [{ ...fila('o1', 'beto', '2', 0), cuentaLineaId: 'LO' }],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([['LO', 'LD']]),
    );
    expect(r).toEqual({
      actualizar: [],
      reapuntar: [{ id: 'o1', cuentaLineaId: 'LD' }],
      borrar: [],
    });
  });

  it('dos orígenes del mismo garzón hacia un destino que no lo tiene: uno se re-apunta, el otro suma sobre él', () => {
    const r = fusionarRepartos(
      [
        { ...fila('o1', 'beto', '2', 0), cuentaLineaId: 'LO1' },
        { ...fila('o2', 'beto', '1', 1), cuentaLineaId: 'LO2' },
      ],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([
        ['LO1', 'LD'],
        ['LO2', 'LD'],
      ]),
    );
    expect(r).toEqual({
      actualizar: [{ id: 'o1', cantidad: '3.0000' }],
      reapuntar: [{ id: 'o1', cuentaLineaId: 'LD' }],
      borrar: ['o2'],
    });
  });
});
