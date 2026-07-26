import { unwrap } from './pg-returning.util';

describe('unwrap — RETURNING de pg vía TypeORM', () => {
  it('desenvuelve la forma [rows, rowCount]', () => {
    const raw = [[{ id: 'a' }, { id: 'b' }], 2];
    expect(unwrap<{ id: string }>(raw)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('deja pasar la forma rows sin tocarla', () => {
    const raw = [{ id: 'a' }];
    expect(unwrap<{ id: string }>(raw)).toEqual([{ id: 'a' }]);
  });

  it('devuelve [] con resultado vacío', () => {
    expect(unwrap([])).toEqual([]);
  });

  it('devuelve [] cuando la forma envuelta trae filas vacías', () => {
    expect(unwrap([[], 0])).toEqual([]);
  });
});
