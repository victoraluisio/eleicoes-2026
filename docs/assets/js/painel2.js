// Painel lateral do 2º turno (modo ao vivo).
// Cada pintura guarda os valores mostrados; na seguinte (30 s depois), barras e números
// partem do valor anterior em vez de zero — a tela "anda" junto com a apuração.
import { corPartido } from "./cores.js";
import { bloco as bloco1T } from "./dados.js";
import { el, int, pct, compacto, contar, iniciais, UFS, REGIOES, reduzMovimento } from "./util.js";

const anterior = new Map();   // chave -> último valor mostrado

function num(chave, valor, fmt = int) {
  const s = el("span", {}, fmt(anterior.get(chave) ?? 0));
  contar(s, valor, fmt, 900, anterior.get(chave) ?? 0);
  anterior.set(chave, valor);
  return s;
}

function largura(chave, valor, cor) {
  // a barra nasce no tamanho anterior e transiciona para o novo
  const i = el("i", { style: { width: `${anterior.get(chave) ?? 0}%`, ...(cor ? { "--c": cor } : {}) } });
  anterior.set(chave, valor);
  if (reduzMovimento()) i.style.width = `${valor}%`;
  else requestAnimationFrame(() => requestAnimationFrame(() => (i.style.width = `${valor}%`)));
  return i;
}

const chip = (sg) => el("span", { class: "chip", style: { "--c": corPartido(sg) } }, sg);

function avatar(c, tamanho = "lg") {
  const a = el("div", { class: `avatar avatar-${tamanho}`, style: { "--c": corPartido(c.partido) } });
  if (c.foto) {
    const img = el("img", { src: `fotos/${c.foto}.jpeg`, alt: "", loading: "lazy" });
    img.onerror = () => img.replaceWith(el("span", {}, iniciais(c.nome)));
    a.append(img);
  } else a.append(el("span", {}, iniciais(c.nome)));
  return a;
}

const secao = (titulo, sub, ...conteudo) => el("section", { class: "secao" },
  el("header", { class: "secao-cab" }, el("h3", {}, titulo), sub ? el("p", {}, sub) : null), ...conteudo);

// ------------------------------------------------------------------ duelo
function barraApuracao(t, chave) {
  const comecou = t.secoesApuradas > 0;
  return el("div", { class: "apuracao" },
    el("div", { class: "apuracao-topo" },
      el("span", {}, comecou ? "Seções apuradas" : "Apuração ainda não começou"),
      el("strong", {}, num(`${chave}|pst`, t.pApuradas, pct))),
    el("div", { class: "apuracao-barra" }, largura(`${chave}|pstw`, t.pApuradas)),
    el("span", { class: "apuracao-det" }, comecou
      ? `${int(t.secoesApuradas)} de ${int(t.secoes)} seções${t.finalizado ? " · totalização concluída" : ""}`
      : "A contagem começa após o fechamento das urnas, às 17h (horário de Brasília)."));
}

export function duelo(b, chave) {
  const [a, z] = b.candidatos;
  if (!a || !z) return el("p", { class: "card-sub" }, "Sem candidatos para este recorte.");
  const outros = b.candidatos.slice(2);   // só aparece na simulação com dados do 1º turno
  const lado = (c, lado) => el("div", { class: `duelo-cand duelo-${lado}`, style: { "--c": corPartido(c.partido) } },
    avatar(c, "lg"),
    el("strong", { class: "duelo-nome" }, c.nome),
    el("div", { class: "duelo-meta" }, chip(c.partido),
      c.situacao === "eleito" ? el("span", { class: "badge badge-eleito" }, "Eleito") : null),
    el("span", { class: "duelo-pct" }, num(`${chave}|${c.n}|pct`, c.pct, pct)),
    el("span", { class: "duelo-votos" }, num(`${chave}|${c.n}|v`, c.votos), " votos"));
  const dif = a.votos - z.votos;
  return el("div", { class: "duelo" },
    el("div", { class: "duelo-cands" }, lado(a, "a"), el("span", { class: "duelo-x" }, "×"), lado(z, "b")),
    el("div", { class: "duelo-barra", role: "img", "aria-label": `${a.nome} ${pct(a.pct)}, ${z.nome} ${pct(z.pct)}` },
      largura(`${chave}|ba`, a.pct, corPartido(a.partido)),
      largura(`${chave}|bz`, z.pct, corPartido(z.partido)),
      el("span", { class: "duelo-meio" })),
    b.totais.validos ? el("p", { class: "duelo-dif" }, `${a.nome} à frente por `, el("strong", {}, int(dif)),
      ` votos · ${pct(a.pct - z.pct).replace("%", " p.p.")}`) : null,
    outros.length ? el("p", { class: "card-sub" }, `Outros ${outros.length} candidatos somam ${pct(outros.reduce((s, c) => s + c.pct, 0))} (simulação com dados do 1º turno)`) : null,
    barraApuracao(b.totais, chave));
}

// ------------------------------------------------------------------ listas por região / estado
function linhaMini(rotulo, sub, b, chave, onclick) {
  const [a, z] = b?.candidatos || [];
  const temVoto = b && b.totais.validos > 0;
  return el("button", { type: "button", class: "mini", onclick },
    el("div", { class: "mini-topo" }, el("strong", {}, rotulo), el("span", { class: "mini-sub" }, sub),
      el("span", { class: "mini-apur" }, b ? `${pct(b.totais.pApuradas)} apurado` : "—")),
    temVoto
      ? el("div", { class: "mini-linha" },
        el("span", { class: "mini-pct" }, chip(a.partido), ` ${pct(a.pct)}`),
        el("div", { class: "duelo-barra mini-barra" },
          largura(`${chave}|a`, a.pct, corPartido(a.partido)),
          largura(`${chave}|z`, z.pct, corPartido(z.partido)),
          el("span", { class: "duelo-meio" })),
        el("span", { class: "mini-pct" }, `${pct(z.pct)} `, chip(z.partido)))
      : el("div", { class: "mini-linha mini-vazio" }, "aguardando votos"));
}

