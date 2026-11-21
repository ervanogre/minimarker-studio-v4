let parsedPieces = [];
let excelColorways = {};
let currentStyleName = "JS0A47JK";
let currentColorwayName = "BUBBLE GUM A5Y";
let generatedCanvases = [];

function switchTab(tab) {
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('panelUpload').classList.toggle('hidden', tab !== 'upload');
  document.getElementById('panelManual').classList.toggle('hidden', tab !== 'manual');
  if (tab === 'manual') { renderPieceMappingList(); renderDynamicProcessColors(); }
}

function handleDxfUpload(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  currentStyleName = file.name.replace(/\.dxf$/i, '').replace(/\.trashed-\d+-/i, '').replace(/\s*\(\d+\)$/, '').toUpperCase();
  const styleInput = document.getElementById('styleNoInput');
  if (styleInput && !styleInput.value) styleInput.value = currentStyleName;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const ParserClass = window.DxfParser || (window.dxfParser && window.dxfParser.default) || DxfParser;
      const parser = new ParserClass();
      const dxf = parser.parseSync(e.target.result);
      parsedPieces = extractPiecesFromDxf(dxf);
      document.getElementById('dxfZone').classList.add('loaded');
      document.getElementById('dxfStatus').innerHTML = `✅ <strong>${file.name}</strong> (${parsedPieces.length} komponen unik)`;
      if (Object.keys(excelColorways).length > 0) applyColorwayMapping();
      renderPieceMappingList();
    } catch (err) {
      alert("Gagal membaca file DXF: " + err.message);
    }
  };
  reader.readAsText(file);
}


function detectProcessFromText(text) {
  const up = text.toUpperCase();
  if (/AUTOMATION\s*-?\s*OCM|OCM/.test(up)) return 'AUTOMATION - OCM';
  if (/AUTOMATION|AUTO\b/.test(up)) return 'AUTOMATION';
  if (/BORDIR|EMBROIDERY|EMB\b/.test(up)) return 'BORDIR';
  if (/HEAT\s*EMBOSS|EMBOSS/.test(up)) return 'HEAT EMBOSSED';
  if (/SILKSCREEN|SCREEN\s*PRINT/.test(up)) return 'SILKSCREEN';
  return '';
}

function isMirroredPoly(polysA, polysB, wA, wB) {
  if (!polysA.at(0) || !polysB.at(0)) return false;
  const ptsA = polysA.at(0).pts;
  const ptsB = polysB.at(0).pts;
  if (ptsA.length !== ptsB.length || ptsA.length < 4) return false;
  // Cek apakah titik-titik B merupakan pencerminan horizontal (w - x) dari A
  let mirrorMatches = 0;
  ptsA.forEach(pa => {
    const found = ptsB.some(pb => Math.abs((wA - pa.x) - pb.x) < 4 && Math.abs(pa.y - pb.y) < 4);
    if (found) mirrorMatches++;
  });
  return (mirrorMatches / ptsA.length) >= 0.75;
}

function extractPiecesFromDxf(dxf) {
  const rawPieces = [];
  if (dxf.blocks && Object.keys(dxf.blocks).length > 0) {
    for (const [blockName, block] of Object.entries(dxf.blocks)) {
      if (blockName.startsWith('*')) continue;
      const allPolys = [];
      let labelTexts = [blockName];
      (block.entities || []).forEach(ent => {
        if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && ent.vertices.length > 1) {
          allPolys.push({ pts: ent.vertices.map(v => ({ x: v.x, y: v.y })) });
        } else if (ent.type === 'LINE' && ent.vertices && ent.vertices.length === 2) {
          allPolys.push({ pts: ent.vertices.map(v => ({ x: v.x, y: v.y })), isInternal: true });
        } else if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
          if (ent.text) labelTexts.push(ent.text.replace(/\\P/g, ' ').trim());
        }
      });
      if (allPolys.length > 0) {
        const bounds = getBounds(allPolys.map(p => p.pts));
        if (bounds.width < 5 && bounds.height < 5) continue;
        let maxDiag = 0, outerIdx = 0;
        allPolys.forEach((p, idx) => {
          const b = getBounds([p.pts]);
          const diag = Math.hypot(b.width, b.height);
          if (diag > maxDiag) { maxDiag = diag; outerIdx = idx; }
        });
        const normPolys = allPolys.map((p, idx) => ({
          pts: p.pts.map(pt => ({ x: pt.x - bounds.minX, y: bounds.maxY - pt.y })),
          isOuter: idx === outerIdx
        }));
        const fullText = labelTexts.join(' | ');
        const code = extractComponentCode(fullText);
        rawPieces.push({
          code,
          name: cleanDisplayName(fullText, code),
          sizeText: `${(bounds.height / 10).toFixed(1)}*${(bounds.width / 10).toFixed(1)}`,
          rawText: fullText,
          polygons: normPolys,
          width: bounds.width,
          height: bounds.height,
          fabric: 'MA',
          qtyLabel: /\b(A\/B|L\/R|PAIR)\b/i.test(fullText) ? 'A/B' : '',
          processLabel: detectProcessFromText(fullText)
        });
      }
    }
  }

  // Gabungkan pola kembar & pasangan Kiri/Kanan (A/B)
  const uniquePieces = [];
  rawPieces.forEach(p => {
    const baseP = getBasePairName(p.name);
    const isMarkedLR = /[\s_\-]+(L|R|LEFT|RIGHT|A|B)$/i.test(p.name);

    const dup = uniquePieces.find(u =>
      getBasePairName(u.name) === baseP &&
      Math.abs(u.width - p.width) < 4 &&
      Math.abs(u.height - p.height) < 4
    );

    if (dup) {
      dup.dupCount = (dup.dupCount || 1) + 1;
      dup.secondPolygons = p.polygons; // Simpan bentuk pasangan kedua untuk digambar berdampingan
      if (isMarkedLR || isMirroredPoly(dup.polygons, p.polygons, dup.width, p.width) || dup.qtyLabel === 'A/B') {
        dup.isPairAB = true;
        dup.name = baseP;
        dup.qtyLabel = dup.dupCount >= 4 ? 'Ax2 Bx2' : 'A/B';
      } else if (!dup.isPairAB) {
        dup.qtyLabel = 'X' + dup.dupCount;
      }
      if (!dup.processLabel && p.processLabel) dup.processLabel = p.processLabel;
    } else {
      p.id = uniquePieces.length + 1;
      p.dupCount = 1;
      p.isPairAB = isMarkedLR || p.qtyLabel === 'A/B';
      if (isMarkedLR) { p.name = baseP; p.qtyLabel = 'A/B'; }
      uniquePieces.push(p);
    }
  });
  return uniquePieces;
}

