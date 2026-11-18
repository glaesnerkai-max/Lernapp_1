#!/usr/bin/env node
'use strict';

/*
 * Hedgefonds-Manager-Duell – Kommandozeilen-Version
 *
 * Zwei Fondsmanager:innen (Mensch vs. Mensch, Mensch vs. Computer oder
 * Computer vs. Computer) verwalten je 100 Mio. € über mehrere Quartale.
 * Gelernt werden: Diversifikation, Hebel, Absicherung (Put-Optionen),
 * Gebührenmodell "2 und 20", High-Water-Mark, Drawdown und Sharpe-Ratio.
 */

const readline = require('readline');

// ---------------------------------------------------------------- Optionen
function parseArgs(argv) {
  const opts = { mode: null, rounds: 8, seed: null, names: [], help: false, plain: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--modus' || a === '--mode') opts.mode = next();
    else if (a === '--runden' || a === '--rounds') opts.rounds = parseInt(next(), 10);
    else if (a === '--seed') opts.seed = parseInt(next(), 10);
    else if (a === '--namen' || a === '--names') opts.names = String(next()).split(',');
    else if (a === '--ohne-farbe' || a === '--no-color') opts.plain = true;
    else throw new Error(`Unbekannte Option: ${a}`);
  }
  if (!Number.isInteger(opts.rounds) || opts.rounds < 1 || opts.rounds > 40) {
    throw new Error('--runden muss eine Zahl zwischen 1 und 40 sein.');
  }
  if (opts.mode && !['pvp', 'pvc', 'cvc'].includes(opts.mode)) {
    throw new Error('--modus muss pvp, pvc oder cvc sein.');
  }
  return opts;
}

const HELP = `
Hedgefonds-Manager-Duell (CLI)

Aufruf:  node cli/duell.js [Optionen]

Optionen:
  --modus pvp|pvc|cvc   Mensch vs. Mensch, Mensch vs. Computer, Computer vs. Computer
  --runden N            Anzahl Quartale (Standard 8 = 2 Jahre, max. 40)
  --seed N              Zufalls-Seed für reproduzierbare Partien (z. B. im Unterricht)
  --namen A,B           Namen der beiden Fonds
  --ohne-farbe          Ausgabe ohne Farben
  -h, --help            Diese Hilfe

Im Spiel bei jeder Eingabe "?" tippen, um eine Erklärung zu bekommen.
`;

// ---------------------------------------------------------------- Zufall
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  const rand = () => { // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rand, normal };
}

// ---------------------------------------------------------------- Farben
let C = {};
function setColors(on) {
  const w = (code) => (on ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => String(s));
  C = { bold: w('1'), dim: w('2'), red: w('31'), green: w('32'), yellow: w('33'), cyan: w('36') };
}

// ---------------------------------------------------------------- Markt
const ASSETS = [
  { key: 'aktien', name: 'Aktien (Industrie)', short: 'Aktien' },
  { key: 'tech', name: 'Tech-Aktien', short: 'Tech' },
  { key: 'anleihen', name: 'Staatsanleihen', short: 'Anleihen' },
  { key: 'gold', name: 'Gold', short: 'Gold' },
  { key: 'cash', name: 'Cash (Geldmarkt)', short: 'Cash' },
];

// Erwartete Quartalsrendite (mu) und Schwankung (sd) je Szenario, in Prozent.
const SCENARIOS = [
  { name: 'Boom', p: 0.28, news: 'Unternehmensgewinne übertreffen die Erwartungen.',
    r: { aktien: [8, 4], tech: [14, 7], anleihen: [0.5, 1.5], gold: [-1, 3], cash: [0.5, 0] } },
  { name: 'Seitwärtsmarkt', p: 0.30, news: 'Analysten erwarten ein ruhiges Quartal.',
    r: { aktien: [3, 3], tech: [3, 5], anleihen: [1.2, 1], gold: [0.5, 2.5], cash: [0.5, 0] } },
  { name: 'Zinsanstieg', p: 0.14, news: 'Die Zentralbank deutet eine Zinserhöhung an.',
    r: { aktien: [-2, 4], tech: [-6, 6], anleihen: [-3, 1.5], gold: [-2, 3], cash: [0.9, 0] } },
  { name: 'Inflationsschub', p: 0.12, news: 'Energiepreise steigen kräftig.',
    r: { aktien: [-1, 4], tech: [-2, 6], anleihen: [-2.5, 1.5], gold: [7, 4], cash: [0.6, 0] } },
  { name: 'Rezession', p: 0.10, news: 'Frühindikatoren trüben sich deutlich ein.',
    r: { aktien: [-6, 5], tech: [-10, 7], anleihen: [3.5, 1.5], gold: [3, 3], cash: [0.4, 0] } },
  { name: 'Crash', p: 0.06, news: 'Gerüchte über eine wankende Großbank machen die Runde.',
    r: { aktien: [-15, 6], tech: [-22, 8], anleihen: [4, 2], gold: [5, 4], cash: [0.3, 0] } },
];

