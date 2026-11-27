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
function detectProcessFromText(text, excludeName) {
  const up = String(text || '').toUpperCase();
  const skipName = String(excludeName || '').toUpperCase().trim();
  const found = [];

  // 1. Cek setiap segmen teks terpisah di dalam blok DXF (dipisah oleh '|')
  const segments = up.split('|').map(s => s.trim()).filter(Boolean);
  segments.forEach(seg => {
    // Abaikan teks metadata DXF biasa (nama piece, qty, arah serat, fabric, ukuran, kode file)
    if (skipName && seg === skipName) return;
    if (/^(SEWING|CUT|BOUNDARY|PIECE|NAME|RVS|REVERSE|GRAIN|GRAINLINE|FOLD|MIRROR|PAIR|L\/R|A\/B|ALL\s*SIZE|SIZE)$/i.test(seg)) return;
    if (/^(MA|T1|T2|T3|L1|L2|N1|L|R|A|B)$/i.test(seg)) return;
    if (/^(\d+\s*[X*]|[X*]\s*\d+|\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?)/.test(seg)) return;
    if (/-S_\d+$/.test(seg) || /^JS[A-Z0-9]{4,}/i.test(seg) || seg.length < 2 || seg.length > 28) return;
    // Ambil apapun nama proses luar line yang tertulis (PREPARING, OCM, BORDIR, LASER, QUILTING, dll.)
    if (/^[A-Z][A-Z0-9\s\-\/]{1,26}$/.test(seg) && !found.includes(seg)) {
      found.push(seg.replace(/\s*-\s*/g, '-'));
    }
  });

  // 2. Cadangan: cek kata kunci proses jika tidak tertulis sebagai segmen terpisah
  if (found.length === 0) {
    if (/PREPARING|PREP\b/.test(up)) found.push('PREPARING');
    if (/AUTOMATION|AUTO\b/.test(up)) found.push('AUTOMATION');
    if (/OCM\b/.test(up)) found.push('OCM');
    if (/BORDIR|EMBROIDERY|EMB\b/.test(up)) found.push('BORDIR');
    if (/HEAT\s*EMBOSS|EMBOSS/.test(up)) found.push('HEAT EMBOSSED');
    if (/SILKSCREEN|SCREEN\s*PRINT/.test(up)) found.push('SILKSCREEN');
  }
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

function extractEntitySegments(ent) {
  const segs = [];
  if ((ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') && ent.vertices && ent.vertices.length > 1) {
    const pts = ent.vertices.map(v => ({ x: v.x, y: v.y }));
    if (ent.shape && pts.length > 2) pts.push({ x: pts.at(0).x, y: pts.at(0).y });
    segs.push(pts);
  } else if (ent.type === 'LINE' && ent.vertices && ent.vertices.length === 2) {
    segs.push([{ x: ent.vertices.at(0).x, y: ent.vertices.at(0).y }, { x: ent.vertices.at(1).x, y: ent.vertices.at(1).y }]);
  } else if (ent.type === 'ARC' && ent.center && typeof ent.radius === 'number') {
    const startA = (ent.startAngle || 0) * Math.PI / 180;
    let endA = (ent.endAngle || 0) * Math.PI / 180;
    if (endA <= startA) endA += Math.PI * 2;
    const steps = Math.max(8, Math.ceil((endA - startA) / (Math.PI / 18)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = startA + ((endA - startA) * i / steps);
      pts.push({ x: ent.center.x + ent.radius * Math.cos(a), y: ent.center.y + ent.radius * Math.sin(a) });
    }
    segs.push(pts);
  } else if (ent.type === 'SPLINE') {
    const rawPts = (ent.fitPoints && ent.fitPoints.length > 1) ? ent.fitPoints : ent.controlPoints;
    if (rawPts && rawPts.length > 1) {
      segs.push(rawPts.map(v => ({ x: v.x, y: v.y })));
    }
  }
  return segs;
}

function chainContours(segList, tol = 1.2) {
  const pool = segList.map(pts => ({ pts: [...pts], used: false })).filter(s => s.pts.length >= 2);
  const chains = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  for (let i = 0; i < pool.length; i++) {
    if (pool.at(i).used) continue;
    pool.at(i).used = true;
    let chain = [...pool.at(i).pts];
    let extended = true;
    while (extended) {
      extended = false;
      const head = chain.at(0);
      const tail = chain.at(-1);
      if (chain.length > 3 && dist(head, tail) <= tol) break;
      for (let j = 0; j < pool.length; j++) {
        if (pool.at(j).used) continue;
        const cand = pool.at(j).pts;
        const cHead = cand.at(0);
        const cTail = cand.at(-1);
        if (dist(tail, cHead) <= tol) {
          chain.push(...cand.slice(1));
          pool.at(j).used = true;
          extended = true;
          break;
        } else if (dist(tail, cTail) <= tol) {
          chain.push(...[...cand].reverse().slice(1));
          pool.at(j).used = true;
          extended = true;
          break;
        } else if (dist(head, cTail) <= tol) {
          chain = [...cand.slice(0, -1), ...chain];
          pool.at(j).used = true;
          extended = true;
          break;
        } else if (dist(head, cHead) <= tol) {
          chain = [...[...cand].reverse().slice(0, -1), ...chain];
          pool.at(j).used = true;
          extended = true;
          break;
        }
      }
    }
    chains.push({ pts: chain });
  }
  return chains;
}

function extractPiecesFromDxf(dxf) {
  const rawPieces = [];
  if (dxf.blocks && Object.keys(dxf.blocks).length > 0) {
    for (const [blockName, block] of Object.entries(dxf.blocks)) {
      if (blockName.startsWith('*')) continue;
      const rawSegs = [];
      let labelTexts = [blockName];
      (block.entities || []).forEach(ent => {
        if ((ent.type === 'TEXT' || ent.type === 'MTEXT') && ent.text) {
          labelTexts.push(ent.text.replace(/\\P/g, ' ').trim());
        } else {
          extractEntitySegments(ent).forEach(s => rawSegs.push(s));
        }
      });
      const allPolys = chainContours(rawSegs, 1.2);
      if (allPolys.length > 0) {
        const bounds = getBounds(allPolys.map(p => p.pts));
        if (bounds.width < 5 && bounds.height < 5) continue;
        const mainDiag = Math.hypot(bounds.width, bounds.height);
        let maxDiag = 0, outerIdx = 0;
        const polyDiags = allPolys.map((p, idx) => {
          const b = getBounds([p.pts]);
          const diag = Math.hypot(b.width, b.height);
          if (diag > maxDiag) { maxDiag = diag; outerIdx = idx; }
          return diag;
        });
        const normPolys = allPolys
          .map((p, idx) => {
            const cleanPts = [];
            p.pts.forEach(pt => {
              const nx = pt.x - bounds.minX, ny = bounds.maxY - pt.y;
              if (cleanPts.length === 0 || Math.hypot(nx - cleanPts.at(-1).x, ny - cleanPts.at(-1).y) >= 0.8) {
                cleanPts.push({ x: nx, y: ny });
              }
            });
            const isClosed = cleanPts.length > 3 && Math.hypot(cleanPts.at(0).x - cleanPts.at(-1).x, cleanPts.at(0).y - cleanPts.at(-1).y) <= 2.0;
            return { pts: cleanPts, isOuter: idx === outerIdx, isClosed };
          })
          .filter(p => p.pts.length >= 2 && (p.isOuter || getBounds([p.pts]).width >= 3 || getBounds([p.pts]).height >= 3));
        const fullText = labelTexts.join(' | ').replace(/\s*-\s*/g, '-');
        const cleanName = fullText.replace(/Sewing|Cut|Boundary|Piece|Name[:\s]*/gi, '').replace(/-S_\d+/gi, '').split('|').pop().trim().toUpperCase().substring(0, 26);
        rawPieces.push({
          name: cleanName || blockName.toUpperCase(),
          sizeText: (() => {
            const mAnn = String(fullText || '').match(/ANNOTATION\s*:\s*([^|\n\r]+)/i);
            const annStr = mAnn ? mAnn.at(1) : String(fullText || '');
            const twoSizes = [...annStr.matchAll(/(\d+(?:\.\d+)?)\s*[*xX]\s*(\d+(?:\.\d+)?)/g)].map(m => m.at(1) + '*' + m.at(2));
            return twoSizes.length >= 2 ? twoSizes.join(' + ') : ((bounds.height / 10).toFixed(1) + '*' + (bounds.width / 10).toFixed(1));
          })(),
          rawText: fullText,
          polygons: normPolys,
          width: bounds.width,
          height: bounds.height,
          catSize: (() => {
            const mCat = String(fullText || '').match(/CATEGORY\s*:\s*(\d+(?:\.\d+)?\s*[*xX]\s*\d+(?:\.\d+)?)/i);
            return mCat ? mCat.at(1).replace(/[xX]/g, '*').replace(/\s+/g, '') : '';
          })(),
          fabric: (() => {
            const mAnn = String(fullText || '').match(/ANNOTATION\s*:\s*([^|\n\r]+)/i);
            const targetStr = mAnn ? mAnn.at(1) : String(fullText || '');
            const mFab = targetStr.match(/(?:^|[^A-Z0-9])(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)(?=$|[^A-Z0-9]|\*)/i)
              || String(fullText || '').match(/(?:^|[^A-Z0-9])(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)(?=$|[^A-Z0-9]|\*)/i);
            if (!mFab) return 'MA';
            const f = mFab.at(1).toUpperCase();
            if (f === 'L1') return 'L2';
            if (f === 'C1') return 'M1';
            return f;
          })(),
          qtyLabel: (() => {
            if (/\b(A\/B|L\/R|PAIR)\b/i.test(fullText)) return 'A/B';
            const mDxfQty = fullText.match(/(?:^|\s|\||-)X\s*([2-8])\b/i);
            if (mDxfQty) {
              const cnt = parseInt(mDxfQty.at(1));
              return isSelfSymmetricPoly(normPolys, bounds.width, bounds.height) ? ('X' + cnt) : (cnt >= 4 ? 'Ax2 Bx2' : 'A/B');
            }
            return '';
          })(),
          processLabel: detectProcessFromText(fullText, cleanName)
        });
      }
    }
  }
  const uniquePieces = [];
  const normBaseKey = (s) => getBasePairName(String(s || '')).replace(/[\s_\-]+(?:\d+|L|R|LEFT|RIGHT|A|B|1|2|3|4)$/i, '').trim();
  rawPieces.forEach(p => {
    const baseP = normBaseKey(p.name);
    const isMarkedLR = /[\s_\-]+(L|R|LEFT|RIGHT|A|B)$/i.test(p.name);
    const dup = uniquePieces.find(u => {
      const sameDim = (Math.abs(u.width - p.width) < 2.5 && Math.abs(u.height - p.height) < 2.5)
                   || (Math.abs(u.width - p.height) < 2.5 && Math.abs(u.height - p.width) < 2.5);
      return sameDim && normBaseKey(u.name) === baseP;
    });
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
    const normCol = (s) => String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const m = allSpread.find(sp =>
      b.cleanColor.includes(sp.cwCode)
      || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')')
      || (sp.styleColorName && normCol(b.cleanColor) === normCol(sp.styleColorName))
    );
    return { jacji: b, cwCode: m ? m.cwCode : '', faMap: m ? m.faMap : {}, faList: m ? m.faList : [] };
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
    if (!chosen && bomEntries.length > 0) chosen = { jacji: bomEntries.at(0), cwCode: 'DEFAULT' };
    sp.pieces = chosen ? JSON.parse(JSON.stringify(chosen.jacji.pieces)) : [{ fabric: 'MA', name: 'SPREAD_ONLY', raw: 'SPREAD_ONLY', codes: [], size: '0*0', qty: 1 }];
    const baseSpecs = chosen && chosen.jacji && chosen.jacji.fabricSpecs ? JSON.parse(JSON.stringify(chosen.jacji.fabricSpecs)) : {};
    const spreadSpecs = sp.fabricSpecs ? JSON.parse(JSON.stringify(sp.fabricSpecs)) : {};
    const mergedSpecs = Object.assign({}, baseSpecs, spreadSpecs);

    if (chosen && chosen.cwCode && chosen.cwCode !== sp.cwCode) {
      sp.clonedFrom = chosen.cwCode;
      sp.sheetName = sp.styleNo + ' | Tiru F/A: ' + chosen.cwCode;
      const oldColorName = (chosen.jacji.cleanColor || "").toUpperCase();
      // Bersihkan sisa kode warna & nama warna color lain pada keterangan fabric yang tidak ada di spreadSpecs
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

function normalizeBomFabricCode(rawCat) {
  const up = String(rawCat || '').trim().toUpperCase();
  if (/^MA(?:-|$)/.test(up)) return 'MA';
  if (/^T1(?:-|$)/.test(up)) return 'T1';
  if (/^T2(?:-|$)/.test(up)) return 'T2';
  if (/^T3(?:-|$)/.test(up)) return 'T3';
  if (/^(?:L1|L2|L3)(?:-|$)/.test(up)) return 'L2';
  if (/^(?:N1|N2|N3)(?:-|$)/.test(up)) return 'N1';
  return '';
}

function parseBomZNZFormat(workbook) {
  let added = 0;
  let styleTitle = "";
  workbook.SheetNames.forEach(sheetName => {
    if (/^(WEB|FORM)/i.test(sheetName.trim())) return;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    let hdrMap = null;
    let colorHeaderName = '';
    let horizontalColorCols = []; // Untuk format JACJI REI (kolom warna berjajar ke samping)
    let blockIdx = 0;
    let currentCwKey = sheetName;
    let inheritedMatByCat = {};

    rows.forEach(row => {
      const lineStr = row.join(' ');
      const mStyleJs = lineStr.match(/#?(JS[A-Z0-9]{5,10})\b/i);
      const mStyleRei = lineStr.match(/STYLE\s*NO\s*:\s*[^#]*#([A-Z0-9\-\s]+?)(?:DATE|$)/i);
      if (mStyleJs && mStyleJs.at(1)) {
        styleTitle = mStyleJs.at(1).toUpperCase();
      } else if (mStyleRei && mStyleRei.at(1)) {
        styleTitle = mStyleRei.at(1).trim().toUpperCase();
      }
      if (styleTitle && document.getElementById('styleNoInput') && !document.getElementById('styleNoInput').value) {
        document.getElementById('styleNoInput').value = styleTitle;
      }

      const catIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'category');
      const sizeIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'size');
      if (catIdx !== -1 && sizeIdx !== -1) {
        blockIdx++;
        inheritedMatByCat = {};
        const annotIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'annotation');
        const annotEngIdx = row.findIndex(c => String(c || '').trim().toLowerCase().startsWith('annotation(eng'));
        const qtyIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'qty');
        const matIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'material name');
        const specIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'spec');
        const remarkIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'remark');
        const lengthIdx = row.findIndex(c => /^length$/i.test(String(c || '').trim()));
        const colIdx = row.findIndex(c => /^color\s+/i.test(String(c || '').trim()));

        hdrMap = {
          annot: annotIdx,
          annotEng: annotEngIdx !== -1 ? annotEngIdx : (annotIdx !== -1 ? annotIdx + 1 : 1),
          cat: catIdx,
          qty: qtyIdx !== -1 ? qtyIdx : 4,
          size: sizeIdx,
          mat: matIdx !== -1 ? matIdx : 6,
          spec: specIdx !== -1 ? specIdx : 7,
          color: colIdx !== -1 ? colIdx : 12
        };

        // Cek apakah format REI (banyak kolom nama warna antara Remark dan LENGTH)
        horizontalColorCols = [];
        if (colIdx === -1 && remarkIdx !== -1 && lengthIdx > remarkIdx + 1) {
          for (let c = remarkIdx + 1; c < lengthIdx; c++) {
            const cTitle = String(row.at(c) || '').trim().toUpperCase();
            if (cTitle && cTitle !== 'UNIT') horizontalColorCols.push({ idx: c, name: cTitle });
          }
        }

        const rawHdr = colIdx !== -1 ? String(row.at(colIdx) || '').trim() : '';
        const mCol = rawHdr.match(/^Color\s+(.+)$/i);
        colorHeaderName = mCol ? mCol.at(1).trim().toUpperCase() : sheetName.replace(/^FAB-/i, '').trim().toUpperCase();
        currentCwKey = blockIdx === 1 ? sheetName : `${sheetName} #${blockIdx}`;
        return;
      }

      if (!hdrMap) return;
      const rawCat = String(row.at(hdrMap.cat) || '').trim().toUpperCase();
      const normFab = normalizeBomFabricCode(rawCat);
      const sizeStr = String(row.at(hdrMap.size) || '').trim();
      if (!normFab || !/^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?/.test(sizeStr)) return;

      const shortCode = hdrMap.annot !== -1 ? String(row.at(hdrMap.annot) || '').trim().toUpperCase() : '';
      const engDesc = String(row.at(hdrMap.annotEng) || '').trim();
      const compRaw = engDesc && engDesc !== '_' ? engDesc : shortCode;
      if (!compRaw) return;

      const parts = sizeStr.split(/[*xX]/).map(s => s.trim());
      const qty = Math.round(parseFloat(row.at(hdrMap.qty))) || parseInt(parts.at(2)) || 1;
      const mCode = compRaw.match(/_([A-Z]{1,3}\d{2}[A-Z]?)\b/i) || compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i);
      const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
      if (shortCode && shortCode !== '_') codes.push(shortCode);

      let cleanName = compRaw
        .replace(/_[A-Z]{1,3}\d{2}[A-Z]?$/i, '')
        .replace(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?).*$/i, '')
        .trim().toUpperCase();
      const segs = cleanName.split('-').map(s => s.trim()).filter(Boolean);
      if (segs.length >= 2 && (shortCode ? segs.at(0) === shortCode : segs.at(0).length <= 6)) {
        if (shortCode && segs.at(0) === shortCode) cleanName = segs.at(1);
      }

      const matName = String(row.at(hdrMap.mat) || '').trim().toUpperCase();
      const matSpec = String(row.at(hdrMap.spec) || '').trim().toUpperCase();
      if (matName && matName !== '_' && !/^GIỐNG/i.test(matName)) {
        inheritedMatByCat[normFab] = { matName, matSpec };
      }

      // Cabang A: Format JACJI REI (Multi-Color berjajar ke samping: BLACK, SHADOW BAY, OAK BROWN, dst.)
      if (horizontalColorCols.length > 0) {
        horizontalColorCols.forEach(cCol => {
          const cwKeyRei = `${sheetName}_${cCol.name}`;
          if (!excelColorways[cwKeyRei]) {
            excelColorways[cwKeyRei] = {
              cleanColor: cCol.name,
              sheetName: styleTitle ? `${styleTitle} (${cCol.name})` : cCol.name,
              pieces: [],
              fabricSpecs: {}
            };
          }
          const cellColorVal = String(row.at(cCol.idx) || '').trim().toUpperCase() || cCol.name;
          const inh = inheritedMatByCat[normFab];
          if (inh && !excelColorways[cwKeyRei].fabricSpecs[normFab]) {
            excelColorways[cwKeyRei].fabricSpecs[normFab] = `${inh.matName} ${inh.matSpec} (${cellColorVal})`.replace(/\s+/g, ' ').trim();
          }
          excelColorways[cwKeyRei].pieces.push({
            fabric: normFab,
            name: cleanName || compRaw.toUpperCase(),
            raw: compRaw.toUpperCase(),
            codes,
            size: parts.at(0) + '*' + parts.at(1),
            qty
          });
          added++;
        });
        return;
      }

      // Cabang B: Format JACJI JanSport (Consumption Reg Dtl2)
      if (!excelColorways[currentCwKey]) {
        excelColorways[currentCwKey] = {
          cleanColor: colorHeaderName || currentCwKey,
          sheetName: styleTitle ? `${styleTitle} (${colorHeaderName || currentCwKey})` : currentCwKey,
          pieces: [],
          fabricSpecs: {}
        };
      }

      const matCol = String(row.at(hdrMap.color) || '').trim().toUpperCase();
      if (normFab === 'MA' && matCol && matCol !== '_' && !/^GIỐNG/i.test(matCol)) {
        excelColorways[currentCwKey].cleanColor = matCol;
        excelColorways[currentCwKey].sheetName = styleTitle ? `${styleTitle} (${matCol})` : matCol;
      }
      if (matName && matName !== '_' && !/^GIỐNG/i.test(matName)) {
        const fullSpec = (matName + ' ' + matSpec + (matCol && matCol !== '_' ? ' (' + matCol + ')' : '')).replace(/\s+/g, ' ').trim();
        excelColorways[currentCwKey].fabricSpecs[normFab] = fullSpec;
      }

      excelColorways[currentCwKey].pieces.push({
        fabric: normFab,
        name: cleanName || shortCode || compRaw.toUpperCase(),
        raw: (shortCode + ' ' + compRaw).toUpperCase(),
        codes,
        size: parts.at(0) + '*' + parts.at(1),
        qty
      });
      added++;
    });
  });
  return added > 0;
}


