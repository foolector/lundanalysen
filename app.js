/* Valdistrikt i Lund - all logik i en fil, inga beroenden.
   Data läses från data/lund.js (window.VALDATA) så att sidan även fungerar
   när den öppnas direkt från hårddisken. */
(function () {
"use strict";

/* Datat sätts av data/lund.js, eller av las.js när en låst fil låsts upp. */
var D = window.VALDATA;

var PARTINAMN = {
  S: "Socialdemokraterna", V: "Vänsterpartiet", MP: "Miljöpartiet",
  C: "Centerpartiet", L: "Liberalerna", KD: "Kristdemokraterna",
  M: "Moderaterna", SD: "Sverigedemokraterna", "ÖVR": "Övriga partier",
  /* Lokala och mindre partier: bara i kommunvalet och mandatfördelningen. */
  FNL: "FörNyaLund", FI: "Feministiskt initiativ"
};
/* Partifärgerna är bara identitetsmarkörer intill text - de bär aldrig
   informationen ensamma, eftersom flera av dem är svåra att skilja åt. */
var PARTIFARG = {
  S: "#e8112d", V: "#af0000", MP: "#83cf39", C: "#009933", L: "#006ab3",
  KD: "#000077", M: "#52bdec", SD: "#dddd00", "ÖVR": "#898781",
  FNL: "#2a8c7e", FI: "#cd1b68"
};
var SEQ = ["--seq1", "--seq2", "--seq3", "--seq4", "--seq5", "--seq6", "--seq7"];
var DIV = ["--div1", "--div2", "--div3", "--div4", "--div5", "--div6", "--div7"];
/* Streckmönstret över uppskattade värden måste synas mot fyllningen det ligger
   på: textfärg på de ljusa stegen, ytfärg på de mörka. Valet per steg är räknat
   på båda temanas färger och på strecken som de faktiskt ritas (opaciteten
   nedan inräknad) - sämsta steget får 3,9:1 mot sin fyllning. */
var SEQ_STRECK = ["text", "text", "text", "text", "yta", "yta", "yta"];
var DIV_STRECK = ["yta", "text", "text", "text", "text", "text", "yta"];
var LAGRING = "valsidan-lund-v1";
var TOPPLISTA = 10;   // antal distrikt i varje topplista under kartan

var state = {
  partier: ["MP"],
  valtyp: "RD",
  ar: null,      // sätts från datat när det finns (kan vara låst vid inladdning)
  jmfar: null,
  matt: "andel",
  lager: { befolkning: false, tathet: false, centrum: false, vallokaler: false, orter: true, kampanjer: false },
  tathetGrans: 2000,
  utsnitt: "alla",
  indexFilter: false,
  indexGrans: 110,
  visaUppskattade: true,
  flik: "karta",
  sortKol: "andel",
  sortRiktning: -1,
  sok: "",
  ort: "",
  distrikt: null,
  mobilisering: 10,       // procent av dem som inte röstade som kampanjen kan få att rösta
  overtalning: 3,         // procent av närliggande partiers väljare som kan övertygas
  narliggande: ["S", "V", "C"],
  rangordning: "totalt",
  effektKampanj: null,    // kampanjen i fliken Kampanjeffekt - null är den senaste
  tema: "auto"
};

try {
  var sparat = JSON.parse(localStorage.getItem(LAGRING) || "null");
  if (sparat) { for (var k in sparat) if (k in state) state[k] = sparat[k]; }
} catch (e) { /* privat läge eller blockerad lagring - kör på med förvalen */ }

function spara() {
  try { localStorage.setItem(LAGRING, JSON.stringify(state)); } catch (e) { /* strunt samma */ }
}

/* ---------- små hjälpare ---------- */

var $ = function (id) { return document.getElementById(id); };

/* Ett talformat per antal decimaler: toLocaleString bygger ett nytt för varje
   tal, och fliken Kampanjeffekt skriver ut flera hundra. */
var talformat = {};
function tal(v, dec) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  dec = dec || 0;
  if (!talformat[dec]) talformat[dec] = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return talformat[dec].format(v);
}
function proc(v, dec) { return v === null || v === undefined || isNaN(v) ? "–" : tal(v, dec === undefined ? 1 : dec) + " %"; }
function tecken(v, dec) {
  if (v === null || v === undefined || isNaN(v)) return "–";
  return (v > 0 ? "+" : "") + tal(v, dec === undefined ? 1 : dec);
}
function gruppnamn() {
  if (!state.partier.length) return "inget parti";
  var ordning = D.partier.filter(function (p) { return state.partier.indexOf(p) >= 0; });
  return ordning.join("+");
}

/* ---------- datauppslag ---------- */

function post(d, ar) {
  var r = d.val[state.valtyp] && d.val[state.valtyp][ar];
  if (!r) return null;
  if (r.matchning === "uppskattad" && !state.visaUppskattade) return null;
  return r;
}
function gruppRoster(r) {
  var s = 0;
  for (var i = 0; i < state.partier.length; i++) s += r.roster[state.partier[i]] || 0;
  return s;
}
function andel(r) { return r && r.giltiga ? 100 * gruppRoster(r) / r.giltiga : null; }
function kommunPost(ar) { return D.kommun[state.valtyp][ar]; }
function kommunAndel(ar) {
  var r = kommunPost(ar);
  return r && r.giltiga ? 100 * gruppRoster(r) / r.giltiga : null;
}

/* Förtidsröster som inte hann fram till vallokalen räknas i
   uppsamlingsdistriktet, och de som lade dem räknas då inte som röstande i
   sitt eget distrikt - Valmyndighetens siffror per distrikt räknar dem som om
   de inte röstat. I riksdagsvalet 2026 gällde det 3 473 väljare, och summan
   av distriktens "röstade ej" blev 29 % större än det verkliga antalet. Här
   fördelas de ut på distrikten i proportion till hur många som röstade i
   distriktet, så att distriktens valdeltagande går ihop med kommunens. */
function uppraknad(ar) {
  var k = D.kommun[state.valtyp][ar], u = (D.uppsamlingsdistrikt[state.valtyp] || {})[ar];
  if (!k || !u || !u.rostande || k.rostande <= u.rostande) return 1;
  return k.rostande / (k.rostande - u.rostande);
}
function rostande(r, ar) { return Math.min(r.rostberattigade, r.rostande * uppraknad(ar)); }
function valdeltagande(r, ar) { return r && r.rostberattigade ? 100 * rostande(r, ar) / r.rostberattigade : null; }
function ejRostande(r, ar) { return r ? r.rostberattigade - rostande(r, ar) : null; }
function tathet(d, r) { return r && d.km2 ? r.rostberattigade / d.km2 : null; }

/* Index: distriktets andel delad med kommunens, gånger 100. */
function indexFor(d, ar) {
  var r = post(d, ar);
  if (!r) return null;
  var ka = kommunAndel(ar), a = andel(r);
  return (ka && a !== null) ? 100 * a / ka : null;
}
function indexvarde(d) { return indexFor(d, state.ar); }

/* ---------- jämförelseenheter ---------- */

/* 24 distrikt ritades om till 2026, och deras historik är uppskattad ur ytan -
   vilket slår fel just där folk flyttat in, eftersom metoden antar att de bor
   jämnt. Omritningarna flyttar oftast bara gränsen mellan några grannar, och
   tillsammans täcker grannarna samma yta som några gamla distrikt. Bygget
   lägger därför ihop dem i jämförelsegrupper vars historik är exakt: summan
   av de gamla distrikten. All förändring över tid räknas på sådana enheter -
   ett distrikt för sig där gränserna gick att jämföra, en grupp där de inte
   gjorde det. Nivåerna ett visst år räknas som förut, per distrikt. */
var indelningar = {};
function grupperFor(ar) {
  return (D.jamforelsegrupper && D.jamforelsegrupper[ar]) || [];
}
function harGrupper() { return !!D.jamforelsegrupper; }

/* Enheterna för en jämförelse mellan två år: grupperna från båda åren slås
   ihop där de överlappar, så att varje enhet täcker samma yta alla tre gångerna. */
function indelning(ar, jmfar) {
  var nyckel = ar + "|" + jmfar;
  if (indelningar[nyckel]) return indelningar[nyckel];
  var rot = {};
  function hitta(k) { while (rot[k] && rot[k] !== k) k = rot[k]; return k; }
  D.distrikt.forEach(function (d) { rot[d.kod] = d.kod; });
  [ar, jmfar].forEach(function (a) {
    grupperFor(a).forEach(function (g) {
      g.distrikt.forEach(function (k) { if (rot[k]) rot[hitta(k)] = hitta(g.distrikt[0]); });
    });
  });
  var perRot = {}, lista = [], perKod = {};
  D.distrikt.forEach(function (d) {
    var r = hitta(d.kod);
    if (!perRot[r]) { perRot[r] = { id: r, distrikt: [] }; lista.push(perRot[r]); }
    perRot[r].distrikt.push(d);
    perKod[d.kod] = perRot[r];
  });
  lista.forEach(function (e) {
    e.koder = e.distrikt.map(function (d) { return d.kod; });
    e.namn = e.distrikt.map(function (d) { return d.namn; }).join(" + ");
    e.km2 = e.distrikt.reduce(function (s, d) { return s + d.km2; }, 0);
  });
  return (indelningar[nyckel] = { lista: lista, perKod: perKod });
}
function enhet(d, ar, jmfar) { return indelning(ar || state.ar, jmfar || state.jmfar).perKod[d.kod]; }

function summaPost(delar) {
  var t = { roster: {}, giltiga: 0, rostande: 0, rostberattigade: 0 };
  delar.forEach(function (r) {
    for (var p in r.roster) t.roster[p] = (t.roster[p] || 0) + r.roster[p];
    t.giltiga += r.giltiga; t.rostande += r.rostande; t.rostberattigade += r.rostberattigade;
  });
  return t;
}

/* Enhetens röster ett visst år. Distrikt i en jämförelsegrupp det året tar
   gruppens exakta summa (en gång per grupp), övriga sin egen post. Utan
   grupper i datat (äldre datafil) blir det som förut, distrikt för distrikt. */
function enhetspost(e, ar) {
  var valtyp = state.valtyp, delar = [], tackta = {};
  if (!harGrupper()) {
    for (var i = 0; i < e.distrikt.length; i++) {
      var r0 = post(e.distrikt[i], ar);
      if (!r0) return null;
      delar.push(r0);
    }
    return delar.length === 1 ? delar[0] : summaPost(delar);
  }
  var grupper = grupperFor(ar);
  for (var g = 0; g < grupper.length; g++) {
    if (e.koder.indexOf(grupper[g].distrikt[0]) < 0) continue;
    var gp = grupper[g].val[valtyp];
    if (!gp) return null;
    delar.push(gp);
    grupper[g].distrikt.forEach(function (k) { tackta[k] = true; });
  }
  for (var j = 0; j < e.distrikt.length; j++) {
    var d = e.distrikt[j];
    if (tackta[d.kod]) continue;
    var r = d.val[valtyp] && d.val[valtyp][ar];
    if (!r) return null;
    delar.push(r);
  }
  return delar.length === 1 ? delar[0] : summaPost(delar);
}

function indexAvPost(r, ar) {
  var ka = kommunAndel(ar), a = r ? andel(r) : null;
  return (ka && a !== null) ? 100 * a / ka : null;
}

/* Allt en jämförelse mellan två år behöver för en enhet. Rösterna delas upp
   i tre delar som tillsammans blir hela förändringen: fler eller färre
   röstberättigade, högre eller lägre valdeltagande (giltiga röster per
   röstberättigad) och större eller mindre andel av de giltiga rösterna.
   Röster = röstberättigade × deltagande × andel, och varje dels bidrag är
   medelvärdet över de sex ordningar som de tre faktorerna kan ändras i
   (Shapley-uppdelning). Då summerar delarna exakt till förändringen - ett
   enkelt medelvärde av de två andra faktorerna före och efter lämnar en rest
   på halva produkten av de tre förändringarna. */
function shapleyVikt(a0, a1, b0, b1) { return (2 * a0 * b0 + a0 * b1 + a1 * b0 + 2 * a1 * b1) / 6; }
function jamforelse(e, ar, jmfar) {
  ar = ar || state.ar; jmfar = jmfar || state.jmfar;
  if (ar === jmfar) return null;
  var nu = enhetspost(e, ar), fore = enhetspost(e, jmfar);
  if (!nu || !fore || !nu.giltiga || !fore.giltiga || !nu.rostberattigade || !fore.rostberattigade) return null;
  var E0 = fore.rostberattigade, E1 = nu.rostberattigade;
  var T0 = fore.giltiga / E0, T1 = nu.giltiga / E1;
  var S0 = gruppRoster(fore) / fore.giltiga, S1 = gruppRoster(nu) / nu.giltiga;
  return {
    enhet: e, nu: nu, fore: fore,
    forandring: 100 * (S1 - S0),
    indexforandring: indexAvPost(nu, ar) - indexAvPost(fore, jmfar),
    roster: gruppRoster(nu) - gruppRoster(fore),
    vaxt: (E1 - E0) * shapleyVikt(T0, T1, S0, S1),
    deltagande: (T1 - T0) * shapleyVikt(E0, E1, S0, S1),
    andel: (S1 - S0) * shapleyVikt(E0, E1, T0, T1)
  };
}
function jamforelseFor(d) { return jamforelse(enhet(d)); }

/* Förändringen i index mellan två val. Till skillnad från förändringen i
   procentenheter räknar den bort det som hände i hela kommunen: ett distrikt
   som följde med Lund i stort får 0, oavsett hur mycket partiet gick upp
   eller ned totalt. Det är därför måttet som kampanjeffekten bygger på. */
function indexForandring(d, ar, jmfar) {
  var j = jamforelse(enhet(d, ar, jmfar), ar, jmfar);
  return j ? j.indexforandring : null;
}

/* Röster i kommunvalet minus röster i riksdagsvalet samma år, för samma
   distrikt och partigrupp. Oberoende av vilket val som är valt. */
function delade(d) {
  var kf = d.val.KF && d.val.KF[state.ar], rd = d.val.RD && d.val.RD[state.ar];
  if (!kf || !rd) return null;
  if (!state.visaUppskattade && (kf.matchning === "uppskattad" || rd.matchning === "uppskattad")) return null;
  return gruppRoster(kf) - gruppRoster(rd);
}

/* Mått som jämför två år räknas per jämförelseenhet, inte per distrikt. */
function arForandringsmatt(m) {
  m = m || state.matt;
  return m === "forandring" || m === "indexforandring" || m === "rosterforandring";
}

/* Indexgränsen gäller bara kampanjprioriteringen: den svarar på "var ska vi
   lägga krafterna om vi bara går dit vi redan är starka". Karta och tabell
   visar samma sak med måttet index, så där behövs den inte. */
function passerar(d) {
  if (!state.indexFilter) return true;
  var i = indexvarde(d);
  return i !== null && i > state.indexGrans;
}

/* Värdet som färglägger kartan och sorterar tabellen. */
function matvarde(d) {
  var r = post(d, state.ar);
  if (!r) return null;
  switch (state.matt) {
    case "andel": return andel(r);
    case "roster": return gruppRoster(r);
    case "tathet": return tathet(d, r);
    case "valdeltagande": return valdeltagande(r, state.ar);
    case "index":
      return indexvarde(d);
    case "delade": return delade(d);
    case "indexforandring":
    case "forandring":
    case "rosterforandring":
      var j = jamforelseFor(d);
      if (!j) return null;
      return state.matt === "rosterforandring" ? j.roster : j[state.matt];
  }
  return null;
}
function mattEtikett() {
  return {
    andel: "Andel av giltiga röster",
    index: "Index mot kommunsnittet (100 = som Lund i stort)",
    forandring: "Förändring i procentenheter sedan " + state.jmfar,
    indexforandring: "Förändring i index mot kommunsnittet sedan " + state.jmfar,
    roster: "Antal röster",
    rosterforandring: "Förändring i antal röster sedan " + state.jmfar,
    delade: "Röster i kommunvalet minus röster i riksdagsvalet",
    tathet: "Röstberättigade per km²",
    valdeltagande: "Valdeltagande"
  }[state.matt];
}
/* Kortformen används till brytpunkterna i teckenförklaringen, där enheten
   redan står i kartrubriken och siffrorna står tätt. */
function kortMatt(v) {
  if (v === null) return "–";
  if (state.matt === "roster" || state.matt === "tathet") return tal(v);
  if (state.matt === "rosterforandring" || state.matt === "delade") return tecken(v, 0);
  if (state.matt === "index") return tal(v, 0);
  if (state.matt === "forandring") return tecken(v);
  if (state.matt === "indexforandring") return tecken(v, 0);
  return tal(v, 1);
}
function formatMatt(v) {
  if (v === null) return "–";
  if (state.matt === "roster") return tal(v);
  if (state.matt === "rosterforandring" || state.matt === "delade") return tecken(v, 0) + " röster";
  if (state.matt === "tathet") return tal(v);
  if (state.matt === "index") return tal(v, 0);
  if (state.matt === "forandring") return tecken(v) + " p.e.";
  if (state.matt === "indexforandring") return tecken(v, 0) + " indexenheter";
  return proc(v);
}

/* ---------- färgskalor ---------- */

function stigande(a, b) { return a - b; }

/* Värdet vid andelen p av en redan sorterad lista, linjärt mellan grannarna. */
function kvantil(sorterad, p) {
  var pos = p * (sorterad.length - 1);
  var i = Math.floor(pos), rest = pos - i;
  if (i + 1 >= sorterad.length) return sorterad[sorterad.length - 1];
  return sorterad[i] + rest * (sorterad[i + 1] - sorterad[i]);
}

/* Plockar n jämnt spridda färger ur en ramp, ändarna inkluderade. */
function urRamp(index, n) {
  if (n >= index.length) return index;
  if (n < 2) return [index[index.length - 1]];
  var ut = [];
  for (var i = 0; i < n; i++) ut.push(index[Math.round(i * (index.length - 1) / (n - 1))]);
  return ut;
}

function skala() {
  /* Förändringsmåtten har ett värde per jämförelseenhet - en grupp räknas en
     gång, inte en gång per distrikt i den. */
  var sedda = {};
  var varden = D.distrikt.filter(function (d) {
    if (!arForandringsmatt()) return true;
    var e = enhet(d);
    if (sedda[e.id]) return false;
    return (sedda[e.id] = true);
  }).map(matvarde).filter(function (v) { return v !== null; });
  if (!varden.length) return null;
  varden.sort(stigande);
  var min = varden[0], max = varden[varden.length - 1];
  var index = [], i, j;
  if (state.matt === "index" || arForandringsmatt() || state.matt === "delade") {
    var mitt = state.matt === "index" ? 100 : 0;
    /* Steget sätts av 90:e percentilen av avvikelserna, inte av den största.
       Med den största räcker ett enda ytterdistrikt för att äta upp skalan:
       hälften av stegen blir tomma och nästan alla distrikt får samma färg.
       Ytterstegen är öppna uppåt och nedåt och fångar det som sticker ut. */
    var avvikelser = varden.map(function (v) { return Math.abs(v - mitt); }).sort(stigande);
    var steg = kvantil(avvikelser, 0.9) / 3 || 1;
    var brytpunkter = [];
    for (i = -2.5; i <= 2.5; i += 1) brytpunkter.push(mitt + i * steg);
    return { typ: "div", farger: DIV, streck: DIV_STRECK, brytpunkter: brytpunkter,
      min: min, max: max, mitt: mitt };
  }
  /* Kvantiler i stället för lika breda intervall: brytpunkterna läggs där
     distrikten faktiskt ligger, så att varje steg får ungefär lika många.
     Lika breda intervall ser prydligare ut i teckenförklaringen men ett enda
     ytterdistrikt trycker ihop alla andra i ett par steg. Priset är att
     brytpunkterna måste skrivas ut - det gör ritaTeckenforklaring. */
  for (i = 0; i < SEQ.length; i++) index.push(i);
  var b = [];
  for (j = 1; j < index.length; j++) {
    var bp = kvantil(varden, j / index.length);
    /* Många lika värden kan ge sammanfallande brytpunkter - då faller steget
       bort, annars hade det blivit en färg som ingenting kan hamna i. */
    if (!b.length || bp > b[b.length - 1]) b.push(bp);
  }
  index = urRamp(index, b.length + 1);
  return { typ: "seq", brytpunkter: b, min: min, max: max,
    farger: index.map(function (k) { return SEQ[k]; }),
    streck: index.map(function (k) { return SEQ_STRECK[k]; }) };
}

/* Vilket steg ett värde hamnar i, eller -1 när det inte går att färglägga. */
function stegindex(sk, v) {
  if (sk === null || v === null) return -1;
  var i = 0;
  while (i < sk.brytpunkter.length && v > sk.brytpunkter[i]) i++;
  return i;
}

/* ---------- kartan ---------- */

var kartlager = null;
function kartgeometri() {
  if (kartlager) return kartlager;
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  D.distrikt.forEach(function (d) {
    d.geometri.forEach(function (ring) {
      ring.forEach(function (p) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      });
    });
  });
  var banor = {};
  D.distrikt.forEach(function (d) {
    banor[d.kod] = d.geometri.map(function (ring) {
      return "M" + ring.map(function (p) { return p[0] + "," + (-p[1]); }).join("L") + "Z";
    }).join("");
  });
  kartlager = { minX: minX, minY: minY, maxX: maxX, maxY: maxY, banor: banor };
  return kartlager;
}

function utsnittslista() {
  var orter = [];
  D.distrikt.forEach(function (d) { if (orter.indexOf(d.ort) < 0) orter.push(d.ort); });
  orter.sort(function (a, b) { return a.localeCompare(b, "sv"); });
  return orter;
}

