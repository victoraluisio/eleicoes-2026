import { carregar, UF_POR_IBGE, REGIOES } from "./util.js";

const BASE = "data";

export const db = {
  resumo: null,
  municipios: null,   // ibge -> [nome, UF, capital]
  topo: null,
  participacao: null, // ibge -> [eleitorado, comparecimento, abstencao, brancos, nulos, validos]
  mun: {},            // cargo -> {m, top, partidos}
  ufDet: {},          // uf -> {6: [...], 7: [...]}
  idx: {},            // cargo -> Map("uf|numero" -> candidato)
  vencedores: {},     // cargo -> Map(ibge -> {partido, pct, n})
};

export async function carregarBase() {
  const [resumo, municipios, topo] = await Promise.all([
    carregar(`${BASE}/resumo.json`),
    carregar(`${BASE}/municipios.json`),
    carregar(`${BASE}/geo/brasil.topo.json`),
  ]);
  Object.assign(db, { resumo, municipios, topo });
}

export const ufDoMun = (ibge) => UF_POR_IBGE[String(ibge).slice(0, 2)];
export const abr = (cargo, uf) => db.resumo.cargos[cargo === 8 ? 7 : cargo]?.abr[uf];

/** Bloco oficial de uma UF (ou do Brasil). DF não tem estadual: usa o distrital. */
export function bloco(cargo, uf) {
  if (+cargo === 7 && uf === "df") return db.resumo.cargos["8"].abr.df;
  return db.resumo.cargos[cargo].abr[uf || "br"];
}

function indexar(cargo) {
  if (db.idx[cargo]) return db.idx[cargo];
  const m = new Map();
  for (const [uf, item] of Object.entries(db.resumo.cargos[cargo].abr)) {
    for (const c of item.candidatos || []) m.set(`${cargo === 1 ? "br" : uf}|${c.n}`, c);
  }
  return (db.idx[cargo] = m);
}

export function candidato(cargo, uf, numero) {
  cargo = +cargo;
  if (cargo === 1) return indexar(1).get(`br|${numero}`);
  if (cargo === 3 || cargo === 5) return indexar(cargo).get(`${uf}|${numero}`);
  const lista = db.ufDet[uf]?.[uf === "df" && cargo === 7 ? "8" : String(cargo)];
  return lista?.find((c) => c.n === numero);
}

export async function garantirCargo(cargo) {
  const [mun, part] = await Promise.all([
    carregar(`${BASE}/mun/c${cargo}.json`),
    carregar(`${BASE}/mun/participacao.json`),
  ]);
  db.mun[cargo] = mun;
  db.participacao = part;
  if (!db.vencedores[cargo]) {
    const v = new Map();
    for (const [ibge, arr] of Object.entries(mun.m)) {
      let total = 0;
      for (let i = 1; i < arr.length; i += 2) total += arr[i];
      if (!total) continue;
      const lider = arr[0];
      const partido = mun.partidos ? mun.partidos[lider] : candidato(cargo, ufDoMun(ibge), lider)?.partido;
      v.set(ibge, { partido, n: lider, pct: (arr[1] / total) * 100, total });
    }
    db.vencedores[cargo] = v;
  }
  return mun;
}

export async function garantirUF(uf) {
  if (!db.ufDet[uf]) db.ufDet[uf] = await carregar(`${BASE}/uf/${uf}.json`);
  return db.ufDet[uf];
}

/** Resultado do cargo em um município, já resolvido em nomes/partidos. */
export function resultadoMun(cargo, ibge) {
  const mun = db.mun[cargo];
  const arr = mun?.m[ibge];
  if (!arr) return null;
  const uf = ufDoMun(ibge);
  let total = 0;
  for (let i = 1; i < arr.length; i += 2) total += arr[i];
  const linhas = [];
  for (let i = 0; i < arr.length; i += 2) {
    if (mun.partidos) {
      linhas.push({ partido: mun.partidos[arr[i]], votos: arr[i + 1], pct: (arr[i + 1] / total) * 100 });
    } else {
      const c = candidato(cargo, uf, arr[i]) || { n: arr[i], nome: `Nº ${arr[i]}`, partido: "?" };
      linhas.push({ ...c, votos: arr[i + 1], pct: (arr[i + 1] / total) * 100 });
    }
  }
  const out = { total, linhas, uf };
  if (mun.top?.[ibge]) {
    const t = mun.top[ibge];
    out.top = [];
    for (let i = 0; i < t.length; i += 2) {
      const c = candidato(cargo, uf, t[i]) || { n: t[i], nome: `Nº ${t[i]}`, partido: "?" };
      out.top.push({ ...c, votosMun: t[i + 1], pctMun: (t[i + 1] / total) * 100 });
    }
  }
  return out;
}

