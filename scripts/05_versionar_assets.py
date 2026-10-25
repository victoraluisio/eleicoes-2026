"""Carimba uma versão nova nos CSS/JS do site para furar o cache dos navegadores.

O GitHub Pages serve tudo com Cache-Control: max-age=600 e os nomes dos arquivos
não mudam entre publicações — um celular podia receber o HTML novo com o JS antigo.
Este script acrescenta ?v=<data-hora> a:
  - docs/index.html: a folha de estilo e o módulo principal
  - docs/assets/js/*.js: todos os imports relativos ("./x.js")

Todos os imports de um mesmo módulo recebem a MESMA versão — URLs diferentes
criariam duas instâncias do módulo (e dois estados) no navegador.

Uso (antes de cada commit que vai para o ar):  python scripts/05_versionar_assets.py
"""
import re
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DOCS = RAIZ / "docs"


def main():
    versao = datetime.now().strftime("%Y%m%d%H%M")
    trocas = 0

    index = DOCS / "index.html"
    html = index.read_text(encoding="utf-8")
    html, n = re.subn(r'(assets/(?:css/app\.css|js/app\.js))(\?v=\w+)?"', rf'\1?v={versao}"', html)
    trocas += n
    index.write_text(html, encoding="utf-8")

    for js in sorted((DOCS / "assets" / "js").glob("*.js")):
        texto = js.read_text(encoding="utf-8")
        texto, n = re.subn(r'(from\s+"\./[\w-]+\.js)(\?v=\w+)?"', rf'\1?v={versao}"', texto)
        trocas += n
        js.write_text(texto, encoding="utf-8")

    print(f"versão {versao}: {trocas} referências atualizadas")


if __name__ == "__main__":
    main()
