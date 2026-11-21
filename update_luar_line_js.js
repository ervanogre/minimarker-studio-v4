const fs = require('fs');
let code = fs.readFileSync('www/app.js', 'utf8');

// 1. Hapus removeItem agar warna pilihan user tersimpan permanen
code = code.replace("localStorage.removeItem('mm_proc_colors');\n", "");

// 2. Perbarui renderDynamicProcessColors() agar merender daftar vertikal rapi di dalam menu "LUAR LINE"
const luarLineRenderFn = `function renderDynamicProcessColors() {
  const box = document.getElementById('dynamicProcessColorsBox');
  const listEl = document.getElementById('dynamicProcessColors');
  if (!box || !listEl) return;

  // Pecah setiap label berdasarkan tanda '-' (misal "AUTOMATION-OCM" -> ["AUTOMATION", "OCM"])
  const procSet = new Set();
  parsedPieces.forEach(p => {
    const raw = (p.processLabel || '').trim().toUpperCase();
    if (!raw) return;
    raw.split('-').map(s => s.trim()).filter(Boolean).forEach(part => procSet.add(part));
  });

  const activeProcs = [...procSet];
  if (activeProcs.length === 0) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  listEl.innerHTML = activeProcs.map((proc, i) => {
    const col = getProcessColor(proc);
    return \`
      <div style="display:flex; align-items:center; justify-content:space-between; background:#0f172a; padding:8px 12px; border-radius:8px; border:1px solid #1e293b;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:11px; color:var(--muted);">\${i + 1}.</span>
          <span style="font-size:13px; font-weight:900; color:\${col}; letter-spacing:0.4px;">\${proc}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:10px; color:var(--muted);">Warna:</span>
          <input type="color" value="\${col}" onchange="updateProcessColorValue('\${proc}', this.value)"
            style="width:38px; height:28px; border:1px solid #334155; border-radius:6px; background:none; padding:0; cursor:pointer;" />
        </div>
      </div>
    \`;
  }).join('');
}`;

code = code.replace(/function renderDynamicProcessColors\(\) \{[\s\S]*?\}\)\.join\(''\);\n\}/, luarLineRenderFn);

fs.writeFileSync('www/app.js', code);
console.log("Logika menu 'LUAR LINE' berhasil diperbarui!");
