// === AUTO REQUEST STORAGE PERMISSION ===
document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
      const { Filesystem } = window.Capacitor.Plugins;
      const status = await Filesystem.checkPermissions();
      if (status.publicStorage !== "granted") {
        await Filesystem.requestPermissions();
      }
    }
  } catch (e) {
    console.log("Info izin penyimpanan:", e);
  }
});

function appendSyncLog(msg) { console.log("[SYNC LOG]:", msg); }
let parsedPieces = [];
let excelColorways = {};
let bomTemplates = {};
let currentStyleName = "JS0A47JK";
let currentColorwayName = "BUBBLE GUM A5Y";
let generatedCanvases = [];
let currentSwipeIdx = 0;

function switchTab(tab) {
  document.getElementById('tabUpload').classList.toggle('active', tab === 'upload');
  document.getElementById('tabManual').classList.toggle('active', tab === 'manual');
  document.getElementById('panelUpload').classList.toggle('hidden', tab !== 'upload');
  document.getElementById('panelManual').classList.toggle('hidden', tab !== 'manual');
  if (tab === 'manual') {
    renderPieceMappingList();
    renderDynamicProcessColors();
  }
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
      document.getElementById('dxfStatus').innerHTML = '✅ <strong>' + file.name + '</strong> (' + parsedPieces.length + ' komponen unik)';
      if (Object.keys(excelColorways).length > 0) applyColorwayMapping();
      renderPieceMappingList();
      renderDynamicProcessColors();
    } catch (err) {
      alert("Gagal membaca file DXF: " + err.message);
    }
  };
  reader.readAsText(file);
}
function detectProcessFromText(text) {
  const up = text.toUpperCase();
  // Cek jika ada teks langsung memakai tanda hubung '-' seperti AUTOMATION-OCM atau OCM-BORDIR
  const hyphenMatch = up.match(/\b((?:AUTOMATION|AUTO|OCM|BORDIR|EMBROIDERY|HEAT\s*EMBOSSED|EMBOSS|SILKSCREEN|PRINT)(?:\s*-\s*(?:AUTOMATION|AUTO|OCM|BORDIR|EMBROIDERY|HEAT\s*EMBOSSED|EMBOSS|SILKSCREEN|PRINT))+)\b/);
  if (hyphenMatch && hyphenMatch.at(1)) {
    return hyphenMatch.at(1).replace(/\s*-\s*/g, '-').trim();
  }
  // Jika dalam 1 komponen ada beberapa kata kunci proses terpisah, gabungkan dengan '-'
  const found = [];
  if (/AUTOMATION|AUTO\b/.test(up)) found.push('AUTOMATION');
  if (/OCM\b/.test(up)) found.push('OCM');
  if (/BORDIR|EMBROIDERY|EMB\b/.test(up)) found.push('BORDIR');
  if (/HEAT\s*EMBOSS|EMBOSS/.test(up)) found.push('HEAT EMBOSSED');
  if (/SILKSCREEN|SCREEN\s*PRINT/.test(up)) found.push('SILKSCREEN');
  return found.join('-');
}

function isMirroredPoly(polysA, polysB, wA, wB) {
  if (!polysA.at(0) || !polysB.at(0)) return false;
  const ptsA = polysA.at(0).pts, ptsB = polysB.at(0).pts;
  if (ptsA.length !== ptsB.length || ptsA.length < 4) return false;
  let matches = 0;
  ptsA.forEach(pa => {
    if (ptsB.some(pb => Math.abs((wA - pa.x) - pb.x) < 4 && Math.abs(pa.y - pb.y) < 4)) matches++;
  });
  return (matches / ptsA.length) >= 0.75;
}

function samplePolyDense(polygons) {
  const pts = [];
  polygons.forEach(poly => {
    const arr = poly.pts || [];
    for (let i = 0; i < arr.length; i++) {
      const a = arr.at(i);
      pts.push({ x: a.x, y: a.y });
      const b = (i + 1 < arr.length) ? arr.at(i + 1) : (poly.isOuter ? arr.at(0) : null);
      if (b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.min(40, Math.floor(dist / 5)); // titik sampel tiap 5 mm
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
      }
    }
  });
  return pts;
}

function isAxisSymmetric(polygons, width, height, axis) {
  const tolSq = 1.5; // toleransi 1.2 mm
  const samplePts = samplePolyDense(polygons);
  if (samplePts.length === 0) return true;
  const mirroredPts = samplePts.map(pt => ({
    x: axis === "X" ? (width - pt.x) : pt.x,
    y: axis === "Y" ? (height - pt.y) : pt.y
  }));
  for (let i = 0; i < samplePts.length; i++) {
    const pt = samplePts.at(i);
    let matched = false;
    for (let j = 0; j < mirroredPts.length; j++) {
      const m = mirroredPts.at(j);
      const dx = pt.x - m.x;
      const dy = pt.y - m.y;
      if ((dx * dx + dy * dy) <= tolSq) { matched = true; break; }
    }
    if (!matched) return false;
  }
  return true;
}

function isSelfSymmetricPoly(polygons, width, height) {
  if (!polygons || polygons.length === 0) return true;
  return isAxisSymmetric(polygons, width, height, "X") && isAxisSymmetric(polygons, width, height, "Y");
}

function classifyQtyBySymmetry(piece, count) {
  if (count <= 1) return "";
  const isSym = isSelfSymmetricPoly(piece.polygons, piece.width, piece.height);
  if (!isSym) {
    piece.isPairAB = true;
    return count >= 4 ? "Ax2 Bx2" : "A/B";
  } else {
    piece.isPairAB = false;
    return "X" + count;
  }
}

function getBasePairName(name) {
  return name.replace(/[\s_\-]+(L|R|LEFT|RIGHT|A|B|1|2)$/i, '').trim();
}

