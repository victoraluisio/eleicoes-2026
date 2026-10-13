import { Mapa } from "./mapa.js";
import { corPartido, intensidade } from "./cores.js";
import {
  db, carregarBase, garantirCargo, garantirUF, resultadoMun, fatiaPartidoMun, ufDoMun, partidosOrdenados, bloco,
  blocoRegiao, fatiaPartidoRegiao, fatiaPartidoUF, rankingEscopo,
} from "./dados.js";
import { montarPainel, montarKPIs, montarRanking } from "./painel.js";
import { montarTabelas, baixarCSV } from "./tabelas.js";
import { CARGOS, UFS, REGIOES, REGIAO_DA_UF, cargoInfo, el, int, pct, compacto, semAcento } from "./util.js";

// ------------------------------------------------------------------ estado + URL
const estado = { cargo: 1, reg: null, uf: null, mun: null, partido: null, modo: "vencedor", vista: "painel", painel: "resumo" };

function lerURL() {
  const q = new URLSearchParams(location.hash.slice(1));
  const cargo = +q.get("cargo");
  estado.cargo = CARGOS.some((c) => c.id === cargo) ? cargo : 1;
  estado.uf = UFS[q.get("uf")] ? q.get("uf") : null;
  estado.reg = estado.uf ? REGIAO_DA_UF[estado.uf] : REGIOES[q.get("reg")] ? q.get("reg") : null;
  estado.mun = estado.uf && db.municipios[q.get("mun")] && ufDoMun(q.get("mun")) === estado.uf ? q.get("mun") : null;
  estado.partido = db.resumo.partidos[q.get("p")] ? q.get("p") : null;
  estado.modo = q.get("modo") === "abstencao" ? "abstencao" : "vencedor";
  estado.vista = q.get("vista") === "tabelas" ? "tabelas" : "painel";
  estado.painel = q.get("painel") === "rank" ? "rank" : "resumo";
}

function escreverURL() {
  const q = new URLSearchParams();
  q.set("cargo", estado.cargo);
  if (estado.reg && !estado.uf) q.set("reg", estado.reg);
  if (estado.uf) q.set("uf", estado.uf);
  if (estado.mun) q.set("mun", estado.mun);
  if (estado.partido) q.set("p", estado.partido);
  if (estado.modo !== "vencedor") q.set("modo", estado.modo);
  if (estado.vista !== "painel") q.set("vista", estado.vista);
  if (estado.painel === "rank") q.set("painel", "rank");
  history.replaceState(null, "", `#${q}`);
}

// Faixa de % do vencedor mapeada para a intensidade da cor, por cargo
const FAIXA = { 1: [35, 75], 3: [30, 75], 5: [18, 50], 6: [8, 40], 7: [8, 40] };

const $ = (s) => document.querySelector(s);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

let mapa;
let primeiraPintura = true;

// escopo atual (Brasil, região ou UF) — o que o mapa destaca e os números resumem
const noEscopo = (ibge) => {
  const u = ufDoMun(ibge);
  return estado.uf ? u === estado.uf : estado.reg ? REGIAO_DA_UF[u] === estado.reg : true;
};
const ondeTxt = () => (estado.uf ? UFS[estado.uf][0] : estado.reg ? REGIOES[estado.reg].nome : "Brasil");
const blocoEscopo = (cargo) => (estado.uf ? bloco(cargo, estado.uf) : estado.reg ? blocoRegiao(cargo, estado.reg) : bloco(cargo, "br"));
const escalaPartido = { max: 50 };

// ------------------------------------------------------------------ navegação
async function ir(mudancas = {}) {
  const antes = { ...estado };
  Object.assign(estado, mudancas);
  // hierarquia: escolher UF fixa a região; trocar de região limpa UF e município
  if ("reg" in mudancas && mudancas.reg !== antes.reg && !("uf" in mudancas)) { estado.uf = null; estado.mun = null; }
  if ("uf" in mudancas && mudancas.uf !== antes.uf && !("mun" in mudancas)) estado.mun = null;
  if (estado.uf) estado.reg = REGIAO_DA_UF[estado.uf];
  escreverURL();
  atualizarControles();
  tip().classList.remove("visivel");

  $("#vista-painel").hidden = estado.vista !== "painel";
  $("#vista-tabelas").hidden = estado.vista !== "tabelas";
  if (estado.vista === "tabelas") { await montarTabelas(estado); return; }

  document.body.classList.add("carregando");
  await garantirCargo(estado.cargo);
  if (estado.uf) await garantirUF(estado.uf);
  document.body.classList.remove("carregando");

  const mudouLugar = estado.reg !== antes.reg || estado.uf !== antes.uf || estado.mun !== antes.mun || antes.vista !== "painel";
  if (mudouLugar || primeiraPintura) mapa.focar(estado.reg, estado.uf, estado.mun);
  const mudouMapa = mudouLugar || primeiraPintura || estado.cargo !== antes.cargo
    || estado.partido !== antes.partido || estado.modo !== antes.modo;
  if (mudouMapa) pintarMapa();
  montarKPIs($("#kpis"), estado);
  await atualizarPainel();
}