function extractComponentCode(text) {
  const m = text.match(/\b(M\d{2}|IP\d{2}|B\d{2}[a-z]?|S\d{2}[a-z]?|O\d{2})\b/i);
  return m ? m.toUpperCase() : '';
}


function getBasePairName(name) {
  return name.replace(/[\s_\-]+(L|R|LEFT|RIGHT|A|B|1|2)$/i, '').trim();
}

function cleanDisplayName(text, code) {
  let clean = text.replace(/Sewing|Cut|Boundary|Piece|Name[:\s]*/gi, '').replace(/-S_\d+/gi, '').split('|').pop().trim();
  if (clean.length < 2 && code) return code;
  return clean.toUpperCase().substring(0, 26);
}

function getBounds(polysList) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polysList.forEach(poly => poly.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
function handleExcelUpload(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      excelColorways = {};

      // Cek apakah ada sheet VAI atau FAB; jika tidak ada (misal file CSV 1 sheet), baca semua sheet
      const targetSheets = workbook.SheetNames.filter(s => /(VAI|FAB)/i.test(s) && !/^(WEB|FORM)/i.test(s.trim()));
      const sheetsToRead = targetSheets.length > 0 ? targetSheets : workbook.SheetNames;

      sheetsToRead.forEach(sheetName => {
        if (/^(WEB|FORM)/i.test(sheetName.trim())) return;
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
        parseBomRows(rows, sheetName.trim());
      });

      const cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      if (cwKeys.length > 0) {
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        document.getElementById('excelZone').classList.add('loaded');
        document.getElementById('excelStatus').innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Colorway siap)';
        applyColorwayMapping();
      } else {
        alert("Tidak ditemukan tabel komponen fabric (MA, T1, T2, T3, L2, N1) pada file ini.");
      }
    } catch (err) {
      alert("Error membaca Excel/CSV: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseBomRows(rows, sheetName) {
  const sheetCodeMatch = sheetName.match(/\(([^)]+)\)/);
  const defaultColor = sheetCodeMatch ? sheetCodeMatch.at(1).trim().toUpperCase() : sheetName;
  let cwKey = sheetName;
  let leftFab = 'MA', midFab = 'L2';
  let blockCount = 0;
  let isConsumptionTable = false;

  excelColorways[cwKey] = { cleanColor: defaultColor, sheetName, pieces: [], fabricSpecs: {} };

  rows.forEach(row => {
    const lineStr = row.join(' ');

    // Deteksi Model / Style No (misal JS0A2SDD atau JS0A47JK)
    const jsCode = lineStr.match(/\b(JS[A-Z0-9]{5,10})\b/i);
    if (jsCode && jsCode.at(1)) {
      currentStyleName = jsCode.at(1).toUpperCase();
      const styleInput = document.getElementById('styleNoInput');
      if (styleInput && !styleInput.value) styleInput.value = currentStyleName;
    }

    // Deteksi baris header COLORWAY : atau COLOR :
    const colorM = lineStr.match(/\bCOLOR(?:WAY)?\s*:\s*([^,;]+?)(?:DATE|PERSON|PER SON|STYLE|$)/i);
    if (colorM && colorM.at(1) && colorM.at(1).trim() && !/NAME|CODE|WIDTH|FABRIC|SPEC|QTY/i.test(colorM.at(1))) {
      const rawCw = colorM.at(1).trim();
      const foundColor = rawCw.replace(/^\d+[\.\)]\s*/, '').toUpperCase();
      blockCount++;
      cwKey = blockCount === 1 ? sheetName : (sheetName + ' #' + blockCount);
      excelColorways[cwKey] = { cleanColor: foundColor, sheetName, pieces: [], fabricSpecs: {} };
      leftFab = 'MA'; midFab = 'L2';
      isConsumptionTable = false;
    }

    // Deteksi header tabel Consumption Reg Dtl2 (No., Annotation(ENG), Size, Qty, Category...)
    if (String(row.at(1) || '').includes('Annotation') && String(row.at(4) || '').includes('Category')) {
      isConsumptionTable = true;
      return;
    }

    // MODE A: Format Tabel Consumption Reg Dtl2 (Kolom: 1=Annotation, 2=Size, 3=Qty, 4=Category/Fabric, 6=Material, 7=Spec, 9=Color)
    if (isConsumptionTable) {
      const cat = String(row.at(4) || '').trim().toUpperCase();
      const sizeStr = String(row.at(2) || '').trim();
      const compRaw = String(row.at(1) || '').trim();
      if (/^(MA|T1|T2|T3|L2|N1)$/.test(cat) && /^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?/.test(sizeStr) && compRaw) {
        const parts = sizeStr.split(/[*xX]/).map(s => s.trim());
        const qty = parseInt(row.at(3)) || parseInt(parts.at(2)) || 1;
        const mCode = compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i) || compRaw.match(/\(([^)]+)\)/);
        const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
        const cleanName = compRaw.replace(/^[A-Z\+]{2,12}-/, '').replace(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?).*$/i, '').trim().toUpperCase();

        excelColorways[cwKey].pieces.push({
          fabric: cat, name: cleanName || compRaw.toUpperCase(), raw: compRaw.toUpperCase(),
          codes, size: parts.at(0) + '*' + parts.at(1), qty
        });

        const matName = String(row.at(6) || '').trim().toUpperCase();
        const matSpec = String(row.at(7) || '').trim().toUpperCase();
        const matCol = String(row.at(9) || '').trim().toUpperCase();
        if (matName && matName !== '_') {
          excelColorways[cwKey].fabricSpecs[cat] = (matName + ' ' + matSpec + (matCol && matCol !== '_' ? ' (' + matCol + ')' : '')).replace(/\s+/g, ' ').trim();
        }
      }
      return;
    }

    // MODE B: Format Tabel MAIN MATERIAL & ZIPPER INSTRUCTION (Tab VAI / FAB)
    row.forEach((cellVal, colIdx) => {
      const val = String(cellVal || '').trim();
      const upVal = val.toUpperCase();

      if (colIdx <= 1 && /^(MA|T1|T2|T3|N1)(?:\b|-)/.test(upVal)) leftFab = upVal.match(/^(MA|T1|T2|T3|N1)/).at(1);
      if (colIdx >= 2 && colIdx <= 4 && /^(L2|L1)(?:\b|-)/.test(upVal)) midFab = upVal.match(/^(L2|L1)/).at(1);

      if (/^(MA|T1|T2|T3|N1|L2)$/.test(upVal) && colIdx >= 6) {
        const specName = String(row.at(colIdx + 1) || '').trim().toUpperCase();
        const specColor = String(row.at(colIdx + 3) || '').trim().toUpperCase();
        const specWidth = String(row.at(colIdx + 4) || '').trim().toUpperCase().replace(/^CUT\s+/i, '');
        if (specName) {
          excelColorways[cwKey].fabricSpecs[upVal] = (specName + ' ' + specWidth + (specColor ? ' (' + specColor + ')' : '')).replace(/\s+/g, ' ').trim();
        }
      }

      if (/^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?\s*[*xX]\s*\d+$/.test(val) && colIdx >= 1) {
        const compRaw = String(row.at(colIdx - 1) || '').trim();
        if (!compRaw) return;
        const parts = val.split(/[*xX]/).map(s => s.trim());
        const qty = parseInt(parts.at(2)) || 1;
        const mCode = compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i) || compRaw.match(/\(([^)]+)\)/);
        const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
        const cleanName = compRaw.replace(/\([^)]*\)/g, '').replace(/^[A-Z\+]{2,12}-/, '').trim().toUpperCase();
        const activeFab = colIdx <= 2 ? leftFab : midFab;

        excelColorways[cwKey].pieces.push({
          fabric: activeFab, name: cleanName, raw: compRaw.toUpperCase(),
          codes, size: parts.at(0) + '*' + parts.at(1), qty
        });
      }
    });
  });
}

