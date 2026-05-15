/**
 * SL_PR_INTERNAL_LINES.js
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * Internal Suitelet (accessed by NetSuite-authenticated users, NOT the portal).
 * Lists all PO lines where custbody_cde_dem_appro = T AND custbody_cde_dda_status = 2.
 * User can select a vendor + one or more lines and create a consolidated PO.
 */
define(
  ['./LIB_PR_PORTAL_THEME', 'N/record', 'N/search', 'N/url', 'N/runtime', 'N/log'],
  (theme, record, search, url, runtime, log) => {

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function selfUrl(params) {
    return url.resolveScript({
      scriptId:          runtime.getCurrentScript().id,
      deploymentId:      runtime.getCurrentScript().deploymentId,
      params:            params || {},
      returnExternalUrl: false
    });
  }

  // ============================================================
  // DATA
  // ============================================================
  function getAllVendors() {
    try {
      const s = search.create({
        type: search.Type.VENDOR,
        filters: [['isinactive', 'is', 'F']],
        columns: [
          search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
          'companyname'
        ]
      });
      return (s.run().getRange({ start: 0, end: 1000 }) || []).map(r => {
        const entityid = String(r.getValue({ name: 'entityid'    }) || '');
        const company  = String(r.getValue({ name: 'companyname' }) || '');
        return { id: String(r.id), name: company ? `${entityid} — ${company}` : entityid };
      });
    } catch (e) { log.error('getAllVendors', e); return []; }
  }

  function getApprovedPortalLines() {
    try {
      const csegCol = search.createColumn({ name: 'line.cseg_cde_dda_id' });
      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['taxline',  'is', 'F'],
          'AND',
          ['shipping', 'is', 'F'],
          'AND',
          ['custbody_cde_dem_appro', 'is', 'T'],
          'AND',
          ['custbody_cde_dda_status', 'anyof', '2'],
          'AND',
          ['line.cseg_cde_dda_id', 'noneof', '@NONE@']
        ],
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'tranid', 'line', 'item', 'memo', 'department', 'class', 'amount', 'quantity', 'rate',
          csegCol
        ]
      });
      const rows = s.run().getRange({ start: 0, end: 1000 }) || [];
      return rows.map(r => ({
        poId:         String(r.id),
        tranid:       String(r.getValue({ name: 'tranid'   }) || ''),
        date:         String(r.getValue({ name: 'trandate' }) || ''),
        lineNum:      parseInt(r.getValue({ name: 'line' }) || '0', 10),
        itemName:     String(r.getValue({ name: 'memo' }) || r.getText({ name: 'item' }) || ''),
        department:   String(r.getText ({ name: 'department' }) || ''),
        classname:    String(r.getText ({ name: 'class'      }) || ''),
        amount:       parseFloat(r.getValue({ name: 'amount' }) || '0') || 0,
        cseg:         String(r.getText (csegCol) || r.getValue(csegCol) || ''),
        csegId:       String(r.getValue(csegCol) || '')
      })).filter(ln => ln.csegId);
    } catch (e) { log.error('getApprovedPortalLines', e); return []; }
  }

  // Sum of (amount - quantitybilled*rate) per cseg_cde_dda_id across PO lines
  // where custbody_cde_dem_appro is NOT checked (non-portal POs). Represents the
  // remaining engaged spend that hasn't been billed yet.
  function getEngagedByCseg(csegIds) {
    const out = {};
    if (!csegIds || !csegIds.length) return out;
    try {
      log.audit('getEngagedByCseg', 'csegIds=' + JSON.stringify(csegIds));
      const csegCol = search.createColumn({ name: 'line.cseg_cde_dda_id' });
      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['taxline',  'is', 'F'],
          'AND',
          ['shipping', 'is', 'F'],
          'AND',
          ['custbody_cde_dem_appro', 'is', 'F'],
          'AND',
          ['line.cseg_cde_dda_id', 'anyof', csegIds]
        ],
        columns: [csegCol, 'amount', 'quantitybilled', 'rate', 'tranid']
      });
      let rowCount = 0, loggedRows = 0;
      s.run().each(r => {
        rowCount++;
        const csegId = String(r.getValue(csegCol) || '');
        const amount   = parseFloat(r.getValue({ name: 'amount'         }) || '0') || 0;
        const qtyBill  = parseFloat(r.getValue({ name: 'quantitybilled' }) || '0') || 0;
        const rate     = parseFloat(r.getValue({ name: 'rate'           }) || '0') || 0;
        const engaged  = amount - (qtyBill * rate);
        if (loggedRows < 5) {
          log.audit('engaged row', JSON.stringify({
            tranid: r.getValue({ name: 'tranid' }),
            csegId: csegId, amount: amount, qtyBill: qtyBill, rate: rate, engaged: engaged
          }));
          loggedRows++;
        }
        if (csegId) out[csegId] = (out[csegId] || 0) + engaged;
        return true;
      });
      log.audit('getEngagedByCseg', 'csegs=' + Object.keys(out).length + ' fromRows=' + rowCount + ' out=' + JSON.stringify(out));
    } catch (e) {
      log.error('getEngagedByCseg', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  // Sum of vendor-bill line amounts per cseg_cde_dda_id.
  function getActualByCseg(csegIds) {
    const out = {};
    if (!csegIds || !csegIds.length) return out;
    try {
      const csegCol = search.createColumn({ name: 'line.cseg_cde_dda_id' });
      const s = search.create({
        type: search.Type.VENDOR_BILL,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['taxline',  'is', 'F'],
          'AND',
          ['shipping', 'is', 'F'],
          'AND',
          ['line.cseg_cde_dda_id', 'anyof', csegIds]
        ],
        columns: [csegCol, 'amount']
      });
      let rowCount = 0;
      s.run().each(r => {
        rowCount++;
        const csegId = String(r.getValue(csegCol) || '');
        if (csegId) {
          const amount = Math.abs(parseFloat(r.getValue({ name: 'amount' }) || '0') || 0);
          out[csegId] = (out[csegId] || 0) + amount;
        }
        return true;
      });
      log.audit('getActualByCseg', 'csegs=' + Object.keys(out).length + ' fromRows=' + rowCount);
    } catch (e) {
      log.error('getActualByCseg', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  // ============================================================
  // PO CREATION
  // ============================================================
  function createConsolidatedPO(vendorId, lineRefs) {
    if (!vendorId) throw new Error('Fournisseur requis.');
    if (!lineRefs || !lineRefs.length) throw new Error('Veuillez sélectionner au moins une ligne.');

    const po = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });
    po.setValue({ fieldId: 'entity', value: vendorId });

    // Cache source POs to avoid reloading if multiple lines from same PO
    const srcCache = {};
    let added = 0;

    for (let i = 0; i < lineRefs.length; i++) {
      const ref = lineRefs[i];
      try {
        if (!srcCache[ref.poId]) {
          srcCache[ref.poId] = record.load({ type: record.Type.PURCHASE_ORDER, id: ref.poId, isDynamic: false });
        }
        const src = srcCache[ref.poId];
        // Saved-search `line` values are 1-indexed; loaded record is 0-indexed.
        const lineIdx = ref.lineNum - 1;
        const itemId      = src.getSublistValue({ sublistId: 'item', fieldId: 'item',            line: lineIdx });
        const qty         = src.getSublistValue({ sublistId: 'item', fieldId: 'quantity',        line: lineIdx });
        const rate        = src.getSublistValue({ sublistId: 'item', fieldId: 'rate',            line: lineIdx });
        const classId     = src.getSublistValue({ sublistId: 'item', fieldId: 'class',           line: lineIdx });
        const deptId      = src.getSublistValue({ sublistId: 'item', fieldId: 'department',      line: lineIdx });
        const segId       = src.getSublistValue({ sublistId: 'item', fieldId: 'cseg_cde_dda_id', line: lineIdx });
        const description = src.getSublistValue({ sublistId: 'item', fieldId: 'description',     line: lineIdx });
        if (!itemId) { log.error('lineRef skipped (no item)', JSON.stringify(ref)); continue; }

        po.selectNewLine({ sublistId: 'item' });
        po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item',     value: itemId });
        if (qty)         po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: qty });
        if (description) try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description',     value: description }); } catch (e) {}
        if (rate)        try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate',            value: rate        }); } catch (e) {}
        if (classId)     try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'class',           value: classId     }); } catch (e) {}
        if (deptId)      try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department',      value: deptId      }); } catch (e) {}
        if (segId)       try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'cseg_cde_dda_id', value: segId       }); } catch (e) {}
        po.commitLine({ sublistId: 'item' });
        added++;
      } catch (e) {
        log.error('copyLine ' + ref.poId + ':' + ref.lineNum, e);
      }
    }

    if (added === 0) throw new Error('Aucune ligne valide n\'a pu être ajoutée.');

    return po.save({ enableSourcing: true, ignoreMandatoryFields: false });
  }

  // ============================================================
  // RENDER
  // ============================================================
  function renderPage(response, message, errorMsg) {
    const lines   = getApprovedPortalLines();
    const vendors = getAllVendors();
    const formUrl = selfUrl();

    // Aggregate engaged & actual totals by cseg_cde_dda_id across all lines.
    const csegIdSet = {};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].csegId) csegIdSet[lines[i].csegId] = true;
    }
    const csegIds = Object.keys(csegIdSet);
    const engagedMap = getEngagedByCseg(csegIds);
    const actualMap  = getActualByCseg(csegIds);

    const alertHtml = errorMsg
      ? `<div class="alert error" style="display:block;">${escapeHtml(errorMsg)}</div>`
      : (message ? `<div class="alert success" style="display:block;">${escapeHtml(message)}</div>` : '');

    const rowsHtml = lines.length === 0
      ? `<tr><td colspan="11" class="muted" style="text-align:center;padding:32px;">Aucune ligne à traiter — <span style="font-style:italic;">No lines to process</span></td></tr>`
      : lines.map(ln => {
          const engaged   = ln.csegId && Object.prototype.hasOwnProperty.call(engagedMap, ln.csegId) ? engagedMap[ln.csegId] : 0;
          const actual    = ln.csegId && Object.prototype.hasOwnProperty.call(actualMap,  ln.csegId) ? actualMap[ln.csegId]  : 0;
          const remaining = (ln.amount || 0) - engaged - actual;
          const remainingStyle = remaining < 0
            ? 'background:var(--danger-bg);color:var(--danger);font-weight:800;'
            : 'background:var(--success-bg);color:var(--success);font-weight:800;';
          const poUrl = url.resolveRecord({ recordType: record.Type.PURCHASE_ORDER, recordId: ln.poId, isEditMode: false });
          return `
          <tr data-item="${escapeHtml(ln.itemName)}" data-dept="${escapeHtml(ln.department)}" data-class="${escapeHtml(ln.classname)}">
            <td><input type="checkbox" class="lineSel" value="${escapeHtml(ln.poId)}:${ln.lineNum}" data-amount="${ln.amount.toFixed(2)}" data-remaining="${remaining.toFixed(2)}" /></td>
            <td style="font-weight:700;"><a href="${escapeHtml(poUrl)}" target="_blank" rel="noopener" style="color:var(--teal-dark);text-decoration:none;border-bottom:1px dotted var(--teal);">${escapeHtml(ln.tranid || ('#' + ln.poId))}</a></td>
            <td style="font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(ln.cseg || '—')}</td>
            <td>${escapeHtml(ln.date)}</td>
            <td>${escapeHtml(ln.itemName)}</td>
            <td>${escapeHtml(ln.department)}</td>
            <td>${escapeHtml(ln.classname)}</td>
            <td class="right" style="font-weight:700;">${ln.amount.toFixed(2)}</td>
            <td class="right" style="background:#f3e8ff;color:#6b21a8;font-weight:700;">${engaged.toFixed(2)}</td>
            <td class="right" style="background:#fef3c7;color:#78350f;font-weight:700;">${actual.toFixed(2)}</td>
            <td class="right" style="${remainingStyle}">${remaining.toFixed(2)}</td>
          </tr>`;
        }).join('');

    response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    response.write(theme.pageHead('Regroupement demandes approuvées') + `
<body>
  ${theme.brandHeader('Regroupement demandes')}
  <div class="wrap" style="max-width:100%;padding:16px 20px;">
    <div class="card" style="padding:20px 16px;">
      <div class="page-head">
        <div>
          <div class="page-title">Regroupement des demandes approuvées</div>
          <p class="page-sub">Sélectionnez un fournisseur et les lignes à regrouper pour créer un PO consolidé.<br/><span style="font-style:italic;color:var(--muted);">Select a vendor and lines to create a consolidated PO.</span></p>
        </div>
      </div>
      <div class="divider"></div>

      ${alertHtml}

      <form id="consolForm" method="POST" action="${escapeHtml(formUrl)}" autocomplete="off">
        <div class="grid" style="grid-template-columns:repeat(2, 1fr);">
          <div class="field ta">
            <div class="label">Fournisseur * <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Vendor</span></div>
            <input class="input" id="vendorInput" placeholder="— Fournisseur —" autocomplete="off" />
            <input type="hidden" id="vendorId" name="vendorid" />
          </div>
          <div class="field">
            <div class="label">Sélection <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Selection</span></div>
            <div><span class="pill" id="selCount" style="background:var(--teal-light);border-color:var(--teal);color:var(--teal-dark);font-weight:800;">0 ligne(s) sélectionnée(s)</span> <span class="pill" id="selTotal" style="margin-left:8px;">Total : 0.00</span></div>
          </div>
        </div>

        <div class="spacer"></div>

        <div style="background:#f9fafb;border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:12px;">
          <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;">
            <div style="font-weight:800;font-size:11px;color:#374151;letter-spacing:.06em;text-transform:uppercase;padding-bottom:8px;">Filtres / Filters</div>
            <div style="flex:1;min-width:180px;">
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Description <span style="font-style:italic;text-transform:none;">/ Description</span></div>
              <select class="input" id="filterItem" style="padding:8px 10px;"><option value="">— Tous / All —</option></select>
            </div>
            <div style="flex:1;min-width:180px;">
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Département <span style="font-style:italic;text-transform:none;">/ Department</span></div>
              <select class="input" id="filterDept" style="padding:8px 10px;"><option value="">— Tous / All —</option></select>
            </div>
            <div style="flex:1;min-width:180px;">
              <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Classe <span style="font-style:italic;text-transform:none;">/ Class</span></div>
              <select class="input" id="filterClass" style="padding:8px 10px;"><option value="">— Toutes / All —</option></select>
            </div>
            <button type="button" class="btn" id="filterClear" style="margin-bottom:1px;">Effacer / Clear</button>
          </div>
        </div>

        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th style="width:3%;"><input type="checkbox" id="selAll" title="Tout sélectionner / Select all" /></th>
                <th style="width:7%;">N° PO<div class="th-en">PO number</div></th>
                <th style="width:11%;">ID segment<div class="th-en">Segment ID</div></th>
                <th style="width:7%;">Date<div class="th-en">Date</div></th>
                <th style="width:16%;">Description<div class="th-en">Description</div></th>
                <th style="width:10%;">Département<div class="th-en">Department</div></th>
                <th style="width:11%;">Classe<div class="th-en">Class</div></th>
                <th style="width:9%;" class="right">Montant<div class="th-en">Amount</div></th>
                <th style="width:9%;" class="right">Engagé<div class="th-en">Engaged</div></th>
                <th style="width:9%;" class="right">Dépensé<div class="th-en">Actual</div></th>
                <th style="width:8%;" class="right">Restant<div class="th-en">Remaining</div></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="spacer"></div>

        <input type="hidden" name="lines" id="linesPayload" value="" />

        <div class="row">
          <div class="muted"><span id="errMsg" style="color:var(--danger);font-weight:700;"></span></div>
          <button type="submit" class="btn primary">Créer le PO consolidé</button>
        </div>
      </form>
    </div>
  </div>

<script>
  const VENDORS = ${JSON.stringify(vendors)};

  function qs(s){ return document.querySelector(s); }
  function qsa(s){ return Array.from(document.querySelectorAll(s)); }

  function makeOverlay(){
    const d = document.createElement('div');
    d.className = 'ta-list';
    document.body.appendChild(d);
    return d;
  }
  function overlayPosition(lst, inp){
    const r = inp.getBoundingClientRect();
    lst.style.position = 'fixed';
    lst.style.left   = r.left + 'px';
    lst.style.top    = (r.bottom + 4) + 'px';
    lst.style.width  = r.width + 'px';
    lst.style.right  = 'auto';
    lst.style.zIndex = '9999';
  }
  function attachCombobox(inp, hid, items){
    const lst = makeOverlay();
    const close = () => { lst.style.display='none'; lst.innerHTML=''; };
    function render(){
      const q = (inp.value || '').toLowerCase().trim();
      const filtered = q.length === 0 ? items : items.filter(it => String(it.name||'').toLowerCase().includes(q));
      const toShow = filtered.slice(0, 60);
      if (!toShow.length){ close(); return; }
      lst.innerHTML = toShow.map(it =>
        '<div class="ta-item" data-id="' + String(it.id).replace(/"/g,'&quot;') +
        '" data-label="' + String(it.name||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '">' +
          String(it.name||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') +
        '</div>'
      ).join('');
      overlayPosition(lst, inp);
      lst.style.display = 'block';
    }
    inp.addEventListener('focus', () => render());
    inp.addEventListener('input', () => { hid.value = ''; render(); });
    lst.addEventListener('click', ev => {
      const row = ev.target.closest('.ta-item');
      if (!row) return;
      hid.value = row.getAttribute('data-id');
      inp.value = row.getAttribute('data-label');
      close();
    });
    document.addEventListener('click', ev => {
      if (ev.target === inp || lst.contains(ev.target)) return;
      close();
    });
    window.addEventListener('scroll', () => { if (lst.style.display !== 'none') overlayPosition(lst, inp); }, true);
    window.addEventListener('resize', () => { if (lst.style.display !== 'none') overlayPosition(lst, inp); });
  }

  attachCombobox(qs('#vendorInput'), qs('#vendorId'), VENDORS);

  function updateCount(){
    const checked = qsa('.lineSel:checked');
    qs('#selCount').textContent = checked.length + ' ligne(s) sélectionnée(s)';
    let total = 0;
    checked.forEach(cb => {
      const v = parseFloat(cb.getAttribute('data-amount') || '0');
      if (isFinite(v)) total += v;
    });
    qs('#selTotal').textContent = 'Total : ' + total.toFixed(2);
  }
  const selAllEl = qs('#selAll');
  if (selAllEl) selAllEl.addEventListener('change', ev => {
    qsa('.lineSel').forEach(cb => cb.checked = ev.target.checked);
    updateCount();
  });
  qsa('.lineSel').forEach(cb => cb.addEventListener('change', updateCount));

  qs('#consolForm').addEventListener('submit', ev => {
    const vendorId = qs('#vendorId').value;
    const selected = qsa('.lineSel:checked').map(cb => {
      const parts = cb.value.split(':');
      return { poId: parts[0], lineNum: parseInt(parts[1], 10) };
    });
    if (!vendorId) { ev.preventDefault(); qs('#errMsg').textContent = 'Veuillez sélectionner un fournisseur.'; return; }
    if (!selected.length) { ev.preventDefault(); qs('#errMsg').textContent = 'Veuillez sélectionner au moins une ligne.'; return; }
    qs('#linesPayload').value = JSON.stringify(selected);
  });

  // ── Filters: populate dropdowns from visible row data, then filter on change
  (function initFilters(){
    const rows = qsa('#consolForm tbody tr').filter(tr => tr.hasAttribute('data-item'));
    const uniq = (attr) => {
      const set = {};
      rows.forEach(tr => { const v = tr.getAttribute(attr); if (v) set[v] = true; });
      return Object.keys(set).sort((a,b) => a.localeCompare(b, 'fr'));
    };
    const addOpts = (sel, vals) => {
      vals.forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      });
    };
    const fItem  = qs('#filterItem');
    const fDept  = qs('#filterDept');
    const fClass = qs('#filterClass');
    if (!fItem) return;
    addOpts(fItem,  uniq('data-item'));
    addOpts(fDept,  uniq('data-dept'));
    addOpts(fClass, uniq('data-class'));

    function apply(){
      const i = fItem.value, d = fDept.value, c = fClass.value;
      rows.forEach(tr => {
        const ok = (!i || tr.getAttribute('data-item')  === i) &&
                   (!d || tr.getAttribute('data-dept')  === d) &&
                   (!c || tr.getAttribute('data-class') === c);
        tr.style.display = ok ? '' : 'none';
        if (!ok) { const cb = tr.querySelector('.lineSel'); if (cb) cb.checked = false; }
      });
      updateCount();
    }
    [fItem, fDept, fClass].forEach(sel => sel.addEventListener('change', apply));
    qs('#filterClear').addEventListener('click', () => {
      fItem.value = ''; fDept.value = ''; fClass.value = '';
      apply();
    });
  })();
</script>
</body>
</html>`);
  }

  // ============================================================
  // ENTRYPOINT
  // ============================================================
  function redirectAfterPost(res, params) {
    const target = url.resolveScript({
      scriptId:          runtime.getCurrentScript().id,
      deploymentId:      runtime.getCurrentScript().deploymentId,
      params:            params || {},
      returnExternalUrl: false
    });
    res.sendRedirect({ type: 'EXTERNAL', identifier: target });
  }

  function onRequest(context) {
    const req = context.request;
    const res = context.response;
    try {
      if (req.method === 'POST') {
        const vendorId = String(req.parameters.vendorid || '').trim();
        const linesRaw = String(req.parameters.lines    || '').trim();
        let lineRefs = [];
        try { lineRefs = JSON.parse(linesRaw); } catch (e) { throw new Error('Payload invalide (JSON).'); }
        const poId = createConsolidatedPO(vendorId, lineRefs);
        log.audit('SL_PR_INTERNAL_LINES created PO', poId);
        // Post/Redirect/Get: reload won't re-create the PO.
        return redirectAfterPost(res, { notice: 'PO consolidé créé (ID ' + poId + ').' });
      }
      const notice = String(req.parameters.notice || '').trim() || null;
      const errParam = String(req.parameters.err || '').trim() || null;
      return renderPage(res, notice, errParam);
    } catch (e) {
      log.error('SL_PR_INTERNAL_LINES', e);
      // Redirect on error too, so reloading doesn't try to re-POST.
      if (req.method === 'POST') {
        return redirectAfterPost(res, { err: (e && e.message) ? e.message : String(e) });
      }
      return renderPage(res, null, (e && e.message) ? e.message : String(e));
    }
  }

  return { onRequest };
});