/* Områdena i det valda utsnittet - "tatort" är flera områden på en gång. */
function utsnittsomraden() {
  if (state.utsnitt === "alla") return null;   // null = ingen begränsning
  if (state.utsnitt === "tatort") {
    var finns = utsnittslista();
    return (D.meta.tatort || []).filter(function (o) { return finns.indexOf(o) >= 0; });
  }
  return [state.utsnitt];
}

/* Kartans ruta: hela kommunen eller ett område inzoomat. */
function utsnittsruta() {
  var g = kartgeometri();
  if (state.utsnitt === "alla") {
    return { x0: g.minX, y0: g.minY, x1: g.maxX, y1: g.maxY, marginal: 0.02 };
  }
  var omraden = utsnittsomraden() || [];
  var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  D.distrikt.forEach(function (d) {
    if (omraden.indexOf(d.ort) < 0) return;
    d.geometri.forEach(function (ring) {
      ring.forEach(function (p) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      });
    });
  });
  if (!isFinite(x0)) return { x0: g.minX, y0: g.minY, x1: g.maxX, y1: g.maxY, marginal: 0.02 };
  return { x0: x0, y0: y0, x1: x1, y1: y1, marginal: 0.06 };
}

/* Grundvyn för valt utsnitt, som [x, y, bredd, höjd] i kartans koordinater
   (y är negerad eftersom SVG räknar nedåt). */
function basvy() {
  var ruta = utsnittsruta();
  var marginal = Math.max(ruta.x1 - ruta.x0, ruta.y1 - ruta.y0) * ruta.marginal;
  return [ruta.x0 - marginal, -(ruta.y1 + marginal),
    ruta.x1 - ruta.x0 + 2 * marginal, ruta.y1 - ruta.y0 + 2 * marginal];
}

/* Null = ingen egen zoom, följ utsnittet. Sätts av hjul, dragning och knappar. */
var kartvy = null;

function aktuellVy() { return kartvy || basvy(); }

function ritaKarta() {
  var g = kartgeometri();
  var sk = skala();
  var vy = aktuellVy();
  var bredd = vy[2], hojd = vy[3];
  /* En "enhet" är ungefär en bildpunkt: allt som ska se lika stort ut oavsett
     zoomnivå (text, punkter, streckmönster) mäts i enheter. */
  var enhet = Math.max(bredd, hojd) / 1000;
  var bas = basvy();
  /* "Zoomat" styr detaljnivån: distriktsnamn och lokalnamn ritas ut först när
     vyn är tillräckligt liten för att de ska få plats. */
  var zoomat = state.utsnitt !== "alla" || bredd < Math.max(bas[2], bas[3]) * 0.55;
  var svg = $("karta");
  svg.setAttribute("viewBox", vy.join(" "));
  var bitar = [];
  var rut = Math.round(8 * enhet);
  function streckmonster(namn, farg) {
    return '<pattern id="strecka-' + namn + '" width="' + rut + '" height="' + rut +
      '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="' + rut + '" style="stroke:var(' + farg + ')" stroke-width="' +
      Math.round(rut * 0.4) + '" stroke-opacity="0.85"/></pattern>';
  }
  var prick = Math.round(7 * enhet);
  bitar.push('<defs>' + streckmonster("yta", "--yta") + streckmonster("text", "--text") +
    '<pattern id="ingenuppgift" width="' + prick + '" height="' + prick + '" patternUnits="userSpaceOnUse">' +
    '<rect width="' + prick + '" height="' + prick + '" style="fill:var(--yta)"/>' +
    '<circle cx="' + Math.round(prick / 2) + '" cy="' + Math.round(prick / 2) + '" r="' +
    Math.max(1, Math.round(1.2 * enhet)) + '" style="fill:var(--dampad)"/></pattern></defs>');

  /* Alla distrikt som en enda bana underst. Distriktens egna fyllningar täcker
     den överallt utom längst ut, så det som blir kvar är kommunens ytterkant -
     utan den flyter ljusa gränsdistrikt ihop med sidan. */
  bitar.push('<path class="ytterkant" pointer-events="none" d="' +
    D.distrikt.map(function (d) { return g.banor[d.kod]; }).join("") + '"/>');

  D.distrikt.forEach(function (d) {
    var r = post(d, state.ar);
    var v = matvarde(d);
    var steg = stegindex(sk, v);
    /* Distrikt utan uppgift får prickmönstret, inte en färg ur rampen: ett
       blekt grått fält går inte att skilja från mitten på den divergerande
       skalan, men ett mönster går inte att förväxla med någon fyllning alls. */
    var fyll = steg < 0 ? "url(#ingenuppgift)" : "var(" + sk.farger[steg] + ")";
    bitar.push('<path class="distrikt" data-kod="' + d.kod +
      '" d="' + g.banor[d.kod] + '" style="fill:' + fyll +
      '"><title>' + esc(d.namn) + "</title></path>");
    if (steg >= 0 && r && r.matchning === "uppskattad" && !arForandringsmatt()) {
      bitar.push('<path d="' + g.banor[d.kod] + '" fill="url(#strecka-' + sk.streck[steg] +
        ')" pointer-events="none"/>');
    }
  });
  /* Förändringen i en jämförelsegrupp gäller hela gruppen, så gruppen ritas
     som en yta: en fyllning över medlemmarna döljer gränserna mellan dem. */
  if (arForandringsmatt()) {
    indelning(state.ar, state.jmfar).lista.forEach(function (e) {
      if (e.distrikt.length < 2) return;
      var steg = stegindex(sk, matvarde(e.distrikt[0]));
      if (steg < 0) return;
      bitar.push('<path class="enhetsyta" pointer-events="none" d="' +
        e.distrikt.map(function (d) { return g.banor[d.kod]; }).join("") +
        '" style="fill:var(' + sk.farger[steg] + ')"/>');
    });
  }

  if (state.lager.tathet) {
    D.distrikt.forEach(function (d) {
      var r = post(d, state.ar);
      var t = tathet(d, r);
      if (t !== null && t >= state.tathetGrans) {
        bitar.push('<path class="tat" d="' + g.banor[d.kod] + '" stroke-dasharray="' +
          Math.round(5 * enhet) + " " + Math.round(3 * enhet) + '"/>');
      }
    });
  }
  if (state.lager.befolkning) {
    var maxRb = Math.max.apply(null, D.distrikt.map(function (d) {
      var r = post(d, state.ar); return r ? r.rostberattigade : 0;
    }));
    D.distrikt.forEach(function (d) {
      var r = post(d, state.ar);
      if (!r || !r.rostberattigade) return;
      var radie = 34 * enhet * Math.sqrt(r.rostberattigade / maxRb);
      bitar.push('<circle class="befolkning" cx="' + d.centroid[0] + '" cy="' + (-d.centroid[1]) +
        '" r="' + Math.round(radie) + '"/>');
    });
  }
  /* Etiketter placeras i prioritetsordning och hoppas över när de krockar
     med en redan utsatt etikett - annars blir stadens distrikt oläsliga. */
  var placerade = [];
  function ledig(x, y, textlangd, storlek) {
    var w = textlangd * storlek * 0.55, h = storlek * 1.2;
    for (var i = 0; i < placerade.length; i++) {
      var p = placerade[i];
      if (Math.abs(x - p.x) < (w + p.w) / 2 && Math.abs(y - p.y) < (h + p.h) / 2) return false;
    }
    placerade.push({ x: x, y: y, w: w, h: h });
    return true;
  }
  var etiketter = [];

  if (state.lager.orter) {
    var orter = {};
    D.distrikt.forEach(function (d) {
      var o = orter[d.ort] || (orter[d.ort] = { x: 0, y: 0, n: 0 });
      o.x += d.centroid[0]; o.y += d.centroid[1]; o.n++;
    });
    var iUtsnitt = utsnittsomraden();
    Object.keys(orter).forEach(function (namn) {
      if (iUtsnitt && iUtsnitt.indexOf(namn) < 0) return;
      var o = orter[namn], storlek = Math.round(15 * enhet);
      var x = Math.round(o.x / o.n), y = Math.round(-o.y / o.n);
      if (!ledig(x, y, namn.length, storlek)) return;
      etiketter.push('<text class="ort" text-anchor="middle" font-size="' + storlek +
        '" x="' + x + '" y="' + y + '">' + esc(namn) + "</text>");
    });
  }
  if (state.lager.centrum) {
    D.lokaler.fortidsrostning.forEach(function (l) {
      bitar.push('<circle class="lokalring" cx="' + l.x + '" cy="' + (-l.y) + '" r="' +
        Math.round(5 * enhet) + '"><title>' + esc(l.namn + ", " + l.adress) + "</title></circle>");
      var storlek = Math.round(10 * enhet);
      var x = l.x + 8 * enhet + l.namn.length * storlek * 0.275, y = -l.y + 4 * enhet;
      if (!ledig(x, y, l.namn.length, storlek)) return;
      etiketter.push('<text class="lokaltext" font-size="' + storlek + '" x="' +
        Math.round(l.x + 8 * enhet) + '" y="' + Math.round(y) + '">' + esc(l.namn) + "</text>");
    });
  }
  if (zoomat) {
    var omradenNu = utsnittsomraden();
    D.distrikt.forEach(function (d) {
      if (omradenNu && omradenNu.indexOf(d.ort) < 0) return;
      var namn = kortnamn(d.namn), storlek = Math.round(9 * enhet);
      if (!ledig(d.centroid[0], -d.centroid[1], namn.length, storlek)) return;
      etiketter.push('<text class="distriktnamn" text-anchor="middle" font-size="' + storlek +
        '" x="' + d.centroid[0] + '" y="' + (-d.centroid[1]) + '">' + esc(namn) + "</text>");
    });
  }
  if (state.lager.vallokaler) {
    D.lokaler.vallokaler.forEach(function (l) {
      bitar.push('<circle class="lokal" cx="' + l.x + '" cy="' + (-l.y) + '" r="' +
        Math.round(3 * enhet) + '"><title>' + esc(l.namn + ", " + l.adress) + "</title></circle>");
      if (!zoomat) return;
      var storlek = Math.round(9 * enhet);
      var x = l.x + 6 * enhet + l.namn.length * storlek * 0.275, y = -l.y + 3 * enhet;
      if (!ledig(x, y, l.namn.length, storlek)) return;
      etiketter.push('<text class="lokaltext" font-size="' + storlek + '" x="' +
        Math.round(l.x + 6 * enhet) + '" y="' + Math.round(y) + '">' + esc(l.namn) + "</text>");
    });
  }
  /* Markeringen av distriktet under pekaren och det fastnålade ligger i ett
     eget lager ovanför alla fyllningar. Ett streck på distriktets egen bana
     täcktes till hälften av grannarna som ritades efter det, så kanten blev
     dubbelt så tjock på några sidor som på andra. Ytfärgen under textfärgen
     gör att kanten syns både mot de ljusaste och de mörkaste stegen. */
  bitar.push('<g class="markering" pointer-events="none">' +
    '<path class="halo" id="markVald"/><path class="linje" id="markValdLinje"/>' +
    '<path class="halo" id="markHovrad"/><path class="linje" id="markHovradLinje"/></g>');
  bitar = bitar.concat(etiketter);
  /* Kampanjmärkena ligger överst - de är små och ska gå att hovra över även
     där de hamnar ovanpå ett namn. */
  if (state.lager.kampanjer) bitar = bitar.concat(kampanjmarken(enhet));

  svg.innerHTML = bitar.join("");
  markeraKarta();
  ritaTeckenforklaring(sk);
  $("kartrubrik").textContent = mattEtikett() + " – " + gruppnamn() + ", " +
    D.valtyper[state.valtyp].toLowerCase() + " " + state.ar +
    (zoomat ? " · " + (state.utsnitt === "tatort" ? "Lund tätort" : state.utsnitt) : "");
  ritaFastTips();
}

/* ---------- kampanjlagret ---------- */

function kampanjtyper() {
  return D.kampanjer ? Object.keys(D.kampanjer.typer) : [];
}
function kampanjtyp(typ) { return D.kampanjer.typer[typ]; }

/* Kampanjerna finns per val: varje aktivitet har året för valet den gjordes
   inför. En äldre datafil har bara en kampanj och inget år - den gäller då
   det senaste valet. */
function kampanjAr() {
  return D.kampanjer ? (D.kampanjer.ar || [D.ar[0]]) : [];
}
function aktivitetAr(a) { return a.ar || D.ar[0]; }
function aktiviteter(ar) {
  return D.kampanjer ? D.kampanjer.aktiviteter.filter(function (a) { return aktivitetAr(a) === ar; }) : [];
}
/* Kampanjlagret visar kampanjen inför valet som kartan visar, så att förra
   valets kampanj ligger över förra valets resultat. För ett val utan
   kampanjdata ritas inga märken. */
function kartansKampanj() { return kampanjAr().indexOf(state.ar) >= 0 ? state.ar : null; }
/* Kampanjåren med ett visst år först - det som kartan visar. */
function kampanjArMedForst(ar) {
  var lista = kampanjAr().slice();
  lista.sort(function (a, b) { return (b === ar) - (a === ar); });
  return lista;
}

/* Aktiviteterna grupperade efter var de ritas: en punkt där de ägde rum,
   eller mitt i varje distrikt de riktade sig till. Samma plats och typ blir
   ett märke med antalet utskrivet. Aktiviteter som nådde hela kommunen eller
   saknar plats kan inte ritas - de räknas upp i teckenförklaringen. Märkena
   pekar på aktiviteternas plats i hela listan, alla kampanjer. */
var kampanjgrupper = {};
function kampanjplatser(ar) {
  if (kampanjgrupper[ar]) return kampanjgrupper[ar];
  var grupper = {}, ordning = [];
  function grupp(nyckel, x, y, rubrik) {
    if (!grupper[nyckel]) {
      grupper[nyckel] = { x: x, y: y, rubrik: rubrik, typer: {} };
      ordning.push(nyckel);
    }
    return grupper[nyckel];
  }
  (D.kampanjer ? D.kampanjer.aktiviteter : []).forEach(function (a, i) {
    if (aktivitetAr(a) !== ar) return;
    var mal = [];
    if (a.x !== undefined) mal.push(grupp("p" + a.x + "," + a.y, a.x, a.y, a.plats));
    else if (a.distrikt) a.distrikt.forEach(function (kod) {
      var d = hittaDistrikt(kod);
      mal.push(grupp("d" + kod, d.centroid[0], d.centroid[1], d.namn));
    });
    mal.forEach(function (g) { (g.typer[a.typ] = g.typer[a.typ] || []).push(i); });
  });
  kampanjgrupper[ar] = ordning.map(function (k) { return grupper[k]; });
  return kampanjgrupper[ar];
}

/* Aktiviteterna i en kampanj som ägde rum i eller riktade sig till ett distrikt. */
function kampanjerI(kod, ar) {
  return aktiviteter(ar).filter(function (a) { return a.distrikt && a.distrikt.indexOf(kod) >= 0; });
}

/* Ett märke per typ och plats: bokstaven för typen och antalet om det är fler
   än en. Aktiviteter som riktade sig till de boende har fylld bakgrund, de som
   ägde rum på en plats dit folk kom har bara en ram - skillnaden bärs av
   formen, inte av en färg. */
function kampanjmarken(enhet) {
  var ut = [], typer = kampanjtyper(), ar = kartansKampanj();
  if (!ar) return ut;
  var hojd = 15 * enhet, tecken = 7 * enhet, luft = 2 * enhet;
  kampanjplatser(ar).forEach(function (g) {
    var marken = typer.filter(function (t) { return g.typer[t]; }).map(function (t) {
      var n = g.typer[t].length;
      var text = kampanjtyp(t).bokstav + (n > 1 ? n : "");
      return { typ: t, text: text, bredd: 6 * enhet + text.length * tecken, idx: g.typer[t] };
    });
    var total = marken.reduce(function (s, m) { return s + m.bredd; }, 0) + luft * (marken.length - 1);
    var x = g.x - total / 2, y = -g.y - hojd / 2;
    marken.forEach(function (m) {
      ut.push('<g class="kampanjmarke' + (kampanjtyp(m.typ).boende ? " boende" : "") +
        '" data-akt="' + m.idx.join(",") + '"><rect x="' + Math.round(x) + '" y="' + Math.round(y) +
        '" width="' + Math.round(m.bredd) + '" height="' + Math.round(hojd) + '" rx="' + Math.round(3 * enhet) +
        '"/><text x="' + Math.round(x + m.bredd / 2) + '" y="' + Math.round(y + hojd * 0.72) +
        '" text-anchor="middle" font-size="' + Math.round(10 * enhet) + '">' + esc(m.text) + "</text></g>");
      x += m.bredd + luft;
    });
  });
  return ut;
}

function datumKort(iso) {
  if (!iso) return "okänt datum";
  var p = iso.split("-");
  return +p[2] + " " + ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][+p[1] - 1];
}

/* Förra valets kampanj är ett kalendarium - vad som planerades - och där står
   det ibland att platsen var preliminär eller att det är oklart om
   aktiviteten blev av. Sådana räknas med men märks ut. */
var STATUS = {
  "preliminär": "platsen var preliminär",
  "osäker": "kalendern frågar själv om den blev av"
};
function aktivitetsrader(lista, max) {
  var visa = lista.slice(0, max || lista.length);
  var html = visa.map(function (a) {
    return '<div class="rad"><span>' + esc(kampanjtyp(a.typ).bokstav + " " + a.namn) +
      (a.status ? ' <span class="status">(' + esc(a.status) + ")</span>" : "") + "</span><span>" +
      esc(datumKort(a.datum)) + "</span></div>";
  }).join("");
  if (lista.length > visa.length) html += '<p class="notis">och ' + (lista.length - visa.length) + " till</p>";
  return html;
}

function kampanjTips(idx) {
  var lista = idx.map(function (i) { return D.kampanjer.aktiviteter[i]; });
  var forsta = lista[0];
  var rubrik = forsta.x !== undefined ? forsta.plats : "Riktat till de boende";
  var html = "<b>" + esc(rubrik) + "</b>" +
    '<p class="notis">' + esc(kampanjtyp(forsta.typ).namn) + " · " + lista.length +
    (lista.length === 1 ? " aktivitet" : " aktiviteter") + " inför valet " + aktivitetAr(forsta) + "</p>";
  html += aktivitetsrader(lista, 12);
  var anm = [];
  lista.forEach(function (a) {
    [a.anm, a.status && a.status + ": " + STATUS[a.status]].forEach(function (t) {
      if (t && anm.indexOf(t) < 0) anm.push(t);
    });
  });
  if (forsta.x === undefined) anm.unshift("Plats i källan: " + forsta.plats);
  if (anm.length) html += '<p class="notis">' + esc(anm.join(". ")) + "</p>";
  return html;
}

function kampanjForklaring() {
  if (!D.kampanjer) return "";
  var ar = kartansKampanj();
  if (!ar) return '<span class="forklaring">Kampanjaktiviteter finns för valen ' +
    kampanjAr().slice().reverse().join(" och ") + " - välj ett av dem som år för att se dem.</span>";
  var antal = {}, utanKarta = 0;
  aktiviteter(ar).forEach(function (a) {
    if (a.distrikt) antal[a.typ] = (antal[a.typ] || 0) + 1;
    else utanKarta++;
  });
  var html = '<span class="forklaring"><strong>Kampanjen inför valet ' + ar + "</strong></span>" +
    kampanjtyper().filter(function (t) { return antal[t]; }).map(function (t) {
      var typ = kampanjtyp(t);
      return '<span class="forklaring"><span class="kampanjruta' + (typ.boende ? " boende" : "") + '">' +
        typ.bokstav + "</span>" + esc(typ.namn.toLowerCase()) + " (" + antal[t] + ")</span>";
    }).join("");
  html += '<span class="forklaring">fylld = riktat till de boende, ram = på en plats</span>';
  if (utanKarta) html += '<span class="forklaring">' + utanKarta +
    " aktiviteter nådde hela kommunen eller saknar plats och syns inte på kartan</span>";
  if (kampanjAr().length > 1) html += '<span class="forklaring">lagret följer året: välj ' +
    kampanjAr().filter(function (a) { return a !== ar; }).join(" eller ") + " för att se den kampanjen</span>";
  return html;
}

/* Distriktsnamnen är långa; på kartan räcker den särskiljande delen. */
function kortnamn(namn) {
  var delar = namn.split(", ");
  return delar.length > 1 ? delar[1] : namn;
}

