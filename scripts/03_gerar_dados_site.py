"""Monta os JSONs enxutos que o site consome, a partir dos dados brutos.

Entradas: dados/brutos/api/*.json  (resultado oficial por Brasil/UF)
          dados/processados/votos_municipio.csv.gz  (saída do 02)
Saídas (docs/data/):
  resumo.json          totais, candidatos majoritários, bancadas e eleitos — carregado na abertura
  municipios.json      código IBGE -> [nome, UF]
  mun/c{cargo}.json    votos por município (mapa), um arquivo por cargo
  uf/{uf}.json         lista completa de candidatos a deputado da UF (carregado sob demanda)
  docs/fotos/          fotos dos candidatos majoritários e deputados eleitos

O cruzamento API x CSV é feito por (UF, cargo, número do candidato): o
SQ_CANDIDATO do CSV não é o mesmo sqcand da API.

Uso:  python scripts/03_gerar_dados_site.py
"""
import json
import re
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
API = RAIZ / "dados" / "brutos" / "api"
FOTOS_BRUTAS = RAIZ / "dados" / "brutos" / "fotos"
VOTOS_MUN = RAIZ / "dados" / "processados" / "votos_municipio.csv.gz"
SITE = RAIZ / "docs"
OUT = SITE / "data"

UFS = ("ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr "
       "rj rn ro rr rs sc se sp to").split()
ELEICAO = {1: 6257, 3: 6259, 5: 6259, 6: 6259, 7: 6259, 8: 6259}
NOME_CARGO = {1: "Presidente", 3: "Governador", 5: "Senador", 6: "Deputado Federal",
              7: "Deputado Estadual", 8: "Deputado Distrital"}
TOP_MUN_PROP = 5   # candidatos a deputado mais votados guardados por município

# ---------------------------------------------------------------- utilidades
MINUSCULAS = {"de", "da", "do", "das", "dos", "e", "di", "du", "del"}
MANTER = {"ACM", "JHC", "II", "III", "IV", "PT", "PL", "PSD", "MDB", "PP", "PSB",
          "PSOL", "PDT", "PSDB", "PV", "SP", "RJ", "DF", "MG", "BA", "CE"}


def titulo(nome: str) -> str:
    """'FLAVIO NANTES BOLSONARO' -> 'Flavio Nantes Bolsonaro'; preserva siglas."""
    partes = []
    for i, p in enumerate(nome.split()):
        limpo = re.sub(r"[^\wÀ-ÿ]", "", p)
        abreviacao = p.endswith(".")   # "DR.", "SR." -> "Dr.", "Sr."
        if limpo.upper() in MANTER or (not abreviacao and limpo.isalpha()
                                       and not re.search(r"[AEIOUÁÉÍÓÚÂÊÔÃÕÀÜ]", limpo) and len(limpo) > 1):
            partes.append(p.upper())
        elif i > 0 and p.lower() in MINUSCULAS:
            partes.append(p.lower())
        else:
            # maiúscula no início e depois de hífen ou ponto: "DR.LUISINHO" -> "Dr.Luisinho"
            partes.append(re.sub(r"(^|[-.])(\w)", lambda m: m.group(1) + m.group(2).upper(), p.lower()))
    return " ".join(partes)


def num(s) -> int:
    return int(s) if s not in (None, "") else 0


def pct(s) -> float:
    return round(float(str(s).replace(",", ".")), 2) if s not in (None, "") else 0.0


def ler(nome: str) -> dict | None:
    f = API / nome
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def arquivo(ab: str, cargo: int) -> str:
    return f"{ab}-c{cargo:04d}-e{ELEICAO[cargo]:06d}-u.json"