const NEWS_RELIABILITY = 0.65; // so oft passt die Schlagzeile zum tatsächlichen Szenario
const BORROW_RATE = 1.2;       // Kreditzins je Quartal (%) auf geliehenes Geld
const PUT_COST = 1.0;          // Prämie je Quartal (%) auf den abgesicherten Aktienanteil
const PUT_FLOOR = -6;          // Put begrenzt Verlust der Aktienpositionen auf diesen Wert (%)
const MGMT_FEE = 0.5;          // 2 % p. a. = 0,5 % je Quartal
const PERF_FEE = 0.2;          // 20 % auf Gewinne über der High-Water-Mark
const MARGIN_CALL = 0.5;       // Fonds wird geschlossen, wenn NAV unter 50 % fällt
const START_NAV = 100;

function pickScenario(rng) {
  let x = rng.rand();
  for (const s of SCENARIOS) { if ((x -= s.p) <= 0) return s; }
  return SCENARIOS[SCENARIOS.length - 1];
}

function headlineFor(actual, rng) {
  if (rng.rand() < NEWS_RELIABILITY) return actual.news;
  const others = SCENARIOS.filter((s) => s !== actual);
  return others[Math.floor(rng.rand() * others.length)].news;
}

function drawReturns(scenario, rng) {
  const out = {};
  for (const a of ASSETS) {
    const [mu, sd] = scenario.r[a.key];
    out[a.key] = mu + sd * rng.normal();
  }
  return out;
}

// ---------------------------------------------------------------- Fonds
function newFund(name, isBot) {
  return {
    name, isBot,
    nav: START_NAV,          // Wert für Anleger (nach Gebühren), Mio. €
    hwm: START_NAV,          // High-Water-Mark
    peak: START_NAV,
    maxDD: 0,
    feesPaid: 0,
    history: [],             // Netto-Quartalsrenditen in %
    closed: false,
    decision: null,
  };
}

/** Wendet eine Entscheidung und die Marktrenditen auf einen Fonds an. */
function applyQuarter(fund, d, ret) {
  if (fund.closed) return null;
  const lev = d.leverage;
  const w = d.weights; // Summe 100
  let gross = 0;
  const contrib = {};
  for (const a of ASSETS) {
    let r = ret[a.key];
    if (d.hedge && (a.key === 'aktien' || a.key === 'tech')) r = Math.max(r, PUT_FLOOR) - PUT_COST;
    contrib[a.key] = (w[a.key] / 100) * lev * r;
    gross += contrib[a.key];
  }
  const borrowCost = (lev - 1) * BORROW_RATE;
  gross -= borrowCost;

  const before = fund.nav;
  let navAfter = before * (1 + gross / 100);
  const mgmt = navAfter * (MGMT_FEE / 100);
  navAfter -= mgmt;
  let perf = 0;
  if (navAfter > fund.hwm) {
    perf = (navAfter - fund.hwm) * PERF_FEE;
    navAfter -= perf;
    fund.hwm = navAfter;
  }
  fund.feesPaid += mgmt + perf;
  fund.nav = Math.max(0, navAfter);
  const net = (fund.nav / before - 1) * 100;
  fund.history.push(net);
  fund.peak = Math.max(fund.peak, fund.nav);
  fund.maxDD = Math.max(fund.maxDD, (1 - fund.nav / fund.peak) * 100);
  if (fund.nav < START_NAV * MARGIN_CALL) fund.closed = true;
  return { gross, net, borrowCost, mgmt, perf, contrib };
}