function ritaTeckenforklaring(sk) {
  var ruta = $("teckenforklaring");
  if (!sk) { ruta.innerHTML = "<span>Inget parti valt.</span>"; return; }
  /* Stegen är olika breda i värde, så varje brytpunkt skrivs ut under sin kant.
     Det sista steget har ingen kant till höger och därför ingen siffra. */
  var steg = sk.farger.map(function (f, i) {
    return '<span class="steg"><i style="background:var(' + f + ')"></i>' +
      (i < sk.brytpunkter.length ? "<b>" + kortMatt(sk.brytpunkter[i]) + "</b>" : "") + "</span>";
  }).join("");
  var lag = formatMatt(sk.min), hog = formatMatt(sk.max);
  var mitt = sk.typ === "div" ? '<span>' + (state.matt === "index" ? "100 = kommunsnittet" : "0") + " i mitten</span>" : "";
  if (state.matt === "delade") mitt += "<span>plus = fler röster i kommunvalet</span>";
  var html = '<span class="slut">' + lag + '</span><span class="skala">' + steg +
    '</span><span class="slut">' + hog + "</span>" + mitt +
    '<span class="forklaring"><span class="ruta ingendata"></span>ingen historik</span>';
  if (arForandringsmatt() && harGrupper()) {
    html += '<span class="forklaring">omritade distrikt jämförs i grupp och ritas som en yta</span>';
  } else if (state.visaUppskattade) {
    html += '<span class="forklaring"><span class="ruta" style="background:repeating-linear-gradient(45deg,var(--seq4),var(--seq4)2px,var(--yta)2px,var(--yta)4px)"></span>uppskattat värde</span>';
  }
  if (state.lager.befolkning) html += '<span class="forklaring">◯ cirkelyta = antal röstberättigade</span>';
  if (state.lager.tathet) html += '<span class="forklaring">– – streckad kant = tät bebyggelse</span>';
  if (state.lager.centrum) html += '<span class="forklaring">◉ lokala centrum (förtidsröstningslokaler)</span>';
  if (state.lager.kampanjer) html += '<span class="radbrytning"></span>' + kampanjForklaring();
  ruta.innerHTML = html;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---------- tooltip ---------- */

/* "+57 växt, +12 deltagande, +78 andel" - uppdelningen från jamforelse(). */
function rosterdelar(j) {
  return tecken(j.vaxt, 0) + " växt · " + tecken(j.deltagande, 0) + " deltagande · " + tecken(j.andel, 0) + " andel";
}

function tooltipInnehall(d, fast) {
  var r = post(d, state.ar);
  var rader = [["Område", d.ort]];
  if (!r) {
    rader.push(["Uppgift", "saknas för " + state.ar]);
  } else {
    var a = andel(r), ka = kommunAndel(state.ar);
    rader.push([gruppnamn(), proc(a) + " (" + tal(gruppRoster(r)) + " röster)"]);
    rader.push(["Index mot Lund", ka ? tal(100 * a / ka, 0) : "–"]);
    if (state.jmfar !== state.ar) {
      var j = jamforelseFor(d);
      var grupp = j && j.enhet.distrikt.length > 1 ? " i gruppen" : "";
      rader.push(["Röster sedan " + state.jmfar + grupp, j ? tecken(j.roster, 0) : "–"]);
      if (j) rader.push(["varav", rosterdelar(j)]);
      rader.push(["Andel sedan " + state.jmfar + grupp, j ? tecken(j.forandring) + " p.e." : "–"]);
      rader.push(["Index sedan " + state.jmfar + grupp, j ? tecken(j.indexforandring, 0) : "–"]);
      if (j && grupp) rader.push(["Jämförs ihop med", j.enhet.distrikt.filter(function (x) { return x !== d; })
        .map(function (x) { return x.namn; }).join(", ")]);
    }
    var dl = delade(d);
    if (dl !== null) rader.push(["Kommunval − riksdagsval", tecken(dl, 0) + " röster"]);
    rader.push(["Röstberättigade", tal(r.rostberattigade)]);
    rader.push(["Valdeltagande", proc(valdeltagande(r, state.ar))]);
    rader.push(["Röstade ej", tal(ejRostande(r, state.ar))]);
    rader.push(["Täthet", tal(tathet(d, r)) + "/km²"]);
    if (r.matchning === "uppskattad") rader.push(["Obs", "uppskattat från äldre distriktsgränser"]);
  }
  var html = fast
    ? '<div class="tipshuvud"><b>' + esc(d.namn) + '</b><div class="tipsknappar">' +
      '<button type="button" id="tipsHela">Alla tre valen</button>' +
      '<button type="button" id="tipsStang" aria-label="Stäng rutan">✕</button></div></div>' +
      '<p class="notis">distriktskod ' + esc(d.kod) + " · " + tal(d.km2, 2) + " km²</p>"
    : "<b>" + esc(d.namn) + "</b>";
  html += rader.map(function (p) {
    return '<div class="rad"><span>' + esc(p[0]) + "</span><span>" + esc(p[1]) + "</span></div>";
  }).join("");
  /* Fastnålat visar rutan hela valresultatet för distriktet, samma tabell som
     distriktsvyn ger, men bara för det val kartan visar. Hela distriktsvyn,
     med alla tre valen, är ett klick bort. */
  if (fast) html += "<h4>" + esc(D.valtyper[state.valtyp]) + "</h4>" + partitabell(d, state.valtyp);
  if (fast && state.lager.kampanjer && D.kampanjer) {
    kampanjArMedForst(state.ar).forEach(function (ar) {
      var akt = kampanjerI(d.kod, ar);
      html += "<h4>Kampanjaktiviteter inför " + ar + "</h4>" +
        (akt.length ? aktivitetsrader(akt) : '<p class="notis">Inga registrerade.</p>');
    });
  }
  return html;
}

/* Håller vyn inom rimliga gränser: inte mer utzoomad än kommunen och inte
   så inzoomad att man tappar bort sig, och alltid med centrum i närheten. */
function klampaVy(v) {
  var g = kartgeometri();
  var full = Math.max(g.maxX - g.minX, g.maxY - g.minY);
  var forhallande = v[3] / v[2];
  var bredd = Math.min(Math.max(v[2], 300), full * 1.5);
  var hojd = bredd * forhallande;
  var cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
  cx = Math.min(Math.max(cx, g.minX - full * 0.2), g.maxX + full * 0.2);
  cy = Math.min(Math.max(cy, -g.maxY - full * 0.2), -g.minY + full * 0.2);
  return [cx - bredd / 2, cy - hojd / 2, bredd, hojd];
}

function sattVy(v) {
  kartvy = klampaVy(v);
  ritaKarta();
}

function zooma(faktor, cx, cy) {
  var v = aktuellVy();
  if (cx === undefined) { cx = v[0] + v[2] / 2; cy = v[1] + v[3] / 2; }
  sattVy([cx - (cx - v[0]) / faktor, cy - (cy - v[1]) / faktor, v[2] / faktor, v[3] / faktor]);
}

function aterstallVy() { kartvy = null; ritaKarta(); }

/* Skärmkoordinat -> kartkoordinat i den vy som visas just nu. */
function tillKarta(klientX, klientY) {
  var rect = $("karta").getBoundingClientRect();
  var v = aktuellVy();
  if (!rect.width || !rect.height) return [v[0] + v[2] / 2, v[1] + v[3] / 2];
  return [v[0] + (klientX - rect.left) / rect.width * v[2],
    v[1] + (klientY - rect.top) / rect.height * v[3]];
}

/* Kartkoordinat -> pixel i kartytan, motsatsen till tillKarta. Används för att
   hålla den fastnålade rutan kvar vid sitt distrikt när kartan flyttas. */
function franKarta(x, y) {
  var svg = $("karta");
  var rect = svg.getBoundingClientRect(), yta = svg.parentNode.getBoundingClientRect();
  var v = aktuellVy();
  if (!rect.width || !rect.height) return [0, 0];
  return [rect.left - yta.left + (x - v[0]) / v[2] * rect.width,
    rect.top - yta.top + (y - v[1]) / v[3] * rect.height];
}

/* Sant medan det senaste klicket egentligen var en dragning - då ska
   klicket inte öppna distriktsvyn. */
var kartDrogs = false;

/* Sant när rutan är fastnålad på ett klickat distrikt: då följer den inte
   muspekaren, utan ligger kvar vid distriktet med hela valresultatet. */
var tipsFast = false;

function kopplaZoom() {
  var svg = $("karta");
  var drag = null, knip = null;

  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = tillKarta(e.clientX, e.clientY);
    zooma(e.deltaY < 0 ? 1.25 : 0.8, p[0], p[1]);
  }, { passive: false });

  /* Dragningen tar medvetet inte setPointerCapture. Fångsten riktar om både
     pointerup och det click som följer på den till <svg>-roten, så klicket
     når aldrig distriktets <path> och closest("[data-kod]") hittar ingenting -
     ett klick på kartan gjorde därför ingenting alls. Rörelsen och släppet
     lyssnas av på dokumentet i stället, vilket är det fångsten behövdes för:
     att en dragning som glider ut ur kartan ska följa med ändå. */
  svg.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || (e.pointerType === "touch" && knip)) return;
    drag = { x: e.clientX, y: e.clientY, vy: aktuellVy().slice() };
    kartDrogs = false;
    svg.classList.add("drar");
  });
  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!kartDrogs && Math.abs(dx) + Math.abs(dy) < 4) return;
    kartDrogs = true;
    var rect = svg.getBoundingClientRect();
    var ny = [drag.vy[0] - dx / rect.width * drag.vy[2],
      drag.vy[1] - dy / rect.height * drag.vy[3], drag.vy[2], drag.vy[3]];
    kartvy = klampaVy(ny);
    /* Under dragningen räcker det att flytta rutan - inget behöver ritas om,
       eftersom skalan är oförändrad. */
    svg.setAttribute("viewBox", kartvy.join(" "));
    if (tipsFast) placeraFastTips(); else $("tooltip").hidden = true;
  });
  function slutaDra() {
    if (!drag) return;
    drag = null;
    svg.classList.remove("drar");
    if (kartDrogs) ritaKarta();
  }
  document.addEventListener("pointerup", slutaDra);
  document.addEventListener("pointercancel", slutaDra);

  /* Nypa ihop två fingrar på pekskärm. */
  function avstand(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }
  svg.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 2) return;
    drag = null;
    svg.classList.remove("drar");
    knip = { d: avstand(e.touches), vy: aktuellVy().slice() };
  }, { passive: false });
  svg.addEventListener("touchmove", function (e) {
    if (e.touches.length !== 2 || !knip) return;
    e.preventDefault();
    var faktor = avstand(e.touches) / knip.d;
    var mitt = tillKarta((e.touches[0].clientX + e.touches[1].clientX) / 2,
      (e.touches[0].clientY + e.touches[1].clientY) / 2);
    var v = knip.vy;
    sattVy([mitt[0] - (mitt[0] - v[0]) / faktor, mitt[1] - (mitt[1] - v[1]) / faktor,
      v[2] / faktor, v[3] / faktor]);
  }, { passive: false });
  svg.addEventListener("touchend", function () { knip = null; });

  $("zoomIn").addEventListener("click", function () { zooma(1.4); });
  $("zoomUt").addEventListener("click", function () { zooma(1 / 1.4); });
  $("zoomAter").addEventListener("click", aterstallVy);
}

/* Distrikten som markeras för att pekaren är över dem - på kartan eller på en
   rad i topplistorna. Det fastnålade distriktet markeras för sig. */
var hovradeKoder = null;

function markeraKarta() {
  var vald = $("markVald");
  if (!vald) return;
  var g = kartgeometri();
  function bana(koder) {
    return (koder || []).map(function (k) { return g.banor[k] || ""; }).join("");
  }
  var dVald = tipsFast && state.distrikt ? bana([state.distrikt]) : "";
  var dHovrad = bana(hovradeKoder);
  /* Samma distrikt två gånger ger ingen tjockare kant, men det behövs inte. */
  if (dHovrad === dVald) dHovrad = "";
  vald.setAttribute("d", dVald);
  $("markValdLinje").setAttribute("d", dVald);
  $("markHovrad").setAttribute("d", dHovrad);
  $("markHovradLinje").setAttribute("d", dHovrad);
}

function hovra(koder) {
  var fore = hovradeKoder ? hovradeKoder.join() : "";
  if ((koder ? koder.join() : "") === fore) return;
  hovradeKoder = koder;
  markeraKarta();
}

function kopplaKarta() {
  var svg = $("karta"), tip = $("tooltip");
  svg.addEventListener("mousemove", function (e) {
    var marke = e.target.closest ? e.target.closest("[data-akt]") : null;
    var mal = e.target.closest ? e.target.closest("[data-kod]") : null;
    hovra(mal && !marke ? [mal.getAttribute("data-kod")] : null);
    if (tipsFast) return;
    if (!mal && !marke) { tip.hidden = true; return; }
    tip.innerHTML = marke
      ? kampanjTips(marke.getAttribute("data-akt").split(",").map(Number))
      : tooltipInnehall(hittaDistrikt(mal.getAttribute("data-kod")));
    tip.hidden = false;
    var yta = svg.parentNode.getBoundingClientRect();
    var x = e.clientX - yta.left + 14, y = e.clientY - yta.top + 14;
    if (x + tip.offsetWidth > yta.width) x = yta.width - tip.offsetWidth - 4;
    tip.style.left = Math.max(0, x) + "px";
    tip.style.top = Math.max(0, y) + "px";
  });
  svg.addEventListener("mouseleave", function () {
    hovra(null);
    if (!tipsFast) tip.hidden = true;
  });
  /* En rad i topplistorna markerar sitt distrikt, eller sin grupp, på kartan. */
  var listor = $("topplistor");
  listor.addEventListener("mouseover", function (e) {
    var rad = e.target.closest ? e.target.closest("[data-koder]") : null;
    hovra(rad ? rad.getAttribute("data-koder").split(",") : null);
  });
  listor.addEventListener("mouseleave", function () { hovra(null); });
  svg.addEventListener("click", function (e) {
    if (kartDrogs) {
      // Klicket är svansen på en dragning - ät upp det och nollställ.
      kartDrogs = false;
      return;
    }
    var mal = distriktUnder(e);
    if (!mal) return;
    /* Rutan nålas fast vid distriktet med hela valresultatet, så att kartan
       blir kvar på skärmen. Hela distriktsvyn är ett klick bort. */
    state.distrikt = mal.getAttribute("data-kod");
    tipsFast = true;
    uppdatera();
  });
}

/* ---------- fastnålad ruta ---------- */

/* Ritas om från ritaKarta, så att innehållet följer valet av val, år och parti
   och läget följer zoom och panorering. */
function ritaFastTips() {
  if (!tipsFast) return;
  var tip = $("tooltip");
  var d = state.distrikt ? hittaDistrikt(state.distrikt) : null;
  if (!d) { lossaTips(); return; }
  tip.innerHTML = tooltipInnehall(d, true);
  tip.classList.add("fast");
  tip.hidden = false;
  $("tipsStang").addEventListener("click", lossaTips);
  $("tipsHela").addEventListener("click", function () { visaFlik("distrikt"); });
  placeraFastTips();
}

/* Rutan hänger vid distriktets mittpunkt, men vänds och kläms in så att den
   alltid ryms i kartytan. */
function placeraFastTips() {
  var d = state.distrikt ? hittaDistrikt(state.distrikt) : null;
  if (!d) return;
  var tip = $("tooltip"), yta = $("karta").parentNode.getBoundingClientRect();
  var p = franKarta(d.centroid[0], -d.centroid[1]);
  var x = p[0] + 12, y = p[1] + 12;
  if (x + tip.offsetWidth > yta.width) x = Math.min(p[0] - tip.offsetWidth - 12, yta.width - tip.offsetWidth - 4);
  if (y + tip.offsetHeight > yta.height) y = yta.height - tip.offsetHeight - 4;
  tip.style.left = Math.max(4, x) + "px";
  tip.style.top = Math.max(4, y) + "px";
}

/* Lossar rutan utan att avmarkera distriktet - panelen under kartan blir kvar. */
function lossaTips() {
  tipsFast = false;
  var tip = $("tooltip");
  tip.hidden = true;
  tip.classList.remove("fast");
  markeraKarta();
}

/* Distriktets <path> under en muspekarhändelse. e.target räcker nästan alltid,
   men pekskärmar fångar pekaren implicit och riktar då om målet till
   <svg>-roten - då får träffen letas upp med koordinaterna i stället. */
function distriktUnder(e) {
  var mal = e.target && e.target.closest ? e.target.closest("[data-kod]") : null;
  if (mal || !document.elementFromPoint) return mal;
  var under = document.elementFromPoint(e.clientX, e.clientY);
  return under && under.closest ? under.closest("[data-kod]") : null;
}

function hittaDistrikt(kod) {
  for (var i = 0; i < D.distrikt.length; i++) if (D.distrikt[i].kod === kod) return D.distrikt[i];
  return null;
}

/* ---------- sammanfattning och topplistor ---------- */

function ritaSammanfattning() {
  var k = kommunPost(state.ar);
  var ka = kommunAndel(state.ar);
  var kj = kommunAndel(state.jmfar);
  var txt = "<strong>" + gruppnamn() + "</strong> i " + D.valtyper[state.valtyp].toLowerCase() + " " +
    state.ar + ": <strong>" + proc(ka) + "</strong> i Lund (" + tal(gruppRoster(k)) + " av " +
    tal(k.giltiga) + " giltiga röster)";
  if (kj !== null && state.jmfar !== state.ar) {
    txt += ", " + tecken(ka - kj) + " p.e. och <strong>" + tecken(gruppRoster(k) - gruppRoster(kommunPost(state.jmfar)), 0) +
      " röster</strong> sedan " + state.jmfar;
  }
  txt += ".";
  /* Meningen om kartan hör bara hemma under kartan. */
  if (state.flik === "karta") txt += " Kartan visar " + mattEtikett().toLowerCase() + " i kommunens " + D.distrikt.length + " valdistrikt.";
  $("sammanfattning").innerHTML = txt;
}

function topplista(rubrik, rader) {
  return '<div class="topplista"><h3>' + esc(rubrik) + "</h3><ol>" + rader.map(function (r) {
    return '<li data-koder="' + r[2].join(",") + '"><span class="topprad"><span>' + esc(r[0]) + '</span><span class="varde">' + r[1] + "</span></span></li>";
  }).join("") + "</ol></div>";
}

function ritaTopplistor() {
  var med = D.distrikt.map(function (d) {
    var r = post(d, state.ar);
    return { d: d, namn: d.namn, r: r, andel: r ? andel(r) : null,
      ejrostande: ejRostande(r, state.ar) };
  }).filter(function (x) { return x.r; });
  /* Förändringarna listas per jämförelseenhet: en omritad grupp är en rad. */
  var enheter = indelning(state.ar, state.jmfar).lista.map(function (e) {
    var j = jamforelse(e);
    return { namn: e.namn, koder: e.koder, roster: j ? j.roster : null, indexforandring: j ? j.indexforandring : null };
  });
  function topp(lista, nyckel, riktning) {
    return lista.filter(function (x) { return x[nyckel] !== null; })
      .sort(function (a, b) { return riktning * (a[nyckel] - b[nyckel]); }).slice(0, TOPPLISTA);
  }
  var html = "";
  html += topplista("Starkast för " + gruppnamn(), topp(med, "andel", -1).map(function (x) {
    return [x.namn, proc(x.andel), [x.d.kod]]; }));
  if (state.jmfar !== state.ar) {
    html += topplista("Flest vunna röster sedan " + state.jmfar, topp(enheter, "roster", -1).map(function (x) {
      return [x.namn, tecken(x.roster, 0), x.koder]; }));
    html += topplista("Minst vunna eller flest förlorade sedan " + state.jmfar, topp(enheter, "roster", 1).map(function (x) {
      return [x.namn, tecken(x.roster, 0), x.koder]; }));
    html += topplista("Starkast mot kommunsnittet sedan " + state.jmfar, topp(enheter, "indexforandring", -1).map(function (x) {
      return [x.namn, tecken(x.indexforandring, 0) + " index", x.koder]; }));
    html += topplista("Svagast mot kommunsnittet sedan " + state.jmfar, topp(enheter, "indexforandring", 1).map(function (x) {
      return [x.namn, tecken(x.indexforandring, 0) + " index", x.koder]; }));
  }
  html += topplista("Flest som inte röstade", topp(med, "ejrostande", -1).map(function (x) {
    return [x.namn, tal(x.ejrostande), [x.d.kod]]; }));
  $("topplistor").innerHTML = html;
}

/* ---------- mandat ---------- */

/* Mandaten i kommunfullmäktige räknas ur kommunvalets röster i hela
   kommunen, med alla partier som fick mandat - även FörNyaLund och, 2018,
   Feministiskt initiativ. Jämkade uddatalsmetoden: mandaten delas ut ett i
   taget till partiet med störst jämförelsetal, röster / 1,2 för partiets
   första mandat och sedan röster / 3, 5, 7 ... Bara partier med minst 2 %
   av rösterna i kommunen är med. Så räknat blir det exakt Valmyndighetens
   fördelning 2018 och 2022. */
function mandatregler() { return D.mandat && D.mandat.KF; }
function mandatroster(ar) {
  var M = mandatregler();
  return M && M.ar[ar] ? M.ar[ar] : null;
}
function kopia(o) { var ut = {}; for (var k in o) ut[k] = o[k]; return ut; }
function summaMandat(mandat, grupp) {
  return grupp.reduce(function (t, p) { return t + (mandat[p] || 0); }, 0);
}

/* Jämförelsetalen jämförs i heltal - divisorerna gånger fem, 1,2 → 6, 3 → 15,
   5 → 25 ... - så att avrundning aldrig avgör. Lika jämförelsetal avgörs i
   verkligheten genom lottning; här förlorar partiet "forlorar" varje lika
   läge, så att en marginal aldrig räknas för liten. */
function fordelaMandat(roster, forlorar) {
  var M = mandatregler(), giltiga = 0, p, i, j;
  for (p in roster) giltiga += roster[p];
  var med = Object.keys(roster).filter(function (q) { return q !== "ÖVR" && roster[q] >= M.sparr * giltiga; });
  var mandat = {};
  for (p in roster) mandat[p] = 0;
  var divisor = function (q) { return mandat[q] ? 5 * (2 * mandat[q] + 1) : Math.round(5 * M.forsta_divisor); };
  for (i = 0; i < M.antal && med.length; i++) {
    var bast = med[0];
    for (j = 1; j < med.length; j++) {
      var q = med[j], skillnad = roster[q] * divisor(bast) - roster[bast] * divisor(q);
      if (skillnad > 0 || (skillnad === 0 && bast === forlorar)) bast = q;
    }
    mandat[bast]++;
  }
  return mandat;
}

/* Minsta antal röster till (riktning 1) eller från (riktning -1) ett parti
   som ändrar gruppens antal mandat, med alla andra partiers röster
   oförändrade - som när fler eller färre av partiets egna väljare röstar.
   Gruppens mandat ändras bara åt ett håll när partiets röster gör det, så
   gränsen hittas med intervallhalvering. motpart är partiet utanför gruppen
   som mandatet tas från eller går till. */