function getBounds(polysList) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polysList.forEach(poly => poly.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
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
          allPolys.push({ pts: ent.vertices.map(v => ({ x: v.x, y: v.y })) });
        } else if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
          labelTexts.push(ent.text.replace(/\\P/g, ' ').trim());
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
        const fullText = labelTexts.join(' | ').replace(/\s*-\s*/g, '-');
        const cleanName = fullText.replace(/Sewing|Cut|Boundary|Piece|Name[:\s]*/gi, '').replace(/-S_\d+/gi, '').split('|').pop().trim().toUpperCase().substring(0, 26);
        rawPieces.push({
          name: cleanName || blockName.toUpperCase(),
          sizeText: (bounds.height / 10).toFixed(1) + '*' + (bounds.width / 10).toFixed(1),
          rawText: fullText,
          polygons: normPolys,
          width: bounds.width,
          height: bounds.height,
          fabric: 'MA',
          qtyLabel: (() => {
            if (/\b(A\/B|L\/R|PAIR)\b/i.test(fullText)) return 'A/B';
            const mDxfQty = fullText.match(/(?:^|\s|\||-)X\s*([2-8])\b/i);
            if (mDxfQty) {
              const cnt = parseInt(mDxfQty.at(1));
              return isSelfSymmetricPoly(normPolys, bounds.width, bounds.height) ? ('X' + cnt) : (cnt >= 4 ? 'Ax2 Bx2' : 'A/B');
            }
            return '';
          })(),
          processLabel: detectProcessFromText(fullText)
        });
      }
    }
  }
  const uniquePieces = [];
  rawPieces.forEach(p => {
    const baseP = getBasePairName(p.name);
    const isMarkedLR = /[\s_\-]+(L|R|LEFT|RIGHT|A|B)$/i.test(p.name);
    const dup = uniquePieces.find(u => getBasePairName(u.name) === baseP && Math.abs(u.width - p.width) < 4 && Math.abs(u.height - p.height) < 4);
    if (dup) {
      dup.dupCount = (dup.dupCount || 1) + 1;
      dup.secondPolygons = p.polygons;
      if (isMarkedLR || isMirroredPoly(dup.polygons, p.polygons, dup.width, p.width) || dup.qtyLabel === 'A/B') {
        dup.isPairAB = true;
        dup.name = baseP;
        dup.qtyLabel = dup.dupCount >= 4 ? 'Ax2 Bx2' : 'A/B';
      } else if (!dup.isPairAB) {
        dup.qtyLabel = classifyQtyBySymmetry(dup, dup.dupCount);
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
function matchSpreadWithBomFA(spreadMap) {
  const allSpread = Object.values(spreadMap);
  const bomEntries = Object.values(bomTemplates);
  const paired = bomEntries.map(b => {
    const m = allSpread.find(sp => b.cleanColor.includes(sp.cwCode) || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')'));
    return { bom: b, cwCode: m ? m.cwCode : '', faMap: m ? m.faMap : {}, faList: m ? m.faList : [] };
  });

  excelColorways = {};
  for (const [cwKey, sp] of Object.entries(spreadMap)) {
    let chosen = paired.find(p => p.cwCode === sp.cwCode);
    if (!chosen && paired.length > 0) {
      let bestScore = Infinity;
      paired.forEach(cand => {
        if (cand.faList.length === 0) return;
        const score = Math.abs((sp.faMap['MA'] || 0) - (cand.faMap['MA'] || 0)) * 3
                    + Math.abs((sp.faMap['T1'] || 0) - (cand.faMap['T1'] || 0)) * 3
                    + Math.abs((sp.faMap['L2'] || 0) - (cand.faMap['L2'] || 0))
                    + Math.abs(sp.allowedFabrics.length - Object.keys(cand.faMap).length) * 0.05;
        if (score < bestScore) { bestScore = score; chosen = cand; }
      });
    }
    if (!chosen && bomEntries.length > 0) chosen = { bom: bomEntries.at(0), cwCode: 'DEFAULT' };
    sp.pieces = chosen ? JSON.parse(JSON.stringify(chosen.bom.pieces)) : [{ fabric: 'MA', name: 'SPREAD_ONLY', raw: 'SPREAD_ONLY', codes: [], size: '0*0', qty: 1 }];
    const baseSpecs = chosen && chosen.bom && chosen.bom.fabricSpecs ? JSON.parse(JSON.stringify(chosen.bom.fabricSpecs)) : {};
    const spreadSpecs = sp.fabricSpecs ? JSON.parse(JSON.stringify(sp.fabricSpecs)) : {};
    const mergedSpecs = Object.assign({}, baseSpecs, spreadSpecs);

    if (chosen && chosen.cwCode && chosen.cwCode !== sp.cwCode) {
      sp.clonedFrom = chosen.cwCode;
      sp.sheetName = sp.styleNo + ' | Tiru F/A: ' + chosen.cwCode;
      const oldColorName = (chosen.bom.cleanColor || "").toUpperCase();
      // Bersihkan sisa kode warna & nama warna colorway lain pada keterangan fabric yang tidak ada di spreadSpecs
      Object.keys(mergedSpecs).forEach(fab => {
        if (!spreadSpecs[fab]) {
          let desc = String(mergedSpecs[fab] || "");
          if (oldColorName) desc = desc.replace(oldColorName, sp.cleanColor);
          desc = desc.replace(/#[A-Z0-9]{3,6}\s*/g, "").replace(/\((?!WHITE|INTERNAL)[^)]+\)/gi, "(" + sp.cleanColor + ")");
          mergedSpecs[fab] = desc.replace(/\s+/g, " ").trim();
        }
      });
    }
    sp.fabricSpecs = mergedSpecs;
    excelColorways[cwKey] = sp;
  }
  return Object.keys(excelColorways).length > 0;
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
      const targetSheets = workbook.SheetNames.filter(s => /(VAI|FAB)/i.test(s) && !/^(WEB|FORM)/i.test(s.trim()));
      const sheetsToRead = targetSheets.length > 0 ? targetSheets : workbook.SheetNames;
      sheetsToRead.forEach(sheetName => {
        if (/^(WEB|FORM)/i.test(sheetName.trim())) return;
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
        parseBomRows(rows, sheetName.trim());
      });
      const cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      if (cwKeys.length > 0) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        document.getElementById('excelZone').classList.add('loaded');
        document.getElementById('excelStatus').innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Colorway BOM siap)';
        applyColorwayMapping();
      } else {
        alert("Tidak ditemukan tabel komponen fabric (VAI/FAB) pada file BOM ini.");
      }
    } catch (err) {
      alert("Error membaca Excel BOM: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseBomRows(rows, sheetName) {
  const sheetCodeMatch = sheetName.match(/\(([^)]+)\)/);
  const defaultColor = sheetCodeMatch ? sheetCodeMatch.at(1).trim().toUpperCase() : sheetName;
  let cwKey = sheetName, leftFab = 'MA', midFab = 'L2', blockCount = 0;
  let isConsumptionTable = false, pendingColorCode = "", inheritedSpecByCat = {};
  let colMap = { annot: 3, annotEng: 4, cat: 5, qty: 7, size: 8, mat: 9, spec: 10, color: 12 };
  excelColorways[cwKey] = { cleanColor: defaultColor, sheetName, pieces: [], fabricSpecs: {} };

  rows.forEach(row => {
    const lineStr = row.join(' ');
    const jsCode = lineStr.match(/#?(JS[A-Z0-9]{5,10})\b/i);
    if (jsCode && jsCode.at(1)) {
      currentStyleName = jsCode.at(1).toUpperCase();
      const styleInput = document.getElementById('styleNoInput');
      if (styleInput && !styleInput.value) styleInput.value = currentStyleName;
    }
    const catHeaderIdx = row.findIndex(c => String(c || "").trim() === "Category");
    const sizeHeaderIdx = row.findIndex(c => String(c || "").trim() === "Size");
    if (catHeaderIdx !== -1 && sizeHeaderIdx !== -1) {
      isConsumptionTable = true; inheritedSpecByCat = {};
      const annotIdx = row.findIndex(c => String(c || "").trim() === "Annotation");
      const annotEngIdx = row.findIndex(c => String(c || "").trim().startsWith("Annotation(ENG"));
      const qtyIdx = row.findIndex(c => String(c || "").trim() === "Qty");
      const matIdx = row.findIndex(c => String(c || "").trim() === "Material name");
      const specIdx = row.findIndex(c => String(c || "").trim() === "Spec");
      const colorHdrIdx = row.findIndex(c => /^Color\s+/i.test(String(c || "").trim()));
      colMap = {
        annot: annotIdx !== -1 ? annotIdx : 3,
        annotEng: annotEngIdx !== -1 ? annotEngIdx : (annotIdx !== -1 ? annotIdx + 1 : 4),
        cat: catHeaderIdx, qty: qtyIdx !== -1 ? qtyIdx : 7, size: sizeHeaderIdx,
        mat: matIdx !== -1 ? matIdx : 9, spec: specIdx !== -1 ? specIdx : 10, color: colorHdrIdx !== -1 ? colorHdrIdx : 12
      };
      const rawColorHdr = colorHdrIdx !== -1 ? String(row.at(colorHdrIdx) || "").trim() : "";
      const mHdrCode = rawColorHdr.match(/^Color\s+(.+)$/i);
      pendingColorCode = mHdrCode ? mHdrCode.at(1).trim().toUpperCase() : "";
      blockCount++;
      cwKey = blockCount === 1 ? sheetName : (sheetName + " #" + blockCount);
      const initName = pendingColorCode || defaultColor;
      excelColorways[cwKey] = { cleanColor: initName, sheetName: currentStyleName ? `${currentStyleName} (${initName})` : sheetName, pieces: [], fabricSpecs: {} };
      return;
    }
    const colorM = lineStr.match(/\bCOLOR(?:WAY)?\s*:\s*([^,;]+?)(?:DATE|PERSON|PER SON|STYLE|$)/i);
    if (colorM && colorM.at(1) && colorM.at(1).trim() && !/NAME|CODE|WIDTH|FABRIC|SPEC|QTY/i.test(colorM.at(1))) {
      const foundColor = colorM.at(1).trim().replace(/^\d+[\.\)]\s*/, '').toUpperCase();
      blockCount++; cwKey = blockCount === 1 ? sheetName : (sheetName + ' #' + blockCount);
      excelColorways[cwKey] = { cleanColor: foundColor, sheetName, pieces: [], fabricSpecs: {} };
      leftFab = 'MA'; midFab = 'L2'; isConsumptionTable = false;
    }
    if (isConsumptionTable) {
      // Deteksi otomatis pergeseran +1 kolom (seperti pada BOM ZNZ yang memiliki kolom Piece No / merge cell)
      let shift = 0;
      const rawCat0 = String(row.at(colMap.cat) || '').trim().toUpperCase();
      const rawCat1 = String(row.at(colMap.cat + 1) || '').trim().toUpperCase();
      if (!/^(MA|T1|T2|T3|L2|N1)$/.test(rawCat0) && /^(MA|T1|T2|T3|L2|N1)$/.test(rawCat1)) {
        shift = 1;
      }
      const cat = String(row.at(colMap.cat + shift) || '').trim().toUpperCase();
      const sizeStr = String(row.at(colMap.size + shift) || '').trim();
      const shortCode = String(row.at(colMap.annot + shift) || '').trim();
      const engDesc = String(row.at(colMap.annotEng + shift) || '').trim();
      const compRaw = engDesc && engDesc !== "_" ? engDesc : shortCode;
      if (/^(MA|T1|T2|T3|L2|N1)$/.test(cat) && /^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?/.test(sizeStr) && compRaw) {
        const parts = sizeStr.split(/[*xX]/).map(s => s.trim());
        const qty = parseInt(row.at(colMap.qty + shift)) || parseInt(parts.at(2)) || 1;
        const mCode = compRaw.match(/_([A-Z]{1,3}\d{2}[A-Z]?)\b/i) || compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i) || compRaw.match(/\(([^)]+)\)/);
        const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
        if (shortCode && shortCode !== "_") codes.push(shortCode.toUpperCase());
        let cleanName = compRaw.replace(/_[A-Z]{1,3}\d{2}[A-Z]?$/i, '').replace(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?).*$/i, '').trim().toUpperCase();
        const dashSegs = cleanName.split('-').map(s => s.trim()).filter(Boolean);
        if (dashSegs.length >= 3 && shortCode && dashSegs.at(0) === shortCode.toUpperCase()) cleanName = dashSegs.at(1);
        else if (dashSegs.length >= 2 && shortCode && dashSegs.at(0) === shortCode.toUpperCase()) cleanName = dashSegs.slice(1).join(' ');
        const matName = String(row.at(colMap.mat + shift) || '').trim().toUpperCase();
        const matSpec = String(row.at(colMap.spec + shift) || '').trim().toUpperCase();
        const matCol = String(row.at(colMap.color + shift) || '').trim().toUpperCase();
        if (cat === "MA" && matCol && matCol !== "_" && pendingColorCode && (matCol.includes(pendingColorCode) || excelColorways[cwKey].cleanColor === pendingColorCode)) {
          excelColorways[cwKey].cleanColor = matCol;
          excelColorways[cwKey].sheetName = currentStyleName ? `${currentStyleName} (${matCol})` : matCol;
        }
        if (matName && matName !== "_") {
          const fullSpec = (matName + ' ' + matSpec + (matCol && matCol !== "_" ? ' (' + matCol + ')' : '')).replace(/\s+/g, ' ').trim();
          inheritedSpecByCat[cat] = fullSpec; excelColorways[cwKey].fabricSpecs[cat] = fullSpec;
        } else if (inheritedSpecByCat[cat] && !excelColorways[cwKey].fabricSpecs[cat]) {
          excelColorways[cwKey].fabricSpecs[cat] = inheritedSpecByCat[cat];
        }
        excelColorways[cwKey].pieces.push({ fabric: cat, name: cleanName || compRaw.toUpperCase(), raw: (shortCode + " " + compRaw).toUpperCase(), codes, size: parts.at(0) + '*' + parts.at(1), qty });
      }
      return;
    }
    row.forEach((cellVal, colIdx) => {
      const val = String(cellVal || '').trim(), upVal = val.toUpperCase();
      if (colIdx <= 1 && /^(MA|T1|T2|T3|N1)(?:\b|-)/.test(upVal)) leftFab = upVal.match(/^(MA|T1|T2|T3|N1)/).at(1);
      if (colIdx >= 2 && colIdx <= 4 && /^(L2|L1)(?:\b|-)/.test(upVal)) midFab = upVal.match(/^(L2|L1)/).at(1);
      if (/^(MA|T1|T2|T3|N1|L2)$/.test(upVal) && colIdx >= 6) {
        const specName = String(row.at(colIdx + 1) || '').trim().toUpperCase();
        const specColor = String(row.at(colIdx + 3) || '').trim().toUpperCase();
        const specWidth = String(row.at(colIdx + 4) || '').trim().toUpperCase().replace(/^CUT\s+/i, '');
        if (specName) excelColorways[cwKey].fabricSpecs[upVal] = (specName + ' ' + specWidth + (specColor ? ' (' + specColor + ')' : '')).replace(/\s+/g, ' ').trim();
      }
      if (/^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?\s*[*xX]\s*\d+$/.test(val) && colIdx >= 1) {
        const compRaw = String(row.at(colIdx - 1) || '').trim();
        if (!compRaw) return;
        const parts = val.split(/[*xX]/).map(s => s.trim());
        const qty = parseInt(parts.at(2)) || 1;
        const mCode = compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i) || compRaw.match(/\(([^)]+)\)/);
        const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
        const cleanName = compRaw.replace(/\([^)]*\)/g, '').replace(/^[A-Z\+]{2,12}-/, '').trim().toUpperCase();
        excelColorways[cwKey].pieces.push({ fabric: colIdx <= 2 ? leftFab : midFab, name: cleanName, raw: compRaw.toUpperCase(), codes, size: parts.at(0) + '*' + parts.at(1), qty });
      }
    });
  });
}