function stats(fund) {
  const h = fund.history;
  const n = h.length || 1;
  const mean = h.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(h.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const rf = 0.5; // risikoloser Zins je Quartal (Cash)
  // Volatilität mind. 1 %, damit sehr ruhige Kurzpartien keine absurden Werte liefern.
  const vol = Math.max(sd, 1);
  const excess = mean - rf;
  // Bei negativer Überrendite würde die klassische Sharpe-Ratio mehr Risiko belohnen.
  // Daher die modifizierte Sharpe-Ratio nach Israelsen: Überrendite × Volatilität.
  const raw = excess >= 0 ? excess / vol : excess * vol;
  const sharpe = h.length ? raw * 2 : 0; // annualisiert (×√4)
  return { total: (fund.nav / START_NAV - 1) * 100, mean, sd, sharpe };
}

// ---------------------------------------------------------------- Computer-Gegner
function botDecision(fund, headline, rng, style) {
  const guess = SCENARIOS.find((s) => s.news === headline);
  const base = { aktien: 20, tech: 20, anleihen: 30, gold: 15, cash: 15 };
  let lev = 1;
  let hedge = false;
  if (guess) {
    if (guess.name === 'Boom') { Object.assign(base, { aktien: 35, tech: 40, anleihen: 10, gold: 5, cash: 10 }); lev = 1.5; }
    if (guess.name === 'Zinsanstieg') Object.assign(base, { aktien: 15, tech: 5, anleihen: 10, gold: 20, cash: 50 });
    if (guess.name === 'Inflationsschub') Object.assign(base, { aktien: 20, tech: 10, anleihen: 5, gold: 45, cash: 20 });
    if (guess.name === 'Rezession') { Object.assign(base, { aktien: 15, tech: 10, anleihen: 45, gold: 20, cash: 10 }); hedge = true; }
    if (guess.name === 'Crash') { Object.assign(base, { aktien: 15, tech: 10, anleihen: 40, gold: 25, cash: 10 }); hedge = true; }
  }
  if (style === 'mutig') {
    // Der mutige Bot glaubt Schlagzeilen stärker und hebelt mehr.
    if (guess && guess.name === 'Boom') lev = 2;
    if (!guess || guess.name === 'Seitwärtsmarkt') { Object.assign(base, { aktien: 30, tech: 35, anleihen: 15, gold: 10, cash: 10 }); lev = 1.5; }
    hedge = hedge && rng.rand() < 0.5;
  } else if (rng.rand() < 0.2) {
    hedge = !hedge; // der vorsichtige Bot variiert seine Absicherung leicht
  }
  if (fund.nav < 80) lev = 1; // wer tief im Minus ist, reduziert das Risiko
  return { weights: base, leverage: lev, hedge };
}

// ---------------------------------------------------------------- Eingabe
function makeAsk() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
  const ask = (q) => new Promise((resolve) => {
    process.stdout.write(q);
    if (queue.length) { const l = queue.shift(); if (!process.stdin.isTTY) process.stdout.write(l + '\n'); resolve(l); }
    else if (closed) resolve(null);
    else waiting.push((l) => { if (l !== null && !process.stdin.isTTY) process.stdout.write(l + '\n'); resolve(l); });
  });
  return { ask, close: () => rl.close() };
}

const EXPLAIN = {
  weights: `
  ${'Gewichtung'}: Wie viel Prozent des Fonds steckst du in welche Anlage?
  Fünf Zahlen in der Reihenfolge Aktien Tech Anleihen Gold Cash, Summe 100.
  Beispiel: "30 20 30 10 10". Leere Eingabe = ausgewogen (20 je Anlage).
  Diversifikation: Anlagen reagieren unterschiedlich auf Ereignisse –
  Anleihen und Gold steigen oft, wenn Aktien fallen.`,
  leverage: `
  Hebel: Mit 2x leihst du dir zusätzlich so viel Geld, wie der Fonds wert ist.
  Gewinne UND Verluste verdoppeln sich, und der Kredit kostet ${BORROW_RATE} % je Quartal
  pro geliehenem Fondsvermögen. Fällt der Fonds unter ${MARGIN_CALL * 100} % des Startwerts,
  kommt der Margin Call: Der Fonds wird geschlossen.`,
  hedge: `
  Put-Absicherung: Eine Put-Option ist wie eine Versicherung. Sie kostet
  ${PUT_COST} % Prämie auf deine Aktien- und Tech-Position, begrenzt deren Verlust
  im Quartal aber auf ${PUT_FLOOR} %. In ruhigen Zeiten kostet sie Rendite,
  im Crash rettet sie den Fonds.`,
};

