# Eleições 2026 · Painel do 1º turno

Painel interativo com o resultado oficial do 1º turno das eleições gerais de 4 de outubro de 2026 — Presidente, Governador, Senador, Deputado Federal e Deputado Estadual/Distrital — do país ao município.

**Dados:** Tribunal Superior Eleitoral (TSE) · **Malha territorial:** IBGE

## O que o painel mostra

- **Navegação em níveis** — Brasil › Região › Estado › Município. Cada clique no mapa desce um nível, e indicadores, gráficos e listas reagem ao recorte.
- **Mapa por município** (5.570 cidades) com o mais votado em cada uma, a força de um partido escolhido ou a abstenção.
- **Composição das casas** — hemiciclo da nova Câmara (513 cadeiras), do Senado (54 cadeiras renovadas, sobre as 81) e das bancadas estaduais.
- **Modo ranking** — candidatos do mais ao menos votado no recorte atual, ordenados por total de votos ou por % na própria UF.
- **Busca de candidatos** que respeita os filtros ativos (nível, cargo e partido).
- **Tabelas por zona eleitoral**, com ordenação e exportação em CSV.
- Temas claro, escuro e "Brasil"; layout responsivo; link compartilhável para qualquer recorte.

## Como os dados foram obtidos

| Etapa | Script | O que faz |
|---|---|---|
| 1 | `scripts/01_baixar_api.py` | Baixa a API de divulgação do TSE (Brasil, UFs, Presidente por município, fotos) e as malhas do IBGE |
| 2 | `scripts/02_agregar_csv.py` | Lê o CSV de votação por município/zona do Portal de Dados Abertos (~6,3 GB descompactado) e agrega por município |
| 2b | `scripts/02b_agregar_zonas.py` | Gera as tabelas por zona eleitoral |
| 3 | `scripts/03_gerar_dados_site.py` | Monta os JSONs enxutos que o site consome (`docs/data/`) |
| 4 | `scripts/04_mapas.py` | Simplifica a malha municipal e gera o TopoJSON (estados e municípios com arcos compartilhados) |

### Validação

- Os votos por município de Presidente, Governador e Senador somam **exatamente** o total oficial publicado pelo TSE.
- As tabelas por zona batem com o total oficial nas 108 combinações de UF × cargo.
- A Câmara soma 513 cadeiras e o Senado, 54 eleitos.

### Limitações conhecidas

- O CSV de dados abertos de 2026 não traz o cargo de Presidente; o mapa presidencial por município vem da API de resultados, que não publica recorte por zona.
- Para deputados, o recorte municipal guarda os 5 candidatos mais votados de cada cidade.
- As 27 cadeiras do Senado que não estavam em disputa (eleitas em 2022) aparecem sem partido no hemiciclo, pois não fazem parte destes dados.

## Rodar localmente

```bash
pip install pandas
python scripts/01_baixar_api.py
python scripts/02_agregar_csv.py      # requer o ZIP de dados abertos em dados/brutos/csv/
python scripts/02b_agregar_zonas.py
python scripts/03_gerar_dados_site.py
python scripts/04_mapas.py            # requer Node.js (usa mapshaper via npx)

python -m http.server 8765 --directory docs
```

Abra `http://localhost:8765`. Abrir o `index.html` direto do disco não funciona: o navegador bloqueia o carregamento dos dados via `file://`.

## Tecnologias

Python (pandas) para coleta e tratamento · D3.js + Canvas para o mapa e os gráficos · HTML/CSS/JS sem build · GitHub Pages.

---

Desenvolvido por **Aluisio Victor**.
