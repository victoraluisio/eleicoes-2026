export const UFS = {
  ac: ["Acre", "12"], al: ["Alagoas", "27"], am: ["Amazonas", "13"], ap: ["Amapá", "16"],
  ba: ["Bahia", "29"], ce: ["Ceará", "23"], df: ["Distrito Federal", "53"], es: ["Espírito Santo", "32"],
  go: ["Goiás", "52"], ma: ["Maranhão", "21"], mg: ["Minas Gerais", "31"], ms: ["Mato Grosso do Sul", "50"],
  mt: ["Mato Grosso", "51"], pa: ["Pará", "15"], pb: ["Paraíba", "25"], pe: ["Pernambuco", "26"],
  pi: ["Piauí", "22"], pr: ["Paraná", "41"], rj: ["Rio de Janeiro", "33"], rn: ["Rio Grande do Norte", "24"],
  ro: ["Rondônia", "11"], rr: ["Roraima", "14"], rs: ["Rio Grande do Sul", "43"], sc: ["Santa Catarina", "42"],
  se: ["Sergipe", "28"], sp: ["São Paulo", "35"], to: ["Tocantins", "17"],
};
export const UF_POR_IBGE = Object.fromEntries(Object.entries(UFS).map(([sg, [, c]]) => [c, sg]));

// Regiões do IBGE — o 1º nível de navegação do mapa (Brasil › Região › UF › Município)
export const REGIOES = {
  n: { nome: "Norte", ufs: ["ac", "am", "ap", "pa", "ro", "rr", "to"] },
  ne: { nome: "Nordeste", ufs: ["al", "ba", "ce", "ma", "pb", "pe", "pi", "rn", "se"] },
  co: { nome: "Centro-Oeste", ufs: ["df", "go", "ms", "mt"] },
  se: { nome: "Sudeste", ufs: ["es", "mg", "rj", "sp"] },
  s: { nome: "Sul", ufs: ["pr", "rs", "sc"] },
};
export const REGIAO_DA_UF = Object.fromEntries(
  Object.entries(REGIOES).flatMap(([r, { ufs }]) => ufs.map((uf) => [uf, r])));

export const CARGOS = [
  { id: 1, nome: "Presidente", curto: "Presidente", majoritario: true },
  { id: 3, nome: "Governador", curto: "Governador", majoritario: true },
  { id: 5, nome: "Senador", curto: "Senador", majoritario: true },
  { id: 6, nome: "Deputado Federal", curto: "Dep. Federal", majoritario: false },
  { id: 7, nome: "Deputado Estadual", curto: "Dep. Estadual", majoritario: false },
];
export const cargoInfo = (id) => CARGOS.find((c) => c.id === +id);

const fmtInt = new Intl.NumberFormat("pt-BR");
const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCompacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
export const int = (n) => fmtInt.format(Math.round(n));
export const pct = (n) => fmtPct.format(n) + "%";
export const compacto = (n) => fmtCompacto.format(n);

export const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") {
      // propriedades customizadas (--c) só entram via setProperty
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith("--")) e.style.setProperty(p, val);
        else e.style[p] = val;
      }
    }
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) e.append(f.nodeType ? f : String(f));
  return e;
};

export const reduzMovimento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Conta de 0 até o valor final (números do painel)
export function contar(elemento, alvo, formato = int, duracao = 900) {
  if (reduzMovimento()) { elemento.textContent = formato(alvo); return; }
  const ini = performance.now();
  const passo = (t) => {
    const p = Math.min(1, (t - ini) / duracao);
    elemento.textContent = formato(alvo * d3.easeCubicOut(p));
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

export const iniciais = (nome) => nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-ZÀ-Ú]/.test(p))
  .slice(0, 2).map((p) => p[0]).join("").toUpperCase();

export const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const cache = new Map();
export function carregar(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }));
  return cache.get(url);
}
