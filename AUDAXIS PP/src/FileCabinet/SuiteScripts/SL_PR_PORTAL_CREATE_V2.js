/**
 * SL_PR_PORTAL_CREATE_V2.js
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Full-HTML "Créer une demande d'achat" (Purchase Order Pending Approval)
 * - Session management delegated to LIB_PR_PORTAL_SESSION (FIX #9)
 * - Autocomplete (vendor / class / item) via same Suitelet: route=api&type=...
 * - Submit payload as JSON in hidden input "payload"
 *
 * IMPORTANT
 * 1) Set THIS_SUITELET_SCRIPTID / DEPLOYID to your script/deploy IDs
 * 2) AUTH_SUITELET_SCRIPTID / DEPLOYID must point to SL_PR_PORTAL_AUTH
 */
define(
  ['./LIB_PR_PORTAL_SESSION', './LIB_PR_PORTAL_THEME', 'N/record', 'N/search', 'N/log', 'N/url'],
  (lib, theme, record, search, log, url) => {

  const {
    REC_PORTAL_USER,
    F_EMPLOYEE, F_IS_ACTIVE,
    escapeHtml, getParam,
    getCurrentPortalUser  // FIX #4 + #9: active-user check included
  } = lib;

  // Initialized inside onRequest — N/runtime is unavailable during define callback.
  let THIS_SUITELET_SCRIPTID = '';
  let THIS_SUITELET_DEPLOYID = '';
  let AUTH_SUITELET_SCRIPTID = '';
  let AUTH_SUITELET_DEPLOYID = '';

  // Initialized inside onRequest — N/runtime is unavailable during define callback.
  let PORTAL_VENDOR_ID       = '';
  let PORTAL_GENERIC_ITEM_ID = '';
  let PORTAL_PO_FORM_ID      = '';
  let PORTAL_CURRENCY_ID     = '1';

  // ============================================================
  // URL HELPERS
  // ============================================================
  function selfUrl(params, external) {
    return url.resolveScript({
      scriptId:     THIS_SUITELET_SCRIPTID,
      deploymentId: THIS_SUITELET_DEPLOYID,
      params:       params || {},
      returnExternalUrl: !!external
    });
  }

  function authUrl(params, external) {
    return url.resolveScript({
      scriptId:     AUTH_SUITELET_SCRIPTID,
      deploymentId: AUTH_SUITELET_DEPLOYID,
      params:       params || {},
      returnExternalUrl: !!external
    });
  }

  function renderRedirect(response, targetUrl, message) {
    const safeHref = escapeHtml(targetUrl);
    const jsUrl    = JSON.stringify(String(targetUrl || ''));
    const safeMsg  = escapeHtml(message || 'Redirection...');
    response.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
    response.write(theme.pageHead('Redirection') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card card-sm" style="margin-top:32px;">
      <div class="page-title" style="margin-bottom:10px;">${safeMsg}</div>
      <div class="muted">Si rien ne se passe, <a href="${safeHref}" style="color:var(--teal);font-weight:700;">cliquez ici</a>.</div>
    </div>
  </div>
  <script>window.location.href = ${jsUrl};</script>
</body></html>`);
  }

  // ============================================================
  // PORTAL USER / EMPLOYEE HELPERS
  // ============================================================
  function getEmployeeIdFromPortalUser(portalUserId) {
    const pu = record.load({ type: REC_PORTAL_USER, id: portalUserId, isDynamic: false });
    const isActive = pu.getValue({ fieldId: F_IS_ACTIVE }) === true
                  || pu.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
    if (!isActive) return null;
    const employeeId = pu.getValue({ fieldId: F_EMPLOYEE });
    return employeeId ? String(employeeId) : null;
  }

  function getEmployeeMeta(employeeId) {
    const emp = record.load({ type: record.Type.EMPLOYEE, id: employeeId, isDynamic: false });
    const subsidiary = emp.getValue({ fieldId: 'subsidiary' });
    const name = emp.getValue({ fieldId: 'entityid' }) || emp.getValue({ fieldId: 'altname' }) || '';
    return { subsidiary: subsidiary ? String(subsidiary) : null, name: String(name || '') };
  }

  function redirectToLogin(response, message) {
    return renderRedirect(response, authUrl({ route: 'login' }, true), message || 'Redirection vers la connexion…');
  }

  // ============================================================
  // API SEARCH (vendor / class / department / item)
  // ============================================================
  function apiSearchVendors(q) {
    const s = search.create({
      type: search.Type.VENDOR,
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['entityid', 'contains', q]
      ],
      columns: [
        search.createColumn({ name: 'entityid', sort: search.Sort.ASC }),
        'companyname'
      ]
    });
    return (s.run().getRange({ start: 0, end: 20 }) || []).map(r => {
      const id       = String(r.id);
      const entityid = String(r.getValue({ name: 'entityid'    }) || '');
      const company  = String(r.getValue({ name: 'companyname' }) || '');
      return { id, label: company ? `${entityid} — ${company}` : entityid };
    });
  }

  function apiSearchClasses(q) {
    const s = search.create({
      type: 'classification',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['name', 'contains', q]
      ],
      columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
    });
    return (s.run().getRange({ start: 0, end: 20 }) || []).map(r => ({
      id:    String(r.id),
      label: String(r.getValue({ name: 'name' }) || '')
    }));
  }

  function apiSearchDepartments(q) {
    const s = search.create({
      type: 'department',
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        ['name', 'contains', q]
      ],
      columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
    });
    return (s.run().getRange({ start: 0, end: 20 }) || []).map(r => ({
      id:    String(r.id),
      label: String(r.getValue({ name: 'name' }) || '')
    }));
  }

  function apiSearchItems(q) {
    const s = search.create({
      type: search.Type.ITEM,
      filters: [
        ['isinactive', 'is', 'F'],
        'AND',
        [
          ['itemid',      'contains', q],
          'OR',
          ['displayname', 'contains', q]
        ]
      ],
      columns: [
        search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
        'displayname',
        'type'
      ]
    });
    return (s.run().getRange({ start: 0, end: 20 }) || []).map(r => {
      const id          = String(r.id);
      const itemid      = String(r.getValue({ name: 'itemid'      }) || '');
      const displayname = String(r.getValue({ name: 'displayname' }) || '');
      return { id, label: displayname ? `${itemid} — ${displayname}` : itemid };
    });
  }

  function getAllClasses() {
    try {
      const s = search.create({
        type: 'classification',
        filters: [['isinactive', 'is', 'F']],
        columns: [
          search.createColumn({ name: 'name', sort: search.Sort.ASC })
        ]
      });
      return (s.run().getRange({ start: 0, end: 200 }) || []).map(r => ({
        id:   String(r.id),
        name: String(r.getValue({ name: 'name' }) || '')
      }));
    } catch (e) { log.error('getAllClasses', e); return []; }
  }

  function getAllDepartments() {
    try {
      const s = search.create({
        type: 'department',
        filters: [['isinactive', 'is', 'F']],
        columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
      });
      return (s.run().getRange({ start: 0, end: 200 }) || []).map(r => ({
        id:   String(r.id),
        name: String(r.getValue({ name: 'name' }) || '')
      }));
    } catch (e) { log.error('getAllDepartments', e); return []; }
  }

  function getAllCurrencies() {
    try {
      const s = search.create({
        type: 'currency',
        filters: [['isinactive', 'is', 'F']],
        columns: [
          search.createColumn({ name: 'name', sort: search.Sort.ASC }),
          'symbol',
          'exchangerate'
        ]
      });
      return (s.run().getRange({ start: 0, end: 100 }) || []).map(r => ({
        id:     String(r.id),
        name:   String(r.getValue({ name: 'name'   }) || ''),
        symbol: String(r.getValue({ name: 'symbol' }) || ''),
        rate:   parseFloat(r.getValue({ name: 'exchangerate' }) || '1') || 1
      }));
    } catch (e) { log.error('getAllCurrencies', e); return []; }
  }

  function handleApi(context) {
    const req  = context.request;
    const res  = context.response;
    const type = String(req.parameters.type || '').toLowerCase();
    const q    = String(req.parameters.q    || '').trim();

    res.setHeader({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
    if (!q || q.length < 2) { res.write(JSON.stringify({ items: [] })); return; }

    try {
      if (type === 'vendor') return res.write(JSON.stringify({ items: apiSearchVendors(q)     }));
      if (type === 'class')  return res.write(JSON.stringify({ items: apiSearchClasses(q)     }));
      if (type === 'dept')   return res.write(JSON.stringify({ items: apiSearchDepartments(q) }));
      if (type === 'item')   return res.write(JSON.stringify({ items: apiSearchItems(q)       }));
      res.write(JSON.stringify({ items: [] }));
    } catch (e) {
      log.error('Create V2 API error', e);
      res.write(JSON.stringify({ items: [], error: String(e.message || e) }));
    }
  }

  // ============================================================
  // PO CREATION
  // ============================================================
  function createPurchaseOrderFromPayload(payload, employeeId) {
    const vendorId   = PORTAL_VENDOR_ID;
    const currencyId = String(payload.currencyId || '').trim();
    const memo       = String(payload.memo       || '').trim();
    const lines      = Array.isArray(payload.lines) ? payload.lines : [];

    if (!currencyId)   throw new Error('Devise requise.');
    if (!lines.length) throw new Error('Aucune ligne. Ajoute au moins 1 article.');

    const empMeta = getEmployeeMeta(employeeId);
    const po = record.create({
      type: record.Type.PURCHASE_ORDER,
      isDynamic: true,
      defaultValues: PORTAL_PO_FORM_ID ? { customform: PORTAL_PO_FORM_ID } : {}
    });

    if (empMeta.subsidiary) {
      try { po.setValue({ fieldId: 'subsidiary', value: empMeta.subsidiary }); } catch (e) {}
    }
    po.setValue({ fieldId: 'entity', value: vendorId });
    try { po.setValue({ fieldId: 'currency', value: currencyId }); } catch (e) {}
    try { po.setValue({ fieldId: 'employee', value: employeeId }); } catch (e) {}
    if (memo) po.setValue({ fieldId: 'memo', value: memo });
    try { po.setValue({ fieldId: 'approvalstatus', value: '1' }); } catch (e) {} // Pending Approval
    try { po.setValue({ fieldId: 'custbody_cde_dem_appro', value: true }); } catch (e) {}

    // Compute trandate as YYYYMMDD for the custom-segment value.
    const trandateVal = po.getValue({ fieldId: 'trandate' });
    const pad2 = (n) => (n < 10 ? '0' : '') + n;
    const ymd = (trandateVal instanceof Date)
      ? String(trandateVal.getFullYear()) + pad2(trandateVal.getMonth() + 1) + pad2(trandateVal.getDate())
      : '';

    let added = 0;
    for (let i = 0; i < lines.length; i++) {
      const ln          = lines[i] || {};
      const description = String(ln.description || '').trim();
      const classId     = String(ln.classId || '').trim();
      const deptId      = String(ln.deptId  || '').trim();
      const qty         = parseFloat(String(ln.qty || '0'));
      const rateRaw     = (ln.rate === null || typeof ln.rate === 'undefined') ? '' : String(ln.rate);
      const rate        = rateRaw === '' ? 0 : (isNaN(parseFloat(rateRaw)) ? 0 : parseFloat(rateRaw));
      const leadTimeRaw = String(ln.leadTime || '').trim();
      const leadTime    = leadTimeRaw === '' ? null : (isNaN(parseFloat(leadTimeRaw)) ? null : parseFloat(leadTimeRaw));
      const comment     = String(ln.comment || '').trim();

      if (!description || !qty || qty <= 0) continue;

      po.selectNewLine({ sublistId: 'item' });
      po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item',     value: PORTAL_GENERIC_ITEM_ID });
      po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: qty    });
      try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: description }); } catch (e) {}
      try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate',       value: rate    }); } catch (e) {}
      try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'class',      value: classId }); } catch (e) {}
      try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: deptId  }); } catch (e) {}
      if (leadTime !== null) try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_cde_lead_time',         value: leadTime }); } catch (e) {}
      if (comment)           try { po.setCurrentSublistValue({ sublistId: 'item', fieldId: 'custcol_cde_logistic_comment',  value: comment  }); } catch (e) {}

      po.commitLine({ sublistId: 'item' });
      added++;
    }

    if (added === 0) throw new Error('Aucune ligne valide : ajoute au moins 1 article avec une quantité > 0.');

    const poId = po.save({ enableSourcing: true, ignoreMandatoryFields: false });

    // Post-save: prepend "DDA" to the NetSuite-assigned tranid, then create a
    // unique cseg_cde_dda_id custom-segment value per line (named with the
    // final tranid to guarantee uniqueness).
    try {
      const f = search.lookupFields({
        type: record.Type.PURCHASE_ORDER,
        id: poId,
        columns: ['tranid']
      });
      const rawTranid = String(f && f.tranid ? f.tranid : '').trim();
      const finalTranid = (rawTranid && rawTranid.indexOf('DDA') !== 0) ? ('DDA' + rawTranid) : rawTranid;

      const po2 = record.load({ type: record.Type.PURCHASE_ORDER, id: poId, isDynamic: true });
      if (finalTranid && finalTranid !== rawTranid) {
        po2.setValue({ fieldId: 'tranid', value: finalTranid });
      }

      const lineCount = po2.getLineCount({ sublistId: 'item' });
      for (let i = 0; i < lineCount; i++) {
        try {
          po2.selectLine({ sublistId: 'item', line: i });
          const segValue = finalTranid + '-' + ymd + '-' + String(i + 1);

          const segRec = record.create({ type: 'customrecord_cseg_cde_dda_id' });
          segRec.setValue({ fieldId: 'name', value: segValue });
          const segId = segRec.save({ ignoreMandatoryFields: true });

          po2.setCurrentSublistValue({ sublistId: 'item', fieldId: 'cseg_cde_dda_id', value: segId });
          po2.commitLine({ sublistId: 'item' });
          log.audit('cseg_cde_dda_id created', 'line=' + (i + 1) + ' value=' + segValue + ' segId=' + segId);
        } catch (e) {
          log.error('cseg_cde_dda_id setup line ' + (i + 1), (e && e.message) ? e.message : String(e));
        }
      }

      po2.save({ enableSourcing: false, ignoreMandatoryFields: true });
    } catch (e) {
      log.error('post-save cseg/tranid', (e && e.message) ? e.message : String(e));
    }

    return { poId, added };
  }

  // ============================================================
  // HTML PAGE
  // ============================================================
  function renderCreatePage(context, employeeName, classes, departments, currencies) {
    const res = context.response;

    const postUrl     = selfUrl({ route: 'create' }, true);
    const logoutUrl   = authUrl({ route: 'logout' }, true); // POST target — FIX #3

    const linkHome    = authUrl({ route: 'home'    }, true);
    const linkMyPos   = authUrl({ route: 'mypos'   }, true);
    const linkCreate  = selfUrl({ route: 'create'  }, true);
    const linkApprove = authUrl({ route: 'approve' }, true);

    res.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });

    res.write(theme.pageHead('Créer une demande') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <style>
    /* Compact table for the create page — more columns need smaller inputs */
    .create-table .input{ padding:6px 8px; font-size:12px; }
    .create-table th, .create-table td{ padding:8px 6px; }
    .create-table th{ font-size:10px; }
    .create-table th .th-en{ font-size:8px; }
  </style>
  <div class="wrap" style="max-width:100%;padding:16px 20px;">
    <div class="card" style="padding:20px 16px;">
      <div class="page-head">
        <div>
          <div class="page-title">Créer une demande d'achat</div>
          <p class="page-sub">Choisis un fournisseur, puis ajoute des lignes (article + quantité). Le PO sera créé en attente d'approbation.</p>
        </div>
        <div class="nav">
          <a href="${escapeHtml(linkHome)}">Accueil</a>
          <a href="${escapeHtml(linkMyPos)}">Mes demandes</a>
          <a class="active" href="${escapeHtml(linkCreate)}">Créer</a>
          <a href="${escapeHtml(linkApprove)}">À approuver</a>
          <form class="nav-logout-form" method="POST" action="${escapeHtml(logoutUrl)}">
            <button type="submit" class="nav-logout">Déconnexion</button>
          </form>
        </div>
      </div>
      <div class="divider"></div>
      <div class="spacer"></div>

      <div id="notice" class="notice"></div>
      <div id="error"  class="error-box"></div>

      <form id="createForm" method="POST" action="${escapeHtml(postUrl)}" autocomplete="off">
        <input type="hidden" name="route"   value="create" />
        <input type="hidden" name="payload" id="payload"   value="" />

        <div class="grid">
          <div class="field">
            <div class="label">Employé</div>
            <div class="pill">${escapeHtml(employeeName || '')}</div>
            <div class="help">L'employé est déduit de ta session.</div>
          </div>

          <div class="field">
            <div class="label">Devise *</div>
            <select class="input" id="currencySelect"></select>
          </div>

          <div class="field" style="grid-column:1/-1;">
            <div class="label">Commentaire / Justification</div>
            <input class="input" id="memoInput" placeholder="Optionnel" />
          </div>
        </div>

        <div class="spacer"></div>

        <div class="row">
          <div>
            <span class="pill">Lignes</span>
            <span class="muted" style="margin-left:8px;">Ajoute des articles + quantités.</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" class="btn" id="addLineBtn">+ Ajouter une ligne</button>
            <button type="submit" class="btn primary">Créer la demande</button>
          </div>
        </div>

        <div class="spacer"></div>

        <div class="tableWrap">
          <table class="create-table">
            <thead>
              <tr>
                <th style="width:8%;">Département<div class="th-en">Department</div></th>
                <th style="width:12%;">Description<div class="th-en">Description</div></th>
                <th style="width:4%;">Qté<div class="th-en">Qty</div></th>
                <th style="width:9%;">Classe<div class="th-en">Class</div></th>
                <th style="width:7%;" class="right"><span id="rateHeader">Prix (devise)</span><div class="th-en">Rate (currency)</div></th>
                <th style="width:7%;" class="right">Prix (EUR)<div class="th-en">Rate (EUR)</div></th>
                <th style="width:10%;" class="right">Total (EUR)<div class="th-en">Total (EUR)</div></th>
                <th style="width:5%;">Délai<div class="th-en">Lead time</div></th>
                <th style="width:11%;">Commentaire<div class="th-en">Comment</div></th>
                <th style="width:4%;"  class="right">Action<div class="th-en">Action</div></th>
              </tr>
            </thead>
            <tbody id="linesBody"></tbody>
          </table>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:16px;">
          <div style="min-width:320px;background:#fff;border:1.5px solid var(--line);border-radius:var(--radius-sm);padding:14px 18px;box-shadow:var(--shadow);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:8px;">
              <span style="font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase;">Lignes</span>
              <span style="font-size:14px;font-weight:700;" id="linesCount">0</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;">
              <span style="font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;">Total de la commande</span>
              <span style="font-size:22px;font-weight:800;color:var(--teal-dark);" id="grandTotalEur">0.00 €</span>
            </div>
          </div>
        </div>

        <div class="spacer"></div>
        <div class="muted">Astuce : sur mobile, fais défiler la table horizontalement.</div>
      </form>
    </div>
  </div>

<script>
  const CLASSES    = ${JSON.stringify(classes)};
  const DEPTS      = ${JSON.stringify(departments)};
  const CURRENCIES = ${JSON.stringify(currencies)};
  const DEFAULT_CURRENCY_ID = '${PORTAL_CURRENCY_ID}';

  function qs(sel){ return document.querySelector(sel); }
  function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
  function show(el, yes){ el.style.display = yes ? 'block' : 'none'; }
  function setText(el, txt){ el.textContent = txt || ''; }

  function showError(msg){
    const e = qs('#error'); setText(e, msg); show(e, true);
    show(qs('#notice'), false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function showNotice(msg){
    const n = qs('#notice'); setText(n, msg); show(n, true);
    show(qs('#error'), false);
  }

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

  // Combobox: shows all items on focus, filters client-side as the user types.
  // Optional onChange(item|null) fires on select or clear.
  function attachCombobox(inp, hid, _unused, items, onChange){
    const lst = makeOverlay();
    const close = () => { lst.style.display='none'; lst.innerHTML=''; };

    function render(){
      const q = (inp.value || '').toLowerCase().trim();
      const filtered = q.length === 0
        ? items
        : items.filter(it => String(it.name||'').toLowerCase().includes(q));
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
    inp.addEventListener('input', () => { hid.value = ''; if (onChange) onChange(null); render(); });
    lst.addEventListener('click', ev => {
      const row = ev.target.closest('.ta-item');
      if (!row) return;
      const id = row.getAttribute('data-id');
      hid.value = id;
      inp.value = row.getAttribute('data-label');
      if (onChange) onChange(items.find(it => it.id === id) || null);
      close();
    });
    document.addEventListener('click', ev => {
      if (ev.target === inp || lst.contains(ev.target)) return;
      close();
    });
    window.addEventListener('scroll', () => { if (lst.style.display !== 'none') overlayPosition(lst, inp); }, true);
    window.addEventListener('resize', () => { if (lst.style.display !== 'none') overlayPosition(lst, inp); });
  }

  let lineSeq = 0;

  function makeLineRow(){
    const id = ++lineSeq;
    const tr = document.createElement('tr');
    tr.setAttribute('data-line', String(id));
    tr.innerHTML = \`
      <td class="ta">
        <input class="input deptInput"  placeholder="— Département —" autocomplete="off" />
        <input type="hidden" class="deptId" />
      </td>
      <td>
        <input class="input descInput" type="text" placeholder="Description de l'article…" />
      </td>
      <td><input class="input qtyInput"  type="number" step="any" min="0" placeholder="0" /></td>
      <td class="ta">
        <input class="input classInput" placeholder="— Classe —" autocomplete="off" />
        <input type="hidden" class="classId" />
      </td>
      <td class="right"><input class="input rateInput"      type="number" step="any" min="0" placeholder="0" /></td>
      <td class="right"><input class="input rateEurInput"   readonly placeholder="—" style="background:#f9fafb;color:#374151;text-align:right;" /></td>
      <td class="right"><input class="input totalEurInput"  readonly placeholder="—" style="background:#eef2ff;color:#1f2a5a;text-align:right;font-weight:700;" /></td>
      <td><input class="input leadTimeInput" type="number" step="1" min="0" placeholder="j" title="Délai en jours / Lead time (days)" /></td>
      <td><input class="input commentInput"  type="text" placeholder="Commentaire…" /></td>
      <td class="right"><button type="button" class="btn danger removeBtn">✕</button></td>\`;

    attachCombobox(tr.querySelector('.classInput'), tr.querySelector('.classId'), null, CLASSES);
    attachCombobox(tr.querySelector('.deptInput'),   tr.querySelector('.deptId'),  tr.querySelector('.deptList'),  DEPTS);
    tr.querySelector('.rateInput').addEventListener('input', () => recomputeLine(tr));
    tr.querySelector('.qtyInput').addEventListener('input',  () => recomputeLine(tr));
    tr.querySelector('.removeBtn').addEventListener('click', () => { tr.remove(); recomputeGrandTotal(); });
    return tr;
  }

  function selectedCurrency(){
    const id = qs('#currencySelect').value;
    return CURRENCIES.find(c => c.id === id) || null;
  }

  function recomputeLine(tr){
    const cur  = selectedCurrency();
    const rate = parseFloat((tr.querySelector('.rateInput').value || '').trim());
    const qty  = parseFloat((tr.querySelector('.qtyInput').value  || '').trim());
    const rateEurOut  = tr.querySelector('.rateEurInput');
    const totalEurOut = tr.querySelector('.totalEurInput');

    if (!cur || !isFinite(rate) || rate <= 0){
      rateEurOut.value  = '';
      totalEurOut.value = '';
    } else {
      const rateEur = rate * (cur.rate || 1);
      rateEurOut.value = rateEur.toFixed(2);
      totalEurOut.value = (isFinite(qty) && qty > 0) ? (rateEur * qty).toFixed(2) : '';
    }
    recomputeGrandTotal();
  }

  function recomputeAll(){
    qsa('#linesBody tr').forEach(recomputeLine);
  }

  function recomputeGrandTotal(){
    const rows = qsa('#linesBody tr');
    let total = 0;
    rows.forEach(tr => {
      const v = parseFloat((tr.querySelector('.totalEurInput').value || '').trim());
      if (isFinite(v)) total += v;
    });
    qs('#grandTotalEur').textContent = total.toFixed(2) + ' €';
    qs('#linesCount').textContent = String(rows.length);
  }

  // Populate currency dropdown, default to EUR (id=1)
  (function initCurrencies(){
    const sel = qs('#currencySelect');
    sel.innerHTML = CURRENCIES.map(c => {
      const label = c.name + (c.symbol ? ' (' + c.symbol + ')' : '');
      return '<option value="' + c.id + '">' + label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</option>';
    }).join('');
    if (CURRENCIES.some(c => c.id === DEFAULT_CURRENCY_ID)) sel.value = DEFAULT_CURRENCY_ID;
    sel.addEventListener('change', recomputeAll);
  })();

  function collectPayload(){
    return {
      currencyId: (qs('#currencySelect').value || '').trim(),
      memo:       (qs('#memoInput').value     || '').trim(),
      lines: qsa('#linesBody tr').map(tr => ({
        description: (tr.querySelector('.descInput').value     || '').trim(),
        classId:     (tr.querySelector('.classId').value       || '').trim(),
        deptId:      (tr.querySelector('.deptId').value        || '').trim(),
        qty:         (tr.querySelector('.qtyInput').value      || '').trim(),
        rate:        (tr.querySelector('.rateInput').value     || '').trim(),
        rateEur:     (tr.querySelector('.rateEurInput').value  || '').trim(),
        leadTime:    (tr.querySelector('.leadTimeInput').value || '').trim(),
        comment:     (tr.querySelector('.commentInput').value  || '').trim()
      }))
    };
  }

  function validatePayload(p){
    if (!p.currencyId) return 'Veuillez sélectionner une devise.';
    if (!p.lines.some(l => l.description && parseFloat(l.qty || '0') > 0))
      return 'Ajoute au moins 1 ligne valide (description + quantité > 0).';
    return '';
  }

  qs('#addLineBtn').addEventListener('click', () => { qs('#linesBody').appendChild(makeLineRow()); recomputeGrandTotal(); });

  // Start with 1 empty line
  qs('#linesBody').appendChild(makeLineRow());
  recomputeGrandTotal();

  qs('#createForm').addEventListener('submit', ev => {
    const p   = collectPayload();
    const err = validatePayload(p);
    if (err){ ev.preventDefault(); showError(err); return; }
    qs('#payload').value = JSON.stringify(p);
  });
</script>
</body>
</html>`);
  }

  // ============================================================
  // POST HANDLER
  // ============================================================
  function handleCreatePost(context, employeeId) {
    const payloadStr = String(context.request.parameters.payload || '').trim();
    if (!payloadStr) throw new Error('Payload manquant.');

    let payload;
    try { payload = JSON.parse(payloadStr); }
    catch (e) { throw new Error('Payload invalide (JSON).'); }

    const result = createPurchaseOrderFromPayload(payload, employeeId);
    log.audit('Portal PO created (V2)', result);

    const myposUrl = authUrl({ route: 'mypos', notice: `PO créé (ID ${result.poId})` }, true);
    return renderRedirect(context.response, myposUrl, 'Demande créée. Redirection…');
  }

  // ============================================================
  // ENTRYPOINT
  // ============================================================
  function onRequest(context) {
    THIS_SUITELET_SCRIPTID = String(getParam('custscript_pr_create_self_scriptid', 'customscript_sl_pr_portal_create_v2'));
    THIS_SUITELET_DEPLOYID = String(getParam('custscript_pr_create_self_deployid', ''));
    AUTH_SUITELET_SCRIPTID = String(getParam('custscript_pr_create_auth_scriptid', 'customscript_sl_pr_portal_auth'));
    AUTH_SUITELET_DEPLOYID = String(getParam('custscript_pr_create_auth_deployid', ''));
    PORTAL_VENDOR_ID       = String(getParam('custscript_pr_portal_vendor_id',     ''));
    PORTAL_GENERIC_ITEM_ID = String(getParam('custscript_pr_portal_item_id',       ''));
    PORTAL_PO_FORM_ID      = String(getParam('custscript_pr_portal_po_form',       ''));
    PORTAL_CURRENCY_ID     = String(getParam('custscript_pr_portal_currency_id',   '1'));

    const req   = context.request;
    const res   = context.response;
    const route = String(req.parameters.route || 'create').toLowerCase();

    try {
      // Session check applies to all routes (FIX #4 handled inside getCurrentPortalUser)
      const portalUserId = getCurrentPortalUser(req);
      if (!portalUserId) return redirectToLogin(res);

      if (route === 'api') return handleApi(context);

      const employeeId = getEmployeeIdFromPortalUser(portalUserId);
      if (!employeeId) return redirectToLogin(res, 'Compte mal configuré (employee manquant ou inactif).');

      if (req.method === 'GET') return renderCreatePage(context, getEmployeeMeta(employeeId).name, getAllClasses(), getAllDepartments(), getAllCurrencies());
      return handleCreatePost(context, employeeId);

    } catch (e) {
      log.error('SL_PR_PORTAL_CREATE_V2 fatal', e);
      const msg = (e && e.message) ? e.message : String(e);
      res.setHeader({ name: 'Content-Type', value: 'text/html; charset=utf-8' });
      res.write(theme.pageHead('Erreur') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card card-sm" style="margin-top:32px;">
      <div class="page-title" style="color:#7f1d1d;margin-bottom:12px;">Erreur</div>
      <div class="alert error" style="display:block;">${escapeHtml(msg)}</div>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <a href="${escapeHtml(authUrl({ route:'home'  }, true))}" class="btn">Retour accueil</a>
        <a href="${escapeHtml(authUrl({ route:'login' }, true))}" class="btn primary">Connexion</a>
      </div>
    </div>
  </div>
</body></html>`);
    }
  }

  return { onRequest };
});
