import { corPartido } from "./cores.js?v=202610251223";
import {
  db, bloco, resultadoMun, garantirUF, fatiaPartidoUF, fatiaPartidoMun, vencedorUF, blocoRegiao, fatiaPartidoRegiao,
  rankingEscopo,
} from "./dados.js?v=202610251223";
import { el, int, pct, compacto, contar, iniciais, semAcento, UFS, REGIOES, cargoInfo, reduzMovimento } from "./util.js?v=202610251223";

const SIT = {
  eleito: ["Eleito", "badge-eleito"],
  "2t": ["2º turno", "badge-2t"],
};

// ------------------------------------------------------------------ peças
const chip = (sg) => el("span", { class: "chip", style: { "--c": corPartido(sg) } }, sg);

function avatar(c, tamanho = "md") {
  const cor = corPartido(c.partido);
  const a = el("div", { class: `avatar avatar-${tamanho}`, style: { "--c": cor } });
  if (c.foto) {
    const img = el("img", { src: `fotos/${c.foto}.jpeg`, alt: "", loading: "lazy", decoding: "async" });
    img.onerror = () => img.replaceWith(el("span", {}, iniciais(c.nome)));
    a.append(img);
  } else a.append(el("span", {}, iniciais(c.nome)));
  return a;
}

function barra(valor, max, cor) {
  const b = el("div", { class: "barra" }, el("i", { style: { "--c": cor } }));
  const alvo = `${Math.max(0.4, (valor / max) * 100)}%`;
  requestAnimationFrame(() => requestAnimationFrame(() => (b.firstChild.style.width = alvo)));
  return b;
}

function secao(titulo, sub, ...conteudo) {
  return el("section", { class: "secao" },
    el("header", { class: "secao-cab" }, el("h3", {}, titulo), sub ? el("p", {}, sub) : null),
    ...conteudo);
}

function numero(alvo, fmt = int) {
  const s = el("span", {}, fmt(0));
  contar(s, alvo, fmt);
  return s;
}

// ------------------------------------------------------------------ KPIs (cards do topo)
const fmt1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Número grande com unidade pequena: 158,7 mi · 78,92 % (anima a partir de `de`) */
function grande(n, tipo, de = 0) {
  const v = el("span", {}, "0");
  let alvo = n, unidade = "", f = (x) => fmt2.format(x);
  if (tipo === "pessoas") {
    if (n >= 1e6) { alvo = n / 1e6; unidade = "mi"; f = (x) => fmt1.format(x); }
    else if (n >= 1e4) { alvo = n / 1e3; unidade = "mil"; f = (x) => fmt1.format(x); }
    else f = int;
  } else unidade = "%";
  const escala = alvo / (n || 1);   // mesma unidade para o valor anterior
  contar(v, alvo, f, 900, tipo === "pessoas" ? de * escala : de);
  return el("span", { class: "kpi-val" }, v, el("small", {}, unidade));
}

export function montarKPIs(alvo, estado) {
  const { cargo, uf, mun, reg } = estado;
  const t = mun ? totaisMun(mun) : uf ? bloco(cargo, uf)?.totais : reg ? blocoRegiao(cargo, reg).totais : bloco(cargo, "br")?.totais;
  if (!t) return alvo.replaceChildren();
  const onde = mun ? "no município" : uf ? "no estado" : reg ? "na região" : "no Brasil";
  desenharKPIs(alvo, t, onde, { chave: `1|${cargo}|${reg}|${uf}|${mun}` });
}

/**
 * Cartões do topo a partir de um bloco de totais. Mesma `chave` da última pintura =
 * atualização ao vivo: sem animação de entrada e números saindo do valor anterior.
 */
