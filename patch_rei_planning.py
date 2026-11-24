p = "/data/data/com.termux/files/home/mini-marker-app/www/app.js"
txt = open(p).read()

s_idx = txt.find("function parseMasterOrderCsv(rows)")
e_idx = txt.find("function matchSpreadWithBomFA(spreadMap)")
assert s_idx != -1 and e_idx != -1, "Batas fungsi parseMasterOrderCsv tidak ditemukan"

new_parse_master = """function parseMasterOrderCsv(rows) {
  const headerIdx = rows.findIndex(r => r.some(c => /Order\\s*No/i.test(String(c))) && r.some(c => /ItemName&Spec/i.test(String(c))));
  if (headerIdx === -1) return false;
  const hdr = rows.at(headerIdx).map(h => String(h || '').trim());
  const idxOrder = hdr.findIndex(h => /Order\\s*No$/i.test(h));
  const idxStyle = hdr.findIndex(h => /Style\\s*No$/i.test(h));
  const idxStyleName = hdr.findIndex(h => /Style\\s*Name$/i.test(h));
  const idxColorCode = hdr.findIndex(h => /Style\\s*Color$/i.test(h));
  const idxStyleColorName = hdr.findIndex(h => /Style\\s*Color\\s*Name$/i.test(h));
  const idxQty = hdr.findIndex(h => /Style\\s*Qty$/i.test(h));
  const idxSpec = hdr.findIndex(h => /ItemName&Spec/i.test(h));
  const idxColName = hdr.findIndex(h => /^ColorName$/i.test(h));
  const idxFA = hdr.findIndex(h => /F\\/?A$/i.test(h));
  const idxPcs = hdr.findIndex(h => /PCS$/i.test(h));
  const idxKode = hdr.findIndex(h => /^Kode$/i.test(h));

  const normStyle = (s) => String(s || '').replace(/\\s*\\([^)]*\\)/g, '').trim().toUpperCase().replace(/^JSOA/, 'JS0A');
  const inpStyle = normStyle(document.getElementById('styleNoInput')?.value || '');
  const bomList = Object.values(bomTemplates || excelColorways || {}).filter(c => !c.isMasterOrder);
  const bomFirstSheet = bomList.at(0)?.sheetName || '';
  const mBomStyle = String(bomFirstSheet).toUpperCase().match(/(?:JS[A-Z0-9]{5,10}|\\b\\d{5}\\b)/);
  let targetStyleClean = normStyle(inpStyle || currentStyleName || (mBomStyle ? mBomStyle.at(0) : ''));
  if (targetStyleClean === 'MINI_MARKER' || targetStyleClean === 'SAMPLE') targetStyleClean = normStyle(mBomStyle ? mBomStyle.at(0) : '');

  // Ekstrak kode angka 5-digit REI (misal 24654 dari "24654 TRAIL 25L-XXL-4XL") & rentang ukuran jika ada
  const mReiNum = targetStyleClean.match(/\\b(\\d{5})\\b/);
  const reiBaseNum = mReiNum ? mReiNum.at(1) : '';
  const mSizeRange = targetStyleClean.match(/\\b(XXL-4XL|XS-XL|L-XL|S-M|XXL-3XL|1X-4X|1X-3X|M-XL|XS-S)\\b/);
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
          const compactRow = (rowStyle + ' ' + rowStyleName).replace(/\\s+/g, '');
          return compactRow.includes(targetSizeRange.replace(/\\s+/g, ''));
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
  const activeRows = matched.length > 0 ? matched : dataRows;
  if (activeRows.length === 0) return false;

  const firstOrder = String(activeRows.at(0).at(idxOrder) || '').trim().toUpperCase();
  if (firstOrder && document.getElementById('orderNoInput')) document.getElementById('orderNoInput').value = firstOrder;

  // Peta pencocokan Material Spec BOM -> Kode Fabric (untuk format REI yang tidak punya kolom Kode)
  const bomSpecToFab = [];
  if (bomList.at(0) && bomList.at(0).fabricSpecs) {
    Object.entries(bomList.at(0).fabricSpecs).forEach(([fKey, fDesc]) => {
      const prefix = String(fDesc || '').split('(').at(0).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 18);
      if (prefix.length >= 6) bomSpecToFab.push({ fab: fKey, prefix });
    });
  }

  const spreadMap = {};
  activeRows.forEach(r => {
    const rawStyle = String(r.at(idxStyle) || '').replace(/\\s*\\([^)]*\\)/g, '').trim().toUpperCase();
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
    const mKode = kodeRaw.match(/\\b(MA|T1|T2|T3|T5|L2|N[1-7])\\b/);
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
  return matchSpreadWithBomFA(spreadMap);
}

"""

txt = txt[:s_idx] + new_parse_master + txt[e_idx:]

# Perbaiki juga pencocokan nama warna REI (FIRE CLAY == FIRECLAY) di matchSpreadWithBomFA
old_pair = """    const m = allSpread.find(sp => b.cleanColor.includes(sp.cwCode) || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')'));"""
new_pair = """    const normCol = (s) => String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const m = allSpread.find(sp =>
      b.cleanColor.includes(sp.cwCode)
      || b.sheetName.toUpperCase().includes('(' + sp.cwCode + ')')
      || (sp.styleColorName && normCol(b.cleanColor) === normCol(sp.styleColorName))
    );"""

assert old_pair in txt, "old_pair tidak ditemukan"
txt = txt.replace(old_pair, new_pair)

open(p, "w").write(txt)
print("Dukungan Planning Spread REI (24654 / Multi-Brand) berhasil dipasang!")
