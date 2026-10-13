"""Gera as tabelas por zona eleitoral (aba "Tabelas" do painel).

Entrada: dados/brutos/csv/votacao_candidato_munzona_2026.zip
Saída:   docs/data/zonas/{uf}.json

Formato por UF e cargo:
  zonas: [[zona, ibge, [num, votos, num, votos, ...]], ...]   (majoritários: por candidato)
  zonas: [[zona, ibge, [idxPartido, votos, ...]], ...]        (deputados: por partido)

Presidente vem do arquivo _BR.csv (publicado pelo TSE na versão de 13/10/2026);
os demais cargos, do _BRASIL.csv.

Uso:  python scripts/02b_agregar_zonas.py
"""
import json
import time
import zipfile
from collections import defaultdict
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
ZIP = RAIZ / "dados" / "brutos" / "csv" / "votacao_candidato_munzona_2026.zip"
CM = RAIZ / "dados" / "brutos" / "api" / "mun-e006257-cm.json"
SAIDA = RAIZ / "docs" / "data" / "zonas"
COLUNAS = ["SG_UF", "CD_MUNICIPIO", "NR_ZONA", "CD_CARGO", "NR_CANDIDATO",
           "QT_VOTOS_NOMINAIS_VALIDOS", "NM_TIPO_DESTINACAO_VOTOS"]


def main():
    t0 = time.time()
    cm = json.loads(CM.read_text(encoding="utf-8"))
    tse_para_ibge = {int(m["cd"]): m["cdi"] for a in cm["abr"] for m in a["mu"]}

    partes = []
    with zipfile.ZipFile(ZIP) as z:
        arquivos = [n for n in ("votacao_candidato_munzona_2026_BRASIL.csv", "votacao_candidato_munzona_2026_BR.csv")
                    if n in z.namelist()]
        for nome in arquivos:
            with z.open(nome) as f:
                for bloco in pd.read_csv(f, sep=";", encoding="latin1", usecols=COLUNAS, chunksize=2_000_000):
                    bloco = bloco[bloco.NM_TIPO_DESTINACAO_VOTOS == "Válido"]
                    # cada cargo vem de um só arquivo: Presidente do _BR, o resto do _BRASIL
                    # (a versão de 13/10 do _BRASIL também traz Presidente — evita contar duas vezes)
                    if nome.endswith("_BR.csv"):
                        bloco = bloco[bloco.CD_CARGO == 1]
                    else:
                        bloco = bloco[bloco.CD_CARGO != 1]
                    partes.append(bloco.groupby(["SG_UF", "CD_CARGO", "NR_ZONA", "CD_MUNICIPIO", "NR_CANDIDATO"],
                                                as_index=False).QT_VOTOS_NOMINAIS_VALIDOS.sum())
    df = (pd.concat(partes).groupby(["SG_UF", "CD_CARGO", "NR_ZONA", "CD_MUNICIPIO", "NR_CANDIDATO"],
                                    as_index=False).QT_VOTOS_NOMINAIS_VALIDOS.sum()
          .rename(columns={"QT_VOTOS_NOMINAIS_VALIDOS": "VOTOS"}))
    df = df[df.VOTOS > 0]
    df["CD_CARGO"] = df.CD_CARGO.replace({8: 7})
    df["ibge"] = df.CD_MUNICIPIO.map(tse_para_ibge)
    df["PARTIDO_NR"] = df.NR_CANDIDATO.astype(str).str[:2].astype(int)
    print(f"{len(df):,} linhas agregadas em {time.time() - t0:.0f}s")

    SAIDA.mkdir(parents=True, exist_ok=True)
    total = 0
    for uf, g_uf in df.groupby("SG_UF"):
        out = {}
        for cargo, g in g_uf.groupby("CD_CARGO"):
            linhas = []
            if cargo in (1, 3, 5):
                chave = "NR_CANDIDATO"
                rot = None
            else:
                chave = "PARTIDO_NR"
                g = g.groupby(["NR_ZONA", "ibge", "PARTIDO_NR"], as_index=False).VOTOS.sum()
                rot = sorted(g.PARTIDO_NR.unique().tolist())
            idx = {v: i for i, v in enumerate(rot)} if rot else None
            for (zona, ibge), gz in g.sort_values("VOTOS", ascending=False).groupby(["NR_ZONA", "ibge"], sort=True):
                pares = []
                for k, v in zip(gz[chave], gz.VOTOS):
                    pares += [idx[k] if idx else int(k), int(v)]
                linhas.append([int(zona), ibge, pares])
            out[str(cargo)] = {"partidosNumero": rot, "zonas": linhas}
        destino = SAIDA / f"{uf.lower()}.json"
        destino.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        total += destino.stat().st_size
    print(f"zonas: {total / 1024 / 1024:.1f} MB em {len(list(SAIDA.glob('*.json')))} arquivos ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