function subir() {
  if (estado.mun) ir({ mun: null });
  else if (estado.uf) ir({ uf: null });
  else if (estado.reg) ir({ reg: null });
}

// ------------------------------------------------------------------ mapa
function corDoMun(ibge) {
  const { cargo, partido, modo } = estado;
  const sup = css("--superficie-mapa");
  if (modo === "abstencao" && !partido) {
    const p = db.participacao[ibge];
    if (!p) return null;
    const t = ((p[2] / p[0]) * 100 - 10) / 30;
    return d3.interpolateLab(sup, css("--seq-forte"))(0.12 + 0.88 * Math.max(0, Math.min(1, t)));
  }
  if (partido) {
    const s = fatiaPartidoMun(cargo, ibge, partido);
    if (s == null) return null;
    return d3.interpolateLab(sup, corPartido(partido))(s <= 0 ? 0.06 : 0.14 + 0.86 * Math.min(1, s / escalaPartido.max));
  }
  const v = db.vencedores[cargo].get(ibge);
  if (!v) return null;
  const [lo, hi] = FAIXA[cargo];
  return intensidade(corPartido(v.partido), (v.pct - lo) / (hi - lo), sup);
}

function pintarMapa() {
  const { cargo, partido } = estado;
  if (partido) {
    // máximo robusto (p95) entre os municípios do escopo
    const valores = [];
    for (const ibge of db.vencedores[cargo].keys()) {
      if (!noEscopo(ibge)) continue;
      valores.push(fatiaPartidoMun(cargo, ibge, partido));
    }
    escalaPartido.max = Math.max(1, d3.quantile(valores.filter((v) => v > 0).sort(d3.ascending), 0.95) || 1);
  }
  mapa.colorir(corDoMun, { varredura: primeiraPintura });
  primeiraPintura = false;
  desenharLegenda();
}

function desenharLegenda() {
  const { cargo, partido, modo, uf } = estado;
  const leg = $("#legenda");
  const sup = css("--superficie-mapa");
  const gradiente = (cor, ini = 0.12) => `linear-gradient(90deg, ${d3.range(0, 1.01, 0.1)
    .map((t) => d3.interpolateLab(sup, cor)(ini + (1 - ini) * t)).join(",")})`;
  const titulo = $("#mapa-titulo"), sub = $("#mapa-sub");
  const onde = ondeTxt();

  if (partido) {
    titulo.textContent = `Força do ${partido}`;
    sub.textContent = `% dos votos válidos por município · ${onde}`;
    leg.replaceChildren(
      el("span", { class: "leg-tit" }, `${partido} · ${db.resumo.partidos[partido].nome}`,
        el("small", {}, "Quanto mais escuro, maior a votação")),
      el("div", { class: "leg-grad", style: { background: gradiente(corPartido(partido), 0.14) } }),
      el("div", { class: "leg-esc" }, el("span", {}, "0%"), el("span", {}, `${pct(escalaPartido.max)}+`)),
      el("button", { class: "mais", type: "button", onclick: () => ir({ partido: null }) }, "Limpar filtro de partido"));
    return;
  }
  if (modo === "abstencao") {
    titulo.textContent = "Abstenção por município";
    sub.textContent = `% do eleitorado que não votou · ${onde}`;
    leg.replaceChildren(
      el("span", { class: "leg-tit" }, "Abstenção", el("small", {}, "Percentual do eleitorado")),
      el("div", { class: "leg-grad", style: { background: gradiente(css("--seq-forte")) } }),
      el("div", { class: "leg-esc" }, el("span", {}, "≤10%"), el("span", {}, "25%"), el("span", {}, "≥40%")));
    return;
  }
  const info = cargoInfo(cargo);
  titulo.textContent = info.majoritario ? "Mais votado por município" : "Partido mais votado por município";
  sub.textContent = `${uf === "df" && cargo === 7 ? "Deputado Distrital" : info.nome} · ${onde}`;
  const cont = new Map();
  for (const [ibge, v] of db.vencedores[cargo]) {
    if (!noEscopo(ibge)) continue;
    cont.set(v.partido, (cont.get(v.partido) || 0) + 1);
  }
  const itens = [...cont].sort((a, b) => b[1] - a[1]);
  const total = d3.sum(itens, (d) => d[1]);
  const [lo, hi] = FAIXA[cargo];
  leg.replaceChildren(
    el("span", { class: "leg-tit" }, "Municípios vencidos", el("small", {}, `${int(total)} municípios · toque para filtrar`)),
    el("ul", { class: "leg-itens" }, itens.slice(0, 12).map(([p, n]) => el("li", {
      class: "leg-item", title: `Filtrar por ${p}`, onclick: () => ir({ partido: p }),
    }, el("i", { style: { background: corPartido(p) } }), p, el("span", {}, int(n))))),
    el("div", { class: "leg-int" }, el("span", {}, `${lo}%`),
      el("div", { class: "leg-grad", style: { background: gradiente(css("--tinta-2"), 0.28) } }),
      el("span", {}, `${hi}%+`)),
    el("small", { class: "card-sub", style: { marginTop: "-4px" } }, "Intensidade da cor = % do 1º colocado"));
}