export function desenharKPIs(alvo, t, onde, { chave, aoVivo = false } = {}) {
  const suave = alvo.dataset.chave === chave;
  const antes = suave ? alvo._valores || [] : [];
  alvo.dataset.chave = chave;
  alvo.classList.toggle("sem-entrada", suave);
  // % sobre o total de votos (no Senado cada eleitor vota duas vezes)
  const totalVotos = t.validos + t.brancos + t.nulos;
  const pB = (t.brancos / totalVotos) * 100, pN = (t.nulos / totalVotos) * 100;
  const bn = totalVotos ? pB + pN : 0;
  const valores = [t.eleitorado, t.pComparecimento, t.pAbstencao, bn];
  alvo._valores = valores;
  const apurado = t.pApuradas >= 100 && !aoVivo
    ? el("span", { class: "pilula verde" }, `✓ ${pct(t.pApuradas)} apurado`)
    : t.pApuradas != null ? el("span", { class: `pilula ${t.pApuradas >= 100 ? "verde" : "ambar"}` }, `${t.pApuradas >= 100 ? "✓" : "⏱"} ${pct(t.pApuradas)} apurado`)
      : el("span", { class: "pilula" }, "1º turno");
  const cards = [
    ["Eleitorado", `Aptos a votar ${onde}`, grande(t.eleitorado, "pessoas", antes[0]), apurado],
    ["Comparecimento", "Eleitores que votaram", grande(t.pComparecimento, "pct", antes[1]),
      el("span", { class: "pilula verde" }, `↗ ${compacto(t.comparecimento)}`)],
    ["Abstenção", "Não foram às urnas", grande(t.pAbstencao, "pct", antes[2]),
      el("span", { class: "pilula rosa" }, `↘ ${compacto(t.abstencao)}`)],
    ["Brancos e nulos", "Sobre o total de votos", grande(bn, "pct", antes[3]),
      el("span", { class: "pilula" }, `${pct(totalVotos ? pB : 0)} · ${pct(totalVotos ? pN : 0)}`)],
  ];
  alvo.replaceChildren(...cards.map(([tit, sub, val, pil], i) =>
    el("article", { class: "kpi", style: { "--i": i } },
      el("h3", { class: "kpi-tit" }, tit), el("p", { class: "kpi-sub" }, sub),
      el("div", { class: "kpi-base" }, val, pil))));
}

function totaisMun(ibge) {
  const p = db.participacao?.[ibge];
  if (!p) return null;
  const [eleitorado, comparecimento, abstencao, brancos, nulos, validos] = p;
  return {
    eleitorado, comparecimento, abstencao, brancos, nulos, validos,
    pComparecimento: (comparecimento / eleitorado) * 100, pAbstencao: (abstencao / eleitorado) * 100,
  };
}

// ------------------------------------------------------------------ candidatos majoritários
function linhaCandidato(c, i, { destaque, max = 100 }) {
  const [rotulo, cls] = SIT[c.situacao] || [];
  const apagado = destaque && c.partido !== destaque;
  return el("li", {
    class: `cand ${apagado ? "apagado" : ""} ${c.valido === false ? "invalido" : ""}`,
    style: { "--i": i },
  },
  avatar(c, i < 2 ? "lg" : "md"),
  el("div", { class: "cand-info" },
    el("div", { class: "cand-topo" },
      el("span", { class: "cand-nome", title: c.nomeCompleto || c.nome }, c.nome),
      rotulo ? el("span", { class: `badge ${cls}` }, rotulo) : null),
    el("div", { class: "cand-meta" }, chip(c.partido), el("span", { class: "num" }, c.n),
      c.vices ? el("span", { class: "vice" }, `Vice: ${c.vices.join(", ")}`) : null,
      c.valido === false ? el("span", { class: "vice" }, "votos anulados sub judice") : null),
    barra(c.pct, max, corPartido(c.partido))),
  el("div", { class: "cand-num" }, el("strong", {}, numero(c.pct, pct)), el("span", {}, int(c.votos))));
}

function listaCandidatos(cands, { destaque, limite = 6 } = {}) {
  const validos = cands.filter((c) => c.valido !== false && c.votos > 0);
  const resto = cands.filter((c) => !validos.includes(c));
  const max = Math.max(...validos.map((c) => c.pct), 1);
  const ul = el("ol", { class: "cands" });
  const mostrar = (n) => {
    ul.replaceChildren(...validos.slice(0, n).map((c, i) => linhaCandidato(c, i, { destaque, max })));
  };
  mostrar(limite);
  const extras = validos.length - limite + resto.length;
  const frag = [ul];
  if (extras > 0) {
    const botao = el("button", { class: "mais", type: "button" }, `Ver todos (${validos.length + resto.length})`);
    botao.onclick = () => {
      mostrar(validos.length);
      resto.forEach((c, i) => ul.append(linhaCandidato(c, validos.length + i, { destaque, max })));
      botao.remove();
    };
    frag.push(botao);
  }
  return frag;
}

// ------------------------------------------------------------------ barras por partido
function barrasPartido(linhas, { destaque, valor = "valor", rotuloValor, max, onClick } = {}) {
  max ??= Math.max(...linhas.map((l) => l[valor]), 1);
  return el("ol", { class: "barras-partido" }, linhas.map((l, i) => el("li", {
    class: `bp ${destaque && l.partido !== destaque ? "apagado" : ""} ${onClick ? "clicavel" : ""}`,
    style: { "--i": i },
    onclick: onClick ? () => onClick(l.partido) : null,
    title: onClick ? `Filtrar por ${l.partido}` : null,
  },
  el("span", { class: "bp-sg" }, chip(l.partido)),
  barra(l[valor], max, corPartido(l.partido)),
  el("span", { class: "bp-val" }, rotuloValor ? rotuloValor(l) : int(l[valor])))));
}