function parseBomLululemonFormat(workbook) {
  let added = 0;
  const validFabRegex = /^(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)(\b|[^A-Z0-9])/i;
  const normFabCode = (cat) => {
    const u = String(cat || '').trim().toUpperCase();
    const m = u.match(/^(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)/);
    if (!m) return '';
    return m.at(1) === 'L1' ? 'L2' : m.at(1);
  };

  workbook.SheetNames.forEach(sheetName => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    let curBuyer = '', curModel = '', curCw = '';
    let hdr = null;

    rows.forEach((row) => {
      const cells = row.map(c => String(c || '').trim());
      const joined = cells.join(' ');
      if (!joined.trim()) return;

      // Deteksi metadata header blok Lululemon
      cells.forEach(c => {
        if (/^BUYERs*NAMEs*:/i.test(c)) curBuyer = c.replace(/^BUYERs*NAMEs*:/i, '').trim();
        if (/^MODELs*NOs*:/i.test(c)) {
          curModel = c.replace(/^MODELs*NOs*:/i, '').trim();
          const styleInput = document.getElementById('styleNoInput');
          if (styleInput && !styleInput.value) styleInput.value = curModel.split('_').at(0);
        }
        if (/^COLORWAYs*:/i.test(c)) {
          curCw = c.replace(/^COLORWAYs*:/i, '').trim();
          hdr = null; // Reset header tabel untuk blok colorway baru
        }
      });

      // Deteksi baris header tabel komponen: No. | Annotation(ENG) | Category | Type | Qty | Size
      const idxAnnot = cells.findIndex(c => /^ANNOTATION/i.test(c));
      const idxCat = cells.findIndex(c => /^CATEGORY$/i.test(c));
      const idxSize = cells.findIndex(c => /^SIZE$/i.test(c));
      if (idxAnnot !== -1 && idxCat !== -1 && idxSize !== -1) {
        hdr = {
          no: cells.findIndex(c => /^NO.?$/i.test(c)),
          annot: idxAnnot,
          cat: idxCat,
          type: cells.findIndex(c => /^TYPE$/i.test(c)),
          qty: cells.findIndex(c => /^QTY$/i.test(c)),
          size: idxSize,
          mat: cells.findIndex(c => /^MATERIAL/i.test(c)),
          spec: cells.findIndex(c => /^SPEC$/i.test(c)),
          color: idxSize + 4 // Kolom Color / Colorway code berada 4 kolom setelah Size
        };
        return;
      }

      if (!hdr) return;
      const noVal = hdr.no !== -1 ? cells.at(hdr.no) : '';
      if (!/^\d+$/.test(noVal)) return;

      const catRaw = cells.at(hdr.cat) || '';
      if (!validFabRegex.test(catRaw)) return;
      const fab = normFabCode(catRaw);
      if (!fab) return;

      const annotRaw = cells.at(hdr.annot) || '';
      const sizeRaw = cells.at(hdr.size) || '';
      const qtyNum = parseInt(cells.at(hdr.qty)) || 1;
      const matName = hdr.mat !== -1 ? (cells.at(hdr.mat) || '') : '';
      const specName = hdr.spec !== -1 ? (cells.at(hdr.spec) || '') : '';
      const rowColor = (hdr.color < cells.length ? (cells.at(hdr.color) || '') : '').trim().toUpperCase();

      const effectiveCw = (curCw || rowColor || curBuyer || 'DEFAULT').toUpperCase();
      const cwKey = effectiveCw;
      if (!excelColorways[cwKey]) {
        excelColorways[cwKey] = {
          cleanColor: effectiveCw,
          sheetName: curModel ? curModel.split('_').at(0) : sheetName,
          fabricSpecs: {},
          pieces: []
        };
      }

      if (matName && matName !== '_') {
        const colSuffix = (rowColor && rowColor !== '_') ? ' (' + rowColor + ')' : '';
        excelColorways[cwKey].fabricSpecs[fab] = (matName + ' ' + specName + colSuffix).replace(/\s+/g, ' ').trim();
      }

      // Ekstrak kode pola DXF dari Annotation(ENG), misal "GUS-BK-GUSSET-BACK..." -> "GUS-BK" & "GUS"
      const dashParts = annotRaw.split('-').map(s => s.trim()).filter(Boolean);
      let shortCode = dashParts.at(0) || annotRaw;
      if (dashParts.length >= 2 && /^(BK|T|B|K|GUS)$/i.test(dashParts.at(1))) {
        shortCode = dashParts.at(0) + '-' + dashParts.at(1);
      }
      const cleanName = dashParts.length > 1 ? dashParts.slice(1).join(' ') : annotRaw;
      const codes = [...new Set([shortCode.toUpperCase(), (dashParts.at(0) || '').toUpperCase(), annotRaw.toUpperCase()].filter(Boolean))];

      excelColorways[cwKey].pieces.push({
        fabric: fab,
        name: cleanName.toUpperCase(),
        raw: annotRaw.toUpperCase(),
        codes,
        size: sizeRaw,
        qty: qtyNum
      });
      added++;
    });
  });
  return added > 0;
}