function mandatgrans(roster, parti, grupp, riktning) {
  if (!roster[parti] && riktning < 0) return null;
  var fore = fordelaMandat(roster, parti), bas = summaMandat(fore, grupp), tak = 0;
  for (var p in roster) tak += roster[p];
  function med(x) { var r = kopia(roster); r[parti] = (r[parti] || 0) + riktning * x; return r; }
  function andrad(x) {
    var n = summaMandat(fordelaMandat(med(x), parti), grupp);
    return riktning > 0 ? n > bas : n < bas;
  }
  var lo = 0, hi = riktning > 0 ? 1 : roster[parti];
  if (riktning > 0) {
    while (!andrad(hi)) { lo = hi; hi *= 2; if (hi > 4 * tak) return null; }
  } else if (!andrad(hi)) return null;
  while (hi - lo > 1) {
    var mitt = Math.floor((lo + hi) / 2);
    if (andrad(mitt)) hi = mitt; else lo = mitt;
  }
  var efter = fordelaMandat(med(hi), parti);
  var motpart = Object.keys(efter).filter(function (q) {
    return grupp.indexOf(q) < 0 && (riktning > 0 ? efter[q] < fore[q] : efter[q] > fore[q]);
  })[0] || null;
  return { parti: parti, roster: hi, motpart: motpart, mandat: summaMandat(efter, grupp) };
}

/* Det billigaste mandatet att vinna, eller att förlora, för gruppen. */
function billigast(roster, grupp, riktning) {
  var bast = null;
  grupp.forEach(function (p) {
    var g = mandatgrans(roster, p, grupp, riktning);
    if (g && (!bast || g.roster < bast.roster)) bast = g;
  });
  return bast;
}

/* Röster till egen majoritet, ett mandat i taget där nästa är billigast.
   Det är ett tak snarare än ett exakt minimum, men så länge det fattas ett
   eller två mandat blir det samma sak. */
function tillMajoritet(roster, grupp) {
  var M = mandatregler(), majoritet = Math.floor(M.antal / 2) + 1;
  var r = kopia(roster), nu = summaMandat(fordelaMandat(r), grupp), steg = [], totalt = 0;
  while (nu < majoritet) {
    var n = billigast(r, grupp, 1);
    if (!n || steg.length >= M.antal) return null;
    r[n.parti] += n.roster; totalt += n.roster; nu = n.mandat; steg.push(n);
  }
  return { roster: totalt, steg: steg };
}

/* 1:a, 2:a, 3:e ... 11:e, 12:e ... 21:a, 22:a, 33:e */
function ordningstal(n) {
  return n + ((n % 10 === 1 || n % 10 === 2) && n % 100 !== 11 && n % 100 !== 12 ? ":a" : ":e");
}
function partinamn(p) { return PARTINAMN[p] || (mandatregler() && mandatregler().namn[p]) || p; }
function partiprick(p) {
  return '<span class="prick" style="background:' + (PARTIFARG[p] || "var(--dampad)") + '"></span>';
}

/* Partigruppens partier som finns i mandatunderlaget. */
function mandatgrupp(roster) {
  return state.partier.filter(function (p) { return p in roster; });
}

/* "+581 röster" med vem mandatet tas från, eller "959 röster" med vem det går
   till - partiet i gruppen står med när gruppen har flera. */
function gransText(g, grupp, riktning, kort) {
  var vem = [];
  if (grupp.length > 1) vem.push("på " + g.parti);
  if (g.motpart) vem.push((riktning > 0 ? "tas från " : "går till ") + g.motpart);
  return (riktning > 0 ? "+" : "") + tal(g.roster) + (kort ? "" : " röster") +
    (vem.length ? '<span class="undertext">' + esc(vem.join(", ")) + "</span>" : "");
}

function mandatkort() {
  var M = mandatregler();
  if (!M) return "";
  var arLista = D.ar.filter(function (a) { return M.ar[a]; }).reverse();
  var ar = M.ar[state.ar] ? state.ar : arLista[arLista.length - 1];
  var roster = M.ar[ar], majoritet = Math.floor(M.antal / 2) + 1;
  var fordelning = {};
  arLista.forEach(function (a) { fordelning[a] = fordelaMandat(M.ar[a]); });
  var grupp = mandatgrupp(roster);

  var html = '<div class="kort mandatkort"><h3>Mandat i kommunfullmäktige</h3>' +
    '<p class="hjalp">Kommunvalet fördelar de ' + M.antal + " mandaten i fullmäktige med jämkade uddatalsmetoden, " +
    "bland partier med minst " + tal(100 * M.sparr) + " % av rösterna i kommunen. Egen majoritet är " + majoritet +
    " mandat. Marginalerna är räknade på kommunvalet " + ar + ": hur många fler röster ett parti hade behövt för ett " +
    "mandat till, och hur många färre det hade klarat sig med innan ett mandat gått förlorat - med alla andra " +
    "partiers röster som de blev.</p>";

  if (grupp.length) {
    var nu = summaMandat(fordelning[ar], grupp);
    var jmf = state.jmfar !== ar && fordelning[state.jmfar] ? summaMandat(fordelning[state.jmfar], grupp) : null;
    var flera = grupp.length > 1;
    var status = [];
    if (jmf !== null) status.push(tecken(nu - jmf, 0) + " sedan " + state.jmfar);
    if (flera) status.push(nu >= majoritet ? "egen majoritet" : (majoritet - nu) + " från egen majoritet");
    var rutor = nyckel(gruppnamn() + " i kommunvalet " + ar, nu + (flera ? " av " + M.antal : " mandat") +
      (status.length ? '<span class="undertext">' + esc(status.join(" · ")) + "</span>" : ""));
    var nasta = billigast(roster, grupp, 1), sista = billigast(roster, grupp, -1);
    var maj = flera && nu < majoritet ? tillMajoritet(roster, grupp) : null;
    if (nasta && !(maj && maj.steg.length === 1)) rutor += nyckel("Ett mandat till", gransText(nasta, grupp, 1));
    if (maj) rutor += nyckel("Till egen majoritet", "+" + tal(maj.roster) + " röster" + '<span class="undertext">' +
      esc(maj.steg.length === 1 ? (maj.steg[0].motpart ? "på " + maj.steg[0].parti + ", tas från " + maj.steg[0].motpart : "")
        : maj.steg.length + " mandat, på " + maj.steg.map(function (s) { return s.parti; }).join(", ")) + "</span>");
    if (sista) rutor += nyckel(flera && nu === majoritet ? "Marginal för majoriteten" : "Marginal för det sista mandatet",
      gransText(sista, grupp, -1));
    html += '<div class="nyckeltal">' + rutor + "</div>";
  }

  /* Tabellen: alla partier som fick mandat något av åren, störst först. */
  var partier = [];
  arLista.forEach(function (a) {
    Object.keys(fordelning[a]).forEach(function (p) { if (fordelning[a][p] && partier.indexOf(p) < 0) partier.push(p); });
  });
  partier.sort(function (a, b) {
    return (fordelning[ar][b] || 0) - (fordelning[ar][a] || 0) || (roster[b] || 0) - (roster[a] || 0);
  });
  var giltiga = 0;
  for (var p in roster) giltiga += roster[p];
  html += '<div class="tabellyta"><table class="mandattabell"><thead><tr><th class="vanster">Parti</th>' +
    arLista.map(function (a) { return "<th>" + a + "</th>"; }).join("") +
    "<th>Röster " + ar + '</th><th title="Så många fler röster hade gett partiet ett mandat till">Ett mandat till</th>' +
    '<th title="Så många färre röster hade partiet klarat sig med innan det förlorat ett mandat">Marginal</th></tr></thead><tbody>';
  partier.forEach(function (p) {
    var n = p in roster ? mandatgrans(roster, p, [p], 1) : null;
    var s = p in roster ? mandatgrans(roster, p, [p], -1) : null;
    html += '<tr class="' + (grupp.indexOf(p) >= 0 ? "igrupp" : "") + '"><td class="vanster">' + partiprick(p) +
      esc(partinamn(p)) + "</td>" +
      arLista.map(function (a) { return '<td class="tal">' + (p in M.ar[a] ? fordelning[a][p] : "–") + "</td>"; }).join("") +
      '<td class="tal">' + (p in roster ? tal(roster[p]) + ' <span class="notis">' + proc(100 * roster[p] / giltiga) + "</span>" : "–") +
      "</td>" + '<td class="tal">' + (n ? gransText(n, [p], 1, true) : "–") + "</td>" +
      '<td class="tal">' + (s ? gransText(s, [p], -1, true) : "–") + "</td></tr>";
  });
  if (grupp.length > 1) {
    html += '<tr class="summarad"><td class="vanster">' + esc(gruppnamn()) + "</td>" +
      arLista.map(function (a) { return '<td class="tal">' + summaMandat(fordelning[a], grupp) + "</td>"; }).join("") +
      '<td class="tal">' + tal(grupp.reduce(function (t, q) { return t + roster[q]; }, 0)) + '</td><td></td><td></td></tr>';
  }
  html += "</tbody></table></div>";
  var status2026 = D.meta.status2026_per_val && D.meta.status2026_per_val.KF;
  html += '<p class="notis">Rösterna som tillkommer eller försvinner tas inte från något annat parti - det är ' +
    "fler eller färre av partiets egna väljare som röstar. Går väljare över från det parti som annars hade " +
    "tagit mandatet räcker ungefär hälften så många, eftersom varje sådan röst räknas två gånger." +
    (ar === D.ar[0] && status2026 === "preliminärt"
      ? " Kommunvalet " + ar + " är ännu preliminärt räknat, så marginalerna kan flytta sig några röster." : "") + "</p></div>";
  return html;
}

/* ---------- röster ---------- */

var DELAR = [
  { nyckel: "vaxt", namn: "fler eller färre röstberättigade" },
  { nyckel: "deltagande", namn: "valdeltagandet" },
  { nyckel: "andel", namn: "andelen av rösterna" }
];

/* Förändringen i antal röster, uppdelad per jämförelseenhet och på växt,
   valdeltagande och andel. Enheterna plus uppsamlingsdistriktet summerar
   till kommunens förändring. */
function rosterbidrag() {
  if (state.ar === state.jmfar) return null;
  var enheter = indelning(state.ar, state.jmfar).lista.map(function (e) { return jamforelse(e); }).filter(Boolean);
  var summa = { roster: 0, vaxt: 0, deltagande: 0, andel: 0 };
  enheter.forEach(function (j) { ["roster", "vaxt", "deltagande", "andel"].forEach(function (f) { summa[f] += j[f]; }); });
  var u = D.uppsamlingsdistrikt[state.valtyp] || {};
  var upps = u[state.ar] && u[state.jmfar] ? gruppRoster(u[state.ar]) - gruppRoster(u[state.jmfar]) : 0;
  var kommun = gruppRoster(kommunPost(state.ar)) - gruppRoster(kommunPost(state.jmfar));
  enheter.sort(function (a, b) { return b.roster - a.roster; });
  return { enheter: enheter, summa: summa, upps: upps, kommun: kommun,
    ovrigt: kommun - summa.roster - upps, saknas: indelning(state.ar, state.jmfar).lista.length - enheter.length };
}

function ritaRoster() {
  var ruta = $("rosterinnehall");
  var html = mandatkort();
  var b = rosterbidrag();
  if (!state.partier.length) { ruta.innerHTML = html + '<p class="hjalp">Välj minst ett parti.</p>'; return; }
  if (!b) {
    html += '<div class="kort"><p class="hjalp">Välj ett annat jämförelseår än ' + state.ar +
      " för att se var rösterna vanns och förlorades.</p></div>";
  } else {
    var s = b.summa;
    html += '<div class="kort rosterforandring"><h3>' + esc(gruppnamn()) + " i " + D.valtyper[state.valtyp].toLowerCase() + " " +
      state.jmfar + "–" + state.ar + "</h3>" +
      '<p class="hjalp">Mandaten fördelas efter antalet röster. Här delas förändringen i röster upp på var den ' +
      "uppstod och varför: fler eller färre röstberättigade i distriktet, fler eller färre av dem som röstade, och " +
      "en större eller mindre andel av rösterna. Delarna summerar exakt till förändringen.</p>" +
      '<div class="nyckeltal">' +
      nyckel("Förändring i röster", tecken(b.kommun, 0)) +
      nyckel("av fler röstberättigade", tecken(s.vaxt, 0)) +
      nyckel("av valdeltagandet", tecken(s.deltagande, 0)) +
      nyckel("av andelen", tecken(s.andel, 0)) +
      nyckel("i uppsamlingsdistriktet", tecken(b.upps, 0)) +
      (Math.abs(b.ovrigt) >= 1 ? nyckel("ej fördelat", tecken(b.ovrigt, 0)) : "") +
      "</div>";
    var topp10 = b.enheter.slice(0, 10).reduce(function (t, j) { return t + j.roster; }, 0);
    html += '<p class="notis">' + (b.kommun > 0 && s.roster > 0
      ? "De tio enheter som gav mest står för " + tal(100 * topp10 / s.roster, 0) + " % av nettot i distrikten. " : "") +
      "Uppsamlingsdistriktet är förtidsröster som inte kunnat föras till sitt valdistrikt; de går inte att placera på kartan." +
      (b.saknas ? " " + b.saknas + " enheter saknar siffror för ett av åren och är inte med." : "") + "</p></div>";
    html += '<div class="kort"><h3>Var rösterna vanns och förlorades</h3>' +
      '<p class="hjalp">En rad per distrikt, eller per grupp där distrikten ritades om (siffrorna gäller då hela ' +
      "gruppen). Sorterade efter förändringen i röster. Hovra över en rad för siffrorna.</p>" +
      bidragsdiagram(b) + "</div>";
  }
  html += '<div class="kort"><h3>Samma väljare, olika val</h3>' + valjamforelse() + "</div>";
  ruta.innerHTML = html;
}

function bidragsdiagram(b) {
  var rader = b.enheter.map(function (j) {
    return { namn: j.enhet.namn, total: j.roster, delar: DELAR.map(function (d) { return { klass: d.nyckel, v: j[d.nyckel] }; }), j: j };
  });
  rader.push({ namn: "Uppsamlingsdistriktet", total: b.upps, delar: [{ klass: "upps", v: b.upps }], upps: true });
  var pos = 0, neg = 0;
  rader.forEach(function (r) {
    var p = 0, n = 0;
    r.delar.forEach(function (d) { if (d.v > 0) p += d.v; else n -= d.v; });
    pos = Math.max(pos, p); neg = Math.max(neg, n);
  });
  var bredd = pos + neg || 1, noll = 100 * neg / bredd;
  bidragsrader = rader;
  var html = rader.map(function (r, i) {
    var hoger = noll, vanster = noll, bitar = [];
    var positiva = r.delar.filter(function (d) { return d.v > 0; });
    var negativa = r.delar.filter(function (d) { return d.v < 0; });
    positiva.forEach(function (d, k) {
      var w = 100 * d.v / bredd;
      bitar.push('<b class="' + d.klass + (k === positiva.length - 1 ? " sist" : "") + '" style="left:' + hoger.toFixed(2) +
        "%;width:calc(" + w.toFixed(2) + "% - " + (k < positiva.length - 1 ? 2 : 0) + 'px)"></b>');
      hoger += w;
    });
    negativa.forEach(function (d, k) {
      var w = -100 * d.v / bredd;
      vanster -= w;
      bitar.push('<b class="' + d.klass + (k === negativa.length - 1 ? " forst" : "") + '" style="left:calc(' +
        vanster.toFixed(2) + "% + " + (k < negativa.length - 1 ? 2 : 0) + "px);width:calc(" + w.toFixed(2) + "% - " +
        (k < negativa.length - 1 ? 2 : 0) + 'px)"></b>');
    });
    return '<div class="bidragsrad' + (r.upps ? " upps" : "") + '" data-i="' + i + '"><span class="namn">' + esc(r.namn) +
      '</span><div class="bidragsstapel"><span class="noll" style="left:' + noll.toFixed(2) + '%"></span>' +
      bitar.join("") + '</div><span class="summa">' + tecken(r.total, 0) + "</span></div>";
  }).join("");
  var forklaring = '<p class="bidragsforklaring">' + DELAR.map(function (d) {
    return '<span><i style="background:var(--del' + (DELAR.indexOf(d) + 1) + ')"></i>' + esc(d.namn) + "</span>";
  }).join("") + '<span><i style="background:var(--dampad)"></i>uppsamlingsdistriktet</span></p>';
  return forklaring + '<div class="bidrag" id="bidrag">' + html + "</div>";
}

var bidragsrader = [];
function bidragsTips(i) {
  var r = bidragsrader[i];
  if (!r) return "";
  var rader = [["Förändring i röster", tecken(r.total, 0)]];
  if (r.j) {
    DELAR.forEach(function (d) { rader.push(["av " + d.namn, tecken(r.j[d.nyckel], 0)]); });
    rader.push(["Röster " + state.jmfar + " → " + state.ar, tal(gruppRoster(r.j.fore)) + " → " + tal(gruppRoster(r.j.nu))]);
    rader.push(["Röstberättigade", tal(r.j.fore.rostberattigade) + " → " + tal(r.j.nu.rostberattigade)]);
    rader.push(["Andel", proc(andel(r.j.fore)) + " → " + proc(andel(r.j.nu))]);
  }
  return "<b>" + esc(r.namn) + "</b>" + rader.map(function (p) {
    return '<div class="rad"><span>' + esc(p[0]) + "</span><span>" + esc(p[1]) + "</span></div>";
  }).join("");
}

/* Partigruppens röster i alla tre valen, alla tre åren. Kommunvalet har fler
   röstberättigade än riksdagsvalet (EU-medborgare och andra som bott i
   Sverige i tre år får rösta), så en del av skillnaden är väljarkåren. */
function valjamforelse() {
  var valtyper = Object.keys(D.valtyper), arLista = D.ar.slice().reverse();
  var html = '<p class="hjalp">Röster på ' + esc(gruppnamn()) + " i varje val. Skillnaden mellan kommunvalet och " +
    "riksdagsvalet visar hur många fler, eller färre, som valde partiet lokalt än nationellt. Kartmåttet " +
    "<i>Kommunval minus riksdagsval</i> visar samma sak per distrikt.</p>" +
    '<div class="tabellyta"><table><thead><tr><th class="vanster">Val</th>' +
    arLista.map(function (a) { return "<th>" + a + "</th>"; }).join("") + "</tr></thead><tbody>";
  var kommunRoster = function (vt, a) { var k = D.kommun[vt][a]; return k ? gruppRoster(k) : null; };
  valtyper.forEach(function (vt) {
    html += '<tr><td class="vanster">' + esc(D.valtyper[vt]) + "</td>" + arLista.map(function (a) {
      var k = D.kommun[vt][a];
      return '<td class="tal">' + tal(kommunRoster(vt, a)) + (k ? ' <span class="notis">' + proc(andel(k)) + "</span>" : "") + "</td>";
    }).join("") + "</tr>";
  });
  html += '<tr class="summarad"><td class="vanster">Kommunval − riksdagsval</td>' + arLista.map(function (a) {
    var kf = kommunRoster("KF", a), rd = kommunRoster("RD", a);
    return '<td class="tal">' + (kf === null || rd === null ? "–" : tecken(kf - rd, 0)) + "</td>";
  }).join("") + "</tr></tbody></table></div>";
  var kf = D.kommun.KF[state.ar], rd = D.kommun.RD[state.ar];
  if (kf && rd) html += '<p class="notis">' + state.ar + " hade kommunvalet " + tal(kf.rostberattigade - rd.rostberattigade) +
    " fler röstberättigade än riksdagsvalet, och " + tal(kf.giltiga - rd.giltiga) + " fler giltiga röster.</p>";
  return html;
}

/* ---------- tabell ---------- */

function tabellrader() {
  var ka = kommunAndel(state.ar);
  var sok = state.sok.toLowerCase();
  return D.distrikt.filter(function (d) {
    if (state.ort && d.ort !== state.ort) return false;
    if (sok && d.namn.toLowerCase().indexOf(sok) < 0 && d.ort.toLowerCase().indexOf(sok) < 0) return false;
    return true;
  }).map(function (d) {
    var r = post(d, state.ar), j = jamforelseFor(d);
    var a = r ? andel(r) : null;
    var rad = {
      d: d, r: r, namn: d.namn, ort: d.ort,
      andel: a,
      roster: r ? gruppRoster(r) : null,
      index: (a !== null && ka) ? 100 * a / ka : null,
      rosterforandring: j ? j.roster : null,
      forandring: j ? j.forandring : null,
      indexforandring: j ? j.indexforandring : null,
      grupp: j && j.enhet.distrikt.length > 1 ? j.enhet.namn : null,
      rostberattigade: r ? r.rostberattigade : null,
      valdeltagande: valdeltagande(r, state.ar),
      ejrostande: ejRostande(r, state.ar),
      tathet: tathet(d, r),
      uppskattad: !!(r && r.matchning === "uppskattad")
    };
    state.partier.forEach(function (p) { rad["p_" + p] = r && r.giltiga ? 100 * (r.roster[p] || 0) / r.giltiga : null; });
    return rad;
  });
}