// ------------------------------------------------------------------ hemiciclo
// partido "_vago" = assento fora desta eleição (desenhado em cinza)
const FORA = "_vago";

function hemiciclo(partidos, { destaque, titulo, centro, rotulo = "cadeiras" } = {}) {
  const lista = partidos.filter((p) => p.cadeiras > 0);
  const N = d3.sum(lista, (p) => p.cadeiras);
  const R = Math.max(3, Math.round(Math.sqrt(N / 1.4)));
  const r0 = 0.38;
  const raios = d3.range(R).map((i) => r0 + ((1 - r0) * i) / (R - 1));
  const somaR = d3.sum(raios);
  let porLinha = raios.map((r) => Math.round((N * r) / somaR));
  porLinha[R - 1] += N - d3.sum(porLinha);
  const assentos = [];
  raios.forEach((r, i) => {
    const n = porLinha[i];
    for (let j = 0; j < n; j++) {
      const a = Math.PI - (n === 1 ? Math.PI / 2 : (Math.PI * j) / (n - 1));
      assentos.push({ a, r });
    }
  });
  assentos.sort((x, y) => y.a - x.a || x.r - y.r);
  let k = 0;
  for (const p of lista) for (let j = 0; j < p.cadeiras; j++) assentos[k++].partido = p.partido;

  const W = 400, H = 214;
  const passoFileira = ((1 - r0) / (R - 1)) * 190;
  const passoArco = (Math.PI * 190) / Math.max(1, porLinha[R - 1] - 1);
  const raioPonto = Math.min(passoFileira, passoArco) * 0.42;
  const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("class", "hemiciclo")
    .attr("role", "img").attr("aria-label", `${titulo || "Composição"}: ${N} cadeiras`);
  svg.selectAll("circle").data(assentos).join("circle")
    .attr("cx", (d) => W / 2 + Math.cos(d.a) * d.r * 190)
    .attr("cy", (d) => H - 8 - Math.sin(d.a) * d.r * 190)
    .attr("r", reduzMovimento() ? raioPonto : 0)
    .attr("fill", (d) => (d.partido === FORA ? "var(--sem-dado)" : corPartido(d.partido)))
    .attr("class", (d) => (destaque && d.partido !== destaque ? "apagado" : null))
    .append("title").text((d) => (d.partido === FORA ? "Fora de disputa em 2026" : d.partido));
  if (!reduzMovimento()) {
    svg.selectAll("circle").transition().delay((d, i) => 150 + i * Math.min(3, 900 / N)).duration(380)
      .ease(d3.easeBackOut.overshoot(2)).attr("r", raioPonto);
  }
  svg.append("text").attr("x", W / 2).attr("y", H - 30).attr("class", "hemi-total").text(centro ?? N);
  svg.append("text").attr("x", W / 2).attr("y", H - 10).attr("class", "hemi-rot").text(rotulo);
  return svg.node();
}

// ------------------------------------------------------------------ grades nacionais
function gradeUFs(cargo, ir, destaque, lista = Object.keys(UFS)) {
  const ufs = [...lista].sort((a, b) => UFS[a][0].localeCompare(UFS[b][0]));
  return el("div", { class: "grade-uf" }, ufs.map((uf, i) => {
    const b = bloco(cargo, uf);
    const lideres = cargo === 5
      ? b.candidatos.filter((c) => c.situacao === "eleito")
      : b.candidatos.filter((c) => c.situacao === "eleito" || c.situacao === "2t").slice(0, 2);
    const apagado = destaque && !lideres.some((c) => c.partido === destaque);
    return el("button", {
      class: `tile ${apagado ? "apagado" : ""}`, type: "button", style: { "--i": i },
      onclick: () => ir({ uf }), title: `Ver ${UFS[uf][0]}`,
    },
    el("span", { class: "tile-uf" }, uf.toUpperCase()),
    el("div", { class: "tile-cands" }, lideres.map((c) => el("div", { class: "tile-cand" },
      avatar(c, "sm"),
      el("div", {}, el("span", { class: "tile-nome" }, c.nome),
        el("span", { class: "tile-meta" }, chip(c.partido), ` ${pct(c.pct)}`))))),
    cargo === 3 ? el("span", { class: `tile-sit ${lideres[0]?.situacao}` },
      lideres[0]?.situacao === "eleito" ? "Eleito" : "2º turno") : null);
  }));
}