function applyColorwayMapping() {
  const cwKey = document.getElementById('colorwaySelect').value;
  const bom = excelColorways[cwKey];
  if (!bom) return;
  currentColorwayName = bom.cleanColor;
  if (parsedPieces.length === 0) return;

  const availableBom = bom.pieces.map((b, idx) => ({ ...b, idx, used: false }));

  parsedPieces.forEach(p => {
    const d1 = p.width / 10;
    const d2 = p.height / 10;
    const up = p.rawText.toUpperCase();

    let bestItem = null;
    let bestScore = Infinity;

    availableBom.forEach(b => {
      const [s1, s2] = b.size.split('*').map(Number);
      if (!s1 || !s2) return;
      const diffNormal = Math.abs(d1 - s1) + Math.abs(d2 - s2);
      const diffRot = Math.abs(d1 - s2) + Math.abs(d2 - s1);
      const minDiff = Math.min(diffNormal, diffRot);

      if (minDiff <= 2.2) {
        let score = minDiff;
        if (b.code && up.includes(b.code)) score -= 5;
        if (b.used) score += 10;
        if (score < bestScore) { bestScore = score; bestItem = b; }
      }
    });

    if (bestItem) {
      bestItem.used = true;
      p.fabric = bestItem.fabric;
      p.name = bestItem.name || p.name;
      p.sizeText = bestItem.size;
      if (bestItem.qty > 1) { if (p.isPairAB || /SHOULDER|FRONT.*SIDE|ENDZIP/i.test(p.name)) { p.isPairAB = true; p.qtyLabel = bestItem.qty >= 4 ? 'Ax2 Bx2' : 'A/B'; } else { p.qtyLabel = 'X' + bestItem.qty; } }
    }
  });
  renderPieceMappingList();
}

