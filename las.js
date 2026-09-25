/* Lösenordslås för den statiska sidan.

   Datafilen är krypterad med AES-256-CTR och en nyckel som räknas fram ur
   lösenordet med PBKDF2 (samma steg som etl/build.py gör åt andra hållet).
   Lösenordet finns alltså aldrig i koden eller i repot - bara hos den som
   skrev det, och hos den som ska få se sidan. */
(function () {
"use strict";

var LAGRING = "valsidan-lund-losen";
var $ = function (id) { return document.getElementById(id); };

/* Allt sidan sparar ligger under samma förled, så att "rensa allt" kan tömma
   det utan att röra annat som samma adress kan ha sparat. */
function glomAllt() {
  try {
    var nycklar = [];
    for (var i = 0; i < localStorage.length; i++) {
      var n = localStorage.key(i);
      if (n && n.indexOf("valsidan-") === 0) nycklar.push(n);
    }
    nycklar.forEach(function (n) { localStorage.removeItem(n); });
  } catch (e) { /* privat läge - då fanns det inget sparat heller */ }
}

/* Knappen finns även i ett olåst bygge, där den bara rensar inställningarna:
   därför kopplas den innan den tidiga returen nedan. */
var rensa = $("rensaknapp");
if (rensa) rensa.addEventListener("click", function () {
  if (!window.confirm("Ta bort lösenordet och alla sparade inställningar ur den här " +
      "webbläsaren och låsa sidan igen?")) return;
  glomAllt();
  location.reload();
});

if (window.VALDATA) return;                 // olåst bygge, inget mer att göra här

function visa(meddelande) {
  $("lasfel").textContent = meddelande || "";
}

function fran64(s) {
  var bin = atob(s), buf = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

function slaIhop() {
  var delar = Array.prototype.slice.call(arguments);
  var total = delar.reduce(function (n, d) { return n + d.length; }, 0);
  var ut = new Uint8Array(total), pos = 0;
  delar.forEach(function (d) { ut.set(d, pos); pos += d.length; });
  return ut;
}

function lasUpp(losenord) {
  var paket = window.VALDATA_ENC;
  var salt = fran64(paket.salt), raknare = fran64(paket.raknare);
  var chiffer = fran64(paket.data), mac = fran64(paket.mac);
  var subtle = window.crypto.subtle;
  return subtle.importKey("raw", new TextEncoder().encode(losenord), "PBKDF2", false, ["deriveBits"])
    .then(function (bas) {
      return subtle.deriveBits({ name: "PBKDF2", salt: salt, iterations: paket.iterationer,
        hash: "SHA-256" }, bas, 512);
    })
    .then(function (bitar) {
      var nycklar = new Uint8Array(bitar);
      return subtle.importKey("raw", nycklar.slice(32), { name: "HMAC", hash: "SHA-256" },
        false, ["verify"]).then(function (macNyckel) {
        return subtle.verify("HMAC", macNyckel, mac, slaIhop(salt, raknare, chiffer))
          .then(function (ok) {
            if (!ok) throw new Error("fel lösenord");
            return subtle.importKey("raw", nycklar.slice(0, 32), "AES-CTR", false, ["decrypt"]);
          });
      });
    })
    .then(function (nyckel) {
      return window.crypto.subtle.decrypt({ name: "AES-CTR", counter: raknare, length: 64 },
        nyckel, chiffer);
    })
    .then(function (klartext) {
      return JSON.parse(new TextDecoder().decode(klartext));
    });
}

function starta(data, losenord) {
  window.VALDATA = data;
  try { localStorage.setItem(LAGRING, losenord); } catch (e) { /* privat läge */ }
  document.body.classList.remove("last");
  $("lasruta").hidden = true;
  $("lasknapp").hidden = false;
  window.startaValsidan();
}

function prova(losenord, tyst) {
  return lasUpp(losenord).then(function (data) {
    return data;
  }, function () {
    if (!tyst) visa("Fel lösenord.");
    try { localStorage.removeItem(LAGRING); } catch (e) { /* strunt samma */ }
    return null;
  }).then(function (data) {
    if (!data) return false;
    /* Egen then-länk: ett fel i starta() ska bli ett synligt meddelande och
       inte en tyst avvisning som lämnar "Låser upp ..." kvar på skärmen. */
    starta(data, losenord);
    return true;
  }, function (e) {
    /* starta() hinner visa sidan innan den faller - ta fram låsrutan igen så
       att meddelandet syns. */
    document.body.classList.add("last");
    $("lasruta").hidden = false;
    visa("Sidan gick inte att starta: " + (e && e.message ? e.message : e));
    return false;
  });
}

document.body.classList.add("last");
$("lasruta").hidden = false;

if (!window.VALDATA_ENC) {
  visa("Hittar ingen data. Kör python3 etl/build.py och lägg upp mappen data/ igen.");
  $("lasform").hidden = true;
} else if (!window.crypto || !window.crypto.subtle) {
  visa("Webbläsaren låser bara upp sidan över https (eller när filen öppnas direkt " +
    "från datorn). Öppna sidan via https så fungerar lösenordet.");
  $("lasform").hidden = true;
} else {
  $("lasform").addEventListener("submit", function (e) {
    e.preventDefault();
    visa("Låser upp …");
    prova($("lasenord").value, false);
  });
  $("lasknapp").addEventListener("click", function () {
    /* Bara lösenordet glöms - inställningarna får ligga kvar. */
    try { localStorage.removeItem(LAGRING); } catch (e) { /* strunt samma */ }
    location.reload();
  });
  var sparat = null;
  try { sparat = localStorage.getItem(LAGRING); } catch (e) { /* strunt samma */ }
  if (sparat) {
    visa("Låser upp …");
    prova(sparat, true).then(function (ok) {
      if (!ok) { visa(""); $("lasenord").focus(); }
    });
  } else {
    $("lasenord").focus();
  }
}
})();