function vitorias(cargo) {
  // Em quantos estados e municípios cada candidato ficou em 1º
  const br = bloco(1, "br").candidatos.slice(0, 4);
  const ufs = {}, muns = {};
  for (const uf of Object.keys(UFS)) {
    const v = vencedorUF(1, uf);
    ufs[v.n] = (ufs[v.n] || 0) + 1;
  }
  for (const v of db.vencedores[1].values()) muns[v.n] = (muns[v.n] || 0) + 1;
  const totalMun = db.vencedores[1].size;
  return el("div", { class: "vitorias" }, br.filter((c) => ufs[c.n] || muns[c.n]).map((c, i) =>
    el("div", { class: "vit", style: { "--i": i, "--c": corPartido(c.partido) } },
      avatar(c, "sm"),
      el("div", { class: "vit-txt" }, el("strong", {}, c.nome), chip(c.partido)),
      el("div", { class: "vit-num" }, el("strong", {}, numero(ufs[c.n] || 0)), el("span", {}, "estados")),
      el("div", { class: "vit-num" }, el("strong", {}, numero(muns[c.n] || 0)),
        el("span", {}, `municípios (${pct(((muns[c.n] || 0) / totalMun) * 100)})`)))));
}

// ------------------------------------------------------------------ deputados
function cardEleitos(eleitos, destaque) {
  const lista = destaque ? eleitos.filter((c) => c.partido === destaque) : eleitos;
  const grade = el("div", { class: "eleitos" });
  const LIM = 24;
  const mostrar = (n) => grade.replaceChildren(...lista.slice(0, n).map((c, i) =>
    el("div", { class: "eleito", style: { "--i": i }, title: c.nomeCompleto },
      avatar(c, "sm"),
      el("div", {}, el("span", { class: "tile-nome" }, c.nome),
        el("span", { class: "tile-meta" }, chip(c.partido), ` ${compacto(c.votos)} votos`)))));
  mostrar(LIM);
  const out = [grade];
  if (lista.length > LIM) {
    const b = el("button", { class: "mais", type: "button" }, `Ver todos os ${lista.length} eleitos`);
    b.onclick = () => { mostrar(lista.length); b.remove(); };
    out.push(b);
  }
  return out;
}

function buscaCandidatos(lista, destaque) {
  const resultado = el("ol", { class: "busca-res" });
  const input = el("input", {
    type: "search", class: "busca", placeholder: `Buscar entre ${int(lista.length)} candidatos (nome ou número)`,
    "aria-label": "Buscar candidato",
  });
  const render = () => {
    const q = semAcento(input.value.trim());
    let r = lista;
    if (q) r = lista.filter((c) => semAcento(c.nome).includes(q) || semAcento(c.nomeCompleto).includes(q) || String(c.n).startsWith(q));
    if (destaque) r = r.filter((c) => c.partido === destaque);
    resultado.replaceChildren(...r.slice(0, 15).map((c, i) => el("li", { class: "br-linha" },
      el("span", { class: "br-pos" }, `${lista.indexOf(c) + 1}º`),
      el("span", { class: "br-nome" }, c.nome, el("small", {}, ` ${c.n}`)),
      chip(c.partido),
      el("span", { class: `br-sit ${c.situacao}` }, { eleito: "Eleito", suplente: "Suplente", nao: "Não eleito" }[c.situacao] || ""),
      el("span", { class: "br-votos" }, int(c.votos)))));
  };
  input.addEventListener("input", render);
  render();
  return [input, resultado];
}

// ------------------------------------------------------------------ destaque de partido
function cardPartido(estado) {
  const { cargo, uf, mun, partido } = estado;
  const info = db.resumo.partidos[partido];
  let fatia, extra = null;
  const { reg } = estado;
  if (mun) fatia = fatiaPartidoMun(cargo, mun, partido);
  else if (!uf && reg) fatia = fatiaPartidoRegiao(cargo, reg, partido);
  else if (!uf && cargo !== 1) fatia = null;   // Brasil nos cargos estaduais: ver cadeiras/eleitos
  else fatia = fatiaPartidoUF(cargo, uf || "br", partido);
  if (!cargoInfo(cargo).majoritario && !mun) {
    const n = db.resumo.nacional;
    const cad = uf ? bloco(cargo, uf).partidos.find((p) => p.partido === partido)?.cadeiras || 0
      : reg ? blocoRegiao(cargo, reg).partidos.find((p) => p.partido === partido)?.cadeiras || 0
        : (cargo === 6 ? n.camara : n.assembleias)[partido] || 0;
    extra = el("div", { class: "pc-num" }, el("strong", {}, numero(cad)), el("span", {}, "cadeiras"));
  }
  return el("div", { class: "card-partido", style: { "--c": corPartido(partido) } },
    el("div", { class: "pc-id" }, el("span", { class: "pc-sg" }, partido),
      el("span", { class: "pc-nome" }, `${info?.nome ?? ""} · ${info?.numero ?? ""}`)),
    fatia != null ? el("div", { class: "pc-num" }, el("strong", {}, numero(fatia, pct)), el("span", {}, "dos votos válidos")) : null,
    extra);
}