function applyColorwayMapping() {
  const cwKey = document.getElementById('colorwaySelect')?.value;
  const bom = excelColorways[cwKey];
  if (!bom) return;
  currentColorwayName = bom.cleanColor;
  if (parsedPieces.length === 0 && (!window._cleanDxfPieces || window._cleanDxfPieces.length === 0)) return;

  // Simpan DXF asli bersih saat pertama kali dipetakan, dan selalu reset dari DXF bersih agar antar-colorway tidak menumpuk
  if (!window._cleanDxfPieces || window._cleanDxfPieces.length === 0) {
    window._cleanDxfPieces = JSON.parse(JSON.stringify(parsedPieces));
  }
  parsedPieces = JSON.parse(JSON.stringify(window._cleanDxfPieces));
  const availableBom = bom.pieces.map((b, idx) => ({ ...b, idx, used: false }));
  parsedPieces.forEach(p => {
    const d1 = p.width / 10, d2 = p.height / 10, up = p.rawText.toUpperCase();
    let bestItem = null, bestScore = Infinity;
    availableBom.forEach(b => {
      const [s1, s2] = b.size.split('*').map(Number);
      if (!s1 || !s2) return;
      const minDiff = Math.min(Math.abs(d1 - s1) + Math.abs(d2 - s2), Math.abs(d1 - s2) + Math.abs(d2 - s1));
      if (minDiff <= 2.2) {
        let score = minDiff + (b.used ? 10 : 0);
        if (b.codes && b.codes.some(c => up.includes(c))) score -= 5;
        if (score < bestScore) { bestScore = score; bestItem = b; }
      }
    });
    if (bestItem) {
      bestItem.used = true;
      p.fabric = bestItem.fabric;
      p.name = bestItem.name || p.name;
      p.sizeText = bestItem.size;
      if (bestItem.qty > 1) {
        p.qtyLabel = classifyQtyBySymmetry(p, bestItem.qty);
      } else {
        p.qtyLabel = "";
        p.isPairAB = false;
      }
    }
  });
  // Jika 1 pattern DXF dipakai di >1 fabric pada BOM, buat komponen terpisah untuk tiap fabric yang berbeda
  const extraCrossFabPieces = [];
  const existingFabKeys = new Set(parsedPieces.map(p => `${p.fabric}|${p.name}|${p.sizeText}`));
  availableBom.forEach(b => {
    if (b.used) return;
    const dimP = String(b.size || "").split("*").map(Number);
    const s1 = dimP.at(0), s2 = dimP.at(1);
    if (!s1 || !s2) return;
    const matchDxf = parsedPieces.find(p => {
      if (p.fabric === b.fabric) return false;
      const d1 = p.width / 10, d2 = p.height / 10;
      const minDiff = Math.min(Math.abs(d1 - s1) + Math.abs(d2 - s2), Math.abs(d1 - s2) + Math.abs(d2 - s1));
      return minDiff <= 2.2;
    });
    const uniqueKey = `${b.fabric}|${b.name || (matchDxf && matchDxf.name)}|${b.size}`;
    if (matchDxf && !existingFabKeys.has(uniqueKey)) {
      b.used = true;
      existingFabKeys.add(uniqueKey);
      const clone = JSON.parse(JSON.stringify(matchDxf));
      clone.id = parsedPieces.length + extraCrossFabPieces.length + 1;
      clone.fabric = b.fabric;
      clone.name = b.name || clone.name;
      clone.sizeText = b.size;
      clone.qtyLabel = b.qty > 1 ? classifyQtyBySymmetry(clone, b.qty) : "";
      extraCrossFabPieces.push(clone);
    }
  });
  if (extraCrossFabPieces.length > 0) {
    parsedPieces = parsedPieces.concat(extraCrossFabPieces);
  }

  renderPieceMappingList();
  renderDynamicProcessColors();
}
function updateCustomProcess(idx, rawVal, doRender) {
  const cleanVal = String(rawVal || "").toUpperCase();
  if (parsedPieces.at(idx)) {
    parsedPieces.at(idx).processLabel = cleanVal;
  }
  if (typeof colorwayList !== "undefined" && Array.isArray(colorwayList) && colorwayList.at(activeColorwayIdx)?.pieces?.at(idx)) {
    colorwayList.at(activeColorwayIdx).pieces.at(idx).processLabel = cleanVal;
  }
  renderDynamicProcessColors();
  if (doRender && typeof generateMiniMarker === "function") {
    generateMiniMarker();
  }
}

function updateCustomQty(idx, rawVal, doRender) {
  const cleanVal = String(rawVal || "").trim();
  if (parsedPieces.at(idx)) parsedPieces.at(idx).qtyLabel = cleanVal;
  if (typeof colorwayList !== "undefined" && Array.isArray(colorwayList) && colorwayList.at(activeColorwayIdx)?.pieces?.at(idx)) {
    colorwayList.at(activeColorwayIdx).pieces.at(idx).qtyLabel = cleanVal;
  }
  if (doRender && typeof generateMiniMarker === "function") generateMiniMarker();
}

function handleQtyDropdownChange(idx, val) {
  const wrap = document.getElementById(`customQtyWrap_${idx}`);
  const inp = document.getElementById(`customQtyInp_${idx}`);
  if (val === "__CUSTOM_QTY__") {
    if (wrap) wrap.style.display = "flex";
    if (inp) {
      updateCustomQty(idx, inp.value, false);
      inp.focus();
    }
  } else {
    if (wrap) wrap.style.display = "none";
    updateCustomQty(idx, val, true);
  }
}

function handleProcessDropdownChange(idx, val) {
  const wrap = document.getElementById(`customProcWrap_${idx}`);
  const inp = document.getElementById(`customProcInp_${idx}`);
  if (val === "__CUSTOM__") {
    if (wrap) wrap.style.display = "flex";
    if (inp) {
      parsedPieces.at(idx).processLabel = inp.value.toUpperCase();
      inp.focus();
    }
  } else {
    if (wrap) wrap.style.display = "none";
    updateCustomProcess(idx, val, true);
    return;
  }
  renderDynamicProcessColors();
}

function renderPieceMappingList() {
  const container = document.getElementById('pieceMappingList');
  if (!container || parsedPieces.length === 0) return;
  const fabrics = ['MA', 'T1', 'T2', 'T3', 'L2', 'N1'];
  const processes = ['', 'OCM', 'BORDIR', 'AUTOMATION-OCM', 'OCM-BORDIR', 'AUTOMATION', 'HEAT EMBOSSED', 'SILKSCREEN'];
  const qtys = ['', 'A/B', 'Ax2 Bx2', 'X2', 'X3', 'X4', 'X6'];

  container.innerHTML = parsedPieces.map((p, idx) => {
    const isCustomProc = Boolean(p.processLabel && !processes.includes(p.processLabel));
    const isCustomQty = Boolean(p.qtyLabel && !qtys.includes(p.qtyLabel));
    return `
    <div class="piece-item" style="flex-direction:column; align-items:stretch; gap:6px; padding:8px 0;">
      <div style="display:flex; gap:6px; align-items:center;">
        <input type="text" value="${p.name.replace(/"/g, '&quot;')}" onchange="parsedPieces.at(${idx}).name = this.value.toUpperCase()" placeholder="Nama Pattern" style="flex:2; margin:0; padding:6px 8px; font-size:12px; font-weight:600;" />
        <input type="text" value="${p.sizeText.replace(/"/g, '&quot;')}" onchange="parsedPieces.at(${idx}).sizeText = this.value" placeholder="Ukuran" style="flex:1; margin:0; padding:6px 8px; font-size:12px;" />
        <button type="button" onclick="openQuickPatternEditor(parsedPieces.at(${idx}))" style="background:var(--neon-cyan); color:#07060e; border:none; border-radius:6px; padding:6px 10px; font-size:11px; font-weight:900; cursor:pointer;">✏️ EDIT</button>
      </div>
      <div style="display:flex; gap:6px; justify-content:flex-end;">
        <select onchange="parsedPieces.at(${idx}).fabric = this.value" style="flex:1;">
          ${fabrics.map(f => `<option value="${f}" ${p.fabric === f ? 'selected' : ''}>${f}</option>`).join('')}
        </select>
        <select onchange="handleQtyDropdownChange(${idx}, this.value)" style="flex:1;">
          ${qtys.map(q => `<option value="${q}" ${!isCustomQty && p.qtyLabel === q ? 'selected' : ''}>${q || '1x'}</option>`).join('')}
          <option value="__CUSTOM_QTY__" ${isCustomQty ? 'selected' : ''}>✏️ Manual...</option>
        </select>
        <select onchange="handleProcessDropdownChange(${idx}, this.value)" style="flex:1.4;">
          ${processes.map(pr => `<option value="${pr}" ${!isCustomProc && p.processLabel === pr ? 'selected' : ''}>${pr || 'Proses-'}</option>`).join('')}
          <option value="__CUSTOM__" ${isCustomProc ? 'selected' : ''}>✏️ Tulis Manual...</option>
        </select>
      </div>
      <div id="customQtyWrap_${idx}" style="display:${isCustomQty ? 'flex' : 'none'}; gap:6px; align-items:center;">
        <input type="text" id="customQtyInp_${idx}" value="${isCustomQty ? p.qtyLabel.replace(/"/g, '&quot;') : ''}" oninput="updateCustomQty(${idx}, this.value, false)" onchange="updateCustomQty(${idx}, this.value, true)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();updateCustomQty(${idx}, this.value, true);}" placeholder="Ketik Qty/Pair manual (misal: X8, A/B/C)..." style="flex:1; margin:0; padding:6px 8px; font-size:12px; border:1px solid var(--neon-cyan); color:var(--neon-cyan); font-weight:700;" />
      </div>
      <div id="customProcWrap_${idx}" style="display:${isCustomProc ? 'flex' : 'none'}; gap:6px; align-items:center;">
        <input type="text" id="customProcInp_${idx}" value="${isCustomProc ? p.processLabel.replace(/"/g, '&quot;') : ''}" oninput="updateCustomProcess(${idx}, this.value, false)" onchange="updateCustomProcess(${idx}, this.value, true)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();updateCustomProcess(${idx}, this.value, true);}" placeholder="Ketik nama proses manual (misal: EMBOSS-LOGO)..." style="flex:1; margin:0; padding:6px 8px; font-size:12px; border:1px solid var(--neon-pink); color:var(--neon-yellow); font-weight:700;" />
      </div>
    </div>
  `;
  }).join('');
}

function getSavedProcessColors() {
  try { return JSON.parse(localStorage.getItem('mm_proc_colors') || '{}'); } catch (e) { return {}; }
}