async function askNumberList(ask, prompt) {
  for (;;) {
    const raw = await ask(prompt);
    if (raw === null) return null;
    const t = raw.trim();
    if (t === '?') { console.log(EXPLAIN.weights); continue; }
    if (t === '') return { aktien: 20, tech: 20, anleihen: 20, gold: 20, cash: 20 };
    const nums = t.split(/[\s,;]+/).map(Number);
    if (nums.length !== 5 || nums.some((x) => !Number.isFinite(x) || x < 0)) {
      console.log(C.red('  Bitte genau fünf nicht-negative Zahlen eingeben (oder "?").'));
      continue;
    }
    const sum = nums.reduce((s, x) => s + x, 0);
    if (Math.abs(sum - 100) > 0.01) {
      console.log(C.red(`  Die Summe ist ${sum}, sie muss 100 ergeben.`));
      continue;
    }
    const w = {};
    ASSETS.forEach((a, i) => (w[a.key] = nums[i]));
    return w;
  }
}

async function askLeverage(ask) {
  for (;;) {
    const raw = await ask('  Hebel 1 / 1.5 / 2 / 3 [1]: ');
    if (raw === null) return null;
    const t = raw.trim().replace(',', '.').replace(/x$/i, '');
    if (t === '?') { console.log(EXPLAIN.leverage); continue; }
    if (t === '') return 1;
    const v = Number(t);
    if ([1, 1.5, 2, 3].includes(v)) return v;
    console.log(C.red('  Erlaubt sind 1, 1.5, 2 oder 3.'));
  }
}

async function askHedge(ask) {
  for (;;) {
    const raw = await ask('  Put-Absicherung kaufen? j/n [n]: ');
    if (raw === null) return null;
    const t = raw.trim().toLowerCase();
    if (t === '?') { console.log(EXPLAIN.hedge); continue; }
    if (t === '' || t === 'n' || t === 'nein') return false;
    if (t === 'j' || t === 'ja' || t === 'y') return true;
    console.log(C.red('  Bitte j oder n.'));
  }
}

async function humanDecision(ask, fund) {
  console.log(`\n${C.bold(fund.name)} ist am Zug (Fondswert ${fmtMio(fund.nav)}). "?" zeigt Erklärungen.`);
  const weights = await askNumberList(ask, '  Gewichtung Aktien Tech Anleihen Gold Cash [20 20 20 20 20]: ');
  if (!weights) return null;
  const leverage = await askLeverage(ask);
  if (leverage === null) return null;
  const hedge = await askHedge(ask);
  if (hedge === null) return null;
  return { weights, leverage, hedge };
}

// ---------------------------------------------------------------- Ausgabe
const fmtPct = (x, digits = 1) => {
  const s = `${x >= 0 ? '+' : ''}${x.toFixed(digits).replace('.', ',')} %`;
  return x > 0.05 ? C.green(s) : x < -0.05 ? C.red(s) : s;
};
const fmtMio = (x) => `${x.toFixed(1).replace('.', ',')} Mio. €`;
const pad = (s, n) => {
  const len = String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
  return String(s) + ' '.repeat(Math.max(0, n - len));
};

function describeDecision(d) {
  const w = ASSETS.map((a) => `${a.short} ${d.weights[a.key]}`).join(' · ');
  return `${w} | Hebel ${String(d.leverage).replace('.', ',')}x${d.hedge ? ' | Put' : ''}`;
}