def salvar(caminho: Path, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return caminho.stat().st_size


SITUACAO = {"Eleito": "eleito", "Eleito por QP": "eleito", "Eleito por média": "eleito",
            "2º turno": "2t", "Suplente": "suplente", "Não eleito": "nao"}


# ---------------------------------------------------------------- leitura da API
def totais(d: dict) -> dict:
    e, v, s = d["e"], d["v"], d["s"]
    return {
        "eleitorado": num(e["te"]), "comparecimento": num(e["c"]), "abstencao": num(e["a"]),
        "pComparecimento": pct(e["pc"]), "pAbstencao": pct(e["pa"]),
        "validos": num(v["vv"]), "nominais": num(v.get("vnom")), "legenda": num(v.get("vl")),
        "brancos": num(v["vb"]), "nulos": num(v["tvn"]), "anulados": num(v.get("vansj")),
        "pBrancos": pct(v["pvb"]), "pNulos": pct(v["ptvn"]),
        "secoes": num(s["ts"]), "pApuradas": pct(s["pst"]),
        "atualizado": f'{d["dg"]} {d["hg"]}',
    }


def percorrer(d: dict):
    """Gera (agremiação, partido, candidato) de um arquivo de resultado."""
    for cg in d["carg"]:
        for agr in cg["agr"]:
            for par in agr["par"]:
                for c in par["cand"]:
                    yield agr, par, c


def candidato(agr, par, c, cargo: int, fotos: set) -> dict:
    out = {
        "n": num(c["n"]), "nome": titulo(c["nmu"]), "nomeCompleto": titulo(c["nm"]),
        "partido": par["sg"], "votos": num(c["vap"]), "pct": pct(c["pvap"]),
        "situacao": SITUACAO.get(c["st"], "nao"),
        "valido": c.get("dvt", "Válido").startswith("Válido"),
    }
    if c["sqcand"] in fotos:
        out["foto"] = c["sqcand"]
    if cargo in (1, 3, 5):
        out["coligacao"] = titulo(agr["nm"]) if agr.get("tp") == "c" else None
        out["composicao"] = agr.get("com")
        vices = [f'{titulo(v["nmu"])} ({v["sgp"]})' for v in c.get("vs", [])]
        if vices:
            out["vices"] = vices
    return out


def main():
    fotos = {f.stem for f in FOTOS_BRUTAS.glob("*.jpeg")}
    partidos, federacoes = {}, {}
    resumo = {"cargos": {}, "nacional": {}}
    uf_detalhe = defaultdict(dict)
    eleitos_por_cargo = defaultdict(Counter)
    votos_partido_nac = defaultdict(Counter)

    for cargo in (1, 3, 5, 6, 7, 8):
        bloco = {"nome": NOME_CARGO[cargo], "abr": {}}
        abrangencias = (["br", "zz"] if cargo == 1 else []) + UFS
        for ab in abrangencias:
            d = ler(arquivo(ab, cargo))
            if d is None:
                continue
            cg = d["carg"][0]
            for f in cg.get("fed", []):
                federacoes[f["sg"]] = {"nome": titulo(f["nm"]), "numero": num(f["n"])}
            item = {"totais": totais(d), "vagas": num(cg.get("nv"))}
            cands = []
            for agr, par, c in percorrer(d):
                partidos.setdefault(par["sg"], {"numero": num(par["n"]), "nome": titulo(par["nm"])})
                cands.append(candidato(agr, par, c, cargo, fotos))
            cands.sort(key=lambda c: -c["votos"])

            if cargo in (1, 3, 5):
                item["candidatos"] = cands
            else:
                item["qe"] = num(cg.get("qe"))
                # bancada por partido (nominal + legenda) e cadeiras pelos eleitos
                bancada = {}
                for agr, par, c in percorrer(d):
                    sg = par["sg"]
                    if sg not in bancada:
                        bancada[sg] = {"partido": sg, "nominais": num(par.get("tvtn")),
                                       "legenda": num(par.get("tvtl")), "cadeiras": 0,
                                       "federacao": par.get("nfed") or None}
                    if c.get("e") == "s":
                        bancada[sg]["cadeiras"] += 1
                for b in bancada.values():
                    b["votos"] = b["nominais"] + b["legenda"]
                item["partidos"] = sorted(bancada.values(), key=lambda b: (-b["cadeiras"], -b["votos"]))
                item["eleitos"] = [c for c in cands if c["situacao"] == "eleito"]
                uf_detalhe[ab][str(cargo)] = cands
                for b in bancada.values():
                    votos_partido_nac[7 if cargo == 8 else cargo][b["partido"]] += b["votos"]

            if ab not in ("br", "zz"):
                chave = 7 if cargo == 8 else cargo
                for c in cands:
                    if c["situacao"] == "eleito":
                        eleitos_por_cargo[chave][c["partido"]] += 1
            bloco["abr"][ab] = item
        resumo["cargos"][str(cargo)] = bloco

    # ------------------------------------------------ totais nacionais dos cargos estaduais
    # (a API só publica "br" para Presidente; aqui é a soma das 27 UFs)
    somaveis = ["eleitorado", "comparecimento", "abstencao", "validos", "nominais", "legenda",
                "brancos", "nulos", "anulados", "secoes"]
    for cargo in ("3", "5", "6", "7"):
        ufs_cargo = [resumo["cargos"][cargo]["abr"].get(uf) or resumo["cargos"]["8"]["abr"]["df"]
                     for uf in UFS]
        t = {k: sum(u["totais"][k] for u in ufs_cargo) for k in somaveis}
        t["pComparecimento"] = round(t["comparecimento"] / t["eleitorado"] * 100, 2)
        t["pAbstencao"] = round(t["abstencao"] / t["eleitorado"] * 100, 2)
        total_votos = t["validos"] + t["brancos"] + t["nulos"]   # Senado: 2 votos por eleitor
        t["pBrancos"] = round(t["brancos"] / total_votos * 100, 2)
        t["pNulos"] = round(t["nulos"] / total_votos * 100, 2)
        t["pApuradas"] = min(u["totais"]["pApuradas"] for u in ufs_cargo)
        t["atualizado"] = max(u["totais"]["atualizado"] for u in ufs_cargo)
        resumo["cargos"][cargo]["abr"]["br"] = {
            "totais": t, "vagas": sum(u["vagas"] for u in ufs_cargo), "agregado": True}

    # ------------------------------------------------ visão nacional agregada
    segundo_turno_gov = []
    for uf in UFS:
        cands = resumo["cargos"]["3"]["abr"][uf]["candidatos"]
        if any(c["situacao"] == "2t" for c in cands):
            segundo_turno_gov.append(uf)
    resumo["nacional"] = {
        "governadoresEleitos": dict(eleitos_por_cargo[3].most_common()),
        "governadoresSegundoTurno": segundo_turno_gov,
        "senado": dict(eleitos_por_cargo[5].most_common()),
        "camara": dict(eleitos_por_cargo[6].most_common()),
        "assembleias": dict(eleitos_por_cargo[7].most_common()),
        "votosCamara": dict(votos_partido_nac[6].most_common()),
        "votosAssembleias": dict(votos_partido_nac[7].most_common()),
    }
    resumo["partidos"] = partidos
    resumo["federacoes"] = federacoes
    cfg = ler("ele-c.json")
    resumo["meta"] = {
        "fonte": "TSE — resultados.tse.jus.br e dadosabertos.tse.jus.br",
        "turno": 1, "dataEleicao": "04/10/2026",
        "atualizado": resumo["cargos"]["1"]["abr"]["br"]["totais"]["atualizado"],
        "configTSE": f'{cfg["dg"]} {cfg["hg"]}' if cfg else None,
    }

    # ------------------------------------------------ municípios
    cm = ler("mun-e006257-cm.json")
    tse_para_ibge, municipios = {}, {}
    for abr in cm["abr"]:
        for m in abr["mu"]:
            if abr["cd"] == "zz":
                continue
            tse_para_ibge[int(m["cd"])] = m["cdi"]
            municipios[m["cdi"]] = [titulo(m["nm"]), abr["cd"].upper(), 1 if m.get("c") == "s" else 0]

    df = pd.read_csv(VOTOS_MUN)
    df["CD_CARGO"] = df.CD_CARGO.replace({8: 7})   # DF: distrital ocupa o lugar do estadual no mapa
    df["ibge"] = df.CD_MUNICIPIO.map(tse_para_ibge)
    sem_ibge = df[df.ibge.isna()]
    if len(sem_ibge):
        print(f"aviso: {sem_ibge.CD_MUNICIPIO.nunique()} municípios sem código IBGE "
              f"(exterior/ZZ?) — {sem_ibge.VOTOS.sum():,} votos fora do mapa")
    df = df.dropna(subset=["ibge"])
    # sigla do partido pela numeração (o CSV grafa algumas siglas diferente da API)
    num_para_sg = {p["numero"]: sg for sg, p in partidos.items()}
    df["partido"] = df.NR_CANDIDATO.astype(str).str[:2].astype(int).map(num_para_sg)

    # Presidente por município vem da API (o CSV de 2026 não traz o cargo 1);
    # aproveita para guardar a participação de cada município
    cod_tse = {(abr["cd"], m["cd"]): m["cdi"] for abr in cm["abr"] for m in abr["mu"]}
    linhas_pres, participacao = [], {}
    for f in (API / "mun").glob("*-c0001-*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        ibge = cod_tse.get((f.name[:2], f.name[2:7]))
        if ibge is None:
            continue
        t = totais(d)
        participacao[ibge] = [t["eleitorado"], t["comparecimento"], t["abstencao"],
                              t["brancos"], t["nulos"], t["validos"]]
        for agr, par, c in percorrer(d):
            if c.get("dvt", "Válido").startswith("Válido") and num(c["vap"]) > 0:
                linhas_pres.append({"ibge": ibge, "CD_CARGO": 1, "NR_CANDIDATO": num(c["n"]),
                                    "VOTOS": num(c["vap"]), "partido": par["sg"]})
    df = pd.concat([df, pd.DataFrame(linhas_pres)], ignore_index=True)

    tamanhos = {}
    tamanhos["mun/participacao.json"] = salvar(OUT / "mun" / "participacao.json", participacao)
    for cargo in (1, 3, 5, 6, 7):
        sub = df[df.CD_CARGO == cargo]
        m = {}
        if cargo in (1, 3, 5):
            # [numero, votos, numero, votos, ...] em ordem decrescente
            for ibge, g in sub.sort_values("VOTOS", ascending=False).groupby("ibge", sort=False):
                m[ibge] = [int(x) for par in zip(g.NR_CANDIDATO, g.VOTOS) for x in par]
            dados = {"cargo": cargo, "m": m}
        else:
            # votos nominais por partido + os mais votados do município
            lista_p = sorted(sub.partido.dropna().unique())
            idx = {sg: i for i, sg in enumerate(lista_p)}
            por_p = sub.groupby(["ibge", "partido"], as_index=False).VOTOS.sum()
            for ibge, g in por_p.sort_values("VOTOS", ascending=False).groupby("ibge", sort=False):
                m[ibge] = [int(x) for par in zip(g.partido.map(idx), g.VOTOS) for x in par]
            top = {}
            for ibge, g in sub.sort_values("VOTOS", ascending=False).groupby("ibge", sort=False):
                g = g.head(TOP_MUN_PROP)
                top[ibge] = [int(x) for par in zip(g.NR_CANDIDATO, g.VOTOS) for x in par]
            dados = {"cargo": cargo, "partidos": lista_p, "m": m, "top": top}
        tamanhos[f"mun/c{cargo}.json"] = salvar(OUT / "mun" / f"c{cargo}.json", dados)

    # ------------------------------------------------ conferência API x CSV
    for cargo in (1, 3, 5):
        api = sum(c["votos"] for ab, it in resumo["cargos"][str(cargo)]["abr"].items()
                  if ab not in ("br", "zz") for c in it["candidatos"] if c["valido"])
        csv = int(df[df.CD_CARGO == cargo].VOTOS.sum())
        print(f"conferência {NOME_CARGO[cargo]:<12} API(UFs)={api:>12,}  CSV={csv:>12,}  dif={api - csv:+,}")

    # ------------------------------------------------ gravação
    tamanhos["resumo.json"] = salvar(OUT / "resumo.json", resumo)
    tamanhos["municipios.json"] = salvar(OUT / "municipios.json", municipios)
    for uf, det in uf_detalhe.items():
        tamanhos[f"uf/{uf}.json"] = salvar(OUT / "uf" / f"{uf}.json", det)

    destino_fotos = SITE / "fotos"
    destino_fotos.mkdir(parents=True, exist_ok=True)
    for f in FOTOS_BRUTAS.glob("*.jpeg"):
        alvo = destino_fotos / f.name
        if not alvo.exists():
            shutil.copy2(f, alvo)

    total = sum(tamanhos.values())
    for k, v in sorted(tamanhos.items(), key=lambda x: -x[1])[:8]:
        print(f"  {k:<22} {v / 1024:>7.0f} KB")
    print(f"total dados: {total / 1024 / 1024:.1f} MB  |  partidos: {len(partidos)}  |  "
          f"Câmara: {sum(eleitos_por_cargo[6].values())} cadeiras  |  "
          f"Senado: {sum(eleitos_por_cargo[5].values())} eleitos")


if __name__ == "__main__":
    main()
