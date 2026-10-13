// Cores de identidade dos partidos.
// Baseadas nas cores institucionais; os partidos que usam azul foram afastados
// entre si (royal, céu, lavanda, violeta, verde-água) para continuarem
// distinguíveis no mapa. A cor nunca aparece sozinha: sigla sempre ao lado.
export const CORES_PARTIDO = {
  PT: "#e0313a",
  PL: "#3b5fd9",
  PSD: "#ef9f1c",
  MDB: "#2a9d58",
  "UNIÃO": "#16b3a3",
  PP: "#8a6cf0",
  REPUBLICANOS: "#46a6e8",
  PSDB: "#aab9ee",
  PODE: "#9cc63f",
  NOVO: "#f2652a",
  PSB: "#f5c829",
  PSOL: "#b4369a",
  PDT: "#c2405a",
  REDE: "#2fc49a",
  PCDOB: "#9e1b32",
  PV: "#5cb85c",
  AVANTE: "#ff8fb1",
  SOLIDARIEDADE: "#f08c4b",
  CIDADANIA: "#e85b9a",
  PRD: "#5b7fa6",
  "MISSÃO": "#c9a34a",
  DC: "#8d6e63",
  DEMOCRATA: "#6f8fbf",
  AGIR: "#7e57c2",
  MOBILIZA: "#78909c",
  PRTB: "#546e7a",
  PCO: "#7f1d1d",
  PSTU: "#b91c1c",
  PCB: "#991b1b",
  UP: "#dc2626",
};

const NEUTRA = "#8a8f98";
export const corPartido = (sg) => CORES_PARTIDO[sg] || NEUTRA;

// Mistura linear em espaço Lab (d3) entre a superfície e a cor do partido.
export function intensidade(cor, t, superficie) {
  return d3.interpolateLab(superficie, cor)(0.28 + 0.72 * Math.max(0, Math.min(1, t)));
}
