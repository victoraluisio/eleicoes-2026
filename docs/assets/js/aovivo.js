// Modo ao vivo (2º turno): lê a API de divulgação do TSE direto do navegador.
// O TSE responde com Access-Control-Allow-Origin para outros domínios e cache de
// poucos segundos — é a mesma fonte do app "Resultados".
//
// Estratégia de tráfego:
//  - a cada ciclo: arquivo do Brasil + um por UF (~3 KB cada)
//  - UF aberta: arquivo de progresso por município (…-ab.json) e, a partir dele,
//    só os municípios cuja apuração avançou desde o último ciclo
import { UFS, REGIOES } from "./util.js";

const BASE = "https://resultados.tse.jus.br/oficial/ele2026";
const INTERVALO = 30_000;
const LOTE_MUN = 120;        // municípios baixados por ciclo, no máximo
const PARALELO = 6;

// ?simular — liga o modo ao vivo sobre o 1º turno (dados reais), para testar antes do dia
export const SIMULANDO = new URLSearchParams(location.search).has("simular");
const ELEICAO = SIMULANDO ? { 1: 6257, 3: 6259 } : { 1: 6258, 3: 6260 };

// ------------------------------------------------------------------ tratamento (espelha o 03_gerar_dados_site.py)
const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "di", "du", "del"]);
const MANTER = new Set(["ACM", "JHC", "II", "III", "IV"]);
function titulo(nome = "") {
  return nome.split(/\s+/).map((p, i) => {
    const limpo = p.replace(/[^\wÀ-ÿ]/g, "");
    if (MANTER.has(limpo.toUpperCase())) return p.toUpperCase();
    if (!p.endsWith(".") && /^[A-Za-zÀ-ÿ]+$/.test(limpo) && limpo.length > 1 && !/[AEIOUÁÉÍÓÚÂÊÔÃÕÀÜ]/i.test(limpo)) return p.toUpperCase();
    if (i > 0 && MINUSCULAS.has(p.toLowerCase())) return p.toLowerCase();
    return p.toLowerCase().replace(/(^|[-.])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }).join(" ");
}
const num = (s) => (s ? +s : 0);
const pct = (s) => (s ? +String(s).replace(",", ".") : 0);
const SITUACAO = { Eleito: "eleito", "Eleito por QP": "eleito", "Eleito por média": "eleito", "2º turno": "2t" };

function totais(d) {
  const { e, v, s } = d;
  const totalVotos = num(v.vv) + num(v.vb) + num(v.tvn);
  return {
    eleitorado: num(e.te), comparecimento: num(e.c), abstencao: num(e.a),
    pComparecimento: pct(e.pc), pAbstencao: pct(e.pa),
    validos: num(v.vv), brancos: num(v.vb), nulos: num(v.tvn),
    pBrancos: totalVotos ? (num(v.vb) / totalVotos) * 100 : 0,
    pNulos: totalVotos ? (num(v.tvn) / totalVotos) * 100 : 0,
    secoes: num(s.ts), secoesApuradas: num(s.st), pApuradas: pct(s.pst),
    finalizado: d.tf === "s",
    atualizado: [d.dg, d.hg].filter(Boolean).join(" "),
  };
}

/** Arquivo "-u.json" do TSE -> { totais, candidatos } no formato do painel. */
export function interpretar(d) {
  const candidatos = [];
  for (const cg of d.carg || []) for (const agr of cg.agr) for (const par of agr.par) for (const c of par.cand) {
    candidatos.push({
      n: num(c.n), nome: titulo(c.nmu), nomeCompleto: titulo(c.nm), partido: par.sg,
      votos: num(c.vap), pct: pct(c.pvap), situacao: SITUACAO[c.st] || "nao",
      valido: (c.dvt || "Válido").startsWith("Válido"), foto: c.sqcand,
      vices: (c.vs || []).map((x) => `${titulo(x.nmu)} (${x.sgp})`),
    });
  }
  candidatos.sort((a, b) => b.votos - a.votos || a.n - b.n);
  return { totais: totais(d), candidatos };
}

/** Soma vários blocos (região): votos por número de candidato e totais. */
export function agregar(blocos) {
  blocos = blocos.filter(Boolean);
  if (!blocos.length) return null;
  const soma = (k) => blocos.reduce((s, b) => s + (b.totais[k] || 0), 0);
  const t = Object.fromEntries(["eleitorado", "comparecimento", "abstencao", "validos", "brancos", "nulos", "secoes", "secoesApuradas"].map((k) => [k, soma(k)]));
  const tv = t.validos + t.brancos + t.nulos;
  Object.assign(t, {
    pComparecimento: t.eleitorado ? (t.comparecimento / t.eleitorado) * 100 : 0,
    pAbstencao: t.eleitorado ? (t.abstencao / t.eleitorado) * 100 : 0,
    pBrancos: tv ? (t.brancos / tv) * 100 : 0, pNulos: tv ? (t.nulos / tv) * 100 : 0,
    pApuradas: t.secoes ? (t.secoesApuradas / t.secoes) * 100 : 0,
    finalizado: blocos.every((b) => b.totais.finalizado),
  });
  const porN = new Map();
  for (const b of blocos) for (const c of b.candidatos) {
    const x = porN.get(c.n) || { ...c, votos: 0 };
    x.votos += c.votos;
    porN.set(c.n, x);
  }
  const candidatos = [...porN.values()].map((c) => ({ ...c, pct: t.validos ? (c.votos / t.validos) * 100 : 0 }))
    .sort((a, b) => b.votos - a.votos || a.n - b.n);
  return { totais: t, candidatos };
}

// ------------------------------------------------------------------ rede
async function buscar(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// abrangência: "br", "sp" ou município "sp71072" — a pasta é sempre a da UF (ou "br")
const urlCargo = (cargo, ab) => `${BASE}/${ELEICAO[cargo]}/dados/${ab.slice(0, 2)}/${ab}-c${String(cargo).padStart(4, "0")}-e${String(ELEICAO[cargo]).padStart(6, "0")}-u.json`;
const urlProgresso = (cargo, uf) => `${BASE}/${ELEICAO[cargo]}/dados/${uf}/${uf}-e${String(ELEICAO[cargo]).padStart(6, "0")}-ab.json`;
const urlConfigMun = (cargo) => `${BASE}/${ELEICAO[cargo]}/config/mun-e${String(ELEICAO[cargo]).padStart(6, "0")}-cm.json`;

async function emParalelo(itens, n, fn) {
  const fila = [...itens];
  await Promise.all(Array.from({ length: n }, async () => {
    while (fila.length) await fn(fila.shift());
  }));
}

// ------------------------------------------------------------------ estado ao vivo
export class AoVivo {
  constructor({ municipios, aoAtualizar }) {
    this.municipios = municipios;            // ibge -> [nome, UF, capital, códigoTSE]
    this.aoAtualizar = aoAtualizar;
    this.dados = { 1: { uf: {}, mun: {} }, 3: { uf: {}, mun: {} } };
    this.progresso = {};                     // `${cargo}|${ibge}` -> seções totalizadas
    this.ufsCargo = { 1: Object.keys(UFS), 3: [] };
    this.ultimoOk = null;
    this.erro = null;
    this.ligado = false;
    this.escopo = { cargo: 1, uf: null };
    document.addEventListener("visibilitychange", () => { if (!document.hidden && this.ligado) this.ciclo(); });
  }

  async iniciar() {
    // quais UFs têm 2º turno de governador: vem do cadastro de municípios da eleição
    try {
      const cm = await buscar(urlConfigMun(3));
      this.ufsCargo[3] = cm.abr.map((a) => a.cd).filter((uf) => UFS[uf]);
    } catch { this.ufsCargo[3] = []; }
    this.ligado = true;
    await this.ciclo();
    this.timer = setInterval(() => { if (!document.hidden) this.ciclo(); }, INTERVALO);
  }

  parar() { this.ligado = false; clearInterval(this.timer); }

  /** Escopo que a tela está mostrando — decide quais municípios vale a pena buscar. */
  focar(cargo, uf) {
    const mudou = this.escopo.cargo !== cargo || this.escopo.uf !== uf;
    this.escopo = { cargo, uf };
    if (mudou && this.ligado) this.ciclo();
  }

  async ciclo() {
    if (this.rodando) return this.rodando;
    this.rodando = (async () => {
      const { cargo, uf } = this.escopo;
      const d = this.dados[cargo];
      try {
        const alvos = cargo === 1 ? ["br", ...this.ufsCargo[1]] : this.ufsCargo[3];
        const falhas = [];
        await emParalelo(alvos, PARALELO, async (ab) => {
          try {
            const bloco = interpretar(await buscar(urlCargo(cargo, ab)));
            if (ab === "br") d.br = bloco; else d.uf[ab] = bloco;
          } catch (e) { falhas.push(ab); }
        });
        if (falhas.length === alvos.length) throw new Error("nenhuma resposta do TSE");
        this.ultimoOk = new Date();
        this.erro = null;
        // pinta já com Brasil/UFs; os municípios completam o mapa em seguida
        if (uf && this.ufsCargo[cargo].includes(uf)) {
          this.aoAtualizar?.();
          await this.municipiosDa(cargo, uf);
        }
      } catch (e) {
        this.erro = e.message || String(e);
      }
      this.aoAtualizar?.();
    })();
    try { await this.rodando; } finally { this.rodando = null; }
  }

  async municipiosDa(cargo, uf) {
    const prog = await buscar(urlProgresso(cargo, uf));
    const ibgePorTse = new Map(Object.entries(this.municipios)
      .filter(([, m]) => m[1].toLowerCase() === uf).map(([ibge, m]) => [String(m[3]).padStart(5, "0"), ibge]));
    const pendentes = [];
    for (const a of prog.abr || []) {
      if (a.tpabr !== "mun") continue;
      const ibge = ibgePorTse.get(a.cdabr.padStart(5, "0"));
      if (!ibge) continue;
      const st = num(a.s?.st);
      const chave = `${cargo}|${ibge}`;
      // baixa se a apuração avançou ou se ainda não temos o município
      if (st > 0 && (this.progresso[chave] !== st || !this.dados[cargo].mun[ibge])) pendentes.push({ ibge, tse: a.cdabr, st, chave });
    }
    await emParalelo(pendentes.slice(0, LOTE_MUN), PARALELO, async ({ ibge, tse, st, chave }) => {
      try {
        this.dados[cargo].mun[ibge] = interpretar(await buscar(urlCargo(cargo, `${uf}${tse.padStart(5, "0")}`)));
        this.progresso[chave] = st;
      } catch { /* tenta de novo no próximo ciclo */ }
    });
  }

  // ---------------------------------------------------------------- leitura
  bloco(cargo, { reg, uf, mun } = {}) {
    const d = this.dados[cargo];
    if (mun) return d.mun[mun] || null;
    if (uf) return d.uf[uf] || null;
    if (cargo === 3) return null;   // governador não tem soma nacional/regional que faça sentido
    if (reg) return agregar(REGIOES[reg].ufs.map((u) => d.uf[u]));
    return d.br || null;
  }

  temSegundoTurno(cargo, uf) { return this.ufsCargo[cargo].includes(uf); }
}
