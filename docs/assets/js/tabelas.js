import { corPartido } from "./cores.js";
import { db, bloco } from "./dados.js";
import { carregar, el, int, pct, semAcento, UFS, REGIOES, cargoInfo } from "./util.js";

const MAX_COLUNAS = { maj: 6, prop: 8 };
const ordem = { col: "zona", desc: false };
let linhasAtuais = [], colunasAtuais = [];

/** Colunas (candidatos ou partidos) e linhas (zona x município) para o cargo/UF. */
async function preparar(cargo, uf) {
  const dados = await carregar(`data/zonas/${uf}.json`);
  const bruto = dados[String(cargo)];
  if (!bruto) return null;
  const maj = cargoInfo(cargo).majoritario;
  const numPartido = Object.fromEntries(Object.entries(db.resumo.partidos).map(([sg, p]) => [p.numero, sg]));

  let colunas;
  if (maj) {
    const cands = bloco(cargo, uf).candidatos.filter((c) => c.valido !== false);
    colunas = cands.slice(0, MAX_COLUNAS.maj).map((c) => ({ chave: c.n, rot: c.nome, partido: c.partido }));
  } else {
    const b = bloco(cargo, uf);
    colunas = b.partidos.slice(0, MAX_COLUNAS.prop).map((p) => ({ chave: p.partido, rot: p.partido, partido: p.partido }));
  }
  const chaves = new Set(colunas.map((c) => c.chave));

  const linhas = bruto.zonas.map(([zona, ibge, pares]) => {
    const votos = {};
    let total = 0, outros = 0, lider = null, maxV = -1;
    for (let i = 0; i < pares.length; i += 2) {
      const chave = maj ? pares[i] : numPartido[bruto.partidosNumero[pares[i]]];
      const v = pares[i + 1];
      total += v;
      if (v > maxV) { maxV = v; lider = chave; }
      if (chaves.has(chave)) votos[chave] = (votos[chave] || 0) + v;
      else outros += v;
    }
    const [nome] = db.municipios[ibge] || [String(ibge)];
    return { zona, ibge, municipio: nome, total, votos, outros, lider, busca: semAcento(`${zona} ${nome}`) };
  });
  return { colunas, linhas, maj };
}

function ordenar(linhas) {
  const { col, desc } = ordem;
  const valor = (l) => (col === "zona" ? l.zona : col === "municipio" ? l.municipio
    : col === "total" ? l.total : col === "outros" ? l.outros : l.votos[col] || 0);
  return [...linhas].sort((a, b) => {
    const va = valor(a), vb = valor(b);
    const r = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return (desc ? -r : r) || a.zona - b.zona;
  });
}

function desenharTabela(alvo, colunas, linhas, rerender) {
  const th = (rot, col, conteudo) => el("th", {
    scope: "col", "aria-sort": ordem.col === col ? (ordem.desc ? "descending" : "ascending") : null,
    onclick: () => {
      if (ordem.col === col) ordem.desc = !ordem.desc;
      else { ordem.col = col; ordem.desc = !["zona", "municipio"].includes(col); }
      rerender();
    },
  }, conteudo || rot);

  const cab = el("tr", {},
    th("Zona", "zona"), th("Município", "municipio"), th("Votos válidos", "total"),
    colunas.map((c) => th(c.rot, c.chave, el("span", { class: "th-cand" },
      el("span", { class: "chip", style: { "--c": corPartido(c.partido) } }, c.partido),
      c.rot !== c.partido ? c.rot : ""))),
    th("Outros", "outros"));

  const corpo = linhas.map((l) => el("tr", {},
    el("td", {}, String(l.zona).padStart(4, "0")),
    el("td", {}, l.municipio),
    el("td", {}, int(l.total)),
    colunas.map((c) => {
      const v = l.votos[c.chave] || 0;
      const lider = l.lider === c.chave;
      return el("td", { class: lider ? "lider" : null, style: lider ? { "--c": corPartido(c.partido) } : null },
        int(v), el("span", { class: "pc" }, l.total ? pct((v / l.total) * 100) : "—"));
    }),
    el("td", {}, int(l.outros), el("span", { class: "pc" }, l.total ? pct((l.outros / l.total) * 100) : "—"))));

  alvo.replaceChildren(el("table", { class: "tabela" }, el("thead", {}, cab), el("tbody", {}, corpo)));
}

