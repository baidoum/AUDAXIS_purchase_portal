/**
 * LIB_PR_PORTAL_THEME.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Brand theme for La Chaîne de l'Espoir purchase portal.
 * Amber #F5A823 / Teal #3BBFCE color scheme.
 */
define([], () => {

  // ── Inline SVG sun logo ───────────────────────────────────────────────────
  const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="48" height="48" aria-hidden="true">
  <circle cx="30" cy="30" r="12" fill="#F5A823"/>
  <g stroke="#F5A823" stroke-width="3.5" stroke-linecap="round">
    <line x1="30" y1="4"  x2="30" y2="12"/>
    <line x1="30" y1="48" x2="30" y2="56"/>
    <line x1="4"  y1="30" x2="12" y2="30"/>
    <line x1="48" y1="30" x2="56" y2="30"/>
    <line x1="11.5" y1="11.5" x2="17.3" y2="17.3"/>
    <line x1="42.7" y1="42.7" x2="48.5" y2="48.5"/>
    <line x1="48.5" y1="11.5" x2="42.7" y2="17.3"/>
    <line x1="17.3" y1="42.7" x2="11.5" y2="48.5"/>
  </g>
</svg>`;

  // ── Shared brand CSS ──────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
    :root{
      --amber:#F5A823; --amber-dark:#d4891a; --amber-light:#FEF3D7;
      --teal:#3BBFCE;  --teal-dark:#2da3b1;  --teal-light:#E6F8FA;
      --bg:#F4F5F7; --card:#ffffff;
      --text:#1A1A2E; --muted:#6b7280;
      --line:#E5E7EB; --shadow:0 4px 24px rgba(0,0,0,.08);
      --radius:14px; --radius-sm:8px;
      --danger:#b91c1c; --danger-bg:#fff5f5; --danger-border:#fecaca;
      --success:#166534; --success-bg:#f0fdf4; --success-border:#bbf7d0;
    }
    *{ box-sizing:border-box; margin:0; padding:0; }
    body{
      font-family:'Inter',system-ui,-apple-system,Segoe UI,Arial,sans-serif;
      background:var(--bg); color:var(--text); min-height:100vh;
    }

    /* ── Brand header ── */
    .brand-header{
      background:#fff; border-bottom:3px solid var(--amber);
      padding:14px 24px; display:flex; align-items:center; gap:14px;
    }
    .brand-header .brand-name{
      font-size:17px; font-weight:800; color:var(--text); line-height:1.1;
    }
    .brand-header .brand-sub{
      font-size:12px; color:var(--muted); font-weight:600; letter-spacing:.03em;
    }
    .brand-header .brand-divider{
      width:3px; height:32px; background:var(--amber); border-radius:2px; margin:0 4px;
    }

    /* ── Layout ── */
    .wrap{ max-width:1600px; margin:0 auto; padding:20px 24px; }
    .card{
      background:var(--card); border:1px solid var(--line);
      border-radius:var(--radius); box-shadow:var(--shadow); padding:20px;
    }
    .card-sm{ max-width:460px; margin:0 auto; }

    /* ── Nav ── */
    .nav{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
    .nav a{
      display:inline-flex; align-items:center; padding:7px 12px;
      border-radius:var(--radius-sm); text-decoration:none;
      color:var(--muted); border:1px solid transparent; font-weight:700; font-size:13px;
    }
    .nav a:hover{ background:#f9fafb; border-color:var(--line); color:var(--text); }
    .nav a.active{ background:var(--amber); border-color:var(--amber); color:#fff; }
    .nav-logout-form{ display:inline; }
    .nav-logout{
      display:inline-flex; align-items:center; padding:7px 12px;
      border-radius:var(--radius-sm); border:1px solid transparent;
      font-weight:700; font-size:13px; background:none; cursor:pointer;
      color:var(--danger); font-family:inherit;
    }
    .nav-logout:hover{ background:var(--danger-bg); border-color:var(--danger-border); }

    /* ── Page head ── */
    .page-head{ display:flex; align-items:flex-start; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:16px; }
    .page-title{ font-size:22px; font-weight:800; }
    .page-sub{ color:var(--muted); font-size:13px; margin-top:4px; max-width:700px; }

    /* ── Divider / spacer ── */
    .divider{ border-top:1px solid var(--line); margin:16px 0; }
    .spacer{ height:12px; }

    /* ── Grid ── */
    .grid{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }

    /* ── Form fields ── */
    .field{ display:flex; flex-direction:column; gap:6px; }
    .label{ font-size:11px; font-weight:800; color:#374151; letter-spacing:.06em; text-transform:uppercase; }
    .help{ font-size:12px; color:var(--muted); }
    .input{
      width:100%; padding:10px 13px; border:1.5px solid var(--line);
      border-radius:var(--radius-sm); background:#fff; font-size:14px;
      font-family:inherit; outline:none; transition:border-color .15s, box-shadow .15s;
    }
    .input:focus{ border-color:var(--teal); box-shadow:0 0 0 3px rgba(59,191,206,.18); }

    /* ── Buttons ── */
    .btn{
      appearance:none; border:1.5px solid var(--line); background:#fff;
      color:var(--text); padding:10px 16px; border-radius:var(--radius-sm);
      font-weight:700; font-size:13px; font-family:inherit; cursor:pointer;
      transition:background .12s, border-color .12s;
    }
    .btn:hover{ background:#f3f4f6; border-color:#d1d5db; }
    .btn.primary{ background:var(--amber); border-color:var(--amber); color:#fff; }
    .btn.primary:hover{ background:var(--amber-dark); border-color:var(--amber-dark); }
    .btn.secondary{ background:var(--teal); border-color:var(--teal); color:#fff; }
    .btn.secondary:hover{ background:var(--teal-dark); border-color:var(--teal-dark); }
    .btn.danger{ color:var(--danger); border-color:var(--danger-border); background:var(--danger-bg); }
    .btn.danger:hover{ filter:brightness(.97); }
    .btn.full{ width:100%; justify-content:center; padding:12px; font-size:14px; }

    /* ── Pill ── */
    .pill{
      display:inline-flex; padding:4px 12px; border-radius:999px;
      border:1.5px solid var(--line); font-size:12px; font-weight:700;
      color:#374151; background:#fff;
    }

    /* ── Alerts ── */
    .alert{ border-radius:var(--radius-sm); padding:10px 14px; font-weight:600; font-size:14px; margin-bottom:14px; }
    .alert.error{ border:1.5px solid var(--danger-border); background:var(--danger-bg); color:#7f1d1d; }
    .alert.success{ border:1.5px solid var(--success-border); background:var(--success-bg); color:var(--success); }
    .alert.info{ border:1.5px solid #c7d2fe; background:#eef2ff; color:#1f2a5a; }
    .notice{ border:1.5px solid #c7d2fe; background:#eef2ff; color:#1f2a5a; border-radius:var(--radius-sm); padding:10px 12px; font-weight:700; font-size:14px; margin-bottom:12px; display:none; }
    .error-box{ border:1.5px solid var(--danger-border); background:var(--danger-bg); color:#7f1d1d; border-radius:var(--radius-sm); padding:10px 12px; font-weight:700; font-size:14px; margin-bottom:12px; display:none; }

    /* ── Typeahead ── */
    .ta{ position:relative; }
    .ta-list{
      position:absolute; z-index:50; left:0; right:0; top:calc(100% + 4px);
      background:#fff; border:1.5px solid var(--line); border-radius:var(--radius-sm);
      box-shadow:var(--shadow); max-height:260px; overflow:auto; display:none;
    }
    .ta-item{ padding:10px 13px; cursor:pointer; border-bottom:1px solid var(--line); font-weight:600; font-size:13px; }
    .ta-item:last-child{ border-bottom:none; }
    .ta-item:hover{ background:var(--amber-light); color:var(--text); }

    /* ── Table ── */
    .tableWrap{ overflow:auto; border:1.5px solid var(--line); border-radius:var(--radius-sm); }
    table{ width:100%; border-collapse:collapse; min-width:1800px; }
    th,td{ padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th{ background:#f9fafb; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.06em; font-weight:800; }
    th .th-en{ font-size:9px; color:var(--muted); font-weight:600; text-transform:none; letter-spacing:.01em; margin-top:2px; font-style:italic; }
    td .input{ padding:8px 10px; }
    .right{ text-align:right; }
    .muted{ color:var(--muted); font-size:13px; }
    .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between; }

    /* ── Login / setpw card centering ── */
    .auth-wrap{ min-height:100vh; display:flex; flex-direction:column; }
    .auth-body{ flex:1; display:flex; align-items:center; justify-content:center; padding:24px 16px; }
    .auth-card{ background:#fff; border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:36px 32px; width:100%; max-width:440px; }
    .auth-logo{ display:flex; align-items:center; gap:12px; margin-bottom:28px; }
    .auth-title{ font-size:19px; font-weight:800; margin-bottom:6px; }
    .auth-sub{ font-size:13px; color:var(--muted); margin-bottom:24px; }
    label{ display:block; font-size:12px; font-weight:700; color:#374151; letter-spacing:.04em; text-transform:uppercase; margin-bottom:5px; }
    .form-group{ margin-bottom:16px; }

    @media (max-width:860px){
      .grid{ grid-template-columns:1fr; }
      table{ min-width:960px; }
      .nav{ width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
      .nav a, .nav-logout{ white-space:nowrap; }
      .auth-card{ padding:24px 18px; }
    }
  `;

  // ── Page helpers ──────────────────────────────────────────────────────────
  function pageHead(title) {
    return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — Portail Achats</title>
  <style>${CSS}</style>
</head>`;
  }

  function brandHeader(subtitle) {
    const sub = subtitle
      ? `<div class="brand-sub">${subtitle}</div>`
      : '';
    return `<header class="brand-header">
  ${LOGO_SVG}
  <div class="brand-divider"></div>
  <div>
    <div class="brand-name">La Chaîne de l'Espoir</div>
    ${sub}
  </div>
</header>`;
  }

  return { CSS, LOGO_SVG, pageHead, brandHeader };
});