function lessonFor(scenario, results) {
  const tips = {
    Boom: 'Im Boom zahlen sich Aktien und Hebel aus – eine Absicherung kostet hier nur Prämie.',
    Seitwärtsmarkt: 'Seitwärts bringt Hebel wenig: Die Kreditkosten fressen einen Großteil des Ertrags auf.',
    Zinsanstieg: 'Steigende Zinsen drücken Anleihekurse und vor allem Tech-Bewertungen. Cash profitiert.',
    Inflationsschub: 'Gold gilt als Inflationsschutz. Anleihen verlieren real an Wert.',
    Rezession: 'In der Rezession fliehen Anleger in sichere Staatsanleihen ("Flight to Quality").',
    Crash: 'Im Crash zeigt sich, wer abgesichert und diversifiziert war. Hebel kann jetzt tödlich sein.',
  };
  let extra = '';
  const hedged = results.filter((r) => r.d && r.d.hedge);
  if (scenario.name === 'Crash' && hedged.length) extra = ` (${hedged.map((r) => r.fund.name).join(', ')} hatte einen Put – gut gemacht.)`;
  return tips[scenario.name] + extra;
}

// ---------------------------------------------------------------- Spiel
async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(e.message); console.error(HELP); process.exit(2); }
  setColors(!opts.plain && process.stdout.isTTY && !process.env.NO_COLOR);
  if (opts.help) { console.log(HELP); return; }

  const seed = Number.isInteger(opts.seed) ? opts.seed : Math.floor(Math.random() * 1e9);
  const rng = makeRng(seed);
  const io = makeAsk();
  const { ask } = io;

  console.log(C.bold(C.cyan('\n=== Hedgefonds-Manager-Duell ===')));
  console.log('Jede:r von euch verwaltet 100 Mio. € Anlegergeld. Wer nach dem letzten Quartal');
  console.log('die beste risikobereinigte Rendite (Sharpe-Ratio) für die Anleger erzielt, gewinnt.');
  console.log(C.dim(`Gebühren: 2 % Verwaltung p. a. + 20 % Erfolgsprämie über der High-Water-Mark. Seed ${seed}.`));

  let mode = opts.mode;
  while (!mode) {
    const m = await ask('\nModus: 1 = Mensch vs. Mensch, 2 = Mensch vs. Computer, 3 = Computer vs. Computer [2]: ');
    if (m === null) { io.close(); return; }
    mode = { '': 'pvc', 1: 'pvp', 2: 'pvc', 3: 'cvc' }[m.trim()] || null;
  }
  const bots = { pvp: [false, false], pvc: [false, true], cvc: [true, true] }[mode];
  const funds = [];
  for (let i = 0; i < 2; i++) {
    let name = opts.names[i];
    if (!name && !bots[i]) {
      const n = await ask(`Name von Fonds ${i + 1} [Fonds ${i + 1}]: `);
      if (n === null) { io.close(); return; }
      name = n.trim();
    }
    const style = i === 0 && mode === 'cvc' ? 'vorsichtig' : 'mutig';
    const fund = newFund(name || (bots[i] ? `Computer (${style})` : `Fonds ${i + 1}`), bots[i]);
    fund.style = style;
    funds.push(fund);
  }

  for (let q = 1; q <= opts.rounds; q++) {
    if (funds.every((f) => f.closed)) break;
    const scenario = pickScenario(rng);
    const headline = headlineFor(scenario, rng);
    const year = Math.ceil(q / 4);
    console.log(C.bold(`\n--- Quartal ${q}/${opts.rounds} (Jahr ${year}, Q${((q - 1) % 4) + 1}) ---`));
    console.log(`Schlagzeile: ${C.yellow(`„${headline}“`)}`);
    console.log(C.dim(`(Schlagzeilen stimmen nur in etwa ${Math.round(NEWS_RELIABILITY * 100)} % der Fälle.)`));

    for (const f of funds) {
      if (f.closed) continue;
      if (f.isBot) {
        f.decision = botDecision(f, headline, rng, f.style);
      } else {
        f.decision = await humanDecision(ask, f);
        if (!f.decision) { console.log('\nEingabe beendet – Spiel abgebrochen.'); io.close(); return; }
      }
    }

    const ret = drawReturns(scenario, rng);
    console.log(`\nTatsächliches Szenario: ${C.bold(scenario.name)}`);
    console.log('  ' + ASSETS.map((a) => `${a.short} ${fmtPct(ret[a.key])}`).join('   '));

    const results = funds.map((f) => ({ fund: f, d: f.closed ? null : f.decision, r: applyQuarter(f, f.decision, ret) }));
    for (const { fund, d, r } of results) {
      if (!r) continue;
      console.log(`\n  ${C.bold(fund.name)}: ${C.dim(describeDecision(d))}`);
      const parts = [`brutto ${fmtPct(r.gross)}`];
      if (r.borrowCost) parts.push(`Kreditkosten -${r.borrowCost.toFixed(1).replace('.', ',')} %`);
      parts.push(`Gebühren ${fmtMio(r.mgmt + r.perf)}`);
      console.log(`    ${parts.join(' · ')}`);
      console.log(`    netto für Anleger ${fmtPct(r.net)}  →  Fondswert ${C.bold(fmtMio(fund.nav))}`);
      if (fund.closed) console.log(C.red(`    MARGIN CALL! Der Fonds ist unter ${MARGIN_CALL * 100} % gefallen und wird geschlossen.`));
    }
    console.log(`\n  ${C.cyan('Lektion:')} ${lessonFor(scenario, results)}`);

    if (funds.some((f) => !f.isBot) && q < opts.rounds && !funds.every((f) => f.closed)) {
      const c = await ask(C.dim('\n[Enter] für das nächste Quartal, "q" zum Beenden: '));
      if (c === null || c.trim().toLowerCase() === 'q') break;
    }
  }

  // ---------------------------------------------------------- Auswertung
  console.log(C.bold(C.cyan('\n=== Endabrechnung ===')));
  const header = `${pad('Fonds', 22)}${pad('Endwert', 16)}${pad('Rendite', 12)}${pad('Volatilität', 14)}${pad('Max. Drawdown', 16)}${pad('Gebühren', 14)}Sharpe`;
  console.log(C.dim(header));
  const scored = funds.map((f) => ({ f, s: stats(f) }));
  for (const { f, s } of scored) {
    console.log(
      pad(f.name + (f.closed ? ' ✝' : ''), 22) + pad(fmtMio(f.nav), 16) + pad(fmtPct(s.total), 12) +
      pad(`${s.sd.toFixed(1).replace('.', ',')} %`, 14) + pad(`-${f.maxDD.toFixed(1).replace('.', ',')} %`, 16) +
      pad(fmtMio(f.feesPaid), 14) + s.sharpe.toFixed(2).replace('.', ','),
    );
  }
  const score = ({ f, s }) => (f.closed ? -Infinity : s.sharpe);
  const [a, b] = scored;
  let verdict;
  if (score(a) === score(b)) verdict = 'Unentschieden!';
  else verdict = `${C.bold((score(a) > score(b) ? a : b).f.name)} gewinnt mit der besseren Sharpe-Ratio!`;
  console.log(`\n${verdict}`);
  const byReturn = scored.slice().sort((x, y) => y.s.total - x.s.total)[0];
  const bySharpe = scored.slice().sort((x, y) => score(y) - score(x))[0];
  if (byReturn !== bySharpe && byReturn.s.total > bySharpe.s.total && byReturn.s.sd > bySharpe.s.sd) {
    console.log(C.dim(`Beachte: ${byReturn.f.name} erzielte zwar mehr Rendite, ging dafür aber mehr Risiko ein.`));
  }
  console.log(C.dim(`
Begriffe:
  Volatilität    – Schwankung der Quartalsrenditen (Risiko).
  Max. Drawdown  – größter Verlust vom bisherigen Höchststand.
  Sharpe-Ratio   – Rendite über dem risikolosen Zins geteilt durch Volatilität (annualisiert;
                   bei Verlusten modifiziert, damit mehr Risiko nicht belohnt wird).
  High-Water-Mark – Erfolgsprämie gibt es nur auf neue Höchststände.
Gleiche Partie nochmal spielen: --seed ${seed}`));
  io.close();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { makeRng, applyQuarter, newFund, stats, parseArgs, SCENARIOS };
