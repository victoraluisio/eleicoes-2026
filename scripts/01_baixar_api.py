"""Baixa os resultados oficiais do 1º turno de 2026 da API de divulgação do TSE.

Fonte: https://resultados.tse.jus.br (mesma API do app "Resultados" do TSE).
Saída: dados/brutos/api/  (JSON original, sem tratamento) e dados/brutos/fotos/.

Uso:  python scripts/01_baixar_api.py
"""
import gzip
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
API = RAIZ / "dados" / "brutos" / "api"
FOTOS = RAIZ / "dados" / "brutos" / "fotos"
GEO = RAIZ / "dados" / "brutos" / "geo"

BASE = "https://resultados.tse.jus.br/oficial"
CICLO = "ele2026"
ELE_FED = 6257   # Presidente
ELE_EST = 6259   # Governador, Senador, Deputados

UFS = ("ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr "
       "rj rn ro rr rs sc se sp to").split()

# cargo -> código da eleição
CARGOS = {1: ELE_FED, 3: ELE_EST, 5: ELE_EST, 6: ELE_EST, 7: ELE_EST, 8: ELE_EST}

IBGE = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"


def baixar(url: str, destino: Path, tentativas: int = 4) -> bool:
    if destino.exists() and destino.stat().st_size > 0:
        return True
    destino.parent.mkdir(parents=True, exist_ok=True)
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "painel-eleicoes-2026"})
            with urllib.request.urlopen(req, timeout=120) as r:
                dados = r.read()
            if dados[:2] == b"\x1f\x8b":   # IBGE responde gzip mesmo sem Accept-Encoding
                dados = gzip.decompress(dados)
            destino.write_bytes(dados)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            time.sleep(2 ** i)
        except Exception:
            time.sleep(2 ** i)
    print(f"  falhou: {url}")
    return False


def arquivos_resultado():
    """(url, destino) de todos os arquivos de resultado por abrangência."""
    for cargo, ele in CARGOS.items():
        if cargo == 1:
            abrangencias = ["br", "zz"] + UFS
        elif cargo == 7:
            abrangencias = [u for u in UFS if u != "df"]   # DF elege distrital
        elif cargo == 8:
            abrangencias = ["df"]
        else:
            abrangencias = UFS
        for ab in abrangencias:
            nome = f"{ab}-c{cargo:04d}-e{ele:06d}-u.json"
            yield f"{BASE}/{CICLO}/{ele}/dados/{ab}/{nome}", API / nome


def candidatos(arquivo: Path):
    d = json.loads(arquivo.read_text(encoding="utf-8"))
    for cg in d["carg"]:
        for agr in cg["agr"]:
            for par in agr["par"]:
                for c in par["cand"]:
                    yield c


def main():
    t0 = time.time()

    # 1) configuração (eleições + tabela de municípios TSE -> IBGE)
    baixar(f"{BASE}/comum/config/ele-c.json", API / "ele-c.json")
    for ele in (ELE_FED, ELE_EST):
        baixar(f"{BASE}/{CICLO}/{ele}/config/mun-e{ele:06d}-cm.json",
               API / f"mun-e{ele:06d}-cm.json")

    # 2) resultados por abrangência (Brasil, exterior, UFs)
    jobs = list(arquivos_resultado())
    with ThreadPoolExecutor(8) as ex:
        ok = sum(ex.map(lambda j: baixar(*j), jobs))
    print(f"resultados: {ok}/{len(jobs)} arquivos")

    # 2b) Presidente por município — o CSV de dados abertos de 2026 não traz o cargo 1,
    #     então o mapa municipal presidencial vem da API (um arquivo por município)
    cm = json.loads((API / f"mun-e{ELE_FED:06d}-cm.json").read_text(encoding="utf-8"))
    jobs = []
    for abr in cm["abr"]:
        if abr["cd"] == "zz":
            continue
        for m in abr["mu"]:
            nome = f'{abr["cd"]}{m["cd"]}-c0001-e{ELE_FED:06d}-u.json'
            jobs.append((f"{BASE}/{CICLO}/{ELE_FED}/dados/{abr['cd']}/{nome}", API / "mun" / nome))
    with ThreadPoolExecutor(12) as ex:
        ok = sum(ex.map(lambda j: baixar(*j), jobs))
    print(f"presidente por município: {ok}/{len(jobs)}")

    # 3) fotos: todos os candidatos majoritários + deputados eleitos
    fotos = []
    for arq in sorted(API.glob("*-c000*-e*-u.json")):
        ab, cargo = arq.name[:2], int(arq.name[4:8])
        if ab in ("br", "zz") and cargo == 1:
            continue
        ele = CARGOS[cargo]
        pasta_uf = "br" if cargo == 1 else ab
        for c in candidatos(arq):
            if cargo in (1, 3, 5) or c.get("e") == "s":
                sq = c["sqcand"]
                fotos.append((f"{BASE}/{CICLO}/{ele}/fotos/{pasta_uf}/{sq}.jpeg",
                              FOTOS / f"{sq}.jpeg"))
    fotos = list(dict(((d, (u, d)) for u, d in fotos)).values())
    with ThreadPoolExecutor(8) as ex:
        ok = sum(ex.map(lambda j: baixar(*j), fotos))
    print(f"fotos: {ok}/{len(fotos)}")

    # 4) malhas do IBGE (estados e municípios)
    fmt = "formato=application/vnd.geo%2Bjson"
    baixar(f"{IBGE}?intrarregiao=UF&qualidade=intermediaria&{fmt}", GEO / "br-uf.geojson")
    baixar(f"{IBGE}?intrarregiao=municipio&qualidade=intermediaria&{fmt}", GEO / "br-municipios.geojson")

    print(f"concluído em {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
