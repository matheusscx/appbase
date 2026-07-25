import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { MotivosDiferenciaService } from './motivos-diferencia.service';

const TENANT = 't1';

describe('MotivosDiferenciaService', () => {
  let service: MotivosDiferenciaService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const mod = await Test.createTestingModule({
      providers: [
        MotivosDiferenciaService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();
    service = mod.get(MotivosDiferenciaService);
  });

  it('findAll con soloActivas filtra activo=true', async () => {
    query.mockResolvedValueOnce([]);
    await service.findAll(TENANT, true);
    expect(query.mock.calls[0][0]).toContain('AND activo = true');
    expect(query.mock.calls[0][0]).toContain('eliminado_el IS NULL');
  });

  it('create inserta con es_fijo=false y requiere_comentario del DTO', async () => {
    query.mockResolvedValueOnce([]); // assertNombreUnico
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'x',
        activo: true,
        requiere_comentario: true,
        es_fijo: false,
      },
    ]);
    const res = await service.create(TENANT, {
      nombre: 'x',
      requiereComentario: true,
    });
    expect(res).toMatchObject({
      id: 'm1',
      requiereComentario: true,
      esFijo: false,
    });
    expect(query.mock.calls[1][0]).toContain(
      'INSERT INTO motivo_diferencia_caja',
    );
  });

  it('update de un motivo fijo BLOQUEA nombre', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    await expect(
      service.update(TENANT, 'm1', { nombre: 'nuevo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update de un motivo fijo PERMITE activo y requiere_comentario', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: false,
        requiere_comentario: false,
        es_fijo: true,
      },
    ]); // UPDATE RETURNING
    const res = await service.update(TENANT, 'm1', {
      activo: false,
      requiereComentario: false,
    });
    expect(res.activo).toBe(false);
    expect(res.requiereComentario).toBe(false);
  });

  it('remove de un motivo fijo BLOQUEA', async () => {
    query.mockResolvedValueOnce([
      {
        motivo_diferencia_id: 'm1',
        nombre: 'otro',
        activo: true,
        requiere_comentario: true,
        es_fijo: true,
      },
    ]); // findOneOrFail
    await expect(service.remove(TENANT, 'm1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