function tabellKolumner() {
  var kol = [
    { nyckel: "namn", rubrik: "Distrikt", text: true },
    { nyckel: "ort", rubrik: "Område", text: true },
    { nyckel: "andel", rubrik: gruppnamn() + " %", format: function (v) { return proc(v); }, stapel: true },
    { nyckel: "roster", rubrik: "Röster", format: function (v) { return tal(v); } },
    { nyckel: "index", rubrik: "Index", format: function (v) { return tal(v, 0); } },
    { nyckel: "rosterforandring", rubrik: "Δ röster " + state.jmfar, format: function (v) { return tecken(v, 0); }, enhet: true },
    { nyckel: "forandring", rubrik: "Δ " + state.jmfar + " (p.e.)", format: function (v) { return tecken(v); }, enhet: true },
    { nyckel: "indexforandring", rubrik: "Δ index " + state.jmfar, format: function (v) { return tecken(v, 0); }, enhet: true }
  ];
  state.partier.forEach(function (p) {
    kol.push({ nyckel: "p_" + p, rubrik: p + " %", format: function (v) { return proc(v); }, parti: p });
  });
  kol.push({ nyckel: "rostberattigade", rubrik: "Röstberättigade", format: function (v) { return tal(v); } });
  kol.push({ nyckel: "valdeltagande", rubrik: "Valdeltagande", format: function (v) { return proc(v); } });
  kol.push({ nyckel: "ejrostande", rubrik: "Röstade ej", format: function (v) { return tal(v); } });
  kol.push({ nyckel: "tathet", rubrik: "Rb/km²", format: function (v) { return tal(v); } });
  return kol;
}

function ritaTabell() {
  var kol = tabellKolumner();
  var rader = tabellrader();
  var nyckel = state.sortKol;
  if (!kol.some(function (k) { return k.nyckel === nyckel; })) nyckel = state.sortKol = "andel";
  rader.sort(function (a, b) {
    var x = a[nyckel], y = b[nyckel];
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "string") return state.sortRiktning * x.localeCompare(y, "sv");
    return state.sortRiktning * (x - y);
  });
  var maxAndel = Math.max.apply(null, rader.map(function (r) { return r.andel || 0; })) || 1;
  var html = "<thead><tr>" + kol.map(function (k) {
    var sort = k.nyckel === nyckel ? ' aria-sort="' + (state.sortRiktning < 0 ? "descending" : "ascending") + '"' : "";
    var prick = k.parti ? '<span class="prick" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
      PARTIFARG[k.parti] + ';margin-right:4px"></span>' : "";
    return "<th" + sort + ' data-kol="' + k.nyckel + '" class="' + (k.text ? "vanster" : "") + '" title="' +
      (k.parti ? esc(PARTINAMN[k.parti]) : "") + '">' + prick + esc(k.rubrik) + "</th>";
  }).join("") + "</tr></thead><tbody>";
  rader.forEach(function (rad) {
    html += "<tr>" + kol.map(function (k) {
      var v = rad[k.nyckel];
      if (k.text) {
        return '<td class="vanster' + (k.nyckel === "namn" && rad.uppskattad ? " uppskattad" : "") + '">' + esc(v) + "</td>";
      }
      var txt = k.format(v);
      /* Förändringen i en omritad grupp gäller hela gruppen - markeras och
         förklaras när man hovrar. */
      if (k.enhet && rad.grupp && v !== null) {
        return '<td class="tal grupp" title="' + esc("Gäller hela gruppen: " + rad.grupp) + '">' + txt + "</td>";
      }
      if (k.stapel && v !== null) {
        return '<td class="tal stapel"><i style="width:' + Math.round(70 * v / maxAndel) + '%"></i><span>' + txt + "</span></td>";
      }
      return '<td class="tal">' + txt + "</td>";
    }).join("") + "</tr>";
  });
  $("tabell").innerHTML = html + "</tbody>";
}