function handleExcelUpload(event, buyerTag) {
  window._activeJacjiBuyer = buyerTag || 'JANSPORT';
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      excelColorways = {};
      const targetSheets = workbook.SheetNames.filter(s => /(VAI|FAB)/i.test(s) && !/^(WEB|FORM)/i.test(s.trim()));
      if (typeof parseBomLululemonFormat === 'function') {
        parseBomLululemonFormat(workbook);
      }
      const sheetsToRead = Object.keys(excelColorways).length > 0 ? [] : (targetSheets.length > 0 ? targetSheets : workbook.SheetNames);
      sheetsToRead.forEach(sheetName => {
        if (/^(WEB|FORM)/i.test(sheetName.trim())) return;
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
        parseBomRows(rows, sheetName.trim());
      });
      let cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      if (cwKeys.length === 0 && typeof parseBomLululemonFormat === 'function') {
        parseBomLululemonFormat(workbook);
        cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      }
      if (cwKeys.length === 0 && typeof parseBomZNZFormat === 'function') {
        parseBomZNZFormat(workbook);
        cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      }
      if (cwKeys.length > 0) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        const isRei = (buyerTag === 'REI');
        const zId = isRei ? 'reiExcelZone' : 'excelZone';
        const sId = isRei ? 'reiExcelStatus' : 'excelStatus';
        const bName = isRei ? 'REI' : 'JanSport';
        document.getElementById(zId)?.classList.add('loaded');
        const stEl = document.getElementById(sId);
        if (stEl) stEl.innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Color ' + bName + ' siap)';
        applyColorwayMapping();
      } else {
        alert("Tidak ditemukan tabel komponen fabric (VAI/FAB) pada file JACJI ini.");
      }
    } catch (err) {
      alert("Error membaca Excel JACJI: " + err.message);
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
      // Deteksi otomatis pergeseran +1 kolom (seperti pada JACJI ZNZ yang memiliki kolom Piece No / merge cell)
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
  const jacji = excelColorways[cwKey];
  if (!jacji) return;
  currentColorwayName = jacji.cleanColor;
  if (parsedPieces.length === 0 && (!window._cleanDxfPieces || window._cleanDxfPieces.length === 0)) return;

  // Simpan DXF asli bersih saat pertama kali dipetakan, dan selalu reset dari DXF bersih agar antar-color tidak menumpuk
  if (!window._cleanDxfPieces || window._cleanDxfPieces.length === 0) {
    window._cleanDxfPieces = JSON.parse(JSON.stringify(parsedPieces));
  }
  parsedPieces = JSON.parse(JSON.stringify(window._cleanDxfPieces));
  const availableBom = jacji.pieces.map((b, idx) => ({ ...b, idx, used: false }));
  parsedPieces.forEach(p => {
    const catParts = String(p.catSize || '').split('*').map(Number);
    const d1 = (catParts.length === 2 && catParts.at(0) > 0) ? catParts.at(0) : (p.width / 10);
    const d2 = (catParts.length === 2 && catParts.at(1) > 0) ? catParts.at(1) : (p.height / 10);
    const up = p.rawText.toUpperCase().replace(/\bDIV-?M\b/g, 'DIVIP DIV');
    const mAnn2 = String(p.rawText || '').match(/ANNOTATION\s*:\s*([^|\n\r]+)/i);
    const annStr2 = mAnn2 ? mAnn2.at(1) : String(p.rawText || '');
    const explicitPairs = [...annStr2.matchAll(/(\d+(?:\.\d+)?)\s*[*xX]\s*(\d+(?:\.\d+)?)/g)].map(m => ({
      s1: parseFloat(m.at(1)),
      s2: parseFloat(m.at(2)),
      raw: m.at(1) + '*' + m.at(2)
    }));
    const dxfFab = String(p.fabric || '').trim().toUpperCase();

    if (explicitPairs.length >= 2) {
      const matchedList = [];
      explicitPairs.forEach(ep => {
        let bestB = null, bestSc = Infinity;
        availableBom.forEach(b => {
          if (b.used) return;
          const [bs1, bs2] = String(b.size || '').split('*').map(Number);
          if (!bs1 || !bs2) return;
          const diff = Math.min(Math.abs(ep.s1 - bs1) + Math.abs(ep.s2 - bs2), Math.abs(ep.s1 - bs2) + Math.abs(ep.s2 - bs1));
          if (diff <= 2.2) {
            const bomFab = String(b.fabric || '').trim().toUpperCase();
            let sc = diff + (dxfFab && bomFab && dxfFab === bomFab ? -100 : (dxfFab && bomFab ? 250 : 0));
            if (sc < bestSc) { bestSc = sc; bestB = b; }
          }
        });
        if (bestB) {
          bestB.used = true;
          matchedList.push(bestB);
        }
      });
      p.sizeText = explicitPairs.map(e => e.raw).join(' + ');
      if (matchedList.length > 0) {
        matchedList.sort((a, b) => a.idx - b.idx);
        const first = matchedList.at(0);
        p.bomOrder = first.idx;
        p.fabric = first.fabric || dxfFab;
        p.name = [...new Set(matchedList.map(m => m.name).filter(Boolean))].join(' / ');
        if (first.qty > 1 && !p.qtyLabel) p.qtyLabel = 'X' + first.qty;
      }
      return;
    }

    let bestItem = null, bestScore = Infinity;
    const dxfWords = up.split(/[^A-Z0-9]+/).filter(w => w.length >= 3 && !['PIECE','NAME','SIZE','QUANTITY','ANNOTATION','CATEGORY','MODARIS'].includes(w));
    availableBom.forEach(b => {
      const [s1, s2] = String(b.size || '').split('*').map(Number);
      if (!s1 || !s2) return;
      const minDiff = Math.min(Math.abs(d1 - s1) + Math.abs(d2 - s2), Math.abs(d1 - s2) + Math.abs(d2 - s1));
      if (minDiff <= 2.2) {
        const bomFab = String(b.fabric || '').trim().toUpperCase();
        let score = minDiff + (b.used ? 25 : 0);
        if (dxfFab && bomFab) {
          score += (dxfFab === bomFab) ? -100 : 250;
        }
        const bPrefix = String(b.raw || b.name || '').split(/[-_\s]/).at(0).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pCleanUp = up.replace(/[^A-Z0-9]/g, '');
        const exactPrefixHit = (bPrefix.length >= 3 && pCleanUp.includes(bPrefix)) || (b.codes && b.codes.some(c => c.length >= 2 && up.includes(c)));
        if (exactPrefixHit) score -= 500;
        else score += 300;
        const bomWords = String(b.name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 4);
        if (dxfWords.some(dw => bomWords.includes(dw))) score -= 60;
        if (score < bestScore) { bestScore = score; bestItem = b; }
      }
    });
    // Jika ukuran DXF merupakan gabungan 2 komponen JACJI (misal FRPT 8.2*28.2 + FRPB 17.7*28 digabung jadi 1 pola FRP di DXF)
    if (!bestItem) {
      const pClean = up.replace(/[^A-Z0-9]/g, '');
      const matchingSubBom = availableBom.filter(b => {
        if (b.used) return false;
        const bPrefix = String(b.raw || b.name || '').split(/[-_\s]/).at(0).toUpperCase();
        const codeHit = b.codes && b.codes.some(c => c.length >= 2 && up.includes(c));
        const prefixHit = bPrefix.length >= 3 && (pClean.includes(bPrefix) || bPrefix.startsWith(pClean.slice(0, 3)));
        return codeHit || prefixHit;
      });
      if (matchingSubBom.length > 0) {
        matchingSubBom.sort((a, b) => a.idx - b.idx);
        bestItem = matchingSubBom.at(0);
        if (matchingSubBom.length >= 2) {
          matchingSubBom.forEach(sb => { sb.used = true; });
          const combinedNames = [...new Set(matchingSubBom.map(sb => sb.name).filter(Boolean))].join(' / ');
          if (combinedNames) bestItem = { ...bestItem, name: combinedNames };
        }
      } else {
        // Fallback aman: hanya cocokkan dengan baris BOM yang selisih ukurannya masuk akal (<= 4.5 cm) agar tidak salah bentuk
        const closeUnused = availableBom
          .filter(b => !b.used)
          .map(b => {
            const [s1, s2] = String(b.size || '').split('*').map(Number);
            const diff = (s1 && s2) ? Math.min(Math.abs(d1 - s1) + Math.abs(d2 - s2), Math.abs(d1 - s2) + Math.abs(d2 - s1)) : 999;
            return { b, diff };
          })
          .filter(x => x.diff <= 4.5)
          .sort((a, b) => (a.b.fabric === p.fabric ? 0 : 1) - (b.b.fabric === p.fabric ? 0 : 1) || a.diff - b.diff);
        const unusedPool = closeUnused.map(x => x.b);
        if (unusedPool.length > 0) {
          bestItem = unusedPool.at(0);
          // Jika ada 2 baris JACJI berurutan yang belum terpakai di awal (misal idx 0 & idx 1), gabungkan keduanya
          if (unusedPool.length >= 2 && unusedPool.at(1).idx === bestItem.idx + 1) {
            unusedPool.at(1).used = true;
            const combName = [bestItem.name, unusedPool.at(1).name].filter(Boolean).join(' / ');
            bestItem = { ...bestItem, name: combName };
          }
        }
      }
    }

    if (bestItem) {
      bestItem.used = true;
      p.bomOrder = bestItem.idx;
      p.fabric = bestItem.fabric;
      p.name = bestItem.name || p.name;
      if (!String(bestItem.name || '').includes(' / ')) {
        p.sizeText = bestItem.size;
      }
      if (bestItem.qty > 1) {
        p.qtyLabel = classifyQtyBySymmetry(p, bestItem.qty);
      } else {
        p.qtyLabel = "";
        p.isPairAB = false;
      }
    }
  });
  // Jika 1 pattern DXF dipakai di >1 fabric pada JACJI, buat komponen terpisah untuk tiap fabric yang berbeda
  const extraCrossFabPieces = [];
  if (window._activeJacjiBuyer !== 'LULULEMON') {
  const existingFabKeys = new Set(parsedPieces.map(p => `${p.fabric}|${p.name}|${p.sizeText}`));
  availableBom.forEach(b => {
    if (b.used) return;
    const dimP = String(b.size || "").split("*").map(Number);
    const s1 = dimP.at(0), s2 = dimP.at(1);
    if (!s1 || !s2) return;
    const bPrefCross = String(b.raw || b.name || '').split(/[-_\s]/).at(0).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const matchDxf = parsedPieces
      .filter(p => {
        if (p.fabric === b.fabric && p.name === b.name) return false;
        const d1 = p.width / 10, d2 = p.height / 10;
        const minDiff = Math.min(Math.abs(d1 - s1) + Math.abs(d2 - s2), Math.abs(d1 - s2) + Math.abs(d2 - s1));
        return minDiff <= 3.5;
      })
      .sort((a, b2) => {
        const scoreCand = (cand) => {
          const up = String(cand.rawText || '').toUpperCase();
          const pClean = up.replace(/[^A-Z0-9]/g, '');
          const codeOk = b.codes && b.codes.some(c => c.length >= 2 && up.includes(c));
          const prefOk = bPrefCross.length >= 3 && pClean.includes(bPrefCross);
          const diff = Math.min(Math.abs(cand.width/10 - s1) + Math.abs(cand.height/10 - s2), Math.abs(cand.width/10 - s2) + Math.abs(cand.height/10 - s1));
          return diff - (codeOk ? 50 : 0) - (prefOk ? 30 : 0);
        };
        return scoreCand(a) - scoreCand(b2);
      })
      .at(0);
    const uniqueKey = `${b.fabric}|${b.name || (matchDxf && matchDxf.name)}|${b.size}`;
    if (matchDxf && !existingFabKeys.has(uniqueKey)) {
      b.used = true;
      existingFabKeys.add(uniqueKey);
      const clone = JSON.parse(JSON.stringify(matchDxf));
      clone.id = parsedPieces.length + extraCrossFabPieces.length + 1;
      clone.bomOrder = b.idx;
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
    const dedupedPieces = [];
    parsedPieces.forEach(p => {
      const exist = dedupedPieces.find(d => d.fabric === p.fabric && d.name === p.name && d.sizeText === p.sizeText);
      if (exist) {
        if (!exist.qtyLabel) exist.qtyLabel = 'A/B';
        else if (exist.qtyLabel === 'A/B') exist.qtyLabel = 'Ax2 Bx2';
      } else {
        dedupedPieces.push(p);
      }
    });
    parsedPieces = dedupedPieces;
    parsedPieces.sort((a, b) => (a.bomOrder ?? 9999) - (b.bomOrder ?? 9999));
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
function wrapCanvasLines(ctx, text, maxW) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW) { cur = test; }
    else {
      if (cur) lines.push(cur);
      if (ctx.measureText(w).width > maxW) {
        let part = '';
        for (const ch of w) {
          if (ctx.measureText(part + ch).width <= maxW) part += ch;
          else { if (part) lines.push(part); part = ch; }
        }
        cur = part;
      } else { cur = w; }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function calcSmartCirclePos(piece, cx, cy, cellW, finalX, finalY, finalW, finalH, circleR) {
  const effW = piece.autoRotate90 ? piece.height : piece.width;
  const effH = piece.autoRotate90 ? piece.width : piece.height;
  const scale = effW > 0 ? (finalW / effW) : 1;
  const bandTop = Math.max(cy + circleR + 4, finalY + Math.min(circleR + 2, finalH * 0.25));
  const yMin = bandTop - circleR - 6;
  const yMax = bandTop + circleR + 6;

  let minPolyX = finalX + finalW;
  let foundAny = false;
  if (Array.isArray(piece.polygons) && piece.polygons.length > 0 && effW > 0) {
    piece.polygons.forEach(poly => {
      if (!poly.pts || poly.pts.length === 0) return;
      for (let i = 0; i < poly.pts.length; i++) {
        const p1 = poly.pts.at(i);
        const p2 = poly.pts.at((i + 1) % poly.pts.length);
        // Periksa 5 titik sepanjang setiap segmen garis agar lengkungan miring (seperti 1.7 & 4.1) ikut terdeteksi
        for (let t = 0; t <= 4; t++) {
          const frac = t / 4;
          const rawX = p1.x + (p2.x - p1.x) * frac;
          const rawY = p1.y + (p2.y - p1.y) * frac;
          const rx = (piece.autoRotate90 ? (piece.height - rawY) : rawX) * scale;
          const ry = (piece.autoRotate90 ? rawX : rawY) * scale;
          const px = finalX + rx;
          const py = finalY + ry;
          if (py >= yMin && py <= yMax) {
            if (px < minPolyX) minPolyX = px;
            foundAny = true;
          }
        }
      }
    });
  }
  if (!foundAny) minPolyX = finalX;

  // Beri jarak aman 7px di luar garis kontur biru agar tidak pernah menempel
  let numCx = minPolyX - circleR - 7;
  let numCy = bandTop;

  // Jika masih mepet batas kiri sel (cx), taruh di atas sudut kiri luar pattern (jarak 6px di atas finalY)
  if (numCx < cx + circleR + 3) {
    numCx = cx + circleR + 3;
    if (finalY - cy >= (circleR * 2) + 8) {
      numCy = finalY - circleR - 6;
    } else {
      numCx = Math.max(cx + circleR + 3, finalX - circleR - 6);
    }
  }
  return { numCx, numCy };
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
  const procSize = parseInt(document.getElementById('processFontSize')?.value) || 13;
  const fabSize = parseInt(document.getElementById('fabricFontSize')?.value) || 14;
  const customCols = document.getElementById('colsSelect')?.value || 'auto';
  const customRows = document.getElementById('rowsSelect')?.value || 'auto';

  const cwKey = document.getElementById('colorwaySelect')?.value;
  const jacji = excelColorways[cwKey];

  const defaultFabOrder = ['MA', 'T1', 'T2', 'T3', 'L2', 'N1'];
  // Urutkan kategori fabric sesuai urutan kemunculan pertama di JACJI (jika JACJI tersedia)
  const bomFabSeq = [];
  if (jacji && Array.isArray(jacji.pieces)) {
    jacji.pieces.forEach(bp => {
      if (bp.fabric && !bomFabSeq.includes(bp.fabric)) bomFabSeq.push(bp.fabric);
    });
  }
  const activeFabrics = [...new Set([...bomFabSeq, ...defaultFabOrder])].filter(f => parsedPieces.some(p => p.fabric === f));
  const fabricNumberMap = {};
  activeFabrics.forEach((f, idx) => { fabricNumberMap[f] = idx + 1; });

  if ((typeof isAutoSyncMode !== 'undefined' && isAutoSyncMode) && window._menu1MasterOrderMap && Object.keys(window._menu1MasterOrderMap).length > 0) {
    parsedPieces.forEach(p => {
      const altKey = String(p.rawText || '').trim().toUpperCase() + '_' + String(p.fabric || '');
      const m = window._menu1MasterOrderMap[p.id] || window._menu1MasterOrderMap[altKey];
      if (m) {
        p.bomOrder = m.order;
        p.fabric = m.fabric;
        p.name = m.name;
        p.sizeText = m.sizeText;
        p.qtyLabel = m.qtyLabel;
        p.processLabel = m.processLabel;
        p.autoRotate90 = m.autoRotate90;
      }
    });
  }
  // Gabungkan semua pattern kembar pada fabric yang sama sebelum digambar ke kanvas
  const uniqueRenderList = [];
  parsedPieces.forEach(p => {
    const cleanN = String(p.name || '').replace(/[\s_\-]+(?:L|R|LEFT|RIGHT|A|B)$/i, '').trim().toUpperCase();
    const cleanS = String(p.sizeText || '').trim().toUpperCase();
    const exist = uniqueRenderList.find(u => {
      const uN = String(u.name || '').replace(/[\s_\-]+(?:L|R|LEFT|RIGHT|A|B)$/i, '').trim().toUpperCase();
      const uS = String(u.sizeText || '').trim().toUpperCase();
      return u.fabric === p.fabric && uN === cleanN && uS === cleanS && (u.bomOrder === p.bomOrder || typeof p.bomOrder !== 'number');
    });
    if (exist) {
      if (!exist.qtyLabel) exist.qtyLabel = 'A/B';
      else if (exist.qtyLabel === 'A/B') exist.qtyLabel = 'Ax2 Bx2';
    } else {
      uniqueRenderList.push(p);
    }
  });
  parsedPieces = uniqueRenderList;

  const sortedPieces = [...parsedPieces].sort((a, b) => {
    const fDiff = (fabricNumberMap[a.fabric] || 99) - (fabricNumberMap[b.fabric] || 99);
    if (fDiff !== 0) return fDiff;
    const oA = typeof a.bomOrder === 'number' ? a.bomOrder : 9999;
    const oB = typeof b.bomOrder === 'number' ? b.bomOrder : 9999;
    if (oA !== oB) return oA - oB;
    return (a.id || 0) - (b.id || 0);
  });
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

  const dynLayout = computeDynamicGridLayout(sortedPieces, customCols, customRows, sampleBoxW, sampleBoxH, labelSize);
  const cols = dynLayout.cols;
  const rowsPerPage = dynLayout.rowsPerPage;
  const pages = dynLayout.pages;
  const globalUniformScale = dynLayout.globalUniformScale;
  window._lastRenderMeta = { globalUniformScale, cols, rowsPerPage };
  if (typeof isAutoSyncMode === 'undefined' || !isAutoSyncMode) {
    window._menu1MasterOrderMap = {};
    sortedPieces.forEach((sp, sIdx) => {
      const entry = {
        order: sIdx,
        fabric: sp.fabric,
        name: sp.name,
        sizeText: sp.sizeText,
        qtyLabel: sp.qtyLabel,
        processLabel: sp.processLabel,
        autoRotate90: !!sp.autoRotate90
      };
      window._menu1MasterOrderMap[sp.id] = entry;
      const altKey = String(sp.rawText || '').trim().toUpperCase() + '_' + String(sp.fabric || '');
      if (!window._menu1MasterOrderMap[altKey]) window._menu1MasterOrderMap[altKey] = entry;
    });
  }

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
    const fullTitleText = (styleVal + ' (' + currentColorwayName + ')').replace(/\s+/g, ' ').trim();
    let effTitleSize = titleSize;
    ctx.font = 'bold ' + effTitleSize + 'px ' + fontFam;
    while (effTitleSize > 16 && ctx.measureText(fullTitleText).width > (canvas.width - 80)) {
      effTitleSize -= 1;
      ctx.font = 'bold ' + effTitleSize + 'px ' + fontFam;
    }
    const titleLines = [fullTitleText];
    const titleLineH = Math.round(effTitleSize * 1.15);
    ctx.fillText(fullTitleText, canvas.width / 2, 16 + titleLineH);

    const bomSpecs = (jacji && jacji.fabricSpecs) || {};
    const defaultSpecs = { MA: 'POLY 600D SOLID 100% RECYCLED 60" PU (' + currentColorwayName + ')', T1: 'POLY 600D SOLID 100% RECYCLED 60" PU (BLACK 008)', T2: 'PU LEATHER 52" (' + currentColorwayName + ')', T3: 'NON-WOVEN FABRIC 60" 100G (WHITE)', L2: 'POLY 200D SOLUTION DYE EMBOSSED 100% RECYCLED 58" PU (INTERNAL)', N1: 'POLY 840D MESH 60" (' + currentColorwayName + ')' };
    const fabLineH = Math.max(Math.round(fabSize * 1.32), 20);
    const fabHeaderSize = fabSize + 2;
    ctx.font = fabSize + 'px ' + fontFam;
    const footerEntries = activeFabrics.map(fab => {
      const num = fabricNumberMap[fab];
      const compCount = sortedPieces.filter(p => p.fabric === fab).length;
      const specText = (bomSpecs[fab] || defaultSpecs[fab] || fab).replace(/\bWIDTH\s*VAI\b|\bWIDTH\b|\bVAI\b/gi, '').replace(/\s+/g, ' ').trim();
      return wrapCanvasLines(ctx, num + '. ' + specText + ' (' + compCount + ' KOMPONEN)', canvas.width - 80);
    });
    const totalFooterLines = footerEntries.reduce((a, b) => a + Math.max(b.length, 1), 0);
    const footerH = Math.round(fabHeaderSize * 1.5) + (totalFooterLines * fabLineH) + 14;
    const boxX = 36, boxY = 20 + (titleLines.length * titleLineH) + ((orderVal || pages.length > 1) ? Math.max(labelSize + 14, 24) : 10);
    const boxW = canvas.width - 72, boxH = Math.max(220, canvas.height - boxY - footerH - 18);

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

    const actualRows = rowsPerPage;
    const baseCellW = (boxW - 24) / cols;
    const baseCellH = (boxH - 18) / actualRows;

    pagePieces.forEach((slot) => {
      const piece = slot.piece || slot;
      const col = slot.col || 0, row = slot.row || 0;
      const cSpan = slot.colSpan || 1, rSpan = slot.rowSpan || 1;
      const cellW = baseCellW * cSpan;
      const cellH = baseCellH * rSpan;
      const cx = boxX + 12 + col * baseCellW, cy = boxY + 10 + row * baseCellH;
      canvas._hitBoxes.push({ x: cx, y: cy, w: cellW, h: cellH, piece });
      const fabNum = piece.itemNumberLabel || String(fabricNumberMap[piece.fabric] || 1);

      const circleR = Math.min(14, baseCellH * 0.075);
      const topSpace = piece.processLabel ? (Math.max(procSize, 10) + 10) : 8;
      const bottomSpace = Math.round(labelSize * 3.0) + 16;
      const leftOffset = (circleR * 2) + 8;
      const rightSpace = piece.qtyLabel ? 34 : 10;
      const maxDrawW = Math.max(cellW - leftOffset - rightSpace, 24);
      const maxDrawH = Math.max(cellH - topSpace - bottomSpace, 24);

      const effW = piece.autoRotate90 ? piece.height : piece.width;
      const effH = piece.autoRotate90 ? piece.width : piece.height;
      const drawSideBySide = false;
      const isGiant = (cSpan > 1 || rSpan > 1);
      const pairScale = (isGiant ? (piece.maxAllowedScale || globalUniformScale) : Math.min(globalUniformScale, piece.maxAllowedScale || globalUniformScale)) * (piece.customScale || 1);
      const finalW = effW * pairScale, finalH = eh_val = effH * pairScale;
      const finalX = cx + leftOffset + (maxDrawW - finalW) / 2;
      const finalY = cy + topSpace + (maxDrawH - finalH) / 2;
      const centerDrawX = finalX + finalW / 2;

      // Pastikan ruang kiri sel cukup untuk lingkaran nomor (jarak bersih 7px dari garis luar biru)
      const minLeftNeeded = cx + (circleR * 2) + 9;
      if (finalX < minLeftNeeded) {
        const qtyPad = piece.qtyLabel ? 32 : 6;
        const maxAllowedX = (cx + cellW - qtyPad) - totalDrawW;
        if (maxAllowedX > finalX) {
          finalX = Math.min(minLeftNeeded, maxAllowedX);
        }
      }
      const { numCx, numCy } = calcSmartCirclePos(piece, cx, cy, cellW, finalX, finalY, finalW, finalH, circleR);
      ctx.beginPath();
      ctx.arc(numCx, numCy, circleR, 0, Math.PI * 2);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#000000';
      const numScale = String(fabNum).length >= 4 ? 0.76 : 0.90;
      ctx.font = 'bold ' + Math.round(circleR * numScale) + 'px ' + fontFam;
      ctx.textAlign = 'center';
      ctx.fillText(String(fabNum), numCx, numCy + Math.round(circleR * 0.35));

      if (piece.processLabel) {
        const parts = piece.processLabel.toUpperCase().split('-').map(s => s.trim()).filter(Boolean);
        const sep = ' - ';
        const procLeftLimit = numCx + circleR + 6;
        const procRightLimit = cx + cellW - 4;
        const maxProcW = Math.max(procRightLimit - procLeftLimit, 36);
        let effProcSize = Math.max(procSize, 9);
        ctx.font = '900 ' + effProcSize + 'px ' + fontFam;
        let totalTextW = parts.reduce((a, pt) => a + ctx.measureText(pt).width, 0) + ctx.measureText(sep).width * Math.max(parts.length - 1, 0);
        while (effProcSize > 7 && totalTextW > maxProcW) {
          effProcSize -= 0.5;
          ctx.font = '900 ' + effProcSize + 'px ' + fontFam;
          totalTextW = parts.reduce((a, pt) => a + ctx.measureText(pt).width, 0) + ctx.measureText(sep).width * Math.max(parts.length - 1, 0);
        }
        ctx.textAlign = 'left';
        const sepW = ctx.measureText(sep).width;
        let curTextX = Math.min(procRightLimit - totalTextW, Math.max(procLeftLimit, centerDrawX - (totalTextW / 2)));
        curTextX = Math.max(procLeftLimit, curTextX);
        const procY = Math.min(finalY - 4, Math.max(cy + effProcSize + 2, finalY - 4));
        parts.forEach((pt, pIdx) => {
          ctx.fillStyle = getProcessColor(pt);
          ctx.fillText(pt, curTextX, procY);
          curTextX += ctx.measureText(pt).width;
          if (pIdx < parts.length - 1) {
            ctx.fillStyle = '#64748b';
            ctx.fillText(sep, curTextX, procY);
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
          ctx.strokeStyle = poly.isOuter ? '#0000ff' : '#000000';
          ctx.lineWidth = poly.isOuter ? 2.1 : 1.05;
          if (poly.isOuter || poly.isClosed) ctx.closePath();
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
        let qFontSize = Math.max(labelSize - 2, 9);
        ctx.font = 'bold ' + qFontSize + 'px ' + fontFam;
        const qSample = piece.qtyLabel === 'Ax2 Bx2' ? 'Ax2' : piece.qtyLabel;
        let qW = ctx.measureText(qSample).width;
        while (qFontSize > 7 && (finalX + finalW + 4 + qW > cx + cellW - 2)) {
          qFontSize -= 0.5;
          ctx.font = 'bold ' + qFontSize + 'px ' + fontFam;
          qW = ctx.measureText(qSample).width;
        }
        ctx.textAlign = 'left';
        const labelX = Math.min(finalX + finalW + 4, cx + cellW - qW - 2);
        const labelY = Math.max(cy + qFontSize + 4, finalY + qFontSize + 2);
        if (piece.qtyLabel === 'Ax2 Bx2') {
          ctx.fillText('Ax2', labelX, labelY);
          ctx.fillText('Bx2', labelX, labelY + Math.max(qFontSize + 1, 10));
        } else {
          ctx.fillText(piece.qtyLabel, labelX, labelY);
        }
      }

      // Rapatkan teks ukuran & nama 4px di bawah pattern/lingkaran namun tetap di dalam batas sel
      const circleBottom = numCy + circleR;
      const circleRight = numCx + circleR;
      const anchorBottom = Math.max(finalY + finalH, circleBottom);
      const safeLeftX = cx + 4;
      const safeRightX = cx + cellW - 4;
      const maxCellW = Math.max(safeRightX - safeLeftX, 44);
      const safeTextX = (safeLeftX + safeRightX) / 2;

      let effLabelSz = labelSize;
      let effNameSz = Math.max(labelSize - 2, 8);
      const availTextH = Math.max((cy + cellH - 2) - (anchorBottom + 3), 18);

      const measureBlockH = (lsz, nsz) => {
        ctx.font = 'bold ' + lsz + 'px ' + fontFam;
        const l1 = wrapCanvasLines(ctx, piece.sizeText, maxCellW).length;
        ctx.font = nsz + 'px ' + fontFam;
        const l2 = wrapCanvasLines(ctx, piece.name, maxCellW).length;
        return (l1 * Math.round(lsz * 1.12)) + (l2 * Math.round(nsz * 1.12));
      };

      while (effLabelSz > 8 && measureBlockH(effLabelSz, effNameSz) > availTextH) {
        effLabelSz -= 0.5;
        effNameSz = Math.max(effLabelSz - 1.5, 7);
      }

      let py = anchorBottom + Math.round(effLabelSz) + 3;
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + effLabelSz + 'px ' + fontFam;
      wrapCanvasLines(ctx, piece.sizeText, maxCellW).forEach(l => { ctx.fillText(l, safeTextX, py); py += Math.round(effLabelSz * 1.12); });
      ctx.font = effNameSz + 'px ' + fontFam;
      wrapCanvasLines(ctx, piece.name, maxCellW).forEach(l => { ctx.fillText(l, safeTextX, py); py += Math.round(effNameSz * 1.12); });
    });

    let legY = boxY + boxH + fabHeaderSize + 12;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + fabHeaderSize + 'px ' + fontFam;
    ctx.fillText('KETERANGAN :', boxX, legY);
    legY += Math.round(fabHeaderSize * 1.3);
    ctx.font = fabSize + 'px ' + fontFam;
    footerEntries.forEach(lines => lines.forEach(l => { ctx.fillText(l, boxX, legY); legY += fabLineH; }));

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
  try {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      const { Filesystem, Share } = window.Capacitor.Plugins || {};
      if (!Filesystem) {
        alert("Plugin Filesystem belum aktif. Silakan unduh APK terbaru dari GitHub Releases.");
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
      let savedUri = null;
      let savedLocation = "";
      try {
        const resDoc = await Filesystem.writeFile({
          path: "MiniMarker/" + fileName,
          data: base64Data,
          directory: "DOCUMENTS",
          recursive: true
        });
        savedUri = resDoc.uri;
        savedLocation = "Documents/MiniMarker/" + fileName;
      } catch (eDoc) {
        const resCache = await Filesystem.writeFile({
          path: fileName,
          data: base64Data,
          directory: "CACHE",
          recursive: true
        });
        savedUri = resCache.uri;
        savedLocation = "Cache/" + fileName;
      }
      if (Share && savedUri) {
        try {
          await Share.share({
            title: fileName,
            text: "MiniMarker Output: " + fileName,
            url: savedUri,
            dialogTitle: "Simpan atau Bagikan " + fileName
          });
        } catch (shareErr) {
          console.log("Share dialog ditutup:", shareErr);
        }
      }
      return savedLocation;
    } else {
      let blob = blobOrDataUrl;
      if (isDataUrl) {
        const res = await fetch(blobOrDataUrl);
        blob = await res.blob();
      }
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.style.display = "none";
      link.download = fileName;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      }, 2500);
      return fileName;
    }
  } catch (err) {
    alert("Gagal menyimpan file: " + (err.message || err));
    return null;
  }
}

async function exportAllPDF() {
  if (generatedCanvases.length === 0) { alert("Belum ada preview marker yang dibuat!"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  generatedCanvases.forEach((c, i) => {
    if (i > 0) doc.addPage();
    doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 5, 5, 287, 200);
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

function openExportFormatModal() {
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) { alert("Belum ada pola DXF yang dimuat."); return; }
  const m = document.getElementById('exportFormatModal');
  if (m) { m.classList.remove('hidden'); m.style.display = 'flex'; }
  else { saveAllColorwaysBatch('pdf'); }
}

function closeExportFormatModal() {
  const m = document.getElementById('exportFormatModal');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
}

function confirmBatchFormat(fmt) {
  closeExportFormatModal();
  saveAllColorwaysBatch(fmt);
}

async function saveAllColorwaysBatch(format) {
  if (!format) { openExportFormatModal(); return; }
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) { alert("Belum ada pola DXF yang dimuat."); return; }
  const orderNo = (document.getElementById('orderNoInput')?.value || currentStyleName || 'ORDER_MARKER').trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
  const cwKeys = Object.keys(excelColorways || {}).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
  const targetKeys = cwKeys.length > 0 ? cwKeys : [currentColorwayName];
  const { jsPDF } = window.jspdf;

  const zip = new JSZip();
  const folder = zip.folder(orderNo);
  const prevOpenFull = window.openFullPreview;
  window.openFullPreview = function() {};
  try {
    for (let idx = 0; idx < targetKeys.length; idx++) {
      const cwKey = targetKeys[idx];
      if (typeof appendSyncLog === 'function') {
        appendSyncLog(`⏳ Memproses PDF (${idx + 1}/${targetKeys.length}): ${cwKey}...`);
      }
      if (cwKeys.length > 0) { document.getElementById('colorwaySelect').value = cwKey; applyColorwayMapping(); }
      generateMiniMarker();
      const safeCw = currentColorwayName.replace(/[^A-Z0-9_\-]/gi, '_');
      if (format === 'png') {
        for (let i = 0; i < generatedCanvases.length; i++) {
          const pngBlob = await new Promise(res => generatedCanvases[i].toBlob(res, 'image/png'));
          const suffix = generatedCanvases.length > 1 ? '_Hal' + (i + 1) : '';
          folder.file('MiniMarker_' + currentStyleName + '_' + safeCw + suffix + '.png', pngBlob);
        }
      } else {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        generatedCanvases.forEach((c, i) => {
          if (i > 0) doc.addPage();
          doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 5, 5, 287, 200);
        });
        const pdfBytes = doc.output('arraybuffer');
        folder.file('MiniMarker_' + currentStyleName + '_' + safeCw + '.pdf', pdfBytes);
      }
      // Bebaskan memori kanvas & beri jeda 25ms agar RAM HP tidak penuh saat memproses 160+ halaman
      generatedCanvases.forEach(c => { c.width = 1; c.height = 1; });
      generatedCanvases = [];
      await new Promise(r => setTimeout(r, 25));
    }
  } finally {
    window.openFullPreview = prevOpenFull;
  }
  closeFullPreview();
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const saved = await saveFileUniversal(orderNo + '.zip', zipBlob, false);
  if (saved) alert("✅ Selesai! " + targetKeys.length + " Color disimpan ke: " + saved);
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
  lbl.textContent = 'Color ' + (currentSwipeIdx + 1) + ' / ' + sel.options.length + ' : ' + currentColorwayName;
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
  if (h) h.style.transition = 'none';
  if (!h) return;
  const boost = (fsAngle % 180 !== 0 && fsScale === 1) ? 1.35 : 1;
  h.style.transform = `translate(${fsX}px, ${fsY}px) rotate(${fsAngle}deg) scale(${fsScale * boost})`;
  if (l) l.textContent = Math.round(fsScale * 100) + '%';
}
function fsZoom(d) { fsScale = Math.min(Math.max(fsScale + d, 1), 4); applyFsTransform(); }
function fsRotate() { fsAngle = (fsAngle + 90) % 360; fsX = 0; fsY = 0; applyFsTransform(); }
function fsReset() { fsScale = 1; fsAngle = 0; fsX = 0; fsY = 0; applyFsTransform(); }
function adjustPreviewZoom(d) { fsZoom(d); }
function rotatePreviewCanvas() { fsRotate(); }
function resetPreviewTransform() { fsReset(); }



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
        if (el.id !== 'resultArea' && !el.querySelector('#fontGridCard')) el.classList.add('hidden');
      });
    }
    if (resultArea) resultArea.classList.add('hidden'); if (false) {
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
  const sel = document.getElementById('colorwaySelect');
  if (sel) {
    const sourceMap = isAutoSyncMode
      ? ((window._spreadColorways && Object.keys(window._spreadColorways).length > 0) ? window._spreadColorways : excelColorways)
      : ((typeof bomTemplates !== 'undefined' && Object.keys(bomTemplates).length > 0) ? bomTemplates : excelColorways);
    if (sourceMap && Object.keys(sourceMap).length > 0) {
      excelColorways = JSON.parse(JSON.stringify(sourceMap));
      const keys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces && excelColorways[k].pieces.length > 0);
      if (keys.length > 0) {
        const prevVal = sel.value;
        sel.innerHTML = keys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        sel.value = keys.includes(prevVal) ? prevVal : keys[0];
        if (typeof applyColorwayMapping === 'function') applyColorwayMapping();
        if (!isAutoSyncMode && typeof generatedCanvases !== 'undefined' && generatedCanvases.length > 0 && typeof generateMiniMarker === 'function') {
          generateMiniMarker();
        }
      }
    }
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
  const cwKeys = Object.keys(excelColorways || {}).filter(k => excelColorways[k].pieces && excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
  if (cwKeys.length > 0) {
    const sel = document.getElementById('colorwaySelect');
    if (sel) {
      if (!sel.value || !cwKeys.includes(sel.value)) sel.value = cwKeys.at(0);
      applyColorwayMapping();
    }
  }
  Object.values(excelColorways || {}).forEach(cw => {
    if (cw && Array.isArray(cw.pieces)) syncMenu1LayoutToPieces(cw.pieces);
  });
  generateMiniMarker();
  const resultArea = document.getElementById('resultArea');
  if (resultArea) resultArea.classList.remove('hidden');
  appendSyncLog("✅ Auto Sync selesai! Urutan susunan 100% sesuai JACJI (" + (cwKeys.length || 1) + " Color).");
}


function createNewWorkspace() {
  if (typeof parsedPieces !== "undefined") parsedPieces = [];
  window._cleanDxfPieces = [];
  window._menu1MasterOrderMap = {};
  window._spreadColorways = {};
  if (typeof excelColorways !== "undefined") excelColorways = {};
  if (typeof bomTemplates !== "undefined") bomTemplates = {};
  if (typeof generatedCanvases !== "undefined") generatedCanvases = [];
  if (typeof colorwayList !== "undefined") colorwayList = [];
  if (typeof activeColorwayIdx !== "undefined") activeColorwayIdx = 0;
  if (typeof currentColorwayName !== "undefined") currentColorwayName = "";
  if (typeof dxfFileName !== "undefined") dxfFileName = "";

  ["dxfInput", "excelInput", "reiExcelInput", "luluExcelInput", "spreadInput"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const dxfSt = document.getElementById("dxfStatus");
  if (dxfSt) dxfSt.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f5d4" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>DXF';
  const excSt = document.getElementById("excelStatus");
  if (excSt) excSt.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>JACJI JANSPORT';
  const reiSt = document.getElementById("reiExcelStatus");
  if (reiSt) reiSt.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>JACJI REI';
  const luluSt = document.getElementById("luluExcelStatus");
  if (luluSt) luluSt.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:8px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>JACJI LULU LEMON';
  const sprSt = document.getElementById("spreadStatus");
  if (sprSt) sprSt.textContent = "📋 PLANNING SPREAD JANSPORT (.CSV/.XLSX)";

  document.querySelectorAll(".dropzone.loaded").forEach(z => z.classList.remove("loaded"));

  const cwBox = document.getElementById("colorwayBox");
  if (cwBox) cwBox.classList.add("hidden");
  const cwSel = document.getElementById("colorwaySelect");
  if (cwSel) cwSel.innerHTML = "";

  const resArea = document.getElementById("resultArea");
  if (resArea) resArea.classList.add("hidden");
  const mCont = document.getElementById("markerContainer");
  if (mCont) mCont.innerHTML = "";

  const pList = document.getElementById("pieceMappingList");
  if (pList) pList.innerHTML = '<div class="card-sub">Belum ada file DXF yang dimuat.</div>';
  const dynProc = document.getElementById("dynamicProcessColors");
  if (dynProc) dynProc.innerHTML = '<div class="card-sub">Klik "Buat Mini Marker" terlebih dahulu untuk memunculkan proses.</div>';

  if (typeof switchTab === "function" && !isAutoSyncMode) switchTab("upload");
  window.scrollTo(0, 0);
}

function clearAllLuarLine() {
  if (Array.isArray(parsedPieces)) {
    parsedPieces.forEach(p => { p.processLabel = ""; });
  }
  if (Array.isArray(window._cleanDxfPieces)) {
    window._cleanDxfPieces.forEach(p => { p.processLabel = ""; });
  }
  if (typeof colorwayList !== "undefined" && Array.isArray(colorwayList)) {
    colorwayList.forEach(cw => {
      if (Array.isArray(cw.pieces)) cw.pieces.forEach(p => { p.processLabel = ""; });
    });
  }
  if (window._menu1MasterOrderMap) {
    Object.keys(window._menu1MasterOrderMap).forEach(k => {
      if (window._menu1MasterOrderMap[k]) window._menu1MasterOrderMap[k].processLabel = "";
    });
  }
  if (typeof renderPieceMappingList === "function") renderPieceMappingList();
  if (typeof renderDynamicProcessColors === "function") renderDynamicProcessColors();
  if (typeof generatedCanvases !== "undefined" && generatedCanvases.length > 0 && typeof generateMiniMarker === "function") {
    generateMiniMarker();
  }
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


// === SCREENSAVER CAD PATTERN PLOTTER ===
(function initNeonScreensaver() {
  const c1 = document.getElementById('screensaverCanvas');
  const c2 = document.getElementById('workspaceBgCanvas');
  if (!c1 && !c2) return;
  const tpls = [
    { name: "FRONT PANEL • MA", dim: "37.8 x 20.8 cm", qty: "QTY: 1x", color: "#14b8a6", pts: [{x:-0.55,y:-0.82},{x:0.55,y:-0.82},{x:0.68,y:-0.5},{x:0.68,y:0.68},{x:0.45,y:0.85},{x:-0.45,y:0.85},{x:-0.68,y:0.68},{x:-0.68,y:-0.5}] },
    { name: "SHOULDER STRAP • T1", dim: "63.0 x 18.8 cm", qty: "QTY: A/B", color: "#38bdf8", pts: [{x:-0.25,y:-0.92},{x:0.2,y:-0.92},{x:0.38,y:-0.3},{x:0.32,y:0.35},{x:0.16,y:0.92},{x:-0.2,y:0.92},{x:-0.14,y:0.25},{x:-0.3,y:-0.3}] },
    { name: "SIDE POCKET • N1", dim: "19.2 x 28.0 cm", qty: "QTY: A/B", color: "#818cf8", pts: [{x:-0.6,y:-0.75},{x:0.6,y:-0.75},{x:0.65,y:0.45},{x:0.38,y:0.82},{x:-0.38,y:0.82},{x:-0.65,y:0.45}] },
    { name: "BACK PANEL • L2", dim: "48.0 x 35.0 cm", qty: "QTY: 1x", color: "#34d399", pts: [{x:-0.58,y:-0.85},{x:0.58,y:-0.85},{x:0.72,y:-0.45},{x:0.72,y:0.75},{x:0.5,y:0.88},{x:-0.5,y:0.88},{x:-0.72,y:0.75},{x:-0.72,y:-0.45}] }
  ];
  let slots = [];
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (c1) { c1.width = w; c1.height = h; }
    if (c2) { c2.width = w; c2.height = h; }
    const cols = 2, rows = 3, cw = w / cols, ch = h / rows;
    slots = [];
    for (let i = 0; i < 6; i++) slots.push({ cx: cw * ((i % cols) + 0.5), cy: ch * (Math.floor(i / cols) + 0.5), sc: Math.min(cw, ch) * 0.34, idx: i % tpls.length, p: (i * 0.35) % 2.2 });
  }
  window.addEventListener('resize', resize); resize();

  function tracePoly(ctx, pts, sc, prog) {
    const n = pts.length, ex = Math.min(1, Math.max(0, prog)) * n, full = Math.floor(ex), fr = ex - full;
    ctx.beginPath();
    let p0 = pts.at(0), hx = p0.x * sc, hy = p0.y * sc; ctx.moveTo(hx, hy);
    for (let i = 0; i < Math.min(full, n); i++) { const nx = pts.at((i + 1) % n); hx = nx.x * sc; hy = nx.y * sc; ctx.lineTo(hx, hy); }
    if (full < n) { const c = pts.at(full), nx = pts.at((full + 1) % n); hx = (c.x + (nx.x - c.x) * fr) * sc; hy = (c.y + (nx.y - c.y) * fr) * sc; ctx.lineTo(hx, hy); }
    ctx.stroke();
    return { hx, hy };
  }

  function drawFrame() {
    const sp = document.getElementById('homeSplashScreen');
    const mn = document.getElementById('mainAppScreen');
    const activeCanvas = (sp && !sp.classList.contains('hidden')) ? c1 : ((mn && !mn.classList.contains('hidden')) ? c2 : null);
    if (activeCanvas) {
      const ctx = activeCanvas.getContext('2d');
      ctx.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
      slots.forEach(s => {
        s.p += 0.004;
        if (s.p > 2.2) { s.p = 0; s.idx = (s.idx + 1) % tpls.length; }
        const t = tpls[s.idx];
        const fade = s.p > 1.9 ? Math.max(0, 1 - (s.p - 1.9) / 0.3) : 1;
        ctx.save(); ctx.translate(s.cx, s.cy); ctx.globalAlpha = 0.38 * fade; ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5; ctx.setLineDash([]);
        const h1 = tracePoly(ctx, t.pts, s.sc, s.p / 0.7);
        ctx.strokeStyle = t.color;
        if (s.p < 0.7) {
          ctx.globalAlpha = 0.9; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(h1.hx, h1.hy, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        if (s.p >= 0.7) {
          ctx.globalAlpha = 0.24 * fade; ctx.lineWidth = 0.9; ctx.setLineDash([4, 4]);
          const h2 = tracePoly(ctx, t.pts, s.sc * 0.85, (s.p - 0.7) / 0.55);
          ctx.setLineDash([]);
          if (s.p < 1.25) {
            ctx.globalAlpha = 0.85; ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(h2.hx, h2.hy, 2.2, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (s.p >= 1.25) {
          const gp = Math.min(1, (s.p - 1.25) / 0.3), gy = s.sc * 0.45;
          ctx.globalAlpha = 0.35 * fade; ctx.lineWidth = 1.1;
          ctx.beginPath(); ctx.moveTo(0, -gy); ctx.lineTo(0, -gy + (gy * 2 * gp)); ctx.stroke();
          if (gp >= 0.95) {
            ctx.beginPath(); ctx.moveTo(-4, -gy + 5); ctx.lineTo(0, -gy); ctx.lineTo(4, -gy + 5);
            ctx.moveTo(-4, gy - 5); ctx.lineTo(0, gy); ctx.lineTo(4, gy - 5); ctx.stroke();
          }
        }
        if (s.p >= 1.55) {
          ctx.globalAlpha = 0.45 * fade; ctx.fillStyle = t.color; ctx.font = "600 9px Inter,sans-serif"; ctx.textAlign = "center";
          ctx.fillText(t.name, 0, -6);
          ctx.globalAlpha = 0.3 * fade;
          ctx.fillText(t.dim + " | " + t.qty, 0, 7);
        }
        ctx.restore();
      });
    }
    requestAnimationFrame(drawFrame);
  }
  drawFrame();
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
        document.getElementById('spreadStatus').innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Color Planning Spread siap)';
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
        appendSyncLog('📋 Planning Spread dimuat: ' + cwKeys.length + ' Color mengikuti susunan Menu 1.');
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
  const idxOrder = hdr.findIndex(h => /Order\s*No$/i.test(h));
  const idxStyle = hdr.findIndex(h => /Style\s*No$/i.test(h));
  const idxStyleName = hdr.findIndex(h => /Style\s*Name$/i.test(h));
  const idxColorCode = hdr.findIndex(h => /Style\s*Color$/i.test(h));
  const idxStyleColorName = hdr.findIndex(h => /Style\s*Color\s*Name$/i.test(h));
  const idxQty = hdr.findIndex(h => /Style\s*Qty$/i.test(h));
  const idxSpec = hdr.findIndex(h => /ItemName&Spec/i.test(h));
  const idxColName = hdr.findIndex(h => /^ColorName$/i.test(h));
  const idxFA = hdr.findIndex(h => /F\/?A$/i.test(h));
  const idxPcs = hdr.findIndex(h => /PCS$/i.test(h));
  const idxKode = hdr.findIndex(h => /^Kode$/i.test(h));

  const normStyle = (s) => String(s || '').replace(/\s*\([^)]*\)/g, '').trim().toUpperCase().replace(/^JSOA/, 'JS0A');
  const inpStyle = normStyle(document.getElementById('styleNoInput')?.value || '');
  const bomList = Object.values(bomTemplates || excelColorways || {}).filter(c => !c.isMasterOrder);
  const bomFirstSheet = bomList.at(0)?.sheetName || '';
  const mBomStyle = String(bomFirstSheet).toUpperCase().match(/(?:JS[A-Z0-9]{5,10}|\b\d{5}\b)/);
  let targetStyleClean = normStyle(inpStyle || currentStyleName || (mBomStyle ? mBomStyle.at(0) : ''));
  if (targetStyleClean === 'MINI_MARKER' || targetStyleClean === 'SAMPLE') targetStyleClean = normStyle(mBomStyle ? mBomStyle.at(0) : '');

  // Ekstrak kode angka 5-digit REI (misal 24654 dari "24654 TRAIL 25L-XXL-4XL") & rentang ukuran jika ada
  const mReiNum = targetStyleClean.match(/\b(\d{5})\b/);
  const reiBaseNum = mReiNum ? mReiNum.at(1) : '';
  const mSizeRange = targetStyleClean.match(/\b(XXL-4XL|XS-XL|L-XL|S-M|XXL-3XL|1X-4X|1X-3X|M-XL|XS-S)\b/);
  const targetSizeRange = mSizeRange ? mSizeRange.at(1) : '';
  const base8 = targetStyleClean.slice(0, 8);

  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 5 && String(r.at(idxStyle) || '').trim());
  let matched = [];
  if (targetStyleClean) {
    matched = dataRows.filter(r => {
      const rowStyle = normStyle(r.at(idxStyle));
      const rowStyleName = idxStyleName !== -1 ? normStyle(r.at(idxStyleName)) : '';
      if (reiBaseNum) {
        const hasNum = rowStyle.startsWith(reiBaseNum + '/') || rowStyle === reiBaseNum || rowStyle.includes(reiBaseNum);
        if (!hasNum) return false;
        if (targetSizeRange) {
          const compactRow = (rowStyle + ' ' + rowStyleName).replace(/\s+/g, '');
          return compactRow.includes(targetSizeRange.replace(/\s+/g, ''));
        }
        return true;
      }
      return rowStyle === targetStyleClean
          || rowStyle.includes(targetStyleClean)
          || targetStyleClean.includes(rowStyle)
          || (base8.length >= 7 && rowStyle.startsWith(base8));
    });
  }
  if (targetStyleClean && matched.length === 0) {
    alert("Style No '" + targetStyleClean + "' tidak ditemukan di file Planning Spread ini.");
    return false;
  }
  if (matched.length === 0) { alert('Style No tidak cocok dengan isi file Planning Spread JanSport.'); return false; }
  const activeRows = matched;
  if (activeRows.length === 0) return false;

  const firstOrder = String(activeRows.at(0).at(idxOrder) || '').trim().toUpperCase();
  if (firstOrder && document.getElementById('orderNoInput')) document.getElementById('orderNoInput').value = firstOrder;

  // Peta pencocokan Material Spec JACJI -> Kode Fabric (untuk format REI yang tidak punya kolom Kode)
  const bomSpecToFab = [];
  if (bomList.at(0) && bomList.at(0).fabricSpecs) {
    Object.entries(bomList.at(0).fabricSpecs).forEach(([fKey, fDesc]) => {
      const prefix = String(fDesc || '').split('(').at(0).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 18);
      if (prefix.length >= 6) bomSpecToFab.push({ fab: fKey, prefix });
    });
  }

  const spreadMap = {};
  activeRows.forEach(r => {
    const rawStyle = String(r.at(idxStyle) || '').replace(/\s*\([^)]*\)/g, '').trim().toUpperCase();
    const cwCode = String(r.at(idxColorCode) || '').trim().toUpperCase();
    const styleColName = idxStyleColorName !== -1 ? String(r.at(idxStyleColorName) || '').trim().toUpperCase() : '';
    const spec = String(r.at(idxSpec) || '').trim().toUpperCase();
    const colName = String(r.at(idxColName) || '').trim().toUpperCase();
    const kodeRaw = idxKode !== -1 ? String(r.at(idxKode) || '').trim().toUpperCase() : '';
    const qtyVal = String(r.at(idxQty) || '').trim();
    const faVal = parseFloat(r.at(idxFA)) || 0;
    const pcsVal = parseInt(r.at(idxPcs)) || 0;
    if (!cwCode || !spec) return;

    const cwKey = rawStyle + '_' + cwCode;
    const displayColor = styleColName || (colName.endsWith(cwCode) ? colName : (colName + ' ' + cwCode));
    if (!spreadMap[cwKey]) {
      spreadMap[cwKey] = {
        cwCode,
        styleColorName: styleColName,
        cleanColor: displayColor,
        sheetName: rawStyle + ' (' + qtyVal + ' PCS)',
        styleNo: rawStyle,
        styleQty: qtyVal,
        pieces: [], fabricSpecs: {}, fabricPcs: {}, faMap: {}, faList: [], allowedFabrics: [], isMasterOrder: true
      };
    }

    let fabCode = '';
    const mKode = kodeRaw.match(/\b(MA|T1|T2|T3|T5|L2|N[1-7])\b/);
    if (mKode) {
      fabCode = mKode.at(1);
    } else if (bomSpecToFab.length > 0) {
      const cleanSpec = spec.replace(/[^A-Z0-9]/g, '');
      const hit = bomSpecToFab.find(b => cleanSpec.includes(b.prefix) || b.prefix.includes(cleanSpec.slice(0, 14)));
      if (hit) fabCode = hit.fab;
    }
    if (!fabCode) {
      if (/NON-WOVEN/i.test(spec)) fabCode = 'T3';
      else if (/200D.*EMBOSSED|SOLUTION DYE|OXFORD.*20GR|70D.*SILICON/i.test(spec)) fabCode = 'L2';
      else if (/MESH|AIRMESH/i.test(spec)) fabCode = 'N1';
      else if (/PU LEATHER|SUEDE|400D/i.test(spec)) fabCode = 'T1';
      else if (spreadMap[cwKey].fabricSpecs['MA']) fabCode = 'T1';
      else fabCode = 'MA';
    }

    if (!styleColName && (colName.endsWith(' ' + cwCode) || colName === cwCode)) spreadMap[cwKey].cleanColor = colName;
    spreadMap[cwKey].fabricSpecs[fabCode] = spec + (colName ? ' (' + colName + ')' : '');
    if (pcsVal > 0) spreadMap[cwKey].fabricPcs[fabCode] = pcsVal;
    if (faVal > 0) { spreadMap[cwKey].faMap[fabCode] = faVal; spreadMap[cwKey].faList.push(faVal); }
    if (!spreadMap[cwKey].allowedFabrics.includes(fabCode)) spreadMap[cwKey].allowedFabrics.push(fabCode);
  });
  const _okSp = matchSpreadWithBomFA(spreadMap); if (_okSp) window._spreadColorways = JSON.parse(JSON.stringify(excelColorways)); return _okSp;
}

function matchSpreadWithBomFA(spreadMap) {
  const allSpread = Object.values(spreadMap);
  const bomEntries = Object.values(bomTemplates);
  const paired = bomEntries.map(b => {
    const normCol = (s) => String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const m = allSpread.find(sp =>
      b.cleanColor.includes(sp.cwCode)
      || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')')
      || (sp.styleColorName && normCol(b.cleanColor) === normCol(sp.styleColorName))
    );
    return { jacji: b, cwCode: m ? m.cwCode : '', faMap: m ? m.faMap : {}, faList: m ? m.faList : [] };
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
    if (!chosen && bomEntries.length > 0) chosen = { jacji: bomEntries.at(0), cwCode: 'DEFAULT' };
    sp.pieces = chosen ? JSON.parse(JSON.stringify(chosen.jacji.pieces)) : [{ fabric: 'MA', name: 'SPREAD_ONLY', raw: 'SPREAD_ONLY', codes: [], size: '0*0', qty: 1 }];
    const baseSpecs = chosen && chosen.jacji && chosen.jacji.fabricSpecs ? JSON.parse(JSON.stringify(chosen.jacji.fabricSpecs)) : {};
    const spreadSpecs = sp.fabricSpecs ? JSON.parse(JSON.stringify(sp.fabricSpecs)) : {};
    const mergedSpecs = Object.assign({}, baseSpecs, spreadSpecs);

    if (chosen && chosen.cwCode && chosen.cwCode !== sp.cwCode) {
      sp.clonedFrom = chosen.cwCode;
      sp.sheetName = sp.styleNo + ' | Tiru F/A: ' + chosen.cwCode;
      const oldColorName = (chosen.jacji.cleanColor || "").toUpperCase();
      // Bersihkan sisa kode warna & nama warna color lain pada keterangan fabric yang tidak ada di spreadSpecs
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

function normalizeBomFabricCode(rawCat) {
  const up = String(rawCat || '').trim().toUpperCase();
  if (/^MA(?:-|$)/.test(up)) return 'MA';
  if (/^T1(?:-|$)/.test(up)) return 'T1';
  if (/^T2(?:-|$)/.test(up)) return 'T2';
  if (/^T3(?:-|$)/.test(up)) return 'T3';
  if (/^(?:L1|L2|L3)(?:-|$)/.test(up)) return 'L2';
  if (/^(?:N1|N2|N3)(?:-|$)/.test(up)) return 'N1';
  return '';
}

function parseBomZNZFormat(workbook) {
  let added = 0;
  let styleTitle = "";
  workbook.SheetNames.forEach(sheetName => {
    if (/^(WEB|FORM)/i.test(sheetName.trim())) return;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    let hdrMap = null;
    let colorHeaderName = '';
    let horizontalColorCols = []; // Untuk format JACJI REI (kolom warna berjajar ke samping)
    let blockIdx = 0;
    let currentCwKey = sheetName;
    let inheritedMatByCat = {};

    rows.forEach(row => {
      const lineStr = row.join(' ');
      const mStyleJs = lineStr.match(/#?(JS[A-Z0-9]{5,10})\b/i);
      const mStyleRei = lineStr.match(/STYLE\s*NO\s*:\s*[^#]*#([A-Z0-9\-\s]+?)(?:DATE|$)/i);
      if (mStyleJs && mStyleJs.at(1)) {
        styleTitle = mStyleJs.at(1).toUpperCase();
      } else if (mStyleRei && mStyleRei.at(1)) {
        styleTitle = mStyleRei.at(1).trim().toUpperCase();
      }
      if (styleTitle && document.getElementById('styleNoInput') && !document.getElementById('styleNoInput').value) {
        document.getElementById('styleNoInput').value = styleTitle;
      }

      const catIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'category');
      const sizeIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'size');
      if (catIdx !== -1 && sizeIdx !== -1) {
        blockIdx++;
        inheritedMatByCat = {};
        const annotIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'annotation');
        const annotEngIdx = row.findIndex(c => String(c || '').trim().toLowerCase().startsWith('annotation(eng'));
        const qtyIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'qty');
        const matIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'material name');
        const specIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'spec');
        const remarkIdx = row.findIndex(c => String(c || '').trim().toLowerCase() === 'remark');
        const lengthIdx = row.findIndex(c => /^length$/i.test(String(c || '').trim()));
        const colIdx = row.findIndex(c => /^color\s+/i.test(String(c || '').trim()));

        hdrMap = {
          annot: annotIdx,
          annotEng: annotEngIdx !== -1 ? annotEngIdx : (annotIdx !== -1 ? annotIdx + 1 : 1),
          cat: catIdx,
          qty: qtyIdx !== -1 ? qtyIdx : 4,
          size: sizeIdx,
          mat: matIdx !== -1 ? matIdx : 6,
          spec: specIdx !== -1 ? specIdx : 7,
          color: colIdx !== -1 ? colIdx : 12
        };

        // Cek apakah format REI (banyak kolom nama warna antara Remark dan LENGTH)
        horizontalColorCols = [];
        if (colIdx === -1 && remarkIdx !== -1 && lengthIdx > remarkIdx + 1) {
          for (let c = remarkIdx + 1; c < lengthIdx; c++) {
            const cTitle = String(row.at(c) || '').trim().toUpperCase();
            if (cTitle && cTitle !== 'UNIT') horizontalColorCols.push({ idx: c, name: cTitle });
          }
        }

        const rawHdr = colIdx !== -1 ? String(row.at(colIdx) || '').trim() : '';
        const mCol = rawHdr.match(/^Color\s+(.+)$/i);
        colorHeaderName = mCol ? mCol.at(1).trim().toUpperCase() : sheetName.replace(/^FAB-/i, '').trim().toUpperCase();
        currentCwKey = blockIdx === 1 ? sheetName : `${sheetName} #${blockIdx}`;
        return;
      }

      if (!hdrMap) return;
      const rawCat = String(row.at(hdrMap.cat) || '').trim().toUpperCase();
      const normFab = normalizeBomFabricCode(rawCat);
      const sizeStr = String(row.at(hdrMap.size) || '').trim();
      if (!normFab || !/^\d+(\.\d+)?\s*[*xX]\s*\d+(\.\d+)?/.test(sizeStr)) return;

      const shortCode = hdrMap.annot !== -1 ? String(row.at(hdrMap.annot) || '').trim().toUpperCase() : '';
      const engDesc = String(row.at(hdrMap.annotEng) || '').trim();
      const compRaw = engDesc && engDesc !== '_' ? engDesc : shortCode;
      if (!compRaw) return;

      const parts = sizeStr.split(/[*xX]/).map(s => s.trim());
      const qty = Math.round(parseFloat(row.at(hdrMap.qty))) || parseInt(parts.at(2)) || 1;
      const mCode = compRaw.match(/_([A-Z]{1,3}\d{2}[A-Z]?)\b/i) || compRaw.match(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?)\b/i);
      const codes = mCode ? mCode.at(1).toUpperCase().split(/[&,]/).map(s => s.trim()) : [];
      if (shortCode && shortCode !== '_') codes.push(shortCode);

      let cleanName = compRaw
        .replace(/_[A-Z]{1,3}\d{2}[A-Z]?$/i, '')
        .replace(/-(M\d{2}|O\d{2}|B\d{2}[A-Z]?|SS\d{2}[A-Z]?).*$/i, '')
        .trim().toUpperCase();
      const segs = cleanName.split('-').map(s => s.trim()).filter(Boolean);
      if (segs.length >= 2 && (shortCode ? segs.at(0) === shortCode : segs.at(0).length <= 6)) {
        if (shortCode && segs.at(0) === shortCode) cleanName = segs.at(1);
      }

      const matName = String(row.at(hdrMap.mat) || '').trim().toUpperCase();
      const matSpec = String(row.at(hdrMap.spec) || '').trim().toUpperCase();
      if (matName && matName !== '_' && !/^GIỐNG/i.test(matName)) {
        inheritedMatByCat[normFab] = { matName, matSpec };
      }

      // Cabang A: Format JACJI REI (Multi-Color berjajar ke samping: BLACK, SHADOW BAY, OAK BROWN, dst.)
      if (horizontalColorCols.length > 0) {
        horizontalColorCols.forEach(cCol => {
          const cwKeyRei = `${sheetName}_${cCol.name}`;
          if (!excelColorways[cwKeyRei]) {
            excelColorways[cwKeyRei] = {
              cleanColor: cCol.name,
              sheetName: styleTitle ? `${styleTitle} (${cCol.name})` : cCol.name,
              pieces: [],
              fabricSpecs: {}
            };
          }
          const cellColorVal = String(row.at(cCol.idx) || '').trim().toUpperCase() || cCol.name;
          const inh = inheritedMatByCat[normFab];
          if (inh && !excelColorways[cwKeyRei].fabricSpecs[normFab]) {
            excelColorways[cwKeyRei].fabricSpecs[normFab] = `${inh.matName} ${inh.matSpec} (${cellColorVal})`.replace(/\s+/g, ' ').trim();
          }
          excelColorways[cwKeyRei].pieces.push({
            fabric: normFab,
            name: cleanName || compRaw.toUpperCase(),
            raw: compRaw.toUpperCase(),
            codes,
            size: parts.at(0) + '*' + parts.at(1),
            qty
          });
          added++;
        });
        return;
      }

      // Cabang B: Format JACJI JanSport (Consumption Reg Dtl2)
      if (!excelColorways[currentCwKey]) {
        excelColorways[currentCwKey] = {
          cleanColor: colorHeaderName || currentCwKey,
          sheetName: styleTitle ? `${styleTitle} (${colorHeaderName || currentCwKey})` : currentCwKey,
          pieces: [],
          fabricSpecs: {}
        };
      }

      const matCol = String(row.at(hdrMap.color) || '').trim().toUpperCase();
      if (normFab === 'MA' && matCol && matCol !== '_' && !/^GIỐNG/i.test(matCol)) {
        excelColorways[currentCwKey].cleanColor = matCol;
        excelColorways[currentCwKey].sheetName = styleTitle ? `${styleTitle} (${matCol})` : matCol;
      }
      if (matName && matName !== '_' && !/^GIỐNG/i.test(matName)) {
        const fullSpec = (matName + ' ' + matSpec + (matCol && matCol !== '_' ? ' (' + matCol + ')' : '')).replace(/\s+/g, ' ').trim();
        excelColorways[currentCwKey].fabricSpecs[normFab] = fullSpec;
      }

      excelColorways[currentCwKey].pieces.push({
        fabric: normFab,
        name: cleanName || shortCode || compRaw.toUpperCase(),
        raw: (shortCode + ' ' + compRaw).toUpperCase(),
        codes,
        size: parts.at(0) + '*' + parts.at(1),
        qty
      });
      added++;
    });
  });
  return added > 0;
}

function handleExcelUpload(event, buyerTag) {
  window._activeJacjiBuyer = buyerTag || 'JANSPORT';
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
      let cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      if (cwKeys.length === 0 && typeof parseBomZNZFormat === 'function') {
        parseBomZNZFormat(workbook);
        cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
      }
      if (cwKeys.length > 0) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        const isRei = (buyerTag === 'REI');
        document.getElementById(isRei ? 'reiExcelZone' : 'excelZone')?.classList.add('loaded');
        const stEl = document.getElementById(isRei ? 'reiExcelStatus' : 'excelStatus');
        if (stEl) stEl.innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Color ' + (isRei ? 'REI' : 'JanSport') + ' siap)';
        applyColorwayMapping();
      } else {
        alert("Tidak ditemukan tabel komponen fabric (VAI/FAB) pada file JACJI ini.");
      }
    } catch (err) {
      alert("Error membaca Excel JACJI: " + err.message);
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
      // Deteksi otomatis pergeseran +1 kolom (seperti pada JACJI ZNZ yang memiliki kolom Piece No / merge cell)
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


function handlePlanningReiUpload(event) {
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames.at(0)], { header: 1, defval: '' });
      if (Object.keys(bomTemplates).length === 0 && Object.keys(excelColorways).length > 0 && !Object.values(excelColorways).at(0).isMasterOrder) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
      }
      if (parsePlanningReiRows(rows)) {
        const cwKeys = Object.keys(excelColorways);
        const sel = document.getElementById('colorwaySelect');
        if (sel) sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox')?.classList.remove('hidden');
        document.getElementById('spreadReiZone')?.classList.add('loaded');
        const stEl = document.getElementById('spreadReiStatus');
        if (stEl) stEl.innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Color REI siap)';
        if (typeof appendSyncLog === 'function') appendSyncLog('🏔️ Planning REI dimuat: ' + cwKeys.length + ' Color siap di-Auto Sync.');
        if (typeof applyColorwayMapping === 'function') applyColorwayMapping();
      } else {
        alert("Format Planning REI tidak dikenali atau Style No tidak ditemukan.");
      }
    } catch (err) { alert("Error membaca file Planning REI: " + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function parsePlanningReiRows(rows) {
  const headerIdx = rows.findIndex(r => r.some(c => /Order\s*No/i.test(String(c))) && r.some(c => /ItemName&Spec/i.test(String(c))));
  if (headerIdx === -1) return false;
  const hdr = rows.at(headerIdx).map(h => String(h || '').trim());
  const idxOrder = hdr.findIndex(h => /Order\s*No$/i.test(h));
  const idxStyle = hdr.findIndex(h => /Style\s*No$/i.test(h));
  const idxStyleName = hdr.findIndex(h => /Style\s*Name$/i.test(h));
  const idxColorCode = hdr.findIndex(h => /Style\s*Color$/i.test(h));
  const idxStyleColorName = hdr.findIndex(h => /Style\s*Color\s*Name$/i.test(h));
  const idxQty = hdr.findIndex(h => /Style\s*Qty$/i.test(h));
  const idxSpec = hdr.findIndex(h => /ItemName&Spec/i.test(h));
  const idxColName = hdr.findIndex(h => /^ColorName$/i.test(h));
  const idxFA = hdr.findIndex(h => /F\/?A$/i.test(h));
  const idxPcs = hdr.findIndex(h => /PCS$/i.test(h));

  const norm = (s) => String(s || '').replace(/\s*\([^)]*\)/g, '').trim().toUpperCase();
  const inpStyle = norm(document.getElementById('styleNoInput')?.value || '');
  const bomList = Object.values(bomTemplates || excelColorways || {}).filter(c => !c.isMasterOrder);
  const allTextHint = (inpStyle + ' ' + String(currentStyleName || '') + ' ' + bomList.map(b => b.sheetName || '').join(' ')).toUpperCase();
  const mNum = allTextHint.match(/(?:^|[^0-9])(\d{5})(?:[^0-9]|$)/);
  const reiBaseNum = mNum ? mNum.at(1) : '';
  const mRng = allTextHint.match(/(XXL-4XL|XS-XL|L-XL|S-M|XXL-3XL|1X-4X|1X-3X|M-XL|XS-S)/);
  const targetSizeRange = mRng ? mRng.at(1) : '';

  const dataRows = rows.slice(headerIdx + 1).filter(r => r.length > 5 && String(r.at(idxStyle) || '').trim());
  if (!reiBaseNum) {
    alert("Kode Style 5-digit REI (contoh: 24654) belum terisi di kotak STYLE NO atau JACJI.");
    return false;
  }
  let matched = dataRows.filter(r => {
    const rs = norm(r.at(idxStyle));
    const rsn = idxStyleName !== -1 ? norm(r.at(idxStyleName)) : '';
    if (!rs.includes(reiBaseNum)) return false;
    return targetSizeRange ? (rs + ' ' + rsn).replace(/\s+/g, '').includes(targetSizeRange.replace(/\s+/g, '')) : true;
  });
  if (matched.length === 0) {
    matched = dataRows.filter(r => norm(r.at(idxStyle)).includes(reiBaseNum));
  }
  if (matched.length === 0) return false;

  const firstOrder = String(matched.at(0).at(idxOrder) || '').trim().toUpperCase();
  if (firstOrder && document.getElementById('orderNoInput')) document.getElementById('orderNoInput').value = firstOrder;

  const bomSpecToFab = [];
  if (bomList.at(0)?.fabricSpecs) {
    Object.entries(bomList.at(0).fabricSpecs).forEach(([fKey, fDesc]) => {
      const prefix = String(fDesc || '').split('(').at(0).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 18);
      if (prefix.length >= 6) bomSpecToFab.push({ fab: fKey, prefix });
    });
  }

  const spreadMap = {};
  matched.forEach(r => {
    const rawStyle = norm(r.at(idxStyle));
    const cwCode = String(r.at(idxColorCode) || '').trim().toUpperCase();
    const styleColName = idxStyleColorName !== -1 ? String(r.at(idxStyleColorName) || '').trim().toUpperCase() : '';
    const spec = String(r.at(idxSpec) || '').trim().toUpperCase();
    const colName = String(r.at(idxColName) || '').trim().toUpperCase();
    const qtyVal = String(r.at(idxQty) || '').trim();
    const faVal = parseFloat(r.at(idxFA)) || 0;
    const pcsVal = parseInt(r.at(idxPcs)) || 0;
    if (!cwCode || !spec) return;

    const cwKey = rawStyle + '_' + cwCode;
    if (!spreadMap[cwKey]) {
      spreadMap[cwKey] = {
        cwCode, styleColorName: styleColName, cleanColor: styleColName || cwCode,
        sheetName: rawStyle + ' (' + qtyVal + ' PCS)', styleNo: rawStyle, styleQty: qtyVal,
        pieces: [], fabricSpecs: {}, fabricPcs: {}, faMap: {}, faList: [], allowedFabrics: [], isMasterOrder: true
      };
    }
    let fabCode = '';
    if (bomSpecToFab.length > 0) {
      const cleanSpec = spec.replace(/[^A-Z0-9]/g, '');
      const hit = bomSpecToFab.find(b => cleanSpec.includes(b.prefix) || b.prefix.includes(cleanSpec.slice(0, 14)));
      if (hit) fabCode = hit.fab;
    }
    if (!fabCode) {
      if (/NON-WOVEN/i.test(spec)) fabCode = 'T3';
      else if (/200D.*OXFORD|70D.*SILICON|SOLUTION DYE/i.test(spec)) fabCode = 'L2';
      else if (/MESH|AIRMESH/i.test(spec)) fabCode = 'N1';
      else if (/400D|PU LEATHER|SUEDE/i.test(spec)) fabCode = 'T1';
      else if (spreadMap[cwKey].fabricSpecs['MA']) fabCode = 'T1';
      else fabCode = 'MA';
    }
    spreadMap[cwKey].fabricSpecs[fabCode] = spec + (colName ? ' (' + colName + ')' : '');
    if (pcsVal > 0) spreadMap[cwKey].fabricPcs[fabCode] = pcsVal;
    if (faVal > 0) { spreadMap[cwKey].faMap[fabCode] = faVal; spreadMap[cwKey].faList.push(faVal); }
    if (!spreadMap[cwKey].allowedFabrics.includes(fabCode)) spreadMap[cwKey].allowedFabrics.push(fabCode);
  });
  const _okSp = matchSpreadWithBomFA(spreadMap); if (_okSp) window._spreadColorways = JSON.parse(JSON.stringify(excelColorways)); return _okSp;
}


function stepFontVal(id, d) {
  const el = document.getElementById(id); if (!el) return;
  el.value = Math.min(parseInt(el.max)||72, Math.max(parseInt(el.min)||8, (parseInt(el.value)||14) + d));
  if (typeof renderPreviewSilent === "function") renderPreviewSilent();
  else if (typeof generateMiniMarker === "function") generateMiniMarker();
}
function stepSelectVal(id, d) {
  const s = document.getElementById(id); if (!s || !s.options) return;
  s.selectedIndex = Math.min(s.options.length - 1, Math.max(0, s.selectedIndex + d));
  if (typeof renderPreviewSilent === "function") renderPreviewSilent();
  else if (typeof generateMiniMarker === "function") generateMiniMarker();
}


window.openSaveScopeModal = function() {
  const m = document.getElementById("saveScopeModal");
  if (!m) {
    if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(true);
    return;
  }
  m.classList.remove("hidden");
  m.style.display = "flex";
};

window.closeSaveScopeModal = function() {
  const m = document.getElementById("saveScopeModal");
  if (!m) return;
  m.classList.add("hidden");
  m.style.display = "none";
};

window.applySaveWithScope = function(scope) {
  window.closeSaveScopeModal();
  if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
  const curKey = document.getElementById("colorwaySelect")?.value || currentColorwayName || "DEFAULT";
  const snap = JSON.parse(JSON.stringify(parsedPieces || []));
  window._cwCustomOverrides = window._cwCustomOverrides || {};

  if (scope === "current") {
    window._cwCustomOverrides[curKey] = snap;
    if (excelColorways && excelColorways[curKey]) excelColorways[curKey].customPieces = snap;
    renderPreviewSilent();
    alert("✅ Perubahan disimpan untuk color: " + (currentColorwayName || curKey));
  } else {
    window._cleanDxfPieces = JSON.parse(JSON.stringify(snap));
    [excelColorways, bomTemplates, window._spreadColorways].forEach(store => {
      if (!store || typeof store !== "object") return;
      Object.keys(store).forEach(k => {
        window._cwCustomOverrides[k] = JSON.parse(JSON.stringify(snap));
        store[k].customPieces = JSON.parse(JSON.stringify(snap));
      });
    });
    renderPreviewSilent();
    alert("✅ Semua perubahan berhasil disimpan untuk SEMUA Color!");
  }
};

// === MENU AKSES HASIL DOWNLOAD LANGSUNG & KUNCI ANTI-LOMPAT TOMBOL + / - ===
window._sessionDownloadBlobs = window._sessionDownloadBlobs || {};

function registerDownloadedFile(fileName, locationText, dataUrlOrBlob) {
  try {
    let urlObj = "";
    if (typeof dataUrlOrBlob === "string") {
      urlObj = dataUrlOrBlob;
    } else if (dataUrlOrBlob instanceof Blob) {
      urlObj = URL.createObjectURL(dataUrlOrBlob);
    }
    if (urlObj) window._sessionDownloadBlobs[fileName] = { url: urlObj, raw: dataUrlOrBlob };

    let list = JSON.parse(localStorage.getItem("mm_downloads") || "[]");
    list = list.filter(x => x.name !== fileName);
    const now = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " · " + new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    list.unshift({ name: fileName, location: locationText || "Download/MiniMarker", time: now });
    localStorage.setItem("mm_downloads", JSON.stringify(list.slice(0, 30)));
    renderDownloadRegistry();
  } catch (e) {}
}

function renderDownloadRegistry() {
  const el = document.getElementById("downloadRegistryList");
  if (!el) return;
  const list = JSON.parse(localStorage.getItem("mm_downloads") || "[]");
  if (list.length === 0) {
    el.innerHTML = '<div class="card-sub">Belum ada file yang diunduh pada sesi ini. Silakan Export PDF, PNG, atau ZIP terlebih dahulu.</div>';
    return;
  }
  el.innerHTML = list.map((item, i) => `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:9px 0; border-bottom:1px solid #231f42;">
      <div style="flex:1; min-width:0;">
        <div style="font-size:12px; font-weight:800; color:#fff; word-break:break-all;">📄 ${item.name}</div>
        <div style="font-size:10px; color:var(--muted); margin-top:2px;">📁 ${item.location} · ${item.time}</div>
      </div>
      <button type="button" onclick="openDownloadedItem(${i})" style="background:var(--neon-cyan); color:#07060e; border:none; border-radius:8px; padding:7px 10px; font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap;">📂 BUKA</button>
    </div>
  `).join("");
}

async function openDownloadedItem(idx) {
  const list = JSON.parse(localStorage.getItem("mm_downloads") || "[]");
  const item = list[idx];
  if (!item) return;

  // 1. Jika di APK Android, buka langsung via Capacitor Share/File Opener dari folder Download/MiniMarker
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
      const { Filesystem, Share } = window.Capacitor.Plugins || {};
      if (Filesystem && Share) {
        const uriRes = await Filesystem.getUri({ path: "Download/MiniMarker/" + item.name, directory: "EXTERNAL_STORAGE" });
        await Share.share({ title: item.name, url: uriRes.uri });
        return;
      }
    } catch (e) {
      alert("File tersimpan di: " + item.location);
      return;
    }
  }

  // 2. Jika di Browser / PC Portable, langsung unduh / buka file dari memori sesi
  const cached = window._sessionDownloadBlobs[item.name];
  if (cached && cached.url) {
    const a = document.createElement("a");
    a.href = cached.url;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    alert("File '" + item.name + "' tersimpan di folder Downloads perangkat Anda (" + item.location + ").");
  }
}

