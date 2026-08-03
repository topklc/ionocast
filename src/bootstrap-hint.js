// Tiny non-module shim. Regular scripts load under file:// where ES modules
// don't, so this is the only code that runs when the user opens index.html
// directly. Surfaces a visible explanation instead of a blank page.
if (location.protocol === "file:") {
  var hint = document.getElementById("bootstrap-hint");
  if (hint) {
    hint.hidden = false;
    try {
      var saved = localStorage.getItem("ionocast_lang");
      var lang = saved || ((navigator.language || "").slice(0, 2).toLowerCase());
      if (lang === "tr") {
        hint.innerHTML = "Bu sayfa bir <code>file://</code> URL'sinden yüklendi, bu nedenle bağlı olduğu ES modülleri tarayıcı tarafından engelleniyor. Bunun yerine HTTP üzerinden sunun: <code>npx wrangler@4 pages dev .</code> &nbsp;veya&nbsp; <code>python3 -m http.server</code>, ardından <code>http://localhost:8000/</code> adresini açın.";
      }
    } catch (_) {}
  }
}