// ------------------------------------------------------------------ tooltip
const tip = () => $("#tooltip");

/** Linhas do tooltip para um bloco agregado (Brasil, região ou UF). */
function linhasBloco(b) {
  if (b.candidatos) return b.candidatos.slice(0, 3).map((c) => ({ rot: c.nome, partido: c.partido, pct: c.pct }));
  return b.partidos.slice(0, 3).map((p) => ({
    partido: p.partido, pct: p.pct ?? (p.votos / b.totais.validos) * 100,
    rot: p.cadeiras != null ? `${p.cadeiras} cadeira${p.cadeiras === 1 ? "" : "s"}`
      : p.eleitos ? `${p.eleitos} eleito${p.eleitos === 1 ? "" : "s"}` : "",
  }));
}

function mostrarTooltip(ibge, ev, tipo = "mun") {
  const { cargo, partido, modo } = estado;
  const t = tip();
  const sgUF = ufDoMun(ibge);
  const reg = REGIAO_DA_UF[sgUF];
  const [nome] = db.municipios[ibge] || ["?"];
  const blocoAlvo = tipo === "reg" ? blocoRegiao(cargo, reg) : tipo === "uf" ? bloco(cargo, sgUF) : null;
  const titulo = tipo === "reg" ? `Região ${REGIOES[reg].nome}` : tipo === "uf" ? UFS[sgUF][0] : `${nome} · ${sgUF.toUpperCase()}`;
  const linhas = [];
  const linha = (rot, val) => el("div", { class: "tt-linha" }, rot, el("b", {}, val));

  if (modo === "abstencao" && !partido) {
    const p = db.participacao[ibge];
    const [abst, eleit] = blocoAlvo ? [blocoAlvo.totais.pAbstencao, blocoAlvo.totais.eleitorado] : p ? [(p[2] / p[0]) * 100, p[0]] : [null, null];
    if (abst != null) linhas.push(linha(el("span", {}, "Abstenção"), pct(abst)), linha(el("span", {}, "Eleitorado"), int(eleit)));
  } else if (partido) {
    const s = tipo === "reg" ? fatiaPartidoRegiao(cargo, reg, partido) : tipo === "uf" ? fatiaPartidoUF(cargo, sgUF, partido)
      : fatiaPartidoMun(cargo, ibge, partido);
    linhas.push(linha(el("span", { class: "chip", style: { "--c": corPartido(partido) } }, partido), s == null ? "—" : pct(s)));
  } else {
    const itens = blocoAlvo ? linhasBloco(blocoAlvo)
      : (resultadoMun(cargo, ibge)?.linhas || []).slice(0, 3).map((l) => ({ rot: l.nome || "", partido: l.partido, pct: l.pct }));
    for (const it of itens) {
      linhas.push(linha(el("span", { class: "tt-rot" }, el("span", { class: "chip", style: { "--c": corPartido(it.partido) } }, it.partido), ` ${it.rot}`), pct(it.pct)),
        el("div", { class: "tt-barra" }, el("i", { style: { width: `${Math.min(100, it.pct)}%`, background: corPartido(it.partido) } })));
    }
  }
  const dica = { reg: "Clique para abrir a região", uf: "Clique para abrir o estado", mun: "Clique para ver o município" }[tipo];
  t.replaceChildren(el("strong", { class: "tt-tit" }, titulo), ...linhas, el("span", { class: "tt-dica" }, dica));
  const caixa = $("#mapa").getBoundingClientRect();
  let x = ev.clientX - caixa.left + 16, y = ev.clientY - caixa.top + 16;
  t.classList.add("visivel");
  const { width: w, height: h } = t.getBoundingClientRect();
  if (x + w > caixa.width - 8) x = ev.clientX - caixa.left - w - 16;
  if (y + h > caixa.height - 8) y = ev.clientY - caixa.top - h - 16;
  t.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}