function clearDownloadRegistry() {
  localStorage.removeItem("mm_downloads");
  renderDownloadRegistry();
}

// Bungkus saveFileUniversal agar setiap file yang disimpan otomatis masuk ke menu 📥 Download
if (typeof saveFileUniversal === "function" && !window._wrappedSaveUniversal) {
  window._wrappedSaveUniversal = true;
  const _origSaveUniv = saveFileUniversal;
  saveFileUniversal = async function(fileName, blobOrDataUrl, isDataUrl) {
    const res = await _origSaveUniv.apply(this, arguments);
    if (res) registerDownloadedFile(fileName, res, blobOrDataUrl);
    return res;
  };
}

// Perluas switchTab agar mendukung tab 'downloads'
if (typeof switchTab === "function" && !window._wrappedSwitchTabDl) {
  window._wrappedSwitchTabDl = true;
  const _origSwitchTab = switchTab;
  switchTab = function(tabName) {
    const pDl = document.getElementById("panelDownloads");
    const tDl = document.getElementById("tabDownloads");
    if (tabName === "downloads") {
      document.getElementById("panelUpload")?.classList.add("hidden");
      document.getElementById("panelManual")?.classList.add("hidden");
      document.getElementById("tabUpload")?.classList.remove("active");
      document.getElementById("tabManual")?.classList.remove("active");
      if (pDl) pDl.classList.remove("hidden");
      if (tDl) tDl.classList.add("active");
      renderDownloadRegistry();
      return;
    }
    if (pDl) pDl.classList.add("hidden");
    if (tDl) tDl.classList.remove("active");
    _origSwitchTab.apply(this, arguments);
  };
}

