# 1. Tambahkan tombol - / + untuk titleFontSize, labelFontSize, dan processFontSize di index.html
p_html = "/data/data/com.termux/files/home/mini-marker-app/www/index.html"
t_html = open(p_html).read()

replacements_html = [
  (
    '<input type="number" id="titleFontSize" value="38" min="18" max="72" />',
    '<div style="display:flex; gap:4px; align-items:center;"><button type="button" onclick="stepFontVal(\'titleFontSize\', -2)" style="padding:6px 10px; background:#07060e; color:var(--neon-cyan); border:1px solid var(--neon-cyan); border-radius:6px; font-weight:900;">-</button><input type="number" id="titleFontSize" value="38" min="18" max="72" style="text-align:center;" /><button type="button" onclick="stepFontVal(\'titleFontSize\', 2)" style="padding:6px 10px; background:#07060e; color:var(--neon-cyan); border:1px solid var(--neon-cyan); border-radius:6px; font-weight:900;">+</button></div>'
  ),
  (
    '<input type="number" id="labelFontSize" value="14" min="8" max="36" />',
    '<div style="display:flex; gap:4px; align-items:center;"><button type="button" onclick="stepFontVal(\'labelFontSize\', -1)" style="padding:6px 10px; background:#07060e; color:var(--neon-yellow); border:1px solid var(--neon-yellow); border-radius:6px; font-weight:900;">-</button><input type="number" id="labelFontSize" value="14" min="8" max="36" style="text-align:center;" /><button type="button" onclick="stepFontVal(\'labelFontSize\', 1)" style="padding:6px 10px; background:#07060e; color:var(--neon-yellow); border:1px solid var(--neon-yellow); border-radius:6px; font-weight:900;">+</button></div>'
  ),
  (
    '<input type="number" id="processFontSize" value="13" min="8" max="36" />',
    '<div style="display:flex; gap:4px; align-items:center;"><button type="button" onclick="stepFontVal(\'processFontSize\', -1)" style="padding:6px 10px; background:#07060e; color:var(--neon-pink); border:1px solid var(--neon-pink); border-radius:6px; font-weight:900;">-</button><input type="number" id="processFontSize" value="13" min="8" max="36" style="text-align:center;" /><button type="button" onclick="stepFontVal(\'processFontSize\', 1)" style="padding:6px 10px; background:#07060e; color:var(--neon-pink); border:1px solid var(--neon-pink); border-radius:6px; font-weight:900;">+</button></div>'
  ),
  (
    '<div class="card-title" style="margin-bottom:8px;">🎛️ Pengaturan Font &amp; Grid A4</div>',
    '<div id="fontGridCard" class="card-title" style="margin-bottom:8px;">🎛️ Pengaturan Font &amp; Grid A4</div>'
  )
]

for old_s, new_s in replacements_html:
  assert old_s in t_html, f"Tidak ditemukan di index.html: {old_s}"
  t_html = t_html.replace(old_s, new_s)

open(p_html, "w").write(t_html)

# 2. Perbaiki posisi teks vs lingkaran nomor & tambahkan stepFontVal() di app.js
p_app = "/data/data/com.termux/files/home/mini-marker-app/www/app.js"
t_app = open(p_app).read()

old_text_pos = """      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + labelSize + 'px ' + fontFam;
      const nameMaxW = Math.max(cellW - 14, 42);
      const nameLines = wrapCanvasLines(ctx, piece.name, nameMaxW).slice(0, 2);
      const lineStep = Math.round(labelSize * 1.15);
      const baseTextY = finalY + finalH + labelSize + 4;"""

new_text_pos = """      // Jaga agar teks nama & ukuran selalu di bawah lingkaran nomor & tidak menabrak numCx
      const circleBottom = numCy + circleR;
      const circleRight = numCx + circleR;
      const rawBaseY = finalY + finalH + labelSize + 4;
      const baseTextY = Math.max(rawBaseY, circleBottom + labelSize + 3);
      const safeLeftX = (baseTextY - labelSize < circleBottom + 4) ? (circleRight + 6) : (cx + 6);
      const safeRightX = cx + cellW - 6;
      const safeCenterX = Math.max(safeLeftX + 20, (safeLeftX + safeRightX) / 2);
      const nameMaxW = Math.max(safeRightX - safeLeftX, 38);

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + labelSize + 'px ' + fontFam;
      const nameLines = wrapCanvasLines(ctx, piece.name, nameMaxW).slice(0, 2);
      const lineStep = Math.round(labelSize * 1.15);"""

assert old_text_pos in t_app, "old_text_pos tidak ditemukan di app.js"
t_app = t_app.replace(old_text_pos, new_text_pos)

t_app = t_app.replace("nameLines.forEach((ln, lIdx) => ctx.fillText(ln, centerDrawX, baseTextY + (lIdx * lineStep)));", "nameLines.forEach((ln, lIdx) => ctx.fillText(ln, safeCenterX, baseTextY + (lIdx * lineStep)));")
t_app = t_app.replace("ctx.fillText(piece.sizeText, centerDrawX, baseTextY + (nameLines.length * lineStep));", "ctx.fillText(piece.sizeText, safeCenterX, baseTextY + (nameLines.length * lineStep));")
t_app = t_app.replace("let curTextX = centerDrawX - (totalTextW / 2);", "let curTextX = Math.max(numCx + circleR + 6, centerDrawX - (totalTextW / 2));")
t_app = t_app.replace("if (el.id !== 'resultArea') el.classList.add('hidden');", "if (el.id !== 'resultArea' && !el.querySelector('#fontGridCard')) el.classList.add('hidden');")

step_fn = """
function stepFontVal(id, delta) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const minV = parseInt(inp.min) || 8;
  const maxV = parseInt(inp.max) || 72;
  const curV = parseInt(inp.value) || 14;
  inp.value = Math.min(maxV, Math.max(minV, curV + delta));
  if (typeof renderPreviewSilent === "function") renderPreviewSilent();
  else if (typeof generateMiniMarker === "function") generateMiniMarker();
}
"""

open(p_app, "w").write(t_app + "\n" + step_fn)
print("Tombol -/+ ukuran font & perlindungan tumpang-tindih lingkaran nomor berhasil dipasang!")