// Cada clique desce um nível: Brasil › região › estado › município.
// Fora do escopo atual, o clique vai para o "vizinho" do mesmo nível.
function cliqueMapa(ibge) {
  const uf = ufDoMun(ibge), reg = REGIAO_DA_UF[uf];
  if (!estado.reg || reg !== estado.reg) return ir({ reg });
  if (!estado.uf || uf !== estado.uf) return ir({ uf });
  ir({ mun: estado.mun === ibge ? null : ibge });
}

// ------------------------------------------------------------------ painel
async function atualizarPainel() {
  const { cargo, uf, mun, reg } = estado;
  const info = cargoInfo(cargo);
  const titulo = mun ? `${db.municipios[mun][0]} · ${uf.toUpperCase()}` : uf ? UFS[uf][0] : reg ? `Região ${REGIOES[reg].nome}` : "Brasil";
  const b = blocoEscopo(cargo);
  $("#painel-titulo").textContent = titulo;
  $("#painel-sub").textContent = `${uf === "df" && cargo === 7 ? "Deputado Distrital" : info.nome} · ${pct(b.totais.pApuradas)} das seções apuradas`;
  if (estado.painel === "rank") {
    const nomeCargo = uf === "df" && cargo === 7 ? "Deputado Distrital" : info.nome;
    await montarRanking($("#painel-corpo"), estado, { titulo: `Ranking · ${nomeCargo}`, busca: buscaRanking });
    buscaRanking = null;
  } else {
    await montarPainel($("#painel-corpo"), estado, { ir, filtrarPartido: (p) => ir({ partido: estado.partido === p ? null : p }) });
  }
  $("#painel").scrollTo({ top: 0, behavior: "smooth" });
}

// ------------------------------------------------------------------ busca de candidato
// Por nome (ou número), sempre dentro dos filtros ativos: escopo, cargo e partido.
let atualizarBusca = () => {};
let buscaRanking = null;   // nome a pré-preencher no ranking ao escolher um candidato