// Pastikan tombol + dan - tidak pernah memicu scroll/pindah ke preview
window.stepFontVal = function(id, d) {
  const el = document.getElementById(id);
  if (!el) return;
  const minV = parseInt(el.min) || 8;
  const maxV = parseInt(el.max) || 72;
  el.value = Math.min(maxV, Math.max(minV, (parseInt(el.value) || 14) + d));
  if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
  if (typeof renderPreviewSilent === "function") renderPreviewSilent();
};

window.stepSelectVal = function(id, d) {
  const s = document.getElementById(id);
  if (!s || !s.options || s.options.length === 0) return;
  s.selectedIndex = Math.min(s.options.length - 1, Math.max(0, s.selectedIndex + d));
  if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
  if (typeof renderPreviewSilent === "function") renderPreviewSilent();
};

renderDownloadRegistry();

// === PASTIKAN MODAL EXPORT ZIP SEMUA COLOR SELALU MUNCUL & TOMBOL + / - LANGSUNG UPDATE ===
window.openExportFormatModal = function() {
  let modal = document.getElementById("exportFormatModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "exportFormatModal";
    modal.style.cssText = "position:fixed; inset:0; z-index:999999; background:rgba(5,4,15,0.88); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:16px;";
    modal.innerHTML = `
      <div style="width:100%; max-width:360px; background:#141226; border:1.5px solid var(--neon-cyan); border-radius:14px; padding:18px; box-shadow:0 12px 32px rgba(0,245,212,0.28); text-align:center;">
        <div style="font-size:15px; font-weight:900; color:var(--neon-cyan); margin-bottom:6px;">💾 SAVE SEMUA COLOR (ZIP)</div>
        <div style="font-size:12px; color:var(--muted); margin-bottom:14px;">Pilih format file di dalam arsip ZIP:</div>
        <div style="display:flex; flex-direction:column; gap:9px;">
          <button type="button" class="btn" style="margin:0; padding:12px; font-size:13px;" onclick="document.getElementById('exportFormatModal').style.display='none'; saveAllColorwaysBatch('pdf');">📄 FORMAT PDF (.ZIP)</button>
          <button type="button" class="btn btn-pink" style="margin:0; padding:12px; font-size:13px;" onclick="document.getElementById('exportFormatModal').style.display='none'; saveAllColorwaysBatch('png');">🖼️ FORMAT PNG (.ZIP)</button>
          <button type="button" class="btn btn-secondary" style="margin:0; padding:9px; font-size:12px;" onclick="document.getElementById('exportFormatModal').style.display='none';">BATAL</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.classList.remove("hidden");
  modal.style.display = "flex";
};

function forceInstantCanvasRefresh() {
  if (typeof parsedPieces === "undefined" || parsedPieces.length === 0) return;
  const keepX = window.scrollX, keepY = window.scrollY;
  const origScroll = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function() {};
  const fsModal = document.getElementById("fullScreenModal");
  const isFsOpen = fsModal && !fsModal.classList.contains("hidden") && fsModal.style.display !== "none";
  const origOpenFs = window.openFullPreview;
  if (!isFsOpen && typeof origOpenFs === "function") window.openFullPreview = function() {};
  try {
    if (typeof saveLayoutPreferences === "function") saveLayoutPreferences(false);
    if (typeof generateMiniMarker === "function") generateMiniMarker();
    if (isFsOpen && typeof origOpenFs === "function") origOpenFs();
  } finally {
    Element.prototype.scrollIntoView = origScroll;
    if (origOpenFs) window.openFullPreview = origOpenFs;
    window.scrollTo(keepX, keepY);
  }
}

window.stepFontVal = function(id, d) {
  const el = document.getElementById(id);
  if (!el) return;
  const minV = parseInt(el.min) || 8;
  const maxV = parseInt(el.max) || 72;
  el.value = Math.min(maxV, Math.max(minV, (parseInt(el.value) || 14) + d));
  forceInstantCanvasRefresh();
};

window.stepSelectVal = function(id, d) {
  const s = document.getElementById(id);
  if (!s || !s.options || s.options.length === 0) return;
  s.selectedIndex = Math.min(s.options.length - 1, Math.max(0, s.selectedIndex + d));
  forceInstantCanvasRefresh();
};


// Pastikan bar tabs (termasuk tab 📥 Download) tetap terlihat di mode Auto Sync
if (typeof openToolMode === 'function' && !window._wrappedToolModeTabs) {
  window._wrappedToolModeTabs = true;
  const _origToolMode = openToolMode;
  openToolMode = function(mode) {
    _origToolMode.apply(this, arguments);
    const tabsBar = document.querySelector('.tabs');
    if (tabsBar) tabsBar.classList.remove('hidden');
  };
}

function hexToRgbTuple(hex) {
  const c = String(hex || '#000000').replace('#', '').trim();
  if (c.length !== 6) return [0, 0, 0];
  return [parseInt(c.slice(0, 2), 16) || 0, parseInt(c.slice(2, 4), 16) || 0, parseInt(c.slice(4, 6), 16) || 0];
}
function getPdfFontName(fontFam) {
  const f = String(fontFam || '').toLowerCase();
  if (f.includes('courier')) return 'courier';
  if (f.includes('arial') || f.includes('helvetica') || f.includes('sans')) return 'helvetica';
  return 'times';
}

function buildEditableVectorPdf() {
  const prevOpenFull = window.openFullPreview;
  window.openFullPreview = function() {};
  try { if (typeof generateMiniMarker === "function") generateMiniMarker(); } finally { window.openFullPreview = prevOpenFull; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const CW = 1754, CH = 1240, sx = 297 / CW, sy = 210 / CH;
  const pxToPt = (px) => Number((px * sx * 2.83465).toFixed(2));
  const styleVal = (document.getElementById('styleNoInput')?.value || currentStyleName || 'STYLE').trim().toUpperCase();
  const orderVal = (document.getElementById('orderNoInput')?.value || '').trim().toUpperCase();
  const pdfFont = getPdfFontName(document.getElementById('fontFamilySelect')?.value || '"Times New Roman", serif');
  const titleSize = parseInt(document.getElementById('titleFontSize')?.value) || 38;
  const labelSize = parseInt(document.getElementById('labelFontSize')?.value) || 14;
  const procSize = parseInt(document.getElementById('processFontSize')?.value) || 13;
  const fabSize = parseInt(document.getElementById('fabricFontSize')?.value) || 14;
  const customCols = document.getElementById('colsSelect')?.value || 'auto';
  const customRows = document.getElementById('rowsSelect')?.value || 'auto';
  const cwKey = document.getElementById('colorwaySelect')?.value;
  const jacji = excelColorways[cwKey];
  const bomFabSeq = [];
  if (jacji && Array.isArray(jacji.pieces)) jacji.pieces.forEach(bp => { if (bp.fabric && !bomFabSeq.includes(bp.fabric)) bomFabSeq.push(bp.fabric); });
  const activeFabrics = [...new Set([...bomFabSeq, 'MA', 'T1', 'T2', 'T3', 'L2', 'N1'])].filter(f => parsedPieces.some(p => p.fabric === f));
  const fabricNumberMap = {}; activeFabrics.forEach((f, idx) => { fabricNumberMap[f] = idx + 1; });
  if ((typeof isAutoSyncMode !== 'undefined' && isAutoSyncMode) && window._menu1MasterOrderMap && Object.keys(window._menu1MasterOrderMap).length > 0) {
    parsedPieces.forEach(p => {
      const altKey = String(p.rawText || '').trim().toUpperCase() + '_' + String(p.fabric || '');
      const m = window._menu1MasterOrderMap[p.id] || window._menu1MasterOrderMap[altKey];
      if (m) {
        p.bomOrder = m.order;
        p.fabric = m.fabric;
        p.name = m.name;
        p.sizeText = m.sizeText;
        p.qtyLabel = m.qtyLabel;
        p.processLabel = m.processLabel;
        p.autoRotate90 = m.autoRotate90;
      }
    });
  }
  const sortedPieces = [...parsedPieces].sort((a, b) => {
    const fDiff = (fabricNumberMap[a.fabric] || 99) - (fabricNumberMap[b.fabric] || 99);
    if (fDiff !== 0) return fDiff;
    const oA = typeof a.bomOrder === 'number' ? a.bomOrder : 9999, oB = typeof b.bomOrder === 'number' ? b.bomOrder : 9999;
    return oA !== oB ? oA - oB : (a.id || 0) - (b.id || 0);
  });
  const subCounters = {};
  sortedPieces.forEach(p => { const fn = fabricNumberMap[p.fabric] || 1; subCounters[fn] = (subCounters[fn] || 0) + 1; p.itemNumberLabel = fn + '.' + subCounters[fn]; });
  const sampleBoxW = CW - 72;
  const sampleFooterH = 42 + (activeFabrics.length * Math.max(labelSize + 11, 24));
  const sampleBoxH = CH - 76 - sampleFooterH - 22;
  const dynLayout = computeDynamicGridLayout(sortedPieces, customCols, customRows, sampleBoxW, sampleBoxH, labelSize);
  const cols = dynLayout.cols;
  const rowsPerPage = dynLayout.rowsPerPage;
  const pages = dynLayout.pages;
  const globalUniformScale = dynLayout.globalUniformScale;

  pages.forEach((pagePieces, pageIdx) => {
    if (pageIdx > 0) doc.addPage();
    doc.setTextColor(0, 0, 0); doc.setFont(pdfFont, 'bold');
    const fullTitleText = (styleVal + ' (' + currentColorwayName + ')').replace(/\s+/g, ' ').trim();
    let effTitleSize = titleSize; doc.setFontSize(pxToPt(effTitleSize));
    while (effTitleSize > 16 && doc.getTextWidth(fullTitleText) > ((CW - 80) * sx)) { effTitleSize -= 1; doc.setFontSize(pxToPt(effTitleSize)); }
    const titleLineH = Math.round(effTitleSize * 1.15);
    doc.text(fullTitleText, (CW / 2) * sx, (16 + titleLineH) * sy, { align: 'center' });

    const bomSpecs = (jacji && jacji.fabricSpecs) || {};
    const fabLineH = Math.max(Math.round(fabSize * 1.32), 20), fabHeaderSize = fabSize + 2;
    doc.setFont(pdfFont, 'normal'); doc.setFontSize(pxToPt(fabSize));
    const footerEntries = activeFabrics.map(fab => {
      const num = fabricNumberMap[fab], cnt = sortedPieces.filter(p => p.fabric === fab).length;
      const specText = (bomSpecs[fab] || fab).replace(/\bWIDTH\s*VAI\b|\bWIDTH\b|\bVAI\b/gi, '').replace(/\s+/g, ' ').trim();
      return doc.splitTextToSize(num + '. ' + specText + ' (' + cnt + ' KOMPONEN)', (CW - 80) * sx);
    });
    const footerH = Math.round(fabHeaderSize * 1.5) + (footerEntries.reduce((a, b) => a + Math.max(b.length, 1), 0) * fabLineH) + 14;
    const boxX = 36, boxY = 20 + titleLineH + ((orderVal || pages.length > 1) ? Math.max(labelSize + 14, 24) : 10);
    const boxW = CW - 72, boxH = Math.max(220, CH - boxY - footerH - 18);
    if (orderVal) { doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(labelSize + 3)); doc.text(orderVal, boxX * sx, (boxY - 8) * sy); }
    if (pages.length > 1) { doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(labelSize + 3)); doc.text('HAL ' + (pageIdx + 1) + '/' + pages.length, (boxX + boxW) * sx, (boxY - 8) * sy, { align: 'right' }); }
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(2.5 * sx); doc.rect(boxX * sx, boxY * sy, boxW * sx, boxH * sy);

    const actualRows = rowsPerPage;
    const baseCellW = (boxW - 24) / cols, baseCellH = (boxH - 18) / actualRows;

    pagePieces.forEach((slot) => {
      const piece = slot.piece || slot;
      const col = slot.col || 0, row = slot.row || 0;
      const cSpan = slot.colSpan || 1, rSpan = slot.rowSpan || 1;
      const cellW = baseCellW * cSpan, cellH = baseCellH * rSpan;
      const cx = boxX + 12 + col * baseCellW, cy = boxY + 10 + row * baseCellH;
      const fabNum = piece.itemNumberLabel || String(fabricNumberMap[piece.fabric] || 1);
      const circleR = Math.min(14, baseCellH * 0.075);
      const topSpace = piece.processLabel ? (Math.max(procSize, 10) + 10) : 8;
      const bottomSpace = Math.round(labelSize * 3.0) + 16;
      const leftOffset = (circleR * 2) + 8;
      const rightSpace = piece.qtyLabel ? 6.5 : 2;
      const maxDrawW = Math.max(cellW - leftOffset - rightSpace, 24), maxDrawH = Math.max(cellH - topSpace - bottomSpace, 24);
      const ew = piece.autoRotate90 ? piece.height : piece.width, eh = piece.autoRotate90 ? piece.width : piece.height;
      const isGiant = (cSpan > 1 || rSpan > 1);
      const pairScale = (isGiant ? (piece.maxAllowedScale || globalUniformScale) : Math.min(globalUniformScale, piece.maxAllowedScale || globalUniformScale)) * (piece.customScale || 1);
      const finalW = ew * pairScale, finalH = eh * pairScale;
      const finalX = cx + leftOffset + (maxDrawW - finalW) / 2, finalY = cy + topSpace + (maxDrawH - finalH) / 2;
      const centerDrawX = finalX + finalW / 2;

      const { numCx, numCy } = calcSmartCirclePos(piece, cx, cy, cellW, finalX, finalY, finalW, finalH, circleR);
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(1.8 * sx); doc.circle(numCx * sx, numCy * sy, circleR * sx, 'S');
      doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(Math.round(circleR * (String(fabNum).length >= 4 ? 0.76 : 0.90)))); doc.setTextColor(0, 0, 0);
      doc.text(String(fabNum), numCx * sx, (numCy + Math.round(circleR * 0.35)) * sy, { align: 'center' });

      if (piece.processLabel) {
        const parts = piece.processLabel.toUpperCase().split('-').map(s => s.trim()).filter(Boolean);
        const sep = ' - ', procLeftLimit = numCx + circleR + 6, procRightLimit = cx + cellW - 4;
        const maxProcW = Math.max(procRightLimit - procLeftLimit, 36) * sx;
        let effProcSize = Math.max(procSize, 9);
        doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(effProcSize));
        let totalTextW = parts.reduce((acc, pt) => acc + doc.getTextWidth(pt), 0) + doc.getTextWidth(sep) * Math.max(parts.length - 1, 0);
        while (effProcSize > 7 && totalTextW > maxProcW) {
          effProcSize -= 0.5; doc.setFontSize(pxToPt(effProcSize));
          totalTextW = parts.reduce((acc, pt) => acc + doc.getTextWidth(pt), 0) + doc.getTextWidth(sep) * Math.max(parts.length - 1, 0);
        }
        const sepW = doc.getTextWidth(sep);
        let curTextX = Math.max(procLeftLimit * sx, Math.min((procRightLimit * sx) - totalTextW, (centerDrawX * sx) - (totalTextW / 2)));
        const procY = Math.max(cy + effProcSize + 3, finalY - 5);
        parts.forEach((pt, pIdx) => {
          const rgb = hexToRgbTuple(getProcessColor(pt)); doc.setTextColor(rgb.at(0), rgb.at(1), rgb.at(2)); doc.text(pt, curTextX, procY * sy); curTextX += doc.getTextWidth(pt);
          if (pIdx < parts.length - 1) { doc.setTextColor(100, 116, 139); doc.text(sep, curTextX, procY * sy); curTextX += sepW; }
        });
      }

      (piece.polygons || []).forEach(poly => {
        const pts = poly.pts || []; if (pts.length < 2) return;
        doc.setDrawColor(poly.isOuter ? 0 : 100, poly.isOuter ? 85 : 116, poly.isOuter ? 255 : 139); doc.setLineWidth((poly.isOuter ? 2.1 : 0.9) * sx);
        const mapped = pts.map(pt => [(finalX + (piece.autoRotate90 ? (piece.height - pt.y) : pt.x) * pairScale) * sx, (finalY + (piece.autoRotate90 ? pt.x : pt.y) * pairScale) * sy]);
        for (let i = 0; i < mapped.length - 1; i++) { const p1 = mapped.at(i), p2 = mapped.at(i + 1); doc.line(p1.at(0), p1.at(1), p2.at(0), p2.at(1)); }
        if (poly.isOuter && mapped.length > 2) { const pLast = mapped.at(-1), pFirst = mapped.at(0); doc.line(pLast.at(0), pLast.at(1), pFirst.at(0), pFirst.at(1)); }
      });

      if (piece.qtyLabel) {
        doc.setTextColor(0, 0, 0); doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(Math.max(labelSize - 2, 10)));
        const labelX = finalX + finalW + 5, labelY = Math.max(cy + 16, finalY + 11);
        if (piece.qtyLabel === 'Ax2 Bx2') { doc.text('Ax2', labelX * sx, labelY * sy); doc.text('Bx2', labelX * sx, (labelY + Math.max(labelSize, 12)) * sy); }
        else doc.text(String(piece.qtyLabel), labelX * sx, labelY * sy);
      }

      const circleBottom = numCy + circleR, circleRight = numCx + circleR;
      let py = Math.max(finalY + finalH + labelSize + 4, circleBottom + labelSize + 4);
      const safeLeftX = (py - labelSize < circleBottom + 4) ? (circleRight + 6) : (cx + 5);
      const maxCellW = Math.max((cx + cellW - 5) - safeLeftX, 42), safeTextX = Math.max(safeLeftX + 18, (safeLeftX + cx + cellW - 5) / 2);
      doc.setTextColor(0, 0, 0); doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(labelSize));
      doc.splitTextToSize(String(piece.sizeText || ''), maxCellW * sx).slice(0, 1).forEach(l => { doc.text(l, safeTextX * sx, py * sy, { align: 'center' }); py += Math.round(labelSize * 1.15); });
      const nf = Math.max(labelSize - 2, 8); doc.setFont(pdfFont, 'normal'); doc.setFontSize(pxToPt(nf));
      doc.splitTextToSize(String(piece.name || ''), maxCellW * sx).slice(0, 2).forEach(l => { doc.text(l, safeTextX * sx, py * sy, { align: 'center' }); py += Math.round(nf * 1.15); });
    });

    let fy = boxY + boxH + Math.round(fabHeaderSize * 1.2) + 4;
    doc.setTextColor(0, 0, 0); doc.setFont(pdfFont, 'bold'); doc.setFontSize(pxToPt(fabHeaderSize)); doc.text('KETERANGAN :', boxX * sx, fy * sy); fy += fabLineH;
    doc.setFont(pdfFont, 'normal'); doc.setFontSize(pxToPt(fabSize));
    footerEntries.forEach(lines => lines.forEach(l => { if (fy <= CH - 8) { doc.text(l, boxX * sx, fy * sy); fy += fabLineH; } }));
  });
  return doc;
}

window.exportAllPDF = async function() {
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) { alert("Belum ada pola yang dimuat!"); return; }
  const doc = buildEditableVectorPdf();
  const fileName = 'MiniMarker_' + currentStyleName + '_' + String(currentColorwayName || 'DEFAULT').replace(/[^A-Z0-9_\-]/gi, '_') + '.pdf';
  const pdfBlob = doc.output('blob');
  if (typeof registerDownloadedFile === 'function') registerDownloadedFile(fileName, 'Download/MiniMarker/' + fileName, pdfBlob);
  const saved = await saveFileUniversal(fileName, pdfBlob, false);
  if (saved) alert("✅ Vector PDF (Editable di Foxit) disimpan ke: " + saved);
};


function buildCorelEditableSvg() {
  generateMiniMarker();
  const c = (Array.isArray(generatedCanvases) && generatedCanvases.length > 0) ? generatedCanvases.at(0) : null;
  const W = c ? c.width : 1400, H = c ? c.height : 990;
  const esc = s => String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const titleSize = parseInt(document.getElementById('titleFontSize')?.value) || 38;
  const labelSize = parseInt(document.getElementById('labelFontSize')?.value) || 14;
  const procSize = parseInt(document.getElementById('processFontSize')?.value) || 13;
  const fabSize = parseInt(document.getElementById('fabricFontSize')?.value) || 14;
  const customCols = document.getElementById('colsSelect')?.value || 'auto';
  const customRows = document.getElementById('rowsSelect')?.value || 'auto';
  const orderVal = (document.getElementById('orderNoInput')?.value || '').trim().toUpperCase();
  const titleText = currentStyleName + (currentColorwayName ? ' (' + currentColorwayName + ')' : '');

  const jacji = (typeof excelColorways !== 'undefined' && currentColorwayName && excelColorways[currentColorwayName]) ? excelColorways[currentColorwayName] : null;
  const bomSpecs = jacji ? (jacji.specs || {}) : {};
  const bomFabSeq = [];
  if (jacji && Array.isArray(jacji.pieces)) jacji.pieces.forEach(bp => { if (bp.fabric && !bomFabSeq.includes(bp.fabric)) bomFabSeq.push(bp.fabric); });
  const activeFabrics = [...new Set([...bomFabSeq, 'MA', 'T1', 'T2', 'T3', 'L2', 'N1'])].filter(f => parsedPieces.some(p => p.fabric === f));
  const fabricNumberMap = {}; activeFabrics.forEach((f, idx) => { fabricNumberMap[f] = idx + 1; });
  const sortedPieces = [...parsedPieces].sort((a, b) => {
    const fDiff = (fabricNumberMap[a.fabric] || 99) - (fabricNumberMap[b.fabric] || 99);
    if (fDiff !== 0) return fDiff;
    const oA = typeof a.bomOrder === 'number' ? a.bomOrder : 9999, oB = typeof b.bomOrder === 'number' ? b.bomOrder : 9999;
    return oA !== oB ? oA - oB : (a.id || 0) - (b.id || 0);
  });
  const subCounters = {};
  sortedPieces.forEach(p => { const fn = fabricNumberMap[p.fabric] || 1; subCounters[fn] = (subCounters[fn] || 0) + 1; p.itemNumberLabel = fn + '.' + subCounters[fn]; });

  const footerEntries = activeFabrics.map(fab => {
    const num = fabricNumberMap[fab], cnt = sortedPieces.filter(p => p.fabric === fab).length;
    const specText = (bomSpecs[fab] || fab).replace(/\bWIDTH\s*VAI\b|\bWIDTH\b|\bVAI\b/gi, '').replace(/\s+/g, ' ').trim();
    return num + '. ' + specText + ' (' + cnt + ' KOMPONEN)';
  });
  const fabLineH = Math.max(Math.round(fabSize * 1.32), 20);
  const footerH = Math.round((fabSize + 2) * 1.5) + (footerEntries.length * fabLineH) + 14;
  const boxX = 36, boxY = 20 + Math.round(titleSize * 1.15) + (orderVal ? Math.max(labelSize + 14, 24) : 10);
  const boxW = W - 72, boxH = Math.max(220, H - boxY - footerH - 18);

  const dynLayout = computeDynamicGridLayout(sortedPieces, customCols, customRows, boxW - 24, boxH - 18, labelSize);
  const cols = dynLayout.cols, rowsPerPage = dynLayout.rowsPerPage, pageItems = dynLayout.pages.at(0) || [];
  const baseCellW = (boxW - 24) / cols, baseCellH = (boxH - 18) / rowsPerPage;

  let globalScale = Infinity;
  pageItems.forEach(item => {
    const p = item.piece, cw = baseCellW * (item.colSpan || 1), ch = baseCellH * (item.rowSpan || 1);
    const ew = p.autoRotate90 ? p.height : p.width, eh = p.autoRotate90 ? p.width : p.height;
    const sc = Math.min(Math.max(cw - 48, 24) / Math.max(ew, 1), Math.max(ch - Math.round(labelSize * 3.0) - 34, 24) / Math.max(eh, 1));
    if (sc < globalScale) globalScale = sc;
  });
  if (!isFinite(globalScale) || globalScale <= 0) globalScale = 1;

  let out = ['<?xml version="1.0" encoding="UTF-8"?>', '<svg xmlns="http://w3.org" width="297mm" height="210mm" viewBox="0 0 ' + W + ' ' + H + '">', '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#ffffff"/>'];
  out.push('<text x="' + (W / 2) + '" y="' + (20 + Math.round(titleSize * 0.85)) + '" font-family="Arial, sans-serif" font-size="' + titleSize + '" font-weight="bold" text-anchor="middle" fill="#000000">' + esc(titleText) + '</text>');
  if (orderVal) out.push('<text x="' + boxX + '" y="' + (boxY - 8) + '" font-family="Arial, sans-serif" font-size="' + (labelSize + 3) + '" font-weight="bold" fill="#000000">' + esc(orderVal) + '</text>');
  out.push('<rect x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="' + boxH + '" fill="none" stroke="#000000" stroke-width="2.5"/>');

  pageItems.forEach(item => {
    const p = item.piece, cx = boxX + 12 + item.col * baseCellW, cy = boxY + 9 + item.row * baseCellH;
    const cellW = baseCellW * (item.colSpan || 1), cellH = baseCellH * (item.rowSpan || 1);
    const circleR = Math.max(12, Math.min(20, Math.round(labelSize * 1.15)));
    const topSpace = p.processLabel ? Math.max(procSize + 10, 22) : 14, bottomSpace = Math.round(labelSize * 3.0) + 16;
    const leftOffset = (circleR * 2) + 8, rightSpace = p.qtyLabel ? 34 : 10;
    const maxDrawW = Math.max(cellW - leftOffset - rightSpace, 24), maxDrawH = Math.max(cellH - topSpace - bottomSpace, 24);
    const ew = p.autoRotate90 ? p.height : p.width, eh = p.autoRotate90 ? p.width : p.height;
    const sc = (Math.min(globalScale, p.maxAllowedScale || globalScale) * (p.customScale || 1)), finalW = ew * sc, finalH = eh * sc;
    const finalX = cx + leftOffset + (maxDrawW - finalW) / 2, finalY = cy + topSpace + (maxDrawH - finalH) / 2;
    const pos = calcSmartCirclePos(p, cx, cy, cellW, finalX, finalY, finalW, finalH, circleR);

    out.push('<g id="piece_' + esc(p.itemNumberLabel) + '">');
    out.push('<circle cx="' + pos.numCx.toFixed(1) + '" cy="' + pos.numCy.toFixed(1) + '" r="' + circleR + '" fill="none" stroke="#000000" stroke-width="1.8"/>');
    out.push('<text x="' + pos.numCx.toFixed(1) + '" y="' + (pos.numCy + circleR * 0.35).toFixed(1) + '" font-family="Arial, sans-serif" font-size="' + Math.round(circleR * 0.85) + '" font-weight="bold" text-anchor="middle" fill="#000000">' + esc(p.itemNumberLabel) + '</text>');
    if (p.processLabel) out.push('<text x="' + ((pos.numCx + circleR + 6 + cx + cellW - 4) / 2).toFixed(1) + '" y="' + (cy + Math.max(procSize, 10) + 3) + '" font-family="Arial, sans-serif" font-size="' + Math.max(procSize, 9) + '" font-weight="bold" text-anchor="middle" fill="#d90429">' + esc(p.processLabel.toUpperCase()) + '</text>');
    if (Array.isArray(p.polygons)) {
      p.polygons.forEach(poly => {
        if (!poly.pts || poly.pts.length < 2) return;
        const ptsStr = poly.pts.map(pt => ((finalX + (p.autoRotate90 ? pt.y : pt.x) * sc).toFixed(2) + ',' + (finalY + (p.autoRotate90 ? pt.x : pt.y) * sc).toFixed(2))).join(' ');
        out.push('<' + (poly.isOuter ? 'polygon' : 'polyline') + ' points="' + ptsStr + '" fill="none" stroke="' + (poly.isOuter ? '#0000ff' : '#64748b') + '" stroke-width="' + (poly.isOuter ? '2.1' : '0.9') + '"/>');
      });
    }
    const textX = (finalX + finalW / 2).toFixed(1), py1 = (finalY + finalH + labelSize + 4).toFixed(1);
    out.push('<text x="' + textX + '" y="' + py1 + '" font-family="Arial, sans-serif" font-size="' + labelSize + '" font-weight="bold" text-anchor="middle" fill="#000000">' + esc(p.sizeText) + '</text>');
    out.push('<text x="' + textX + '" y="' + (Number(py1) + labelSize + 2).toFixed(1) + '" font-family="Arial, sans-serif" font-size="' + Math.max(labelSize - 2, 8) + '" text-anchor="middle" fill="#000000">' + esc(p.name) + '</text></g>');
  });

  let fy = boxY + boxH + Math.round((fabSize + 2) * 1.2) + 4;
  out.push('<text x="' + boxX + '" y="' + fy + '" font-family="Arial, sans-serif" font-size="' + (fabSize + 2) + '" font-weight="bold" fill="#000000">KETERANGAN :</text>');
  fy += fabLineH;
  footerEntries.forEach(line => { out.push('<text x="' + boxX + '" y="' + fy + '" font-family="Arial, sans-serif" font-size="' + fabSize + '" fill="#000000">' + esc(line) + '</text>'); fy += fabLineH; });
  out.push('</svg>');
  return out.join('\n');
}

window.saveAllColorwaysBatch = async function(format) {
  if (!format) { openExportFormatModal(); return; }
  try {
  if (typeof parsedPieces === 'undefined' || parsedPieces.length === 0) { alert("Belum ada pola DXF yang dimuat."); return; }
  const orderNo = (document.getElementById('orderNoInput')?.value || currentStyleName || 'ORDER_MARKER').trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '_');
  const cwKeys = Object.keys(excelColorways || {}).filter(k => excelColorways[k].pieces && excelColorways[k].pieces.length > 0 && !/^WIDTH\b/i.test(excelColorways[k].cleanColor));
  const targetKeys = cwKeys.length > 0 ? cwKeys : [currentColorwayName || 'DEFAULT'];
  const zip = new JSZip(), folder = zip.folder(orderNo);
  const prevOpenFull = window.openFullPreview; window.openFullPreview = function() {};
  try {
    for (let idx = 0; idx < targetKeys.length; idx++) {
      const cwKey = targetKeys[idx];
      if (typeof appendSyncLog === 'function') appendSyncLog(`⏳ Membuat Vector ${format.toUpperCase()} (${idx + 1}/${targetKeys.length}): ${cwKey}...`);
      if (cwKeys.length > 0 && document.getElementById('colorwaySelect')) { document.getElementById('colorwaySelect').value = cwKey; if (typeof applyColorwayMapping === 'function') applyColorwayMapping(); }
      const safeCw = String(currentColorwayName || cwKey).replace(/[^A-Z0-9_\-]/gi, '_');
      if (format === 'png') {
        generateMiniMarker();
        for (let i = 0; i < generatedCanvases.length; i++) {
          const b64 = generatedCanvases[i].toDataURL('image/png').split(',').at(1);
          folder.file('MiniMarker_' + currentStyleName + '_' + safeCw + (generatedCanvases.length > 1 ? '_Hal' + (i + 1) : '') + '.png', b64, { base64: true });
        }
        generatedCanvases.forEach(c => { c.width = 1; c.height = 1; }); generatedCanvases = [];
      } else if (format === 'corel') {
        folder.file('MiniMarker_' + currentStyleName + '_' + safeCw + '_CorelDRAW.svg', buildCorelEditableSvg());
      } else {
        const pdfB64 = buildEditableVectorPdf().output('datauristring').split(',').at(1);
        folder.file('MiniMarker_' + currentStyleName + '_' + safeCw + '.pdf', pdfB64, { base64: true });
      }
      await new Promise(r => setTimeout(r, 15));
    }
  } finally { window.openFullPreview = prevOpenFull; }
  if (typeof closeFullPreview === 'function') closeFullPreview();
  const zipFileName = orderNo + '_' + format.toUpperCase() + '.zip';
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipDataUrl = 'data:application/zip;base64,' + (await zip.generateAsync({ type: 'base64' }));
  if (typeof registerDownloadedFile === 'function') registerDownloadedFile(zipFileName, 'Download/MiniMarker/' + zipFileName, zipBlob);
  await saveFileUniversal(zipFileName, zipDataUrl, true);
  if (typeof appendSyncLog === 'function') appendSyncLog(`✅ Selesai! ${zipFileName} siap di tab 📥 Download.`);
  alert("✅ Selesai! Arsip " + zipFileName + " (" + targetKeys.length + " Color Vector PDF) siap diedit di Foxit PhantomPDF & tersedia di tab 📥 Download!");
  } catch (err) {
    alert("❌ Gagal membuat ZIP: " + (err && err.message ? err.message : err));
  }
};

// === DYNAMIC MULTI-CELL GRID LAYOUT ENGINE (PANEL RAKSASA SPAN 2x2 & ANTI-TUMPANG TINDIH) ===
function computeDynamicGridLayout(piecesList, customCols, customRows, sampleBoxW, sampleBoxH, labelSize) {
  const totalCount = piecesList.length;
  if (totalCount === 0) return { cols: 6, rowsPerPage: 4, pages: [[]], globalUniformScale: 0.25 };

  const areas = piecesList.map(p => p.width * p.height).sort((a, b) => a - b);
  const maxSides = piecesList.map(p => Math.max(p.width, p.height)).sort((a, b) => a - b);
  const p65Area = areas[Math.floor(areas.length * 0.65)] || 80000;
  const p70Side = maxSides[Math.floor(maxSides.length * 0.70)] || 350;

  // HANYA panel Raincover (atau panel raksasa >= 70*55 cm / area >= 4000 cm2) yang mendapat 2x2 sel
  piecesList.forEach(p => {
    const cmW = p.width / 10, cmH = p.height / 10;
    const areaCm = cmW * cmH;
    const isRaincover = /RAINCOVER|\bRC-/i.test(String(p.name || '') + ' ' + String(p.rawText || ''));
    if (isRaincover || (areaCm >= 4000 && Math.min(cmW, cmH) >= 50)) {
      p._colSpan = 2;
      p._rowSpan = 2;
    } else {
      p._colSpan = 1;
      p._rowSpan = 1;
    }
  });

  const targetPages = Math.max(1, parseInt(document.getElementById('pagesSelect')?.value) || 1);
  const totalCellsNeeded = piecesList.reduce((acc, p) => acc + (p._colSpan * p._rowSpan), 0);
  const cellsPerTargetPage = Math.ceil(totalCellsNeeded / targetPages);

  // Cari kombinasi (cols, rowsPerPage) paling efisien untuk targetPages lembar (default 1 lembar)
  let cols = customCols !== 'auto' ? parseInt(customCols) : Math.max(4, Math.ceil(Math.sqrt(cellsPerTargetPage * (sampleBoxW / Math.max(sampleBoxH, 1)))));
  let rowsPerPage = customRows !== 'auto' ? parseInt(customRows) : Math.max(2, Math.ceil(cellsPerTargetPage / cols));
  if (cols < 2) cols = 2;
  if (rowsPerPage < 2) rowsPerPage = 2;

  // Pastikan seluruh komponen benar-benar muat di dalam targetPages lembar (tidak meluap otomatis ke lembar baru)
  const simulatePagesCount = (cTry, rTry) => {
    let pg = 1, occTry = Array.from({ length: cTry }, () => Array(rTry).fill(false));
    piecesList.forEach(p => {
      const cs = Math.min(p._colSpan, cTry), rs = Math.min(p._rowSpan, rTry);
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        for (let c = 0; c < cTry && !ok; c++) {
          for (let r = 0; r < rTry && !ok; r++) {
            let free = (c + cs <= cTry && r + rs <= rTry);
            for (let dc = 0; dc < cs && free; dc++) for (let dr = 0; dr < rs && free; dr++) if (occTry[c + dc][r + dr]) free = false;
            if (free) {
              for (let dc = 0; dc < cs; dc++) for (let dr = 0; dr < rs; dr++) occTry[c + dc][r + dr] = true;
              ok = true;
            }
          }
        }
        if (!ok && attempt === 0) {
          pg++;
          occTry = Array.from({ length: cTry }, () => Array(rTry).fill(false));
        }
      }
    });
    return pg;
  };

  // Jika Auto, optimalkan pasangan (cols, rowsPerPage) yang muat di targetPages dengan efisiensi ruang tertinggi
  if (customCols === 'auto' && customRows === 'auto') {
    let bestCombo = null, bestEff = -1;
    for (let cCand = 4; cCand <= 14; cCand++) {
      for (let rCand = 2; rCand <= 10; rCand++) {
        if (cCand * rCand < cellsPerTargetPage) continue;
        if (simulatePagesCount(cCand, rCand) > targetPages) continue;
        const cw = (sampleBoxW - 24) / cCand, ch = (sampleBoxH - 18) / rCand;
        const mW = Math.max(cw - 44, 20), mH = Math.max(ch - (labelSize * 4) - 24, 20);
        // Hitung skala botol leher untuk kombinasi ini agar efisiensi kertas maksimal
        let minSc = Infinity;
        piecesList.forEach(p => {
          const sw = mW * Math.min(p._colSpan, cCand), sh = mH * Math.min(p._rowSpan, rCand);
          const sc = Math.max(Math.min(sw / Math.max(p.width, 1), sh / Math.max(p.height, 1)), Math.min(sw / Math.max(p.height, 1), sh / Math.max(p.width, 1)));
          if (sc < minSc) minSc = sc;
        });
        if (minSc > bestEff) { bestEff = minSc; bestCombo = { c: cCand, r: rCand }; }
      }
    }
    if (bestCombo) { cols = bestCombo.c; rowsPerPage = bestCombo.r; }
  } else {
    while (simulatePagesCount(cols, rowsPerPage) > targetPages && (cols < 16 || rowsPerPage < 12)) {
      if (customCols === 'auto' && cols <= rowsPerPage + 2) cols++;
      else if (customRows === 'auto') rowsPerPage++;
      else cols++;
    }
  }

  // Susun penempatan sel secara berurutan (kolom demi kolom, baris demi baris) tanpa tabrakan
  const pages = [];
  let curPage = [];
  let occ = Array.from({ length: cols }, () => Array(rowsPerPage).fill(false));

  const canPlace = (c, r, cs, rs) => {
    if (c + cs > cols || r + rs > rowsPerPage) return false;
    for (let dc = 0; dc < cs; dc++) {
      for (let dr = 0; dr < rs; dr++) {
        if (occ[c + dc][r + dr]) return false;
      }
    }
    return true;
  };
  const markPlace = (c, r, cs, rs) => {
    for (let dc = 0; dc < cs; dc++) {
      for (let dr = 0; dr < rs; dr++) occ[c + dc][r + dr] = true;
    }
  };

  piecesList.forEach(p => {
    let cs = Math.min(p._colSpan, cols);
    let rs = Math.min(p._rowSpan, rowsPerPage);
    let placed = false;

    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      for (let c = 0; c < cols && !placed; c++) {
        for (let r = 0; r < rowsPerPage && !placed; r++) {
          if (canPlace(c, r, cs, rs)) {
            markPlace(c, r, cs, rs);
            curPage.push({ piece: p, col: c, row: r, colSpan: cs, rowSpan: rs });
            placed = true;
          }
        }
      }
      if (!placed && attempt === 0) {
        // Pindah ke halaman baru jika halaman saat ini sudah penuh
        if (curPage.length > 0) pages.push(curPage);
        curPage = [];
        occ = Array.from({ length: cols }, () => Array(rowsPerPage).fill(false));
      }
    }
  });
  if (curPage.length > 0) pages.push(curPage);
  if (pages.length === 0) pages.push([]);

  // Hitung skala seragam & maxAllowedScale tiap panel sesuai ukuran span-nya
  const baseCellW = (sampleBoxW - 24) / cols;
  const baseCellH = (sampleBoxH - 18) / rowsPerPage;
  const normalScales = [];

  piecesList.forEach(p => {
    const spanW = baseCellW * Math.min(p._colSpan, cols);
    const spanH = baseCellH * Math.min(p._rowSpan, rowsPerPage);
    const cR = Math.min(14, baseCellH * 0.075);
    const tSp = p.processLabel ? (labelSize + 10) : 6;
    const bSp = Math.round(labelSize * 2.9) + 16;
    const lOff = (cR * 2) + 8;
    const mW = Math.max(spanW - lOff - 16, 24);
    const mH = Math.max(spanH - tSp - bSp, 24);
    const sNorm = Math.min(mW / Math.max(p.width, 1), mH / Math.max(p.height, 1));
    const sRot = Math.min(mW / Math.max(p.height, 1), mH / Math.max(p.width, 1));
    p.autoRotate90 = sRot > sNorm * 1.03;
    p.maxAllowedScale = p.autoRotate90 ? sRot : sNorm;
    if (p._colSpan === 1 && p._rowSpan === 1) normalScales.push(p.maxAllowedScale);
  });

  normalScales.sort((a, b) => a - b);
  let globalUniformScale = normalScales[Math.floor(normalScales.length * 0.15)] || normalScales.at(0) || 0.25;
  if (!isFinite(globalUniformScale) || globalUniformScale <= 0) globalUniformScale = 0.25;

  return { cols, rowsPerPage, pages, globalUniformScale };
}


// === POP-UP EDIT CEPAT SAAT GAMBAR PREVIEW DIKETUK ===
window.openQuickPatternEditor = function(piece) {
  if (!piece) return;
  let modal = document.getElementById("quickPatternModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "quickPatternModal";
    modal.style.cssText = "position:fixed; inset:0; z-index:9999999; background:rgba(5,4,15,0.88); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; padding:16px;";
    document.body.appendChild(modal);
  }
  const fabrics = ['MA', 'T1', 'T2', 'T3', 'L2', 'N1'];
  const qtys = ['', 'A/B', 'Ax2 Bx2', 'X2', 'X3', 'X4', 'X6'];
  const procs = ['', 'BORDIR', 'OCM', 'AUTOMATION', 'AUTOMATION-OCM', 'OCM-BORDIR', 'HEAT EMBOSSED', 'SILKSCREEN', 'PREPARING', 'SABLON'];
  const esc = (s) => String(s || '').replace(/"/g, '&quot;');

  modal.innerHTML = `
    <div style="width:100%; max-width:390px; background:#141226; border:1.5px solid var(--neon-cyan); border-radius:14px; padding:16px; box-shadow:0 14px 36px rgba(0,245,212,0.3);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div style="font-size:14px; font-weight:900; color:var(--neon-cyan);">✏️ EDIT POLA (${esc(piece.itemNumberLabel || '')})</div>
        <button type="button" onclick="document.getElementById('quickPatternModal').style.display='none'" style="background:none; border:none; color:var(--neon-pink); font-size:18px; font-weight:900; cursor:pointer;">✕</button>
      </div>
      <label style="font-size:11px; color:var(--muted);">NAMA KOMPONEN:</label>
      <input type="text" id="qpName" value="${esc(piece.name)}" style="margin-bottom:8px; font-weight:700;" />

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div>
          <label style="font-size:11px; color:var(--muted);">UKURAN (P*L):</label>
          <input type="text" id="qpSize" value="${esc(piece.sizeText)}" style="margin-bottom:8px;" />
        </div>
        <div>
          <label style="font-size:11px; color:var(--muted);">FABRIC:</label>
          <select id="qpFab" style="margin-bottom:8px;">
            ${fabrics.map(f => `<option value="${f}" ${piece.fabric === f ? 'selected' : ''}>${f}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div>
          <label style="font-size:11px; color:var(--muted);">QTY / SIMETRI:</label>
          <input type="text" id="qpQty" list="qpQtyList" value="${esc(piece.qtyLabel)}" placeholder="Kosong = 1x, A/B, X2..." style="margin-bottom:8px;" />
          <datalist id="qpQtyList">${qtys.filter(Boolean).map(q => `<option value="${q}">`).join('')}</datalist>
        </div>
        <div>
          <label style="font-size:11px; color:var(--muted);">LUAR LINE:</label>
          <input type="text" id="qpProc" list="qpProcList" value="${esc(piece.processLabel)}" placeholder="BORDIR, OCM..." style="margin-bottom:8px;" />
          <datalist id="qpProcList">${procs.filter(Boolean).map(pr => `<option value="${pr}">`).join('')}</datalist>
        </div>
      </div>

      <div style="margin-bottom:8px;">
          <label style="font-size:11px; color:var(--muted); display:block; margin-bottom:4px;">SKALA PATTERN INI (ANGKA PENGALI):</label>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" id="qpScaleMinus" style="width:42px; height:36px; border-radius:8px; border:1px solid rgba(20,184,166,0.5); background:#141b29; color:#5eead4; font-size:18px; font-weight:800; cursor:pointer;">-</button>
            <input type="number" id="qpScale" step="0.1" min="0.2" max="3.0" value="${Number(piece.customScale || 1).toFixed(1)}" style="flex:1; text-align:center; font-weight:800; font-size:14px; margin:0;" />
            <button type="button" id="qpScalePlus" style="width:42px; height:36px; border-radius:8px; border:1px solid rgba(20,184,166,0.5); background:#141b29; color:#5eead4; font-size:18px; font-weight:800; cursor:pointer;">+</button>
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:6px;">
          <button type="button" id="qpSaveBtn" class="btn" style="flex:1.4; padding:11px; font-size:13px; margin:0;">💾 TERAPKAN</button>
        <button type="button" onclick="document.getElementById('quickPatternModal').style.display='none'" class="btn btn-secondary" style="flex:0.8; padding:11px; font-size:12px; margin:0;">BATAL</button>
      </div>
    </div>
  `;
  modal.style.display = "flex";

  const applyLivePieceScale = (delta) => {
    const inp = document.getElementById("qpScale");
    if (!inp) return;
    let v = Math.round(((parseFloat(inp.value) || 1) + delta) * 10) / 10;
    v = Math.min(3.0, Math.max(0.2, v));
    inp.value = v.toFixed(1);
    piece.customScale = v;
    if (typeof forceInstantCanvasRefresh === "function") forceInstantCanvasRefresh();
    else if (typeof generateMiniMarker === "function") generateMiniMarker();
  };
  document.getElementById("qpScaleMinus").onclick = () => applyLivePieceScale(-0.1);
  document.getElementById("qpScalePlus").onclick = () => applyLivePieceScale(0.1);
  document.getElementById("qpScale").onchange = () => applyLivePieceScale(0);

  document.getElementById("qpSaveBtn").onclick = function() {
    piece.customScale = Math.min(3.0, Math.max(0.2, parseFloat(document.getElementById("qpScale").value) || 1));
    piece.name = (document.getElementById("qpName").value || piece.name).trim().toUpperCase();
    piece.sizeText = (document.getElementById("qpSize").value || piece.sizeText).trim();
    piece.fabric = document.getElementById("qpFab").value || piece.fabric;
    piece.qtyLabel = (document.getElementById("qpQty").value || "").trim();
    piece.processLabel = (document.getElementById("qpProc").value || "").trim().toUpperCase();
    modal.style.display = "none";
    if (typeof renderPieceMappingList === "function") renderPieceMappingList();
    if (typeof renderDynamicProcessColors === "function") renderDynamicProcessColors();
    if (typeof forceInstantCanvasRefresh === "function") forceInstantCanvasRefresh();
    else if (typeof generateMiniMarker === "function") generateMiniMarker();
  };
};

// === AKTIFKAN KLIK-EDIT POLA LANGSUNG DI MODE FULLSCREEN ===
if (typeof openFullPreview === "function" && !window._wrappedFsClickEdit) {
  window._wrappedFsClickEdit = true;
  const _origOpenFullPreview = openFullPreview;
  window.openFullPreview = function() {
    _origOpenFullPreview.apply(this, arguments);
    const fsModal = document.getElementById("fullScreenModal");
    if (!fsModal) return;
    const fsCanvases = fsModal.querySelectorAll("canvas");
    fsCanvases.forEach((fc, idx) => {
      const srcCanvas = (typeof generatedCanvases !== "undefined") ? generatedCanvases.at(idx) : null;
      if (!srcCanvas || !srcCanvas._hitBoxes) return;
      fc._hitBoxes = srcCanvas._hitBoxes;
      fc.style.cursor = "pointer";
      if (!fc._hasQuickEditBound) {
        fc._hasQuickEditBound = true;
        fc.addEventListener("click", function(ev) {
          if (window._previewWasDragged) { ev.stopPropagation(); return; }
          const rect = fc.getBoundingClientRect();
          const clickX = (ev.clientX - rect.left) * (fc.width / rect.width);
          const clickY = (ev.clientY - rect.top) * (fc.height / rect.height);
          const hit = fc._hitBoxes.find(b => clickX >= b.x && clickX <= b.x + b.w && clickY >= b.y && clickY <= b.y + b.h);
          if (hit && typeof window.openQuickPatternEditor === "function") {
            ev.stopPropagation();
            window.openQuickPatternEditor(hit.piece);
          }
        });
      }
    });
  };
}


// === SMART BACK BUTTON HANDLER (Mencegah Exit Langsung di HP/Browser) ===
(function setupSmartBackNavigation() {
  if (window._smartBackInstalled) return;
  window._smartBackInstalled = true;
  let lastExitAttempt = 0;

  function showBackToast(msg) {
    const el = document.getElementById("backToastNotice");
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(window._backToastTimer);
    window._backToastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2000);
  }

  function handleAppBackAction() {
    // 1. Tutup modal yang sedang terbuka lebih dulu
    const openModals = Array.from(document.querySelectorAll("[id*='Modal'], [id*='Editor'], .modal")).filter(m => {
      const st = window.getComputedStyle(m);
      return !m.classList.contains("hidden") && st.display !== "none" && st.visibility !== "hidden" && m.id !== "mainAppScreen";
    });
    if (openModals.length > 0) {
      openModals.forEach(m => { m.classList.add("hidden"); if (m.style.display === "flex" || m.style.display === "block") m.style.display = "none"; });
      return true;
    }

    // 2. Jika berada di tab Download atau Manual, kembali ke tab Upload
    const tabDl = document.getElementById("tabDownloads");
    const tabMan = document.getElementById("tabManual");
    if ((tabDl && tabDl.classList.contains("active")) || (tabMan && tabMan.classList.contains("active"))) {
      if (typeof switchTab === "function") switchTab("upload");
      return true;
    }

    // 3. Jika berada di ruang kerja utama, kembali ke layar awal (HOME/Splash)
    const splash = document.getElementById("splashScreen") || document.querySelector(".splash-wrap");
    const mainApp = document.getElementById("mainAppScreen");
    const isMainVisible = mainApp ? !mainApp.classList.contains("hidden") : (splash && splash.classList.contains("hidden"));
    if (isMainVisible && typeof backToSplash === "function") {
      backToSplash();
      return true;
    }

    return false; // Sudah di layar paling awal
  }

  // Push dummy state agar tombol Back browser/WebView tidak langsung keluar halaman
  try {
    window.history.pushState({ appGuard: true }, "");
    window.addEventListener("popstate", function() {
      const handled = handleAppBackAction();
      if (handled) {
        window.history.pushState({ appGuard: true }, "");
      } else {
        const now = Date.now();
        if (now - lastExitAttempt < 2000) {
          window.history.back();
        } else {
          lastExitAttempt = now;
          showBackToast("⚡ Tekan kembali sekali lagi untuk keluar");
          window.history.pushState({ appGuard: true }, "");
        }
      }
    });
  } catch (e) {}

  // Dukungan tombol Back hardware Android saat dibuild menjadi APK Capacitor
  document.addEventListener("DOMContentLoaded", function() {
    try {
      const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (capApp && typeof capApp.addListener === "function") {
        capApp.addListener("backButton", function() {
          const handled = handleAppBackAction();
          if (!handled) {
            const now = Date.now();
            if (now - lastExitAttempt < 2000) {
              capApp.exitApp();
            } else {
              lastExitAttempt = now;
              showBackToast("🔥 Tekan kembali sekali lagi untuk keluar");
            }
          }
        });
      }
    } catch (e) {}
  });
})();


// === EFEK SENGATAN LISTRIK PADA SEMUA TOMBOL ===
(function setupElectricButtonEffect() {
  if (window._electricBtnInstalled) return;
  window._electricBtnInstalled = true;

  function makeBoltPath(x1, y1, x2, y2, displace) {
    if (displace < 4) return "L" + x2.toFixed(1) + "," + y2.toFixed(1);
    const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * displace;
    const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * displace;
    return makeBoltPath(x1, y1, midX, midY, displace / 2) + " " + makeBoltPath(midX, midY, x2, y2, displace / 2);
  }

  function spawnElectricSparks(btn, clientX, clientY) {
    btn.classList.remove("electric-zap");
    void btn.offsetWidth;
    btn.classList.add("electric-zap");
    clearTimeout(btn._zapTimer);
    btn._zapTimer = setTimeout(() => btn.classList.remove("electric-zap"), 320);

    const rect = btn.getBoundingClientRect();
    const cx = clientX || (rect.left + rect.width / 2);
    const cy = clientY || (rect.top + rect.height / 2);
    const pad = 26;
    const left = Math.max(0, rect.left - pad);
    const top = Math.max(0, rect.top - pad);
    const w = Math.min(window.innerWidth - left, rect.width + pad * 2);
    const h = Math.min(window.innerHeight - top, rect.height + pad * 2);

    const svgNS = "http://w3.org";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "electric-bolt-fx");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.left = left + "px";
    svg.style.top = top + "px";

    const ox = cx - left;
    const oy = cy - top;
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6 + (Math.random() - 0.5) * 0.85;
      const dist = 26 + Math.random() * 34;
      const ex = Math.max(2, Math.min(w - 2, ox + Math.cos(angle) * dist));
      const ey = Math.max(2, Math.min(h - 2, oy + Math.sin(angle) * dist));

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", "M" + ox.toFixed(1) + "," + oy.toFixed(1) + " " + makeBoltPath(ox, oy, ex, ey, 18));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", i % 3 === 0 ? "#ffffff" : (i % 3 === 1 ? "#00f5d4" : "#fee440"));
      path.setAttribute("stroke-width", i % 2 === 0 ? "2.2" : "1.5");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);

      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", ex.toFixed(1));
      dot.setAttribute("cy", ey.toFixed(1));
      dot.setAttribute("r", (1.5 + Math.random() * 1.8).toFixed(1));
      dot.setAttribute("fill", "#ffffff");
      svg.appendChild(dot);
    }

    document.body.appendChild(svg);
    setTimeout(() => svg.remove(), 300);
  }

  document.addEventListener("pointerdown", function(e) {
    const btn = e.target.closest("button, .btn, .tab-btn, .dropzone, [role=button], label[for]");
    if (btn && !btn.disabled) {
      spawnElectricSparks(btn, e.clientX, e.clientY);
    }
  }, { passive: true });
})();