/** Vencedor de uma UF (ou do Brasil) para colorir o mapa no nível estadual. */
export function vencedorUF(cargo, uf) {
  const b = bloco(cargo, uf);
  if (!b) return null;
  if (b.candidatos) {
    const c = b.candidatos[0];
    return { partido: c.partido, pct: c.pct, n: c.n, nome: c.nome };
  }
  const p = b.partidos[0];
  return { partido: p.partido, pct: (p.votos / b.totais.validos) * 100, cadeiras: p.cadeiras };
}

/** Participação percentual do partido em um município (votos válidos). */
export function fatiaPartidoMun(cargo, ibge, partido) {
  const r = resultadoMun(cargo, ibge);
  if (!r) return null;
  let v = 0;
  for (const l of r.linhas) if (l.partido === partido) v += l.votos;
  return (v / r.total) * 100;
}

export function fatiaPartidoUF(cargo, uf, partido) {
  const b = bloco(cargo, uf);
  if (!b) return null;
  if (b.candidatos) {
    const total = b.candidatos.reduce((s, c) => s + (c.valido ? c.votos : 0), 0);
    const v = b.candidatos.filter((c) => c.partido === partido && c.valido).reduce((s, c) => s + c.votos, 0);
    return total ? (v / total) * 100 : 0;
  }
  const p = b.partidos.find((x) => x.partido === partido);
  return p ? (p.votos / b.totais.validos) * 100 : 0;
}

/** Partidos ordenados por relevância nacional (para o filtro). */
export function partidosOrdenados() {
  const votos = db.resumo.nacional.votosCamara;
  return Object.keys(db.resumo.partidos).sort((a, b) => (votos[b] || 0) - (votos[a] || 0));
}

// ------------------------------------------------------------------ regiões
// A API do TSE publica Brasil e UF; a região é a soma das UFs que a compõem.
const cacheRegiao = new Map();

function somarTotais(lista) {
  const somaveis = ["eleitorado", "comparecimento", "abstencao", "validos", "nominais", "legenda", "brancos", "nulos", "secoes"];
  const t = Object.fromEntries(somaveis.map((k) => [k, lista.reduce((s, x) => s + (x[k] || 0), 0)]));
  t.pComparecimento = (t.comparecimento / t.eleitorado) * 100;
  t.pAbstencao = (t.abstencao / t.eleitorado) * 100;
  const totalVotos = t.validos + t.brancos + t.nulos;   // Senado: 2 votos por eleitor
  t.pBrancos = (t.brancos / totalVotos) * 100;
  t.pNulos = (t.nulos / totalVotos) * 100;
  t.pApuradas = Math.min(...lista.map((x) => x.pApuradas));
  return t;
}

/**
 * Resultado agregado de uma região. Presidente vira uma lista única de candidatos;
 * Governador/Senador viram votos e eleitos por partido; deputados viram bancada somada.
 */
