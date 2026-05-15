/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/runtime', 'N/email', 'N/url', 'N/crypto', 'N/crypto/random', 'N/encode', 'N/log'],
  (record, runtime, email, url, crypto, cryptoRandom, encode, log) => {

  // ==============================
  // CONFIG
  // ==============================
  const REC_PORTAL_USER = 'customrecord_pr_portal_user';

  const F_EMPLOYEE          = 'custrecord_pru_employee';
  const F_IS_ACTIVE         = 'custrecord_pru_is_active';

  const F_PW_HASH           = 'custrecord_pru_password_hash';
  const F_PW_SALT           = 'custrecord_pru_password_salt';

  const F_PW_TOKEN_HASH     = 'custrecord_pru_pw_token_hash';
  const F_PW_TOKEN_EXPIRES  = 'custrecord_pru_pw_token_expires';
  const F_PW_TOKEN_USED     = 'custrecord_pru_pw_token_used';

  const F_SEND_SET_PW       = 'custrecord_pru_send_setpw'; // <-- checkbox à créer

  // Paramètres script (recommandé)
  const P_SL_SCRIPT_ID      = 'custscript_pr_setpw_sl_scriptid';   // ex: 1234
  const P_SL_DEPLOY_ID      = 'custscript_pr_setpw_sl_deployid';   // ex: 1
  const P_EMAIL_AUTHOR      = 'custscript_pr_setpw_email_author';  // internalid employee / user
  const P_TOKEN_HOURS       = 'custscript_pr_setpw_token_hours';   // ex: 24

  // Cookie/session gérés dans le Suitelet auth plus tard; ici: juste lien setpw.

  function nowPlusHours(hours) {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return d;
  }

  function sha256Hex(input) {
    const hash = crypto.createHash({ algorithm: crypto.HashAlg.SHA256 });
    hash.update({ input, inputEncoding: encode.Encoding.UTF_8 });
    return hash.digest({ outputEncoding: encode.Encoding.HEX });
  }

  function randomTokenBytes(lenBytes) {
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

  function buildSetPwUrl(scriptId, deployId, token) {
    // returnExternalUrl: true produces the full URL including domain, compid and ns-at
    return url.resolveScript({
      scriptId:          String(scriptId),
      deploymentId:      String(deployId),
      params:            { route: 'setpw', t: token },
      returnExternalUrl: true
    });
  }

  function afterSubmit(context) {
    try {
      // On ne traite que create + edit
      if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) return;

      const newRec = context.newRecord;
      const recId = newRec.id;

      const newFlag = newRec.getValue({ fieldId: F_SEND_SET_PW }) === true || newRec.getValue({ fieldId: F_SEND_SET_PW }) === 'T';
      const oldFlag = context.oldRecord
        ? (context.oldRecord.getValue({ fieldId: F_SEND_SET_PW }) === true || context.oldRecord.getValue({ fieldId: F_SEND_SET_PW }) === 'T')
        : false;

      // Only when checkbox is (freshly) checked
      if (!newFlag || oldFlag) return;

      const script = runtime.getCurrentScript();
      const slScriptId = script.getParameter({ name: P_SL_SCRIPT_ID });
      const slDeployId = script.getParameter({ name: P_SL_DEPLOY_ID });
      const emailAuthor = script.getParameter({ name: P_EMAIL_AUTHOR }) || runtime.getCurrentUser().id;
      const tokenHours = parseInt(script.getParameter({ name: P_TOKEN_HOURS }) || '24', 10);

      if (!slScriptId || !slDeployId) {
        throw new Error(`Missing script parameters: ${P_SL_SCRIPT_ID} and/or ${P_SL_DEPLOY_ID}`);
      }

      // Charge l'employé pour récupérer son email
      const employeeId = newRec.getValue({ fieldId: F_EMPLOYEE });
      if (!employeeId) throw new Error(`Portal User ${recId} has no employee (${F_EMPLOYEE})`);

      const empRec = record.load({ type: record.Type.EMPLOYEE, id: employeeId, isDynamic: false });
      const empEmail = empRec.getValue({ fieldId: 'email' });

      if (!empEmail) throw new Error(`Employee ${employeeId} has no email`);

      // (Optionnel) check user active
      const isActive = newRec.getValue({ fieldId: F_IS_ACTIVE }) === true || newRec.getValue({ fieldId: F_IS_ACTIVE }) === 'T';
      if (!isActive) throw new Error(`Portal User ${recId} is not active`);

      // Génère token fort
      const token = randomTokenBytes(32); // ~256 bits
      const tokenHashHex = sha256Hex(token);
      const expiresAt = nowPlusHours(tokenHours);

      // Stocke hash token + expiration + used=F + reset checkbox
      record.submitFields({
        type: REC_PORTAL_USER,
        id: recId,
        values: {
          [F_PW_TOKEN_HASH]: tokenHashHex,
          [F_PW_TOKEN_EXPIRES]: expiresAt,
          [F_PW_TOKEN_USED]: false,
          [F_SEND_SET_PW]: false
        },
        options: { enableSourcing: false, ignoreMandatoryFields: true }
      });

      const setpwUrl = buildSetPwUrl(slScriptId, slDeployId, token);

      const subject = `Définissez votre mot de passe - Portail Achats`;
      const body =
        `<p>Bonjour,</p>` +
        `<p>Cliquez sur le bouton ci-dessous pour définir (ou réinitialiser) votre mot de passe du portail achats :</p>` +
        `<p style="margin:24px 0;">` +
          `<a href="${setpwUrl}" ` +
             `style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;font-family:system-ui,Arial,sans-serif;">` +
            `Définir mon mot de passe` +
          `</a>` +
        `</p>` +
        `<p style="color:#6b7280;font-size:13px;">` +
          `Ce lien expire dans ${tokenHours} heure(s).<br>` +
          `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br>` +
          `<a href="${setpwUrl}">${setpwUrl}</a>` +
        `</p>` +
        `<p style="color:#9ca3af;font-size:12px;">Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>`;

      email.send({
        author:     parseInt(emailAuthor, 10),
        recipients: empEmail,
        subject,
        body
      });

      log.audit('SetPW email sent', { portalUserId: recId, employeeId, empEmail, expiresAt });

    } catch (e) {
      log.error('UE PortalUser SetPW - fatal', e);
      // On décoche la case même si erreur ? je préfère NON : sinon l’admin ne sait pas que ça a échoué.
      // Mais on peut éviter le renvoi en boucle en ne resoumettant rien ici.
    }
  }

  return { afterSubmit };
});