// ------------------------------------------------------------------ senado
/**
 * Hemiciclo do Senado: 3 cadeiras por UF, das quais 2 foram renovadas em 2026.
 * As que não estavam em disputa (eleitas em 2022) aparecem em cinza — não estão nestes dados.
 */
function secaoSenado(eleitosPorPartido, totalCadeiras, destaque, titulo) {
  const lista = Object.entries(eleitosPorPartido).map(([partido, cadeiras]) => ({ partido, cadeiras }))
    .sort((a, b) => b.cadeiras - a.cadeiras);
  const eleitos = d3.sum(lista, (l) => l.cadeiras);
  const fora = totalCadeiras - eleitos;
  return secao(titulo, `${eleitos} cadeiras renovadas em 2026 · ${fora} fora de disputa`,
    hemiciclo([...lista, { partido: FORA, cadeiras: fora }],
      { destaque, titulo, centro: eleitos, rotulo: `eleitos de ${totalCadeiras}` }),
    el("p", { class: "hemi-nota" }, el("i", {}), "Em cinza: cadeiras de senadores eleitos em 2022, com mandato até 2031"));
}

// ------------------------------------------------------------------ regiões
/** Uma linha por região: líder, % e mini-barra das 3 maiores fatias. */
function porRegiao(cargo, ir, destaque) {
  return el("div", { class: "regioes" }, Object.entries(REGIOES).map(([r, { nome, ufs }], i) => {
    const b = blocoRegiao(cargo, r);
    const fatias = b.candidatos
      ? b.candidatos.slice(0, 3).map((c) => ({ partido: c.partido, rot: c.nome, pct: c.pct }))
      : b.partidos.slice(0, 3).map((p) => ({ partido: p.partido, rot: p.partido, pct: p.pct ?? (p.votos / b.totais.validos) * 100, cadeiras: p.cadeiras, eleitos: p.eleitos }));
    const l = fatias[0];
    const detalhe = l.cadeiras != null ? `${l.cadeiras} de ${b.vagas} cadeiras`
      : l.eleitos != null ? `${l.eleitos} eleito${l.eleitos === 1 ? "" : "s"} · ${pct(l.pct)} dos votos` : pct(l.pct);
    const apagado = destaque && !fatias.some((f) => f.partido === destaque);
    return el("button", { type: "button", class: `reg ${apagado ? "apagado" : ""}`, style: { "--i": i }, onclick: () => ir({ reg: r }) },
      el("div", { class: "reg-topo" },
        el("strong", {}, nome), el("span", { class: "reg-ufs" }, ufs.map((u) => u.toUpperCase()).join(" · "))),
      el("div", { class: "reg-lider" }, chip(l.partido), el("span", { class: "reg-nome" }, l.rot === l.partido ? "" : l.rot),
        el("span", { class: "reg-det" }, detalhe)),
      el("div", { class: "reg-barra" }, fatias.map((f) => el("i", { style: { "--c": corPartido(f.partido), "--w": `${f.pct}%` }, title: `${f.partido} ${pct(f.pct)}` }))));
  }));
}