export function blocoRegiao(cargo, reg) {
  const chave = `${cargo}|${reg}`;
  if (cacheRegiao.has(chave)) return cacheRegiao.get(chave);
  const ufs = REGIOES[reg].ufs;
  const blocos = ufs.map((uf) => bloco(cargo, uf));
  const out = { regiao: reg, ufs, totais: somarTotais(blocos.map((b) => b.totais)) };

  if (+cargo === 1) {
    const soma = new Map();
    for (const b of blocos) for (const c of b.candidatos) soma.set(c.n, (soma.get(c.n) || 0) + c.votos);
    const totalValidos = blocos.reduce((s, b) => s + b.candidatos.filter((c) => c.valido).reduce((a, c) => a + c.votos, 0), 0);
    out.candidatos = bloco(1, "br").candidatos.map((c) => ({ ...c, votos: soma.get(c.n) || 0, pct: ((soma.get(c.n) || 0) / totalValidos) * 100 }))
      .sort((a, b) => b.votos - a.votos);
  } else if (+cargo === 3 || +cargo === 5) {
    const votos = new Map(), eleitos = new Map(), segundo = new Map();
    let total = 0;
    for (const b of blocos) for (const c of b.candidatos) {
      if (!c.valido) continue;
      total += c.votos;
      votos.set(c.partido, (votos.get(c.partido) || 0) + c.votos);
      if (c.situacao === "eleito") eleitos.set(c.partido, (eleitos.get(c.partido) || 0) + 1);
      if (c.situacao === "2t") segundo.set(c.partido, (segundo.get(c.partido) || 0) + 1);
    }
    out.partidos = [...votos].map(([partido, v]) => ({
      partido, votos: v, pct: (v / total) * 100, eleitos: eleitos.get(partido) || 0, segundoTurno: segundo.get(partido) || 0,
    })).sort((a, b) => b.eleitos - a.eleitos || b.votos - a.votos);
    out.totalValidos = total;
  } else {
    const p = new Map();
    for (const b of blocos) for (const x of b.partidos) {
      const atual = p.get(x.partido) || { partido: x.partido, votos: 0, cadeiras: 0 };
      atual.votos += x.votos; atual.cadeiras += x.cadeiras;
      p.set(x.partido, atual);
    }
    out.partidos = [...p.values()].sort((a, b) => b.cadeiras - a.cadeiras || b.votos - a.votos);
    out.vagas = blocos.reduce((s, b) => s + b.vagas, 0);
    out.eleitos = blocos.flatMap((b) => b.eleitos).sort((a, b) => b.votos - a.votos);
  }
  cacheRegiao.set(chave, out);
  return out;
}

/** % dos votos válidos do partido em uma região. */
export function fatiaPartidoRegiao(cargo, reg, partido) {
  const b = blocoRegiao(cargo, reg);
  if (b.candidatos) {
    const tot = b.candidatos.filter((c) => c.valido).reduce((s, c) => s + c.votos, 0);
    return (b.candidatos.filter((c) => c.partido === partido && c.valido).reduce((s, c) => s + c.votos, 0) / tot) * 100;
  }
  const x = b.partidos.find((p) => p.partido === partido);
  if (!x) return 0;
  return x.pct ?? (x.votos / b.totais.validos) * 100;
}

// ------------------------------------------------------------------ ranking
/**
 * Candidatos do cargo no escopo (Brasil, região, UF ou município), do mais ao menos votado.
 * Acima da UF, junta as listas de cada estado e marca a UF de origem.
 * Retorna { itens, parcial }: parcial = só os mais votados estão disponíveis (deputados no município).
 */
export async function rankingEscopo(cargo, { reg, uf, mun }) {
  cargo = +cargo;
  const prop = cargo === 6 || cargo === 7;
  const validos = (lista) => lista.filter((c) => c.valido !== false && c.votos > 0);

  if (mun) {
    await garantirUF(uf);
    const r = resultadoMun(cargo, mun);
    if (!r) return { itens: [] };
    if (prop) return { itens: (r.top || []).map((c) => ({ ...c, votos: c.votosMun, pct: c.pctMun })), parcial: true };
    return { itens: r.linhas };
  }
  if (cargo === 1 && !uf) {
    const b = reg ? blocoRegiao(1, reg) : bloco(1, "br");
    return { itens: validos(b.candidatos) };
  }
  const ufs = uf ? [uf] : reg ? REGIOES[reg].ufs : Object.keys(UF_POR_IBGE).map((k) => UF_POR_IBGE[k]);
  let itens = [];
  if (prop) {
    await Promise.all(ufs.map(garantirUF));
    for (const u of ufs) {
      const lista = db.ufDet[u]?.[u === "df" && cargo === 7 ? "8" : String(cargo)] || [];
      itens.push(...validos(lista).map((c) => ({ ...c, uf: u })));
    }
  } else {
    for (const u of ufs) itens.push(...validos(bloco(cargo, u).candidatos).map((c) => ({ ...c, uf: u })));
  }
  itens.sort((a, b) => b.votos - a.votos);
  return { itens };
}