function isTooDarkOrBlack(hex) {
  const c = String(hex || '').replace('#', '').trim();
  if (c.length !== 6) return true;
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  const bright = (r * 299 + g * 587 + b * 114) / 1000;
  return bright < 60 || (Math.max(r, g, b) < 100 && (Math.max(r, g, b) - Math.min(r, g, b)) < 30);
}

function getDefaultColorForProcess(proc) {
  const up = String(proc || '').trim().toUpperCase();
  if (up.includes('BORDIR')) return '#dc2626';
  if (up.includes('OCM')) return '#059669';
  if (up.includes('AUTO')) return '#1d4ed8';
  if (up.includes('EMBOSS')) return '#d97706';
  if (up.includes('SILKSCREEN')) return '#7c3aed';
  const pal = ['#dc2626', '#059669', '#1d4ed8', '#d97706', '#7c3aed', '#db2777', '#0891b2'];
  let h = 0;
  for (let i = 0; i < up.length; i++) h = up.charCodeAt(i) + ((h << 5) - h);
  return pal[Math.abs(h) % pal.length];
}

function getProcessColor(proc) {
  const up = String(proc || '').trim().toUpperCase();
  const chosen = getSavedProcessColors()[up];
  return (chosen && !isTooDarkOrBlack(chosen)) ? chosen : getDefaultColorForProcess(up);
}

function updateProcessColorValue(proc, hexColor) {
  const up = String(proc || '').trim().toUpperCase();
  let finalColor = isTooDarkOrBlack(hexColor) ? getDefaultColorForProcess(up) : hexColor;
  if (isTooDarkOrBlack(hexColor)) alert('Warna hitam atau terlalu gelap dilarang untuk label proses!');
  const saved = getSavedProcessColors();
  saved[up] = finalColor;
  localStorage.setItem('mm_proc_colors', JSON.stringify(saved));
  renderDynamicProcessColors();
  if (generatedCanvases.length > 0) generateMiniMarker();
}