// ------------------------------------------------------------------ montagem
export function montarPainel2(alvo, estado, av, { ir }) {
  const { cargo, reg, uf, mun } = estado;
  const blocos = [];
  const escopo = `${cargo}|${reg}|${uf}|${mun}`;
  const suave = alvo.dataset.chave === escopo;
  alvo.dataset.chave = escopo;
  alvo.classList.toggle("sem-entrada", suave);

  if (!av.ultimoOk && !av.erro) {
    alvo.replaceChildren(el("p", { class: "card-sub" }, "Conectando à API de resultados do TSE…"));
    return;
  }
  if (!av.ultimoOk && av.erro) {
    alvo.replaceChildren(el("div", { class: "aviso-vivo" },
      el("strong", {}, "Não foi possível ler os dados do TSE agora."),
      el("p", {}, "O painel tenta de novo a cada 30 segundos. Se o problema continuar, o TSE pode estar limitando o acesso externo durante a apuração.")));
    return;
  }

  if (cargo === 1) {
    const b = av.bloco(1, { reg, uf, mun });
    const nome = mun ? "neste município" : uf ? `em ${UFS[uf][0]}` : reg ? `no ${REGIOES[reg].nome}` : "no Brasil";
    if (b) blocos.push(secao(`Presidente ${nome}`, "2º turno", duelo(b, escopo)));
    else blocos.push(el("p", { class: "card-sub" }, mun ? "A apuração deste município ainda não começou." : "Carregando…"));

    if (!uf) {
      if (!reg) {
        blocos.push(secao("Por região", "Toque para abrir", el("div", { class: "minis" },
          Object.entries(REGIOES).map(([r, { nome: n, ufs }]) => linhaMini(n, ufs.map((u) => u.toUpperCase()).join(" · "),
            av.bloco(1, { reg: r }), `reg|${r}`, () => ir({ reg: r }))))));
      }
      const ufs = (reg ? REGIOES[reg].ufs : Object.keys(UFS))
        .sort((x, y) => (bloco1T(1, y)?.totais.eleitorado || 0) - (bloco1T(1, x)?.totais.eleitorado || 0));
      blocos.push(secao("Por estado", "Do maior para o menor eleitorado", el("div", { class: "minis" },
        ufs.map((u) => linhaMini(UFS[u][0], u.toUpperCase(), av.bloco(1, { uf: u }), `uf|1|${u}`, () => ir({ uf: u }))))));
    } else if (!mun) {
      const muns = Object.entries(av.dados[1].mun).filter(([ibge]) => ibge.startsWith(UFS[uf][1]));
      if (muns.length && b) {
        const [a, z] = b.candidatos;
        const conta = (n) => muns.filter(([, m]) => m.candidatos[0]?.n === n && m.totais.validos > 0).length;
        blocos.push(secao("Municípios", `${int(muns.length)} com votos apurados`,
          el("div", { class: "minis" }, [a, z].map((c) => el("div", { class: "mini mini-estatico" },
            el("div", { class: "mini-topo" }, el("strong", {}, c.nome), chip(c.partido)),
            el("span", { class: "mini-sub" }, `lidera em ${int(conta(c.n))} municípios`))))));
      }
    }
  } else {
    // Governador: cada UF tem sua própria disputa
    if (!uf) {
      const ufs = av.ufsCargo[3].filter((u) => !reg || REGIOES[reg].ufs.includes(u));
      blocos.push(secao("Governador · 2º turno", ufs.length ? `${ufs.length} estado${ufs.length > 1 ? "s" : ""} em disputa` : "",
        ufs.length
          ? el("div", { class: "minis" }, ufs.map((u) => {
            const b = av.bloco(3, { uf: u });
            const [a, z] = b?.candidatos || [];
            return linhaMini(UFS[u][0], a && z ? `${a.nome} × ${z.nome}` : u.toUpperCase(), b, `uf|3|${u}`, () => ir({ uf: u }));
          }))
          : el("p", { class: "card-sub" }, `Nenhum estado ${reg ? `do ${REGIOES[reg].nome} ` : ""}tem 2º turno para governador.`)));
    } else if (!av.temSegundoTurno(3, uf)) {
      const eleito = bloco1T(3, uf)?.candidatos.find((c) => c.situacao === "eleito");
      blocos.push(el("div", { class: "aviso-vivo" },
        el("strong", {}, `${UFS[uf][0]} não tem 2º turno para governador.`),
        eleito ? el("p", {}, `Eleito no 1º turno: ${eleito.nome} (${eleito.partido}), com ${pct(eleito.pct)} dos votos válidos.`) : null));
    } else {
      const b = av.bloco(3, { uf, mun });
      if (b) blocos.push(secao(`Governador ${mun ? "neste município" : `· ${UFS[uf][0]}`}`, "2º turno", duelo(b, escopo)));
      else blocos.push(el("p", { class: "card-sub" }, "A apuração deste município ainda não começou."));
    }
  }

  if (!suave) blocos.forEach((b, i) => { b.classList.add("entra"); b.style.setProperty("--d", `${i * 70}ms`); });
  alvo.replaceChildren(...blocos);
}
