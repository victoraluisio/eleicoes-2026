import { reduzMovimento, UF_POR_IBGE, REGIOES, REGIAO_DA_UF } from "./util.js?v=202610251223";

// Mapa em Canvas: 5.570 polígonos em SVG travavam a animação (<1 fps no zoom).
// Aqui cada município vira um Path2D pré-projetado; zoom = matriz de transformação,
// cores animadas em JS e hit-test por caixa delimitadora + isPointInPath.

const DURACAO_ZOOM = 950;
const DURACAO_COR = 650;
const VARREDURA = 900;
const ALFA_FORA = 0.16;

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const easeCor = d3.easeCubicOut;

export class Mapa {
  constructor(container, { aoPassar, aoSair, aoClicar }) {
    this.container = container;
    this.cb = { aoPassar, aoSair, aoClicar };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "mapa-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Mapa do Brasil com o resultado por município");
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.t = d3.zoomIdentity;
    this.ufAtual = null;
    this.selId = null;
    this.hoverAlvo = null;
    this.nivel = "mun";

    this.zoom = d3.zoom().scaleExtent([1, 80])
      .on("zoom", (ev) => { this.t = ev.transform; this.agendar(); });
    this.sel = d3.select(this.canvas).call(this.zoom).on("dblclick.zoom", null);