function renderDynamicProcessColors() {
  const listEl = document.getElementById('dynamicProcessColors');
  if (!listEl) return;
  const procSet = new Set();
  parsedPieces.forEach(p => {
    String(p.processLabel || '').toUpperCase().split('-').map(s => s.trim()).filter(Boolean).forEach(x => procSet.add(x));
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
  }).join('');
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
  const sampleBoxW = 1754 - 72;
  const sampleFooterH = 42 + (activeFabrics.length * Math.max(labelSize + 11, 24));
  const sampleBoxH = 1240 - 76 - sampleFooterH - 22;

  // Fungsi pembantu menghitung skor skala maksimal untuk kombinasi (c, r, pages)
  function evaluateGrid(c, r, pg) {
    if (c * r * pg < totalAll) return -1;
    const cW = (sampleBoxW - 24) / c;
    const cH = (sampleBoxH - 18) / r;
    const circR = Math.min(14, cH * 0.075);
    const mW = Math.max(cW - ((circR * 2) + 8) - 38, 20);
    const mH = Math.max(cH - (labelSize + 8) - ((labelSize * 2) + 14), 20);
    if (mW < 28 || mH < 24) return -1;

    const scales = sortedPieces.map(p => {
      const sideBySide = false;
      const nW = sideBySide ? (p.width * 2 + 20) : p.width;
      const sNorm = Math.min(mW / Math.max(nW, 1), mH / Math.max(p.height, 1));
      const rW = sideBySide ? (p.height * 2 + 20) : p.height;
      const sRot = Math.min(mW / Math.max(rW, 1), mH / Math.max(p.width, 1));
      return Math.max(sNorm, sRot);
    }).sort((a, b) => a - b);

    // Gunakan persentil ke-15 terendah agar mayoritas komponen tampil maksimal
    return scales[Math.floor(scales.length * 0.15)] || scales[0] || 0.1;
  }

  let cols = customCols !== 'auto' ? parseInt(customCols) : 6;
  let rowsPerPage = customRows !== 'auto' ? parseInt(customRows) : 4;
  let maxPages = 1;

  if (customCols === 'auto' && customRows === 'auto') {
    let bestScore = -1;
    const maxAllowedPages = totalAll <= 30 ? 1 : (totalAll <= 65 ? 2 : 3);
    for (let pg = 1; pg <= maxAllowedPages; pg++) {
      const targetPerPg = Math.ceil(totalAll / pg);
      for (let c = 4; c <= 9; c++) {
        const r = Math.ceil(targetPerPg / c);
        if (r < 2 || r > 7) continue;
        const sc = evaluateGrid(c, r, pg);
        if (sc > bestScore) {
          bestScore = sc;
          cols = c;
          rowsPerPage = r;
          maxPages = pg;
        }
      }
    }
  } else {
    if (customCols === 'auto') cols = Math.min(9, Math.max(4, Math.ceil(Math.sqrt(totalAll * 1.4))));
    if (customRows === 'auto') rowsPerPage = Math.min(6, Math.max(2, Math.ceil(totalAll / cols)));
    maxPages = Math.min(3, Math.max(1, Math.ceil(totalAll / (cols * rowsPerPage))));
  }

  const perPage = cols * rowsPerPage;
  const pages = [];
  for (let p = 0; p < maxPages; p++) {
    const slice = sortedPieces.slice(p * perPage, (p + 1) * perPage);
    if (slice.length > 0) pages.push(slice);
  }

  const stdCellW = (sampleBoxW - 24) / cols;
  const stdCellH = (sampleBoxH - 18) / Math.max(rowsPerPage, 1);
  const stdCircleR = Math.min(14, stdCellH * 0.075);
  const stdMaxW = Math.max(stdCellW - ((stdCircleR * 2) + 8) - 38, 24);
  const stdMaxH = Math.max(stdCellH - (labelSize + 8) - ((labelSize * 2) + 14), 24);

  const pieceScales = [];
  sortedPieces.forEach(p => {
    const sideBySide = false;
    const normW = sideBySide ? (p.width * 2 + 20) : p.width;
    const scaleNorm = Math.min(stdMaxW / Math.max(normW, 1), stdMaxH / Math.max(p.height, 1));
    const rotW = sideBySide ? (p.height * 2 + 20) : p.height;
    const scaleRot = Math.min(stdMaxW / Math.max(rotW, 1), stdMaxH / Math.max(p.width, 1));

    p.autoRotate90 = scaleRot > scaleNorm * 1.03;
    p.maxAllowedScale = p.autoRotate90 ? scaleRot : scaleNorm;
    pieceScales.push(p.maxAllowedScale);
  });

  pieceScales.sort((a, b) => a - b);
  let globalUniformScale = pieceScales[Math.floor(pieceScales.length * 0.15)] || pieceScales[0] || 0.25;
  if (!isFinite(globalUniformScale) || globalUniformScale <= 0) globalUniformScale = 0.25;

  const container = document.getElementById('markerContainer');
  container.innerHTML = '';
  generatedCanvases = [];

  pages.forEach((pagePieces, pageIdx) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1754;
    canvas.height = 1240;
    canvas.style.marginBottom = '12px';
    canvas.style.cursor = 'pointer';
    canvas.title = 'Ketuk pola untuk mengedit tulisannya';
    canvas._hitBoxes = new Array();
    canvas.addEventListener('click', function(ev) {
      const rect = canvas.getBoundingClientRect();
      const clickX = (ev.clientX - rect.left) * (canvas.width / rect.width);
      const clickY = (ev.clientY - rect.top) * (canvas.height / rect.height);
      const hit = canvas._hitBoxes.find(b => clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h);
      if (hit && typeof openQuickPatternEditor === "function") {
        ev.stopPropagation();
        openQuickPatternEditor(hit.piece);
      }
    });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + titleSize + 'px ' + fontFam;
    ctx.textAlign = 'center';
    ctx.fillText(styleVal + ' (' + currentColorwayName + ')', canvas.width / 2, 48);

    const footerLineH = Math.max(labelSize + 11, 24);
    const footerH = 42 + (activeFabrics.length * footerLineH);
    const boxX = 36, boxY = 76, boxW = canvas.width - 72, boxH = canvas.height - boxY - footerH - 22;

    if (orderVal) {
      ctx.font = 'bold ' + (labelSize + 3) + 'px ' + fontFam;
      ctx.textAlign = 'left';
      ctx.fillText(orderVal, boxX, boxY - 8);
    }
    if (pages.length > 1) {
      ctx.font = 'bold ' + (labelSize + 3) + 'px ' + fontFam;
      ctx.textAlign = 'right';
      ctx.fillText('HAL ' + (pageIdx + 1) + '/' + pages.length, boxX + boxW, boxY - 8);
    }
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    const actualRows = Math.max(rowsPerPage, Math.ceil(pagePieces.length / cols));
    const cellW = (boxW - 24) / cols;
    const cellH = (boxH - 18) / actualRows;

    pagePieces.forEach((piece, idx) => {
      const col = Math.floor(idx / actualRows), row = idx % actualRows;
      const cx = boxX + 12 + col * cellW, cy = boxY + 10 + row * cellH;
      canvas._hitBoxes.push({ x: cx, y: cy, w: cellW, h: cellH, piece });
      const fabNum = piece.itemNumberLabel || String(fabricNumberMap[piece.fabric] || 1);

      const circleR = Math.min(15, cellH * 0.082);
      const topSpace = piece.processLabel ? (labelSize + 10) : 8;
      const bottomSpace = (labelSize * 2) + 16;
      const leftOffset = (circleR * 2) + 8;
      const maxDrawW = Math.max(cellW - leftOffset - 44, 24);
      const maxDrawH = Math.max(cellH - topSpace - bottomSpace, 24);

      const effW = piece.autoRotate90 ? piece.height : piece.width;
      const effH = piece.autoRotate90 ? piece.width : piece.height;
      const drawSideBySide = false;
      const totalDrawW = drawSideBySide ? (effW * 2 + 25) : effW;
      const pairScale = Math.min(globalUniformScale, piece.maxAllowedScale || globalUniformScale);
      const finalW = totalDrawW * pairScale, finalH = effH * pairScale;
      const finalX = cx + leftOffset + (maxDrawW - finalW) / 2;
      const finalY = cy + topSpace + (maxDrawH - finalH) / 2;
      const centerDrawX = finalX + finalW / 2;

      const numCx = Math.max(cx + circleR + 3, finalX - circleR - 5);
      const numCy = Math.max(cy + circleR + 6, finalY + circleR);
      ctx.beginPath();
      ctx.arc(numCx, numCy, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#000000';
      const numScale = String(fabNum).length >= 4 ? 0.78 : 0.92;
      ctx.font = 'bold ' + Math.round(circleR * numScale) + 'px ' + fontFam;
      ctx.textAlign = 'center';
      ctx.fillText(String(fabNum), numCx, numCy + Math.round(circleR * 0.35));

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
          ctx.fillText(pt, curTextX, finalY - 6);
          curTextX += partWidths.at(pIdx);
          if (pIdx < parts.length - 1) {
            ctx.fillStyle = '#64748b';
            ctx.fillText(sep, curTextX, finalY - 6);
            curTextX += sepW;
          }
        });
      }

      const renderPolySet = (polyList, shiftX, mirrorEffW) => {
        polyList.forEach(poly => {
          ctx.beginPath();
          poly.pts.forEach((pt, i) => {
            // Putar titik 90 derajat searah jarum jam jika autoRotate90 aktif
            let rx = piece.autoRotate90 ? (piece.height - pt.y) : pt.x;
            let ry = piece.autoRotate90 ? pt.x : pt.y;
            if (mirrorEffW) rx = mirrorEffW - rx;
            const px = finalX + shiftX + rx * pairScale;
            const py = finalY + ry * pairScale;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
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
        renderPolySet(secondSet, (effW + 25) * pairScale, piece.secondPolygons ? 0 : effW);
      }

      if (piece.qtyLabel) {
        ctx.fillStyle = '#000000';
        ctx.font = 'bold ' + Math.max(labelSize - 2, 10) + 'px ' + fontFam;
        ctx.textAlign = 'left';
        const labelX = Math.min(finalX + finalW + 5, cx + cellW - 36);
        const labelY = Math.max(cy + 16, finalY + 11);
        if (piece.qtyLabel === 'Ax2 Bx2') {
          ctx.fillText('Ax2', labelX, labelY);
          ctx.fillText('Bx2', labelX, labelY + Math.max(labelSize, 12));
        } else {
          ctx.fillText(piece.qtyLabel, labelX, labelY);
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
      T2: 'PU LEATHER 52" (' + currentColorwayName + ')',
      T3: 'NON-WOVEN FABRIC 60" 100G (WHITE)',
      L2: 'POLY 200D SOLUTION DYE EMBOSSED 100% RECYCLED 58" PU (INTERNAL)',
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

  document.getElementById('resultArea').classList.remove('hidden');
  saveToHistory(styleVal + '.dxf', parsedPieces.length, activeFabrics.length);
  renderDynamicProcessColors();
  updateSwipeBarUI();
  openFullPreview();
}
async function saveFileUniversal(fileName, blobOrDataUrl, isDataUrl = false) {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const { Filesystem } = window.Capacitor.Plugins;
      if (!Filesystem) {
        alert("Plugin Filesystem belum aktif. Pastikan build APK terbaru.");
        return null;
      }
      let base64Data = "";
      if (isDataUrl) {
        base64Data = blobOrDataUrl.split(",")[1];
      } else {
        base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blobOrDataUrl);
        });
      }
      try {
        await Filesystem.writeFile({
          path: "Download/" + fileName,
          data: base64Data,
          directory: "EXTERNAL_STORAGE",
          recursive: true
        });
        return "Internal Storage/Download/" + fileName;
      } catch (e1) {
        await Filesystem.writeFile({
          path: "MiniMarker/" + fileName,
          data: base64Data,
          directory: "DOCUMENTS",
          recursive: true
        });
        return "Internal Storage/Documents/MiniMarker/" + fileName;
      }
    } catch (err) {
      alert("Gagal menyimpan file: " + (err.message || err));
      return null;
    }
  } else {
    const link = document.createElement("a");
    link.download = fileName;
    link.href = isDataUrl ? blobOrDataUrl : URL.createObjectURL(blobOrDataUrl);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return fileName;
  }
}

async function exportAllPDF() {
  if (generatedCanvases.length === 0) { alert("Belum ada preview marker yang dibuat!"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  generatedCanvases.forEach((c, i) => {
    if (i > 0) doc.addPage();
    doc.addImage(c.toDataURL('image/png'), 'PNG', 5, 5, 287, 200);
  });
  const fileName = 'MiniMarker_' + currentStyleName + '_' + currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_') + '.pdf';
  const saved = await saveFileUniversal(fileName, doc.output('blob'), false);
  if (saved) alert("✅ PDF berhasil disimpan ke: " + saved);
}

async function exportAllPNG() {
  if (generatedCanvases.length === 0) { alert("Belum ada preview marker yang dibuat!"); return; }
  let lastSaved = null;
  for (let i = 0; i < generatedCanvases.length; i++) {
    const fileName = 'MiniMarker_' + currentStyleName + '_' + currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_') + (generatedCanvases.length > 1 ? '_Hal' + (i + 1) : '') + '.png';
    lastSaved = await saveFileUniversal(fileName, generatedCanvases[i].toDataURL('image/png'), true);
  }
  if (lastSaved) alert("✅ " + generatedCanvases.length + " file PNG berhasil disimpan ke folder Download!");
}

async function saveAllColorwaysBatch() {
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) { alert("Belum ada pola DXF yang dimuat."); return; }
  const orderNo = (document.getElementById('orderNoInput')?.value || currentStyleName || 'ORDER_MARKER').trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
  const cwKeys = Object.keys(excelColorways || {}).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
  const targetKeys = cwKeys.length > 0 ? cwKeys : [currentColorwayName];
  const { jsPDF } = window.jspdf;

  const zip = new JSZip();
  const folder = zip.folder(orderNo);
  for (const cwKey of targetKeys) {
    if (cwKeys.length > 0) { document.getElementById('colorwaySelect').value = cwKey; applyColorwayMapping(); }
    generateMiniMarker();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    generatedCanvases.forEach((c, i) => { if (i > 0) doc.addPage(); doc.addImage(c.toDataURL('image/png'), 'PNG', 5, 5, 287, 200); });
    folder.file('MiniMarker_' + currentStyleName + '_' + currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_') + '.pdf', doc.output('blob'));
  }
  closeFullPreview();
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const saved = await saveFileUniversal(orderNo + '.zip', zipBlob, false);
  if (saved) alert("✅ Selesai! " + targetKeys.length + " Colorway disimpan ke: " + saved);
}

function loadSampleData() {
  currentStyleName = "JS0A47JK";
  currentColorwayName = "BUBBLE GUM A5Y";
  document.getElementById('styleNoInput').value = "JS0A47JK";
  document.getElementById('orderNoInput').value = "KT26JN022";
  const makeRect = (w, h) => [{ pts: [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}], isOuter: true }];
  parsedPieces = [
    { id: 1, name: "FRONT POCKET TOP", sizeText: "9.3*24.5", rawText: "M01", polygons: makeRect(245, 93), width: 245, height: 93, fabric: "MA", qtyLabel: "", processLabel: "" },
    { id: 2, name: "BACK PANEL", sizeText: "45.6*34.6", rawText: "B02a", polygons: makeRect(346, 456), width: 346, height: 456, fabric: "MA", qtyLabel: "", processLabel: "BORDIR" },
    { id: 3, name: "SHOULDER STRAP", sizeText: "47.1*11.3", rawText: "S01a", polygons: makeRect(113, 471), width: 113, height: 471, fabric: "MA", qtyLabel: "Ax2 Bx2", isPairAB: true, processLabel: "AUTOMATION-OCM" },
    { id: 4, name: "FRONT POCKET LINING", sizeText: "30*24.4", rawText: "IP02", polygons: makeRect(244, 300), width: 244, height: 300, fabric: "L2", qtyLabel: "", processLabel: "AUTOMATION" },
    { id: 5, name: "COMPT CASE", sizeText: "43.4*37.6", rawText: "CC", polygons: makeRect(376, 434), width: 376, height: 434, fabric: "L2", qtyLabel: "X2", processLabel: "" },
    { id: 6, name: "BACK NON-WOVEN", sizeText: "45.6*34.6", rawText: "T3", polygons: makeRect(346, 456), width: 346, height: 456, fabric: "T3", qtyLabel: "", processLabel: "" },
    { id: 7, name: "SIDE RIGHT MESH", sizeText: "21.6*24.7", rawText: "M26", polygons: makeRect(247, 216), width: 247, height: 216, fabric: "N1", qtyLabel: "", processLabel: "" }
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
  history = history.filter(h => ((h.orderNo || h.name) + '_' + (h.cw || '')) !== keyId);
  history.unshift({ name, orderNo: orderVal, pieceCount, fabricCount, date: dateStr, pieces: parsedPieces, style: currentStyleName, cw: currentColorwayName });
  localStorage.setItem('mm_history', JSON.stringify(history.slice(0, 25)));
  renderHistory();
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem('mm_history') || '[]');
  const el = document.getElementById('historyList');
  if (!el) return;
  if (history.length === 0) { el.innerHTML = '<div class="card"><div class="card-sub">Belum ada riwayat tersimpan.</div></div>'; return; }
  el.innerHTML = history.map((item, idx) => `<div class="card" onclick="loadFromHistory(${idx})" style="cursor:pointer;"><div class="card-row"><span class="card-title">${item.style || item.name} (${item.cw || ''})</span><span style="font-size:11px;color:var(--muted);">${item.date}</span></div><div class="card-sub">${item.orderNo ? 'Order: ' + item.orderNo + ' · ' : ''}${item.pieceCount} komponen</div></div>`).join('');
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
  const rawOrder = (document.getElementById('orderNoInput')?.value || currentStyleName || 'BACKUP').trim().toUpperCase();
  const orderFolder = rawOrder.replace(/[^A-Z0-9_\-]/g, '_') || 'BACKUP';
  const payload = JSON.stringify({ orderNo: rawOrder, exportedAt: new Date().toISOString(), history: JSON.parse(localStorage.getItem('mm_history') || '[]'), processColors: getSavedProcessColors() }, null, 2);
  const zip = new JSZip();
  zip.folder(orderFolder).file(orderFolder + '.json', payload);
  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  link.download = orderFolder + '_json.zip';
  link.href = URL.createObjectURL(blob);
  link.click();
}

async function restoreData(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  try {
    let jsonText = file.name.toLowerCase().endsWith('.zip') ? await Object.values((await JSZip.loadAsync(file)).files).find(f => !f.dir && f.name.endsWith('.json')).async('text') : await file.text();
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) localStorage.setItem('mm_history', JSON.stringify(parsed));
    else {
      if (parsed.history) localStorage.setItem('mm_history', JSON.stringify(parsed.history));
      if (parsed.processColors) localStorage.setItem('mm_proc_colors', JSON.stringify(parsed.processColors));
      if (parsed.orderNo && document.getElementById('orderNoInput')) document.getElementById('orderNoInput').value = parsed.orderNo;
    }
    renderHistory(); renderDynamicProcessColors();
    alert('Data backup berhasil dipulihkan!');
  } catch (err) { alert('Gagal memulihkan backup: ' + err.message); }
  event.target.value = '';
}

function updateSwipeBarUI() {
  const sel = document.getElementById('colorwaySelect'), bar = document.getElementById('cwSwipeBar'), lbl = document.getElementById('cwSwipeLabel');
  if (!sel || !bar || !lbl) return;
  if (sel.options.length <= 1) { bar.style.display = 'none'; return; }
  currentSwipeIdx = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
  bar.classList.remove('hidden'); bar.style.display = 'flex';
  lbl.textContent = 'Colorway ' + (currentSwipeIdx + 1) + ' / ' + sel.options.length + ' : ' + currentColorwayName;
}

function navigateColorway(step) {
  const sel = document.getElementById('colorwaySelect');
  if (!sel || sel.options.length <= 1) return;
  sel.selectedIndex = (sel.selectedIndex + step + sel.options.length) % sel.options.length;
  applyColorwayMapping();
  generateMiniMarker();
}

function previewAllColorways() { navigateColorway(0); openFullPreview(); }

let fsScale = 1, fsAngle = 0, fsX = 0, fsY = 0;
function openFullPreview() {
  if (generatedCanvases.length === 0) return;
  const modal = document.getElementById('fullScreenModal');
  modal.classList.remove('hidden'); modal.style.display = 'flex';
  fsScale = 1; fsAngle = 0; fsX = 0; fsY = 0;
  const holder = document.getElementById('fsCanvasHolder'), titleEl = document.getElementById('fsColorwayTitle'), sel = document.getElementById('colorwaySelect');
  holder.innerHTML = '';
  generatedCanvases.forEach(src => {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.maxWidth = '98vw'; c.style.maxHeight = '78vh'; c.style.background = '#fff';
    holder.appendChild(c);
  });
  if (titleEl) titleEl.textContent = '(' + ((sel?.selectedIndex >= 0 ? sel.selectedIndex + 1 : 1)) + '/' + (sel?.options.length || 1) + ') ' + currentStyleName + ' - ' + currentColorwayName;
  applyFsTransform();
}
function closeFullPreview() { const m = document.getElementById('fullScreenModal'); m.style.display = 'none'; m.classList.add('hidden'); }
function applyFsTransform() {
  const h = document.getElementById('fsCanvasHolder'), l = document.getElementById('fsZoomText');
  if (!h) return;
  const boost = (fsAngle % 180 !== 0 && fsScale === 1) ? 1.35 : 1;
  h.style.transform = `translate(${fsX}px, ${fsY}px) rotate(${fsAngle}deg) scale(${fsScale * boost})`;
  if (l) l.textContent = Math.round(fsScale * 100) + '%';
}
function fsZoom(d) { fsScale = Math.min(Math.max(fsScale + d, 1), 4); if (fsScale === 1) { fsX = 0; fsY = 0; } applyFsTransform(); }
function fsRotate() { fsAngle = (fsAngle + 90) % 360; fsX = 0; fsY = 0; applyFsTransform(); }
function fsReset() { fsScale = 1; fsAngle = 0; fsX = 0; fsY = 0; applyFsTransform(); }
function adjustPreviewZoom(d) { fsZoom(d); }
function rotatePreviewCanvas() { fsRotate(); }
function resetPreviewTransform() { fsReset(); }

(function initFsTouch() {
  const vp = document.getElementById('fsViewport');
  if (!vp) return;
  let sx = 0, sy = 0, lx = 0, ly = 0, initDist = 0, initSc = 1, pinching = false;
  vp.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { pinching = true; initDist = Math.hypot(e.touches.item(1).clientX - e.touches.item(0).clientX, e.touches.item(1).clientY - e.touches.item(0).clientY); initSc = fsScale; }
    else if (e.touches.length === 1) { pinching = false; sx = e.touches.item(0).clientX; sy = e.touches.item(0).clientY; lx = fsX; ly = fsY; }
  }, { passive: false });
  vp.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && initDist > 0) { const dist = Math.hypot(e.touches.item(1).clientX - e.touches.item(0).clientX, e.touches.item(1).clientY - e.touches.item(0).clientY); fsScale = Math.min(Math.max(initSc * (dist / initDist), 1), 4); applyFsTransform(); }
    else if (e.touches.length === 1 && !pinching && fsScale > 1) { fsX = lx + (e.touches.item(0).clientX - sx); fsY = ly + (e.touches.item(0).clientY - sy); applyFsTransform(); }
  }, { passive: false });
  vp.addEventListener('touchend', e => {
    if (!pinching && fsScale === 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches.item(0).clientX - sx, dy = e.changedTouches.item(0).clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) navigateColorway(dx < 0 ? 1 : -1);
    }
    if (e.touches.length === 0) pinching = false;
  }, { passive: true });
})();