function montarBusca() {
  const input = $("#busca-mun"), lista = $("#busca-mun-lista");
  let ativo = -1, geracao = 0;
  const fechar = () => { lista.hidden = true; ativo = -1; };
  const opcoes = () => [...lista.querySelectorAll('[role="option"]')];

  const irPara = (li) => {
    input.value = ""; fechar(); input.blur();
    buscaRanking = li.dataset.nome;
    ir({ ...(li.dataset.uf ? { uf: li.dataset.uf } : {}), painel: "rank" });
  };

  const descreverFiltros = () => {
    const partes = [ondeTxt(), cargoInfo(estado.cargo).nome];
    if (estado.partido) partes.push(estado.partido);
    input.placeholder = `Nome do candidato · ${partes.join(" · ")}`;
  };

  const buscar = async () => {
    descreverFiltros();
    const q = semAcento(input.value.trim());
    if (q.length < 2) return fechar();
    const minha = ++geracao;
    const { cargo, reg, uf, partido } = estado;

    lista.replaceChildren(el("li", { class: "sug-grupo" }, "Buscando candidatos…"));
    lista.hidden = false;
    const { itens } = await rankingEscopo(cargo, { reg, uf });
    if (minha !== geracao) return;   // o usuário já digitou outra coisa
    const cands = itens.filter((c) => (!partido || c.partido === partido)
      && (semAcento(c.nome).includes(q) || semAcento(c.nomeCompleto || "").includes(q) || String(c.n).startsWith(q)))
      .slice(0, 10);

    const grupos = [];
    if (cands.length) grupos.push(el("li", { class: "sug-grupo" }, `Candidatos · ${cargoInfo(cargo).nome}${partido ? ` · ${partido}` : ""}`),
      ...cands.map((c) => el("li", { role: "option", "data-nome": c.nome, "data-uf": c.uf || "" },
        el("span", { class: "sug-cand" }, el("span", { class: "chip", style: { "--c": corPartido(c.partido) } }, c.partido), c.nome),
        el("small", {}, `${c.uf ? c.uf.toUpperCase() + " · " : ""}${compacto(c.votos)}`))));
    if (!grupos.length) grupos.push(el("li", { class: "sug-vazio" }, `Nenhum candidato a ${cargoInfo(cargo).nome.toLowerCase()} encontrado em ${ondeTxt()}${partido ? ` no ${partido}` : ""}`));
    grupos.forEach((li) => li.addEventListener("mousedown", (e) => { e.preventDefault(); if (li.getAttribute("role") === "option") irPara(li); }));
    lista.replaceChildren(...grupos);
    ativo = -1;
  };

  let espera;
  input.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(buscar, 120); });
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) buscar(); });
  input.addEventListener("keydown", (e) => {
    const itens = opcoes();
    if (e.key === "Escape") return fechar();
    if (!itens.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      ativo = (ativo + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens.forEach((li, i) => li.classList.toggle("ativo", i === ativo));
    } else if (e.key === "Enter") irPara(itens[Math.max(0, ativo)]);
  });
  input.addEventListener("blur", () => setTimeout(fechar, 150));
  // filtros mudaram com texto digitado: refaz a busca
  atualizarBusca = () => { descreverFiltros(); if (document.activeElement === input || !lista.hidden) buscar(); };
  descreverFiltros();
}

// ------------------------------------------------------------------ controles
function montarControles() {
  $("#cargos").replaceChildren(...CARGOS.map((c) => el("button", {
    type: "button", role: "tab", class: "aba", "data-cargo": c.id, onclick: () => ir({ cargo: c.id }),
  }, el("span", { class: "aba-longo" }, c.nome), el("span", { class: "aba-curto" }, c.curto))));

  const selReg = $("#sel-reg");
  selReg.replaceChildren(el("option", { value: "" }, "Brasil inteiro"),
    ...Object.entries(REGIOES).map(([r, { nome }]) => el("option", { value: r }, nome)));
  selReg.onchange = () => ir({ reg: selReg.value || null });

  const selUF = $("#sel-uf");
  selUF.replaceChildren(el("option", { value: "" }, "Todos os estados"),
    ...Object.entries(UFS).sort((a, b) => a[1][0].localeCompare(b[1][0]))
      .map(([sg, [nome]]) => el("option", { value: sg }, nome)));
  selUF.onchange = () => ir({ uf: selUF.value || null });

  const selP = $("#sel-partido");
  selP.replaceChildren(el("option", { value: "" }, "Todos os partidos"),
    ...partidosOrdenados().map((sg) => el("option", { value: sg }, `${sg} · ${db.resumo.partidos[sg].numero}`)));
  selP.onchange = () => ir({ partido: selP.value || null });

  document.querySelectorAll("[data-modo]").forEach((b) => (b.onclick = () => ir({ modo: b.dataset.modo, partido: b.dataset.modo === "abstencao" ? null : estado.partido })));
  document.querySelectorAll("[data-vista]").forEach((b) => (b.onclick = () => ir({ vista: b.dataset.vista })));
  document.querySelectorAll("[data-painel]").forEach((b) => (b.onclick = () => ir({ painel: b.dataset.painel })));

  // tabelas
  $("#tab-uf").onchange = (e) => ir({ uf: e.target.value, mun: null });
  $("#tab-csv").onclick = baixarCSV;

  montarBusca();

  $("#btn-recentrar").onclick = () => mapa.resetarZoomManual();
  $("#btn-voltar").onclick = subir;
  $("#btn-zoom-mais").onclick = () => mapa.zoomPor(1.6);
  $("#btn-zoom-menos").onclick = () => mapa.zoomPor(1 / 1.6);
  const menuTema = $("#tema-opcoes"), btnTema = $("#btn-tema");
  const abrirMenu = (abrir) => { menuTema.hidden = !abrir; btnTema.setAttribute("aria-expanded", abrir); };
  btnTema.onclick = (e) => { e.stopPropagation(); abrirMenu(menuTema.hidden); };
  menuTema.querySelectorAll("[data-tema]").forEach((b) => (b.onclick = () => { escolherTema(b.dataset.tema); abrirMenu(false); }));
  document.addEventListener("click", (e) => { if (!menuTema.hidden && !menuTema.contains(e.target)) abrirMenu(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement?.tagName !== "INPUT") subir();
  });
}