function painelRegiao(cargo, reg, partido, acoes) {
  const b = blocoRegiao(cargo, reg);
  const nome = REGIOES[reg].nome;
  const info = cargoInfo(cargo);
  const out = [];
  if (cargo === 1) {
    out.push(secao(`Presidente · ${nome}`, `${int(b.totais.validos)} votos válidos`, ...listaCandidatos(b.candidatos, { destaque: partido })));
    out.push(secao("Estado por estado", "Toque para abrir o estado", gradeUFs(1, acoes.ir, partido, b.ufs)));
  } else if (cargo === 3 || cargo === 5) {
    const eleitos = b.partidos.filter((p) => p.eleitos > 0);
    if (cargo === 5) {
      const cad = Object.fromEntries(eleitos.map((p) => [p.partido, p.eleitos]));
      out.push(secaoSenado(cad, b.ufs.length * 3, partido, `Senadores da região ${nome}`));
    }
    const titulo = cargo === 3 ? "Governadores eleitos no 1º turno" : "Senadores eleitos";
    const segundo = d3.sum(b.partidos, (p) => p.segundoTurno) / 2;
    out.push(secao(titulo, cargo === 3 ? `${d3.sum(eleitos, (p) => p.eleitos)} eleitos · ${segundo} com 2º turno` : `${d3.sum(eleitos, (p) => p.eleitos)} cadeiras`,
      barrasPartido(eleitos.map((p) => ({ partido: p.partido, valor: p.eleitos })), { destaque: partido, onClick: acoes.filtrarPartido })));
    out.push(secao("Estado por estado", "Toque para abrir o estado", gradeUFs(cargo, acoes.ir, partido, b.ufs)));
    out.push(secao("Votos por partido", `${info.nome} · soma dos estados da região`,
      barrasPartido(b.partidos.slice(0, 10).map((p) => ({ ...p, valor: p.votos })),
        { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => pct(l.pct) })));
  } else {
    const titulo = cargo === 6 ? `Bancada da região ${nome} na Câmara` : `Assembleias da região ${nome}`;
    out.push(secao(titulo, `${b.vagas} cadeiras · soma de ${b.ufs.length} estados`,
      hemiciclo(b.partidos, { destaque: partido, titulo }),
      barrasPartido(b.partidos.filter((p) => p.cadeiras > 0).map((p) => ({ ...p, valor: p.cadeiras })),
        { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => `${l.cadeiras} · ${pct((l.votos / b.totais.validos) * 100)}` })));
    out.push(secao("Deputados eleitos", partido ? `Filtrado: ${partido}` : "Os mais votados da região", ...cardEleitos(b.eleitos, partido)));
  }
  return out;
}

