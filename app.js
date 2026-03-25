// =========================================================
// CONFIG
// =========================================================
const SUPABASE_URL = 'https://ubrzqbunxvyhaohddhyz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Y2qT75-fXXAqfeOBWHeUuQ_BJtQHnAL';
const IMPORTS_BUCKET = 'ml-imports';

// =========================================================
// MINI-STORE (ESTADO GLOBAL CENTRALIZADO)
// =========================================================
const appState = {
    user: null,
    role: null,
    
    currentOrder: null,
    currentOwnInProgressOrderId: null,
    currentViewedBatchId: null,
    currentViewedBatchName: '',
    
    adminImports: [],
    adminFilter: 'Todas',
    workerImports: [],
    workerFilter: 'Todas',
    
    selectedVentasFile: null,
    selectedPublicacionesFile: null,
    
    isBootstrapping: false,
    isRehydrating: false,
    isTakingOrder: false,
    isCompletingOrder: false,
    isReleasingOrder: false,
    isReportingIssue: false
};

let pendingReopenParams = null; 

// =========================================================
// HELPERS UI & NETWORK & MAPS
// =========================================================
const $ = (id) => document.getElementById(id);

const roleMap = { 'admin': 'Administrador', 'worker': 'Operario' };

const orderStatusMap = {
  'pending': 'Pendiente',
  'in_progress': 'En Proceso',
  'prepared': 'Completado',
  'issue': 'Problema',
  'taken': 'Tomado' 
};

function showToast(msg, type = 'info') {
    const container = $('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast-msg ${type}`;
    toast.textContent = msg;
    
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 4000);
}

function showView(id) {
  ['view-login', 'view-loading', 'view-admin', 'view-admin-manage', 'view-worker-home', 'view-pick', 'view-worker-batch'].forEach(v => {
    const el = $(v);
    if(el) el.classList.remove('active');
  });
  const target = $(id);
  if(target) target.classList.add('active');
}