// === PARSER KHUSUS JACJI LULULEMON (CONSUMPTION REG DTL2) ===
function handleLululemonExcelUpload(event) {
  window._activeJacjiBuyer = 'LULULEMON';
  window._activeJacjiBuyer = 'LULULEMON';
  const file = event.target.files && event.target.files.item(0);
  if (!file) return;
  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const workbook = isCsv
        ? XLSX.read(e.target.result, { type: 'string' })
        : XLSX.read(new Uint8Array(e.target.result), { type: 'array' });

      excelColorways = {};
      const validFabRegex = /^(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)(?:$|[^A-Z0-9])/i;
      const normFab = (cat) => {
        const m = String(cat || '').trim().toUpperCase().match(/^(MA|T1|T2|T3|L1|L2|M1|M2|C1|N1|SP)/);
        if (!m) return '';
        if (m.at(1) === 'L1') return 'L2';
        if (m.at(1) === 'C1') return 'M1';
        return m.at(1);
      };

      workbook.SheetNames.forEach(sheetName => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
        let curBuyer = '', curModel = '', curCw = '', blockColor = '', hdr = null;

        rows.forEach(rawRow => {
          const cells = rawRow.map(c => String(c || '').trim());
          if (!cells.join('').trim()) return;

          cells.forEach(c => {
            if (/^BUYER\s*NAME\s*:/i.test(c)) curBuyer = c.replace(/^BUYER\s*NAME\s*:/i, '').trim();
            if (/^MODEL\s*NO\s*:/i.test(c)) {
              curModel = c.replace(/^MODEL\s*NO\s*:/i, '').trim();
              const styleIn = document.getElementById('styleNoInput');
              if (styleIn && !styleIn.value) styleIn.value = curModel.split('_').at(0);
            }
            if (/^COLORWAY\s*:/i.test(c)) {
              curCw = c.replace(/^COLORWAY\s*:/i, '').trim();
              blockColor = '';
              hdr = null;
            }
          });

          const idxAnnot = cells.findIndex(c => /ANNOTATION/i.test(c));
          const idxCat = cells.findIndex(c => /^CATEGORY$/i.test(c));
          const idxSize = cells.findIndex(c => /^SIZE$/i.test(c));
          if (idxAnnot !== -1 && idxCat !== -1 && idxSize !== -1) {
            hdr = {
              no: cells.findIndex(c => /^NO\.?$/i.test(c)),
              annot: idxAnnot,
              cat: idxCat,
              qty: cells.findIndex(c => /^QTY$/i.test(c)),
              size: idxSize,
              mat: cells.findIndex(c => /^MATERIAL/i.test(c)),
              spec: cells.findIndex(c => /^SPEC$/i.test(c)),
              color: idxSize + 4
            };
            return;
          }

          if (!hdr) return;
          const noVal = hdr.no !== -1 ? cells.at(hdr.no) : '';
          if (!/^[0-9]+$/.test(noVal)) return;

          const catRaw = cells.at(hdr.cat) || '';
          if (!validFabRegex.test(catRaw)) return;
          const fab = normFab(catRaw);
          if (!fab) return;

          const annotRaw = cells.at(hdr.annot) || '';
          const sizeRaw = (cells.at(hdr.size) || '').replace(/[xX]/g, '*');
          const qtyNum = parseInt(cells.at(hdr.qty)) || 1;
          const matName = hdr.mat !== -1 ? (cells.at(hdr.mat) || '') : '';
          const specName = hdr.spec !== -1 ? (cells.at(hdr.spec) || '') : '';
          const rowColor = (hdr.color < cells.length ? (cells.at(hdr.color) || '') : '').trim().toUpperCase();

          if (rowColor && rowColor !== '_' && !blockColor) blockColor = rowColor;
          const cwLabel = (curCw || blockColor || rowColor || curBuyer || 'LULULEMON-DEFAULT').toUpperCase();
          if (!excelColorways[cwLabel]) {
            excelColorways[cwLabel] = {
              cleanColor: cwLabel,
              sheetName: curModel ? curModel.split('_').at(0) : sheetName,
              fabricSpecs: {},
              pieces: []
            };
          }

          if (matName && matName !== '_') {
            const cSuffix = (rowColor && rowColor !== '_') ? ' (' + rowColor + ')' : '';
            excelColorways[cwLabel].fabricSpecs[fab] = (matName + ' ' + specName + cSuffix).replace(/\s+/g, ' ').trim();
          }

          const dashParts = annotRaw.split('-').map(s => s.trim()).filter(Boolean);
          let shortCode = dashParts.at(0) || annotRaw;
          if (dashParts.length >= 2 && /^(BK|T|B|K|GUS)$/i.test(dashParts.at(1))) {
            shortCode = dashParts.at(0) + '-' + dashParts.at(1);
          }
          const cleanName = dashParts.length > 1 ? dashParts.slice(1).join(' ') : annotRaw;
          const codes = [...new Set([shortCode.toUpperCase(), (dashParts.at(0) || '').toUpperCase(), annotRaw.toUpperCase()].filter(Boolean))];

          excelColorways[cwLabel].pieces.push({
            fabric: fab,
            name: cleanName.toUpperCase(),
            raw: annotRaw.toUpperCase(),
            codes,
            size: sizeRaw,
            qty: qtyNum
          });
        });
      });

      const cwKeys = Object.keys(excelColorways).filter(k => excelColorways[k].pieces.length > 0);
      if (cwKeys.length > 0) {
        bomTemplates = JSON.parse(JSON.stringify(excelColorways));
        const sel = document.getElementById('colorwaySelect');
        sel.innerHTML = cwKeys.map(k => '<option value="' + k + '">' + excelColorways[k].cleanColor + ' (' + excelColorways[k].sheetName + ')</option>').join('');
        document.getElementById('colorwayBox').classList.remove('hidden');
        document.getElementById('luluExcelZone')?.classList.add('loaded');
        const stEl = document.getElementById('luluExcelStatus');
        if (stEl) stEl.innerHTML = '✅ <strong>' + file.name + '</strong> (' + cwKeys.length + ' Color Lululemon siap)';
        if (typeof applyColorwayMapping === 'function') applyColorwayMapping();
      } else {
        alert('Format Lululemon tidak terbaca. Pastikan file berisi kolom Annotation(ENG) dan Category.');
      }
    } catch (err) {
      alert('Gagal membaca file Lululemon: ' + (err.message || err));
    }
  };

  if (isCsv) reader.readAsText(file, 'UTF-8');
  else reader.readAsArrayBuffer(file);
}








