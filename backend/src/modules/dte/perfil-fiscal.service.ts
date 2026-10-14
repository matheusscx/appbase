import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Db } from '../../common/db/db.service';
import { unwrap } from '../../common/utils/pg-returning.util';
import { normalizarRut } from '../../common/utils/rut.util';
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import type { ActualizarPerfilDto } from './dto/actualizar-perfil.dto';
import type { SubirCafDto } from './dto/subir-caf.dto';
import type { SubirCertificadoDto } from './dto/subir-certificado.dto';
import { CifradoDteService } from './cifrado-dte.service';
import { DteError, type TipoBoleta } from './dte.types';
import { leerCaf, type CafLeido } from './caf';
import type { AmbienteSii } from './entities/dte-caf.entity';
import { leerCertificado, type CertificadoLeido } from './firma';
import {
  evaluarPerfil,
  fechaChile,
  type CodigoAviso,
  type CodigoFaltante,
  type EmisorPerfil,
  type Observacion,
} from './perfil-fiscal';
import { validarFecha, validarTexto } from './texto';

export interface CertificadoPerfil {
  id: string;
  rutFirmante: string;
  nombreFirmante: string;
  venceEl: string;
}

export interface CafListado {
  id: string;
  tipo: TipoBoleta;
  ambiente: AmbienteSii;
  desde: number;
  hasta: number;
  usados: number;
  restantes: number;
  fechaAutorizacion: string;
  idk: number;
  /** Solo un CAF sin ningún folio entregado se puede quitar. */
  borrable: boolean;
}

export interface PerfilFiscal {
  emisor: EmisorPerfil | null;
  certificado: CertificadoPerfil | null;
  cafs: CafListado[];
  faltantes: Observacion<CodigoFaltante>[];
  avisos: Observacion<CodigoAviso>[];
}

interface FilaEmisora {
  razon_social_id: string;
  nombre: string;
  rut: string;
  direccion: string | null;
  giro: string | null;
  comuna: string | null;
  ambiente_sii: AmbienteSii | null;
  fecha_resolucion: string | null;
  numero_resolucion: number | null;
}
interface FilaCertificado {
  certificado_id: string;
  rut_firmante: string;
  nombre_firmante: string;
  vence_el: Date;
}
interface FilaCaf {
  caf_id: string;
  tipo: TipoBoleta;
  ambiente: AmbienteSii;
  desde: number;
  hasta: number;
  siguiente_folio: number;
  fecha_autorizacion: string;
  idk: number;
}

/** El folio es un `integer` de Postgres: el CAF no puede pedir uno más allá. */
const FOLIO_MAXIMO = 2_147_483_646;
/** `idk` también es un `integer`. */
const IDK_MAXIMO = 2_147_483_647;

const SIN_EMISORA =
  'Primero hay que marcar una razón social como preferida en Razones sociales';

/**
 * Perfil fiscal del emisor de boletas electrónicas: los datos de su razón social que pide el SII,
 * su certificado digital y el resumen de qué le falta para emitir. La razón social emisora es la
 * preferida del tenant (habilitada y no borrada).
 */
@Injectable()
export class PerfilFiscalService {
  constructor(
    private readonly db: Db,
    private readonly cifrado: CifradoDteService,
    @InjectRepository(RazonSocial)
    private readonly razonSocialRepo: Repository<RazonSocial>,
  ) {}

  /**
   * La razón social que emite: `preferida AND habilitado` del tenant, o null si no hay.
   * `bloquear` la toma con `FOR UPDATE` (dentro de una transacción) para serializar a quien
   * escribe el certificado o los CAF de esa razón social.
   */
  async emisora(
    tenantId: string,
    bloquear = false,
  ): Promise<EmisorPerfil | null> {
    const filas = await this.db.query<FilaEmisora[]>(
      `SELECT razon_social_id, nombre, rut, direccion, giro, comuna, ambiente_sii,
              to_char(fecha_resolucion, 'YYYY-MM-DD') AS fecha_resolucion,
              numero_resolucion
         FROM razones_sociales
        WHERE tenant_id = $1 AND preferida = true AND habilitado = true
          AND eliminado_el IS NULL
        ORDER BY razon_social_id
        LIMIT 1${bloquear ? ' FOR UPDATE' : ''}`,
      [tenantId],
    );
    const f = filas[0];
    if (!f) return null;
    return {
      razonSocialId: f.razon_social_id,
      nombre: f.nombre,
      rut: f.rut,
      direccion: f.direccion,
      giro: f.giro,
      comuna: f.comuna,
      ambiente: f.ambiente_sii,
      fechaResolucion: f.fecha_resolucion,
      numeroResolucion: f.numero_resolucion,
    };
  }

