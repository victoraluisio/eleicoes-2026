"""Agrega o CSV de votação por município/zona do TSE em votos por município x candidato.

Entrada: dados/brutos/csv/votacao_candidato_munzona_2026.zip  (316 MB, ~6,3 GB descompactado)
Saída:   dados/processados/votos_municipio.csv.gz

Lê só o arquivo _BRASIL.csv (o único que traz Presidente) em blocos, somando as
zonas de cada município. Votos "Anulado sub judice" ficam de fora, como no
resultado oficial de votos válidos.

Uso:  python scripts/02_agregar_csv.py
"""
import time
import zipfile
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
ZIP = RAIZ / "dados" / "brutos" / "csv" / "votacao_candidato_munzona_2026.zip"
SAIDA = RAIZ / "dados" / "processados" / "votos_municipio.csv.gz"

COLUNAS = ["SG_UF", "CD_MUNICIPIO", "NM_MUNICIPIO", "CD_CARGO", "SQ_CANDIDATO",
           "NR_CANDIDATO", "SG_PARTIDO", "QT_VOTOS_NOMINAIS_VALIDOS",
           "NM_TIPO_DESTINACAO_VOTOS"]
CHAVE = ["SG_UF", "CD_MUNICIPIO", "CD_CARGO", "SQ_CANDIDATO"]


def main():
    t0 = time.time()
    partes, linhas = [], 0
    with zipfile.ZipFile(ZIP) as z:
        with z.open("votacao_candidato_munzona_2026_BRASIL.csv") as f:
            leitor = pd.read_csv(f, sep=";", encoding="latin1", usecols=COLUNAS,
                                 chunksize=2_000_000, dtype={"SQ_CANDIDATO": "int64"})
            for bloco in leitor:
                linhas += len(bloco)
                bloco = bloco[bloco.NM_TIPO_DESTINACAO_VOTOS == "Válido"]
                partes.append(bloco.groupby(CHAVE + ["NM_MUNICIPIO", "NR_CANDIDATO", "SG_PARTIDO"],
                                            as_index=False).QT_VOTOS_NOMINAIS_VALIDOS.sum())
                print(f"  {linhas:>11,} linhas lidas  ({time.time() - t0:.0f}s)")

    df = (pd.concat(partes)
            .groupby(CHAVE + ["NM_MUNICIPIO", "NR_CANDIDATO", "SG_PARTIDO"], as_index=False)
            .QT_VOTOS_NOMINAIS_VALIDOS.sum()
            .rename(columns={"QT_VOTOS_NOMINAIS_VALIDOS": "VOTOS"}))
    df = df[df.VOTOS > 0]

    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(SAIDA, index=False, compression="gzip")
    print(f"\n{len(df):,} linhas -> {SAIDA.name} em {time.time() - t0:.0f}s")
    print(df.groupby("CD_CARGO").VOTOS.sum())


if __name__ == "__main__":
    main()
