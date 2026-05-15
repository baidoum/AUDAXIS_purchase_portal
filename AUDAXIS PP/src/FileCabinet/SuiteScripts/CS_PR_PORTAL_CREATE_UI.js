/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/url'], (url) => {

  const THIS_SUITELET_SCRIPTID = 'customscript_sl_pr_portal_auth';
  const THIS_SUITELET_DEPLOYID = 'customdeploy_sl_pr_portal_auth';

  // --- Helpers
  function $(id){ return document.getElementById(id); }

  function resolveLookupUrl(params){
    // ClientScript => on peut résoudre une URL interne vers le Suitelet
    return url.resolveScript({
      scriptId: THIS_SUITELET_SCRIPTID,
      deploymentId: THIS_SUITELET_DEPLOYID,
      params: params || {}
    });
  }

  function debounce(fn, delay){
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  async function fetchJson(u){
    const r = await fetch(u, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  function clearList(listEl){
    while(listEl.firstChild) listEl.removeChild(listEl.firstChild);
  }

  function buildOptionRow(item){
    // item = {id, label}
    const div = document.createElement('div');
    div.className = 'pr-opt';
    div.dataset.id = item.id;
    div.textContent = item.label;
    return div;
  }

  function openDropdown(dd){
    dd.classList.add('open');
  }
  function closeDropdown(dd){
    dd.classList.remove('open');
  }

  // --- Typeahead wiring
  function wireTypeahead({ inputId, hiddenId, ddId, type }) {
    const input = $(inputId);
    const hidden = $(hiddenId);
    const dd = $(ddId);
    if (!input || !hidden || !dd) return;

    const list = dd.querySelector('.pr-dd-list');
    const status = dd.querySelector('.pr-dd-status');

    let lastQuery = '';
    let lastItems = [];

    const runSearch = debounce(async () => {
      const q = (input.value || '').trim();
      lastQuery = q;

      hidden.value = ''; // reset id si user retape
      status.textContent = q.length ? 'Recherche…' : 'Tape pour chercher…';
      clearList(list);
      openDropdown(dd);

      if (!q || q.length < 2) {
        status.textContent = 'Tape au moins 2 caractères…';
        return;
      }

      try {
        const lookupUrl = resolveLookupUrl({ route: 'lookup', type, q });
        const data = await fetchJson(lookupUrl);

        // si l'utilisateur a retapé entre temps, ignore
        if (q !== lastQuery) return;

        lastItems = (data && data.items) ? data.items : [];
        clearList(list);

        if (!lastItems.length) {
          status.textContent = 'Aucun résultat.';
          return;
        }

        status.textContent = `${lastItems.length} résultat(s)`;
        lastItems.forEach(it => {
          const row = buildOptionRow(it);
          row.addEventListener('mousedown', (e) => { // mousedown pour éviter blur avant click
            e.preventDefault();
            input.value = it.label;
            hidden.value = String(it.id);
            closeDropdown(dd);
          });
          list.appendChild(row);
        });
      } catch (e) {
        status.textContent = 'Erreur de recherche.';
      }
    }, 250);

    input.addEventListener('focus', () => {
      openDropdown(dd);
      if (!lastQuery) status.textContent = 'Tape pour chercher…';
    });

    input.addEventListener('input', runSearch);

    input.addEventListener('blur', () => {
      // petit délai pour laisser le mousedown sélectionner une option
      setTimeout(() => closeDropdown(dd), 150);
    });

    // esc = fermer
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDropdown(dd);
    });
  }

  function validateBeforeSubmit(){
    // Hidden fields créés dans le Suitelet (texte)
    const vendorId = ($('custpage_vendor') && $('custpage_vendor').value) ? $('custpage_vendor').value.trim() : '';
    if (!vendorId) {
      alert("Veuillez sélectionner un fournisseur dans la liste.");
      const vtxt = $('custpage_vendor_txt');
      if (vtxt) vtxt.focus();
      return false;
    }
    // class non obligatoire
    return true;
  }

  function pageInit(context){
    // Active uniquement sur la route create (si tu as mis un marker)
    const route = $('custpage_route') ? $('custpage_route').value : '';
    if (String(route).toLowerCase() !== 'create') return;

    wireTypeahead({
      inputId: 'custpage_vendor_txt',
      hiddenId: 'custpage_vendor',
      ddId: 'custpage_vendor_dd',
      type: 'vendor'
    });

    wireTypeahead({
      inputId: 'custpage_class_txt',
      hiddenId: 'custpage_class',
      ddId: 'custpage_class_dd',
      type: 'class'
    });

    // Hook submit bouton natif
    const formEl = document.forms && document.forms[0];
    if (formEl) {
      formEl.addEventListener('submit', (e) => {
        if (!validateBeforeSubmit()) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
    }
  }

  return { pageInit };
});