  /** Tres consultas fijas (emisora, certificado vigente, CAF), sin importar cuántos CAF haya. */
  async obtener(tenantId: string, ahora: Date): Promise<PerfilFiscal> {
    const emisor = await this.emisora(tenantId);

    let certificado: {
      id: string;
      rutFirmante: string;
      nombreFirmante: string;
      venceEl: Date;
    } | null = null;
    let cafs: CafListado[] = [];
    if (emisor) {
      const filasCert = await this.db.query<FilaCertificado[]>(
        `SELECT certificado_id, rut_firmante, nombre_firmante, vence_el
           FROM dte_certificados
          WHERE razon_social_id = $1 AND tenant_id = $2
            AND reemplazado_el IS NULL AND eliminado_el IS NULL`,
        [emisor.razonSocialId, tenantId],
      );
      const c = filasCert[0];
      if (c)
        certificado = {
          id: c.certificado_id,
          rutFirmante: c.rut_firmante,
          nombreFirmante: c.nombre_firmante,
          venceEl: c.vence_el,
        };

      const filasCaf = await this.db.query<FilaCaf[]>(
        `SELECT caf_id, tipo, ambiente, desde, hasta, siguiente_folio, idk,
                to_char(fecha_autorizacion, 'YYYY-MM-DD') AS fecha_autorizacion
           FROM dte_cafs
          WHERE razon_social_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
          ORDER BY tipo, desde`,
        [emisor.razonSocialId, tenantId],
      );
      cafs = filasCaf.map(aCafListado);
    }

    const { faltantes, avisos } = evaluarPerfil(
      emisor,
      certificado,
      cafs,
      ahora,
    );
    return {
      emisor,
      certificado: certificado && {
        ...certificado,
        venceEl: certificado.venceEl.toISOString(),
      },
      cafs,
      faltantes,
      avisos,
    };
  }

  /** Escribe en la razón social emisora solo lo que vino; devuelve eso mismo (sin releer). */
  async actualizar(
    tenantId: string,
    dto: ActualizarPerfilDto,
  ): Promise<Partial<ActualizarPerfilDto>> {
    const emisora = await this.emisora(tenantId);
    if (!emisora) throw new BadRequestException(SIN_EMISORA);

    const campos: Partial<ActualizarPerfilDto> = {};
    try {
      if (dto.giro !== undefined)
        campos.giro = validarTexto('El giro', dto.giro, 80);
      if (dto.comuna !== undefined)
        campos.comuna = validarTexto('La comuna', dto.comuna, 20);
      if (dto.fechaResolucion !== undefined)
        campos.fechaResolucion = validarFecha(
          'La fecha de la resolución',
          dto.fechaResolucion,
        );
    } catch (e) {
      aBadRequest(e);
    }
    if (dto.ambienteSii !== undefined) campos.ambienteSii = dto.ambienteSii;
    if (dto.numeroResolucion !== undefined)
      campos.numeroResolucion = dto.numeroResolucion;

    if (Object.keys(campos).length > 0)
      await this.razonSocialRepo.update(
        { id: emisora.razonSocialId, tenantId },
        campos,
      );
    return campos;
  }