renderHistory();

// === NAVIGASI LAYAR AWAL & MODE MINIMARKER AUTO SYNC ===
let isAutoSyncMode = false;

function openToolMode(mode) {
  isAutoSyncMode = (mode === 'autosync');
  document.body.classList.toggle('autosync-active', isAutoSyncMode);
  document.getElementById('homeSplashScreen').classList.add('hidden');
  document.getElementById('mainAppScreen').classList.remove('hidden');

  const banner = document.getElementById('autoSyncBanner');
  const tabsBar = document.querySelector('.tabs');
  const panelUpload = document.getElementById('panelUpload');
  const panelManual = document.getElementById('panelManual');
  const floatingBar = document.getElementById('floatingActionBar');
  const resultArea = document.getElementById('resultArea');

  if (isAutoSyncMode) {
    if (banner) banner.classList.remove('hidden');
    if (tabsBar) tabsBar.classList.add('hidden');
    if (panelManual) panelManual.classList.add('hidden');
    if (floatingBar) floatingBar.style.display = 'none';

    // Tampilkan panelUpload tapi sembunyikan form inputnya, sisakan resultArea untuk preview hasil sync
    if (panelUpload) {
      panelUpload.classList.remove('hidden');
      Array.from(panelUpload.children).forEach(el => {
        if (el.id !== 'resultArea') el.classList.add('hidden');
      });
    }
    if (resultArea && typeof generatedCanvases !== 'undefined' && generatedCanvases.length > 0) {
      resultArea.classList.remove('hidden');
    }
    const btnMenu2 = document.getElementById('btnGoToMenu2');
    if (btnMenu2) btnMenu2.classList.add('hidden');
  } else {
    const btnMenu2 = document.getElementById('btnGoToMenu2');
    if (btnMenu2) btnMenu2.classList.remove('hidden');
    if (banner) banner.classList.add('hidden');
    if (tabsBar) tabsBar.classList.remove('hidden');
    if (floatingBar) floatingBar.style.display = 'flex';
    if (panelUpload) {
      panelUpload.classList.remove('hidden');
      Array.from(panelUpload.children).forEach(el => {
        if (el.id !== 'resultArea') el.classList.remove('hidden');
      });
    }
    switchTab('upload');
  }
  window.scrollTo(0, 0);
}

function syncMenu1LayoutToPieces(targetPieces) {
  if (!Array.isArray(parsedPieces) || parsedPieces.length === 0 || !Array.isArray(targetPieces)) return;
  const masterMap = new Map();
  parsedPieces.forEach((mp, mIdx) => {
    masterMap.set(mp.name, { mp, mIdx });
    if (mp.id) masterMap.set(mp.id, { mp, mIdx });
  });
  targetPieces.forEach(tp => {
    const found = (tp.id && masterMap.get(tp.id)) || masterMap.get(tp.name);
    if (found) {
      tp.name = found.mp.name;
      tp.sizeText = found.mp.sizeText;
      tp.qtyLabel = found.mp.qtyLabel;
      tp.processLabel = found.mp.processLabel;
      tp.isPairAB = found.mp.isPairAB;
      tp.autoRotate90 = found.mp.autoRotate90;
      tp.width = found.mp.width;
      tp.height = found.mp.height;
      tp.polygons = found.mp.polygons;
      tp.secondPolygons = found.mp.secondPolygons;
      tp.maxAllowedScale = found.mp.maxAllowedScale;
      tp._menu1Order = found.mIdx;
    } else {
      tp._menu1Order = 9999;
    }
  });
  targetPieces.sort((a, b) => (a._menu1Order ?? 9999) - (b._menu1Order ?? 9999));
}

function runAutoSyncOnly() {
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) {
    alert("Unggah file pola (.DXF) terlebih dahulu di Menu 1 sebelum menjalankan Auto Sync!");
    return;
  }
  const cwKeys = Object.keys(excelColorways || {}).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
  if (cwKeys.length > 0) {
    const sel = document.getElementById('colorwaySelect');
    if (sel && !sel.value) {
      sel.value = cwKeys[0];
      applyColorwayMapping();
    }
  }
  Object.values(excelColorways || {}).forEach(cw => {
    if (cw && Array.isArray(cw.pieces)) syncMenu1LayoutToPieces(cw.pieces);
  });
  // Gunakan mesin penyusun generateMiniMarker() yang sama persis dengan Menu 1
  generateMiniMarker();
  const resultArea = document.getElementById('resultArea');
  if (resultArea) resultArea.classList.remove('hidden');
  appendSyncLog("✅ Auto Sync selesai! Penyusunan pola disamakan dengan Menu 1 (" + (cwKeys.length || 1) + " Colorway).");
}

function backToSplash() {
  document.getElementById('mainAppScreen').classList.add('hidden');
  document.getElementById('homeSplashScreen').classList.remove('hidden');
}

async function runAutoSyncNow() {
  if (parsedPieces.length === 0) {
    alert("Unggah file pola (.DXF) terlebih dahulu untuk menjalankan Auto Sync!");
    return;
  }
  generateMiniMarker();
  await saveAllColorwaysBatch();
}


// === SCREENSAVER GRAFFITI NEON & AUTO-IDLE ===
(function initNeonScreensaver() {
  const canvas = document.getElementById('screensaverCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const colors = ['#00f5d4', '#ff007f', '#fee440', '#9b5de5'];
  const shapes = Array.from({ length: 14 }, (_, i) => ({
    x: Math.random() * 400, y: Math.random() * 800,
    vx: (Math.random() - 0.5) * 0.9, vy: (Math.random() - 0.5) * 0.9,
    size: 24 + Math.random() * 38, rot: Math.random() * Math.PI * 2,
    vrot: (Math.random() - 0.5) * 0.015, color: colors[i % colors.length],
    type: i % 3
  }));

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function drawFrame() {
    if (!document.getElementById('homeSplashScreen').classList.contains('hidden')) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      shapes.forEach(s => {
        s.x += s.vx; s.y += s.vy; s.rot += s.vrot;
        if (s.x < -50) s.x = canvas.width + 50;
        if (s.x > canvas.width + 50) s.x = -50;
        if (s.y < -50) s.y = canvas.height + 50;
        if (s.y > canvas.height + 50) s.y = -50;

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.strokeStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        if (s.type === 0) {
          ctx.rect(-s.size / 2, -s.size * 0.35, s.size, s.size * 0.7);
        } else if (s.type === 1) {
          ctx.moveTo(0, -s.size / 2); ctx.lineTo(s.size / 2, s.size / 2); ctx.lineTo(-s.size / 2, s.size / 2); ctx.closePath();
        } else {
          ctx.arc(0, 0, s.size * 0.4, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.restore();
      });
    }
    requestAnimationFrame(drawFrame);
  }
  drawFrame();

  // Otomatis kembali ke Screensaver jika tidak ada sentuhan selama 60 detik
  let idleTimer;
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.getElementById('fullScreenModal')?.style.display !== 'flex') {
        backToSplash();
      }
    }, 60000);
  }
  ['touchstart', 'click', 'keydown'].forEach(ev => window.addEventListener(ev, resetIdleTimer, { passive: true }));
  resetIdleTimer();
})();