export async function montarTabelas(estado) {
  const { cargo } = estado;
  // tabela é sempre de uma UF; na região, abre a de maior eleitorado
  const uf = estado.uf || (estado.reg ? REGIOES[estado.reg].ufs.reduce((m, u) => (bloco(1, u).totais.eleitorado > bloco(1, m).totais.eleitorado ? u : m)) : "sp");
  const info = cargoInfo(cargo);
  const corpo = document.querySelector("#tabela-corpo");
  const sub = document.querySelector("#tabela-sub");
  const selUF = document.querySelector("#tab-uf");
  const selMun = document.querySelector("#tab-mun");
  const busca = document.querySelector("#tab-busca");

  if (!selUF.options.length) {
    selUF.replaceChildren(...Object.entries(UFS).sort((a, b) => a[1][0].localeCompare(b[1][0]))
      .map(([sg, [nome]]) => el("option", { value: sg }, nome)));
  }
  selUF.value = uf;

  const nomeCargo = uf === "df" && cargo === 7 ? "Deputado Distrital" : info.nome;
  if (estado.turno === 2) {
    // zonas vêm do CSV de dados abertos, que o TSE publica dias depois da eleição
    sub.textContent = `${info.nome} · 2º turno`;
    selMun.replaceChildren();
    corpo.replaceChildren(el("div", { class: "tabela-vazia" },
      "As tabelas por zona do 2º turno saem quando o TSE publicar os dados abertos, alguns dias após a eleição. ",
      el("br"), "Durante a apuração, acompanhe pelo Painel."));
    linhasAtuais = []; colunasAtuais = [];
    return;
  }

  corpo.replaceChildren(el("div", { class: "tabela-vazia" }, "Carregando zonas…"));
  const prep = await preparar(cargo, uf);
  if (!prep) { corpo.replaceChildren(el("div", { class: "tabela-vazia" }, "Sem dados para este cargo.")); return; }
  const { colunas, linhas } = prep;

  const munsUF = [...new Map(linhas.map((l) => [l.ibge, l.municipio])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  selMun.replaceChildren(el("option", { value: "" }, `Todos (${munsUF.length})`),
    ...munsUF.map(([ibge, nome]) => el("option", { value: ibge }, nome)));
  if (estado.mun && munsUF.some(([i]) => i === estado.mun)) selMun.value = estado.mun;

  const render = () => {
    const q = semAcento(busca.value.trim());
    let filtradas = linhas;
    if (selMun.value) filtradas = filtradas.filter((l) => l.ibge === selMun.value);
    if (q) filtradas = filtradas.filter((l) => l.busca.includes(q));
    filtradas = ordenar(filtradas);
    linhasAtuais = filtradas; colunasAtuais = colunas;
    const zonas = new Set(filtradas.map((l) => l.zona)).size;
    sub.textContent = `${nomeCargo} · ${UFS[uf][0]} · ${int(zonas)} zonas · ${int(filtradas.length)} linhas (zona × município)`;
    desenharTabela(corpo, colunas, filtradas, render);
  };
  selMun.onchange = render;
  busca.oninput = render;
  render();
}

export function baixarCSV() {
  if (!linhasAtuais.length) return;
  const cab = ["zona", "municipio", "codigo_ibge", "votos_validos", ...colunasAtuais.map((c) => c.rot), "outros"];
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const linhas = linhasAtuais.map((l) => [l.zona, l.municipio, l.ibge, l.total,
    ...colunasAtuais.map((c) => l.votos[c.chave] || 0), l.outros].map(esc).join(";"));
  const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...linhas].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: "eleicoes2026_zonas.csv" });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