function setStatus(id, text, color = 'var(--muted)') {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function showMessage(id, text, kind = 'info') {
  const el = $(id);
  if (!el) return;
  el.className = `msg active ${kind}`;
  el.textContent = text || '';
}

function hideMessage(id) {
  const el = $(id);
  if (!el) return;
  el.className = 'msg';
  el.textContent = '';
}

function escapeHtml(str) {
  return String(str ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function formatDateTime(v) {
  if (!v) return '-';
  try {
    const d = new Date(v);
    return d.toLocaleString('es-UY', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  } catch { return String(v); }
}

function fileInfo(file) {
  if (!file) return 'Sin archivo';
  return `${file.name} | ${formatBytes(file.size)}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function statusTag(rawStatus) {
  const s = rawStatus || '';
  let tagClass = 'pending';
  if (s === 'Pendiente') tagClass = 'pending';
  else if (s === 'En Proceso') tagClass = 'in_progress';
  else if (s === 'Cerrada') tagClass = 'prepared';
  else if (s === 'Con Problemas' || s === 'Problema') tagClass = 'issue';
  else if (s === 'Fallido') tagClass = 'failed';
  
  return `<span class="tag ${tagClass}">${escapeHtml(s)}</span>`;
}

function translateError(err) {
  if (!err) return 'Error desconocido.';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return JSON.stringify(err);
}

function sanitizeFileName(name) {
  return String(name || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMlUrl(itemId) {
  if (!itemId || itemId === '-' || !String(itemId).toUpperCase().startsWith('ML')) return null;
  const siteId = String(itemId).substring(0, 3).toUpperCase(); 
  const numericId = String(itemId).substring(3).replace(/\D/g, ''); 
  return `https://articulo.mercadolibre.com.uy/${siteId}-${numericId}`;
}

function openModal(id) { const el = $(id.replace('#','')); if(el) el.classList.add('active'); }
function closeModal(id) { const el = $(id.replace('#','')); if(el) el.classList.remove('active'); }

// =========================================================
// VALIDACIÓN DE SESIÓN FUERTE
// =========================================================
let sb = null;

async function ensureValidSession() {
    if (!appState.user) {
        showToast('Sesión no disponible. Iniciá sesión nuevamente.', 'error');
        await performLogout();
        throw new Error('Sesión inválida');
    }
    return true;
}

window.addEventListener('online', () => {
    const banner = $('offlineBanner');
    if (banner) banner.classList.remove('active');
});

window.addEventListener('offline', () => {
    const banner = $('offlineBanner');
    if (banner) banner.classList.add('active');
});

async function rehydrateApp() {
    return;
}

        if ($('view-worker-home').classList.contains('active')) refreshWorkerHome();
        if ($('view-admin').classList.contains('active')) refreshAdminPanel();

    } catch(e) {
        console.error("Falla silenciosa en rehidratación:", e);
    } finally {
        appState.isRehydrating = false;
        if ($('view-pick').classList.contains('active')) renderCurrentOrder(false);
    }
}

// =========================================================
// ALMACENAMIENTO LOCAL DE TILDES (OFFLINE DRAFT)
// =========================================================
function saveDraftLocal(orderId, items) {
    const checks = items.map(i => ({ id: i.id, checked: i.checked }));
    localStorage.setItem(`draft_order_${orderId}`, JSON.stringify(checks));
}

function loadDraftLocal(orderId, items) {
    const saved = localStorage.getItem(`draft_order_${orderId}`);
    if (!saved) return items;
    try {
        const checks = JSON.parse(saved);
        const checkMap = Object.fromEntries(checks.map(c => [c.id, c.checked]));
        return items.map(i => ({ ...i, checked: checkMap[i.id] !== undefined ? checkMap[i.id] : i.checked }));
    } catch { return items; }
}

function clearDraftLocal(orderId) {
    localStorage.removeItem(`draft_order_${orderId}`);
}

// =========================================================
// TABS ADMIN (En la vista Manage)
// =========================================================
function switchAdminTab(tabName) {
  ['tabVentas', 'tabCatalog'].forEach(id => {
    $(id).classList.remove('active');
    $(id + 'Btn').classList.remove('active');
  });
  $(tabName === 'ventas' ? 'tabVentas' : 'tabCatalog').classList.add('active');
  $(tabName === 'ventas' ? 'tabVentasBtn' : 'tabCatalogBtn').classList.add('active');

  if (tabName === 'catalog') {
    loadCatalogTable();
  }
}

// =========================================================
// AUTH / SESSION
// =========================================================
function initSupabase() {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('No cargó la librería de Supabase.');
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function login() {
  hideMessage('loginError');
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  if (!email || !password) {
    showMessage('loginError', 'Ingresá email y contraseña.', 'error');
    return;
  }

  const btn = $('btnLogin');
  btn.disabled = true;
  btn.textContent = 'Ingresando...';

  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await bootstrapSession(); 
  } catch (err) {
    showMessage('loginError', translateError(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
}

async function performLogout() {
  try { await sb.auth.signOut(); } catch (_) {}
  
  appState.user = null;
  appState.role = null;
  appState.currentOrder = null; 
  appState.currentOwnInProgressOrderId = null;
  appState.currentViewedBatchId = null; 
  appState.currentViewedBatchName = '';
  
  appState.adminImports = [];
  appState.adminFilter = 'Todas';
  appState.workerImports = [];
  appState.workerFilter = 'Todas';
  
  appState.selectedVentasFile = null;
  appState.selectedPublicacionesFile = null;
  
  pendingReopenParams = null;
  
  const vF = $('ventasFile'); if(vF) vF.value = '';
  const pF = $('publicacionesFile'); if(pF) pF.value = '';
  
  showView('view-login');
}

async function bootstrapSession() {
  if (appState.isBootstrapping) return; 
  appState.isBootstrapping = true;

  showView('view-loading');
  setStatus('loadingStatus', 'Conectando con Supabase...');

  try {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    const session = data?.session || null;
    if (!session?.user) {
      showView('view-login');
      appState.isBootstrapping = false;
      return;
    }

    appState.user = session.user;
    setStatus('loadingStatus', 'Sesión detectada. Consultando permisos...');

    const role = await getMyRole();
    appState.role = role;

    if (!role) {
      throw new Error('No se pudo obtener el rol del usuario.');
    }

    const translatedRole = roleMap[role] || role;
    $('adminUserLabel').textContent = `${appState.user.email} | rol: ${translatedRole}`;
    $('workerUserLabel').textContent = `${appState.user.email} | rol: ${translatedRole}`;

    await routeByRole();
  } catch (err) {
    setStatus('loadingStatus', '💥 ERROR: ' + translateError(err), 'var(--err)');
    const loadingBox = $('view-loading').querySelector('.card');
    if (!document.getElementById('btnRetryBoot')) {
       loadingBox.innerHTML += `<button id="btnRetryBoot" class="btn-primary" style="margin-top: 15px;" onclick="location.reload()">Reintentar Conexión</button>`;
    }
  } finally {
    appState.isBootstrapping = false;
  }
}

async function getMyRole() {
  const { data, error } = await sb.rpc('get_my_role');
  if (error) throw error;
  return data;
}

async function routeByRole() {
  if (appState.role === 'admin') {
    showView('view-admin');
    await refreshAdminPanel();
    return;
  }
  if (appState.role === 'worker') {
    showView('view-worker-home');
    await refreshWorkerHome();
    return;
  }
  throw new Error('Rol no permitido.');
}

// =========================================================
// EXCEL HELPERS
// =========================================================
const memoizedNormals = new Map();
function normalizeText(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (memoizedNormals.has(str)) return memoizedNormals.get(str);
  
  const norm = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  memoizedNormals.set(str, norm);
  return norm;
}

function safeString(v, fallback = '-') {
  const s = String(v ?? '').trim();
  return s === '' ? fallback : s;
}

async function readWorkbookFromFile(file) {
  const ab = await file.arrayBuffer();
  return XLSX.read(ab, { type: 'array' });
}

function sheetToMatrix(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false });
}

function parseSmartExcel(workbook, type = 'ventas') {
  const allData = [];
  const keywordsByType = {
    ventas: ['# de venta', 'numero de venta', 'número de venta', 'comprador', 'titulo de la publicacion', 'título de la publicación', 'titulo', 'unidades', 'variante'],
    pubs: ['item_id', 'numero de publicacion', 'número de publicación', 'sku', 'titulo', 'título', 'variantes', 'variations', 'variacion', 'variante']
  };
  const targetKeywords = keywordsByType[type] || keywordsByType.ventas;

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const data = sheetToMatrix(sheet);
    if (!Array.isArray(data) || !data.length) return;

    let headerIndex = -1;
    let bestScore = 0;

    for (let i = 0; i < Math.min(data.length, 30); i++) {
      const row = Array.isArray(data[i]) ? data[i] : [];
      const joined = normalizeText(row.join(' | '));
      const score = targetKeywords.filter(kw => joined.includes(normalizeText(kw))).length;
      if (score > bestScore) { bestScore = score; headerIndex = i; }
    }

    if (headerIndex === -1 || bestScore < 2) return;

    const headersOriginal = data[headerIndex] || [];
    const headersNorm = headersOriginal.map(h => normalizeText(String(h || '')));

    data.slice(headerIndex + 1).forEach((rowArr) => {
      const obj = {};
      let hasData = false;
      headersOriginal.forEach((h, idx) => {
        const val = rowArr[idx] !== undefined ? rowArr[idx] : '';
        const normKey = headersNorm[idx] || `col_${idx}`;
        obj[normKey] = val; 
        if (String(val).trim() !== '') hasData = true;
      });
      if (hasData) allData.push(obj);
    });
  });

  return allData;
}

function getColValue(row, possibleNames) {
  for(let n of possibleNames) {
      const normName = normalizeText(n);
      if(row[normName] !== undefined && row[normName] !== '') return row[normName];
  }
  const normNames = possibleNames.map(n => normalizeText(n));
  for (const key of Object.keys(row || {})) {
    for (const n of normNames) {
      if (key.includes(n) && row[key] !== '') return row[key];
    }
  }
  return '';
}

// =========================================================
// CATALOG LOGIC 
// =========================================================
async function processCatalogImport() {
  hideMessage('adminError');
  hideMessage('adminOk');

  if (!appState.selectedPublicacionesFile) {
    showToast('Tenés que cargar el archivo publicaciones.xlsx', 'error');
    return;
  }

  const btn = $('btnProcessCatalog');
  btn.disabled = true;

  try {
    setStatus('adminStatus', 'Leyendo archivo Excel...', 'var(--info)');
    const wb = await readWorkbookFromFile(appState.selectedPublicacionesFile);
    const rawPubs = parseSmartExcel(wb, 'pubs');

    const payload = rawPubs.map(p => ({
      item_id: safeString(getColValue(p, ['item_id', 'numero de publicacion', 'número de publicación', 'publicacion', 'publicación']), null),
      sku: safeString(getColValue(p, ['sku', 'codigo']), null),
      title: safeString(getColValue(p, ['titulo', 'título', 'title']), 'Producto sin nombre'),
      variant: safeString(getColValue(p, ['variantes', 'variations', 'variacion', 'variante', 'variación']), null)
    })).filter(p => p.item_id);

    if (!payload.length) throw new Error("No se detectaron publicaciones válidas (Falta la columna Número de publicación o ITEM_ID).");

    const batchSize = 100;
    const totalBatches = Math.ceil(payload.length / batchSize);
    
    setStatus('adminStatus', `Iniciando subida de ${payload.length} productos...`, 'var(--warn)');
    
    for (let i = 0; i < totalBatches; i++) {
        const start = i * batchSize;
        const end = start + batchSize;
        const batchPayload = payload.slice(start, end);
        
        const percent = Math.round(((i + 1) / totalBatches) * 100);
        setStatus('adminStatus', `Guardando catálogo ${percent}%...`, 'var(--info)');
        
        const { error } = await sb.rpc('upsert_products', { p_products: batchPayload });
        if (error) throw new Error(`Error: ` + error.message);
        
        await sleep(150);
    }

    showToast(`¡Catálogo actualizado! Se cargaron/actualizaron ${payload.length} productos.`, 'ok');
    appState.selectedPublicacionesFile = null;
    $('publicacionesFile').value = '';
    $('publicacionesFileInfo').textContent = 'Sin archivo';
    
    await loadCatalogTable();
  } catch (err) {
    console.error(err);
    showMessage('adminError', translateError(err), 'error');
  } finally {
    btn.disabled = false;
    setStatus('adminStatus', 'Carga finalizada.', 'var(--ok)');
  }
}

async function loadCatalogTable() {
  try {
    const { data, error, count } = await sb.from('products').select('*', { count: 'exact' }).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;
    
    $('catalogCount').textContent = count || 0;
    const tbody = $('catalogTableBody');
    
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="small text-center">El catálogo está vacío. Subí un archivo de publicaciones.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(p => {
      const url = getMlUrl(p.item_id);
      const idDisplay = url 
        ? `<a href="${url}" target="_blank" style="color: var(--info); text-decoration: none; white-space: nowrap;"><strong>${escapeHtml(p.item_id)}</strong>&nbsp;🔗</a>`
        : `<strong>${escapeHtml(p.item_id)}</strong>`;

      return `<tr><td>${idDisplay}</td><td>${escapeHtml(p.title || '-')}</td><td><span class="variant-text">${escapeHtml(p.variant || '-')}</span></td></tr>`;
    }).join('');
  } catch (err) {
    console.error('Error cargando catálogo:', err);
    $('catalogTableBody').innerHTML = '<tr><td colspan="3" style="color:var(--err)">Error cargando productos.</td></tr>';
  }
}

async function fetchFullDBCatalog() {
  let allProducts = [];
  let step = 1000;
  let start = 0;
  while(true) {
    const { data, error } = await sb.from('products').select('item_id, sku, title, variant').range(start, start + step - 1);
    if (error) throw error;
    for(let item of data) { allProducts.push(item); } 
    if (data.length < step) break;
    start += step;
  }
  return allProducts.map(p => ({ item_id: p.item_id, sku: p.sku, titulo: p.title, variante: p.variant }));
}

// =========================================================
// VENTAS LOGIC
// =========================================================
function buildOrderList(rawVentas, rawCatalog) {
  const pubDict = {};
  rawCatalog.forEach(pub => {
    if (pub.item_id) pubDict[String(pub.item_id).trim()] = pub;
    if (pub.sku) pubDict[String(pub.sku).trim()] = pub;
  });

  const ordersMap = new Map();
  let memBuyer = '-';
  let memSaleId = null;

  rawVentas.forEach((venta) => {
    const rowSaleId = getColValue(venta, ['# de venta', 'numero de venta', 'número de venta', 'venta', 'id de venta', 'numero', 'número']);
    const rowBuyer = getColValue(venta, ['comprador', 'cliente', 'datos personales', 'nombre']);
    const titleRaw = getColValue(venta, ['titulo de la publicacion', 'título de la publicación', 'titulo', 'título', 'producto', 'publicacion', 'publicación']);
    const qtyRaw = getColValue(venta, ['unidades', 'cantidad', 'cant', 'cantidad vendida', 'cantidad de unidades', 'unid', 'units', 'quantity', 'qty', 'cantidad comprada']);

    const qtyText = String(qtyRaw ?? '').trim();
    const qty = Number(qtyText.replace(',', '.')) || parseInt(qtyText.replace(/[^\d]/g, 10)) || 1;

    if (rowBuyer && String(rowBuyer).trim() !== '') {
      memBuyer = String(rowBuyer).trim();
      if (rowSaleId && String(rowSaleId).trim() !== '') memSaleId = String(rowSaleId).trim();
    }

    if (!titleRaw || String(titleRaw).trim() === '' || normalizeText(titleRaw).includes('paquete de')) return;

    const pubId = getColValue(venta, ['# de publicacion', 'numero de publicacion', 'número de publicación', 'item_id']);
    const sku = safeString(getColValue(venta, ['sku']), '');
    const variant = safeString(getColValue(venta, ['variante', 'variacion', 'variación']), '');
    
    const pubInfo = pubDict[String(pubId || '').trim()] || pubDict[String(sku || '').trim()] || {};
    let finalPubId = safeString(pubId || pubInfo.item_id, '');
    if (finalPubId && /^\d+$/.test(finalPubId.replace(/[^0-9]/g, ''))) finalPubId = 'MLU' + finalPubId.replace(/[^0-9]/g, '');

    const groupId = memSaleId || `VENTA_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!ordersMap.has(groupId)) {
      ordersMap.set(groupId, { groupId, displayId: `Venta: ${groupId}`, buyer: memBuyer, items: [] });
    }

    ordersMap.get(groupId).items.push({
      qty: Math.max(1, Number(qty)), pubId: finalPubId || null, sku: safeString(sku || pubInfo.sku, null),
      title: safeString(titleRaw || pubInfo.titulo, 'Producto sin nombre'), variant: safeString(variant || pubInfo.variante, null)
    });
  });

  return Array.from(ordersMap.values())
    .map(order => {
      if (order.items.length > 1) order.displayId = `📦 Paquete: ${order.groupId}`;
      return order;
    })
    .filter(order => order.items.length > 0);
}

async function uploadFileToBucket(file, path) {
  const { error } = await sb.storage.from(IMPORTS_BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
  if (error) throw error;
  return path;
}

function resetImportSelection() {
  appState.selectedVentasFile = null;
  const vF = $('ventasFile'); if (vF) vF.value = '';
  const vI = $('ventasFileInfo'); if (vI) vI.textContent = 'Sin archivo';
  const bN = $('blockName'); if (bN) bN.value = '';
  
  appState.selectedPublicacionesFile = null;
  const pF = $('publicacionesFile'); if (pF) pF.value = '';
  const pI = $('publicacionesFileInfo'); if (pI) pI.textContent = 'Sin archivo';
}

async function processVentasBlock() {
  hideMessage('adminError');
  hideMessage('adminOk');

  if (!appState.selectedVentasFile) { showToast('Tenés que cargar el archivo ventas.xlsx.', 'error'); return; }

  const blockNameInput = $('blockName').value.trim();
  const blockName = blockNameInput ? blockNameInput : null;

  const btnProcess = $('btnProcessImport');
  const btnClear = $('btnClearImport');
  btnProcess.disabled = true; btnClear.disabled = true;

  let importId = null;

  try {
    setStatus('adminStatus', 'Obteniendo catálogo de la base de datos...', 'var(--info)');
    const dbCatalog = await fetchFullDBCatalog();

    setStatus('adminStatus', 'Leyendo Excel de ventas...', 'var(--info)');
    const wbVentas = await readWorkbookFromFile(appState.selectedVentasFile);
    const rawVentas = parseSmartExcel(wbVentas, 'ventas');
    
    setStatus('adminStatus', 'Cruzando datos y armando pedidos...', 'var(--info)');
    const builtOrders = buildOrderList(rawVentas, dbCatalog);

    if (!builtOrders.length) throw new Error(`No se construyeron pedidos válidos.\nVentas detectadas: ${rawVentas.length}`);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFolder = `imports/${stamp}`;
    const ventasPath = `${baseFolder}/${sanitizeFileName(appState.selectedVentasFile.name)}`;
    await uploadFileToBucket(appState.selectedVentasFile, ventasPath);
    
    const { data: importRow, error: createImportError } = await sb.rpc('create_import', {
      p_source_name: blockName, p_ventas_file_name: appState.selectedVentasFile.name, p_publicaciones_file_name: 'Catalogo DB',
      p_fichas_file_name: 'No aplica', p_ventas_storage_path: ventasPath, p_publicaciones_storage_path: null, p_fichas_storage_path: null
    });

    if (createImportError) throw createImportError;
    importId = importRow.id;

    const { error: markProcessingError } = await sb.from('imports').update({ 
      block_name: blockName, picking_status: 'pending', status: 'processing', rows_count: builtOrders.length, error_message: null 
    }).eq('id', importId);

    if (markProcessingError) throw markProcessingError;

    const totalOrders = builtOrders.length;
    setStatus('adminStatus', `Iniciando guardado de ${totalOrders} pedidos...`, 'var(--warn)');

    let processed = 0;
    for (let order of builtOrders) {
        const payloadItems = order.items.map(it => ({ title: it.title, qty: it.qty, sku: it.sku || '', variant: it.variant || '', pub_id: it.pubId || '' }));
        const { error: upsertError } = await sb.rpc('upsert_order_with_items', {
          p_import_id: importId, p_sale_id: order.groupId, p_display_id: order.displayId, p_buyer_name: order.buyer || '', p_items: payloadItems
        });
        
        if (upsertError) throw new Error(`Error guardando pedido de ${order.buyer}: ${upsertError.message}`);
        
        processed++;
        const percent = Math.round((processed / totalOrders) * 100);
        setStatus('adminStatus', `Guardando pedidos... ${percent}% completado`, 'var(--info)');
    }

    await sb.from('imports').update({ status: 'completed', error_message: null }).eq('id', importId);

    resetImportSelection();
    showView('view-admin'); 
    showToast(`¡Orden Creada! Se guardaron ${builtOrders.length} pedidos.`, 'ok');
    setStatus('adminStatus', 'Creación finalizada al 100%.', 'var(--ok)');
    await refreshAdminPanel();
    
  } catch (err) {
    console.error(err);
    showMessage('adminError', translateError(err), 'error');
    setStatus('adminStatus', 'Falló la creación de la Orden.', 'var(--err)');
    if (importId) try { await sb.from('imports').update({ status: 'failed', error_message: translateError(err) }).eq('id', importId); } catch (_) {}
  } finally {
    btnProcess.disabled = false; btnClear.disabled = false;
  }
}

// =========================================================
// LÓGICA DE ESTADOS EMPRESARIAL (WMS)
// =========================================================
function calculateOrderFlags(imp, myOrders) {
  if (imp.status === 'failed') {
      imp._hasPending = false; imp._hasInProgress = false; imp._hasIssues = false; imp._isCompleted = false;
      imp._visualTag = 'Fallido';
      return imp;
  }

  const total = myOrders.length;
  if (total === 0) {
      imp._hasPending = false; imp._hasInProgress = false; imp._hasIssues = false; imp._isCompleted = false;
      imp._visualTag = 'Vacía';
      return imp;
  }

  const pending = myOrders.filter(o => o.status === 'pending' || o.status === 'taken').length;
  const inProgress = myOrders.filter(o => o.status === 'in_progress').length;
  const prepared = myOrders.filter(o => o.status === 'prepared').length;
  const issues = myOrders.filter(o => o.status === 'issue').length;

  imp._hasPending = (pending > 0);
  imp._hasInProgress = (inProgress > 0);
  imp._hasIssues = (issues > 0);
  imp._isCompleted = (prepared === total);

  if (imp._isCompleted) imp._visualTag = 'Cerrada';
  else if (imp._hasIssues) imp._visualTag = 'Con Problemas';
  else if (imp._hasInProgress) imp._visualTag = 'En Proceso';
  else imp._visualTag = 'Pendiente';

  imp._pendingCount = pending;
  imp._doneCount = prepared;
  imp._totalCount = total;

  return imp;
}

// =========================================================
// ADMIN - PANEL Y RESUMEN GLOBAL
// =========================================================
async function refreshAdminPanel() {
  hideMessage('adminError');
  hideMessage('adminOk');
  setStatus('adminStatus', 'Actualizando panel...', 'var(--info)');

  try {
    const [{ data: orders, error: ordersError }, { data: imports, error: importsError }] = await Promise.all([
      sb.from('orders').select(`id, status, import_id`),
      sb.from('imports').select(`id, import_seq, source_name, block_name, picking_status, ventas_file_name, rows_count, status, error_message, created_at, import_date`).order('created_at', { ascending: false }).limit(100)
    ]);

    if (ordersError) throw ordersError;
    if (importsError) throw importsError;

    appState.adminImports = imports.map(imp => {
        const myOrders = orders.filter(o => o.import_id === imp.id);
        return calculateOrderFlags(imp, myOrders);
    });

    $('adminPending').textContent = appState.adminImports.filter(imp => imp._hasPending).length;
    $('adminInProgress').textContent = appState.adminImports.filter(imp => imp._hasInProgress).length;
    $('adminPrepared').textContent = appState.adminImports.filter(imp => imp._isCompleted).length;
    $('adminIssues').textContent = appState.adminImports.filter(imp => imp._hasIssues).length;
    $('adminOrdersTotal').textContent = appState.adminImports.length;

    filterAdminOrders(appState.adminFilter);

    setStatus('adminStatus', 'Panel actualizado.', 'var(--ok)');
  } catch (err) {
    console.error(err);
    showMessage('adminError', translateError(err), 'error');
    setStatus('adminStatus', 'Falló la actualización.', 'var(--err)');
  }
}

window.filterAdminOrders = function(filterType) {
    appState.adminFilter = filterType;
    
    document.querySelectorAll('#view-admin .grid-stats .stat.clickable').forEach(el => el.classList.remove('active-filter'));
    const activeBox = document.getElementById(`filter-${filterType.replace(' ', '')}`);
    if(activeBox) activeBox.classList.add('active-filter');

    const filtered = appState.adminImports.filter(imp => {
        if (filterType === 'Todas') return true;
        if (filterType === 'Pendiente') return imp._hasPending;
        if (filterType === 'En Proceso') return imp._hasInProgress;
        if (filterType === 'Cerrada') return imp._isCompleted;
        if (filterType === 'Con Problemas') return imp._hasIssues;
        return false;
    });

    renderImports(filtered, 'importsList');
};

function renderImports(rows, containerId) {
  const box = $(containerId);
  if (!rows.length) { box.innerHTML = `<div class="small text-center" style="padding: 20px;">No hay órdenes para mostrar en este filtro.</div>`; return; }

  const isWorker = (containerId === 'workerBlocksContainer');
  const ownInProgress = appState.currentOwnInProgressOrderId != null;
  let hasAvailableBlocks = false;

  box.innerHTML = rows.map(imp => {
    let seqPad = imp.import_seq ? String(imp.import_seq).padStart(4, '0') : '0000';
    let loteName = imp.block_name ? `Orden ${seqPad} · ${imp.block_name}` : `Orden ${seqPad}`;
    let visualStatus = imp._visualTag; 
    
    const canWork = isWorker && imp._hasPending && !ownInProgress;
    if (isWorker && imp._hasPending) hasAvailableBlocks = true;

    let buttonsHtml = '';
    if (isWorker) {
        buttonsHtml = `
          <button class="btn-primary" onclick="takeNextFromBlock('${imp.id}')" ${canWork ? '' : 'disabled'}>
            ${!imp._hasPending ? 'Orden terminada ✅' : 'Preparar pedidos'}
          </button>
          <button class="btn-secondary" onclick="loadWorkerBatch('${imp.id}', '${escapeHtml(loteName)}')">
            🔍 Ver Contenido
          </button>
        `;
    } else {
        buttonsHtml = `
          <button class="btn-info" onclick="openAdminOrdersModal('${imp.id}', '${escapeHtml(loteName)}')">
            🔍 Ver Pedidos
          </button>
          <button class="btn-danger-outline" style="width: auto;" onclick="deleteImportAdmin('${imp.id}')" title="Eliminar Orden de Trabajo">
            🗑️
          </button>
        `;
    }

    return `
      <div class="item-card" style="${isWorker ? 'border-left: 4px solid var(--primary);' : ''}">
        <div class="item-head">
          <div>
            <strong style="font-size: 1.15rem; color: var(--primary);">${escapeHtml(loteName)}</strong>
            <div class="small" style="margin-top: 5px;">Creado: ${escapeHtml(formatDateTime(imp.created_at))}</div>
            <div class="small">
              Pendientes: <span style="color:var(--info); font-weight:bold;">${imp._pendingCount || 0}</span> | 
              Preparados: <span style="color:var(--ok); font-weight:bold;">${imp._doneCount || 0}</span> / ${imp._totalCount || imp.rows_count || 0}
            </div>
          </div>
          <div>${statusTag(visualStatus)}</div>
        </div>
        ${imp.error_message ? `<div class="tiny" style="margin-top:8px;color:#fdba74;">Error: ${escapeHtml(imp.error_message)}</div>` : ''}
        <div class="divider"></div>
        <div class="item-actions">
          ${buttonsHtml}
        </div>
      </div>
    `;
  }).join('');

  if (isWorker) {
      if (ownInProgress) setStatus('workerStatus', 'Tenés un pedido en curso.', 'var(--warn)');
      else if (hasAvailableBlocks) setStatus('workerStatus', 'Hay órdenes disponibles para trabajar.', 'var(--ok)');
      else setStatus('workerStatus', 'No hay órdenes pendientes en el filtro actual.', 'var(--muted)');
  }
}

async function openAdminOrdersModal(importId, loteName) {
    const title = $('adminModalTitle');
    const summary = $('adminModalSummary');
    const list = $('adminModalOrdersList');
    
    title.textContent = `Pedidos de la: ${loteName}`;
    summary.textContent = 'Cargando pedidos...';
    list.innerHTML = '<div class="spinner"></div>';
    
    openModal('#admin-orders-modal');
    
    try {
        const { data: orders, error } = await sb.from('orders')
            .select(`id, sale_id, display_id, buyer_name, status, issue_reason, order_items(qty)`)
            .eq('import_id', importId)
            .order('created_at', {ascending: true});
            
        if (error) throw error;
        
        if (!orders || orders.length === 0) {
            summary.textContent = 'Esta orden no tiene paquetes.';
            list.innerHTML = '<div class="small text-center" style="padding:20px;">Sin pedidos.</div>';
            return;
        }
        
        const total = orders.length;
        const pending = orders.filter(o => o.status === 'pending' || o.status === 'taken').length;
        const listos = orders.filter(o => o.status === 'prepared').length;
        const incidencias = orders.filter(o => o.status === 'issue').length;
        
        summary.textContent = `Total: ${total} | Pendientes: ${pending} | Listos: ${listos} | Con Problemas: ${incidencias}`;
        
        list.innerHTML = orders.map(order => {
            const items = Array.isArray(order.order_items) ? order.order_items : [];
            const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
            
            let actionBtn = '';
            if (order.status === 'prepared' || order.status === 'issue') {
                actionBtn = `<button class="btn-secondary" onclick="promptAdminReopen('${order.id}', '${importId}', '${escapeHtml(loteName)}')">Reabrir para Revisar</button>`;
            } else if (order.status === 'in_progress') {
                actionBtn = `<span class="small" style="color:var(--warn); font-weight:bold;">En preparación...</span>`;
            } else {
                actionBtn = `<span class="small" style="color:var(--info); font-weight:bold;">Pendiente de preparación</span>`;
            }
            
            actionBtn += `<button class="btn-danger-outline" style="width: auto; padding: 6px 10px;" onclick="deleteOrderAdmin('${order.id}', '${importId}', '${escapeHtml(loteName)}')">🗑️</button>`;

            let orderVisualStatus = orderStatusMap[order.status] || order.status;
            if (order.status === 'issue') orderVisualStatus = 'Problema';

            return `
                <div class="item-card" style="margin-bottom: 10px;">
                    <div class="item-head">
                        <div>
                            <strong>${escapeHtml(order.display_id || order.sale_id)}</strong>
                            <div class="small">Comprador: ${escapeHtml(order.buyer_name || '-')}</div>
                            <div class="small">Unidades: ${totalQty}</div>
                            ${order.issue_reason ? `<div class="small" style="color:var(--err)">Problema: ${escapeHtml(order.issue_reason)}</div>` : ''}
                        </div>
                        <div><span class="tag ${order.status}">${orderVisualStatus}</span></div>
                    </div>
                    <div class="item-actions" style="margin-top:12px;">
                        ${actionBtn}
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error(err);
        list.innerHTML = `<div class="msg error active">${translateError(err)}</div>`;
    }
}

// =========================================================
// MODALES DE CONFIRMACIÓN DE ACCIONES
// =========================================================
window.promptAdminReopen = function(orderId, importId, loteName) {
    pendingReopenParams = { orderId, importId, loteName };
    openModal('#modal-reopen-confirm');
};

async function adminReopenOrderModal() {
    if (!pendingReopenParams) return;
    const { orderId, importId, loteName } = pendingReopenParams;
    
    closeModal('#modal-reopen-confirm');
    $('adminModalOrdersList').innerHTML = '<div class="spinner"></div>'; 
    
    try {
        await ensureValidSession();
        const { error } = await sb.rpc('reopen_order', { p_order_id: orderId });
        if (error) throw error;
        await openAdminOrdersModal(importId, loteName);
    } catch (err) {
        showToast(translateError(err), 'error');
        await openAdminOrdersModal(importId, loteName);
    } finally {
        pendingReopenParams = null;
    }
}

// =========================================================
// WORKER HOME Y RESUMEN DE OPERARIO
// =========================================================
async function refreshWorkerHome() {
  hideMessage('workerError');
  hideMessage('workerOk');
  setStatus('workerStatus', 'Buscando órdenes disponibles...', 'var(--info)');

  if (appState.role === 'admin') $('btnWorkerGoAdmin').style.display = 'flex';
  else $('btnWorkerGoAdmin').style.display = 'none';

  try {
    const { data: ownOrderData, error: ownOrderErr } = await sb.from('orders').select('id, import_id').eq('status', 'in_progress').eq('taken_by', appState.user.id).limit(1);
    if (ownOrderErr) throw ownOrderErr;
    
    const ownInProgress = ownOrderData && ownOrderData.length > 0 ? ownOrderData[0] : null;
    appState.currentOwnInProgressOrderId = ownInProgress?.id || null;

    $('workerCurrentOrderCard').style.display = ownInProgress ? 'block' : 'none';

    const [{ data: orders, error: ordersErr }, { data: imports, error: importsErr }] = await Promise.all([
      sb.from('orders').select('id, status, import_id'),
      sb.from('imports').select('*').neq('status', 'failed').order('created_at', { ascending: true })
    ]);

    if (ordersErr) throw ordersErr;
    if (importsErr) throw importsErr;

    appState.workerImports = imports.map(imp => {
      const myOrders = orders.filter(o => o.import_id === imp.id);
      return calculateOrderFlags(imp, myOrders);
    });

    $('workerPending').textContent = appState.workerImports.filter(imp => imp._hasPending).length;
    $('workerInProgress').textContent = appState.workerImports.filter(imp => imp._hasInProgress).length;
    $('workerPrepared').textContent = appState.workerImports.filter(imp => imp._isCompleted).length;
    $('workerIssues').textContent = appState.workerImports.filter(imp => imp._hasIssues).length;
    $('workerOrdersTotal').textContent = appState.workerImports.length;

    filterWorkerOrders(appState.workerFilter);

  } catch (err) {
    console.error(err);
    showMessage('workerError', translateError(err), 'error');
    setStatus('workerStatus', 'Falló la carga de órdenes.', 'var(--err)');
  }
}

window.filterWorkerOrders = function(filterType) {
    appState.workerFilter = filterType;
    
    document.querySelectorAll('#view-worker-home .grid-stats .stat.clickable').forEach(el => el.classList.remove('active-filter'));
    const activeBox = document.getElementById(`filter-w-${filterType.replace(' ', '')}`);
    if(activeBox) activeBox.classList.add('active-filter');

    const filtered = appState.workerImports.filter(imp => {
        if (filterType === 'Todas') return true;
        if (filterType === 'Pendiente') return imp._hasPending;
        if (filterType === 'En Proceso') return imp._hasInProgress;
        if (filterType === 'Cerrada') return imp._isCompleted;
        if (filterType === 'Con Problemas') return imp._hasIssues;
        return false;
    });

    renderImports(filtered, 'workerBlocksContainer');
};

async function continueOwnOrder() {
  if (!appState.currentOwnInProgressOrderId) {
    showToast('No tenés un pedido en curso.', 'error');
    return;
  }

  if (appState.currentOrder && appState.currentOrder.id === appState.currentOwnInProgressOrderId) {
    showView('view-pick');
    renderCurrentOrder(true);
    return;
  }

  await loadOrderForPicking(appState.currentOwnInProgressOrderId);
}

// =========================================================
// REVISIÓN DE ÓRDENES (WORKER BATCH)
// =========================================================
window.loadWorkerBatch = async function(importId, blockName) {
  appState.currentViewedBatchId = importId;
  appState.currentViewedBatchName = blockName;

  showView('view-loading');
  setStatus('loadingStatus', 'Cargando lista de paquetes...');

  try {
    const { data, error } = await sb.from('orders')
      .select(`id, sale_id, display_id, buyer_name, status, issue_reason, order_items(qty)`)
      .eq('import_id', importId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    $('workerBatchTitle').textContent = `${blockName}`;
    
    const box = $('workerBatchOrdersList');
    if (!data || data.length === 0) {
      box.innerHTML = `<div class="small text-center">No hay paquetes en esta orden.</div>`;
    } else {
      box.innerHTML = data.map(order => {
        const items = Array.isArray(order.order_items) ? order.order_items : [];
        const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
        
        let actionBtn = '';
        if (order.status === 'pending' || order.status === 'taken') {
           actionBtn = `<button class="btn-info" onclick="forceTakeOrder('${order.id}')">Tomar este Pedido</button>`;
        } else if (order.status === 'prepared' || order.status === 'issue') {
           actionBtn = `<button class="btn-secondary" onclick="promptWorkerReopen('${order.id}')">Reabrir para Revisar</button>`;
        } else if (order.status === 'in_progress') {
           actionBtn = `<span class="small" style="color:var(--warn); font-weight:bold;">En preparación...</span>`;
        }
        
        let orderVisualStatus = orderStatusMap[order.status] || order.status;
        if (order.status === 'issue') orderVisualStatus = 'Problema';

        return `
          <div class="item-card">
            <div class="item-head">
              <div>
                <strong>${escapeHtml(order.display_id || order.sale_id)}</strong>
                <div class="small">Comprador: ${escapeHtml(order.buyer_name || '-')}</div>
                <div class="small">Unidades: ${totalQty}</div>
                ${order.issue_reason ? `<div class="small" style="color:var(--err)">Problema: ${escapeHtml(order.issue_reason)}</div>` : ''}
              </div>
              <div><span class="tag ${order.status}">${orderVisualStatus}</span></div>
            </div>
            <div class="item-actions" style="margin-top:12px;">
              ${actionBtn}
            </div>
          </div>
        `;
      }).join('');
    }

    showView('view-worker-batch');
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
    showView('view-worker-home');
  }
};

window.promptWorkerReopen = function(orderId) {
    pendingReopenParams = { orderId };
    openModal('#modal-reopen-confirm');
};

async function workerReopenOrder() {
  if (!pendingReopenParams) return;
  const orderId = pendingReopenParams.orderId;
  closeModal('#modal-reopen-confirm');

  if (appState.currentOwnInProgressOrderId) {
      showToast("Ya tenés otro pedido en curso. Cerrá o liberá el actual.", "error");
      pendingReopenParams = null;
      return;
  }

  showView('view-loading');
  setStatus('loadingStatus', 'Reabriendo pedido...');
  try {
    await ensureValidSession();
    const { error } = await sb.rpc('reopen_order', { p_order_id: orderId });
    if (error) throw error;
    
    const { data: takenOrder, error: takeError } = await sb.rpc('take_order', { p_order_id: orderId });
    if (takeError) throw takeError;
    
    appState.currentOwnInProgressOrderId = takenOrder.id;
    await loadOrderForPicking(takenOrder.id);
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
    showView('view-worker-home');
    refreshWorkerHome();
  } finally {
      pendingReopenParams = null;
  }
}

window.forceTakeOrder = async function(orderId) {
  if (appState.currentOwnInProgressOrderId || appState.isTakingOrder) {
      showToast("Ya tenés un pedido en curso o procesando.", "error");
      return;
  }
  
  appState.isTakingOrder = true;
  showView('view-loading');
  setStatus('loadingStatus', 'Tomando pedido...');
  
  try {
    await ensureValidSession();
    const { data: takenOrder, error: takeError } = await sb.rpc('take_order', { p_order_id: orderId });
    if (takeError) {
        showToast("Ese pedido ya fue tomado por otro operario.", "warn");
        showView('view-worker-batch');
        if(appState.currentViewedBatchId) loadWorkerBatch(appState.currentViewedBatchId, appState.currentViewedBatchName);
        else refreshWorkerHome();
        return;
    }
    
    appState.currentOwnInProgressOrderId = takenOrder.id;
    await loadOrderForPicking(takenOrder.id);
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
    showView('view-worker-home');
    refreshWorkerHome();
  } finally {
      appState.isTakingOrder = false;
  }
};

// =========================================================
// AUTO-AVANCE (CINTA DE PRODUCCIÓN)
// =========================================================
async function proceedToNextOrHome(importId) {
  try {
    const { data, error } = await sb.from('orders').select('id').eq('status', 'pending').eq('import_id', importId).order('created_at', { ascending: true }).limit(1);
    if (error) throw error;

    const target = (data || [])[0];

    if (!target) {
      appState.currentOrder = null;
      showView('view-worker-home');
      showToast('¡Orden de trabajo finalizada!', 'ok');
      await refreshWorkerHome();
      return;
    }

    const { data: takenOrder, error: takeError } = await sb.rpc('take_order', { p_order_id: target.id });
    if (takeError) throw takeError;

    appState.currentOwnInProgressOrderId = takenOrder.id;
    await loadOrderForPicking(takenOrder.id);
  } catch (err) {
    console.error(err);
    appState.currentOrder = null;
    showView('view-worker-home');
    await refreshWorkerHome();
  }
}

window.takeNextFromBlock = async function(importId) {
  if (appState.currentOwnInProgressOrderId || appState.isTakingOrder) {
      showToast("Ya tenés un pedido en curso o procesando.", "error");
      if(appState.currentOwnInProgressOrderId) await loadOrderForPicking(appState.currentOwnInProgressOrderId);
      return;
  }

  appState.isTakingOrder = true;
  hideMessage('workerError');
  hideMessage('workerOk');
  setStatus('workerStatus', 'Buscando siguiente pedido...', 'var(--info)');

  try {
    await ensureValidSession();
    
    const { data, error } = await sb.from('orders').select('id').eq('status', 'pending').eq('import_id', importId).order('created_at', { ascending: true }).limit(1);
    if (error) throw error;

    const target = (data || [])[0];
    if (!target) throw new Error('No quedan pedidos pendientes en esta orden.');

    const { data: takenOrder, error: takeError } = await sb.rpc('take_order', { p_order_id: target.id });
    if (takeError) {
        showToast("El pedido fue tomado por otro compañero. Buscando otro...", "info");
        await refreshWorkerHome();
        return;
    }

    appState.currentOwnInProgressOrderId = takenOrder.id;
    await loadOrderForPicking(takenOrder.id);
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
    setStatus('workerStatus', 'No se pudo tomar el pedido.', 'var(--err)');
    await refreshWorkerHome();
  } finally {
     appState.isTakingOrder = false;
  }
};

// =========================================================
// PICK VIEW 
// =========================================================
async function loadOrderForPicking(orderId) {
  showView('view-loading');
  setStatus('loadingStatus', 'Cargando pedido...');

  try {
    const { data, error } = await sb.from('orders').select(`id, import_id, sale_id, display_id, buyer_name, status, taken_by, taken_at, prepared_at, issue_reason, issue_note, order_items (id, title, qty, sku, variant, pub_id, checked, checked_at)`).eq('id', orderId).single();
    if (error) throw error;

    appState.currentOrder = data;

    // MAGIA LOCAL: Recuperamos los tildes si la app se había cerrado o refrescado
    appState.currentOrder.order_items = loadDraftLocal(data.id, data.order_items);

    if (appState.currentOrder.import_id) {
      try {
        const { data: batchOrders } = await sb.from('orders').select('status').eq('import_id', appState.currentOrder.import_id);
        if (batchOrders) {
          const total = batchOrders.length;
          const done = batchOrders.filter(o => o.status === 'prepared' || o.status === 'issue').length;
          appState.currentOrder.batchProgress = `${done} de ${total} procesados`;
        }
      } catch (e) { console.error('Error progreso:', e); }
    }

    renderCurrentOrder(true); 
    showView('view-pick');
  } catch (err) {
    console.error(err);
    if (appState.role === 'admin') {
      showView('view-admin');
      showToast(translateError(err), 'error');
    } else {
      showView('view-worker-home');
      showToast(translateError(err), 'error');
    }
  }
}

function renderCurrentOrder(fullRedraw = false) {
  const order = appState.currentOrder;
  if (!order) return;

  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const totalQty = items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
  const checkedCount = items.filter(i => i.checked).length;
  const remainingCount = items.length - checkedCount;

  if (fullRedraw) {
      $('pickBuyer').textContent = order.buyer_name || '-';
      $('pickSaleId').textContent = order.display_id || order.sale_id || '-';
      $('pickQty').textContent = totalQty;
      
      const badge = $('pickProgressBadge');
      if (order.batchProgress) {
          badge.innerHTML = `&#128230; ${order.batchProgress}`;
          badge.style.display = 'inline-block';
      } else {
          badge.style.display = 'none';
      }

      $('pickTopStatus').textContent = `Preparando`;
      $('pickTopStatus').style.color = 'var(--text)';

      const box = $('pickItemsContainer');

      if (!items.length) {
        box.innerHTML = `<div class="small text-center" style="padding:15px;">Este pedido no tiene items.</div>`;
      } else {
        box.innerHTML = items.map(item => {
          const url = getMlUrl(item.pub_id);
          const idDisplay = url 
            ? `<a href="${url}" target="_blank" style="color: var(--info); text-decoration: none; font-weight: bold; white-space: nowrap;">${escapeHtml(item.pub_id)}&nbsp;🔗</a>`
            : `<strong>${escapeHtml(item.pub_id || '-')}</strong>`;
            
          return `
            <div class="pick-item-card ${item.checked ? 'checked' : ''}">
              <div class="item-header-row">
                <div class="check-container">
                  <input type="checkbox" id="chk_${item.id}" class="item-check" ${item.checked ? 'checked' : ''} onchange="toggleOrderItem('${item.id}', this.checked)" />
                </div>
                <div class="product-title">${escapeHtml(item.title || 'Producto')}</div>
                <div class="item-qty">Cant: ${Number(item.qty) || 0}</div>
              </div>
              
              <div class="detail-row">
                <span class="detail-label">Variante:</span>
                <span class="detail-value variant-text">${escapeHtml(item.variant || '-')}</span>
              </div>
              
              <div class="detail-row" style="border-bottom:none;">
                <span class="detail-label">Pub ID:</span>
                <span class="detail-value">${idDisplay}</span>
              </div>
            </div>
          `;
        }).join('');
      }
  }

  const btnComplete = $('btnCompleteOrder');
  
  const isReadyToComplete = (items.length > 0 && remainingCount === 0);
  
  btnComplete.disabled = !isReadyToComplete || appState.isCompletingOrder;
  
  if (appState.isCompletingOrder) {
      btnComplete.textContent = 'Cerrando...';
      $('pickTopStatus').textContent = `Guardando...`;
      $('pickTopStatus').style.color = 'var(--warn)';
  } else if (isReadyToComplete) {
      btnComplete.textContent = '✅ Cerrar Pedido';
      $('pickTopStatus').textContent = `Listo`;
      $('pickTopStatus').style.color = 'var(--ok)';
  } else {
      btnComplete.textContent = 'Tildá los productos...';
      $('pickTopStatus').textContent = `Preparando`;
      $('pickTopStatus').style.color = 'var(--text)';
  }
}

// 💥 PURO OFFLINE FIRST: SOLO MEMORIA LOCAL 💥
window.toggleOrderItem = function(itemId, checked) {
  const item = (appState.currentOrder?.order_items || []).find(i => i.id === itemId);
  if (!item) return;

  item.checked = checked;
  item.checked_at = checked ? new Date().toISOString() : null;
  
  // Guardamos el estado en el teléfono al instante
  saveDraftLocal(appState.currentOrder.id, appState.currentOrder.order_items);

  const checkbox = document.getElementById(`chk_${itemId}`);
  if (checkbox) {
      const card = checkbox.closest('.pick-item-card');
      if (card) {
          if (checked) card.classList.add('checked');
          else card.classList.remove('checked');
      }
  }
  
  renderCurrentOrder(false); 
};

// 💥 CIERRE DE PEDIDO: EN UN SOLO VIAJE (BULK) 💥
async function completeCurrentOrder() {
  if (!appState.currentOrder || appState.isCompletingOrder) return;

  appState.isCompletingOrder = true;
  renderCurrentOrder(false); 

  const currentImportId = appState.currentOrder.import_id;
  const orderId = appState.currentOrder.id;

  try {
    await ensureValidSession();
    
    // Filtramos solo los IDs de los productos que el operario tildó
    const items = appState.currentOrder.order_items || [];
    const checkedItemIds = items.filter(i => i.checked).map(i => i.id);
    
    // Mandamos 1 ÚNICA PETICIÓN con todos los datos
    const { error } = await sb.rpc('complete_order_bulk', { 
        p_order_id: orderId, 
        p_checked_item_ids: checkedItemIds 
    });
    
    if (error) throw error;

    // Limpiamos la memoria local porque ya se confirmó
    clearDraftLocal(orderId);
    appState.currentOwnInProgressOrderId = null;
    await proceedToNextOrHome(currentImportId);
    
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
    $('pickTopStatus').textContent = 'Error al cerrar';
    $('pickTopStatus').style.color = 'var(--danger)';
  } finally {
    appState.isCompletingOrder = false;
    if ($('view-pick').classList.contains('active')) renderCurrentOrder(false);
  }
}

// 💥 REPORTAR PROBLEMA Y LIBERAR 💥
function promptReleaseOrder() {
    if (!appState.currentOrder || appState.isReleasingOrder) return;
    openModal('#modal-release-confirm');
}

async function executeReleaseOrder() {
  closeModal('#modal-release-confirm');
  appState.isReleasingOrder = true;
  showView('view-loading');
  setStatus('loadingStatus', 'Saltando paquete...');
  
  try {
    await ensureValidSession();
    const { error } = await sb.rpc('release_order', { p_order_id: appState.currentOrder.id });
    if (error) throw error;

    clearDraftLocal(appState.currentOrder.id);
    appState.currentOwnInProgressOrderId = null;
    appState.currentOrder = null;

    showView('view-worker-home');
    showToast('Paquete devuelto a la lista.', 'info');
    await refreshWorkerHome();
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error'); 
    showView('view-pick'); 
  } finally {
      appState.isReleasingOrder = false;
  }
}

async function reportCurrentIssue() {
  if (!appState.currentOrder || appState.isReportingIssue) return;
  
  const reason = $('issueReason').value;
  const note = $('issueNote').value.trim();
  const currentImportId = appState.currentOrder.import_id;
  const orderId = appState.currentOrder.id;

  appState.isReportingIssue = true;
  closeModal('#modal-overlay');
  
  try {
    await ensureValidSession();
    const { error } = await sb.rpc('report_order_issue', {
      p_order_id: orderId, p_issue_reason: reason, p_issue_note: note || null
    });
    if (error) throw error;

    clearDraftLocal(orderId);
    appState.currentOwnInProgressOrderId = null;
    $('issueNote').value = '';
    
    await proceedToNextOrHome(currentImportId);
  } catch (err) {
    console.error(err);
    showToast(translateError(err), 'error');
  } finally {
      appState.isReportingIssue = false;
  }
}

async function backToPanel() {
  showView('view-worker-home');
  await refreshWorkerHome();
}

// =========================================================
// ACCIONES ADMINISTRATIVAS (BORRADO SEGURO)
// =========================================================
window.deleteImportAdmin = async function(importId) {
    if (!confirm('¿Estás seguro de que querés ELIMINAR esta orden de trabajo completa? Esta acción no se puede deshacer.')) return;
    
    showView('view-loading');
    setStatus('loadingStatus', 'Eliminando orden...');
    try {
        await ensureValidSession();
        const { error } = await sb.rpc('delete_import', { p_import_id: importId });
        if (error) throw error;
        showToast('Orden eliminada correctamente', 'ok');
    } catch (err) {
        showToast(translateError(err), 'error');
    } finally {
        showView('view-admin');
        await refreshAdminPanel();
    }
};

window.deleteOrderAdmin = async function(orderId, importId, loteName) {
    if (!confirm('¿Estás seguro de que querés eliminar este pedido específico? Esta acción no se puede deshacer.')) return;
    
    try {
        await ensureValidSession();
        const { error } = await sb.rpc('delete_order', { p_order_id: orderId });
        if (error) throw error;
        showToast('Pedido eliminado', 'ok');
        await openAdminOrdersModal(importId, loteName); 
        refreshAdminPanel(); 
    } catch (err) {
        showToast(translateError(err), 'error');
    }
};

// =========================================================
// EVENTS 
// =========================================================
function bindEvents() {
  const setClick = (id, handler) => {
      const el = $(id);
      if(el) el.onclick = handler;
  };

  setClick('btnLogin', login);
  const loginPass = $('loginPassword');
  if(loginPass) loginPass.onkeydown = (e) => { if (e.key === 'Enter') login(); };
  
  setClick('btnAdminLogout', performLogout);
  setClick('btnWorkerLogout', performLogout);
  setClick('btnAdminRefresh', refreshAdminPanel);
  setClick('btnWorkerRefresh', refreshWorkerHome);
  
  setClick('btnAdminManage', () => { resetImportSelection(); showView('view-admin-manage'); });
  setClick('btnBackFromManage', () => { showView('view-admin'); refreshAdminPanel(); });
  
  setClick('btnAdminGoWorker', async () => { showView('view-worker-home'); await refreshWorkerHome(); });
  setClick('btnWorkerGoAdmin', async () => { showView('view-admin'); await refreshAdminPanel(); });

  setClick('btnContinueOwnOrder', continueOwnOrder);
  setClick('btnBackToPanel', backToPanel);
  setClick('btnCompleteOrder', completeCurrentOrder);

  setClick('btnPromptRelease', promptReleaseOrder);
  setClick('btnConfirmRelease', executeReleaseOrder);
  setClick('btnCancelRelease', () => closeModal('#modal-release-confirm'));
  
  setClick('btnConfirmReopen', () => {
      if(appState.role === 'admin') adminReopenOrderModal();
      else workerReopenOrder();
  });
  setClick('btnCancelReopen', () => closeModal('#modal-reopen-confirm'));

  setClick('btnShowIssueModal', () => openModal('#modal-overlay'));
  setClick('btnCloseIssueModal', () => { closeModal('#modal-overlay'); $('issueNote').value = ''; });
  setClick('btnReportIssue', reportCurrentIssue);

  setClick('btnProcessImport', processVentasBlock);
  setClick('btnClearImport', resetImportSelection);
  setClick('btnProcessCatalog', processCatalogImport);

  const vFile = $('ventasFile');
  if(vFile) vFile.onchange = (e) => { appState.selectedVentasFile = e.target.files?.[0] || null; $('ventasFileInfo').textContent = fileInfo(appState.selectedVentasFile); };
  
  const pFile = $('publicacionesFile');
  if(pFile) pFile.onchange = (e) => { appState.selectedPublicacionesFile = e.target.files?.[0] || null; $('publicacionesFileInfo').textContent = fileInfo(appState.selectedPublicacionesFile); };

  setClick('btnCloseAdminOrdersModal', () => closeModal('#admin-orders-modal'));

  if (!window.authListenerAttached) {
      sb.auth.onAuthStateChange(async (_event, session) => {
        appState.user = session?.user || null;
        if (!appState.user) {
          appState.role = null; appState.currentOrder = null; appState.currentOwnInProgressOrderId = null;
          showView('view-login');
          return;
        }
        if (!appState.isBootstrapping) {
            try { appState.role = await getMyRole(); } catch (_) { appState.role = null; }
        }
      });
      window.authListenerAttached = true;
  }
}

async function start() {
  try {
    if (!window.supabase) {
       showToast("ATENCIÓN: El navegador bloqueó Supabase.", "error");
       setStatus('loadingStatus', 'Librería bloqueada', 'var(--err)');
       return;
    }
    initSupabase();
    bindEvents();
    await bootstrapSession();
  } catch (err) {
    console.error(err);
    showToast("Error de arranque: " + translateError(err), "error");
    showView('view-login');
    showMessage('loginError', translateError(err), 'error');
  }
}

start();