  /**
   * Guarda el certificado del firmante y deja sin efecto el anterior (queda con
   * `reemplazado_el` y sin la llave). Todo en una transacción que parte tomando la fila de la
   * razón social, para que dos subidas a la vez no choquen contra el índice del vigente.
   */
  subirCertificado(
    tenantId: string,
    dto: SubirCertificadoDto,
    ahora: Date,
  ): Promise<CertificadoPerfil> {
    return this.db.transaccion(async () => {
      const emisora = await this.emisora(tenantId, true);
      if (!emisora) throw new BadRequestException(SIN_EMISORA);

      let leido: CertificadoLeido;
      try {
        leido = leerCertificado(
          Buffer.from(dto.pfxBase64, 'base64'),
          dto.clave,
        );
      } catch (e) {
        // El mensaje del motor no lleva la clave; aquí tampoco se concatena.
        aBadRequest(e);
      }
      if (leido.venceEl <= ahora)
        throw new BadRequestException(
          `El certificado venció el ${fechaChile(leido.venceEl)}; sube uno vigente`,
        );

      await this.db.query(
        `UPDATE dte_certificados
            SET reemplazado_el = now(), credencial_cifrada = NULL
          WHERE razon_social_id = $1 AND reemplazado_el IS NULL
            AND eliminado_el IS NULL`,
        [emisora.razonSocialId],
      );
      const credencial = this.cifrado.cifrar(
        JSON.stringify({ ...leido, venceEl: leido.venceEl.toISOString() }),
      );
      const [nuevo] = unwrap<{ certificado_id: string }>(
        await this.db.query(
          `INSERT INTO dte_certificados
             (tenant_id, razon_social_id, credencial_cifrada, rut_firmante, nombre_firmante, vence_el)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING certificado_id`,
          [
            tenantId,
            emisora.razonSocialId,
            credencial,
            leido.rut,
            leido.nombre,
            leido.venceEl,
          ],
        ),
      );
      return {
        id: nuevo.certificado_id,
        rutFirmante: leido.rut,
        nombreFirmante: leido.nombre,
        venceEl: leido.venceEl.toISOString(),
      };
    });
  }
  /**
   * Guarda un CAF (el archivo de folios del SII) de la razón social emisora, cifrado: trae la
   * llave privada con la que se firman los timbres. Todo en una transacción que parte tomando la
   * fila de la razón social, para que un doble clic no meta el mismo rango dos veces.
   */
  subirCaf(tenantId: string, dto: SubirCafDto): Promise<CafListado> {
    return this.db.transaccion(async () => {
      const emisora = await this.emisora(tenantId, true);
      if (!emisora) throw new BadRequestException(SIN_EMISORA);
      if (!emisora.ambiente)
        throw new BadRequestException(
          'Primero hay que elegir el ambiente (certificación o producción)',
        );

      // El SII entrega el archivo en ISO-8859-1: leerlo como utf8 rompería las tildes y la Ñ.
      const xml = Buffer.from(dto.xmlBase64, 'base64').toString('latin1');
      let caf: CafLeido;
      try {
        caf = leerCaf(xml);
      } catch (e) {
        aBadRequest(e);
      }
      if (caf.tipo !== 39 && caf.tipo !== 41)
        throw new BadRequestException(
          `Este CAF es de documentos tipo ${caf.tipo}; por ahora solo se cargan boletas (39 y 41)`,
        );
      if (caf.rutEmisor !== normalizarRut(emisora.rut))
        throw new BadRequestException(
          `Este archivo de folios es del RUT ${caf.rutEmisor}, no de la empresa (${normalizarRut(emisora.rut)})`,
        );
      if (caf.desde < 1)
        throw new BadRequestException(
          'Este CAF empieza en el folio 0; los folios parten desde el 1',
        );
      if (caf.idk > IDK_MAXIMO)
        throw new BadRequestException(
          'Este archivo de folios trae un número de llave (IDK) que no se puede guardar',
        );
      if (caf.hasta > FOLIO_MAXIMO)
        throw new BadRequestException(
          `El rango de folios del CAF llega a ${caf.hasta}; el máximo que se admite es ${FOLIO_MAXIMO}`,
        );

      const solapado = await this.db.query<unknown[]>(
        `SELECT 1 FROM dte_cafs
          WHERE razon_social_id = $1 AND tipo = $2 AND eliminado_el IS NULL
            AND ambiente = $5 AND desde <= $4 AND hasta >= $3
          LIMIT 1`,
        [
          emisora.razonSocialId,
          caf.tipo,
          caf.desde,
          caf.hasta,
          emisora.ambiente,
        ],
      );
      if (solapado.length > 0)
        throw new BadRequestException('Esos folios ya están cargados');

      const [fila] = unwrap<FilaCaf>(
        await this.db.query(
          `INSERT INTO dte_cafs
             (tenant_id, razon_social_id, tipo, rut_emisor, ambiente, desde, hasta,
              siguiente_folio, idk, fecha_autorizacion, xml_cifrado)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $8, $9, $10)
           RETURNING caf_id, tipo, ambiente, desde, hasta, siguiente_folio, idk,
                     to_char(fecha_autorizacion, 'YYYY-MM-DD') AS fecha_autorizacion`,
          [
            tenantId,
            emisora.razonSocialId,
            caf.tipo,
            caf.rutEmisor,
            emisora.ambiente,
            caf.desde,
            caf.hasta,
            caf.idk,
            caf.fechaAutorizacion,
            this.cifrado.cifrar(xml),
          ],
        ),
      );
      return aCafListado(fila);
    });
  }

  /**
   * Quita un CAF que todavía no entregó ningún folio. Con folios usados no se puede: los
   * documentos emitidos con él dependen de que su rango quede registrado.
   */
  async borrarCaf(tenantId: string, id: string): Promise<void> {
    const borrados = unwrap<{ caf_id: string }>(
      await this.db.query(
        `UPDATE dte_cafs SET eliminado_el = now()
          WHERE caf_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
            AND siguiente_folio = desde
          RETURNING caf_id`,
        [id, tenantId],
      ),
    );
    if (borrados.length > 0) return;

    const existe = await this.db.query<unknown[]>(
      `SELECT 1 FROM dte_cafs
        WHERE caf_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId],
    );
    if (existe.length === 0) throw new NotFoundException('CAF no encontrado');
    throw new BadRequestException(
      'Este CAF ya entregó folios y no se puede borrar',
    );
  }
}

function aCafListado(f: FilaCaf): CafListado {
  return {
    id: f.caf_id,
    tipo: f.tipo,
    ambiente: f.ambiente,
    desde: f.desde,
    hasta: f.hasta,
    usados: f.siguiente_folio - f.desde,
    restantes: f.hasta - f.siguiente_folio + 1,
    fechaAutorizacion: f.fecha_autorizacion,
    idk: f.idk,
    borrable: f.siguiente_folio === f.desde,
  };
}

/** Un `DteError` es un dato mal puesto por el usuario: 400 con su mensaje. Lo demás sigue de largo. */
function aBadRequest(e: unknown): never {
  if (e instanceof DteError) throw new BadRequestException(e.message);
  throw e instanceof Error ? e : new Error(String(e));
}
