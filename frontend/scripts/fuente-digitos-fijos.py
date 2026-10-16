#!/usr/bin/env python3
"""Genera frontend/public/fonts/dm-sans.woff2: DM Sans variable con los diez dígitos (0-9)
del MISMO ancho, para que los montos en columna queden alineados.

Por qué existe: la DM Sans de origen no trae la función `tnum` y sus dígitos son
proporcionales (el «1» mide casi la mitad que el «0»), así que `tabular-nums` no hacía
nada. Decisión del owner (2026-10-16): «DM Sans con dígitos fijos».

Qué hace (la fuente sigue siendo VARIABLE, ejes opsz y wght intactos):
  1. El avance de cada dígito pasa a ser el del «0» en CADA punto del espacio de diseño:
     `hmtx` (instancia por defecto) y el mapa de avances de `HVAR` apuntan al mismo delta
     que el «0», y los puntos fantasma de avance de `gvar` de cada dígito llevan el delta del
     «0» en cada región. Cada motor lee el avance de un lugar distinto: con solo hmtx y HVAR
     igualados, macOS medía bien y el Chromium de Linux no (diez «1» medían 30 px menos que
     diez «0» a 32 px).
     Los diez avances son idénticos en todo wght y todo opsz, no solo en 400.
     Se toma el «0» porque es el dígito más ancho: ninguno queda apretado ni se superpone
     con su vecino, y el «0» (el que más se ve en los montos) no se toca.
  2. Cada dígito se centra en su nuevo avance conservando la asimetría de sus márgenes
     originales: el contorno se desplaza (avance_0 - avance_d) / 2, y como ese avance varía
     con wght/opsz, el desplazamiento también: se suma al `gvar` una variación por cada
     región de `HVAR`, con el mismo reparto.
  3. Se recorta al subconjunto latino de la app y se emite woff2, con las mismas opciones
     de siempre (`--layout-features='*'`).

El nombre de la familia sigue siendo «DM Sans» (la OFL no declara Reserved Font Name). Es
una versión modificada: ver public/fonts/OFL-dm-sans.txt (aviso al final).

Uso (Python con fontTools y brotli):
  python3 scripts/fuente-digitos-fijos.py \\
      "/ruta/a/DMSans[opsz,wght].ttf" frontend/public/fonts/dm-sans.woff2
El TTF de origen es el de googlefonts/dm-fonts (marca/fuentes/dmsans/ en el repo de marca).
"""
import argparse
import math
import sys
import tempfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation

DIGITOS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
REFERENCIA = 'zero'

# Mismo subconjunto que el original (latino).
UNICODES = (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,'
    'U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
)

# Símbolos que acompañan a las cifras en montos, fechas y porcentajes. Una cifra no se
# kernea con ninguno de ellos ni con otra cifra: el kern original movía el resto del número
# hasta 87 unidades según qué dígito tocara («7/», «7.», «.0»), y ese corrimiento descuadra
# la columna aunque los avances sean iguales.
SIMBOLOS = '.,:%$\u20ac+-\u2212/()'

AVISO_VERSION = '; Venka: digitos de ancho fijo'


def deltas_de_avance(fuente, glifo):
    """{índice de región: delta de avance} del glifo, leído de HVAR."""
    hvar = fuente['HVAR'].table
    idx = hvar.AdvWidthMap.mapping[glifo]
    datos = hvar.VarStore.VarData[idx >> 16]
    return dict(zip(datos.VarRegionIndex, datos.Item[idx & 0xFFFF]))


def region_a_ejes(fuente, region):
    """Región de HVAR -> {eje: (inicio, pico, fin)} como lo pide una variación de gvar."""
    ejes = {}
    for eje, r in zip(fuente['fvar'].axes, region.VarRegionAxis):
        if r.PeakCoord != 0:
            ejes[eje.axisTag] = (r.StartCoord, r.PeakCoord, r.EndCoord)
    return ejes


def mitad(n):
    """n / 2 entero (las coordenadas de glyf y los deltas de gvar son enteros)."""
    return math.floor(n / 2 + 0.5)