// === HANDLER KHUSUS PLANNING SPREAD DI MENU KE-2 (MINIMARKER AUTO SYNC) ===
function handlePlanningSpreadUpload(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames.at(0)], { header: 1, defval: '' });

      if (Object.keys(bomTemplates).length === 0 && Object.keys(excelColorways).length > 0 && !Object.values(excelColorways).at(0).isMasterOrder) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
      }

      const ok = parseMasterOrderCsv(rows);
      if (ok) {
        const cwKeys = Object.keys(excelColorways);
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        document.getElementById('spreadZone').classList.add('loaded');
        document.getElementById('spreadStatus').innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Colorway Planning Spread siap)';
        const menu1Snapshot = JSON.parse(JSON.stringify(parsedPieces));
        cwKeys.forEach(k => {
          if (excelColorways[k] && Array.isArray(excelColorways[k].pieces)) {
            syncMenu1LayoutToPieces(excelColorways[k].pieces);
          }
        });
        applyColorwayMapping();
        if (menu1Snapshot.length > 0) {
          parsedPieces = menu1Snapshot;
        }
        appendSyncLog('📋 Planning Spread dimuat: ' + cwKeys.length + ' Colorway mengikuti susunan Menu 1.');
      } else {
        alert("Format file Planning Spread tidak dikenali (pastikan ada kolom Order No, Style No, Style Color, ItemName&Spec, F/A).");
      }
    } catch (err) {
      alert("Gagal membaca Planning Spread: " + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseMasterOrderCsv(rows) {
  const headerIdx = rows.findIndex(r => r.some(c => /Order\s*No/i.test(String(c))) && r.some(c => /ItemName&Spec/i.test(String(c))));
  if (headerIdx === -1) return false;
  const hdr = rows.at(headerIdx).map(h => String(h || '').trim());
  const idxOrder = hdr.findIndex(h => /^Order\s*No$/i.test(h));
  const idxStyle = hdr.findIndex(h => /^Style\s*No$/i.test(h));
  const idxColorCode = hdr.findIndex(h => /^Style\s*Color$/i.test(h));
  const idxQty = hdr.findIndex(h => /^Style\s*Qty$/i.test(h));
  const idxSpec = hdr.findIndex(h => /ItemName&Spec/i.test(h));
  const idxColName = hdr.findIndex(h => /^ColorName$/i.test(h));
  const idxFA = hdr.findIndex(h => /^F\/?A$/i.test(h));
  const idxPcs = hdr.findIndex(h => /^PCS$/i.test(h));
  const idxKode = hdr.findIndex(h => /^Kode$/i.test(h));

  const targetStyleClean = (currentStyleName || '').replace(/\s*\(.*\)/, '').trim().toUpperCase();
  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 5 && String(r.at(idxStyle) || '').trim());
  const matched = dataRows.filter(r => String(r.at(idxStyle) || '').toUpperCase().includes(targetStyleClean));
  const activeRows = matched.length > 0 ? matched : dataRows;
  if (activeRows.length === 0) return false;

  const firstOrder = String(activeRows.at(0).at(idxOrder) || '').trim().toUpperCase();
  if (firstOrder && document.getElementById('orderNoInput')) document.getElementById('orderNoInput').value = firstOrder;

  const spreadMap = {};
  activeRows.forEach(r => {
    const rawStyle = String(r.at(idxStyle) || '').replace(/\s*\([^)]*\)/g, '').trim().toUpperCase();
    const cwCode = String(r.at(idxColorCode) || '').trim().toUpperCase();
    const spec = String(r.at(idxSpec) || '').trim().toUpperCase();
    const colName = String(r.at(idxColName) || '').trim().toUpperCase();
    const kodeRaw = String(r.at(idxKode) || '').trim().toUpperCase();
    const qtyVal = String(r.at(idxQty) || '').trim();
    const faVal = parseFloat(r.at(idxFA)) || 0;
    const pcsVal = parseInt(r.at(idxPcs)) || 0;
    if (!cwCode || !spec) return;

    const cwKey = rawStyle + '_' + cwCode;
    if (!spreadMap[cwKey]) {
      spreadMap[cwKey] = {
        cwCode, cleanColor: colName.endsWith(cwCode) ? colName : (colName + ' ' + cwCode),
        sheetName: rawStyle + ' (' + qtyVal + ' PCS)', styleNo: rawStyle, styleQty: qtyVal,
        pieces: [], fabricSpecs: {}, fabricPcs: {}, faMap: {}, faList: [], allowedFabrics: [], isMasterOrder: true
      };
    }
    let fabCode = 'MA';
    const mKode = kodeRaw.match(/\b(MA|T1|T2|T3|T5|L2|N[1-7])\b/);
    if (mKode) fabCode = mKode.at(1);
    else if (/NON-WOVEN/i.test(spec)) fabCode = 'T3';
    else if (/200D.*EMBOSSED|SOLUTION DYE/i.test(spec)) fabCode = 'L2';
    else if (/MESH/i.test(spec)) fabCode = 'N1';
    else if (/PU LEATHER|SUEDE/i.test(spec)) fabCode = 'T2';
    else if (/PRINT/i.test(spec)) fabCode = 'MA';
    else if (spreadMap[cwKey].fabricSpecs['MA']) fabCode = 'T1';

    if (colName.endsWith(' ' + cwCode) || colName === cwCode) spreadMap[cwKey].cleanColor = colName;
    spreadMap[cwKey].fabricSpecs[fabCode] = spec + (colName ? ' (' + colName + ')' : '');
    if (pcsVal > 0) spreadMap[cwKey].fabricPcs[fabCode] = pcsVal;
    if (faVal > 0) { spreadMap[cwKey].faMap[fabCode] = faVal; spreadMap[cwKey].faList.push(faVal); }
    if (!spreadMap[cwKey].allowedFabrics.includes(fabCode)) spreadMap[cwKey].allowedFabrics.push(fabCode);
  });
  return matchSpreadWithBomFA(spreadMap);
}

function matchSpreadWithBomFA(spreadMap) {
  const allSpread = Object.values(spreadMap);
  const bomEntries = Object.values(bomTemplates);
  const paired = bomEntries.map(b => {
    const m = allSpread.find(sp => b.cleanColor.includes(sp.cwCode) || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')'));
    return { bom: b, cwCode: m ? m.cwCode : '', faMap: m ? m.faMap : {}, faList: m ? m.faList : [] };
  });

  excelColorways = {};
  for (const [cwKey, sp] of Object.entries(spreadMap)) {
    let chosen = paired.find(p => p.cwCode === sp.cwCode);
    if (!chosen && paired.length > 0) {
      let bestScore = Infinity;
      paired.forEach(cand => {
        if (cand.faList.length === 0) return;
        const score = Math.abs((sp.faMap['MA'] || 0) - (cand.faMap['MA'] || 0)) * 3
                    + Math.abs((sp.faMap['T1'] || 0) - (cand.faMap['T1'] || 0)) * 3
                    + Math.abs((sp.faMap['L2'] || 0) - (cand.faMap['L2'] || 0))
                    + Math.abs(sp.allowedFabrics.length - Object.keys(cand.faMap).length) * 0.05;
        if (score < bestScore) { bestScore = score; chosen = cand; }
      });
    }
    if (!chosen && bomEntries.length > 0) chosen = { bom: bomEntries.at(0), cwCode: 'DEFAULT' };
    sp.pieces = chosen ? JSON.parse(JSON.stringify(chosen.bom.pieces)) : [{ fabric: 'MA', name: 'SPREAD_ONLY', raw: 'SPREAD_ONLY', codes: [], size: '0*0', qty: 1 }];
    const baseSpecs = chosen && chosen.bom && chosen.bom.fabricSpecs ? JSON.parse(JSON.stringify(chosen.bom.fabricSpecs)) : {};
    const spreadSpecs = sp.fabricSpecs ? JSON.parse(JSON.stringify(sp.fabricSpecs)) : {};
    const mergedSpecs = Object.assign({}, baseSpecs, spreadSpecs);

    if (chosen && chosen.cwCode && chosen.cwCode !== sp.cwCode) {
      sp.clonedFrom = chosen.cwCode;
      sp.sheetName = sp.styleNo + ' | Tiru F/A: ' + chosen.cwCode;
      const oldColorName = (chosen.bom.cleanColor || "").toUpperCase();
      // Bersihkan sisa kode warna & nama warna colorway lain pada keterangan fabric yang tidak ada di spreadSpecs
      Object.keys(mergedSpecs).forEach(fab => {
        if (!spreadSpecs[fab]) {
          let desc = String(mergedSpecs[fab] || "");
          if (oldColorName) desc = desc.replace(oldColorName, sp.cleanColor);
          desc = desc.replace(/#[A-Z0-9]{3,6}\s*/g, "").replace(/\((?!WHITE|INTERNAL)[^)]+\)/gi, "(" + sp.cleanColor + ")");
          mergedSpecs[fab] = desc.replace(/\s+/g, " ").trim();
        }
      });
    }
    sp.fabricSpecs = mergedSpecs;
    excelColorways[cwKey] = sp;
  }
  return Object.keys(excelColorways).length > 0;
}


// Auto-update saat Pengaturan Font & Grid A4 dipilih atau setelah tekan Enter
function triggerLiveFontGridUpdate() {
  if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
  if (typeof generateMiniMarker === "function") generateMiniMarker();
}

window.addEventListener("DOMContentLoaded", function() {
  // Dropdown langsung berubah saat opsi dipilih
  ["fontFamilySelect", "colsSelect", "rowsSelect"].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", triggerLiveFontGridUpdate);
  });

  // Input angka ukuran font baru berubah setelah tekan Enter (atau selesai edit)
  ["titleFontSize", "labelFontSize"].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
        triggerLiveFontGridUpdate();
      }
    });
    el.addEventListener("change", triggerLiveFontGridUpdate);
  });
});


