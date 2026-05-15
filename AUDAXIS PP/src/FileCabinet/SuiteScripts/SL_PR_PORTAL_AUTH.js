/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(
  ['./LIB_PR_PORTAL_SESSION', './LIB_PR_PORTAL_THEME', 'N/ui/serverWidget', 'N/url', 'N/record', 'N/search', 'N/runtime', 'N/format', 'N/log'],
  (lib, theme, ui, url, record, search, runtime, format, log) => {

  // Pull everything used here out of the shared library.
  const {
    REC_PORTAL_USER,
    F_EMPLOYEE, F_IS_ACTIVE,
    F_PW_HASH, F_PW_SALT,
    F_PW_TOKEN_HASH, F_PW_TOKEN_EXPIRES, F_PW_TOKEN_USED,
    F_FAILED_ATTEMPTS, F_LOCKED_UNTIL, F_LAST_LOGIN,
    P_PW_HASH_ITERS, P_LOCK_MAX_ATTEMPTS, P_LOCK_MINUTES,
    now, addMinutes, getParam, escapeHtml,
    sha256Hex, randomBase64UrlToken, derivePasswordHash,
    getCurrentPortalUser, createSession, revokeSession
  } = lib;

  const PORTAL_SCRIPTID  = 'customscript_sl_pr_portal_create_v2';
  const PORTAL_DEPLOYID  = 'customdeploy_sl_pr_portal_create_v2';

  // ============================================================
  // URL / REDIRECT HELPERS
  // Use returnExternalUrl:true — sendRedirect({ type:'SUITELET' })
  // generates an internal URL that requires an active NS session.
  // ============================================================
  function redirectToRoute(res, params) {
    const extUrl = url.resolveScript({
      scriptId:          runtime.getCurrentScript().id,
      deploymentId:      runtime.getCurrentScript().deploymentId,
      params:            params,
      returnExternalUrl: true
    });
    res.sendRedirect({ type: 'EXTERNAL', identifier: extUrl });
  }

  // ============================================================
  // DATA LOOKUPS (auth-specific)
  // ============================================================
  function findEmployeeIdByEmail(emailAddr) {
    const s = search.create({
      type: search.Type.EMPLOYEE,
      filters: [['email', 'is', emailAddr]],
      columns: ['internalid']
    });
    const r = s.run().getRange({ start: 0, end: 1 });
    if (!r || !r.length) return null;
    return r[0].getValue({ name: 'internalid' });
  }

  function findPortalUserIdByEmployee(employeeId) {
    const s = search.create({
      type: REC_PORTAL_USER,
      filters: [[F_EMPLOYEE, 'anyof', employeeId]],
      columns: ['internalid']
    });
    const r = s.run().getRange({ start: 0, end: 1 });
    if (!r || !r.length) return null;
    return r[0].getValue({ name: 'internalid' });
  }

  function findPortalUserIdBySetPwTokenHash(tokenHashHex) {
    const s = search.create({
      type: REC_PORTAL_USER,
      filters: [[F_PW_TOKEN_HASH, 'is', tokenHashHex]],
      columns: ['internalid']
    });
    const r = s.run().getRange({ start: 0, end: 1 });
    if (!r || !r.length) return null;
    return r[0].getValue({ name: 'internalid' });
  }

  // ============================================================
  // UI PAGES
  // ============================================================
  function renderLogin(response, message) {
    const msgHtml = message
      ? `<div class="alert error">${escapeHtml(message)}</div>`
      : '';
    response.write({ output:
      theme.pageHead('Connexion') +
      `<body>
<div class="auth-wrap">
  ${theme.brandHeader('Portail Achats')}
  <div class="auth-body">
    <div class="auth-card">
      <div class="auth-title">Connexion</div>
      <div class="auth-sub">Entrez vos identifiants pour accéder au portail.</div>
      ${msgHtml}
      <form method="POST">
        <input type="hidden" name="route" value="login">
        <div class="form-group">
          <label for="email">Adresse e-mail</label>
          <input class="input" type="email" id="email" name="email" required autocomplete="username" placeholder="prenom.nom@example.com">
        </div>
        <div class="form-group">
          <label for="pw">Mot de passe</label>
          <input class="input" type="password" id="pw" name="pw" required autocomplete="current-password" placeholder="••••••••••">
        </div>
        <button type="submit" class="btn primary full">Se connecter</button>
      </form>
    </div>
  </div>
</div>
</body></html>`
    });
  }

  function renderSetPw(response, message, token) {
    const safeToken = escapeHtml(token || '');
    const msgHtml = message
      ? `<div class="alert error">${escapeHtml(message)}</div>`
      : '';

    response.write({ output:
      theme.pageHead('Définir votre mot de passe') +
      `<body>
<div class="auth-wrap">
  ${theme.brandHeader('Portail Achats')}
  <div class="auth-body">
    <div class="auth-card">
      <div class="auth-title">Créer votre mot de passe</div>
      <div class="auth-sub">Choisissez un mot de passe sécurisé d'au moins 10 caractères.</div>
      ${msgHtml}
      <form method="POST">
        <input type="hidden" name="route" value="setpw">
        <input type="hidden" name="t" value="${safeToken}">
        <div class="form-group">
          <label for="pw1">Nouveau mot de passe (min 10 caractères)</label>
          <input class="input" type="password" id="pw1" name="pw1" required minlength="10" autocomplete="new-password" placeholder="••••••••••">
        </div>
        <div class="form-group">
          <label for="pw2">Confirmer le mot de passe</label>
          <input class="input" type="password" id="pw2" name="pw2" required minlength="10" autocomplete="new-password" placeholder="••••••••••">
        </div>
        <button type="submit" class="btn primary full">Enregistrer</button>
      </form>
    </div>
  </div>
</div>
</body></html>`
    });
  }


  // ============================================================
  // ROUTES
  // ============================================================
  function handleLogin(context) {
    const req = context.request;
    const res = context.response;

    if (req.method === 'GET') return renderLogin(res);

    // POST
    const emailAddr = (req.parameters.email || '').trim().toLowerCase();
    const pw        =  req.parameters.pw    || '';

    log.audit('handleLogin', JSON.stringify({
      emailPresent: !!emailAddr, emailLen: emailAddr.length,
      pwPresent: !!pw, pwLen: pw.length
    }));

    if (!emailAddr || !pw) return renderLogin(res, 'Email et mot de passe requis.');

    const employeeId = findEmployeeIdByEmail(emailAddr);
    log.audit('handleLogin', 'employeeId: ' + employeeId);
    if (!employeeId)  return renderLogin(res, 'Identifiants invalides.');

    const portalUserId = findPortalUserIdByEmployee(employeeId);
    log.audit('handleLogin', 'portalUserId: ' + portalUserId);

    // Diagnostic: scan all portal users to see what employee IDs they carry
    try {
      const diagSearch = search.create({
        type: REC_PORTAL_USER,
        filters: [],
        columns: ['internalid', F_EMPLOYEE, F_IS_ACTIVE]
      });
      const diagRows = diagSearch.run().getRange({ start: 0, end: 10 }) || [];
      const diagData = diagRows.map(r => ({
        id:       r.getValue({ name: 'internalid' }),
        employee: r.getValue({ name: F_EMPLOYEE }),
        active:   r.getValue({ name: F_IS_ACTIVE })
      }));
      log.audit('handleLogin diag', JSON.stringify(diagData));
    } catch (e) { log.error('handleLogin diag', e); }

    if (!portalUserId) return renderLogin(res, 'Identifiants invalides.');

    const pu = record.load({ type: REC_PORTAL_USER, id: portalUserId, isDynamic: false });

    const isActive = pu.getValue({ fieldId: F_IS_ACTIVE }) === true
                  || pu.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
    if (!isActive) return renderLogin(res, 'Compte inactif. Contactez un administrateur.');

    const lockedUntil = pu.getValue({ fieldId: F_LOCKED_UNTIL });
    if (lockedUntil) {
      const lu = lockedUntil instanceof Date ? lockedUntil : new Date(lockedUntil);
      if (lu > now()) return renderLogin(res, 'Compte temporairement verrouillé. Réessayez plus tard.');
    }

    const salt       = pu.getValue({ fieldId: F_PW_SALT }) || '';
    const storedHash = pu.getValue({ fieldId: F_PW_HASH }) || '';
    log.audit('handleLogin', JSON.stringify({
      saltPresent: !!salt, saltLen: salt.length,
      hashPresent: !!storedHash, hashLen: storedHash.length
    }));
    if (!salt || !storedHash) {
      return renderLogin(res, 'Mot de passe non défini. Contactez un administrateur pour recevoir un lien de création.');
    }

    const iters      = parseInt(getParam(P_PW_HASH_ITERS, '10000'), 10);
    const computed   = derivePasswordHash(pw, salt, iters);
    log.audit('handleLogin', JSON.stringify({
      iters, hashMatch: computed === storedHash,
      computedPrefix: computed.slice(0, 8), storedPrefix: storedHash.slice(0, 8)
    }));
    const maxAttempts = parseInt(getParam(P_LOCK_MAX_ATTEMPTS, '5'), 10);
    const lockMins   = parseInt(getParam(P_LOCK_MINUTES, '15'), 10);

    if (computed !== storedHash) {
      const prev = parseInt(pu.getValue({ fieldId: F_FAILED_ATTEMPTS }) || '0', 10);
      const next = prev + 1;
      const values = { [F_FAILED_ATTEMPTS]: next };
      if (next >= maxAttempts) {
        values[F_LOCKED_UNTIL]      = addMinutes(now(), lockMins);
        values[F_FAILED_ATTEMPTS]   = 0;
      }
      record.submitFields({
        type: REC_PORTAL_USER, id: portalUserId, values,
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
      return renderLogin(res, 'Identifiants invalides.');
    }

    // Success
    record.submitFields({
      type: REC_PORTAL_USER, id: portalUserId,
      values: { [F_FAILED_ATTEMPTS]: 0, [F_LOCKED_UNTIL]: null, [F_LAST_LOGIN]: now() },
      options: { enableSourcing: false, ignoreMandatoryFields: true }
    });

    createSession(res, portalUserId);

    // Deliver the Set-Cookie header in this response, then meta-refresh to the
    // home dashboard. sendRedirect would drop the Set-Cookie header before the
    // browser stores the cookie.
    const homeUrl = url.resolveScript({
      scriptId:          runtime.getCurrentScript().id,
      deploymentId:      runtime.getCurrentScript().deploymentId,
      params:            { route: 'home' },
      returnExternalUrl: true
    });
    res.write({ output:
      '<!DOCTYPE html><html><head>' +
      '<meta charset="UTF-8">' +
      '<meta http-equiv="refresh" content="0;url=' + escapeHtml(homeUrl) + '">' +
      '</head><body></body></html>'
    });
  }

  function validateSetPwTokenOrThrow(portalUserId, tokenHashHex) {
    const pu = record.load({ type: REC_PORTAL_USER, id: portalUserId, isDynamic: false });

    const isActive = pu.getValue({ fieldId: F_IS_ACTIVE }) === true
                  || pu.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
    if (!isActive) throw new Error('Compte inactif.');

    const storedHash = pu.getValue({ fieldId: F_PW_TOKEN_HASH }) || '';
    const used       = pu.getValue({ fieldId: F_PW_TOKEN_USED   }) === true
                    || pu.getValue({ fieldId: F_PW_TOKEN_USED   }) === 'T';
    const expires    = pu.getValue({ fieldId: F_PW_TOKEN_EXPIRES });

    if (!storedHash || storedHash !== tokenHashHex) throw new Error('Lien invalide.');
    if (used)    throw new Error('Lien déjà utilisé.');
    if (!expires) throw new Error('Lien invalide.');

    const exp = expires instanceof Date ? expires : new Date(expires);
    if (exp <= now()) throw new Error('Lien expiré.');

    return pu;
  }

  function handleSetPw(context) {
    const req = context.request;
    const res = context.response;

    if (req.method === 'GET') {
      const token = (req.parameters.t || '').trim();
      if (!token) return renderSetPw(res, 'Lien invalide.', '');

      const tokenHashHex = sha256Hex(token);
      const portalUserId = findPortalUserIdBySetPwTokenHash(tokenHashHex);
      if (!portalUserId) return renderSetPw(res, 'Lien invalide.', '');

      try { validateSetPwTokenOrThrow(portalUserId, tokenHashHex); }
      catch (e) { return renderSetPw(res, String(e.message || e), ''); }

      return renderSetPw(res, null, token);
    }

    // POST
    log.audit('handleSetPw', 'POST received');

    const token = (req.parameters.t   || '').trim();
    const pw1   =  req.parameters.pw1 || '';
    const pw2   =  req.parameters.pw2 || '';

    log.audit('handleSetPw', JSON.stringify({
      tokenPresent: !!token,
      tokenLength:  token.length,
      pw1Present:   !!pw1,
      pw1Length:    pw1.length,
      pw2Present:   !!pw2,
      pw1MatchPw2:  pw1 === pw2
    }));

    if (!token)             return renderSetPw(res, 'Lien invalide.', '');
    if (!pw1 || !pw2)       return renderSetPw(res, 'Veuillez saisir et confirmer le mot de passe.', token);
    if (pw1 !== pw2)        return renderSetPw(res, 'Les mots de passe ne correspondent pas.', token);
    if (pw1.length < 10)    return renderSetPw(res, 'Mot de passe trop court (min 10 caractères).', token);

    log.audit('handleSetPw', 'Validation passed, looking up token hash');

    const tokenHashHex = sha256Hex(token);
    const portalUserId = findPortalUserIdBySetPwTokenHash(tokenHashHex);
    if (!portalUserId) return renderSetPw(res, 'Lien invalide.', '');

    log.audit('handleSetPw', 'Portal user found: ' + portalUserId);

    try { validateSetPwTokenOrThrow(portalUserId, tokenHashHex); }
    catch (e) { return renderSetPw(res, String(e.message || e), ''); }

    log.audit('handleSetPw', 'Token valid, generating salt and hash');

    const iters  = parseInt(getParam(P_PW_HASH_ITERS, '10000'), 10);
    const salt   = randomBase64UrlToken(16);

    log.audit('handleSetPw', 'Salt generated, running KDF with ' + iters + ' iterations');

    const pwHash = derivePasswordHash(pw1, salt, iters);

    log.audit('handleSetPw', 'KDF done, saving to portal user ' + portalUserId);

    record.submitFields({
      type: REC_PORTAL_USER, id: portalUserId,
      values: { [F_PW_SALT]: salt, [F_PW_HASH]: pwHash, [F_PW_TOKEN_USED]: true },
      options: { enableSourcing: false, ignoreMandatoryFields: true }
    });

    log.audit('handleSetPw', 'Save complete');

    const loginUrl = url.resolveScript({
      scriptId:          runtime.getCurrentScript().id,
      deploymentId:      runtime.getCurrentScript().deploymentId,
      params:            { route: 'login' },
      returnExternalUrl: true
    });

    res.write({ output:
      theme.pageHead('Mot de passe enregistré') +
      `<body>
<div class="auth-wrap">
  ${theme.brandHeader('Portail Achats')}
  <div class="auth-body">
    <div class="auth-card">
      <div class="auth-title">Mot de passe enregistré</div>
      <div class="alert success" style="display:block;margin-top:12px;margin-bottom:20px;">
        Votre mot de passe a été enregistré avec succès.
      </div>
      <a href="${escapeHtml(loginUrl)}" class="btn primary full" style="display:flex;text-decoration:none;justify-content:center;">Aller à la connexion</a>
    </div>
  </div>
</div>
</body></html>`
    });
  }

  function handleLogout(context) {
    // FIX #3: only accept POST so this cannot be triggered by a simple link or
    // <img> tag on a third-party page (GET-based CSRF logout).
    if (context.request.method !== 'POST') {
      return redirectToRoute(context.response, { route: 'login' });
    }
    revokeSession(context.request, context.response);
    redirectToRoute(context.response, { route: 'login' });
  }

  function getEmployeeFirstName(portalUserId) {
    try {
      const pu = record.load({ type: REC_PORTAL_USER, id: portalUserId, isDynamic: false });
      const empId = pu.getValue({ fieldId: F_EMPLOYEE });
      if (!empId) return '';
      const emp = record.load({ type: record.Type.EMPLOYEE, id: empId, isDynamic: false });
      const first = String(emp.getValue({ fieldId: 'firstname' }) || '').trim();
      if (first) return first;
      const full = String(emp.getValue({ fieldId: 'entityid' }) || emp.getValue({ fieldId: 'altname' }) || '').trim();
      return full.split(/\s+/)[0] || '';
    } catch (e) { return ''; }
  }

  function renderHome(response, firstName) {
    const homeUrl    = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'home'    }, returnExternalUrl: true });
    const createUrl  = url.resolveScript({ scriptId: PORTAL_SCRIPTID, deploymentId: PORTAL_DEPLOYID, params: {}, returnExternalUrl: true });
    const logoutUrl  = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'logout'  }, returnExternalUrl: true });
    const myposUrl   = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'mypos'   }, returnExternalUrl: true });
    const approveUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'approve' }, returnExternalUrl: true });

    const greeting = firstName ? `Bonjour ${escapeHtml(firstName)} 👋` : 'Bonjour 👋';

    response.write({ output:
      theme.pageHead('Accueil') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card">
      <div class="page-head">
        <div>
          <div class="page-title">${greeting}</div>
          <p class="page-sub">Bienvenue sur le portail achats — choisissez une action ci-dessous.<br/><span style="font-style:italic;color:var(--muted);">Welcome to the purchase portal — choose an action below.</span></p>
        </div>
        <div class="nav">
          <a class="active" href="${escapeHtml(homeUrl)}">Accueil</a>
          <a href="${escapeHtml(myposUrl)}">Mes demandes</a>
          <a href="${escapeHtml(createUrl)}">Créer</a>
          <a href="${escapeHtml(approveUrl)}">À approuver</a>
          <form class="nav-logout-form" method="POST" action="${escapeHtml(logoutUrl)}">
            <button type="submit" class="nav-logout">Déconnexion</button>
          </form>
        </div>
      </div>
      <div class="divider"></div>

      <div class="tiles">
        <a class="tile tile-active" href="${escapeHtml(createUrl)}">
          <div class="tile-icon" style="background:var(--amber-light);color:var(--amber-dark);">＋</div>
          <div class="tile-title">Créer une demande</div>
          <div class="tile-sub">Create request</div>
          <div class="tile-desc">Nouvelle demande d'achat<br/><span style="font-style:italic;color:var(--muted);">New purchase request</span></div>
        </a>

        <a class="tile tile-active" href="${escapeHtml(myposUrl)}">
          <div class="tile-icon" style="background:#eef2ff;color:#4338ca;">▤</div>
          <div class="tile-title">Mes demandes</div>
          <div class="tile-sub">My requests</div>
          <div class="tile-desc">Suivre mes demandes<br/><span style="font-style:italic;color:var(--muted);">Track my requests</span></div>
        </a>

        <a class="tile tile-active" href="${escapeHtml(approveUrl)}">
          <div class="tile-icon" style="background:var(--teal-light);color:var(--teal-dark);">✓</div>
          <div class="tile-title">À approuver</div>
          <div class="tile-sub">To approve</div>
          <div class="tile-desc">Demandes en attente d'approbation<br/><span style="font-style:italic;color:var(--muted);">Requests pending approval</span></div>
        </a>
      </div>
    </div>
  </div>

  <style>
    .tiles{
      display:grid; grid-template-columns:repeat(3, 1fr); gap:20px; margin-top:8px;
    }
    .tile{
      position:relative; background:#fff; border:1.5px solid var(--line);
      border-radius:var(--radius); padding:28px 24px; text-decoration:none;
      color:var(--text); display:flex; flex-direction:column; gap:8px;
      transition:transform .15s, box-shadow .15s, border-color .15s;
      min-height:180px;
    }
    .tile-active:hover{
      transform:translateY(-2px); border-color:var(--amber);
      box-shadow:0 8px 24px rgba(245,168,35,.18);
    }
    .tile-disabled{
      opacity:.65; cursor:not-allowed; background:#fafafa;
    }
    .tile-icon{
      width:48px; height:48px; border-radius:12px; display:flex;
      align-items:center; justify-content:center; font-size:24px; font-weight:800;
      margin-bottom:6px;
    }
    .tile-title{ font-size:17px; font-weight:800; color:var(--text); }
    .tile-sub{ font-size:12px; color:var(--muted); font-weight:600; font-style:italic; margin-top:-4px; }
    .tile-desc{ font-size:13px; color:#374151; line-height:1.5; margin-top:auto; }
    .tile-badge{
      position:absolute; top:14px; right:14px;
      background:#fff; border:1.5px solid var(--line); color:var(--muted);
      font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.08em;
      padding:3px 8px; border-radius:999px;
    }
    @media (max-width: 900px){ .tiles{ grid-template-columns:1fr; } }
  </style>
</body>
</html>`
    });
  }

  function handleHome(context) {
    const portalUserId = getCurrentPortalUser(context.request);
    if (!portalUserId) return redirectToRoute(context.response, { route: 'login' });
    const firstName = getEmployeeFirstName(portalUserId);
    return renderHome(context.response, firstName);
  }

  // ============================================================
  // APPROVAL WORKFLOW
  // ============================================================
  function getEmployeeIdForPortalUser(portalUserId) {
    try {
      const pu = record.load({ type: REC_PORTAL_USER, id: portalUserId, isDynamic: false });
      const isActive = pu.getValue({ fieldId: F_IS_ACTIVE }) === true
                    || pu.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
      if (!isActive) return null;
      const empId = pu.getValue({ fieldId: F_EMPLOYEE });
      return empId ? String(empId) : null;
    } catch (e) { return null; }
  }

  function isApprovedFlag(v) {
    return v === true || v === 'T' || v === 't' || v === 1 || v === '1';
  }

  // Build the "my pending approvals" filter block — matches POs where the given
  // employee is the approver at step N, all steps 1..N-1 are approved, and step
  // N is not yet approved. Uses one OR branch per step (1..6).
  function buildPendingApprovalsFilter(employeeId) {
    const branches = [];
    for (let n = 1; n <= 6; n++) {
      const branch = [
        ['custbody_cde_dda_app' + n, 'anyof', employeeId],
        'AND',
        ['custbody_cde_dda_approved' + n, 'is', 'F']
      ];
      for (let j = 1; j < n; j++) {
        branch.push('AND');
        branch.push(['custbody_cde_dda_approved' + j, 'is', 'T']);
      }
      branches.push(branch);
      if (n < 6) branches.push('OR');
    }
    return branches;
  }

  function getPendingApprovalsForEmployee(employeeId) {
    try {
      log.audit('getPendingApprovalsForEmployee', 'employeeId=' + employeeId);
      const filters = [
        ['mainline', 'is', 'T'],
        'AND',
        ['custbody_cde_dda_status', 'noneof', '2'],
        'AND',
        buildPendingApprovalsFilter(employeeId)
      ];
      log.audit('getPendingApprovalsForEmployee filters', JSON.stringify(filters));

      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: filters,
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'tranid', 'entity', 'memo', 'total', 'currency',
          search.createColumn({ name: 'symbol', join: 'currency' }),
          'custbody_cde_dda_app1', 'custbody_cde_dda_app2', 'custbody_cde_dda_app3',
          'custbody_cde_dda_app4', 'custbody_cde_dda_app5', 'custbody_cde_dda_app6',
          'custbody_cde_dda_approved1', 'custbody_cde_dda_approved2', 'custbody_cde_dda_approved3',
          'custbody_cde_dda_approved4', 'custbody_cde_dda_approved5', 'custbody_cde_dda_approved6'
        ]
      });

      const rows = s.run().getRange({ start: 0, end: 200 }) || [];
      log.audit('getPendingApprovalsForEmployee', 'rows found=' + rows.length);
      rows.forEach(r => {
        log.audit('row ' + r.id, JSON.stringify({
          tranid:     r.getValue({ name: 'tranid' }),
          app1:       r.getValue({ name: 'custbody_cde_dda_app1' }),
          approved1:  r.getValue({ name: 'custbody_cde_dda_approved1' }),
          app2:       r.getValue({ name: 'custbody_cde_dda_app2' }),
          approved2:  r.getValue({ name: 'custbody_cde_dda_approved2' })
        }));
      });
      return rows.map(r => {
        // Find current step for this employee: smallest N where approverN = me,
        // approvedN = F, and approved1..N-1 all = T.
        let step = 0;
        for (let n = 1; n <= 6; n++) {
          const approver = String(r.getValue({ name: 'custbody_cde_dda_app' + n }) || '');
          if (approver !== String(employeeId)) continue;
          if (isApprovedFlag(r.getValue({ name: 'custbody_cde_dda_approved' + n }))) continue;
          let allPrev = true;
          for (let j = 1; j < n; j++) {
            if (!isApprovedFlag(r.getValue({ name: 'custbody_cde_dda_approved' + j }))) {
              allPrev = false; break;
            }
          }
          if (allPrev) { step = n; break; }
        }
        let requesterText = '';
        try {
          const po = record.load({ type: record.Type.PURCHASE_ORDER, id: r.id, isDynamic: false });
          const empId = po.getValue({ fieldId: 'employee' });
          if (empId) {
            const emp = record.load({ type: record.Type.EMPLOYEE, id: empId, isDynamic: false });
            const first = String(emp.getValue({ fieldId: 'firstname' }) || '').trim();
            const last  = String(emp.getValue({ fieldId: 'lastname'  }) || '').trim();
            requesterText = (first + ' ' + last).trim() || String(emp.getValue({ fieldId: 'entityid' }) || '');
          }
        } catch (e) { /* leave blank */ }

        return {
          id:        String(r.id),
          tranid:    String(r.getValue({ name: 'tranid'   }) || ''),
          date:      String(r.getValue({ name: 'trandate' }) || ''),
          requester: requesterText,
          memo:      String(r.getValue({ name: 'memo'     }) || ''),
          total:     parseFloat(r.getValue({ name: 'total' }) || '0') || 0,
          currency:  String(r.getText ({ name: 'currency' }) || ''),
          symbol:    String(r.getValue({ name: 'symbol', join: 'currency' }) || ''),
          step:      step
        };
      }).filter(p => p.step > 0);
    } catch (e) {
      log.error('getPendingApprovalsForEmployee', e);
      return [];
    }
  }

  function renderApprovePage(response, rows, notice, errorMsg) {
    const homeUrl    = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'home'    }, returnExternalUrl: true });
    const createUrl  = url.resolveScript({ scriptId: PORTAL_SCRIPTID, deploymentId: PORTAL_DEPLOYID, params: {}, returnExternalUrl: true });
    const logoutUrl  = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'logout'  }, returnExternalUrl: true });
    const myposUrl   = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'mypos'   }, returnExternalUrl: true });
    const approveUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'approve' }, returnExternalUrl: true });

    const alertHtml = errorMsg
      ? `<div class="alert error" style="display:block;">${escapeHtml(errorMsg)}</div>`
      : (notice
        ? `<div class="alert success" style="display:block;">${escapeHtml(notice)}</div>`
        : '');

    const bodyHtml = rows.length === 0
      ? `<div class="card" style="text-align:center;padding:40px 20px;">
           <div style="font-size:48px;margin-bottom:12px;">✨</div>
           <div class="page-title" style="margin-bottom:6px;">Aucune demande à approuver</div>
           <div class="muted">No requests pending your approval.</div>
         </div>`
      : `<div class="tableWrap">
           <table>
             <thead>
               <tr>
                 <th style="width:11%;">N° PO<div class="th-en">PO number</div></th>
                 <th style="width:11%;">Date<div class="th-en">Date</div></th>
                 <th style="width:18%;">Demandeur<div class="th-en">Requester</div></th>
                 <th style="width:26%;">Commentaire<div class="th-en">Memo</div></th>
                 <th style="width:11%;" class="right">Montant<div class="th-en">Amount</div></th>
                 <th style="width:9%;">Étape<div class="th-en">Step</div></th>
                 <th style="width:14%;" class="right">Action<div class="th-en">Action</div></th>
               </tr>
             </thead>
             <tbody>
               ${rows.map(r => {
                 const amountStr = (r.total || 0).toFixed(2) + (r.symbol ? (' ' + r.symbol) : '');
                 const viewUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'approve', action: 'view', poid: r.id }, returnExternalUrl: true });
                 return `<tr>
                   <td style="font-weight:700;"><a href="${escapeHtml(viewUrl)}" style="color:var(--teal-dark);text-decoration:none;border-bottom:1px dotted var(--teal);">${escapeHtml(r.tranid || ('#' + r.id))}</a></td>
                   <td>${escapeHtml(r.date)}</td>
                   <td>${escapeHtml(r.requester)}</td>
                   <td style="max-width:320px;">${escapeHtml(r.memo)}</td>
                   <td class="right" style="font-weight:700;">${escapeHtml(amountStr)}</td>
                   <td><span class="pill" style="background:var(--teal-light);border-color:var(--teal);color:var(--teal-dark);">${r.step} / 6</span></td>
                   <td class="right" style="white-space:nowrap;">
                     <a href="${escapeHtml(viewUrl)}" class="btn" style="text-decoration:none;">Voir</a>
                     <form method="POST" action="${escapeHtml(approveUrl)}" style="display:inline;" onsubmit="return confirm('Approuver la demande ${escapeHtml(r.tranid || r.id)} ?');">
                       <input type="hidden" name="route" value="approve" />
                       <input type="hidden" name="poid"  value="${escapeHtml(r.id)}" />
                       <input type="hidden" name="step"  value="${r.step}" />
                       <button type="submit" class="btn primary">Approuver</button>
                     </form>
                   </td>
                 </tr>`;
               }).join('')}
             </tbody>
           </table>
         </div>`;

    response.write({ output:
      theme.pageHead('À approuver') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card">
      <div class="page-head">
        <div>
          <div class="page-title">À approuver</div>
          <p class="page-sub">Demandes en attente de votre approbation.<br/><span style="font-style:italic;color:var(--muted);">Requests pending your approval.</span></p>
        </div>
        <div class="nav">
          <a href="${escapeHtml(homeUrl)}">Accueil</a>
          <a href="${escapeHtml(myposUrl)}">Mes demandes</a>
          <a href="${escapeHtml(createUrl)}">Créer</a>
          <a class="active" href="${escapeHtml(approveUrl)}">À approuver</a>
          <form class="nav-logout-form" method="POST" action="${escapeHtml(logoutUrl)}">
            <button type="submit" class="nav-logout">Déconnexion</button>
          </form>
        </div>
      </div>
      <div class="divider"></div>

      ${alertHtml}
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`
    });
  }

  function approvePurchaseOrder(poId, step, employeeId) {
    const po = record.load({ type: record.Type.PURCHASE_ORDER, id: poId, isDynamic: false });

    const approverId = String(po.getValue({ fieldId: 'custbody_cde_dda_app' + step }) || '');
    if (approverId !== String(employeeId)) {
      throw new Error('Vous n\'êtes pas l\'approbateur pour cette étape.');
    }
    if (isApprovedFlag(po.getValue({ fieldId: 'custbody_cde_dda_approved' + step }))) {
      throw new Error('Cette étape est déjà approuvée.');
    }
    for (let j = 1; j < step; j++) {
      if (!isApprovedFlag(po.getValue({ fieldId: 'custbody_cde_dda_approved' + j }))) {
        throw new Error('Les étapes précédentes doivent être approuvées avant cette étape.');
      }
    }

    po.setValue({ fieldId: 'custbody_cde_dda_approved' + step, value: true });
    return po.save({ enableSourcing: false, ignoreMandatoryFields: true });
  }

  // Find the yearly accounting period whose date range contains `dateVal`.
  // Returns { id, name } (e.g., { id: "118", name: "FY 2026" }) or null.
  function getFiscalYearForDate(dateVal) {
    try {
      const dt = dateVal instanceof Date ? dateVal : format.parse({ value: String(dateVal || ''), type: format.Type.DATE });
      if (!dt || isNaN(dt.getTime())) return null;

      const s = search.create({
        type: search.Type.ACCOUNTING_PERIOD,
        filters: [['isyear', 'is', 'T']],
        columns: ['periodname', 'startdate', 'enddate']
      });
      const rows = s.run().getRange({ start: 0, end: 200 }) || [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const startRaw = r.getValue({ name: 'startdate' });
        const endRaw   = r.getValue({ name: 'enddate'   });
        let start = null, end = null;
        try { start = format.parse({ value: startRaw, type: format.Type.DATE }); } catch (e) { start = new Date(startRaw); }
        try { end   = format.parse({ value: endRaw,   type: format.Type.DATE }); } catch (e) { end   = new Date(endRaw); }
        if (start && end && dt >= start && dt <= end) {
          return {
            id:        String(r.id),
            name:      String(r.getValue({ name: 'periodname' }) || ''),
            startDate: start,
            endDate:   end
          };
        }
      }
      return null;
    } catch (e) { log.error('getFiscalYearForDate', e); return null; }
  }

  // Sum budget amounts (Custom106, status=E) per class, for a given fiscal year.
  // Returns { classId: amount }.
  function getBudgetTotalsByClass(fiscalYear) {
    if (!fiscalYear || !fiscalYear.name) { log.audit('getBudgetTotalsByClass', 'no fiscalYear, skipping'); return {}; }
    log.audit('getBudgetTotalsByClass', 'fy name=' + fiscalYear.name + ' id=' + fiscalYear.id);
    const out = {};
    try {
      const s = search.create({
        type: 'transaction',
        filters: [
          ['type', 'anyof', 'Custom106'],
          'AND',
          ['mainline', 'is', 'F'],
          'AND',
          ['status', 'anyof', 'Custom106:E']
        ],
        columns: ['class', 'amount', 'custbody_bm_financial_year']
      });
      const rows = s.run().getRange({ start: 0, end: 1000 }) || [];
      log.audit('getBudgetTotalsByClass', 'raw rows=' + rows.length);
      let matched = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rowFy = String(r.getValue({ name: 'custbody_bm_financial_year' }) || '');
        if (rowFy !== fiscalYear.name && rowFy !== fiscalYear.id) continue;
        matched++;
        const classId = String(r.getValue({ name: 'class' }) || '');
        const amt = parseFloat(r.getValue({ name: 'amount' }) || '0') || 0;
        if (!classId) continue;
        out[classId] = (out[classId] || 0) + amt;
      }
      log.audit('getBudgetTotalsByClass', 'matched=' + matched + ' classes=' + Object.keys(out).length);
    } catch (e) {
      log.error('getBudgetTotalsByClass', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  // Sum approved vendor-bill line amounts per class, within the fiscal year's
  // date range. Returns { classId: totalAmount }.
  function getActualExpensesByClass(fiscalYear) {
    if (!fiscalYear || !fiscalYear.startDate || !fiscalYear.endDate) {
      log.audit('getActualExpensesByClass', 'no fiscalYear dates, skipping');
      return {};
    }
    const out = {};
    try {
      const startStr = format.format({ value: fiscalYear.startDate, type: format.Type.DATE });
      const endStr   = format.format({ value: fiscalYear.endDate,   type: format.Type.DATE });
      log.audit('getActualExpensesByClass', 'range ' + startStr + ' → ' + endStr);

      const s = search.create({
        type: search.Type.VENDOR_BILL,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['approvalstatus', 'anyof', '2'],
          'AND',
          ['trandate', 'within', startStr, endStr]
        ],
        columns: ['class', 'amount']
      });
      const rows = s.run().getRange({ start: 0, end: 1000 }) || [];
      log.audit('getActualExpensesByClass', 'raw rows=' + rows.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const classId = String(r.getValue({ name: 'class' }) || '');
        const amt     = parseFloat(r.getValue({ name: 'amount' }) || '0') || 0;
        if (!classId) continue;
        out[classId] = (out[classId] || 0) + amt;
      }
      log.audit('getActualExpensesByClass', 'classes=' + Object.keys(out).length);
    } catch (e) {
      log.error('getActualExpensesByClass', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  // Sum approved-portal-PO line amounts per class, within the fiscal year's
  // date range. Filters: portal PO (custbody_cde_dem_appro = T) with custom
  // approval status = 2 (Approved). Returns { classId: totalAmount }.
  function getAuthorizedAmountsByClass(fiscalYear) {
    if (!fiscalYear || !fiscalYear.startDate || !fiscalYear.endDate) {
      log.audit('getAuthorizedAmountsByClass', 'no fiscalYear dates, skipping');
      return {};
    }
    const out = {};
    try {
      const startStr = format.format({ value: fiscalYear.startDate, type: format.Type.DATE });
      const endStr   = format.format({ value: fiscalYear.endDate,   type: format.Type.DATE });
      log.audit('getAuthorizedAmountsByClass', 'range ' + startStr + ' → ' + endStr);

      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['custbody_cde_dem_appro', 'is', 'T'],
          'AND',
          ['custbody_cde_dda_status', 'anyof', '2'],
          'AND',
          ['trandate', 'within', startStr, endStr]
        ],
        columns: ['class', 'amount']
      });
      const rows = s.run().getRange({ start: 0, end: 1000 }) || [];
      log.audit('getAuthorizedAmountsByClass', 'raw rows=' + rows.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const classId = String(r.getValue({ name: 'class' }) || '');
        const amt     = parseFloat(r.getValue({ name: 'amount' }) || '0') || 0;
        if (!classId) continue;
        out[classId] = (out[classId] || 0) + amt;
      }
      log.audit('getAuthorizedAmountsByClass', 'classes=' + Object.keys(out).length);
    } catch (e) {
      log.error('getAuthorizedAmountsByClass', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  // Sum line amounts per class for engaged (non-portal, non-pending, non-closed)
  // POs within the fiscal year's date range. Filters: custbody_cde_dem_appro = F
  // and status not in [Pending Approval (PurchOrd:A), Closed (PurchOrd:I)].
  function getEngagedAmountsByClass(fiscalYear) {
    if (!fiscalYear || !fiscalYear.startDate || !fiscalYear.endDate) {
      log.audit('getEngagedAmountsByClass', 'no fiscalYear dates, skipping');
      return {};
    }
    const out = {};
    try {
      const startStr = format.format({ value: fiscalYear.startDate, type: format.Type.DATE });
      const endStr   = format.format({ value: fiscalYear.endDate,   type: format.Type.DATE });
      log.audit('getEngagedAmountsByClass', 'range ' + startStr + ' → ' + endStr);

      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'F'],
          'AND',
          ['custbody_cde_dem_appro', 'is', 'F'],
          'AND',
          ['status', 'noneof', ['PurchOrd:A', 'PurchOrd:I']],
          'AND',
          ['trandate', 'within', startStr, endStr]
        ],
        columns: ['class', 'amount']
      });
      const rows = s.run().getRange({ start: 0, end: 1000 }) || [];
      log.audit('getEngagedAmountsByClass', 'raw rows=' + rows.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const classId = String(r.getValue({ name: 'class' }) || '');
        const amt     = parseFloat(r.getValue({ name: 'amount' }) || '0') || 0;
        if (!classId) continue;
        out[classId] = (out[classId] || 0) + amt;
      }
      log.audit('getEngagedAmountsByClass', 'classes=' + Object.keys(out).length);
    } catch (e) {
      log.error('getEngagedAmountsByClass', (e && e.message) ? e.message : String(e));
    }
    return out;
  }

  function loadPurchaseOrderForView(poId) {
    const po = record.load({ type: record.Type.PURCHASE_ORDER, id: poId, isDynamic: false });

    const tv = (fieldId) => {
      try { return String(po.getText({ fieldId: fieldId }) || po.getValue({ fieldId: fieldId }) || ''); }
      catch (e) { return String(po.getValue({ fieldId: fieldId }) || ''); }
    };

    // Header
    const header = {
      id:        String(poId),
      tranid:    String(po.getValue({ fieldId: 'tranid'   }) || ''),
      date:      String(po.getValue({ fieldId: 'trandate' }) || ''),
      vendor:    tv('entity'),
      currency:  tv('currency'),
      total:     parseFloat(po.getValue({ fieldId: 'total' }) || '0') || 0,
      memo:      String(po.getValue({ fieldId: 'memo' }) || ''),
      employee:  tv('employee'),
      employeeId: String(po.getValue({ fieldId: 'employee' }) || '')
    };

    // Approval steps
    const steps = [];
    for (let n = 1; n <= 6; n++) {
      const approverId = String(po.getValue({ fieldId: 'custbody_cde_dda_app' + n }) || '');
      const approverText = tv('custbody_cde_dda_app' + n);
      const approved = isApprovedFlag(po.getValue({ fieldId: 'custbody_cde_dda_approved' + n }));
      steps.push({ step: n, approverId, approverText, approved, hasApprover: !!approverId });
    }

    // Budget & actual lookup: find the fiscal year matching the PO date, then
    // get { classId: total } for budgets (Custom106) and actual expenses
    // (approved vendor bills) in that fiscal year's date range.
    // Any failure here must not break the detail view.
    const rawDate = po.getValue({ fieldId: 'trandate' });
    let fiscalYear = null;
    let budgetsByClass    = {};
    let actualsByClass    = {};
    let authorizedByClass = {};
    let engagedByClass    = {};
    try { fiscalYear = getFiscalYearForDate(rawDate); } catch (e) { log.error('budget fiscalYear', e); }
    try { budgetsByClass    = getBudgetTotalsByClass(fiscalYear)      || {}; } catch (e) { log.error('budget totals', e); }
    try { actualsByClass    = getActualExpensesByClass(fiscalYear)    || {}; } catch (e) { log.error('actual totals', e); }
    try { authorizedByClass = getAuthorizedAmountsByClass(fiscalYear) || {}; } catch (e) { log.error('authorized totals', e); }
    try { engagedByClass    = getEngagedAmountsByClass(fiscalYear)    || {}; } catch (e) { log.error('engaged totals', e); }
    const fiscalYearId = fiscalYear ? fiscalYear.id : null;

    // Line items
    const lines = [];
    const lineCount = po.getLineCount({ sublistId: 'item' });
    for (let i = 0; i < lineCount; i++) {
      const classId = String(po.getSublistValue({ sublistId: 'item', fieldId: 'class', line: i }) || '');
      const ln = {
        item:       String(po.getSublistValue({ sublistId: 'item', fieldId: 'description', line: i }) || po.getSublistText({ sublistId: 'item', fieldId: 'item', line: i }) || ''),
        department: String(po.getSublistText ({ sublistId: 'item', fieldId: 'department', line: i }) || ''),
        classname:  String(po.getSublistText ({ sublistId: 'item', fieldId: 'class',      line: i }) || ''),
        classId:    classId,
        qty:        parseFloat(po.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i }) || '0') || 0,
        rate:       parseFloat(po.getSublistValue({ sublistId: 'item', fieldId: 'rate',     line: i }) || '0') || 0,
        amount:     parseFloat(po.getSublistValue({ sublistId: 'item', fieldId: 'amount',   line: i }) || '0') || 0,
        budget:     classId && Object.prototype.hasOwnProperty.call(budgetsByClass,    classId) ? budgetsByClass[classId]    : null,
        actual:     classId && Object.prototype.hasOwnProperty.call(actualsByClass,    classId) ? actualsByClass[classId]    : null,
        authorized: classId && Object.prototype.hasOwnProperty.call(authorizedByClass, classId) ? authorizedByClass[classId] : null,
        engaged:    classId && Object.prototype.hasOwnProperty.call(engagedByClass,    classId) ? engagedByClass[classId]    : null,
        leadTime:   String(po.getSublistValue({ sublistId: 'item', fieldId: 'custcol_cde_lead_time',         line: i }) || ''),
        comment:    String(po.getSublistValue({ sublistId: 'item', fieldId: 'custcol_cde_logistic_comment',  line: i }) || '')
      };
      lines.push(ln);
    }

    return { header, steps, lines, fiscalYearId };
  }

  function renderPoDetail(response, poId, employeeId, notice, errorMsg, ctx) {
    ctx = ctx || 'approve';
    const homeUrl    = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'home'    }, returnExternalUrl: true });
    const createUrl  = url.resolveScript({ scriptId: PORTAL_SCRIPTID, deploymentId: PORTAL_DEPLOYID, params: {}, returnExternalUrl: true });
    const logoutUrl  = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'logout'  }, returnExternalUrl: true });
    const myposUrl   = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'mypos'   }, returnExternalUrl: true });
    const approveUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'approve' }, returnExternalUrl: true });
    const backUrl    = ctx === 'mypos' ? myposUrl : approveUrl;

    let data;
    try {
      data = loadPurchaseOrderForView(poId);
    } catch (e) {
      log.error('renderPoDetail load', e);
      if (ctx === 'mypos') {
        const rows = getMyPurchaseOrders(employeeId);
        return renderMyPosList(response, rows, null, 'Impossible de charger la demande : ' + (e.message || e));
      }
      const rows = getPendingApprovalsForEmployee(employeeId);
      return renderApprovePage(response, rows, null, 'Impossible de charger la demande : ' + (e.message || e));
    }

    // Determine which step the current user can approve (if any)
    let userStep = 0;
    for (let n = 1; n <= 6; n++) {
      const s = data.steps[n - 1];
      if (s.approverId === String(employeeId) && !s.approved) {
        let prevOk = true;
        for (let j = 0; j < n - 1; j++) { if (!data.steps[j].approved) { prevOk = false; break; } }
        if (prevOk) { userStep = n; break; }
      }
    }

    const alertHtml = errorMsg
      ? `<div class="alert error" style="display:block;">${escapeHtml(errorMsg)}</div>`
      : (notice
        ? `<div class="alert success" style="display:block;">${escapeHtml(notice)}</div>`
        : '');

    const stepsHtml = data.steps.map(s => {
      const pillColor = s.approved
        ? 'background:var(--success-bg);border-color:var(--success-border);color:var(--success);'
        : (s.hasApprover
          ? 'background:#fef3c7;border-color:#fcd34d;color:#92400e;'
          : 'background:#f3f4f6;border-color:#e5e7eb;color:var(--muted);');
      const statusText = s.approved ? '✓ Approuvé' : (s.hasApprover ? '⋯ En attente' : '— Non requis');
      return `<tr>
        <td style="width:8%;font-weight:800;">#${s.step}</td>
        <td>${escapeHtml(s.approverText || '—')}</td>
        <td class="right"><span class="pill" style="${pillColor}">${statusText}</span></td>
      </tr>`;
    }).join('');

    const linesHtml = data.lines.map(ln => {
      const budgetCell = (ln.budget === null || typeof ln.budget === 'undefined')
        ? '<span class="muted">—</span>'
        : ln.budget.toFixed(2);
      const actualCell = (ln.actual === null || typeof ln.actual === 'undefined')
        ? '<span class="muted">—</span>'
        : ln.actual.toFixed(2);
      const authorizedCell = (ln.authorized === null || typeof ln.authorized === 'undefined')
        ? '<span class="muted">—</span>'
        : ln.authorized.toFixed(2);
      const engagedCell = (ln.engaged === null || typeof ln.engaged === 'undefined')
        ? '<span class="muted">—</span>'
        : ln.engaged.toFixed(2);

      const totalExpense = (ln.actual || 0) + (ln.engaged || 0) + (ln.authorized || 0);
      const hasAnySpend = ln.actual !== null || ln.engaged !== null || ln.authorized !== null;
      const totalExpenseCell = hasAnySpend
        ? totalExpense.toFixed(2)
        : '<span class="muted">—</span>';

      let availableCell, availableStyle;
      if (ln.budget === null || typeof ln.budget === 'undefined') {
        availableCell  = '<span class="muted">—</span>';
        availableStyle = 'background:#f9fafb;';
      } else {
        const available = ln.budget - totalExpense;
        availableCell = available.toFixed(2);
        availableStyle = available < 0
          ? 'background:var(--danger-bg);color:var(--danger);font-weight:800;'
          : 'background:var(--success-bg);color:var(--success);font-weight:800;';
      }

      return `
      <tr>
        <td>${escapeHtml(ln.department)}</td>
        <td>${escapeHtml(ln.item)}</td>
        <td class="right">${ln.qty}</td>
        <td>${escapeHtml(ln.classname)}</td>
        <td class="right">${ln.rate.toFixed(2)}</td>
        <td class="right" style="font-weight:700;">${ln.amount.toFixed(2)}</td>
        <td class="right" style="background:#eef2ff;color:#1f2a5a;font-weight:700;">${budgetCell}</td>
        <td class="right" style="background:#fef3c7;color:#78350f;font-weight:700;">${actualCell}</td>
        <td class="right" style="background:#dcfce7;color:#14532d;font-weight:700;">${authorizedCell}</td>
        <td class="right" style="background:#f3e8ff;color:#6b21a8;font-weight:700;">${engagedCell}</td>
        <td class="right" style="background:#fee2e2;color:#7f1d1d;font-weight:700;">${totalExpenseCell}</td>
        <td class="right" style="${availableStyle}">${availableCell}</td>
        <td class="right">${ln.leadTime ? escapeHtml(ln.leadTime) : '<span class="muted">—</span>'}</td>
        <td>${ln.comment ? escapeHtml(ln.comment) : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');

    const actionHtml = (ctx === 'approve' && userStep > 0)
      ? `<form method="POST" action="${escapeHtml(approveUrl)}" onsubmit="return confirm('Approuver la demande ${escapeHtml(data.header.tranid || data.header.id)} à l\\'étape ${userStep} ?');" style="display:inline;">
           <input type="hidden" name="route" value="approve" />
           <input type="hidden" name="poid"  value="${escapeHtml(data.header.id)}" />
           <input type="hidden" name="step"  value="${userStep}" />
           <button type="submit" class="btn primary">Approuver l'étape ${userStep}</button>
         </form>`
      : (ctx === 'mypos'
        ? `<span class="pill" style="background:#f3f4f6;color:var(--muted);">Vue en lecture seule</span>`
        : `<span class="pill" style="background:#f3f4f6;color:var(--muted);">Aucune action requise de votre part</span>`);

    response.write({ output:
      theme.pageHead('Demande ' + (data.header.tranid || ('#' + data.header.id))) + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card">
      <div class="page-head">
        <div>
          <div class="page-title">Demande ${escapeHtml(data.header.tranid || ('#' + data.header.id))}</div>
          <p class="page-sub">Détail de la demande d'achat.<br/><span style="font-style:italic;color:var(--muted);">Purchase request detail.</span></p>
        </div>
        <div class="nav">
          <a href="${escapeHtml(homeUrl)}">Accueil</a>
          <a class="${ctx === 'mypos' ? 'active' : ''}" href="${escapeHtml(myposUrl)}">Mes demandes</a>
          <a href="${escapeHtml(createUrl)}">Créer</a>
          <a class="${ctx === 'approve' ? 'active' : ''}" href="${escapeHtml(approveUrl)}">À approuver</a>
          <form class="nav-logout-form" method="POST" action="${escapeHtml(logoutUrl)}">
            <button type="submit" class="nav-logout">Déconnexion</button>
          </form>
        </div>
      </div>
      <div class="divider"></div>

      ${alertHtml}

      <div style="display:flex;gap:16px;margin-bottom:8px;flex-wrap:wrap;">
        <a href="${escapeHtml(backUrl)}" class="btn" style="text-decoration:none;">← Retour à la liste</a>
      </div>

      <div class="grid" style="grid-template-columns: repeat(2, 1fr); gap:14px;">
        <div class="field">
          <div class="label">N° PO <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">PO number</span></div>
          <div class="pill" style="font-weight:800;">${escapeHtml(data.header.tranid || ('#' + data.header.id))}</div>
        </div>
        <div class="field">
          <div class="label">Date</div>
          <div class="pill">${escapeHtml(data.header.date)}</div>
        </div>
        <div class="field">
          <div class="label">Demandeur <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Requester</span></div>
          <div class="pill">${escapeHtml(data.header.employee || '—')}</div>
        </div>
        <div class="field">
          <div class="label">Fournisseur <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Vendor</span></div>
          <div class="pill">${escapeHtml(data.header.vendor || '—')}</div>
        </div>
        <div class="field">
          <div class="label">Devise <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Currency</span></div>
          <div class="pill">${escapeHtml(data.header.currency || '—')}</div>
        </div>
        <div class="field">
          <div class="label">Total</div>
          <div class="pill" style="font-weight:800;color:var(--teal-dark);">${data.header.total.toFixed(2)}</div>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <div class="label">Commentaire <span style="font-style:italic;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:normal;">Memo</span></div>
          <div class="pill" style="white-space:pre-wrap;">${escapeHtml(data.header.memo || '—')}</div>
        </div>
      </div>

      <div class="spacer"></div>
      <div class="row">
        <div><span class="pill">Workflow d'approbation</span> <span class="muted" style="margin-left:8px;font-style:italic;">Approval workflow</span></div>
      </div>
      <div class="spacer"></div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th style="width:8%;">Étape<div class="th-en">Step</div></th>
              <th>Approbateur<div class="th-en">Approver</div></th>
              <th style="width:20%;" class="right">Statut<div class="th-en">Status</div></th>
            </tr>
          </thead>
          <tbody>${stepsHtml}</tbody>
        </table>
      </div>

      <div class="spacer"></div>
      <div class="row">
        <div><span class="pill">Lignes</span> <span class="muted" style="margin-left:8px;font-style:italic;">Items</span></div>
      </div>
      <div class="spacer"></div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th style="width:6%;">Département<div class="th-en">Department</div></th>
              <th style="width:10%;">Description<div class="th-en">Description</div></th>
              <th style="width:4%;" class="right">Qté<div class="th-en">Qty</div></th>
              <th style="width:9%;">Classe<div class="th-en">Class</div></th>
              <th style="width:7%;" class="right">Prix<div class="th-en">Rate</div></th>
              <th style="width:8%;" class="right">Total<div class="th-en">Total</div></th>
              <th style="width:9%;" class="right">Budget<div class="th-en">Budget</div></th>
              <th style="width:9%;" class="right">Dépensé<div class="th-en">Actual</div></th>
              <th style="width:9%;" class="right">Autorisé<div class="th-en">Authorized</div></th>
              <th style="width:9%;" class="right">Engagé<div class="th-en">Engaged</div></th>
              <th style="width:9%;" class="right">Total dépense<div class="th-en">Total expense</div></th>
              <th style="width:9%;" class="right">Disponible<div class="th-en">Available</div></th>
              <th style="width:5%;" class="right">Délai<div class="th-en">Lead time</div></th>
              <th style="width:11%;">Commentaire<div class="th-en">Comment</div></th>
            </tr>
          </thead>
          <tbody>${linesHtml || '<tr><td colspan="14" class="muted" style="text-align:center;">Aucune ligne</td></tr>'}</tbody>
        </table>
      </div>

      <div class="spacer"></div>
      <div class="divider"></div>
      <div class="row">
        <a href="${escapeHtml(backUrl)}" class="btn" style="text-decoration:none;">← Retour à la liste</a>
        <div>${actionHtml}</div>
      </div>
    </div>
  </div>
</body>
</html>`
    });
  }

  // ============================================================
  // MY REQUESTS (Mes demandes)
  // ============================================================
  function getMyPurchaseOrders(employeeId) {
    try {
      const s = search.create({
        type: search.Type.PURCHASE_ORDER,
        filters: [
          ['mainline', 'is', 'T'],
          'AND',
          ['custbody_cde_dem_appro', 'is', 'T'],
          'AND',
          ['employee', 'anyof', employeeId]
        ],
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'tranid', 'memo', 'total', 'currency',
          search.createColumn({ name: 'symbol', join: 'currency' }),
          'custbody_cde_dda_status',
          'custbody_cde_dda_approved1', 'custbody_cde_dda_approved2', 'custbody_cde_dda_approved3',
          'custbody_cde_dda_approved4', 'custbody_cde_dda_approved5', 'custbody_cde_dda_approved6'
        ]
      });
      const rows = s.run().getRange({ start: 0, end: 200 }) || [];
      return rows.map(r => {
        let approvedCount = 0;
        for (let n = 1; n <= 6; n++) {
          if (isApprovedFlag(r.getValue({ name: 'custbody_cde_dda_approved' + n }))) approvedCount++;
        }
        const ddaStatus = String(r.getText({ name: 'custbody_cde_dda_status' }) || r.getValue({ name: 'custbody_cde_dda_status' }) || '');
        return {
          id:        String(r.id),
          tranid:    String(r.getValue({ name: 'tranid'   }) || ''),
          date:      String(r.getValue({ name: 'trandate' }) || ''),
          memo:      String(r.getValue({ name: 'memo'     }) || ''),
          total:     parseFloat(r.getValue({ name: 'total' }) || '0') || 0,
          symbol:    String(r.getValue({ name: 'symbol', join: 'currency' }) || ''),
          ddaStatus: ddaStatus,
          approvedCount: approvedCount
        };
      });
    } catch (e) { log.error('getMyPurchaseOrders', e); return []; }
  }

  function renderMyPosList(response, rows, notice, errorMsg) {
    const homeUrl    = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'home'    }, returnExternalUrl: true });
    const createUrl  = url.resolveScript({ scriptId: PORTAL_SCRIPTID, deploymentId: PORTAL_DEPLOYID, params: {}, returnExternalUrl: true });
    const logoutUrl  = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'logout'  }, returnExternalUrl: true });
    const myposUrl   = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'mypos'   }, returnExternalUrl: true });
    const approveUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'approve' }, returnExternalUrl: true });

    const alertHtml = errorMsg
      ? `<div class="alert error" style="display:block;">${escapeHtml(errorMsg)}</div>`
      : (notice
        ? `<div class="alert success" style="display:block;">${escapeHtml(notice)}</div>`
        : '');

    const bodyHtml = rows.length === 0
      ? `<div class="card" style="text-align:center;padding:40px 20px;">
           <div style="font-size:48px;margin-bottom:12px;">📭</div>
           <div class="page-title" style="margin-bottom:6px;">Aucune demande</div>
           <div class="muted">You haven't submitted any purchase requests yet.</div>
         </div>`
      : `<div class="tableWrap">
           <table>
             <thead>
               <tr>
                 <th style="width:13%;">N° PO<div class="th-en">PO number</div></th>
                 <th style="width:11%;">Date<div class="th-en">Date</div></th>
                 <th style="width:30%;">Commentaire<div class="th-en">Memo</div></th>
                 <th style="width:13%;" class="right">Montant<div class="th-en">Amount</div></th>
                 <th style="width:11%;">Étape<div class="th-en">Step</div></th>
                 <th style="width:13%;">Statut<div class="th-en">Status</div></th>
                 <th style="width:9%;" class="right">Action<div class="th-en">Action</div></th>
               </tr>
             </thead>
             <tbody>
               ${rows.map(r => {
                 const amountStr = (r.total || 0).toFixed(2) + (r.symbol ? (' ' + r.symbol) : '');
                 const viewUrl = url.resolveScript({ scriptId: runtime.getCurrentScript().id, deploymentId: runtime.getCurrentScript().deploymentId, params: { route: 'mypos', action: 'view', poid: r.id }, returnExternalUrl: true });
                 const isApproved = String(r.ddaStatus).toLowerCase().indexOf('approv') === 0 || String(r.ddaStatus) === '2';
                 const statusPill = isApproved
                   ? '<span class="pill" style="background:var(--success-bg);border-color:var(--success-border);color:var(--success);">✓ Approuvée</span>'
                   : '<span class="pill" style="background:#fef3c7;border-color:#fcd34d;color:#92400e;">⋯ En cours</span>';
                 return `<tr>
                   <td style="font-weight:700;"><a href="${escapeHtml(viewUrl)}" style="color:var(--teal-dark);text-decoration:none;border-bottom:1px dotted var(--teal);">${escapeHtml(r.tranid || ('#' + r.id))}</a></td>
                   <td>${escapeHtml(r.date)}</td>
                   <td style="max-width:340px;">${escapeHtml(r.memo)}</td>
                   <td class="right" style="font-weight:700;">${escapeHtml(amountStr)}</td>
                   <td><span class="pill" style="background:var(--teal-light);border-color:var(--teal);color:var(--teal-dark);">${r.approvedCount} / 6</span></td>
                   <td>${statusPill}</td>
                   <td class="right"><a href="${escapeHtml(viewUrl)}" class="btn" style="text-decoration:none;">Voir</a></td>
                 </tr>`;
               }).join('')}
             </tbody>
           </table>
         </div>`;

    response.write({ output:
      theme.pageHead('Mes demandes') + `
<body>
  ${theme.brandHeader('Portail Achats')}
  <div class="wrap">
    <div class="card">
      <div class="page-head">
        <div>
          <div class="page-title">Mes demandes</div>
          <p class="page-sub">Toutes les demandes d'achat que vous avez soumises.<br/><span style="font-style:italic;color:var(--muted);">All purchase requests you have submitted.</span></p>
        </div>
        <div class="nav">
          <a href="${escapeHtml(homeUrl)}">Accueil</a>
          <a class="active" href="${escapeHtml(myposUrl)}">Mes demandes</a>
          <a href="${escapeHtml(createUrl)}">Créer</a>
          <a href="${escapeHtml(approveUrl)}">À approuver</a>
          <form class="nav-logout-form" method="POST" action="${escapeHtml(logoutUrl)}">
            <button type="submit" class="nav-logout">Déconnexion</button>
          </form>
        </div>
      </div>
      <div class="divider"></div>

      ${alertHtml}
      ${bodyHtml}
    </div>
  </div>
</body>
</html>`
    });
  }

  function handleMyPos(context) {
    const req = context.request;
    const res = context.response;
    const portalUserId = getCurrentPortalUser(req);
    if (!portalUserId) return redirectToRoute(res, { route: 'login' });
    const employeeId = getEmployeeIdForPortalUser(portalUserId);
    if (!employeeId) return redirectToRoute(res, { route: 'login' });

    const action = String(req.parameters.action || '').toLowerCase();

    if (req.method === 'GET' && action === 'view') {
      const poId = String(req.parameters.poid || '').trim();
      if (!poId) return redirectToRoute(res, { route: 'mypos' });
      return renderPoDetail(res, poId, employeeId, null, null, 'mypos');
    }

    const rows = getMyPurchaseOrders(employeeId);
    return renderMyPosList(res, rows, null, null);
  }

  function handleApprove(context) {
    const req = context.request;
    const res = context.response;
    const portalUserId = getCurrentPortalUser(req);
    if (!portalUserId) return redirectToRoute(res, { route: 'login' });
    const employeeId = getEmployeeIdForPortalUser(portalUserId);
    if (!employeeId) return redirectToRoute(res, { route: 'login' });

    const action = String(req.parameters.action || '').toLowerCase();

    if (req.method === 'GET' && action === 'view') {
      const poId = String(req.parameters.poid || '').trim();
      if (!poId) return redirectToRoute(res, { route: 'approve' });
      return renderPoDetail(res, poId, employeeId, null, null, 'approve');
    }

    if (req.method === 'POST') {
      const poId = String(req.parameters.poid || req.parameters.poId || '').trim();
      const step = parseInt(String(req.parameters.step || '0'), 10);
      if (!poId || !(step >= 1 && step <= 6)) {
        const rows = getPendingApprovalsForEmployee(employeeId);
        return renderApprovePage(res, rows, null, 'Paramètres invalides.');
      }
      try {
        approvePurchaseOrder(poId, step, employeeId);
        const rows = getPendingApprovalsForEmployee(employeeId);
        return renderApprovePage(res, rows, 'Demande approuvée avec succès.', null);
      } catch (e) {
        log.error('handleApprove POST', e);
        const rows = getPendingApprovalsForEmployee(employeeId);
        return renderApprovePage(res, rows, null, (e && e.message) ? e.message : String(e));
      }
    }

    const rows = getPendingApprovalsForEmployee(employeeId);
    return renderApprovePage(res, rows, null, null);
  }

  // ============================================================
  // ENTRYPOINT
  // ============================================================
  function onRequest(context) {
    const route = (context.request.parameters.route || 'login').toLowerCase();
    try {
      if (route === 'login')   return handleLogin(context);
      if (route === 'setpw')   return handleSetPw(context);
      if (route === 'logout')  return handleLogout(context);
      if (route === 'home')    return handleHome(context);
      if (route === 'approve') return handleApprove(context);
      if (route === 'mypos')   return handleMyPos(context);
      // Unknown route: send to dashboard if logged in, otherwise to login.
      if (getCurrentPortalUser(context.request)) return handleHome(context);
      return handleLogin(context);
    } catch (e) {
      log.error('SL_PR_PORTAL_AUTH fatal', e);
      const msg = (e && e.message) ? e.message : String(e);
      const form = ui.createForm({ title: 'Erreur' });
      form.addField({ id: 'custpage_err', type: ui.FieldType.INLINEHTML, label: ' ' }).defaultValue =
        `<div style="padding:10px;border:1px solid #e0b4b4;background:#fff6f6;color:#9f3a38;border-radius:4px;">
           Erreur: ${escapeHtml(msg)}
         </div>
         <div style="margin-top:12px;">
           <a href="?route=login" style="text-decoration:none;">Retour connexion</a>
         </div>`;
      context.response.writePage(form);
    }
  }

  return { onRequest };
});
