import { compararPorDisponibilidad, esPedible } from './catalogo-orden';

describe('esPedible', () => {
  it('producto: pedible solo con stockDisponible > 0', () => {
    expect(esPedible('producto', undefined, '0.5000')).toBe(true);
    expect(esPedible('producto', undefined, '0.0000')).toBe(false);
    expect(esPedible('producto', undefined, '-2.0000')).toBe(false);
    expect(esPedible('producto', undefined, undefined)).toBe(false);
  });

  it('receta y combo: null es "sin bloqueantes", no "sin stock"', () => {
    expect(esPedible('receta', null, undefined)).toBe(true);
    expect(esPedible('combo', 0, undefined)).toBe(false);
    expect(esPedible('receta', -2, undefined)).toBe(false);
  });

  it('cualquier otro tipo no es pedible (igual que el cliente de hoy)', () => {
    expect(esPedible('servicio', undefined, undefined)).toBe(false);
  });
});

describe('compararPorDisponibilidad', () => {
  const fila = (item_id: string, nombre: string, pedible: boolean) => ({
    item_id,
    nombre,
    pedible,
  });
  const ordenar = (filas: ReturnType<typeof fila>[]) =>
    [...filas].sort(compararPorDisponibilidad).map((f) => f.item_id);

  it('pedibles primero, después por nombre en español, después por id', () => {
    expect(
      ordenar([
        fila('p-0', 'Agua', false),
        fila('r-neg', 'Ñoquis', false),
        fila('p-3', 'Ñandú', true),
        fila('r-null', 'Empanada', true),
        fila('p-b', 'empanada', true),
      ]),
    ).toEqual(['p-b', 'r-null', 'p-3', 'p-0', 'r-neg']);
  });

  it('con el mismo nombre, desempata por item_id', () => {
    expect(ordenar([fila('b', 'Pan', true), fila('a', 'Pan', true)])).toEqual([
      'a',
      'b',
    ]);
  });
});