def igualar_digitos(fuente):
    cmap = fuente.getBestCmap()
    esperados = [cmap[ord(c)] for c in '0123456789']
    assert esperados == DIGITOS, esperados
    glyf, hmtx, gvar = fuente['glyf'], fuente['hmtx'], fuente['gvar']
    hvar = fuente['HVAR'].table
    regiones = hvar.VarStore.VarRegionList.Region

    avance_ref = hmtx[REFERENCIA][0]
    deltas_ref = deltas_de_avance(fuente, REFERENCIA)
    indice_ref = hvar.AdvWidthMap.mapping[REFERENCIA]

    for nombre in DIGITOS:
        if nombre == REFERENCIA:
            continue
        glifo = glyf[nombre]
        assert not glifo.isComposite(), nombre
        avance, _ = hmtx[nombre]
        deltas = deltas_de_avance(fuente, nombre)
        n_puntos = len(glifo.coordinates)

        # Centrado en el avance por defecto.
        glifo.coordinates.translate((mitad(avance_ref - avance), 0))
        glifo.recalcBounds(glyf)

        # El avance de un glifo vive en DOS sitios que deben decir lo mismo: `HVAR` (lo que
        # usan HarfBuzz/CoreText) y los puntos fantasma del propio glifo en `gvar` (lo que usa
        # FreeType, o sea el Chromium de Linux, al cargar el glifo). El fantasma derecho
        # (índice n_puntos + 1) lleva el delta de avance de cada región. Se vacían los
        # originales (eran los del dígito) y se pone en cada región el delta del «0»; el
        # fantasma izquierdo queda en 0 (el origen no se mueve).
        for variacion in gvar.variations[nombre]:
            variacion.coordinates[n_puntos] = (0, 0)
            variacion.coordinates[n_puntos + 1] = (0, 0)

        # Resto del espacio de diseño: una variación por región de HVAR, con (a) el avance
        # del «0» en esa región y (b) el desplazamiento que mantiene el dígito centrado.
        for region in sorted(set(deltas) | set(deltas_ref)):
            avance_region = deltas_ref.get(region, 0)
            dx = mitad(avance_region - deltas.get(region, 0))
            if dx == 0 and avance_region == 0:
                continue
            ejes = region_a_ejes(fuente, regiones[region])
            fantasmas = [(0, 0), (avance_region, 0), (0, 0), (0, 0)]
            previa = next((v for v in gvar.variations[nombre]
                           if v.axes == ejes and None not in v.coordinates), None)
            if previa:
                previa.coordinates = [(x + dx, y) for x, y in previa.coordinates[:n_puntos]] \
                    + fantasmas
            else:
                gvar.variations[nombre].append(
                    TupleVariation(ejes, [(dx, 0)] * n_puntos + fantasmas))

        # Mismo avance (por defecto y variable) que el «0».
        hmtx[nombre] = (avance_ref, glifo.xMin)
        hvar.AdvWidthMap.mapping[nombre] = indice_ref


def quitar_kern_de_cifras(fuente):
    """Borra del kern (GPOS, tipo 2) los pares cifra-cifra y cifra-símbolo numérico."""
    cmap = fuente.getBestCmap()
    cifras = set(DIGITOS)
    numericos = cifras | {cmap[ord(c)] for c in SIMBOLOS}
    quitados = 0
    for lookup in fuente['GPOS'].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            if sub.LookupType == 9:
                sub = sub.ExtSubTable
            if sub.LookupType != 2:
                continue
            if sub.Format == 2:
                # Por clases: no se puede borrar un par sin partir la clase. Hoy ningún par
                # cifra-cifra ni cifra-símbolo vale algo aquí; se comprueba y, si algún día
                # apareciera uno, se frena en vez de dejar un kern vivo.
                c1, c2 = sub.ClassDef1.classDefs, sub.ClassDef2.classDefs
                for a in sub.Coverage.glyphs:
                    for b in numericos | cifras:
                        if not ((a in cifras and b in numericos) or (a in numericos and b in cifras)):
                            continue
                        valor = sub.Class1Record[c1.get(a, 0)].Class2Record[c2.get(b, 0)].Value1
                        if valor is not None and any(getattr(valor, k, 0) for k in vars(valor)):
                            sys.exit(f'kern por clases vivo en {a}/{b}: hay que tratarlo a mano')
                continue
            for primero, par in zip(sub.Coverage.glyphs, sub.PairSet):
                if primero not in numericos:
                    continue
                antes = len(par.PairValueRecord)
                par.PairValueRecord = [
                    r for r in par.PairValueRecord
                    if not ((primero in cifras and r.SecondGlyph in numericos)
                            or (primero not in cifras and r.SecondGlyph in cifras))]
                par.PairValueCount = len(par.PairValueRecord)
                quitados += antes - par.PairValueCount
    return quitados


def anotar_nombre(fuente):
    for rec in fuente['name'].names:
        if rec.nameID == 5 and AVISO_VERSION not in rec.toUnicode():
            rec.string = rec.toUnicode() + AVISO_VERSION


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('origen', type=Path, help='DMSans[opsz,wght].ttf de origen')
    ap.add_argument('destino', type=Path, help='dm-sans.woff2 de salida')
    ap.add_argument('--ttf-completo', type=Path, help='además deja aquí el TTF modificado, sin recortar (para inspeccionarlo)')
    args = ap.parse_args()

    # recalcTimestamp=False: sin él fontTools estampa la hora de la corrida en `head.modified`
    # y el woff2 cambia de bytes cada vez que se regenera.
    fuente = TTFont(args.origen, recalcTimestamp=False)
    if 'tnum' in {r.FeatureTag for r in fuente['GSUB'].table.FeatureList.FeatureRecord}:
        sys.exit('El origen ya trae tnum: esta fuente ya no hace falta.')
    igualar_digitos(fuente)
    print(f'pares de kern quitados: {quitar_kern_de_cifras(fuente)}')
    anotar_nombre(fuente)

    with tempfile.TemporaryDirectory() as tmp:
        ttf = Path(tmp) / 'completo.ttf'
        fuente.save(ttf)
        if args.ttf_completo:
            fuente.save(args.ttf_completo)
        subset.main([
            str(ttf), '--flavor=woff2', '--layout-features=*', f'--unicodes={UNICODES}',
            f'--output-file={args.destino}',
        ])
    print(f'{args.destino}: {args.destino.stat().st_size} bytes')


if __name__ == '__main__':
    main()
