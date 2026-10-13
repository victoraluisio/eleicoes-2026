"""Gera o TopoJSON do mapa a partir das malhas do IBGE (via mapshaper/npx).

Saída: docs/data/geo/brasil.topo.json com duas camadas que compartilham arcos
(as divisas de estado coincidem exatamente com as de município):
  - mun: 5.570 municípios, id = código IBGE (7 dígitos)
  - uf:  27 UFs, id = código IBGE da UF (2 dígitos), obtidas por dissolve dos municípios

Uso:  python scripts/04_mapas.py
"""
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "dados" / "brutos" / "geo" / "br-municipios.geojson"
SAIDA = RAIZ / "docs" / "data" / "geo" / "brasil.topo.json"

SIMPLIFICACAO = "6%"   # fração de vértices mantida; equilíbrio entre nitidez e peso


def main():
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "npx", "-y", "mapshaper@0.6", "-i", str(ENTRADA), "name=mun",
        "-each", "id=codarea, uf=codarea.slice(0,2)", "-filter-fields", "id,uf",
        "-simplify", SIMPLIFICACAO, "weighted", "keep-shapes",
        "-clean",
        "-dissolve", "uf", "copy-fields=uf", "+", "name=uf",
        "-each", "id=uf", "target=uf",
        "-filter-fields", "id", "target=uf",
        "-o", str(SAIDA), "format=topojson", "id-field=id", "quantization=100000", "target=mun,uf",
    ]
    subprocess.run(cmd, check=True, shell=True)
    print(f"{SAIDA.name}: {SAIDA.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
