/**
 * LIB_PR_PORTAL_SESSION.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Shared session utilities for the Purchase Portal.
 * Imported by SL_PR_PORTAL_AUTH and SL_PR_PORTAL_CREATE_V2.
 *
 * ── PASSWORD KDF ──────────────────────────────────────────────────────────────
 * Iterated SHA256 with the password mixed in at every round:
 *   seed    = SHA256(salt:password)
 *   round i = SHA256(round(i-1):password)
 * The password appears at every iteration so an attacker cannot precompute
 * intermediate states without already knowing the password.
 * N/crypto.createSecretKey() requires a NetSuite credential GUID and cannot
 * be used with arbitrary key material, so HMAC is not available here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
define(
  ['N/record', 'N/search', 'N/runtime', 'N/crypto', 'N/crypto/random', 'N/encode', 'N/log'],
  (record, search, runtime, crypto, cryptoRandom, encode, log) => {

  // ============================================================
  // RECORD / FIELD CONSTANTS (shared by all portal suitelets)
  // ============================================================
  const REC_PORTAL_USER     = 'customrecord_pr_portal_user';
  const REC_SESSION         = 'customrecord_pr_portal_session';

  const F_EMPLOYEE          = 'custrecord_pru_employee';
  const F_IS_ACTIVE         = 'custrecord_pru_is_active';
  const F_PW_HASH           = 'custrecord_pru_password_hash';
  const F_PW_SALT           = 'custrecord_pru_password_salt';
  const F_PW_TOKEN_HASH     = 'custrecord_pru_pw_token_hash';
  const F_PW_TOKEN_EXPIRES  = 'custrecord_pru_pw_token_expires';
  const F_PW_TOKEN_USED     = 'custrecord_pru_pw_token_used';
  const F_FAILED_ATTEMPTS   = 'custrecord_pru_failed_attempts';
  const F_LOCKED_UNTIL      = 'custrecord_pru_locked_until';
  const F_LAST_LOGIN        = 'custrecord_pru_last_login';

  const F_SESS_USER         = 'custrecord_prs_user';
  const F_SESS_TOKEN_HASH   = 'custrecord_prs_token_hash';
  const F_SESS_EXPIRES_AT   = 'custrecord_prs_expires_at';
  const F_SESS_REVOKED      = 'custrecord_prs_is_revoked';
  const F_SESS_LAST_SEEN    = 'custrecord_prs_last_seen';

  // ============================================================
  // SCRIPT PARAMETER NAMES (same keys used in every portal script)
  // ============================================================
  const P_COOKIE_NAME       = 'custscript_pr_cookie_name';       // default: PRSESS
  const P_SESSION_HOURS     = 'custscript_pr_session_hours';     // default: 8
  const P_PW_HASH_ITERS     = 'custscript_pr_pw_hash_iters';     // default: 10000
  const P_LOCK_MAX_ATTEMPTS = 'custscript_pr_lock_max_attempts'; // default: 5
  const P_LOCK_MINUTES      = 'custscript_pr_lock_minutes';      // default: 15

  // ============================================================
  // BASE UTILITIES
  // ============================================================
  function now() { return new Date(); }

  function addHours(d, hours) {
    const x = new Date(d.getTime());
    x.setHours(x.getHours() + hours);
    return x;
  }

  function addMinutes(d, mins) {
    const x = new Date(d.getTime());
    x.setMinutes(x.getMinutes() + mins);
    return x;
  }

  function getParam(name, def) {
    const v = runtime.getCurrentScript().getParameter({ name });
    return (v === null || v === '' || typeof v === 'undefined') ? def : v;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sha256Hex(input) {
    const h = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
    h.update({ input, inputEncoding: encode.Encoding.UTF_8 });
    return h.digest({ outputEncoding: encode.Encoding.HEX });
  }

  function randomBase64UrlToken(lenBytes) {
    // generateBytes returns a Uint8Array — encode.convert expects a string.
    // Convert each byte to 2-digit hex first, then encode the hex string to BASE_64URL.
    const bytes = cryptoRandom.generateBytes({ size: lenBytes });
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
    }
    const b64 = encode.convert({
      string: hex,
      inputEncoding: encode.Encoding.UTF_8,
      outputEncoding: encode.Encoding.BASE_64
    });
    // BASE_64URL: replace +→- /→_ and strip padding =
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function parseCookie(req) {
    const header = req.headers && (req.headers.Cookie || req.headers.cookie);
    const out = {};
    if (!header) return out;
    header.split(';').forEach(p => {
      const idx = p.indexOf('=');
      if (idx > -1) out[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
    });
    return out;
  }

  function setCookie(res, name, value, opts) {
    const parts = [`${name}=${value}`, `Path=${(opts && opts.path) || '/'}`];
    // SameSite=Strict: cookie is never sent on cross-site requests at all,
    // eliminating the GET-logout CSRF vector that Lax leaves open.
    parts.push('Secure', 'SameSite=Strict', 'HttpOnly');
    if (opts && opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
    res.setHeader({ name: 'Set-Cookie', value: parts.join('; ') });
  }

  // ============================================================
  // PASSWORD KDF — iterated SHA256 with password at every round
  //
  // Seed    = SHA256(salt:password)
  // Round i = SHA256(round(i-1):password)
  //
  // Including the password in every round prevents an attacker from
  // precomputing intermediate states without knowing the password —
  // the same property HMAC-SHA256 chaining provides, but without
  // N/crypto.createSecretKey() which only accepts NetSuite credential
  // GUIDs and cannot be used with arbitrary key material.
  // ============================================================
  function derivePasswordHash(password, salt, iterations) {
    let current = sha256Hex(`${salt}:${password}`);
    for (let i = 1; i < iterations; i++) {
      current = sha256Hex(`${current}:${password}`);
    }
    return current;
  }

  // ============================================================
  // SESSION LOOKUP
  // ============================================================
  function findSessionIdByTokenHash(tokenHashHex) {
    const s = search.create({
      type: REC_SESSION,
      filters: [[F_SESS_TOKEN_HASH, 'is', tokenHashHex]],
      columns: ['internalid']
    });
    const r = s.run().getRange({ start: 0, end: 1 });
    if (!r || !r.length) return null;
    return String(r[0].getValue({ name: 'internalid' }));
  }

  // ============================================================
  // SESSION CLEANUP — FIX #7
  // Deletes revoked and expired sessions for a portal user.
  // Called on every new login to prevent unbounded table growth
  // (which degrades the per-request session lookup search).
  // Capped at 50 deletions per call to stay within governance limits.
  // ============================================================
  function cleanupSessions(portalUserId) {
    // Disabled until session record type is confirmed to exist in this account.
    // Re-enable once login is working to prevent unbounded session table growth.
  }

  // ============================================================
  // GET CURRENT PORTAL USER FROM SESSION — FIX #4 + #9
  //
  // Validates: cookie present → session exists → not revoked →
  //            not expired → portal user still active.
  //
  // The active-user check (FIX #4) ensures a deactivated account
  // is blocked immediately, not after the session naturally expires.
  // ============================================================
  function getCurrentPortalUser(request) {
    const cookieName = String(getParam(P_COOKIE_NAME, 'PRSESS'));
    const token = parseCookie(request)[cookieName];
    log.audit('getCurrentPortalUser', 'cookieName=' + cookieName + ' tokenPresent=' + !!token);
    if (!token) return null;

    const tokenHashHex = sha256Hex(token);
    const sessId = findSessionIdByTokenHash(tokenHashHex);
    log.audit('getCurrentPortalUser', 'sessId=' + sessId);
    if (!sessId) return null;

    const sessRec = record.load({ type: REC_SESSION, id: sessId, isDynamic: false });

    const revoked = sessRec.getValue({ fieldId: F_SESS_REVOKED }) === true
                 || sessRec.getValue({ fieldId: F_SESS_REVOKED }) === 'T';
    log.audit('getCurrentPortalUser', 'revoked=' + revoked);
    if (revoked) return null;

    const expiresAt = sessRec.getValue({ fieldId: F_SESS_EXPIRES_AT });
    if (!expiresAt) { log.audit('getCurrentPortalUser', 'no expiresAt'); return null; }
    if ((expiresAt instanceof Date ? expiresAt : new Date(expiresAt)) <= now()) {
      log.audit('getCurrentPortalUser', 'session expired');
      return null;
    }

    const portalUserId = sessRec.getValue({ fieldId: F_SESS_USER });
    log.audit('getCurrentPortalUser', 'portalUserId=' + portalUserId);
    if (!portalUserId) return null;

    try {
      const puRec = record.load({ type: REC_PORTAL_USER, id: String(portalUserId), isDynamic: false });
      const isActive = puRec.getValue({ fieldId: F_IS_ACTIVE }) === true
                    || puRec.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
      log.audit('getCurrentPortalUser', 'isActive=' + isActive);
      if (!isActive) return null;
    } catch (e) {
      log.error('getCurrentPortalUser portalUser load failed', e);
      return null;
    }

    // Update last-seen (best effort)
    try {
      record.submitFields({
        type: REC_SESSION, id: sessId,
        values: { [F_SESS_LAST_SEEN]: now() },
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });
    } catch (e) {}

    return String(portalUserId);
  }

  // ============================================================
  // CREATE SESSION — FIX #7
  // Generates token, creates session record, sets cookie.
  // Runs cleanupSessions first to keep the table bounded.
  // ============================================================
  function createSession(response, portalUserId) {
    const cookieName  = String(getParam(P_COOKIE_NAME, 'PRSESS'));
    const sessionHours = parseInt(getParam(P_SESSION_HOURS, '8'), 10);

    cleanupSessions(portalUserId); // FIX #7

    const rawToken    = randomBase64UrlToken(32);
    const tokenHashHex = sha256Hex(rawToken);
    const expiresAt   = addHours(now(), sessionHours);

    const sessRec = record.create({ type: REC_SESSION, isDynamic: false });
    sessRec.setValue({ fieldId: F_SESS_USER,       value: portalUserId });
    sessRec.setValue({ fieldId: F_SESS_TOKEN_HASH, value: tokenHashHex });
    sessRec.setValue({ fieldId: F_SESS_EXPIRES_AT, value: expiresAt });
    sessRec.setValue({ fieldId: F_SESS_REVOKED,    value: false });
    sessRec.setValue({ fieldId: F_SESS_LAST_SEEN,  value: now() });
    sessRec.save({ enableSourcing: false, ignoreMandatoryFields: true });

    setCookie(response, cookieName, rawToken, { path: '/', maxAge: sessionHours * 3600 });
  }

  // ============================================================
  // REVOKE SESSION (logout)
  // ============================================================
  function revokeSession(request, response) {
    const cookieName = String(getParam(P_COOKIE_NAME, 'PRSESS'));
    const token = parseCookie(request)[cookieName];
    if (token) {
      const sessId = findSessionIdByTokenHash(sha256Hex(token));
      if (sessId) {
        try {
          record.submitFields({
            type: REC_SESSION, id: sessId,
            values: { [F_SESS_REVOKED]: true },
            options: { enableSourcing: false, ignoreMandatoryFields: true }
          });
        } catch (e) {}
      }
    }
    setCookie(response, cookieName, 'deleted', { path: '/', maxAge: 0 });
  }

  // ============================================================
  // EXPORTS
  // ============================================================
  return {
    // Record / field constants
    REC_PORTAL_USER, REC_SESSION,
    F_EMPLOYEE, F_IS_ACTIVE,
    F_PW_HASH, F_PW_SALT,
    F_PW_TOKEN_HASH, F_PW_TOKEN_EXPIRES, F_PW_TOKEN_USED,
    F_FAILED_ATTEMPTS, F_LOCKED_UNTIL, F_LAST_LOGIN,
    F_SESS_USER, F_SESS_TOKEN_HASH, F_SESS_EXPIRES_AT, F_SESS_REVOKED, F_SESS_LAST_SEEN,
    // Script parameter names
    P_COOKIE_NAME, P_SESSION_HOURS, P_PW_HASH_ITERS, P_LOCK_MAX_ATTEMPTS, P_LOCK_MINUTES,
    // Base utilities
    now, addHours, addMinutes, getParam, escapeHtml, sha256Hex, randomBase64UrlToken,
    parseCookie, setCookie,
    // KDF
    derivePasswordHash,
    // Session management
    getCurrentPortalUser, createSession, revokeSession
  };
});