// ------------------------------------------------------------------ montagem
export async function montarPainel(alvo, estado, acoes) {
  const { cargo, uf, mun, partido } = estado;
  const info = cargoInfo(cargo);
  const blocos = [];

  if (partido) blocos.push(cardPartido(estado));

  if (estado.reg && !uf) {
    blocos.push(...painelRegiao(cargo, estado.reg, partido, acoes));
  } else if (info.majoritario) {
    if (mun) {
      const r = resultadoMun(cargo, mun);
      if (r) blocos.push(secao(`${info.nome} em ${db.municipios[mun][0]}`, `${int(r.total)} votos válidos`,
        ...listaCandidatos(r.linhas, { destaque: partido })));
    } else {
      const b = bloco(cargo, uf || "br");
      const sub = cargo === 5 ? `${b.vagas} vaga${b.vagas > 1 ? "s" : ""} · cada eleitor votou em até 2 candidatos`
        : `${int(b.totais.validos)} votos válidos`;
      if (b.candidatos) blocos.push(secao(uf ? `${info.nome} · ${UFS[uf][0]}` : `${info.nome} · Brasil`, sub,
        ...listaCandidatos(b.candidatos, { destaque: partido })));
      if (cargo === 5 && !uf) blocos.push(secaoSenado(db.resumo.nacional.senado, 81, partido, "Novo Senado Federal"));
      if (!uf) blocos.push(secao("Resultado por região", "Toque para abrir a região", porRegiao(cargo, acoes.ir, partido)));
      if (cargo === 1 && !uf) {
        blocos.push(secao("Quem venceu onde", "1º colocado por estado e por município", vitorias(cargo)));
        const zz = bloco(1, "zz");
        if (zz) blocos.push(secao("Voto no exterior", `${int(zz.totais.validos)} votos válidos · ${pct(zz.totais.pComparecimento)} de comparecimento`,
          ...listaCandidatos(zz.candidatos, { destaque: partido, limite: 3 })));
      }
      if (cargo === 3 && !uf) {
        const n = db.resumo.nacional;
        blocos.push(secao("Governadores eleitos no 1º turno", `${d3.sum(Object.values(n.governadoresEleitos))} eleitos · ${n.governadoresSegundoTurno.length} estados com 2º turno`,
          barrasPartido(Object.entries(n.governadoresEleitos).map(([p, v]) => ({ partido: p, valor: v })),
            { destaque: partido, onClick: acoes.filtrarPartido })));
        blocos.push(secao("Estado por estado", "Toque para ver o detalhe", gradeUFs(3, acoes.ir, partido)));
      }
      if (cargo === 5 && !uf) {
        const n = db.resumo.nacional;
        blocos.push(secao("Senadores eleitos", `${d3.sum(Object.values(n.senado))} cadeiras renovadas (2/3 do Senado)`,
          barrasPartido(Object.entries(n.senado).map(([p, v]) => ({ partido: p, valor: v })),
            { destaque: partido, onClick: acoes.filtrarPartido })));
        blocos.push(secao("Eleitos por estado", "Toque para ver o detalhe", gradeUFs(5, acoes.ir, partido)));
      }
    }
  } else if (!uf) {
    // Visão nacional dos deputados
    const n = db.resumo.nacional;
    const cad = cargo === 6 ? n.camara : n.assembleias;
    const votos = cargo === 6 ? n.votosCamara : n.votosAssembleias;
    const lista = Object.entries(cad).map(([p, c]) => ({ partido: p, cadeiras: c }));
    const total = d3.sum(lista, (l) => l.cadeiras);
    const tituloComp = cargo === 6 ? "Nova Câmara dos Deputados" : "Assembleias Legislativas (soma das 27)";
    blocos.push(secao(tituloComp, `${total} cadeiras · eleitos no 1º turno`,
      hemiciclo(lista, { destaque: partido, titulo: tituloComp }),
      barrasPartido(lista.map((l) => ({ ...l, valor: l.cadeiras, votos: votos[l.partido] })),
        { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => `${l.cadeiras}` })));
    blocos.push(secao("Resultado por região", "Toque para abrir a região", porRegiao(cargo, acoes.ir, partido)));
    const totalVotos = d3.sum(Object.values(votos));
    blocos.push(secao("Votos por partido", "Nominais + legenda, soma de todas as UFs",
      barrasPartido(Object.entries(votos).slice(0, 15).map(([p, v]) => ({ partido: p, valor: v })),
        { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => pct((l.valor / totalVotos) * 100) })));
  } else {
    const det = await garantirUF(uf);
    const chaveDet = uf === "df" && cargo === 7 ? "8" : String(cargo);
    const b = bloco(cargo, uf);
    const nomeCargo = uf === "df" && cargo === 7 ? "Deputado Distrital" : info.nome;
    if (mun) {
      const r = resultadoMun(cargo, mun);
      if (r) {
        blocos.push(secao(`Votos por partido em ${db.municipios[mun][0]}`, `${int(r.total)} votos nominais`,
          barrasPartido(r.linhas.slice(0, 12).map((l) => ({ ...l, valor: l.votos })),
            { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => pct(l.pct) })));
        if (r.top) blocos.push(secao("Mais votados no município", nomeCargo,
          el("ol", { class: "cands" }, r.top.map((c, i) => linhaCandidato(
            { ...c, pct: c.pctMun, votos: c.votosMun }, i, { destaque: partido, max: r.top[0].pctMun })))));
      }
    } else {
      blocos.push(secao(`Bancada eleita · ${nomeCargo}`, `${b.vagas} vagas · quociente eleitoral ${int(b.qe)} votos`,
        hemiciclo(b.partidos, { destaque: partido, titulo: nomeCargo }),
        barrasPartido(b.partidos.filter((p) => p.cadeiras > 0).map((p) => ({ ...p, valor: p.cadeiras })),
          { destaque: partido, onClick: acoes.filtrarPartido, rotuloValor: (l) => `${l.cadeiras} · ${pct((l.votos / b.totais.validos) * 100)}` })));
      blocos.push(secao("Deputados eleitos", partido ? `Filtrado: ${partido}` : "Ordenados por votação",
        ...cardEleitos(b.eleitos, partido)));
      blocos.push(secao("Todos os candidatos", "Busca na lista completa da UF",
        ...buscaCandidatos(det[chaveDet] || [], partido)));
    }
  }

  blocos.forEach((b, i) => { b.classList.add("entra"); b.style.setProperty("--d", `${i * 70}ms`); });
  alvo.replaceChildren(...blocos);
}

// ------------------------------------------------------------------ modo ranking
const PASSO_RANKING = 30;
const SIT_RANK = { eleito: "Eleito", "2t": "2º turno", suplente: "Suplente" };
// "votos" (absoluto) ou "pct" (% dentro da própria UF) — lembrado entre trocas de cargo/nível
let ordemRanking = "votos";