    this.canvas.addEventListener("pointermove", (e) => this._mover(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverAlvo = null; this.agendar(); this.cb.aoSair();
    });
    this.canvas.addEventListener("click", (e) => {
      const i = this._achar(e);
      if (i >= 0) this.cb.aoClicar(this.ids[i], e);
    });
    let espera;
    new ResizeObserver(() => { clearTimeout(espera); espera = setTimeout(() => this.redimensionar(), 60); })
      .observe(container);
  }

  iniciar(topo) {
    const munFeat = topojson.feature(topo, topo.objects.mun).features;
    this.munFeat = munFeat;
    this.ufFeat = topojson.feature(topo, topo.objects.uf).features;
    this.ufIdx = Object.fromEntries(this.ufFeat.map((f, i) => [UF_POR_IBGE[f.id], i]));
    this.meshMun = topojson.mesh(topo, topo.objects.mun, (a, b) => a !== b);
    this.meshUF = topojson.mesh(topo, topo.objects.uf, (a, b) => a !== b);
    this.contorno = topojson.mesh(topo, topo.objects.uf, (a, b) => a === b);
    // regiões = união das UFs; a divisa entre regiões é desenhada mais forte no nível Brasil
    const regDaGeo = (g) => REGIAO_DA_UF[UF_POR_IBGE[g.id]];
    this.regFeat = Object.fromEntries(Object.keys(REGIOES).map((r) => [r,
      topojson.merge(topo, topo.objects.uf.geometries.filter((g) => regDaGeo(g) === r))]));
    this.meshReg = topojson.mesh(topo, topo.objects.uf, (a, b) => regDaGeo(a) !== regDaGeo(b));
    this.ids = munFeat.map((f) => f.id);
    this.ufDe = munFeat.map((f) => UF_POR_IBGE[f.id.slice(0, 2)]);
    this.regDe = this.ufDe.map((uf) => REGIAO_DA_UF[uf]);
    this.porId = new Map(this.ids.map((id, i) => [id, i]));

    const n = munFeat.length;
    // estado de animação por município: cor (rgb) e alfa, de -> para
    this.cor = new Float32Array(n * 3);
    this.de = new Float32Array(n * 3);
    this.para = new Float32Array(n * 3);
    this.alfa = new Float32Array(n).fill(1);
    this.alfaDe = new Float32Array(n).fill(1);
    this.alfaPara = new Float32Array(n).fill(1);
    this.atraso = new Float32Array(n);
    this.lerTema();
    const s = d3.rgb(this.tema.semDado);
    for (let i = 0; i < n; i++) this.cor.set([s.r, s.g, s.b], i * 3);
    this.redimensionar(true);
  }

  lerTema() {
    this.tema = {
      semDado: css("--sem-dado"), superficie: css("--superficie-mapa"), divisa: css("--divisa"),
      contorno: css("--contorno"), tinta: css("--tinta"),
    };
  }

  redimensionar() {
    if (!this.munFeat) return;
    let { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) { if (this.paths) return; width = 800; height = 600; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this, { w: width, h: height, dpr });
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const pad = Math.min(width, height) * 0.04;
    this.proj = d3.geoMercator().fitExtent([[pad, pad], [width - pad, height - pad]],
      { type: "FeatureCollection", features: this.ufFeat });
    const gp = d3.geoPath(this.proj);
    this.gp = gp;
    this.paths = this.munFeat.map((f) => new Path2D(gp(f)));
    this.caixas = this.munFeat.map((f) => gp.bounds(f).flat());
    this.ufPaths = this.ufFeat.map((f) => new Path2D(gp(f)));
    this.pMeshMun = new Path2D(gp(this.meshMun));
    this.pMeshUF = new Path2D(gp(this.meshUF));
    this.pMeshReg = new Path2D(gp(this.meshReg));
    this.regPaths = Object.fromEntries(Object.entries(this.regFeat).map(([r, f]) => [r, new Path2D(gp(f))]));
    this.pContorno = new Path2D(gp(this.contorno));
    this.zoom.extent([[0, 0], [width, height]]);
    this.focar(this.regAtual, this.ufAtual, this.selId, false);
  }

  // ---------------------------------------------------------------- desenho
  agendar() {
    if (this._quadro) return;
    this._quadro = requestAnimationFrame((agora) => { this._quadro = null; this.desenhar(agora); });
  }

  desenhar(agora = performance.now()) {
    if (!this.paths) return;
    const animando = this._passoAnimacao(agora);
    const { ctx, dpr, t, tema } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
    const k = t.k;

    const c = this.cor;
    for (let i = 0; i < this.paths.length; i++) {
      ctx.globalAlpha = this.alfa[i];
      ctx.fillStyle = `rgb(${c[i * 3] | 0},${c[i * 3 + 1] | 0},${c[i * 3 + 2] | 0})`;
      ctx.fill(this.paths[i]);
    }
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";

    // divisas municipais (some no modo "Estados")
    if (!(this.nivel === "uf" && !this.ufAtual)) {
      ctx.globalAlpha = this.ufAtual ? 0.85 : 0.5;
      ctx.strokeStyle = tema.superficie;
      ctx.lineWidth = (this.ufAtual ? 0.6 : 0.35) / k;
      ctx.stroke(this.pMeshMun);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = tema.divisa;
    ctx.lineWidth = (this.ufAtual ? 1.4 : 0.9) / k;
    ctx.stroke(this.pMeshUF);
    if (!this.ufAtual) {
      ctx.lineWidth = (this.regAtual ? 2 : 2.6) / k;
      ctx.stroke(this.pMeshReg);
    }
    ctx.strokeStyle = tema.contorno;
    ctx.lineWidth = 1 / k;
    ctx.stroke(this.pContorno);

    const contornar = (p, largura) => {
      ctx.strokeStyle = tema.superficie; ctx.lineWidth = (largura + 2.5) / k; ctx.stroke(p);
      ctx.strokeStyle = tema.tinta; ctx.lineWidth = largura / k; ctx.stroke(p);
    };
    if (this.selId != null) contornar(this.paths[this.porId.get(this.selId)], 2.4);
    if (this.hoverAlvo) contornar(this.hoverAlvo, 1.6);

    if (animando) this.agendar();
  }

  _passoAnimacao(agora) {
    if (!this.anim) return false;
    const { inicio, dur } = this.anim;
    let falta = false;
    const n = this.paths.length;
    for (let i = 0; i < n; i++) {
      let p = (agora - inicio - this.atraso[i]) / dur;
      if (p < 1) falta = true;
      p = p <= 0 ? 0 : p >= 1 ? 1 : easeCor(p);
      const j = i * 3;
      this.cor[j] = this.de[j] + (this.para[j] - this.de[j]) * p;
      this.cor[j + 1] = this.de[j + 1] + (this.para[j + 1] - this.de[j + 1]) * p;
      this.cor[j + 2] = this.de[j + 2] + (this.para[j + 2] - this.de[j + 2]) * p;
      this.alfa[i] = this.alfaDe[i] + (this.alfaPara[i] - this.alfaDe[i]) * p;
    }
    if (!falta) this.anim = null;
    return falta;
  }

  _animar(varredura = false) {
    const instantaneo = reduzMovimento();
    this.de.set(this.cor);
    this.alfaDe.set(this.alfa);
    if (varredura && !instantaneo) {
      // a cor entra do oeste para o leste
      const xs = this.caixas.map((b) => (b[0] + b[2]) / 2);
      const [x0, x1] = d3.extent(xs);
      xs.forEach((x, i) => (this.atraso[i] = ((x - x0) / (x1 - x0)) * VARREDURA));
    } else this.atraso.fill(0);
    this.anim = { inicio: performance.now(), dur: instantaneo ? 1 : DURACAO_COR };
    this.agendar();
  }

  // ---------------------------------------------------------------- API usada pelo app
  colorir(cor, { varredura = false, nivel = "mun" } = {}) {
    this.nivel = nivel;
    this.lerTema();
    const cache = new Map();
    for (let i = 0; i < this.ids.length; i++) {
      const css = cor(this.ids[i]) || this.tema.semDado;
      let rgb = cache.get(css);
      if (!rgb) { rgb = d3.rgb(css); cache.set(css, rgb); }
      this.para[i * 3] = rgb.r; this.para[i * 3 + 1] = rgb.g; this.para[i * 3 + 2] = rgb.b;
    }
    this._animar(varredura);
  }

  /** Aproxima a câmera: Brasil › região › UF › município. */
  focar(reg, uf = null, ibge = null, animar = true) {
    this.regAtual = reg;
    this.ufAtual = uf;
    this.selId = ibge;
    for (let i = 0; i < this.ids.length; i++) {
      const dentro = uf ? this.ufDe[i] === uf : reg ? this.regDe[i] === reg : true;
      this.alfaPara[i] = dentro ? 1 : ALFA_FORA;
    }
    if (this.para) { this.para.set(this.anim ? this.para : this.cor); this._animar(false); }

    let alvo = d3.zoomIdentity;
    if (reg && this.gp) {
      const escala = (feature, ocupacao) => {
        const [[x0, y0], [x1, y1]] = this.gp.bounds(feature);
        return [Math.min(80, ocupacao / Math.max((x1 - x0) / this.w, (y1 - y0) / this.h)), (x0 + x1) / 2, (y0 + y1) / 2];
      };
      let [k, cx, cy] = escala(uf ? this.ufFeat[this.ufIdx[uf]] : this.regFeat[reg], 0.88);
      if (ibge) {
        // aproxima o município mantendo os vizinhos à vista (~1/3 da tela)
        const [km, mx, my] = escala(this.munFeat[this.porId.get(ibge)], 0.32);
        if (km > k) [k, cx, cy] = [km, mx, my];
      }
      alvo = d3.zoomIdentity.translate(this.w / 2, this.h / 2).scale(k).translate(-cx, -cy);
    }
    if (animar && !reduzMovimento()) {
      this.sel.transition().duration(DURACAO_ZOOM).ease(d3.easeCubicInOut).call(this.zoom.transform, alvo);
    } else {
      this.sel.interrupt().call(this.zoom.transform, alvo);
    }
    this.agendar();
  }

  zoomPor(fator) {
    this.sel.transition().duration(reduzMovimento() ? 0 : 450).ease(d3.easeCubicOut).call(this.zoom.scaleBy, fator);
  }

  resetarZoomManual() {
    this.focar(this.regAtual, this.ufAtual, this.selId, true);
  }

  // ---------------------------------------------------------------- interação
  _achar(e) {
    if (!this.paths) return -1;
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = this.t.invert([e.clientX - r.left, e.clientY - r.top]);
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let achado = -1;
    for (let i = 0; i < this.caixas.length; i++) {
      const b = this.caixas[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (ctx.isPointInPath(this.paths[i], x, y)) { achado = i; break; }
    }
    ctx.restore();
    return achado;
  }

  _mover(e) {
    const i = this._achar(e);
    if (i < 0) {
      if (this.hoverAlvo) { this.hoverAlvo = null; this.agendar(); this.cb.aoSair(); }
      return;
    }
    // o destaque segue o próximo nível do clique: região no Brasil, estado na região,
    // município no estado (fora do escopo atual, destaca o que o clique vai abrir)
    const reg = this.regDe[i], uf = this.ufDe[i];
    let tipo;
    if (!this.regAtual || reg !== this.regAtual) tipo = "reg";
    else if (!this.ufAtual || uf !== this.ufAtual) tipo = "uf";
    else tipo = "mun";
    const alvo = tipo === "reg" ? this.regPaths[reg] : tipo === "uf" ? this.ufPaths[this.ufIdx[uf]] : this.paths[i];
    if (alvo !== this.hoverAlvo) { this.hoverAlvo = alvo; this.agendar(); }
    this.cb.aoPassar(this.ids[i], e, tipo);
  }
}