function exporteraCSV() {
  var kol = tabellKolumner();
  var rader = tabellrader();
  var ut = [kol.map(function (k) { return k.rubrik; }).join(";")];
  rader.forEach(function (rad) {
    ut.push(kol.map(function (k) {
      var v = rad[k.nyckel];
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return String(Math.round(v * 100) / 100).replace(".", ",");
      return '"' + String(v).replace(/"/g, '""') + '"';
    }).join(";"));
  });
  var namn = "lund-" + state.valtyp + "-" + state.ar + "-" + gruppnamn().replace(/\+/g, "-") + ".csv";
  var blob = new Blob(["﻿" + ut.join("\r\n")], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = namn;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ---------- distriktsvy ---------- */

function ritaDistrikt() {
  var valj = $("distriktval");
  if (valj.options.length !== D.distrikt.length) {
    valj.innerHTML = D.distrikt.slice().sort(function (a, b) { return a.namn.localeCompare(b.namn, "sv"); })
      .map(function (d) { return '<option value="' + d.kod + '">' + esc(d.namn) + " (" + esc(d.ort) + ")</option>"; }).join("");
  }
  if (!state.distrikt) state.distrikt = D.distrikt[0].kod;
  valj.value = state.distrikt;
  var d = hittaDistrikt(state.distrikt);
  var j = jamforelseFor(d);
  var html = '<div class="kort">' + distriktRubrik(d) + distriktNyckeltal(d) +
    (j && j.enhet.distrikt.length > 1 ? '<p class="notis">Förändringen sedan ' + state.jmfar + " räknas för " +
      esc(j.enhet.namn) + " tillsammans: gränserna mellan dem ritades om, men tillsammans täcker de samma yta " +
      "som de gamla distrikten.</p>" : "") + "</div>";

  Object.keys(D.valtyper).forEach(function (valtyp) {
    html += '<div class="kort"><h3>' + esc(D.valtyper[valtyp]) + "</h3>" + partitabell(d, valtyp) + "</div>";
  });
  $("distriktinnehall").innerHTML = html + distriktKampanj(d);
}

/* Kampanjaktiviteterna i distriktet, kampanj för kampanj - samma som
   kampanjlagret visar där. */
function distriktKampanj(d) {
  if (!D.kampanjer) return "";
  var html = '<div class="kort"><h3>Kampanjaktiviteter i distriktet</h3><div class="kampanjspalter">';
  kampanjArMedForst(state.ar).forEach(function (ar) {
    var akt = kampanjerI(d.kod, ar);
    html += "<div><h4>Inför valet " + ar + (akt.length ? " · " + akt.length : "") + "</h4>" +
      (akt.length ? '<ul class="aktivitetslista">' + akt.map(function (a) {
        return "<li>" + typruta(a.typ) + "<span>" + esc(a.namn) +
          (a.status ? ' <span class="status">(' + esc(a.status) + ")</span>" : "") +
          (a.plats && a.plats !== d.namn ? '<span class="plats">' + esc(a.plats) + "</span>" : "") +
          '</span><span class="datum">' + esc(datumKort(a.datum)) + "</span></li>";
      }).join("") + "</ul>" : '<p class="notis">Inga registrerade.</p>') + "</div>";
  });
  return html + '</div><p class="notis">Aktiviteter som riktade sig till de boende (fylld ruta) står i varje ' +
    "distrikt de gällde, övriga i distriktet där de ägde rum.</p></div>";
}

function distriktRubrik(d) {
  return "<h2>" + esc(d.namn) + "</h2>" +
    '<p class="notis">' + esc(d.ort) + " · distriktskod " + d.kod + " · " + tal(d.km2, 2) + " km²</p>";
}

function distriktNyckeltal(d) {
  var r = post(d, state.ar);
  var ka = kommunAndel(state.ar);
  return '<div class="nyckeltal">' +
    nyckel(gruppnamn() + " " + state.ar, r ? proc(andel(r)) : "–") +
    nyckel("Index mot Lund", (r && ka) ? tal(100 * andel(r) / ka, 0) : "–") +
    (state.jmfar !== state.ar ? nyckel("Röster sedan " + state.jmfar, jmfTal(d, "roster", 0)) +
      nyckel("Index sedan " + state.jmfar, jmfTal(d, "indexforandring", 0)) : "") +
    nyckel("Röstberättigade", r ? tal(r.rostberattigade) : "–") +
    nyckel("Valdeltagande", proc(valdeltagande(r, state.ar))) +
    nyckel("Röstade ej", r ? tal(ejRostande(r, state.ar)) : "–") +
    nyckel("Röstberättigade per km²", r ? tal(tathet(d, r)) : "–") +
    "</div>";
}

function jmfTal(d, falt, dec) {
  var j = jamforelseFor(d);
  if (!j) return "–";
  return tecken(j[falt], dec) + (j.enhet.distrikt.length > 1 ? '<span class="notis"> i gruppen</span>' : "");
}

function nyckel(etikett, varde) {
  return '<div><div class="etikett">' + esc(etikett) + '</div><div class="varde">' + varde + "</div></div>";
}

/* Partier utöver riksdagspartierna som har egna siffror i ett val - i Lund
   FörNyaLund i kommunvalet. De redovisas i partitabellen men går inte att
   välja i partigruppen, eftersom de inte finns i de andra valen. */
function lokalaPartier(valtyp) {
  var ut = [];
  D.ar.forEach(function (a) {
    var k = D.kommun[valtyp][a];
    Object.keys(k ? k.roster : {}).forEach(function (p) {
      if (p !== "ÖVR" && D.partier.indexOf(p) < 0 && ut.indexOf(p) < 0) ut.push(p);
    });
  });
  return ut;
}

function partitabell(d, valtyp) {
  var arLista = D.ar.slice().reverse();
  var html = '<div class="tabellyta"><table><thead><tr><th class="vanster">Parti</th>' +
    arLista.map(function (a) { return "<th>" + a + " %</th>"; }).join("") +
    "<th>Index " + state.ar + "</th></tr></thead><tbody>";
  D.partier.concat(lokalaPartier(valtyp), ["ÖVR"]).forEach(function (p) {
    html += '<tr><td class="vanster"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' +
      (PARTIFARG[p] || "var(--dampad)") + ';margin-right:6px"></span>' + esc(PARTINAMN[p] || p) + "</td>";
    arLista.forEach(function (a) {
      var r = d.val[valtyp][a];
      var dolj = r && r.matchning === "uppskattad" && !state.visaUppskattade;
      var v = (r && !dolj && r.giltiga) ? 100 * (r.roster[p] || 0) / r.giltiga : null;
      html += '<td class="tal' + (r && r.matchning === "uppskattad" && !dolj ? " uppskattad" : "") + '">' + proc(v) + "</td>";
    });
    var rr = d.val[valtyp][state.ar];
    var kk = D.kommun[valtyp][state.ar];
    var kAndel = kk && kk.giltiga ? 100 * (kk.roster[p] || 0) / kk.giltiga : null;
    var dAndel = rr && rr.giltiga ? 100 * (rr.roster[p] || 0) / rr.giltiga : null;
    html += '<td class="tal">' + (kAndel && dAndel !== null ? tal(100 * dAndel / kAndel, 0) : "–") + "</td></tr>";
  });
  html += "</tbody></table></div>";
  var anm = D.ar.map(function (a) {
    var r = d.val[valtyp][a];
    if (!r) return a + ": ingen historik";
    if (r.matchning === "uppskattad") return a + ": uppskattat från äldre distriktsgränser";
    if (r.matchning === "officiell") return a + ": officiell jämförelse";
    return a + ": faktiskt resultat";
  }).join(" · ");
  return html + '<p class="notis">' + esc(anm) + "</p>";
}

/* ---------- kampanjprioritering ---------- */

/* Röster inom räckhåll: det som går att vinna i distriktet, i röster, så att
   ett stort och ett litet distrikt blir jämförbara. Två källor:
   - mobilisering: de som inte röstade, gånger partigruppens andel bland dem
     som röstade (antagandet är att de lutar som sina grannar), gånger den
     del kampanjen kan tänkas få att rösta;
   - övertalning: rösterna på närliggande partier, gånger den del som kan
     tänkas gå att övertyga.
   Andelarna är antaganden som ställs med reglagen - rangordningen beror mest
   på förhållandet mellan dem. Täthet är ingen egen faktor utan en kostnad:
   rangordnat per km² kommer de distrikt först där rösterna bor tätt. */
function narliggandeGrupp() {
  return state.narliggande.filter(function (p) { return state.partier.indexOf(p) < 0; });
}
function ritaKampanj() {
  var nara = narliggandeGrupp();
  var rader = D.distrikt.map(function (d) {
    var r = post(d, state.ar);
    if (!r || !passerar(d) || !r.giltiga) return null;
    var ej = ejRostande(r, state.ar);
    var naraRoster = nara.reduce(function (t, p) { return t + (r.roster[p] || 0); }, 0);
    var mobil = state.mobilisering / 100 * ej * gruppRoster(r) / r.giltiga;
    var overt = state.overtalning / 100 * naraRoster;
    return { d: d, stod: andel(r), ej: ej, nara: naraRoster, mobil: mobil, overt: overt,
      total: mobil + overt, perkm2: d.km2 ? (mobil + overt) / d.km2 : null };
  }).filter(Boolean);
  var nyckelNu = state.rangordning === "perkm2" ? "perkm2" : "total";
  rader.sort(function (a, b) { return (b[nyckelNu] || 0) - (a[nyckelNu] || 0); });
  var max = Math.max.apply(null, rader.map(function (r) { return r[nyckelNu] || 0; })) || 1;
  /* Rösterna inom räckhåll uppifrån och ned i listan, och raden där de räcker
     till nästa mandat i kommunfullmäktige. */
  var summa = 0;
  rader.forEach(function (r) { summa += r.total; r.ack = summa; });
  var mal = kampanjmal(), malrad = -1;
  if (mal) for (var k = 0; k < rader.length && malrad < 0; k++) if (rader[k].ack >= mal.roster) malrad = k;
  /* Området står under distriktsnamnet i stället för i en egen spalt, och
     rubrikerna får bryta - annars ryms inte tabellen på en vanlig skärm. */
  var html = '<thead><tr><th class="vanster">#</th><th class="vanster">Distrikt</th>' +
    "<th>" + (nyckelNu === "perkm2" ? "Röster inom räckhåll per km²" : "Röster inom räckhåll") + "</th>" +
    '<th title="Summan av rösterna inom räckhåll på den här raden och alla ovanför">Summa hittills</th>' +
    "<th>varav mobilisering</th><th>varav övertalning</th>" +
    (nyckelNu === "perkm2" ? "<th>Röster inom räckhåll</th>" : "<th>per km²</th>") +
    "<th>Röstade ej</th><th>" + esc(gruppnamn()) + " %</th><th>" + (nara.length ? esc(nara.join("+")) : "Närliggande") +
    "</th></tr></thead><tbody>";
  rader.forEach(function (r, i) {
    var v = r[nyckelNu] || 0;
    html += "<tr" + (i === malrad ? ' class="malrad"' : "") + '><td class="vanster">' + (i + 1) +
      '</td><td class="vanster"><span class="namn">' + esc(r.d.namn) +
      '</span><span class="omrade">' + esc(r.d.ort) + "</span></td>" +
      '<td class="tal stapel"><i style="width:' + Math.round(70 * v / max) + '%"></i><span>' + tal(v, 0) + "</span></td>" +
      '<td class="tal">' + tal(r.ack, 0) + (i === malrad ? '<span class="malmarke">nästa mandat</span>' : "") + "</td>" +
      '<td class="tal">' + tal(r.mobil, 0) + '</td><td class="tal">' + tal(r.overt, 0) + "</td>" +
      '<td class="tal">' + tal(nyckelNu === "perkm2" ? r.total : r.perkm2, 0) + "</td>" +
      '<td class="tal">' + tal(r.ej) + '</td><td class="tal">' + proc(r.stod) + '</td><td class="tal">' + tal(r.nara) + "</td></tr>";
  });
  $("kampanjtabell").innerHTML = html + "</tbody>";
  document.querySelectorAll(".gruppnamn").forEach(function (el) { el.textContent = gruppnamn(); });
  $("mobil").value = state.mobilisering;
  $("mobilv").textContent = tal(state.mobilisering) + " %";
  $("overtyga").value = state.overtalning;
  $("overtygav").textContent = tal(state.overtalning, state.overtalning % 1 ? 1 : 0) + " %";
  $("rangordning").value = state.rangordning;
  document.querySelectorAll("#narliggande .parti").forEach(function (el) {
    var p = el.getAttribute("data-parti");
    var iGruppen = state.partier.indexOf(p) >= 0;
    var vald = !iGruppen && state.narliggande.indexOf(p) >= 0;
    el.querySelector("input").checked = vald;
    el.querySelector("input").disabled = iGruppen;
    el.setAttribute("data-vald", vald ? "ja" : "nej");
    el.style.opacity = iGruppen ? "0.4" : "";
    el.title = PARTINAMN[p] + (iGruppen ? " (ingår redan i partigruppen)" : "");
  });
  $("kampanjsumma").textContent = "Sammanlagt " + tal(summa, 0) + " röster inom räckhåll i " + rader.length +
    " distrikt" + (state.indexFilter ? " där " + gruppnamn() + " har index över " + state.indexGrans : "") +
    " med de här antagandena.";
  $("kampanjmal").innerHTML = kampanjmalText(mal, malrad, summa);
}

/* Målet att räkna mot: röster till nästa mandat i kommunfullmäktige för
   partigruppen, det billigaste om gruppen har flera partier. Bara när
   kommunvalet är valt - rösterna inom räckhåll räknas på det valda valet. */
function kampanjmal() {
  var roster = state.valtyp === "KF" ? mandatroster(state.ar) : null;
  var grupp = roster ? mandatgrupp(roster) : [];
  return grupp.length ? billigast(roster, grupp, 1) : null;
}
function kampanjmalText(mal, malrad, summa) {
  if (state.valtyp !== "KF") {
    return mandatregler() && state.partier.length ? "Välj kommunvalet för att se hur långt rösterna inom räckhåll " +
      "räcker mot nästa mandat i kommunfullmäktige." : "";
  }
  if (!mal) return "";
  var grupp = mandatgrupp(mandatroster(state.ar));
  var majoritet = Math.floor(mandatregler().antal / 2) + 1;
  var txt = "<strong>Nästa mandat:</strong> i kommunvalet " + state.ar + " hade " + esc(gruppnamn()) + " behövt <strong>" +
    tal(mal.roster) + " fler röster</strong>" + (grupp.length > 1 ? " på " + mal.parti : "") + " för ett " +
    ordningstal(mal.mandat) + " mandat" + (grupp.length > 1 && mal.mandat === majoritet ? " och egen majoritet" : "") +
    (mal.motpart ? " - det hade tagits från " + mal.motpart : "") + ". ";
  txt += malrad >= 0
    ? "Med de här antagandena räcker rösterna inom räckhåll i " + (malrad === 0 ? "första distriktet" : "de " + (malrad + 1) +
      " första distrikten") + " i listan till det."
    : "Det är fler än alla röster inom räckhåll i listan tillsammans (" + tal(summa, 0) + ") med de här antagandena.";
  return txt;
}

/* ---------- kampanjeffekt ---------- */

/* Kampanjen som analyseras och valen som förändringen räknas mellan: valet
   kampanjen gjordes inför och valet innan. För den senaste kampanjen följer
   jämförelseåret reglaget, utom när det också står på kampanjens år.
   "tidigare" är kampanjerna i datat som gjordes inför utgångsvalet eller
   senare: de ligger i utgångsläget eller mitt i perioden, så en enhet som hade
   samma typ av aktivitet då är inte orörd. */
function effektAr() {
  var lista = kampanjAr();
  var ar = lista.indexOf(state.effektKampanj) >= 0 ? state.effektKampanj : lista[0];
  var i = D.ar.indexOf(ar);
  var jmfar = i === 0 && state.jmfar !== ar ? state.jmfar : D.ar[i + 1];
  return { ar: ar, jmfar: jmfar,
    tidigare: lista.filter(function (k) { return jmfar && k < ar && k >= jmfar; }) };
}
/* Förra valets kampanj ligger i utgångsläget - då går de två kampanjerna att
   jämföra direkt. */
function forraKampanj(ar) { return ar.tidigare.indexOf(ar.jmfar) >= 0 ? ar.jmfar : null; }

/* Deterministisk slump, så att samma inställningar alltid ger samma siffror. */
var SLUMPFRO = 20260913;
function slumpgenerator(fro) {
  return function () {
    fro = (fro + 0x6D2B79F5) | 0;
    var t = Math.imul(fro ^ (fro >>> 15), 1 | fro);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function medel(v) { return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
/* Viktat medel av enheternas avvikelse, med antalet giltiga röster som vikt:
   ett distrikt med 1 500 väljare väger dubbelt så tungt som ett med 750. */
function viktatMedel(lista) {
  var sw = 0, swv = 0;
  lista.forEach(function (r) { sw += r.vikt; swv += r.vikt * r.avv; });
  return sw ? swv / sw : null;
}

/* Skillnaden i viktad medelavvikelse mellan en grupp och de orörda enheterna,
   och hur stor skillnad slumpen ger: lika många enheter dras på måfå ur
   samma pott 4 000 gånger. p är andelen dragningar som gav minst lika stor
   skillnad; "slump" är gränsen som 95 procent av dragningarna håller sig
   innanför. */
var DRAGNINGAR = 4000;
function jamfor(grupp, ororda, slump) {
  var n = grupp.length;
  if (!n || !ororda.length) return { n: n, jmfn: ororda.length, skillnad: null };
  var skillnad = viktatMedel(grupp) - viktatMedel(ororda);
  /* Potten och avvikelserna som typade listor i stället för listor av par och
     tal: med prövningen mot tidigare val blir det flera miljoner dragningar
     varje gång fliken ritas, och så går det fortare - med exakt samma siffror. */
  var N = n + ororda.length, vikt = new Float64Array(N), vv = new Float64Array(N);
  grupp.concat(ororda).forEach(function (r, i) { vikt[i] = r.vikt; vv[i] = r.vikt * r.avv; });
  var SW = 0, SWV = 0, i, t;
  for (i = 0; i < N; i++) { SW += vikt[i]; SWV += vv[i]; }
  var minst = 0, avvikelser = new Float64Array(DRAGNINGAR);
  for (var k = 0; k < DRAGNINGAR; k++) {
    // Fisher-Yates bara så långt som behövs för att dra n stycken
    var sw = 0, swv = 0;
    for (i = 0; i < n; i++) {
      var j = i + Math.floor(slump() * (N - i));
      t = vikt[i]; vikt[i] = vikt[j]; vikt[j] = t;
      t = vv[i]; vv[i] = vv[j]; vv[j] = t;
      sw += vikt[i]; swv += vv[i];
    }
    var diff = Math.abs(swv / sw - (SWV - swv) / (SW - sw));
    avvikelser[k] = diff;
    if (diff >= Math.abs(skillnad) - 1e-9) minst++;
  }
  avvikelser.sort();   // en typad lista sorteras som tal, stigande
  /* Skillnaden i röster: en indexenhet är en hundradel av kommunens andel,
     räknat på de giltiga rösterna i enheterna som hade aktiviteten. */
  var giltiga = grupp.reduce(function (t, r) { return t + r.vikt; }, 0);
  return { n: n, jmfn: ororda.length, skillnad: skillnad, p: minst / DRAGNINGAR, slump: kvantil(avvikelser, 0.95),
    giltiga: giltiga };
}

/* Offentliga kampanjer i stadskärnan, vid stationerna och på de flesta
   evenemang når folk som bor i hela kommunen, så distriktet där de ägde rum
   säger ingenting om vilka de nådde. Stationskampanjerna och evenemangen tas
   helt ur effektanalysen, utom lokala evenemang (a.lokalt: Sandbydagen,
   Västerdagen, Pride i Södra Sandby och Dalby) som räknas i sitt distrikt. I
   stadskärnan tas bara de offentliga typerna bort (torg, debatter och så vidare) -
   dörrknackning, brevlådor och valsedlar når de boende där som på andra håll
   och räknas som vanligt. Stadskärnans distrikt är inte heller med i
   jämförelsen för de offentliga typerna: där hade de annars räknats som orörda
   fast de var de mest kampanjade i kommunen. */
var CENTRUM = [
  "12810101", // Centrum, Krafts rote
  "12810102", // Centrum, Clemens rote
  "12810103", // Centrum, Vårfru rote
  "12810108", // Centrum, Drottens rote-Svanelyckan
  "12810111"  // Centrum, Färgaren
];
var EJ_EFFEKT_TYPER = ["pendel", "evenemang"];
function ejEffekt(a) { return EJ_EFFEKT_TYPER.indexOf(a.typ) >= 0 && !a.lokalt; }
function iCentrum(kod) { return CENTRUM.indexOf(kod) >= 0; }
/* Typer som skedde på en plats, dit folk kom. "alla" räknas hit: stadskärnans
   distrikt hade offentliga kampanjer som inte räknas, så de kan inte sägas
   vara vare sig träffade eller orörda. */
function offentligTyp(t) { return t === "alla" || !kampanjtyp(t).boende; }
/* Distrikten en aktivitet räknas till i effektanalysen - tom lista om den
   inte är med alls. */
function effektDistrikt(a) {
  if (!a.distrikt || ejEffekt(a)) return [];
  if (!offentligTyp(a.typ)) return a.distrikt;
  return a.distrikt.filter(function (kod) { return !iCentrum(kod); });
}
function effektAktiviteter(ar) {
  return aktiviteter(ar).filter(function (a) { return effektDistrikt(a).length; });
}
function uteslutnaAktiviteter(ar) {
  var u = { stad: 0, pendel: 0, evenemang: 0 };
  aktiviteter(ar).forEach(function (a) {
    if (!a.distrikt || effektDistrikt(a).length) return;
    u[ejEffekt(a) ? a.typ : "stad"]++;
  });
  return u;
}

function kampanjerIEnhet(e, ar) {
  var sedda = [];
  e.koder.forEach(function (kod) {
    kampanjerI(kod, ar).forEach(function (a) {
      if (sedda.indexOf(a) < 0 && effektDistrikt(a).indexOf(kod) >= 0) sedda.push(a);
    });
  });
  return sedda;
}

/* Det väntade utfallet för varje enhet ur ett eller flera förklarande värden
   (xs, funktioner av raden): minsta kvadrat viktad med antalet röster - en rät
   linje genom alla enheter med ett värde, ett plan med två. Sätter
   r.forvantat och r.avv, avvikelsen från det väntade, och returnerar
   lutningarna. Värdena centreras först, så att konstanten faller bort. */
function justera(rader, xs) {
  var SW = 0, my = 0;
  var mx = xs.map(function () { return 0; });
  rader.forEach(function (r) {
    SW += r.vikt; my += r.vikt * r.y;
    xs.forEach(function (f, i) { mx[i] += r.vikt * f(r); });
  });
  my /= SW;
  mx = mx.map(function (m) { return m / SW; });
  var A = xs.map(function () { return xs.map(function () { return 0; }); });
  var b = xs.map(function () { return 0; });
  rader.forEach(function (r) {
    var x = xs.map(function (f, i) { return f(r) - mx[i]; });
    x.forEach(function (xi, i) {
      b[i] += r.vikt * xi * (r.y - my);
      x.forEach(function (xj, j) { A[i][j] += r.vikt * xi * xj; });
    });
  });
  var lutning = losEkvationer(A, b);
  rader.forEach(function (r) {
    r.forvantat = xs.reduce(function (s, f, i) { return s + lutning[i] * (f(r) - mx[i]); }, my);
    r.avv = r.y - r.forvantat;
  });
  return lutning;
}

/* Löser A x = b för ett litet ekvationssystem med Gauss elimination. Saknar
   systemet lösning - alla enheter har samma värde - blir lutningarna 0. */
function losEkvationer(A, b) {
  var n = b.length;
  var M = A.map(function (rad, i) { return rad.concat([b[i]]); });
  for (var c = 0; c < n; c++) {
    var p = c, r;
    for (r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
    if (!M[c][c]) return b.map(function () { return 0; });
    for (r = 0; r < n; r++) {
      if (r === c) continue;
      var f = M[r][c] / M[c][c];
      for (var k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map(function (rad, i) { return rad[n] / rad[i]; });
}

/* Enheterna som hade varje typ av aktivitet i en kampanj, som {typ: {id:
   antal}}, plus "alla" för någon aktivitet alls. Med urval räknas bara de
   aktiviteter som urvalet släpper igenom. */
function traffadeEnheter(ind, ar, urval) {
  var t = { alla: {} };
  kampanjtyper().forEach(function (x) { t[x] = {}; });
  effektAktiviteter(ar).filter(urval || Boolean).forEach(function (a) {
    effektDistrikt(a).forEach(function (kod) {
      var id = ind.perKod[kod] ? ind.perKod[kod].id : kod;
      t[a.typ][id] = (t[a.typ][id] || 0) + 1;
      t.alla[id] = (t.alla[id] || 0) + 1;
    });
  });
  return t;
}

/* Enheterna delade per typ av aktivitet i de som hade den, de som låg granne
   med den och de orörda, och skillnaden i avvikelse mot de orörda. Kräver att
   r.avv är satt. Sätter också r.grannar och grannarnas avvikelse.
   kampanj är {ar, tidigare}, se effektAr. En enhet som hade samma typ av
   aktivitet i en tidigare kampanj, men varken hade den eller låg granne med
   den i den här, är inte orörd: dess utgångsläge kan vara lyft av den förra
   kampanjen. Den hamnar i "bara" och är inte med i jämförelsen. Enheterna med
   aktiviteten delas också i "ny" och "bada" efter om de hade den förra gången. */
function jamforTyper(ind, rader, slump, kampanj) {
  var perId = {};
  rader.forEach(function (r) { perId[r.e.id] = r; });
  rader.forEach(function (r) {
    var ids = [];
    r.e.distrikt.forEach(function (d) {
      (d.grannar || []).forEach(function (k) {
        var g = ind.perKod[k];
        if (g && g !== r.e && ids.indexOf(g.id) < 0) ids.push(g.id);
      });
    });
    r.grannar = ids;
    var g = ids.map(function (id) { return perId[id]; }).filter(Boolean);
    r.grannavv = g.length ? viktatMedel(g) : null;
  });

  var traffade = traffadeEnheter(ind, kampanj.ar);
  var fore = kampanj.tidigare.map(function (ar) { return traffadeEnheter(ind, ar); });
  var antal = effektAktiviteter(kampanj.ar);
  return kampanjtyper().concat(["alla"]).map(function (t) {
    var i = traffade[t];
    var hadeFore = function (r) { return fore.some(function (f) { return f[t][r.e.id]; }); };
    var direkt = [], grannar = [], ororda = [], bara = [], tidigare = 0;
    var utanCentrum = offentligTyp(t);
    rader.forEach(function (r) {
      if (utanCentrum && r.e.koder.some(iCentrum)) return;
      if (hadeFore(r)) tidigare++;
      if (i[r.e.id]) direkt.push(r);
      else if (r.grannar.some(function (id) { return i[id]; })) grannar.push(r);
      else if (hadeFore(r)) bara.push(r);
      else ororda.push(r);
    });
    return {
      typ: t,
      aktiviteter: antal.filter(function (a) { return t === "alla" || a.typ === t; }).length,
      direkt: direkt, grannar: grannar, ororda: ororda, bara: bara, tidigare: tidigare,
      ny: direkt.filter(function (r) { return !hadeFore(r); }), bada: direkt.filter(hadeFore),
      iDistriktet: jamfor(direkt, ororda, slump),
      runtOm: jamfor(grannar, ororda, slump)
    };
  }).filter(function (x) { return x.aktiviteter; });
}

/* Enheterna med aktiviteten uppdelade efter förra kampanjen, var grupp mot
   samma orörda: ny, båda gångerna och bara förra gången. Egen slumpföljd, så
   att huvudtabellens siffror inte beror på den här uppdelningen. */
function delaEfterForra(typer, slump) {
  typer.forEach(function (x) {
    x.somNy = jamfor(x.ny, x.ororda, slump);
    x.somBada = jamfor(x.bada, x.ororda, slump);
    x.somBara = jamfor(x.bara, x.ororda, slump);
  });
}

/* Kampanjeffekten räknas per jämförelseenhet: omritade distrikt i grupp,
   eftersom deras historik annars är en ytuppskattning som slår fel just där
   folk flyttat in. */
function kampanjeffekt() {
  if (!D.kampanjer) return null;
  var ar = effektAr();
  if (!ar.jmfar) return null;
  var ind = indelning(ar.ar, ar.jmfar);
  var rader = ind.lista.map(function (e) {
    var nu = enhetspost(e, ar.ar), fore = enhetspost(e, ar.jmfar);
    var efter = indexAvPost(nu, ar.ar), f = indexAvPost(fore, ar.jmfar);
    return { e: e, namn: e.namn, fore: f, efter: efter, vikt: nu ? nu.giltiga : 0,
      y: f === null || efter === null ? null : efter - f };
  }).filter(function (r) {
    return r.y !== null && r.vikt > 0;
  });
  if (rader.length < 10) return null;

  /* Distrikt som låg högt förra valet tenderar att gå tillbaka mot mitten och
     tvärtom, kampanj eller inte. Därför jämförs inte själva indexförändringen
     utan avvikelsen från den förändring som var att vänta utifrån var
     distriktet låg förra gången (en rät linje genom alla enheter, viktad
     med antalet röster). */
  var lutning = justera(rader, [function (r) { return r.fore; }])[0];
  var typer = jamforTyper(ind, rader, slumpgenerator(SLUMPFRO), ar);
  if (forraKampanj(ar)) delaEfterForra(typer, slumpgenerator(SLUMPFRO));
  return { ar: ar, rader: rader, lutning: lutning, typer: typer, ka: kommunAndel(ar.ar),
    provning: effektProvning(ar) };
}

/* Prövning mot tidigare val. Ett enskilt val är en osäker utgångspunkt: med
   några hundra väljare för partigruppen i ett distrikt flyttar slumpen ensam
   index flera enheter mellan två val. Skillnaden räknas därför om på de
   enheter som går att följa exakt i alla tre valen, på tre sätt:
   - somOvan: som huvudtabellen, men på de här enheterna, så att de två andra
     har något att jämföras med;
   - bada: det väntade utfallet ur var enheten låg i båda de tidigare valen,
     så att ett enstaka bra eller dåligt val inte slår igenom lika hårt.
     Förändringen räknas från förra valet, men avvikelserna blir desamma
     räknat från valet innan: skillnaden mellan de två är index förra valet
     minus index valet innan, och det tar justeringen bort;
   - fore: samma jämförelse ett val bakåt, förändringen mellan de två
     tidigare valen, innan något av kampanjen hade hänt. En skillnad där är
     inte kampanjens verk. Vikten är rösterna i det senare valet av de två,
     som i huvudtabellen.
   Finns förra valets kampanj i datat räknas den också för sig på samma
   enheter (forra): hade dess aktiviteter samma samband med valet den gjordes
   inför? Den kampanjens utgångsläge har i sin tur en kampanj som inte finns
   i datat. */
function effektProvning(ar) {
  var i = D.ar.indexOf(ar.ar), a1 = D.ar[i + 1], a2 = D.ar[i + 2];
  if (!a1 || !a2 || (ar.jmfar !== a1 && ar.jmfar !== a2)) return null;
  var ind = indelning(a1, a2);
  var bas = [];
  ind.lista.forEach(function (e) {
    var post = {}, idx = {};
    var hel = [ar.ar, a1, a2].every(function (a) {
      post[a] = enhetspost(e, a);
      idx[a] = indexAvPost(post[a], a);
      return idx[a] !== null && post[a].giltiga > 0;
    });
    if (hel) bas.push({ e: e, post: post, idx: idx });
  });
  if (bas.length < 10) return null;
  var index = function (a) { return function (r) { return r.idx[a]; }; };
  function analys(y, xs, viktar, kampanj) {
    var rader = bas.map(function (b) { return { e: b.e, idx: b.idx, y: y(b), vikt: b.post[viktar].giltiga }; });
    justera(rader, xs);
    return jamforTyper(ind, rader, slumpgenerator(SLUMPFRO), kampanj);
  }
  var p = {
    tidigare: [a2, a1],
    enheter: bas.length,
    distrikt: bas.reduce(function (s, b) { return s + b.e.koder.length; }, 0),
    somOvan: analys(function (b) { return b.idx[ar.ar] - b.idx[ar.jmfar]; }, [index(ar.jmfar)], ar.ar, ar),
    bada: analys(function (b) { return b.idx[ar.ar] - b.idx[a1]; }, [index(a1), index(a2)], ar.ar, ar),
    fore: analys(function (b) { return b.idx[a1] - b.idx[a2]; }, [index(a2)], a1, ar)
  };
  if (kampanjAr().indexOf(a1) >= 0) {
    p.forra = analys(function (b) { return b.idx[a1] - b.idx[a2]; }, [index(a2)], a1,
      { ar: a1, tidigare: kampanjAr().filter(function (k) { return k < a1 && k >= a2; }) });
  }
  return p;
}

/* Prövningens tre jämförelser för en typ av aktivitet. */
function provningFor(p, t) {
  if (!p) return null;
  var hitta = function (lista) { return lista.filter(function (x) { return x.typ === t; })[0]; };
  return { somOvan: hitta(p.somOvan), bada: hitta(p.bada), fore: hitta(p.fore) };
}

/* Bedömningen i ord. Med få distrikt går det inte att skilja en effekt från
   slumpen, hur stor skillnaden än ser ut - det sägs då rakt ut. */
var MINST_DISTRIKT = 3, MINST_ORORDA = 5, P_TYDLIGT = 0.05, P_ANTYDAN = 0.2;
function bedomning(j) {
  if (j.jmfn < MINST_ORORDA) return { text: "För få orörda distrikt att jämföra med", klass: "fa" };
  if (j.skillnad === null || j.n < MINST_DISTRIKT) return { text: "För få distrikt för att bedöma", klass: "fa" };
  var rikt = j.skillnad > 0 ? "bättre" : "sämre";
  if (j.p < P_TYDLIGT) return { text: "Tydligt " + rikt + " än orörda distrikt", klass: j.skillnad > 0 ? "plus" : "minus" };
  if (j.p < P_ANTYDAN) return { text: "Svag antydan om " + rikt + " utfall", klass: "svag" };
  return { text: "Ingen mätbar skillnad", klass: "ingen" };
}

/* Indexenheter till röster: en indexenhet är ka/100 procentenheter av de
   giltiga rösterna i enheterna som jämförs. */
function indexTillRoster(v, j, ka) { return v * ka / 100 * j.giltiga / 100; }

/* Tre decimaler nära gränserna, annars står "tydligt" (p under 0,05) intill
   "p = 0,05" när p är 0,049 - och fler om avrundningen ändå hamnar på andra
   sidan en gräns, som "svag antydan" (under 0,2) intill "p = 0,20" när p är
   0,199. */
function pText(p) {
  var dec = p < 0.1 ? 3 : 2;
  var visat = function () { return Number(tal(p, dec).replace(",", ".")); };
  while (dec < 5 && [P_TYDLIGT, P_ANTYDAN].some(function (g) { return (p < g) !== (visat() < g); })) dec++;
  return "p\u00a0=\u00a0" + tal(p, dec);
}

/* not: prövningens rad under bedömningen, se provningsnot(). */
function effektCell(j, ka, not) {
  if (!j.n) return '<td class="tal">–</td><td class="tal">–</td><td class="vanster">–</td>';
  var b = bedomning(j);
  var bedomd = b.klass !== "fa";
  return '<td class="tal">' + (j.skillnad === null ? "–" : tecken(j.skillnad, 1)) +
    (bedomd ? '<span class="slumpband"> ±' + tal(j.slump, 1) + "</span>" : "") + "</td>" +
    '<td class="tal">' + (j.skillnad === null || !ka ? "–" : "≈ " + tecken(indexTillRoster(j.skillnad, j, ka), 0)) +
    (bedomd && ka ? '<span class="slumpband"> ±' + tal(indexTillRoster(j.slump, j, ka), 0) + "</span>" : "") + "</td>" +
    '<td class="vanster"><span class="bedomning ' + b.klass + '">' + esc(b.text) + "</span>" +
    (bedomd ? ' <span class="notis">' + pText(j.p) + "</span>" : "") + (not || "") + "</td>";
}

/* Vad prövningen mot tidigare val säger om en bedömning i huvudtabellen, som
   en rad under den: att skillnaden blir en annan med båda valen som
   utgångsläge, att distrikten avvek redan före kampanjen - eller att den
   håller. Bara där något påstås, i huvudtabellen eller med båda valen. */
function provningsnot(j, bada, fore, p) {
  if (!p || !j.n) return "";
  var b = bedomning(j), bb = bedomning(bada), bf = bedomning(fore);
  var pastar = function (x) { return x.klass !== "fa" && x.klass !== "ingen"; };
  var hall = function (x, jj) { return pastar(x) ? (jj.skillnad > 0 ? 1 : -1) : 0; };
  if (b.klass === "fa" || (!pastar(b) && !pastar(bb))) return "";
  var valen = p.tidigare[0] + " och " + p.tidigare[1], delar = [];
  if (bb.klass === "fa" || bf.klass === "fa") {
    delar.push("Går inte att pröva mot " + valen + ": för få " +
      (bada.jmfn < MINST_ORORDA ? "orörda distrikt" : "distrikt i jämförelsen") + " som går att följa i alla tre valen.");
  } else {
    if (bb.klass !== b.klass || hall(bb, bada) !== hall(b, j)) {
      delar.push("Väntat ur " + valen + ": " + bb.text.charAt(0).toLowerCase() + bb.text.slice(1) +
        " (" + tecken(bada.skillnad, 1) + ").");
    }
    if (pastar(bf)) {
      var riktning = pastar(b) ? hall(b, j) : hall(bb, bada);
      delar.push("Före kampanjen (" + p.tidigare[0] + "–" + p.tidigare[1] + "): " + (fore.skillnad > 0 ? "bättre" : "sämre") +
        " än väntat (" + tecken(fore.skillnad, 1) + ")" + (hall(bf, fore) === riktning ? " - kan ha varit på väg redan."
          : " - kan vara " + (riktning > 0 ? "återhämtning efter ett svagt " : "tillbakagång efter ett starkt ") + p.tidigare[1] + "."));
    }
    if (!delar.length) delar.push("Håller i prövningen mot " + valen + ".");
  }
  return '<span class="provning">' + delar.join(" ") + "</span>";
}

function typnamn(t) { return t === "alla" ? "Någon aktivitet alls" : kampanjtyp(t).namn; }
/* Typens bokstav i en ruta - fylld för aktiviteter som riktade sig till de
   boende. */
function typruta(t, antal) {
  return '<span class="kampanjruta' + (kampanjtyp(t).boende ? " boende" : "") + '" title="' +
    esc(kampanjtyp(t).namn) + '">' + kampanjtyp(t).bokstav + (antal > 1 ? antal : "") + "</span>";
}
/* Rutan följd av typens namn. */
function typetikett(t) {
  return (t === "alla" ? "" : typruta(t) + " ") + esc(typnamn(t));
}

/* En siffra i prövningstabellen: skillnaden, slumpbandet och en kort
   bedömning under - med antalet enheter först när antal är satt. */
function provcell(j, antal) {
  if (!j || !j.n) return '<td class="tal">–</td>';
  var b = bedomning(j), bedomd = b.klass !== "fa";
  var kort = !bedomd ? (j.jmfn < MINST_ORORDA ? "för få orörda" : "för få distrikt") : b.klass === "ingen" ? "ingen skillnad" :
    (b.klass === "svag" ? "antydan om " : "tydligt ") + (j.skillnad > 0 ? "bättre" : "sämre");
  return '<td class="tal"><span class="bedomning ' + b.klass + '">' + (j.skillnad === null ? "–" : tecken(j.skillnad, 1)) +
    "</span>" + (bedomd ? '<span class="slumpband"> ±' + tal(j.slump, 1) + "</span>" : "") +
    '<span class="kortbedomning">' + (antal ? j.n + (j.n === 1 ? " enhet · " : " enheter · ") : "") +
    kort + (bedomd ? " · " + pText(j.p) : "") + "</span></td>";
}

/* Prövningen mot tidigare val som tabell: för varje typ en rad för
   distrikten med aktiviteten och en för grannarna, med skillnaden väntad ur
   förra valet (som ovan), ur båda de tidigare valen och före kampanjen. */
function provningstabell(e) {
  var p = e.provning;
  var html = '<div class="kort"><h3>Prövning mot tidigare val</h3>';
  if (!p) return html + '<p class="hjalp">' + (D.ar[D.ar.indexOf(e.ar.ar) + 2] ?
    "Prövningen behöver siffror från tre val för minst tio jämförelseenheter." :
    "Prövningen behöver två val före kampanjen, och datat börjar med valet " + D.ar[D.ar.length - 1] + ".") + "</p></div>";
  var f = p.tidigare[0], s = p.tidigare[1], forra = kampanjAr().indexOf(s) >= 0;
  html += '<p class="hjalp">Ett enskilt val är en osäker utgångspunkt. Med några hundra väljare för partigruppen i ett ' +
    "distrikt flyttar slumpen ensam index flera enheter mellan två val. Skillnaden räknas därför om på de " +
    p.enheter + " jämförelseenheter (" + p.distrikt + " distrikt) som går att följa exakt i alla tre valen - tabellen " +
    "ovan har " + e.rader.length + ", så första kolumnen kan skilja sig något från den.</p>" +
    '<p class="hjalp"><b>Väntat ur ' + f + " och " + s + "</b> räknar det väntade utfallet ur var distriktet låg " +
    "båda gångerna, så att ett enstaka bra eller dåligt val " + s + " inte slår igenom lika hårt. <b>Före kampanjen</b> " +
    "är samma jämförelse ett val tidigare: förändringen " + f + "–" + s + ", innan något av det som gjordes inför " +
    e.ar.ar + " hade hänt. En skillnad där är inte kampanjens verk. Åt samma håll betyder den att distrikten redan " +
    "var på väg, åt andra hållet att en del av skillnaden efteråt kan vara en återgång efter ett ovanligt " + s + ". " +
    (forra ? "Perioden rymmer kampanjen inför " + s + ", som ofta gick till samma distrikt - " +
      (forraKampanj(e.ar) ? "hur den syntes står i tabellen <i>Kampanjen " + s + " och " + e.ar.ar + "</i> ovan. " :
        "välj " + s + " som jämförelseår för att se hur den syntes. ") : "") +
    "Vad prövningen säger står också under bedömningen i tabellen ovan.</p></div>";
  html += '<div class="tabellyta"><table class="provtabell"><thead><tr>' +
    '<th class="vanster">Typ av aktivitet</th><th class="vanster">Jämfört</th><th>Enheter</th>' +
    "<th>Väntat ur " + e.ar.jmfar + "</th><th>Väntat ur " + f + " och " + s + "</th><th>Före kampanjen, " + f + "–" + s + "</th>" +
    "</tr></thead><tbody>";
  e.typer.forEach(function (x) {
    var t = provningFor(p, x.typ);
    [["iDistriktet", "direkt", "i distriktet"], ["runtOm", "grannar", "runt om"]].forEach(function (del, i) {
      html += "<tr>" + (i ? "" : '<td class="typ" rowspan="2">' + typetikett(x.typ) + "</td>") +
        '<td class="vanster">' + del[2] + '</td><td class="tal">' + t.somOvan[del[1]].length + "</td>" +
        provcell(t.somOvan[del[0]]) + provcell(t.bada[del[0]]) + provcell(t.fore[del[0]]) + "</tr>";
    });
  });
  return html + "</tbody></table></div>";
}

/* En remsa per typ: varje distrikt är en prick på avvikelsens axel. Fyllda
   prickar hade aktiviteten i distriktet, ringar hade den i ett grannområde,
   små grå är ororda och grå ringar hade den bara i en tidigare kampanj (inte
   med i jämförelsen). Strecket visar medelvärdet för de fyllda. */
function effektRemsor(e) {
  var max = 0;
  e.rader.forEach(function (r) { max = Math.max(max, Math.abs(r.avv)); });
  max = Math.ceil(max / 5) * 5 || 5;
  var pos = function (v) { return (50 + 50 * v / max).toFixed(2) + "%"; };
  var skala = '<div class="remsrad axel"><span></span><div class="remsa">' +
    [-max, -max / 2, 0, max / 2, max].map(function (v) {
      return '<span class="bock" style="left:' + pos(v) + '">' + tecken(v, 0) + "</span>";
    }).join("") + "</div></div>";
  var html = e.typer.map(function (x) {
    var prickar = [];
    var lagg = function (lista, klass) {
      lista.forEach(function (r) {
        prickar.push('<i class="' + klass + '" style="left:' + pos(r.avv) + '" title="' +
          esc(r.namn + ": " + tecken(r.avv, 1) + " mot förväntat") + '"></i>');
      });
    };
    lagg(x.ororda, "ororda");
    lagg(x.bara, "bara");
    lagg(x.grannar, "granne");
    lagg(x.direkt, "direkt");
    var m = viktatMedel(x.direkt);
    if (m !== null) prickar.push('<b class="medel" style="left:' + pos(m) + '" title="Viktat medel i distrikten: ' +
      tecken(m, 1) + '"></b>');
    return '<div class="remsrad"><span class="remsnamn">' + esc(typnamn(x.typ)) + '</span><div class="remsa">' +
      '<span class="noll" style="left:50%"></span>' + prickar.join("") + "</div></div>";
  }).join("");
  return '<div class="remsor">' + html + skala + "</div>" +
    '<p class="remsforklaring"><span><i class="direkt"></i>aktivitet i distriktet</span>' +
    '<span><i class="granne"></i>i ett grannområde</span><span><i class="ororda"></i>orört</span>' +
    (e.ar.tidigare.length ? '<span><i class="bara"></i>bara inför ' + e.ar.tidigare.join(" eller ") +
      ", inte med i jämförelsen</span>" : "") +
    '<span><b class="medel"></b>medel där aktiviteten fanns</span></p>';
}

function uteslutetText(ar) {
  var u = uteslutnaAktiviteter(ar);
  return "<strong>Inte med:</strong> " + (u.pendel ? u.pendel + " morgon- och eftermiddagskampanjer vid station, " : "") +
    (u.evenemang ? u.evenemang + " evenemang som drog folk från hela Lund, " : "") +
    u.stad + " offentliga aktiviteter (torg, debatter med mera) i stadskärnans " + CENTRUM.length +
    " Centrum-distrikt. De når folk från hela kommunen, så distriktet där de ägde rum säger inget om vilka de " +
    "nådde. Centrum-distrikten är därför inte heller med i jämförelsen för de typerna, och inte i raden " +
    "<i>Någon aktivitet alls</i> - annars hade de räknats som orörda fast de var de mest kampanjade. " +
    "Dörrknackning, brevlådor och valsedlar räknas som vanligt även där. Allt syns fortfarande i kampanjlagret på kartan.";
}

/* Var källan till en kampanj kommer ifrån, ur datat. */
function kampanjKalla(ar) {
  return (D.kampanjer.kallor && D.kampanjer.kallor[ar]) || "kampanjgruppens listor";
}

/* Förra valets kampanj ligger i utgångsläget som förändringen räknas från.
   Finns den i datat räknas distrikt som hade samma typ av aktivitet då inte
   som orörda; saknas den sägs det rakt ut. */
function forraText(e) {
  var fore = e.ar.jmfar, nu = e.ar.ar, forra = forraKampanj(e.ar);
  if (forra) {
    var delar = e.typer.filter(function (x) {
      return x.typ !== "alla" && kampanjtyp(x.typ).boende && x.direkt.length && x.tidigare;
    }).map(function (x) { return typnamn(x.typ).toLowerCase() + " " + x.bada.length + " av " + x.direkt.length; });
    return "<strong>Förra valets kampanj.</strong> Kampanjen inför " + forra + " finns också med, ur " +
      esc(kampanjKalla(forra)) + ". Förändringen räknas från " + fore + ", så den kampanjen ligger i utgångsläget: " +
      "kampanjade partiet på samma ställen båda gångerna tar effekterna ut varandra, och ett distrikt som fick en " +
      "aktivitet " + fore + " men inte " + nu + " kan tappa när effekten klingar av. Distrikt som hade samma typ av " +
      "aktivitet " + fore + " räknas därför inte som orörda. " +
      (delar.length ? "Av enheterna med aktiviteten " + nu + " hade den också " + fore + ": " + delar.join(", ") + ". " : "") +
      "Tabellen <i>Kampanjen " + fore + " och " + nu + "</i> längre ned delar upp jämförelsen efter det och visar om " +
      "kampanjen " + fore + " syntes i valet " + fore + ".";
  }
  var text = "<strong>Saknas: var kampanjen var " + fore + ".</strong> Förändringen räknas från " + fore + ", så det " +
    "valets kampanj ligger i utgångsläget. Kampanjade partiet på samma ställen båda gångerna tar effekterna ut " +
    "varandra och syns inte, och distrikt som fick kampanj " + fore + " men inte " + nu + " tappar när effekten " +
    "klingar av och hamnar bland de orörda - då ser " + nu + " års distrikt bättre ut än de är. Var partiet " +
    "kampanjade " + fore + " finns inte i datat." +
    (e.provning ? " Prövningen mot tidigare val längre ned fångar bara en del av det." : "");
  if (e.ar.tidigare.length) {
    text += " Kampanjen inför " + e.ar.tidigare.join(" och ") + " ligger mitt i perioden; distrikt som hade samma " +
      "typ av aktivitet då räknas inte som orörda. Välj " + e.ar.tidigare[e.ar.tidigare.length - 1] + " som " +
      "jämförelseår för att jämföra kampanjerna direkt.";
  }
  if (kampanjAr().indexOf(nu) > 0) text += " Kampanjen inför " + nu + " kommer ur " + esc(kampanjKalla(nu)) + ".";
  return text;
}

/* Kampanjen förra valet och den här, sida vid sida: syntes förra kampanjen i
   valet den gjordes inför (prövningens forra, på enheterna som går att följa i
   alla tre valen) - och hur ser den här ut uppdelad efter var partiet var
   förra gången? Bara typer som fanns i båda kampanjerna. */
function jamforelseKort(e) {
  var forra = forraKampanj(e.ar), nu = e.ar.ar;
  if (!forra) return "";
  var p = e.provning, innan = p ? p.tidigare[0] : D.ar[D.ar.indexOf(forra) + 1];
  var typer = e.typer.filter(function (x) { return x.typ !== "alla" && x.tidigare; });
  var bara = e.typer.filter(function (x) { return x.typ !== "alla" && !x.tidigare; })
    .map(function (x) { return typnamn(x.typ).toLowerCase(); });
  var html = '<div class="kort"><h3>Kampanjen ' + forra + " och " + nu + "</h3>" +
    '<p class="hjalp"><b>Gick mönstret igen?</b> Första kolumnen är samma jämförelse som tabellen ovan, men för ' +
    "kampanjen inför " + forra + " och förändringen " + innan + "–" + forra + ". En skillnad som finns båda gångerna är " +
    "mer värd än en som bara syns en gång. " + (p ? "Den räknas på de " + p.enheter + " enheter som går att följa " +
    "exakt i alla tre valen" : "Den behöver siffror från tre val och går inte att räkna här") + ", och var partiet " +
    "kampanjade inför " + innan + " finns inte i datat. Välj kampanjen inför " + forra + " överst i fliken för hela " +
    "uträkningen.</p>" +
    '<p class="hjalp"><b>Vad betyder förra kampanjen för ' + nu + "?</b> Enheterna med aktiviteten " + nu + " delas upp " +
    "efter om de hade den också " + forra + ", och enheter som bara hade den " + forra + " läggs till. Alla jämförs " +
    "med samma orörda enheter, som inte hade aktiviteten någon av gångerna. <i>Ny " + nu + "</i> är den renaste " +
    "jämförelsen: utgångsläget påverkades inte av någon aktivitet av samma slag. <i>Båda gångerna</i>: gav " +
    "kampanjen lika mycket båda gångerna finns effekten i både utgångsläge och utfall och tar ut sig - här väntas " +
    "ingen skillnad även om kampanjen fungerar. <i>Bara " + forra + "</i> tappar om förra kampanjen gav ett lyft som " +
    "sedan klingade av; den gruppen räknas inte med bland de orörda någonstans på fliken.</p></div>";
  if (!typer.length) return html;
  html += '<div class="tabellyta"><table class="provtabell jamforkampanj"><thead><tr>' +
    '<th class="vanster">Typ av aktivitet</th><th>Kampanjen ' + forra + ", i valet " + forra + "</th>" +
    "<th>Kampanjen " + nu + ", i valet " + nu + "</th><th>varav ny " + nu + "</th><th>varav båda gångerna</th>" +
    "<th>Bara " + forra + ", i valet " + nu + "</th></tr></thead><tbody>";
  typer.forEach(function (x) {
    var f = p && p.forra ? p.forra.filter(function (y) { return y.typ === x.typ; })[0] : null;
    html += '<tr><td class="typ">' + typetikett(x.typ) + "</td>" + provcell(f && f.iDistriktet, true) +
      provcell(x.iDistriktet, true) + provcell(x.somNy, true) + provcell(x.somBada, true) + provcell(x.somBara, true) + "</tr>";
  });
  html += "</tbody></table></div>";
  /* Hur mycket av uppdelningen som vilar på aktiviteter som källan själv är
     osäker på: enheter som bara hade preliminära eller osäkra aktiviteter
     av typen förra gången. Blev de inte av hör enheten till en annan grupp. */
  var saker = traffadeEnheter(indelning(nu, e.ar.jmfar), forra, function (a) { return !a.status; });
  var osakra = typer.map(function (x) {
    var n = function (lista) { return lista.filter(function (r) { return !saker[x.typ][r.e.id]; }).length; };
    var b = n(x.bada), o = n(x.bara);
    if (!b && !o) return null;
    return typnamn(x.typ).toLowerCase() + ": " + [b ? b + " av " + x.bada.length + " som räknas som båda gångerna" : "",
      o ? o + " av " + x.bara.length + " som bara hade den " + forra : ""].filter(Boolean).join(" och ");
  }).filter(Boolean);
  return html + '<p class="notis">Skillnad i indexenheter mot orörda enheter, som i tabellen ovan. Kampanjen inför ' +
    forra + " kommer ur " + esc(kampanjKalla(forra)) + ", kampanjen inför " + nu + " ur " + esc(kampanjKalla(nu)) +
    " - antalet aktiviteter går därför inte att jämföra rakt av, men var partiet var gör det." +
    (osakra.length ? " Några enheter hade förra gången bara aktiviteter där platsen var preliminär eller där " +
      "kalendern frågar om de blev av - blev de inte av hör enheten till en annan kolumn. Det gäller " +
      osakra.join("; ") + "." : "") +
    (bara.length ? " Bara inför " + nu + ": " + bara.join(", ") + "." : "") + "</p>";
}

function ritaEffekt() {
  var e = kampanjeffekt();
  var ruta = $("effektinnehall");
  if (!D.kampanjer) { ruta.innerHTML = '<p class="hjalp">Datat innehåller inga kampanjaktiviteter.</p>'; return; }
  if (!e) { ruta.innerHTML = '<p class="hjalp">För få distrikt med siffror från båda valen.</p>'; return; }
  var html = '<div class="kort"><p class="hjalp">' +
    "Utfallet är hur <strong>" + esc(gruppnamn()) + "</strong>:s index mot kommunsnittet ändrades från " + e.ar.jmfar +
    " till " + e.ar.ar + " i " + D.valtyper[state.valtyp].toLowerCase() + ", jämfört med vad som var att vänta " +
    "utifrån var distriktet låg " + e.ar.jmfar + ". Distrikt som hade en aktivitet inför " + e.ar.ar + " jämförs med " +
    "orörda distrikt, som varken hade den eller låg granne med den" +
    (e.ar.tidigare.length ? " - och inte hade den inför " + e.ar.tidigare.join(" eller ") + " heller" : "") +
    ". Varje distrikt väger efter hur många röster det har. " +
    "Omritade distrikt jämförs i grupp, så att historiken är exakt. Siffran efter ± är hur stor skillnad " +
    "slumpen ensam ger mellan lika stora grupper i 95 fall av 100 - är skillnaden mindre än så går den inte " +
    "att skilja från brus. Kolumnen i röster räknar om skillnaden till röster i de distrikt som hade aktiviteten." +
    (state.ar !== e.ar.ar ? " Årsväljaren gäller inte här - kampanjen väljs överst i fliken." : "") +
    " " + e.rader.length + " jämförelseenheter (" +
    e.rader.reduce(function (t, r) { return t + r.e.koder.length; }, 0) + " distrikt) har siffror från båda valen." +
    "</p><p class=\"hjalp\">" + uteslutetText(e.ar.ar) + "</p><p class=\"hjalp\">" + forraText(e) + "</p></div>";

  html += '<div class="tabellyta"><table class="effekttabell"><thead><tr>' +
    '<th class="vanster">Typ av aktivitet</th><th>Aktiviteter</th>' +
    '<th>Enheter</th><th>Skillnad i distriktet</th><th>i röster</th><th class="vanster">Bedömning</th>' +
    '<th>Grannar</th><th>Skillnad runt om</th><th>i röster</th><th class="vanster">Bedömning</th>' +
    "</tr></thead><tbody>";
  e.typer.forEach(function (x) {
    var t = provningFor(e.provning, x.typ);
    var not = function (del) { return t ? provningsnot(x[del], t.bada[del], t.fore[del], e.provning) : ""; };
    html += "<tr" + (x.typ === "alla" ? ' class="summarad"' : "") + '><td class="vanster">' + typetikett(x.typ) + "</td>" +
      '<td class="tal">' + x.aktiviteter + '</td><td class="tal">' + x.direkt.length + "</td>" +
      effektCell(x.iDistriktet, e.ka, not("iDistriktet")) + '<td class="tal">' + x.grannar.length + "</td>" +
      effektCell(x.runtOm, e.ka, not("runtOm")) + "</tr>";
  });
  html += "</tbody></table></div>";
  var utan = aktiviteter(e.ar.ar).filter(function (a) { return !a.distrikt; }).length;
  var tester = 0;
  e.typer.forEach(function (x) {
    [x.iDistriktet, x.runtOm].forEach(function (j) { if (bedomning(j).klass !== "fa") tester++; });
  });
  html += '<p class="notis">Skillnaden är i indexenheter och viktad med antalet röster. Med ' + tester + " jämförelser i tabellen är det " +
    "väntat att någon enstaka blir \"tydlig\" av ren slump - lita mer på ett mönster som går igen än på en " +
    "ensam träff. " + (utan ? utan + " aktiviteter nådde hela kommunen " +
    "eller saknar plats och kan inte jämföras mellan distrikt. " : "") +
    "Typer som skedde på en plats (ram runt bokstaven) når också folk som bor på annat håll, så där är " +
    "distriktet bara en grov närhet.</p>";
  html += jamforelseKort(e);
  html += provningstabell(e);

  html += '<div class="kort"><h3>Varje distrikt som en prick</h3>' +
    '<p class="hjalp">Avvikelse från förväntad indexförändring. Enstaka fyllda prickar långt ut till höger ' +
    "är distrikt där det gick bättre än väntat - med eller utan kampanjens hjälp.</p>" + effektRemsor(e) + "</div>";

  /* Aktiviteterna i en enhet som rutor med antalet, typ för typ. */
  var rutor = function (lista) {
    var antal = {};
    lista.forEach(function (a) { antal[a.typ] = (antal[a.typ] || 0) + 1; });
    return kampanjtyper().filter(function (t) { return antal[t]; }).map(function (t) {
      return typruta(t, antal[t]);
    }).join(" ");
  };
  var forra = forraKampanj(e.ar);
  var traffade = e.rader.filter(function (r) { return kampanjerIEnhet(r.e, e.ar.ar).length; })
    .sort(function (a, b) { return b.avv - a.avv; });
  html += '<div class="kort"><h3>Distrikt med aktiviteter</h3><p class="hjalp">Sorterade efter avvikelsen. ' +
    "Grannarnas avvikelse visar om en förändring också syns runt omkring." +
    (forra ? " Aktiviteterna inför " + forra + " står bredvid, för jämförelse." : "") + "</p></div>" +
    '<div class="tabellyta"><table><thead><tr><th class="vanster">Distrikt</th><th class="vanster">Aktiviteter' +
    (forra ? " " + e.ar.ar + '</th><th class="vanster">' + forra : "") + "</th>" +
    "<th>Index " + e.ar.jmfar + "</th><th>Index " + e.ar.ar + "</th><th>Förändring</th><th>Förväntat</th>" +
    "<th>Avvikelse</th><th>Grannarnas avvikelse</th></tr></thead><tbody>";
  traffade.forEach(function (r) {
    html += '<tr><td class="vanster">' + esc(r.namn) + '</td><td class="vanster">' + rutor(kampanjerIEnhet(r.e, e.ar.ar)) + "</td>" +
      (forra ? '<td class="vanster">' + (rutor(kampanjerIEnhet(r.e, forra)) || "–") + "</td>" : "") +
      '<td class="tal">' + tal(r.fore, 0) + '</td><td class="tal">' + tal(r.efter, 0) + "</td>" +
      '<td class="tal">' + tecken(r.y, 1) + '</td><td class="tal">' + tecken(r.forvantat, 1) + "</td>" +
      '<td class="tal"><strong>' + tecken(r.avv, 1) + '</strong></td><td class="tal">' +
      (r.grannavv === null ? "–" : tecken(r.grannavv, 1)) + "</td></tr>";
  });
  html += "</tbody></table></div>";
  html += '<p class="notis">Det här är samvariation, inte bevis för orsak. Kampanjerna lades inte ut på måfå: ' +
    "valdes ett område för att partiet redan växte där, eller för att det var svagt, syns det som en effekt " +
    "som kampanjen inte orsakat. Justeringen för var distriktet låg " + e.ar.jmfar + " tar bara bort en del av det.</p>";
  ruta.innerHTML = html;
}

/* ---------- gränssnitt ---------- */

function byggPartival() {
  $("partier").innerHTML = D.partier.map(function (p) {
    return '<label class="parti" data-parti="' + p + '" title="' + esc(PARTINAMN[p]) + '">' +
      '<input type="checkbox" value="' + p + '"><span class="prick" style="background:' + PARTIFARG[p] + '"></span>' + p + "</label>";
  }).join("");
  $("narliggande").innerHTML = D.partier.map(function (p) {
    return '<label class="parti" data-parti="' + p + '" title="' + esc(PARTINAMN[p]) + '">' +
      '<input type="checkbox" value="' + p + '"><span class="prick" style="background:' + PARTIFARG[p] + '"></span>' + p + "</label>";
  }).join("");
  $("partier").addEventListener("change", function (e) {
    var p = e.target.value;
    if (e.target.checked) { if (state.partier.indexOf(p) < 0) state.partier.push(p); }
    else state.partier = state.partier.filter(function (x) { return x !== p; });
    uppdatera();
  });
  document.querySelectorAll("[data-snabb]").forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-snabb");
      state.partier = v === "alla" ? D.partier.slice() : (v ? v.split(",") : []);
      uppdatera();
    });
  });
}

function fyllVal() {
  $("valtyp").innerHTML = Object.keys(D.valtyper).map(function (v) {
    return '<option value="' + v + '">' + D.valtyper[v] + "</option>"; }).join("");
  $("ar").innerHTML = D.ar.map(function (a) { return '<option value="' + a + '">' + a + "</option>"; }).join("");
  $("jmfar").innerHTML = D.ar.map(function (a) { return '<option value="' + a + '">' + a + "</option>"; }).join("");
  var orter = [];
  D.distrikt.forEach(function (d) { if (orter.indexOf(d.ort) < 0) orter.push(d.ort); });
  orter.sort(function (a, b) { return a.localeCompare(b, "sv"); });
  $("utsnitt").innerHTML = '<option value="alla">Hela kommunen</option>' +
    ((D.meta.tatort || []).length ? '<option value="tatort">Lund tätort</option>' : "") +
    orter.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + "</option>"; }).join("");
  $("ortfilter").innerHTML = '<option value="">Alla områden</option>' +
    orter.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + "</option>"; }).join("");
  /* Kampanjen som fliken Kampanjeffekt räknar på - väljaren syns bara när det
     finns fler än en. */
  $("effektkampanj").innerHTML = kampanjAr().map(function (a) {
    return '<option value="' + a + '">' + a + "</option>"; }).join("");
  $("effektval").hidden = kampanjAr().length < 2;
}

function visaFlik(namn) {
  state.flik = namn;
  document.querySelectorAll(".flikar button").forEach(function (b) {
    b.setAttribute("aria-selected", b.getAttribute("data-flik") === namn ? "true" : "false");
  });
  ["karta", "roster", "tabell", "distrikt", "kampanj", "effekt"].forEach(function (v) {
    $("vy-" + v).hidden = v !== namn;
  });
  uppdatera();
}

function skrivMeta() {
  $("meta").textContent = "Underlag för eftervalsanalys och kampanjplanering · " +
    /* Äldre datafiler har bara "preliminärt"/"slutligt" här, nyare hela texten. */
    (/ 2026$/.test(D.meta.status2026) ? D.meta.status2026 : D.meta.status2026 + " räknat resultat 2026") +
    " · uppdaterad " + D.meta.byggd;
  $("kalla").textContent = "Källa: " + D.meta.kalla + ". Kartkoordinater i " + D.meta.koordinatsystem + ".";
  var u = D.uppsamlingsdistrikt[state.valtyp][state.ar], k = kommunPost(state.ar);
  var M = mandatregler();
  $("metod").innerHTML =
    "<p><b>Uppsamlingsdistriktet.</b> Förtidsröster som inte kunnat föras till rätt valdistrikt räknas i ett " +
    "uppsamlingsdistrikt. I " + D.valtyper[state.valtyp].toLowerCase() + " " + state.ar + " gäller det " +
    tal(u ? u.giltiga : 0) + " röster i Lund. De ingår i kommunens totaler men syns inte på kartan, " +
    "så ett enskilt distrikts andelar bygger bara på rösterna som placerats där. De som lade rösterna räknas inte " +
    "heller som röstande i sitt eget distrikt, så Valmyndighetens valdeltagande per distrikt blir för lågt - i snitt " +
    (u && k && k.rostberattigade ? tal(100 * u.rostande / k.rostberattigade, 1) + " procentenheter" : "några procentenheter") +
    " - och antalet som inte röstade för stort. Här fördelas uppsamlingsdistriktets röstande därför ut på distrikten " +
    "i proportion till hur många som röstade i varje distrikt. Valdeltagande och <i>Röstade ej</i> går då ihop med " +
    "kommunens siffror, men blir något högre respektive lägre än Valmyndighetens siffror per distrikt.</p>" +
    "<p><b>Jämförelser bakåt.</b> 2026 ritades 24 av Lunds 84 valdistrikt om. Där Valmyndigheten säger att " +
    "distriktet kan jämföras används de officiella siffrorna rakt av. För övriga uppskattas historiken genom " +
    "att det nya distriktets yta samplas mot den gamla kartan (rutnät om " + tal(D.meta.rutnat_m) + " m) och de " +
    "gamla rösterna fördelas efter hur ytorna överlappar. Sådana värden är streckade på kartan och i tabellen " +
    "och kan stängas av med kryssrutan <i>Visa uppskattade värden</i>. Metoden antar att befolkningen är jämnt " +
    "fördelad inom det gamla distriktet, vilket slår fel där det byggts nytt - och det är just där distrikten " +
    "ritades om.</p>" +
    "<p><b>Förändring räknas i jämförelsegrupper.</b> Därför används inte de uppskattade värdena när något jämförs " +
    "över tid. Omritningarna flyttade oftast bara gränsen mellan några grannar; tillsammans täcker de samma yta " +
    "som några gamla distrikt, och då är gruppens historik exakt - summan av de gamla distrikten. Förändring i " +
    "röster, procentenheter och index, topplistorna och kampanjeffekten räknas därför för sådana grupper, och " +
    "gruppen ritas som en yta på kartan. Distrikt och grupper plus uppsamlingsdistriktet summerar exakt till " +
    "kommunens förändring.</p>" +
    "<p><b>Röster.</b> Mandaten fördelas efter antalet röster, och fliken <i>Röster och mandat</i> delar upp " +
    "förändringen: hur mycket som beror på fler eller färre röstberättigade, på valdeltagandet (giltiga röster per " +
    "röstberättigad) och på andelen av de giltiga rösterna. Varje del är ett medelvärde över alla ordningar som de " +
    "tre faktorerna kan ändras i (Shapley-uppdelning), så att delarna blir exakt hela förändringen. " +
    "<i>Kommunval minus riksdagsval</i> " +
    "är partigruppens röster i kommunvalet minus röster i riksdagsvalet samma år; kommunvalet har fler " +
    "röstberättigade, så ett litet plus är väntat även utan att någon röstat olika.</p>" +
    (M ? "<p><b>Mandat i kommunfullmäktige.</b> De " + M.antal + " mandaten räknas fram ur kommunvalets röster i hela " +
    "kommunen med jämkade uddatalsmetoden (första divisorn " + tal(M.forsta_divisor, 1) + "), bland partier med minst " +
    tal(100 * M.sparr) + " % av rösterna - Lund är inte indelat i valkretsar. Det ger exakt Valmyndighetens " +
    "fördelning 2018 och 2022. <i>Ett mandat till</i> är det minsta antal fler röster som hade gett partiet ett " +
    "mandat till, med alla andra partiers röster som de blev; <i>marginalen</i> är hur många färre röster partiet " +
    "hade klarat sig med innan det förlorat ett. För en grupp partier räknas det billigaste mandatet, och egen " +
    "majoritet mandat för mandat. Lika jämförelsetal avgörs i verkligheten genom lottning; här räknas lotten som " +
    "förlorad, så att marginalerna aldrig blir för små.</p>" : "") +
    "<p><b>Kampanjprioritering.</b> Röster inom räckhåll är de som inte röstade gånger partigruppens andel bland " +
    "dem som röstade, gånger den del som går att mobilisera, plus rösterna på närliggande partier gånger den del " +
    "som går att övertyga. Båda delarna är antaganden som ställs med reglagen. De som inte röstade räknas med " +
    "uppsamlingsdistriktets röstande utfördelade, se ovan. Rangordnat per km² kommer de distrikt först där " +
    "rösterna bor tätt, vilket är det som spelar roll för dörrknackning. Med indexgränsen rangordnas bara " +
    "distrikt där partigruppen ligger över en vald nivå jämfört med kommunen. <i>Summa hittills</i> lägger ihop " +
    "rösterna inom räckhåll uppifrån i listan, och med kommunvalet valt markeras raden där de räcker till nästa " +
    "mandat i fullmäktige.</p>" +
    "<p><b>Zoom.</b> Kartan går att zooma med mushjulet, knapparna uppe till höger eller två fingrar, " +
    "och att dra med musen; distrikts- och lokalnamn dyker upp när det finns plats för dem.</p>" +
    "<p><b>Färgerna på kartan.</b> Stegen är lagda så att ungefär lika många distrikt hamnar i " +
    "varje färg, inte så att stegen blir lika breda i värde - annars räcker ett enda avvikande " +
    "distrikt för att trycka ihop alla andra i ett par nyanser. Brytpunkterna står därför utskrivna " +
    "under färgskalan. Förändring och index färgläggs med en skala som är symmetrisk kring mitten " +
    "(0 respektive 100), så att ett plus och ett lika stort minus syns lika tydligt; stegets storlek " +
    "sätts av de 90 procent minsta avvikelserna och ytterfärgerna fångar det som ligger utanför. " +
    "Distrikt utan uppgift är prickade, inte grå: en blek grå yta går inte att skilja från mitten på " +
    "förändringsskalan.</p>" +
    "<p><b>Mått.</b> Andel räknas på giltiga röster i distriktet. Index är distriktets andel delad med " +
    "kommunens, gånger 100 - så 130 betyder 30 procent starkare än Lund i stort. Förändring anges i " +
    "procentenheter. Förändring i index är skillnaden mellan distriktets index i de två valen: den räknar " +
    "bort det som hände i hela kommunen, så +5 betyder att distriktet drog ifrån Lund i stort med 5 " +
    "indexenheter, oavsett om partiet gick upp eller ned totalt. Förändring i antal röster är just det - " +
    "skillnaden i röster på partigruppen. Täthet är röstberättigade per " +
    "kvadratkilometer och är ett grovt mått på hur tätt bebyggt distriktet är.</p>" +
    "<p><b>Partier.</b> FörNyaLund ställer bara upp i kommunvalet och redovisas där för sig, i partitabellerna " +
    "och i mandatfördelningen, i stället för under <i>Övriga partier</i> - 2018 fick partiet 8,6 % av rösterna, " +
    "lika mycket som V och mer än C. Det går inte att välja i partigruppen, eftersom det saknas i de andra valen.</p>" +
    (D.kampanjer ? metodKampanj() : "");
}

/* Metodtextens stycke om kampanjerna - vilka som finns och var de kommer ifrån. */
function metodKampanj() {
  var ar = kampanjAr(), nu = ar[0], forra = ar[1];
  var aldst = ar[ar.length - 1], innan = D.ar[D.ar.indexOf(aldst) + 1];
  return "<p><b>Kampanjaktiviteter.</b> Lagret visar var och när partiet kampanjade inför valet som kartan visar - " +
    "kampanjer, valsedelsutdelning, debatter och besök, inget om hur det gick. " +
    ar.map(function (a) { return "Kampanjen inför " + a + " kommer ur " + esc(kampanjKalla(a)) + "."; }).join(" ") +
    " Aktiviteter som riktade sig till de boende i ett område (dörrknackning, brevlådor, valsedlar på valdagen) " +
    "ritas mitt i varje distrikt de gällde; övriga ritas där de ägde rum." +
    (forra ? " Valsedlarna " + forra + " delades ut per valdistrikt " + forra + " och ritas i distrikten som i dag " +
      "täcker samma område. Aktiviteter som kalendern frågar om de blev av, eller där platsen var preliminär, är med " +
      "och märkta; inställda är inte med." : "") +
    " Platserna är tolkade ur fritext och ibland ungefärliga - rutan vid märket säger när. Fliken " +
    "<i>Kampanjeffekt</i> jämför indexförändringen i distrikt med och utan aktiviteter, justerad för var distriktet " +
    "låg förra valet och viktad efter antalet röster, prövar skillnaden mot vad slumpen ger och räknar om den till " +
    "röster" + (forra ? ", för en kampanj i taget. Distrikt som hade samma typ av aktivitet i förra valets kampanj " +
      "räknas inte som orörda, och de två kampanjerna jämförs: gick mönstret igen, och hur ser " + nu + " ut uppdelat " +
      "efter var partiet var " + forra + "?" : ".") + " " +
    (D.ar[2] ? "Skillnaden prövas också mot valen innan: med det väntade utfallet ur både " + D.ar[2] + " och " +
      D.ar[1] + ", och på förändringen " + D.ar[2] + "–" + D.ar[1] + ", innan kampanjen inför " + nu + " - syns den " +
      "redan där är den inte den kampanjens verk. " : "") +
    "Kampanjer vid stationerna, evenemang som inte var lokala och offentliga kampanjer i stadskärnans " +
    "Centrum-distrikt är inte med: de når folk från hela kommunen. " +
    (innan ? "Var partiet kampanjade inför " + innan + " finns inte i datat, så den kampanjen ligger kvar i " +
      "utgångsläget för " + aldst + ". " : "") + "Fliken visar samvariation, inte orsak.</p>";
}

function uppdatera() {
  document.querySelectorAll("#partier .parti").forEach(function (el) {
    var p = el.getAttribute("data-parti");
    var vald = state.partier.indexOf(p) >= 0;
    el.querySelector("input").checked = vald;
    el.setAttribute("data-vald", vald ? "ja" : "nej");
  });
  $("valtyp").value = state.valtyp;
  $("ar").value = state.ar;
  $("jmfar").value = state.jmfar;
  $("matt").value = state.matt;
  $("utsnitt").value = state.utsnitt;
  $("lagerBefolkning").checked = state.lager.befolkning;
  $("lagerTathet").checked = state.lager.tathet;
  $("lagerCentrum").checked = state.lager.centrum;
  $("lagerVallokaler").checked = state.lager.vallokaler;
  $("lagerOrter").checked = state.lager.orter;
  $("lagerKampanjer").checked = state.lager.kampanjer;
  $("lagerKampanjer").disabled = !D.kampanjer;
  $("visaUppskattade").checked = state.visaUppskattade;
  $("indexFilter").checked = state.indexFilter;
  $("indexGrans").value = state.indexGrans;
  $("indexVarde").textContent = state.indexGrans;
  $("tathetGrans").value = state.tathetGrans;
  $("tathetVarde").textContent = tal(state.tathetGrans);
  $("sok").value = state.sok;
  $("ortfilter").value = state.ort;
  if (D.kampanjer) $("effektkampanj").value = effektAr().ar;
  $("tema").textContent = "Tema: " + state.tema;

  ritaSammanfattning();
  skrivMeta();
  if (state.flik === "karta") { ritaKarta(); ritaTopplistor(); }
  if (state.flik === "roster") ritaRoster();
  if (state.flik === "tabell") ritaTabell();
  if (state.flik === "distrikt") ritaDistrikt();
  if (state.flik === "kampanj") ritaKampanj();
  if (state.flik === "effekt") ritaEffekt();
  spara();
}

function koppla() {
  $("valtyp").addEventListener("change", function () { state.valtyp = this.value; uppdatera(); });
  $("ar").addEventListener("change", function () {
    state.ar = this.value;
    if (state.jmfar === state.ar) state.jmfar = D.ar.filter(function (a) { return a !== state.ar; })[0];
    uppdatera();
  });
  $("jmfar").addEventListener("change", function () { state.jmfar = this.value; uppdatera(); });
  $("matt").addEventListener("change", function () { state.matt = this.value; uppdatera(); });
  $("utsnitt").addEventListener("change", function () {
    state.utsnitt = this.value;
    kartvy = null;
    uppdatera();
  });
  [["lagerBefolkning", "befolkning"], ["lagerTathet", "tathet"], ["lagerCentrum", "centrum"],
   ["lagerVallokaler", "vallokaler"], ["lagerOrter", "orter"], ["lagerKampanjer", "kampanjer"]].forEach(function (par) {
    $(par[0]).addEventListener("change", function () { state.lager[par[1]] = this.checked; uppdatera(); });
  });
  $("tathetGrans").addEventListener("input", function () {
    state.tathetGrans = +this.value;
    $("tathetVarde").textContent = tal(state.tathetGrans);
    if (state.lager.tathet) ritaKarta();
    spara();
  });
  $("visaUppskattade").addEventListener("change", function () { state.visaUppskattade = this.checked; uppdatera(); });
  $("indexFilter").addEventListener("change", function () { state.indexFilter = this.checked; uppdatera(); });
  $("indexGrans").addEventListener("input", function () {
    state.indexGrans = +this.value;
    if (!state.indexFilter) { state.indexFilter = true; $("indexFilter").checked = true; }
    uppdatera();
  });
  document.querySelectorAll(".flikar button").forEach(function (b) {
    b.addEventListener("click", function () { visaFlik(b.getAttribute("data-flik")); });
  });
  $("tabell").addEventListener("click", function (e) {
    var th = e.target.closest ? e.target.closest("th[data-kol]") : null;
    if (!th) return;
    var kol = th.getAttribute("data-kol");
    if (state.sortKol === kol) state.sortRiktning = -state.sortRiktning;
    else { state.sortKol = kol; state.sortRiktning = kol === "namn" || kol === "ort" ? 1 : -1; }
    ritaTabell();
    spara();
  });
  $("sok").addEventListener("input", function () { state.sok = this.value; ritaTabell(); spara(); });
  $("ortfilter").addEventListener("change", function () { state.ort = this.value; ritaTabell(); spara(); });
  $("exportera").addEventListener("click", exporteraCSV);
  $("distriktval").addEventListener("change", function () { state.distrikt = this.value; ritaDistrikt(); spara(); });
  $("effektkampanj").addEventListener("change", function () { state.effektKampanj = this.value; uppdatera(); });
  $("mobil").addEventListener("input", function () { state.mobilisering = +this.value; ritaKampanj(); spara(); });
  $("overtyga").addEventListener("input", function () { state.overtalning = +this.value; ritaKampanj(); spara(); });
  $("rangordning").addEventListener("change", function () { state.rangordning = this.value; ritaKampanj(); spara(); });
  $("narliggande").addEventListener("change", function (e) {
    var p = e.target.value;
    if (e.target.checked) { if (state.narliggande.indexOf(p) < 0) state.narliggande.push(p); }
    else state.narliggande = state.narliggande.filter(function (x) { return x !== p; });
    ritaKampanj();
    spara();
  });
  var bidragstips = null;
  $("rosterinnehall").addEventListener("mousemove", function (e) {
    var rad = e.target.closest ? e.target.closest(".bidragsrad") : null;
    if (!bidragstips) {
      bidragstips = document.createElement("div");
      bidragstips.className = "bidragstips";
      bidragstips.hidden = true;
      document.body.appendChild(bidragstips);
    }
    if (!rad) { bidragstips.hidden = true; return; }
    bidragstips.innerHTML = bidragsTips(+rad.getAttribute("data-i"));
    bidragstips.hidden = false;
    var x = e.clientX + 14, y = e.clientY + 14;
    if (x + bidragstips.offsetWidth > window.innerWidth - 4) x = e.clientX - bidragstips.offsetWidth - 14;
    if (y + bidragstips.offsetHeight > window.innerHeight - 4) y = e.clientY - bidragstips.offsetHeight - 14;
    bidragstips.style.left = Math.max(4, x) + "px";
    bidragstips.style.top = Math.max(4, y) + "px";
  });
  $("rosterinnehall").addEventListener("mouseleave", function () { if (bidragstips) bidragstips.hidden = true; });
  $("tema").addEventListener("click", function () {
    state.tema = state.tema === "auto" ? "light" : state.tema === "light" ? "dark" : "auto";
    satTema();
    uppdatera();
  });
  /* Escape lossar den fastnålade rutan - den täcker en bit av kartan. */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && tipsFast) lossaTips();
  });
  kopplaKarta();
  kopplaZoom();
}

function satTema() {
  if (state.tema === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", state.tema);
}

function starta() {
  D = window.VALDATA;
  if (!state.ar || D.ar.indexOf(state.ar) < 0) state.ar = D.ar[0];
  if (!state.jmfar || D.ar.indexOf(state.jmfar) < 0 || state.jmfar === state.ar) {
    state.jmfar = D.ar[state.ar === D.ar[0] ? 1 : 0];
  }
  byggPartival();
  fyllVal();
  koppla();
  satTema();
  visaFlik(state.flik);
}

window.startaValsidan = starta;
if (D) starta();
})();