/** Lista do mais ao menos votado no escopo atual, com busca e paginação. */
export async function montarRanking(alvo, estado, { titulo, busca: buscaInicial = null }) {
  const { cargo, uf, reg, mun, partido } = estado;
  alvo.replaceChildren(el("p", { class: "card-sub" }, "Montando o ranking…"));
  const { itens: brutos, parcial } = await rankingEscopo(cargo, { reg, uf, mun });
  // Ao misturar UFs, voto absoluto favorece estados grandes; % na UF compara o desempenho
  const multiUF = !uf && !(cargo === 1);
  const porPct = multiUF && ordemRanking === "pct";
  const itens = porPct ? [...brutos].sort((a, b) => b.pct - a.pct || b.votos - a.votos) : brutos;
  const posicao = new Map(itens.map((c, i) => [c, i + 1]));   // posição geral, mesmo filtrando
  const max = (porPct ? itens[0]?.pct : itens[0]?.votos) || 1;

  const lista = el("ol", { class: "rank" });
  const busca = el("input", {
    type: "search", class: "busca", "aria-label": "Buscar no ranking",
    placeholder: `Buscar entre ${int(itens.length)} candidatos`,
  });
  const contador = el("p", { class: "rank-cont" });
  const mais = el("button", { class: "mais", type: "button" });
  let filtrados = [], mostrando = 0;

  const linha = (c, i) => {
    const sit = SIT_RANK[c.situacao];
    return el("li", { class: "rank-item", style: { "--i": i % PASSO_RANKING } },
      el("span", { class: `rank-pos ${posicao.get(c) <= 3 ? "podio" : ""}` }, `${posicao.get(c)}º`),
      avatar(c, "sm"),
      el("div", { class: "rank-info" },
        el("div", { class: "rank-topo" },
          el("span", { class: "rank-nome", title: c.nomeCompleto || c.nome }, c.nome),
          sit ? el("span", { class: `badge ${c.situacao === "eleito" ? "badge-eleito" : c.situacao === "2t" ? "badge-2t" : "badge-neutro"}` }, sit) : null),
        el("div", { class: "cand-meta" }, chip(c.partido),
          multiUF && c.uf ? el("span", { class: "rank-uf" }, c.uf.toUpperCase()) : null,
          el("span", { class: "num" }, c.n)),
        barra(porPct ? c.pct : c.votos, max, corPartido(c.partido))),
      porPct
        ? el("div", { class: "cand-num" }, el("strong", {}, pct(c.pct)), el("span", {}, `${int(c.votos)} votos`))
        : el("div", { class: "cand-num" }, el("strong", {}, int(c.votos)),
          el("span", {}, `${pct(c.pct)}${multiUF ? " na UF" : ""}`)));
  };

  const mostrar = (n) => {
    lista.append(...filtrados.slice(mostrando, n).map((c, i) => linha(c, mostrando + i)));
    mostrando = Math.min(n, filtrados.length);
    const resta = filtrados.length - mostrando;
    mais.hidden = resta <= 0;
    mais.textContent = `Ver mais ${Math.min(PASSO_RANKING, resta)} (restam ${int(resta)})`;
    contador.textContent = `${int(filtrados.length)} candidato${filtrados.length === 1 ? "" : "s"}${partido ? ` do ${partido}` : ""}`
      + (parcial ? " · só os 5 mais votados do município estão disponíveis" : "");
  };
  const filtrar = () => {
    const q = semAcento(busca.value.trim());
    filtrados = itens.filter((c) => (!partido || c.partido === partido)
      && (!q || semAcento(c.nome).includes(q) || semAcento(c.nomeCompleto || "").includes(q) || String(c.n).startsWith(q)));
    lista.replaceChildren();
    mostrando = 0;
    mostrar(PASSO_RANKING);
  };
  mais.onclick = () => mostrar(mostrando + PASSO_RANKING);
  busca.addEventListener("input", filtrar);
  if (buscaInicial) busca.value = buscaInicial;
  filtrar();

  let ordem = null;
  if (multiUF) {
    const botao = (valor, rot) => el("button", {
      type: "button", "aria-pressed": String(ordemRanking === valor),
      onclick: () => { if (ordemRanking !== valor) { ordemRanking = valor; montarRanking(alvo, estado, { titulo, busca: busca.value }); } },
    }, rot);
    ordem = el("div", { class: "rank-ordem" },
      el("span", { class: "rot" }, "Ordenar por"),
      el("div", { class: "seg seg-ordem", role: "group", "aria-label": "Ordenar ranking" },
        botao("votos", "Total de votos"), botao("pct", "% na própria UF")),
      el("p", { class: "rank-nota" }, porPct
        ? "Compara o desempenho de cada candidato no seu estado, independente do tamanho do eleitorado."
        : "Estados com mais eleitores (SP, MG, RJ) tendem a liderar em votos absolutos. Use “% na própria UF” para comparar desempenho."));
  }
  const sub = multiUF ? `Todas as ${uf ? "" : reg ? "UFs da região" : "27 UFs"} · ${porPct ? "por % na UF" : "por total de votos"}` : "Por total de votos";
  const sec = secao(titulo, sub, ordem, busca, contador, lista, mais);
  sec.classList.add("entra");
  alvo.replaceChildren(sec);
}