(function previewPanModeController() {
  window._previewPanMode = false;

  window.togglePreviewPanMode = function() {
    window._previewPanMode = !window._previewPanMode;
    const btn = document.getElementById('fsModeToggleBtn');
    const holder = document.getElementById('fsCanvasHolder');
    if (btn) {
      if (window._previewPanMode) {
        btn.innerHTML = '✋ MODE GESER';
        btn.style.background = 'var(--neon-cyan)';
        btn.style.color = '#07060e';
      } else {
        btn.innerHTML = '✏️ MODE EDIT';
        btn.style.background = '#07060e';
        btn.style.color = 'var(--neon-cyan)';
      }
    }
    if (holder) {
      holder.style.outline = window._previewPanMode ? '2px solid var(--neon-cyan)' : 'none';
    }
  };

  function applyDirectTransform(vp) {
    const h = document.getElementById('fsCanvasHolder');
    const l = document.getElementById('fsZoomText');
    if (!h) return;
    const sc = vp._panScale || 1;
    const ang = typeof fsAngle === 'number' ? fsAngle : 0;
    const px = vp._panX || 0;
    const py = vp._panY || 0;
    const boost = (ang % 180 !== 0 && sc === 1) ? 1.35 : 1;
    h.style.transition = 'none';
    h.style.transform = `translate3d(${px}px, ${py}px, 0) rotate(${ang}deg) scale(${sc * boost})`;
    if (l) l.textContent = Math.round(sc * 100) + '%';
    try { fsX = px; fsY = py; fsScale = sc; } catch (_) {}
  }

  const origOpen = window.openFullPreview;
  if (typeof origOpen === 'function') {
    window.openFullPreview = function() {
      const vp = document.getElementById('fsViewport');
      if (vp) { vp._panX = 0; vp._panY = 0; vp._panScale = 1; }
      return origOpen.apply(this, arguments);
    };
  }
  const origReset = window.fsReset;
  if (typeof origReset === 'function') {
    window.fsReset = function() {
      const vp = document.getElementById('fsViewport');
      if (vp) { vp._panX = 0; vp._panY = 0; vp._panScale = 1; }
      return origReset.apply(this, arguments);
    };
  }
  const origZoom = window.fsZoom;
  if (typeof origZoom === 'function') {
    window.fsZoom = function(d) {
      const vp = document.getElementById('fsViewport');
      if (vp) { vp._panScale = Math.min(Math.max((vp._panScale || 1) + d, 1), 4); }
      const r = origZoom.apply(this, arguments);
      if (vp) applyDirectTransform(vp);
      return r;
    };
  }
  const origRotate = window.fsRotate;
  if (typeof origRotate === 'function') {
    window.fsRotate = function() {
      const vp = document.getElementById('fsViewport');
      if (vp) { vp._panX = 0; vp._panY = 0; }
      const r = origRotate.apply(this, arguments);
      if (vp) applyDirectTransform(vp);
      return r;
    };
  }

  // Blokir edit pola jika sedang di Mode Geser
  document.addEventListener('click', function(e) {
    const vp = document.getElementById('fsViewport');
    if (vp && vp.contains(e.target) && window._previewPanMode) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  let sx = 0, sy = 0, lx = 0, ly = 0, initDist = 0, initSc = 1, pinching = false, dragging = false;

  document.addEventListener('touchstart', function(e) {
    const vp = document.getElementById('fsViewport');
    if (!vp || !vp.contains(e.target)) return;
    if (typeof vp._panX !== 'number') vp._panX = 0;
    if (typeof vp._panY !== 'number') vp._panY = 0;
    if (typeof vp._panScale !== 'number') vp._panScale = 1;

    if (e.touches.length === 2) {
      pinching = true;
      initDist = Math.hypot(
        e.touches.item(1).clientX - e.touches.item(0).clientX,
        e.touches.item(1).clientY - e.touches.item(0).clientY
      );
      initSc = vp._panScale;
    } else if (e.touches.length === 1) {
      pinching = false;
      sx = e.touches.item(0).clientX;
      sy = e.touches.item(0).clientY;
      lx = vp._panX;
      ly = vp._panY;
      if (window._previewPanMode) {
        dragging = true;
      }
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchmove', function(e) {
    const vp = document.getElementById('fsViewport');
    if (!vp || !vp.contains(e.target)) return;

    if (e.touches.length === 2 && initDist > 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const dist = Math.hypot(
        e.touches.item(1).clientX - e.touches.item(0).clientX,
        e.touches.item(1).clientY - e.touches.item(0).clientY
      );
      vp._panScale = Math.min(Math.max(initSc * (dist / initDist), 1), 4);
      applyDirectTransform(vp);
    } else if (e.touches.length === 1 && !pinching && (window._previewPanMode || (vp._panScale || 1) > 1)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      dragging = true;
      vp._panX = lx + (e.touches.item(0).clientX - sx);
      vp._panY = ly + (e.touches.item(0).clientY - sy);
      applyDirectTransform(vp);
    }
  }, { capture: true, passive: false });

  document.addEventListener('touchend', function(e) {
    const vp = document.getElementById('fsViewport');
    if (!vp || !vp.contains(e.target)) return;
    if (dragging || window._previewPanMode) {
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      dragging = false;
      return;
    }
    if (!pinching && (vp._panScale || 1) === 1 && e.changedTouches.length === 1) {
      const dx = e.changedTouches.item(0).clientX - sx;
      if (Math.abs(dx) > 65 && typeof navigateColorway === 'function') {
        navigateColorway(dx < 0 ? 1 : -1);
      }
    }
  }, { capture: true, passive: false });
})();