function atualizarControles() {
  const { cargo, uf, mun, partido, modo, vista } = estado;
  document.querySelectorAll(".aba").forEach((b) => b.setAttribute("aria-selected", +b.dataset.cargo === cargo));
  $("#sel-reg").value = estado.reg || "";
  // botão voltar: sobe um nível e diz para onde
  const destino = mun ? UFS[uf][0] : uf ? REGIOES[estado.reg].nome : estado.reg ? "Brasil" : null;
  $("#btn-voltar").hidden = !destino;
  if (destino) {
    $("#btn-voltar-txt").textContent = destino;
    $("#btn-voltar").setAttribute("aria-label", `Voltar para ${destino}`);
  }
  $("#sel-uf").value = uf || "";
  $("#sel-partido").value = partido || "";
  $("#sel-partido").style.setProperty("--c", partido ? corPartido(partido) : "transparent");
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-pressed", !partido && b.dataset.modo === modo));
  document.querySelectorAll("[data-vista]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.vista === vista));
  document.querySelectorAll("[data-painel]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.painel === estado.painel));

  const { reg } = estado;
  const trilha = [el("button", { type: "button", onclick: () => ir({ reg: null }), "aria-current": !reg ? "page" : null }, "Brasil")];
  if (reg) trilha.push(el("span", { class: "sep" }, "›"),
    el("button", { type: "button", onclick: () => ir({ uf: null }), "aria-current": !uf ? "page" : null }, REGIOES[reg].nome));
  if (uf) trilha.push(el("span", { class: "sep" }, "›"),
    el("button", { type: "button", onclick: () => ir({ mun: null }), "aria-current": !mun ? "page" : null }, UFS[uf][0]));
  if (mun) trilha.push(el("span", { class: "sep" }, "›"), el("button", { type: "button", "aria-current": "page" }, db.municipios[mun][0]));
  $("#trilha").replaceChildren(...trilha);
  atualizarBusca();
}

// ------------------------------------------------------------------ tema
const TEMAS = ["light", "dark", "brasil"];

function aplicarTema(t) {
  document.documentElement.dataset.theme = TEMAS.includes(t) ? t : "light";
  document.querySelectorAll("[data-tema]").forEach((b) => b.setAttribute("aria-checked", b.dataset.tema === document.documentElement.dataset.theme));
}
function escolherTema(t) {
  aplicarTema(t);
  try { localStorage.setItem("tema", t); } catch { /* armazenamento indisponível */ }
  if (estado.vista === "painel") { pintarMapa(); mapa.agendar(); }
}

// ------------------------------------------------------------------ início
async function iniciar() {
  // tema claro por padrão; o escuro só entra se a pessoa escolher
  let tema = "light";
  try { tema = localStorage.getItem("tema") || "light"; } catch { /* sem armazenamento */ }
  aplicarTema(tema);
  await carregarBase();
  mapa = new Mapa($("#mapa"), {
    aoPassar: mostrarTooltip,
    aoSair: () => tip().classList.remove("visivel"),
    aoClicar: cliqueMapa,
  });
  mapa.iniciar(db.topo);
  montarControles();
  lerURL();
  $("#atualizado").textContent = `Totalização: ${db.resumo.meta.atualizado}`;
  const vistaInicial = estado.vista;
  estado.vista = "painel";
  await ir({ vista: vistaInicial });
  document.body.classList.add("pronto");
  // link colado/editado na barra de endereço (replaceState não dispara este evento)
  addEventListener("hashchange", () => {
    const antes = { ...estado };
    lerURL();
    const novo = { ...estado };
    Object.assign(estado, antes);
    ir(novo);
  });
}

iniciar().catch((e) => {
  console.error(e);
  $("#painel-corpo").replaceChildren(el("p", { class: "erro" }, `Não foi possível carregar os dados: ${e.message}`));
});