function openQuickPatternEditor(pieceObj) {
  let idx = parsedPieces.indexOf(pieceObj);
  if (idx === -1) {
    idx = parsedPieces.findIndex(p => p.id === pieceObj.id && p.name === pieceObj.name);
  }
  if (idx === -1) return;
  const p = parsedPieces.at(idx);
  document.getElementById('qePieceIdx').value = idx;
  document.getElementById('qeName').value = p.name || "";
  document.getElementById('qeSize').value = p.sizeText || "";
  document.getElementById('qeFabric').value = p.fabric || "MA";
  document.getElementById('qeQty').value = p.qtyLabel || "";
  document.getElementById('qeProc').value = p.processLabel || "";

  const modal = document.getElementById('quickEditModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('qeName').focus(), 50);
}

function closeQuickPatternEditor() {
  const modal = document.getElementById('quickEditModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function saveQuickPatternEdit() {
  const idx = parseInt(document.getElementById('qePieceIdx').value);
  if (isNaN(idx) || !parsedPieces.at(idx)) return;
  const p = parsedPieces.at(idx);
  const oldName = p.name;
  const oldId = p.id;
  const scopeEl = document.querySelector('input[name="qeApplyScope"]:checked');
  const applyAll = !scopeEl || scopeEl.value === 'all';

  p.name = document.getElementById('qeName').value.trim().toUpperCase();
  p.sizeText = document.getElementById('qeSize').value.trim();
  p.fabric = document.getElementById('qeFabric').value;
  p.qtyLabel = document.getElementById('qeQty').value.trim().toUpperCase();
  p.processLabel = document.getElementById('qeProc').value.trim().toUpperCase();
  p.isPairAB = (p.qtyLabel === 'A/B' || p.qtyLabel === 'Ax2 Bx2');

  const syncPieceProps = (target) => {
    if (!target) return;
    target.name = p.name;
    target.sizeText = p.sizeText;
    target.size = p.sizeText;
    target.fabric = p.fabric;
    target.qtyLabel = p.qtyLabel;
    target.processLabel = p.processLabel;
    target.isPairAB = p.isPairAB;
  };

  window._cwCustomOverrides = window._cwCustomOverrides || {};
  const curKey = document.getElementById('colorwaySelect')?.value || currentColorwayName || 'DEFAULT';

  if (applyAll) {
    if (typeof colorwayList !== "undefined" && Array.isArray(colorwayList)) {
      colorwayList.forEach(cw => {
        if (cw && Array.isArray(cw.pieces)) {
          const match = (cw.pieces.at(idx) && cw.pieces.at(idx).name === oldName) ? cw.pieces.at(idx) : cw.pieces.find(it => (oldId && it.id === oldId) || it.name === oldName);
          syncPieceProps(match);
        }
      });
    }
    if (typeof excelColorways !== "undefined" && excelColorways) {
      Object.keys(excelColorways).forEach(k => {
        const cwObj = excelColorways[k];
        if (cwObj && Array.isArray(cwObj.pieces)) {
          const match = (cwObj.pieces.at(idx) && cwObj.pieces.at(idx).name === oldName) ? cwObj.pieces.at(idx) : cwObj.pieces.find(it => (oldId && it.id === oldId) || it.name === oldName);
          syncPieceProps(match);
        }
        if (window._cwCustomOverrides[k] && Array.isArray(window._cwCustomOverrides[k])) {
          const matchOv = (window._cwCustomOverrides[k].at(idx) && window._cwCustomOverrides[k].at(idx).name === oldName) ? window._cwCustomOverrides[k].at(idx) : window._cwCustomOverrides[k].find(it => (oldId && it.id === oldId) || it.name === oldName);
          syncPieceProps(matchOv);
        }
      });
    }
    if (Array.isArray(window._cleanDxfPieces)) {
      const matchClean = (window._cleanDxfPieces.at(idx) && window._cleanDxfPieces.at(idx).name === oldName) ? window._cleanDxfPieces.at(idx) : window._cleanDxfPieces.find(it => (oldId && it.id === oldId) || it.name === oldName);
      syncPieceProps(matchClean);
    }
  } else {
    if (typeof colorwayList !== "undefined" && Array.isArray(colorwayList) && colorwayList.at(activeColorwayIdx)?.pieces?.at(idx)) {
      syncPieceProps(colorwayList.at(activeColorwayIdx).pieces.at(idx));
    }
    window._cwCustomOverrides[curKey] = JSON.parse(JSON.stringify(parsedPieces));
  }

  closeQuickPatternEditor();
  if (typeof renderPieceMappingList === "function") renderPieceMappingList();
  if (typeof renderDynamicProcessColors === "function") renderDynamicProcessColors();

  // Cek apakah sedang membuka mode Preview 1 Layar Penuh
  const fsModal = document.getElementById("fullScreenModal");
  const isFsOpen = fsModal && !fsModal.classList.contains("hidden") && fsModal.style.display !== "none";
  if (typeof generateMiniMarker === "function") generateMiniMarker();
  if (isFsOpen && typeof openFullPreview === "function") {
    openFullPreview();
  }
}



document.addEventListener("click", function(ev) {
  const target = ev.target;
  if (!target) return;
  const fsContainer = target.closest("#fsCanvasHolder, #fullScreenModal");
  if (!fsContainer || typeof generatedCanvases === "undefined" || generatedCanvases.length === 0) return;

  const mediaEl = (target.tagName === "IMG" || target.tagName === "CANVAS") ? target : fsContainer.querySelector("img, canvas");
  if (!mediaEl) return;

  const allMedia = Array.from(fsContainer.querySelectorAll("img, canvas"));
  const pageIdx = allMedia.indexOf(mediaEl);
  const srcCanvas = generatedCanvases.at(pageIdx !== -1 ? pageIdx : 0);
  if (!srcCanvas || !srcCanvas._hitBoxes) return;

  const rect = mediaEl.getBoundingClientRect();
  const clickX = (ev.clientX - rect.left) * (srcCanvas.width / rect.width);
  const clickY = (ev.clientY - rect.top) * (srcCanvas.height / rect.height);
  const hit = srcCanvas._hitBoxes.find(b => clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h);
  if (hit && typeof openQuickPatternEditor === "function") {
    ev.preventDefault();
    ev.stopPropagation();
    openQuickPatternEditor(hit.piece);
  }
}, true);


// === AUTO-PREVIEW JEDA 2 DETIK & SIMPAN PERUBAHAN (COLOR INI VS SEMUA COLOR) ===
let _autoPreview2sTimer = null;
window._cwCustomOverrides = window._cwCustomOverrides || {};

function renderPreviewSilent() {
  if (typeof parsedPieces === "undefined" || parsedPieces.length === 0) return;
  const fsModal = document.getElementById("fullScreenModal");
  const isFsOpen = fsModal && !fsModal.classList.contains("hidden") && fsModal.style.display !== "none";
  const origOpenFs = window.openFullPreview;
  if (!isFsOpen && typeof origOpenFs === "function") {
    // Jangan paksa buka layar penuh jika user sedang mengetik di form edit
    window.openFullPreview = function() {};
  }
  try {
    if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
    if (typeof generateMiniMarker === "function") generateMiniMarker();
  } finally {
    if (origOpenFs) window.openFullPreview = origOpenFs;
  }
}

function scheduleAutoPreview2s() {
  clearTimeout(_autoPreview2sTimer);
  _autoPreview2sTimer = setTimeout(function() {
    renderPreviewSilent();
  }, 2000);
}

// Dengarkan setiap ketikan atau perubahan input di seluruh panel editor (jeda 2 detik)
document.addEventListener("input", function(ev) {
  const t = ev.target;
  if (!t || t.type === "file") return;
  if (t.closest("#panelUpload, #panelManual, #quickEditModal")) {
    scheduleAutoPreview2s();
  }
});

document.addEventListener("change", function(ev) {
  const t = ev.target;
  if (!t || t.type === "file" || t.id === "colorwaySelect") return;
  if (t.closest("#panelUpload, #panelManual, #quickEditModal")) {
    scheduleAutoPreview2s();
  }
});

function openSaveScopeModal() {
  const m = document.getElementById("saveScopeModal");
  if (!m) return;
  m.classList.remove("hidden");
  m.style.display = "flex";
}

function closeSaveScopeModal() {
  const m = document.getElementById("saveScopeModal");
  if (!m) return;
  m.classList.add("hidden");
  m.style.display = "none";
}

function applySaveWithScope(scope) {
  closeSaveScopeModal();
  if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);

  const curKey = document.getElementById("colorwaySelect")?.value || currentColorwayName || "DEFAULT";
  const snapshotPieces = JSON.parse(JSON.stringify(parsedPieces || []));

  if (scope === "current") {
    window._cwCustomOverrides[curKey] = snapshotPieces;
    if (excelColorways && excelColorways[curKey]) {
      excelColorways[curKey].customPieces = snapshotPieces;
    }
    renderPreviewSilent();
    alert("✅ Perubahan disimpan khusus untuk colorway: " + (currentColorwayName || curKey));
  } else if (scope === "all") {
    // Terapkan seluruh editan ke semua colorway yang ada
    window._cleanDxfPieces = JSON.parse(JSON.stringify(snapshotPieces));
    if (excelColorways && typeof excelColorways === "object") {
      Object.keys(excelColorways).forEach(k => {
        window._cwCustomOverrides[k] = JSON.parse(JSON.stringify(snapshotPieces));
        excelColorways[k].customPieces = JSON.parse(JSON.stringify(snapshotPieces));
        // Sinkronkan juga aturan pattern ke template BOM colorway lain
        if (Array.isArray(excelColorways[k].pieces)) {
          snapshotPieces.forEach((sp, idx) => {
            if (excelColorways[k].pieces[idx]) {
              excelColorways[k].pieces[idx].name = sp.name;
              excelColorways[k].pieces[idx].size = sp.sizeText;
              excelColorways[k].pieces[idx].fabric = sp.fabric;
            }
          });
        }
      });
    }
    renderPreviewSilent();
    alert("✅ Semua perubahan berhasil diterapkan ke SELURUH Colorway!");
  }
}

// Pastikan saat berpindah colorway, hasil simpanan khusus colorway tersebut tetap terjaga
if (typeof applyColorwayMapping === "function" && !window._wrappedApplyCwMapping) {
  window._wrappedApplyCwMapping = true;
  const _origApplyCw = applyColorwayMapping;
  applyColorwayMapping = function() {
    _origApplyCw.apply(this, arguments);
    const cwKey = document.getElementById("colorwaySelect")?.value;
    if (cwKey && window._cwCustomOverrides && window._cwCustomOverrides[cwKey]) {
      parsedPieces = JSON.parse(JSON.stringify(window._cwCustomOverrides[cwKey]));
      if (typeof renderPieceMappingList === "function") renderPieceMappingList();
      if (typeof renderDynamicProcessColors === "function") renderDynamicProcessColors();
    }
  };
}