function renderPieceMappingList() {
  const container = document.getElementById('pieceMappingList');
  if (parsedPieces.length === 0) return;
  const fabrics = ['MA', 'T1', 'T2', 'T3', 'L2', 'N1'];
  const processes = ['', 'OCM', 'BORDIR', 'OCM-BORDIR', 'AUTOMATION', 'AUTOMATION-BORDIR', 'HEAT EMBOSSED', 'SILKSCREEN'];
  const qtys = ['', 'A/B', 'Ax2 Bx2', 'X2', 'X3', 'X4', 'X6'];

  container.innerHTML = parsedPieces.map((p, idx) => `
    <div class="piece-item" style="flex-direction:column; align-items:stretch; gap:6px; padding:8px 0;">
      <div style="display:flex; gap:6px; align-items:center;">
        <input type="text" value="${p.name.replace(/"/g, '&quot;')}"
          onchange="parsedPieces.at(${idx}).name = this.value.toUpperCase()"
          placeholder="Nama Pattern"
          style="flex:2; margin:0; padding:6px 8px; font-size:12px; font-weight:600;" />
        <input type="text" value="${p.sizeText.replace(/"/g, '&quot;')}"
          onchange="parsedPieces.at(${idx}).sizeText = this.value"
          placeholder="Ukuran (W*L)"
          style="flex:1; margin:0; padding:6px 8px; font-size:12px;" />
      </div>
      <div style="display:flex; gap:6px; justify-content:flex-end;">
        <select onchange="parsedPieces.at(${idx}).fabric = this.value" title="Fabric" style="flex:1;">
          ${fabrics.map(f => `<option value="${f}" ${p.fabric === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
        <select onchange="parsedPieces.at(${idx}).qtyLabel = this.value" title="Qty" style="flex:1;">
          ${qtys.map(q => `<option value="${q}" ${p.qtyLabel === q ? 'selected' : ''}>${q || '1x'}</option>`).join('')}
        </select>
        <select onchange="parsedPieces.at(${idx}).processLabel = this.value; renderDynamicProcessColors();" title="Proses" style="flex:1.4;">
          ${processes.map(pr => `<option value="${pr}" ${p.processLabel === pr ? 'selected' : ''}>${pr || 'Proses-'}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
}

function getSavedProcessColors() {
  try { return JSON.parse(localStorage.getItem('mm_proc_colors') || '{}'); } catch (e) { return {}; }
}

function isTooDarkOrBlack(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length !== 6) return true;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const maxCh = Math.max(r, g, b);
  const minCh = Math.min(r, g, b);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 60 || (maxCh < 100 && (maxCh - minCh) < 30);
}

function getDefaultColorForProcess(proc) {
  const up = String(proc || '').trim().toUpperCase();
  if (up === 'BORDIR' || up.includes('BORDIR')) return '#dc2626';       // Merah
  if (up === 'OCM' || up.includes('OCM')) return '#059669';             // Hijau Emerald
  if (up === 'AUTOMATION' || up.includes('AUTO')) return '#1d4ed8';     // Biru
  if (up.includes('EMBOSS')) return '#d97706';                          // Oranye
  if (up.includes('SILKSCREEN')) return '#7c3aed';                      // Ungu
  const palette = ['#dc2626', '#059669', '#1d4ed8', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
  let hash = 0;
  for (let i = 0; i < up.length; i++) hash = up.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function getProcessColor(proc) {
  const up = String(proc || '').trim().toUpperCase();
  if (!up) return '#dc2626';
  const saved = getSavedProcessColors();
  const chosen = saved[up];
  if (chosen && !isTooDarkOrBlack(chosen)) return chosen;
  return getDefaultColorForProcess(up);
}

function updateProcessColorValue(proc, hexColor) {
  const up = String(proc || '').trim().toUpperCase();
  let finalColor = hexColor;
  if (isTooDarkOrBlack(hexColor)) {
    finalColor = getDefaultColorForProcess(up);
    alert('Warna hitam atau terlalu gelap dilarang untuk label proses! Otomatis dikembalikan ke warna kontras.');
  }
  const saved = getSavedProcessColors();
  saved[up] = finalColor;
  localStorage.setItem('mm_proc_colors', JSON.stringify(saved));
function renderDynamicProcessColors() {
  const listEl = document.getElementById("dynamicProcessColors");
  if (!listEl) return;
  const procSet = new Set();
  parsedPieces.forEach(p => {
    String(p.processLabel || "").toUpperCase().split("-").map(s => s.trim()).filter(Boolean).forEach(x => procSet.add(x));
  });
  const list = [...procSet];
  if (list.length === 0) {
    listEl.innerHTML = '<div class="card-sub">Belum ada proses luar line yang terdeteksi.</div>';
    return;
  }
  listEl.innerHTML = list.map((proc, i) => {
    const col = getProcessColor(proc);
    return '<div style="display:flex;align-items:center;justify-content:space-between;background:#0f172a;padding:8px 12px;border-radius:8px;border:1px solid #1e293b;">' +
      '<span style="font-size:13px;font-weight:900;color:' + col + ';">' + (i + 1) + '. ' + proc + '</span>' +
      '<input type="color" value="' + col + '" data-proc="' + proc + '" onchange="updateProcessColorValue(this.dataset.proc, this.value)" style="width:40px;height:28px;border:1px solid #334155;border-radius:6px;background:none;padding:0;" /></div>';
  }).join("");
}

function generateMiniMarker() {
  if (parsedPieces.length === 0) {
    alert("Silakan unggah file DXF terlebih dahulu atau klik 'Coba Contoh'.");
    return;
  }

  const styleVal = (document.getElementById('styleNoInput')?.value || currentStyleName).trim().toUpperCase();
  const orderVal = (document.getElementById('orderNoInput')?.value || '').trim().toUpperCase();
  const fontFam = document.getElementById('fontFamilySelect')?.value || '"Times New Roman", serif';
  const titleSize = parseInt(document.getElementById('titleFontSize')?.value) || 38;
  const labelSize = parseInt(document.getElementById('labelFontSize')?.value) || 14;
  const customCols = document.getElementById('colsSelect')?.value || 'auto';
  const customRows = document.getElementById('rowsSelect')?.value || 'auto';
  const cwKey = document.getElementById('colorwaySelect')?.value;
  const bom = excelColorways[cwKey];

  const fabricOrder = ['MA', 'T1', 'T2', 'T3', 'L2', 'N1'];
  const activeFabrics = fabricOrder.filter(f => parsedPieces.some(p => p.fabric === f));
  const fabricNumberMap = {};
  activeFabrics.forEach((f, idx) => { fabricNumberMap[f] = idx + 1; });

  const sortedPieces = [...parsedPieces].sort((a, b) => (fabricNumberMap[a.fabric] || 9) - (fabricNumberMap[b.fabric] || 9));
  const subCounters = {};
  sortedPieces.forEach(p => {
    const fNum = fabricNumberMap[p.fabric] || 1;
    subCounters[fNum] = (subCounters[fNum] || 0) + 1;
    p.itemNumberLabel = fNum + '.' + subCounters[fNum];
  });

  const totalAll = sortedPieces.length;
  const cols = customCols !== 'auto' ? parseInt(customCols) : (totalAll <= 12 ? 6 : (totalAll <= 21 ? 7 : 8));
  let rowsPerPage = customRows !== 'auto' ? parseInt(customRows) : Math.ceil(totalAll / cols);

  let maxPages = 1;
  if (customRows === 'auto' && totalAll > 28) {
    maxPages = Math.min(3, Math.ceil(totalAll / 24));
    rowsPerPage = Math.ceil(Math.ceil(totalAll / maxPages) / cols);
  } else if (customRows !== 'auto') {
    maxPages = Math.min(3, Math.max(1, Math.ceil(totalAll / (cols * rowsPerPage))));
  }

  const perPage = cols * rowsPerPage;
  const pages = [];
  for (let p = 0; p < maxPages; p++) {
    const slice = sortedPieces.slice(p * perPage, (p + 1) * perPage);
    if (slice.length > 0) pages.push(slice);
  }
  if (sortedPieces.length > maxPages * perPage) {
    const extra = sortedPieces.slice(maxPages * perPage);
    pages[pages.length - 1] = pages[pages.length - 1].concat(extra);
  }
  const container = document.getElementById('markerContainer');
  container.innerHTML = '';
  generatedCanvases = [];

  pages.forEach((pagePieces, pageIdx) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1754;
    canvas.height = 1240;
    canvas.style.marginBottom = '12px';

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + titleSize + 'px ' + fontFam;
    ctx.textAlign = 'center';
    const pageSuffix = pages.length > 1 ? ' [HAL ' + (pageIdx + 1) + '/' + pages.length + ']' : '';
    ctx.fillText(styleVal + ' (' + currentColorwayName + ')' + pageSuffix, canvas.width / 2, 48);

    const footerLineH = Math.max(labelSize + 11, 24);
    const footerH = 42 + (activeFabrics.length * footerLineH);
    const boxX = 36, boxY = 76;
    const boxW = canvas.width - 72;
    const boxH = canvas.height - boxY - footerH - 22;

    if (orderVal) {
      ctx.font = 'bold ' + (labelSize + 3) + 'px ' + fontFam;
      ctx.textAlign = 'left';
      ctx.fillText(orderVal, boxX, boxY - 8);
    }

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    const actualRows = Math.max(rowsPerPage, Math.ceil(pagePieces.length / cols));
    const cellW = (boxW - 24) / cols;
    const cellH = (boxH - 18) / actualRows;

    pagePieces.forEach((piece, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cx = boxX + 12 + col * cellW;
      const cy = boxY + 10 + row * cellH;
      const fabNum = piece.itemNumberLabel || String(fabricNumberMap[piece.fabric] || 1);

      const circleR = Math.min(16, cellH * 0.085);
      ctx.beginPath();
      ctx.arc(cx + circleR + 4, cy + circleR + 12, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#000000';
      const numScale = String(fabNum).length >= 4 ? 0.78 : 0.92;
      ctx.font = 'bold ' + Math.round(circleR * numScale) + 'px ' + fontFam;
      ctx.textAlign = 'center';
      ctx.fillText(String(fabNum), cx + circleR + 4, cy + circleR + 12 + Math.round(circleR * 0.38));

      const topSpace = piece.processLabel ? (labelSize + 10) : 8;
      const bottomSpace = (labelSize * 2) + 16;
      const leftOffset = (circleR * 2) + 12;
      const maxDrawW = Math.max(cellW - leftOffset - 46, 24);
      const maxDrawH = Math.max(cellH - topSpace - bottomSpace, 24);

      const drawSideBySide = piece.isPairAB && piece.height > piece.width * 1.4;
      const totalDrawW = drawSideBySide ? (piece.width * 2 + 25) : piece.width;
      const pairScale = Math.min(maxDrawW / Math.max(totalDrawW, 1), maxDrawH / Math.max(piece.height, 1));
      const finalW = totalDrawW * pairScale;
      const finalH = piece.height * pairScale;
      const finalX = cx + leftOffset + (maxDrawW - finalW) / 2;
      const finalY = cy + topSpace + (maxDrawH - finalH) / 2;
      const centerDrawX = finalX + finalW / 2;

      if (piece.processLabel) {
        const parts = piece.processLabel.toUpperCase().split('-').map(s => s.trim()).filter(Boolean);
        ctx.font = '900 ' + Math.max(labelSize, 11) + 'px ' + fontFam;
        ctx.textAlign = 'left';
        const sep = ' - ';
        const sepW = ctx.measureText(sep).width;
        const partWidths = parts.map(pt => ctx.measureText(pt).width);
        const totalTextW = partWidths.reduce((a, b) => a + b, 0) + sepW * Math.max(parts.length - 1, 0);
        let curTextX = centerDrawX - (totalTextW / 2);

        parts.forEach((pt, pIdx) => {
          ctx.fillStyle = getProcessColor(pt);
          ctx.fillText(pt, curTextX, finalY - 5);
          curTextX += partWidths.at(pIdx);
          if (pIdx < parts.length - 1) {
            ctx.fillStyle = '#64748b';
            ctx.fillText(sep, curTextX, finalY - 5);
            curTextX += sepW;
          }
        });
      }
      const renderPolySet = (polyList, shiftX, mirrorW) => {
        polyList.forEach(poly => {
          ctx.beginPath();
          poly.pts.forEach((pt, i) => {
            const rawX = mirrorW ? (mirrorW - pt.x) : pt.x;
            const px = finalX + shiftX + rawX * pairScale;
            const py = finalY + pt.y * pairScale;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
          ctx.strokeStyle = poly.isOuter ? '#000000' : '#64748b';
          ctx.lineWidth = poly.isOuter ? 2.1 : 0.9;
          if (poly.isOuter) ctx.closePath();
          ctx.stroke();
        });
      };

      renderPolySet(piece.polygons, 0, 0);
      if (drawSideBySide) {
        const secondSet = piece.secondPolygons || piece.polygons;
        renderPolySet(secondSet, (piece.width + 25) * pairScale, piece.secondPolygons ? 0 : piece.width);
      }

      if (piece.qtyLabel) {
        ctx.fillStyle = '#000000';
        ctx.font = 'bold ' + Math.max(labelSize - 1, 10) + 'px ' + fontFam;
        ctx.textAlign = 'left';
        const labelX = Math.min(finalX + finalW + 4, cx + cellW - 42);
        if (piece.qtyLabel === 'Ax2 Bx2') {
          ctx.fillText('Ax2', labelX, finalY + 13);
          ctx.fillText('Bx2', labelX, finalY + 27);
        } else {
          ctx.fillText(piece.qtyLabel, labelX, finalY + 14);
        }
      }

      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      const textBaseY = finalY + finalH + labelSize + 3;
      ctx.font = 'bold ' + labelSize + 'px ' + fontFam;
      ctx.fillText(piece.sizeText, centerDrawX, textBaseY);
      ctx.font = Math.max(labelSize - 2, 9) + 'px ' + fontFam;
      ctx.fillText(piece.name.substring(0, 22), centerDrawX, textBaseY + labelSize + 2);
    });

    let legY = boxY + boxH + labelSize + 15;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + (labelSize + 2) + 'px ' + fontFam;
    ctx.fillText('KETERANGAN :', boxX, legY);
    legY += footerLineH;

    const bomSpecs = (bom && bom.fabricSpecs) || {};
    const defaultSpecs = {
      MA: 'POLY 600D SOLID 100% RECYCLED 60" PU (' + currentColorwayName + ')',
      T1: 'POLY 600D SOLID 100% RECYCLED 60" PU (BLACK 008)',
      L2: 'POLY 200D SOLUTION DYE EMBOSSED 100% RECYCLED 58" PU (INTERNAL)',
      T2: 'PU LEATHER 52" (VENDOR BROWN 0YK)',
      T3: 'NON-WOVEN FABRIC 60" 100G (WHITE)',
      N1: 'POLY 840D MESH 60" (' + currentColorwayName + ')'
    };

    ctx.font = (labelSize + 1) + 'px ' + fontFam;
    activeFabrics.forEach(fab => {
      const num = fabricNumberMap[fab];
      const compCount = sortedPieces.filter(p => p.fabric === fab).length;
      const specText = (bomSpecs[fab] || defaultSpecs[fab] || fab).replace(/\bWIDTH\s*VAI\b|\bWIDTH\b|\bVAI\b/gi, '').replace(/\s+/g, ' ').trim();
      ctx.fillText(num + '. ' + specText + ' (' + compCount + ' KOMPONEN)', boxX, legY);
      legY += footerLineH;
    });

    container.appendChild(canvas);
    generatedCanvases.push(canvas);
  });
  document.getElementById("resultArea").classList.remove("hidden");
  saveToHistory(styleVal + ".dxf", parsedPieces.length, activeFabrics.length);
}

function exportAllPDF() {
  if (generatedCanvases.length === 0) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  generatedCanvases.forEach((canvas, idx) => {
    if (idx > 0) doc.addPage();
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, 287, 200);
  });
  doc.save('MiniMarker_' + currentStyleName + '_' + currentColorwayName.replace(/\s+/g, '_') + '.pdf');
}

function exportAllPNG() {
  if (generatedCanvases.length === 0) return;
  generatedCanvases.forEach((canvas, idx) => {
    const link = document.createElement('a');
    const suffix = generatedCanvases.length > 1 ? '_Hal' + (idx + 1) : '';
    link.download = 'MiniMarker_' + currentStyleName + '_' + currentColorwayName.replace(/\s+/g, '_') + suffix + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

function loadSampleData() {
  currentStyleName = "JS0A47JK";
  currentColorwayName = "BUBBLE GUM A5Y";
  document.getElementById('styleNoInput').value = "JS0A47JK";
  document.getElementById('orderNoInput').value = "KT26JN022";
  const makeRect = (w, h) => [{ pts: [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}], isOuter: true }];
  parsedPieces = [
    { id: 1, code: "M01", name: "FRONT POCKET TOP", sizeText: "9.3*24.5", rawText: "M01", polygons: makeRect(245, 93), width: 245, height: 93, fabric: "MA", qtyLabel: "", processLabel: "" },
    { id: 2, code: "B02a", name: "BACK PANEL", sizeText: "45.6*34.6", rawText: "B02a", polygons: makeRect(346, 456), width: 346, height: 456, fabric: "MA", qtyLabel: "", processLabel: "BORDIR" },
    { id: 3, code: "S01a", name: "SHOULDER STRAP", sizeText: "47.1*11.3", rawText: "S01a", polygons: makeRect(113, 471), width: 113, height: 471, fabric: "MA", qtyLabel: "Ax2 Bx2", isPairAB: true, processLabel: "AUTOMATION - OCM" },
    { id: 4, code: "IP02", name: "FRONT POCKET LINING", sizeText: "30*24.4", rawText: "IP02", polygons: makeRect(244, 300), width: 244, height: 300, fabric: "L2", qtyLabel: "", processLabel: "AUTOMATION" },
    { id: 5, code: "CC", name: "COMPT CASE", sizeText: "43.4*37.6", rawText: "CC", polygons: makeRect(376, 434), width: 376, height: 434, fabric: "L2", qtyLabel: "X2", processLabel: "" },
    { id: 6, code: "T2", name: "BACK NON-WOVEN", sizeText: "45.6*34.6", rawText: "T2", polygons: makeRect(346, 456), width: 346, height: 456, fabric: "T2", qtyLabel: "", processLabel: "" },
    { id: 7, code: "M26", name: "SIDE RIGHT MESH", sizeText: "21.6*24.7", rawText: "M26", polygons: makeRect(247, 216), width: 247, height: 216, fabric: "N1", qtyLabel: "", processLabel: "" }
  ];
  document.getElementById('dxfZone').classList.add('loaded');
  document.getElementById('dxfStatus').innerHTML = '✅ <strong>JS0A47JK.dxf</strong> (Contoh dimuat)';
  generateMiniMarker();
}

function saveToHistory(name, pieceCount, fabricCount) {
  let history = JSON.parse(localStorage.getItem('mm_history') || '[]');
  const orderVal = (document.getElementById('orderNoInput')?.value || '').trim().toUpperCase();
  const dateStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  const keyId = (orderVal || name) + '_' + currentColorwayName;
  // Hapus entri lama dengan Order No & Colorway yang sama (timpa otomatis)
  history = history.filter(h => ((h.orderNo || h.name) + '_' + (h.cw || '')) !== keyId);
  history.unshift({ name, orderNo: orderVal, pieceCount, fabricCount, date: dateStr, pieces: parsedPieces, style: currentStyleName, cw: currentColorwayName });
  localStorage.setItem('mm_history', JSON.stringify(history.slice(0, 25)));
  loadProcessColors();
renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('mm_history') || '[]');
  const el = document.getElementById('historyList');
  if (history.length === 0) {
    el.innerHTML = '<div class="card"><div class="card-sub">Belum ada riwayat mini marker tersimpan.</div></div>';
    return;
  }
  el.innerHTML = history.map((item, idx) => `
    <div class="card" onclick="loadFromHistory(${idx})" style="cursor:pointer;">
      <div class="card-row">
        <span class="card-title">${item.style || item.name} (${item.cw || ''})</span>
        <span style="font-size:11px; color:var(--muted);">${item.date}</span>
      </div>
      <div class="card-sub">${item.name} · ${item.pieceCount} komponen · ${item.fabricCount} fabric</div>
    </div>
  `).join('');
}

function loadFromHistory(idx) {
  const history = JSON.parse(localStorage.getItem('mm_history') || '[]');
  if (!history.at(idx)) return;
  parsedPieces = history.at(idx).pieces;
  currentStyleName = history.at(idx).style || "STYLE";
  currentColorwayName = history.at(idx).cw || "";
  generateMiniMarker();
}

async function backupData() {
  const history = localStorage.getItem('mm_history') || '[]';
  const procColors = localStorage.getItem('mm_proc_colors') || '{}';
  const rawOrder = (document.getElementById('orderNoInput')?.value || currentStyleName || 'BACKUP').trim().toUpperCase();
  const orderFolder = rawOrder.replace(/[^A-Z0-9_\-]/g, '_') || 'BACKUP';
  const jsonFileName = orderFolder + '.json';

  const payload = JSON.stringify({
    orderNo: rawOrder,
    exportedAt: new Date().toISOString(),
    history: JSON.parse(history),
    processColors: JSON.parse(procColors)
  }, null, 2);

  // 1. Jika browser/APK mendukung akses direktori langsung, buat folder <ORDER_NO>/<ORDER_NO>.json
  if (window.showDirectoryPicker) {
    try {
      const rootDir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const subDir = await rootDir.getDirectoryHandle(orderFolder, { create: true });
      const fileHandle = await subDir.getFileHandle(jsonFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(payload);
      await writable.close();
      alert('Backup berhasil disimpan ke folder "' + orderFolder + '/' + jsonFileName + '" (file lama ditimpa).');
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // 2. Fallback Chrome Android: kemas folder <ORDER_NO>/<ORDER_NO>.json dalam arsip ZIP
  if (typeof JSZip !== 'undefined') {
    const zip = new JSZip();
    const folder = zip.folder(orderFolder);
    folder.file(jsonFileName, payload);
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.download = orderFolder + '_json.zip';
    link.href = URL.createObjectURL(blob);
    link.click();
    alert('Backup folder "' + orderFolder + '/' + jsonFileName + '" berhasil diunduh!');
  } else {
    const blob = new Blob([payload], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = jsonFileName;
    link.href = URL.createObjectURL(blob);
    link.click();
  }
}

async function restoreData(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  try {
    let jsonText = '';
    if (file.name.toLowerCase().endsWith('.zip') && typeof JSZip !== 'undefined') {
      const zip = await JSZip.loadAsync(file);
      const jsonEntry = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith('.json'));
      if (!jsonEntry) throw new Error('File .json tidak ditemukan di dalam arsip ZIP.');
      jsonText = await jsonEntry.async('text');
    } else {
      jsonText = await file.text();
    }

    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      localStorage.setItem('mm_history', JSON.stringify(parsed));
    } else {
      if (parsed.history) localStorage.setItem('mm_history', JSON.stringify(parsed.history));
      if (parsed.processColors) localStorage.setItem('mm_proc_colors', JSON.stringify(parsed.processColors));
      if (parsed.orderNo && document.getElementById('orderNoInput')) {
        document.getElementById('orderNoInput').value = parsed.orderNo;
      }
    }
    renderHistory();
    if (typeof renderDynamicProcessColors === 'function') renderDynamicProcessColors();
    alert('Data backup berhasil dipulihkan!');
  } catch (err) {
    alert('Gagal memulihkan backup: ' + err.message);
  }
  event.target.value = '';
}

renderHistory();

async function saveAllColorwaysBatch() {
  if (parsedPieces.length === 0) {
    alert("Belum ada pola DXF yang dimuat.");
    return;
  }
  const orderNo = (document.getElementById('orderNoInput')?.value || currentStyleName || 'ORDER_MARKER').trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
  const cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0);
  const targetKeys = cwKeys.length > 0 ? cwKeys : [currentColorwayName];
  const { jsPDF } = window.jspdf;

  // 1. Jika browser/Android WebView mendukung pilih folder langsung (File System Access API)
  if (window.showDirectoryPicker) {
    try {
      const rootDir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const orderFolder = await rootDir.getDirectoryHandle(orderNo, { create: true });

      for (const cwKey of targetKeys) {
        if (cwKeys.length > 0) {
          document.getElementById('colorwaySelect').value = cwKey;
          applyColorwayMapping();
        }
        generateMiniMarker();

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        generatedCanvases.forEach((canvas, idx) => {
          if (idx > 0) doc.addPage();
          doc.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, 287, 200);
        });

        const safeCw = currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_');
        const fileName = `MiniMarker_${currentStyleName}_${safeCw}.pdf`;
        // createWritable() otomatis menimpa file jika sudah ada di folder Order No
        const fileHandle = await orderFolder.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(doc.output('blob'));
        await writable.close();
      }
      alert(`Berhasil menyimpan ${targetKeys.length} Colorway ke dalam folder "${orderNo}" (file lama otomatis ditimpa)!`);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // 2. Fallback untuk Chrome Android / APK: kemas ke dalam arsip folder <ORDER_NO>.zip (timpa file lama)
  const zip = new JSZip();
  const folder = zip.folder(orderNo);

  for (const cwKey of targetKeys) {
    if (cwKeys.length > 0) {
      document.getElementById('colorwaySelect').value = cwKey;
      applyColorwayMapping();
    }
    generateMiniMarker();

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    generatedCanvases.forEach((canvas, idx) => {
      if (idx > 0) doc.addPage();
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', 5, 5, 287, 200);
    });

    const safeCw = currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_');
    folder.file(`MiniMarker_${currentStyleName}_${safeCw}.pdf`, doc.output('blob'));
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.download = `${orderNo}.zip`;
  link.href = URL.createObjectURL(zipBlob);
  link.click();
  alert(`Selesai! ${targetKeys.length} Colorway disimpan dalam folder "${orderNo}" (${orderNo}.zip).`);
}

// === NAVIGASI SWIPE COLORWAY, PINCH-ZOOM & ROTATE ===
let currentSwipeIdx = 0;
let viewZoom = 1;
let viewRot = 0;
let viewPanX = 0;
let viewPanY = 0;

function updateSwipeBarUI() {
  const sel = document.getElementById('colorwaySelect');
  const bar = document.getElementById('cwSwipeBar');
  const lbl = document.getElementById('cwSwipeLabel');
  if (!sel || !bar || !lbl) return;

  const total = sel.options.length;
  if (total <= 1) {
    bar.style.display = 'none';
    return;
  }
  currentSwipeIdx = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
  bar.classList.remove('hidden');
  bar.style.display = 'flex';
  lbl.textContent = 'Colorway ' + (currentSwipeIdx + 1) + ' / ' + total + ' : ' + currentColorwayName + ' (Geser ↔)';
}

function navigateColorway(step) {
  const sel = document.getElementById('colorwaySelect');
  if (!sel || sel.options.length <= 1) return;
  const total = sel.options.length;
  currentSwipeIdx = (sel.selectedIndex + step + total) % total;
  sel.selectedIndex = currentSwipeIdx;
  applyColorwayMapping();
  generateMiniMarker();
  updateSwipeBarUI();
}

function previewAllColorways() {
  const sel = document.getElementById('colorwaySelect');
  if (!sel || sel.options.length === 0) {
    alert("Unggah file Excel BOM terlebih dahulu.");
    return;
  }
  sel.selectedIndex = 0;
  applyColorwayMapping();
  generateMiniMarker();
  updateSwipeBarUI();
}

function applyPreviewTransform() {
  const target = document.getElementById('markerContainer');
  const lbl = document.getElementById('zoomLevelLabel');
  if (!target) return;
  const rotScale = (viewRot % 180 !== 0 && viewZoom === 1) ? 0.68 : 1;
  const finalScale = viewZoom * rotScale;
  target.style.transform = `translate(${viewPanX}px, ${viewPanY}px) rotate(${viewRot}deg) scale(${finalScale})`;
  if (lbl) lbl.textContent = Math.round(viewZoom * 100) + '% (Reset)';
}

function adjustPreviewZoom(delta) {
  viewZoom = Math.min(Math.max(viewZoom + delta, 1), 3.5);
  if (viewZoom === 1) { viewPanX = 0; viewPanY = 0; }
  applyPreviewTransform();
}

function rotatePreviewCanvas() {
  viewRot = (viewRot + 90) % 360;
  viewPanX = 0;
  viewPanY = 0;
  applyPreviewTransform();
}

function resetPreviewTransform() {
  viewZoom = 1;
  viewRot = 0;
  viewPanX = 0;
  viewPanY = 0;
  applyPreviewTransform();
}

(function initInteractiveViewport() {
  const vp = document.getElementById('previewViewport');
  if (!vp) return;
  let startX = 0, startY = 0, lastPanX = 0, lastPanY = 0;
  let initialPinchDist = 0, initialZoom = 1;
  let isPinching = false;

  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      isPinching = true;
      const t1 = e.touches.item(0), t2 = e.touches.item(1);
      initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      initialZoom = viewZoom;
    } else if (e.touches.length === 1) {
      isPinching = false;
      startX = e.touches.item(0).clientX;
      startY = e.touches.item(0).clientY;
      lastPanX = viewPanX;
      lastPanY = viewPanY;
    }
  }, { passive: false });

  vp.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && initialPinchDist > 0) {
      const t1 = e.touches.item(0), t2 = e.touches.item(1);
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      viewZoom = Math.min(Math.max(initialZoom * (dist / initialPinchDist), 1), 3.5);
      applyPreviewTransform();
    } else if (e.touches.length === 1 && !isPinching && viewZoom > 1) {
      viewPanX = lastPanX + (e.touches.item(0).clientX - startX);
      viewPanY = lastPanY + (e.touches.item(0).clientY - startY);
      applyPreviewTransform();
    }
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    if (!isPinching && viewZoom === 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches.item(0).clientX - startX;
      const dy = e.changedTouches.item(0).clientY - startY;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        navigateColorway(dx < 0 ? 1 : -1);
      }
    }
    if (e.touches.length === 0) isPinching = false;
  }, { passive: true });
})();

// === MODE 1 LAYAR PENUH (FULLSCREEN VIEWER) ===
let fsScale = 1, fsAngle = 0, fsX = 0, fsY = 0;

function openFullPreview() {
  if (generatedCanvases.length === 0) return;
  const modal = document.getElementById('fullScreenModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  fsScale = 1; fsAngle = 0; fsX = 0; fsY = 0;
  syncFullPreviewCanvas();
}

function closeFullPreview() {
  const modal = document.getElementById('fullScreenModal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
}

function syncFullPreviewCanvas() {
  const holder = document.getElementById('fsCanvasHolder');
  const titleEl = document.getElementById('fsColorwayTitle');
  const sel = document.getElementById('colorwaySelect');
  if (!holder || generatedCanvases.length === 0) return;

  holder.innerHTML = '';
  generatedCanvases.forEach(srcCanvas => {
    const clone = document.createElement('canvas');
    clone.width = srcCanvas.width;
    clone.height = srcCanvas.height;
    clone.getContext('2d').drawImage(srcCanvas, 0, 0);
    clone.style.maxWidth = '98vw';
    clone.style.maxHeight = '78vh';
    clone.style.background = '#ffffff';
    clone.style.borderRadius = '4px';
    holder.appendChild(clone);
  });

  if (titleEl) {
    const total = sel && sel.options.length > 0 ? sel.options.length : 1;
    const idx = sel && sel.selectedIndex >= 0 ? sel.selectedIndex + 1 : 1;
    titleEl.textContent = `(${idx}/${total}) ${currentStyleName} - ${currentColorwayName}`;
  }
  applyFsTransform();
}

function applyFsTransform() {
  const holder = document.getElementById('fsCanvasHolder');
  const lbl = document.getElementById('fsZoomText');
  if (!holder) return;
  // Saat diputar 90/270 derajat pada layar HP vertikal, perbesar agar memenuhi tinggi layar
  const fitBoost = (fsAngle % 180 !== 0 && fsScale === 1) ? 1.35 : 1;
  holder.style.transform = `translate(${fsX}px, ${fsY}px) rotate(${fsAngle}deg) scale(${fsScale * fitBoost})`;
  if (lbl) lbl.textContent = Math.round(fsScale * 100) + '%';
}

function fsZoom(delta) {
  fsScale = Math.min(Math.max(fsScale + delta, 1), 4);
  if (fsScale === 1) { fsX = 0; fsY = 0; }
  applyFsTransform();
}

function fsRotate() {
  fsAngle = (fsAngle + 90) % 360;
  fsX = 0; fsY = 0;
  applyFsTransform();
}

function fsReset() {
  fsScale = 1; fsAngle = 0; fsX = 0; fsY = 0;
  applyFsTransform();
}

// Perbarui navigateColorway agar saat mode Layar Penuh aktif ikut berganti
const origNavCw = navigateColorway;
navigateColorway = function(step) {
  origNavCw(step);
  const modal = document.getElementById('fullScreenModal');
  if (modal && modal.style.display === 'flex') {
    fsScale = 1; fsX = 0; fsY = 0;
    syncFullPreviewCanvas();
  }
};

// Otomatis buka layar penuh saat tombol Buat Mini Marker ditekan
const origGenMarker = generateMiniMarker;
generateMiniMarker = function() {
  origGenMarker();
  renderDynamicProcessColors();
  renderDynamicProcessColors();
  if (generatedCanvases.length > 0) openFullPreview();
};

// Gestur sentuhan di dalam Fullscreen Viewport (Pinch-Zoom, Pan & Swipe Kiri/Kanan)
(function initFsTouch() {
  const vp = document.getElementById('fsViewport');
  if (!vp) return;
  let sx = 0, sy = 0, lx = 0, ly = 0, initDist = 0, initSc = 1, pinching = false;

  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinching = true;
      initDist = Math.hypot(e.touches.item(1).clientX - e.touches.item(0).clientX, e.touches.item(1).clientY - e.touches.item(0).clientY);
      initSc = fsScale;
    } else if (e.touches.length === 1) {
      pinching = false;
      sx = e.touches.item(0).clientX;
      sy = e.touches.item(0).clientY;
      lx = fsX; ly = fsY;
    }
  }, { passive: false });

  vp.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && initDist > 0) {
      const dist = Math.hypot(e.touches.item(1).clientX - e.touches.item(0).clientX, e.touches.item(1).clientY - e.touches.item(0).clientY);
      fsScale = Math.min(Math.max(initSc * (dist / initDist), 1), 4);
      applyFsTransform();
    } else if (e.touches.length === 1 && !pinching && fsScale > 1) {
      fsX = lx + (e.touches.item(0).clientX - sx);
      fsY = ly + (e.touches.item(0).clientY - sy);
      applyFsTransform();
    }
  }, { passive: false });

  vp.addEventListener('touchend', e => {
    if (!pinching && fsScale === 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches.item(0).clientX - sx;
      const dy = e.changedTouches.item(0).clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        navigateColorway(dx < 0 ? 1 : -1);
      }
    }
    if (e.touches.length === 0) pinching = false;
  }, { passive: true });
})();

}
