// ─── GADNIC COMPARADOR · APP ───────────────────────────────────────────────────
const APP = {
  state: {
    section:   'catalogo',
    catTab:    'robot',
    wizard:    null,   // active comparison wizard state
    editProd:  null,   // { catId, product } being edited
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════
  init() {
    this.checkSetup();
    this.bindNav();
    this.render();
  },

  checkSetup() {
    const s = DB.getSettings();
    if (!s.geminiKey) {
      // Show setup banner
      document.getElementById('setup-banner').style.display = 'flex';
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NAV
  // ═══════════════════════════════════════════════════════════════════════════
  bindNav() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => this.go(el.dataset.nav));
    });
  },

  go(section) {
    this.state.section = section;
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === section);
    });
    this.render();
  },

  render() {
    const sections = ['catalogo','nueva','indice','config'];
    sections.forEach(s => {
      document.getElementById(`sec-${s}`).style.display =
        s === this.state.section ? 'block' : 'none';
    });

    switch (this.state.section) {
      case 'catalogo': this.renderCatalog(); break;
      case 'nueva':    this.renderWizard();  break;
      case 'indice':   this.renderIndex();   break;
      case 'config':   this.renderConfig();  break;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATALOG
  // ═══════════════════════════════════════════════════════════════════════════
  renderCatalog() {
    const catId = this.state.catTab;
    const cat   = CONFIG.categorias[catId];
    const prods = DB.getCatalog(catId);

    // Tabs
    document.getElementById('cat-tabs').innerHTML = Object.values(CONFIG.categorias).map(c => `
      <button class="tab-btn ${c.id === catId ? 'active' : ''}" onclick="APP.setCatTab('${c.id}')">
        ${c.emoji} ${c.nombre}
        <span class="tab-count">${DB.getCatalog(c.id).length}</span>
      </button>`).join('');

    // Table
    const rows = prods.length
      ? prods.map(p => `
          <tr>
            <td><span class="sku-text">${p.sku || '–'}</span></td>
            <td><strong>${p.nombre || '–'}</strong></td>
            <td><span class="nivel-pill">${p.nivel || '–'}</span></td>
            <td>${p.pvp_ars ? '$' + Number(p.pvp_ars).toLocaleString('es-AR') : '–'}</td>
            <td>${p.fob_usd ? 'USD ' + p.fob_usd : '–'}</td>
            <td>${p.rentabilidad ? p.rentabilidad + '%' : '<span class="nd">Sin costear</span>'}</td>
            <td><span class="fuente-tag">${p.fuente || '–'}</span></td>
            <td class="actions-cell">
              <button class="btn-icon" onclick="APP.editProduct('${catId}','${p.id}')" title="Editar">✏️</button>
              <button class="btn-icon btn-del" onclick="APP.deleteProduct('${catId}','${p.id}')" title="Eliminar">🗑</button>
            </td>
          </tr>`)
        .join('')
      : `<tr><td colspan="8" class="empty-row">Sin productos. <button class="link-btn" onclick="APP.openProductModal('${catId}')">Agregar el primero →</button></td></tr>`;

    document.getElementById('cat-content').innerHTML = `
      <div class="cat-toolbar">
        <button class="btn-primary" onclick="APP.openProductModal('${catId}')">+ Agregar producto</button>
        <button class="btn-ghost" onclick="APP.syncFromSheets('${catId}')">↓ Sincronizar desde Sheets</button>
        <span class="count-label">${prods.length} productos en catálogo</span>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>SKU</th><th>Nombre</th><th>Nivel</th>
              <th>PVP ARS</th><th>FOB USD</th><th>Rentabilidad</th>
              <th>Fuente</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  setCatTab(catId) {
    this.state.catTab = catId;
    this.renderCatalog();
  },

  deleteProduct(catId, id) {
    if (!confirm('¿Eliminar este producto del catálogo?')) return;
    DB.deleteProduct(catId, id);
    this.renderCatalog();
  },

  editProduct(catId, id) {
    const prods = DB.getCatalog(catId);
    const prod  = prods.find(p => p.id === id);
    if (prod) this.openProductModal(catId, prod);
  },

  async syncFromSheets(catId) {
    const cat = CONFIG.categorias[catId];
    const s   = DB.getSettings();
    const sheetId = s.sheetId || CONFIG.sheetId;

    this.showToast('Sincronizando desde Sheets…', 'info');
    const rows = await DB.loadSheetTab(sheetId, cat.sheetName);

    if (!rows) {
      this.showToast('Error al conectar con Sheets. Verificá que el Sheet esté público.', 'error');
      return;
    }
    if (!rows.length) {
      this.showToast('La pestaña está vacía. Cargá datos en el Sheet primero.', 'warn');
      return;
    }

    // Merge: update existing by SKU, add new
    const existing = DB.getCatalog(catId);
    let added = 0, updated = 0;

    for (const row of rows) {
      if (!row['SKU'] && !row['Nombre']) continue;
      const prod = DB.sheetRowToProduct(row, catId);
      const ex   = existing.find(p => p.sku === prod.sku);
      if (ex) {
        DB.updateProduct(catId, ex.id, prod);
        updated++;
      } else {
        DB.addProduct(catId, prod);
        added++;
      }
    }

    this.showToast(`Sincronizado: ${added} nuevos, ${updated} actualizados.`, 'success');
    this.renderCatalog();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCT MODAL (Add / Edit)
  // ═══════════════════════════════════════════════════════════════════════════
  openProductModal(catId, product = null) {
    const cat    = CONFIG.categorias[catId];
    const isEdit = !!product;
    const p      = product || {};

    const camposHTML = cat.campos.map(f => {
      const val = p[f.id] ?? '';
      if (f.tipo === 'booleano') {
        return `
          <div class="form-group">
            <label>${f.label} ${f.req ? '<span class="req">*</span>' : ''}</label>
            <select name="${f.id}">
              <option value="" ${!val && val !== false ? 'selected' : ''}>–</option>
              <option value="true"  ${val === true  || val === 'true'  ? 'selected' : ''}>Sí</option>
              <option value="false" ${val === false || val === 'false' ? 'selected' : ''}>No</option>
            </select>
          </div>`;
      }
      return `
        <div class="form-group">
          <label>${f.label}${f.unidad ? ` (${f.unidad})` : ''} ${f.req ? '<span class="req">*</span>' : ''}</label>
          <input type="${f.tipo === 'numero' ? 'number' : 'text'}" name="${f.id}" value="${val}" placeholder="${f.req ? 'Requerido' : 'Opcional'}">
        </div>`;
    }).join('');

    const modalHTML = `
      <div class="modal-overlay" id="prod-modal">
        <div class="modal-box modal-lg">
          <div class="modal-head">
            <h2>${isEdit ? 'Editar' : 'Agregar'} Producto — ${cat.nombre}</h2>
            <button class="modal-close" onclick="APP.closeModal('prod-modal')">✕</button>
          </div>
          <div class="modal-body">
            <form id="prod-form">
              <div class="form-section">
                <h3>Carga rápida con IA</h3>
                <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Pegá el link de Bidcom y la IA completa los campos automáticamente. Después revisás y corregís lo que haga falta.</p>
                <div style="display:flex;gap:8px;align-items:flex-end">
                  <div class="form-group" style="flex:1">
                    <label>Link Bidcom</label>
                    <input type="text" id="modal-ia-url" placeholder="https://bidcom.com.ar/producto/...">
                  </div>
                  <button type="button" class="btn-ai" style="margin-bottom:1px" onclick="APP.extractToModal('${catId}')">✨ Extraer con IA</button>
                </div>
                <div id="modal-ia-status" style="display:none;margin-top:8px;font-size:12px;padding:8px 12px;border-radius:6px"></div>
              </div>

              <div class="form-section">
                <h3>Datos generales</h3>
                <div class="form-grid-2">
                  <div class="form-group">
                    <label>SKU <span class="req">*</span></label>
                    <input type="text" name="sku" value="${p.sku||''}" placeholder="ej. ROB00515">
                  </div>
                  <div class="form-group">
                    <label>Nombre <span class="req">*</span></label>
                    <input type="text" name="nombre" value="${p.nombre||''}" placeholder="Nombre del producto">
                  </div>
                  <div class="form-group">
                    <label>Nivel</label>
                    <select name="nivel">
                      <option value="">–</option>
                      ${cat.niveles.map(n => `<option ${p.nivel===n?'selected':''}>${n}</option>`).join('')}
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Fuente</label>
                    <input type="text" name="fuente" value="${p.fuente||''}" placeholder="https://bidcom.com.ar/...">
                  </div>
                  <div class="form-group">
                    <label>Imagen URL</label>
                    <input type="text" name="imagen_url" value="${p.imagen_url||''}" placeholder="https://...jpg">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h3>Rentabilidad</h3>
                <div class="form-grid-3">
                  <div class="form-group">
                    <label>FOB USD</label>
                    <input type="number" step="0.01" name="fob_usd" value="${p.fob_usd||''}" placeholder="0.00">
                  </div>
                  <div class="form-group">
                    <label>PVP ARS</label>
                    <input type="number" name="pvp_ars" value="${p.pvp_ars||''}" placeholder="0">
                  </div>
                  <div class="form-group">
                    <label>Rentabilidad %</label>
                    <input type="number" step="0.1" name="rentabilidad" value="${p.rentabilidad||''}" placeholder="0.0">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h3>Specs técnicas</h3>
                <div class="form-grid-2">${camposHTML}</div>
              </div>

              <div class="form-section">
                <label>Diferenciadores</label>
                <textarea name="diferenciadores" rows="3" placeholder="Diferenciadores únicos del producto…">${p.diferenciadores||''}</textarea>
              </div>
            </form>
          </div>
          <div class="modal-foot">
            <button class="btn-ghost" onclick="APP.closeModal('prod-modal')">Cancelar</button>
            <button class="btn-primary" onclick="APP.saveProduct('${catId}','${isEdit ? p.id : ''}')">
              ${isEdit ? 'Guardar cambios' : 'Agregar al catálogo'}
            </button>
          </div>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  },

  async extractToModal(catId) {
    const url = document.getElementById('modal-ia-url').value.trim();
    if (!url) { this.showToast('Pegá un link primero.', 'warn'); return; }

    const status = document.getElementById('modal-ia-status');
    status.style.display = 'block';
    status.style.background = '#1e2a3a';
    status.style.color = '#93c5fd';
    status.textContent = '✨ Extrayendo specs con IA…';

    try {
      const data = await GEMINI.extractFromURL(url, catId);
      const form = document.getElementById('prod-form');

      // Fill each form field with extracted data
      for (const [key, val] of Object.entries(data)) {
        const el = form.querySelector(`[name="${key}"]`);
        if (!el || val == null) continue;
        if (el.tagName === 'SELECT') {
          // For boolean selects
          const opt = el.querySelector(`option[value="${val}"]`) ||
                      el.querySelector(`option[value="${String(val).toLowerCase()}"]`);
          if (opt) opt.selected = true;
        } else {
          el.value = val;
        }
      }

      status.style.background = '#0f2d1a';
      status.style.color = '#6ee7b7';
      status.textContent = '✅ Specs cargadas. Revisá y corregí lo que haga falta.';
    } catch(e) {
      status.style.background = '#2d0f0f';
      status.style.color = '#fca5a5';
      status.textContent = '⚠ ' + e.message;
    }
  },

  saveProduct(catId, id) {
    const form = document.getElementById('prod-form');
    const data = Object.fromEntries(new FormData(form).entries());

    // Basic validation
    if (!data.sku && !data.nombre) {
      this.showToast('SKU o Nombre son obligatorios.', 'error'); return;
    }
    // Convert booleans and numbers
    const cat = CONFIG.categorias[catId];
    for (const f of cat.campos) {
      if (f.tipo === 'booleano' && data[f.id] !== '') data[f.id] = data[f.id] === 'true';
      if (f.tipo === 'numero'  && data[f.id] !== '') data[f.id] = parseFloat(data[f.id]) || data[f.id];
    }

    if (id) {
      DB.updateProduct(catId, id, data);
      this.showToast('Producto actualizado.', 'success');
    } else {
      DB.addProduct(catId, data);
      this.showToast('Producto agregado al catálogo.', 'success');
    }

    this.closeModal('prod-modal');
    this.renderCatalog();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARISON WIZARD
  // ═══════════════════════════════════════════════════════════════════════════
  renderWizard() {
    if (!this.state.wizard) {
      this.state.wizard = { step: 1, catId: null, tipo: null, propios: [], externos: [], analisis: null, nombre: '', formato: 'tarjetas' };
    }
    this['renderWizardStep' + this.state.wizard.step]();
  },

  resetWizard() {
    this.state.wizard = null;
    this.renderWizard();
  },

  wizardNext() { this.state.wizard.step++; this.renderWizard(); },
  wizardBack() { this.state.wizard.step--; this.renderWizard(); },

  // Step 1: Select category
  renderWizardStep1() {
    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Nueva Comparativa</h2>
          <div class="wizard-steps">${this._stepsDots(1)}</div>
        </div>
        <h3 class="wizard-q">¿Qué categoría querés comparar?</h3>
        <div class="choice-grid">
          ${Object.values(CONFIG.categorias).map(c => `
            <div class="choice-card ${this.state.wizard.catId===c.id?'selected':''}" onclick="APP.selectCat('${c.id}')">
              <div class="choice-emoji">${c.emoji}</div>
              <div class="choice-label">${c.nombre}</div>
              <div class="choice-count">${DB.getCatalog(c.id).length} en catálogo</div>
            </div>`).join('')}
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.resetWizard()">Cancelar</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${!this.state.wizard.catId?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  selectCat(catId) {
    this.state.wizard.catId = catId;
    this.renderWizardStep1();
  },

  // Step 2: Select type
  renderWizardStep2() {
    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Nueva Comparativa — ${CONFIG.categorias[this.state.wizard.catId].emoji} ${CONFIG.categorias[this.state.wizard.catId].nombre}</h2>
          <div class="wizard-steps">${this._stepsDots(2)}</div>
        </div>
        <h3 class="wizard-q">¿Qué tipo de comparativa?</h3>
        <div class="choice-grid">
          ${CONFIG.tipos.map(t => `
            <div class="choice-card ${this.state.wizard.tipo===t.id?'selected':''}" onclick="APP.selectTipo('${t.id}')">
              <div class="choice-emoji">${t.icon}</div>
              <div class="choice-label">${t.label}</div>
              <div class="choice-desc">${t.desc}</div>
            </div>`).join('')}
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${!this.state.wizard.tipo?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  selectTipo(tipo) {
    this.state.wizard.tipo = tipo;
    this.renderWizardStep2();
  },

  // Step 3: Select own products (not needed for 'mixto')
  renderWizardStep3() {
    const { catId, tipo } = this.state.wizard;
    if (tipo === 'mixto') { this.wizardNext(); return; }

    const cat   = CONFIG.categorias[catId];
    const prods = DB.getCatalog(catId);

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Seleccioná tus productos</h2>
          <div class="wizard-steps">${this._stepsDots(3)}</div>
        </div>
        <h3 class="wizard-q">¿Qué modelos propios incluís en la comparativa?</h3>
        ${prods.length === 0
          ? `<div class="empty-wizard">No hay productos en el catálogo de ${cat.nombre}.
              <br><button class="link-btn" onclick="APP.go(\'catalogo\')">→ Ir al catálogo a agregar</button></div>`
          : `<div class="prod-check-list" id="propios-list">
              ${prods.map(p => {
                const sel = !!this.state.wizard.propios.find(x => x.id === p.id);
                return `<div class="prod-check-item ${sel ? 'checked' : ''}" data-id="${p.id}" onclick="APP.togglePropio('${p.id}', this)">
                  <div class="pci-check">${sel ? '☑' : '☐'}</div>
                  <div class="pci-info">
                    <strong>${p.nombre}</strong>
                    <span>${p.sku || ''} · ${p.nivel || ''} · ${p.pvp_ars ? '$'+Number(p.pvp_ars).toLocaleString('es-AR') : 'Sin precio'}</span>
                  </div>
                  ${p.imagen_url ? `<img src="${p.imagen_url}" class="pci-img">` : ''}
                </div>`;
              }).join('')}
            </div>`}
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" id="btn-propios-next" onclick="APP.wizardNext()" ${this.state.wizard.propios.length===0?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  togglePropio(prodId, el) {
    const { catId } = this.state.wizard;
    const prods     = DB.getCatalog(catId);
    const prod      = prods.find(p => p.id === prodId);
    if (!prod) return;
    const i = this.state.wizard.propios.findIndex(p => p.id === prodId);
    if (i >= 0) {
      this.state.wizard.propios.splice(i, 1);
      el.classList.remove('checked');
      el.querySelector('.pci-check').textContent = '☐';
    } else {
      this.state.wizard.propios.push(prod);
      el.classList.add('checked');
      el.querySelector('.pci-check').textContent = '☑';
    }
    const btn = document.getElementById('btn-propios-next');
    if (btn) btn.disabled = this.state.wizard.propios.length === 0;
  },

  // Step 4: Add external products
  renderWizardStep4() {
    const { catId, tipo } = this.state.wizard;
    const cat   = CONFIG.categorias[catId];
    const externos = this.state.wizard.externos;

    const renderExtCard = (p, i) => `
      <div class="ext-card">
        <div class="ext-card-head">
          <span class="ext-num">#${i+1}</span>
          <input type="text" class="ext-nombre" value="${p.nombre||''}"
            placeholder="Nombre del producto"
            onchange="APP.updateExterno(${i},'nombre',this.value)">
          <button class="btn-icon btn-del" onclick="APP.removeExterno(${i})">✕</button>
        </div>
        <div class="ext-fields">
          <div class="form-row-3">
            <div class="form-group">
              <label>SKU / Modelo</label>
              <input type="text" value="${p.sku||''}" onchange="APP.updateExterno(${i},'sku',this.value)" placeholder="–">
            </div>
            <div class="form-group">
              <label>Precio ARS</label>
              <input type="number" value="${p.precio_ars||''}" onchange="APP.updateExterno(${i},'precio_ars',this.value)" placeholder="0">
            </div>
            <div class="form-group">
              <label>FOB USD</label>
              <input type="number" step="0.01" value="${p.fob_usd||''}" onchange="APP.updateExterno(${i},'fob_usd',this.value)" placeholder="0.00">
            </div>
          </div>
          <div class="form-row-2">
            <div class="form-group">
              <label>Imagen URL</label>
              <div class="img-url-row">
                <input type="text" value="${p.imagen_url||''}" onchange="APP.updateExterno(${i},'imagen_url',this.value)" placeholder="https://...jpg">
                ${p.imagen_url ? `<img src="${p.imagen_url}" class="img-preview">` : ''}
              </div>
            </div>
            <div class="form-group">
              <label>Fuente / URL</label>
              <div style="display:flex;gap:6px">
                <input type="text" value="${p.fuente||''}" onchange="APP.updateExterno(${i},'fuente',this.value)" placeholder="https://...">
                <button class="btn-ai" onclick="APP.extractFromURL(${i})" title="Extraer specs con IA">✨ IA</button>
              </div>
            </div>
          </div>
          <div class="specs-ext-grid">
            ${cat.campos.map(f => {
              const v = p[f.id] ?? '';
              if (f.tipo === 'booleano') return `
                <div class="form-group">
                  <label>${f.label} ${f.req?'<span class="req">*</span>':''}</label>
                  <select onchange="APP.updateExterno(${i},'${f.id}',this.value)">
                    <option value="" ${v===''?'selected':''}>–</option>
                    <option value="true"  ${v===true||v==='true' ?'selected':''}>Sí</option>
                    <option value="false" ${v===false||v==='false'?'selected':''}>No</option>
                  </select>
                </div>`;
              return `
                <div class="form-group">
                  <label>${f.label}${f.unidad?` (${f.unidad})`:''} ${f.req?'<span class="req">*</span>':''}</label>
                  <input type="${f.tipo==='numero'?'number':'text'}" value="${v}"
                    onchange="APP.updateExterno(${i},'${f.id}',this.value)"
                    placeholder="${p._ai_filled && !v ? '(IA pendiente)' : f.req?'Req':'Opt'}">
                </div>`;
            }).join('')}
          </div>
          <div class="form-group" style="margin-top:8px">
            <label>Diferenciadores</label>
            <textarea rows="2" onchange="APP.updateExterno(${i},'diferenciadores',this.value)" placeholder="Diferenciadores del producto externo…">${p.diferenciadores||''}</textarea>
          </div>
        </div>
      </div>`;

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Productos externos</h2>
          <div class="wizard-steps">${this._stepsDots(4)}</div>
        </div>
        <p class="wizard-hint">Cargá los productos con los que querés comparar. Pegá la URL y usá ✨ IA para extraer las specs automáticamente, o completá a mano.</p>
        <div id="externos-list">
          ${externos.length ? externos.map((p,i) => renderExtCard(p,i)).join('') : `<div class="empty-wizard">Agregá al menos un producto externo.</div>`}
        </div>
        <button class="btn-ghost btn-add-ext" onclick="APP.addExterno()">+ Agregar producto externo</button>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.wizardNext()" ${externos.length===0?'disabled':''}>Siguiente →</button>
        </div>
      </div>`;
  },

  addExterno() {
    this.state.wizard.externos.push({ nombre: '', _new: true });
    this.renderWizardStep4();
  },

  removeExterno(i) {
    this.state.wizard.externos.splice(i, 1);
    this.renderWizardStep4();
  },

  updateExterno(i, field, value) {
    this.state.wizard.externos[i][field] = value;
  },

  async extractFromURL(i) {
    const p     = this.state.wizard.externos[i];
    const url   = p.fuente;
    if (!url) { this.showToast('Ingresá una URL primero.', 'warn'); return; }
    this.showToast('Extrayendo specs con IA…', 'info');
    try {
      const extracted = await GEMINI.extractFromURL(url, this.state.wizard.catId);
      this.state.wizard.externos[i] = { ...p, ...extracted, fuente: url };
      this.renderWizardStep4();
      this.showToast('Specs extraídas. Revisá y corregí si hace falta.', 'success');
    } catch(e) {
      this.showToast('Error: ' + e.message, 'error');
    }
  },

  // Step 5: Generate comparison
  async renderWizardStep5() {
    const { catId, tipo, propios, externos, nombre } = this.state.wizard;
    const cat = CONFIG.categorias[catId];

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap">
        <div class="wizard-head">
          <h2>Generar comparativa</h2>
          <div class="wizard-steps">${this._stepsDots(5)}</div>
        </div>
        <div class="form-group" style="max-width:400px;margin-bottom:20px">
          <label>Nombre de la comparativa</label>
          <input type="text" id="comp-nombre" value="${nombre||''}" placeholder="ej. Aspiradoras Robot Mayo 2026"
            oninput="APP.state.wizard.nombre=this.value">
        </div>
        <div class="summary-box">
          <div class="sum-col">
            <h4>Propios (${propios.length})</h4>
            ${propios.map(p=>`<div class="sum-item">📦 ${p.nombre||p.sku}</div>`).join('')||'<em>Ninguno</em>'}
          </div>
          <div class="sum-col">
            <h4>Externos (${externos.length})</h4>
            ${externos.map(p=>`<div class="sum-item">🔍 ${p.nombre||p.fuente||'Sin nombre'}</div>`).join('')||'<em>Ninguno</em>'}
          </div>
        </div>
        <div id="gen-status" class="gen-status" style="display:none"></div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" id="btn-generate" onclick="APP.runGenerate()">
            ✨ Generar con IA
          </button>
          <button class="btn-ghost" onclick="APP.skipAnalysis()">Generar sin análisis IA →</button>
        </div>
      </div>`;
  },

  async runGenerate() {
    const { catId, tipo, propios, externos } = this.state.wizard;
    document.getElementById('btn-generate').disabled = true;
    const status = document.getElementById('gen-status');
    status.style.display = 'block';
    status.className = 'gen-status info';
    status.textContent = '✨ Analizando con IA…';

    try {
      const analisis = await GEMINI.analyzeComparativa(propios, externos, tipo, catId);
      this.state.wizard.analisis = analisis;
      status.className = 'gen-status success';
      status.textContent = '✅ Análisis listo. Pasando al preview…';
      setTimeout(() => this.wizardNext(), 800);
    } catch(e) {
      status.className = 'gen-status error';
      status.textContent = '⚠ ' + e.message;
      document.getElementById('btn-generate').disabled = false;
    }
  },

  skipAnalysis() {
    this.state.wizard.analisis = {};
    this.wizardNext();
  },

  // Step 6: Preview & Export
  renderWizardStep6() {
    const w   = this.state.wizard;
    const cat = CONFIG.categorias[w.catId];

    document.getElementById('sec-nueva').innerHTML = `
      <div class="wizard-wrap wizard-wide">
        <div class="wizard-head">
          <h2>Preview y exportar</h2>
          <div class="wizard-steps">${this._stepsDots(6)}</div>
        </div>
        <div class="export-toolbar">
          <div class="format-toggle">
            <button class="btn-format ${w.formato==='tarjetas'?'active':''}" onclick="APP.setFormato('tarjetas')">🃏 Tarjetas</button>
            <button class="btn-format ${w.formato==='tabla'?'active':''}" onclick="APP.setFormato('tabla')">📊 Tabla</button>
          </div>
          <button class="btn-primary" onclick="APP.exportComp()">⬇ Descargar HTML</button>
          <button class="btn-ghost" onclick="APP.saveAndFinish()">💾 Guardar en índice</button>
        </div>
        <div class="preview-frame-wrap">
          <iframe id="comp-preview" class="preview-frame"></iframe>
        </div>
        <div class="wizard-foot">
          <button class="btn-ghost" onclick="APP.wizardBack()">← Atrás</button>
          <button class="btn-primary" onclick="APP.saveAndFinish()">💾 Guardar y terminar</button>
        </div>
      </div>`;

    this._updatePreview();
  },

  setFormato(f) {
    this.state.wizard.formato = f;
    document.querySelectorAll('.btn-format').forEach(b => b.classList.remove('active'));
    document.querySelector(`.btn-format:${f==='tarjetas'?'first':'last'}-child`).classList.add('active');
    this._updatePreview();
  },

  _updatePreview() {
    const w    = this.state.wizard;
    const comp = { ...w, fecha: new Date().toISOString() };
    const html = EXPORT.generate(comp, w.formato);
    const iframe = document.getElementById('comp-preview');
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
  },

  exportComp() {
    const w    = this.state.wizard;
    const comp = { ...w, fecha: new Date().toISOString() };
    const html = EXPORT.generate(comp, w.formato);
    const cat  = CONFIG.categorias[w.catId];
    const name = (w.nombre || `comparativa_${cat.id}`).replace(/\s+/g,'_').toLowerCase();
    EXPORT.downloadHTML(html, `${name}_${w.formato}.html`);
    this.showToast('HTML descargado.', 'success');
  },

  saveAndFinish() {
    const w    = this.state.wizard;
    const comp = {
      catId:    w.catId,
      tipo:     w.tipo,
      nombre:   w.nombre || `Comparativa ${CONFIG.categorias[w.catId].nombre}`,
      propios:  w.propios,
      externos: w.externos,
      analisis: w.analisis,
      formato:  w.formato,
    };
    DB.saveComparativa(comp);
    this.showToast('Guardado en el índice.', 'success');
    this.state.wizard = null;
    this.go('indice');
  },

  _stepsDots(current) {
    const labels = ['Categoría','Tipo','Propios','Externos','Generar','Exportar'];
    return labels.map((l,i) => `
      <div class="step-dot ${i+1===current?'active':i+1<current?'done':''}">
        <div class="dot">${i+1<current?'✓':i+1}</div>
        <span>${l}</span>
      </div>`).join('');
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEX
  // ═══════════════════════════════════════════════════════════════════════════
  renderIndex() {
    const list = DB.getComparativas();
    const rows = list.length
      ? list.map(c => {
          const cat  = CONFIG.categorias[c.catId] || {};
          const tipo = CONFIG.tipos.find(t => t.id === c.tipo) || {};
          return `
            <tr>
              <td>${new Date(c.fecha).toLocaleDateString('es-AR')}</td>
              <td>${cat.emoji||''} ${cat.nombre||c.catId}</td>
              <td>${tipo.label||c.tipo}</td>
              <td><strong>${c.nombre}</strong></td>
              <td>${(c.propios||[]).length + (c.externos||[]).length} productos</td>
              <td class="actions-cell">
                <button class="btn-icon" onclick="APP.previewComp('${c.id}')" title="Ver">👁</button>
                <button class="btn-icon" onclick="APP.reexportComp('${c.id}','tarjetas')" title="HTML tarjetas">🃏</button>
                <button class="btn-icon" onclick="APP.reexportComp('${c.id}','tabla')" title="HTML tabla">📊</button>
                <button class="btn-icon btn-del" onclick="APP.deleteComp('${c.id}')" title="Eliminar">🗑</button>
              </td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="6" class="empty-row">Sin comparativas guardadas. <button class="link-btn" onclick="APP.go('nueva')">Crear la primera →</button></td></tr>`;

    document.getElementById('sec-indice').innerHTML = `
      <div class="sec-head">
        <h2>Índice de Comparativas</h2>
        <button class="btn-primary" onclick="APP.go('nueva')">+ Nueva comparativa</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>Fecha</th><th>Categoría</th><th>Tipo</th><th>Nombre</th><th>Productos</th><th>Acciones</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  previewComp(id) {
    const comp = DB.getComparativas().find(c => c.id === id);
    if (!comp) return;
    const html = EXPORT.generate(comp, comp.formato || 'tarjetas');
    const w    = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  },

  reexportComp(id, formato) {
    const comp = DB.getComparativas().find(c => c.id === id);
    if (!comp) return;
    const html = EXPORT.generate(comp, formato);
    const name = (comp.nombre||`comparativa_${id}`).replace(/\s+/g,'_').toLowerCase();
    EXPORT.downloadHTML(html, `${name}_${formato}.html`);
    this.showToast('HTML exportado.', 'success');
  },

  deleteComp(id) {
    if (!confirm('¿Eliminar esta comparativa del índice?')) return;
    DB.deleteComparativa(id);
    this.renderIndex();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  renderConfig() {
    const s = DB.getSettings();
    document.getElementById('sec-config').innerHTML = `
      <div class="config-wrap">
        <h2>Configuración</h2>

        <div class="config-section">
          <h3>🤖 Gemini API Key</h3>
          <p class="config-hint">Obtenela en <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a> → Get API Key</p>
          <div class="form-row-2">
            <div class="form-group">
              <input type="password" id="cfg-gemini" value="${s.geminiKey||''}" placeholder="AIza...">
            </div>
          </div>
        </div>

        <div class="config-section">
          <h3>📊 Google Sheet</h3>
          <p class="config-hint">ID de tu planilla Gadnic Comparador (ya configurado)</p>
          <div class="form-group">
            <input type="text" id="cfg-sheet" value="${s.sheetId||CONFIG.sheetId}" placeholder="ID del Sheet">
          </div>
          <a href="https://docs.google.com/spreadsheets/d/${s.sheetId||CONFIG.sheetId}/edit" target="_blank" class="link-btn">→ Abrir Sheet</a>
        </div>

        <div class="config-section">
          <h3>🏢 Empresa</h3>
          <div class="form-row-2">
            <div class="form-group">
              <label>Nombre empresa</label>
              <input type="text" id="cfg-empresa" value="${s.empresa||CONFIG.empresa}" placeholder="Gadnic">
            </div>
            <div class="form-group">
              <label>TC referencia (USD→ARS)</label>
              <input type="number" id="cfg-tc" value="${s.tc||''}" placeholder="1300">
            </div>
          </div>
        </div>

        <button class="btn-primary" onclick="APP.saveConfig()">Guardar configuración</button>

        <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
          <h3 style="margin-bottom:8px">💾 Backup completo</h3>
          <p class="config-hint" style="margin-bottom:12px">Exportá todo el catálogo, comparativas y configuración a un archivo JSON. Guardalo como respaldo — podés reimportarlo en cualquier momento o en otro navegador.</p>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn-primary" onclick="APP.exportAllJSON()">⬇ Exportar todo (JSON)</button>
            <button class="btn-ghost" onclick="document.getElementById('json-import-file').click()">📂 Importar backup</button>
            <input type="file" id="json-import-file" accept=".json" style="display:none" onchange="APP.importAllJSON(this)">
          </div>
          <div id="import-status" style="display:none;margin-top:10px;font-size:12px;padding:10px 14px;border-radius:6px"></div>
        </div>

        <div style="margin-top:24px;padding-top:24px;border-top:1px solid var(--border)">
          <h3 style="margin-bottom:12px">⚠ Zona de riesgo</h3>
          <button class="btn-danger" onclick="APP.clearAllData()">Borrar todos los datos locales</button>
        </div>
      </div>`;
  },

  saveConfig() {
    const settings = {
      geminiKey: document.getElementById('cfg-gemini').value.trim(),
      sheetId:   document.getElementById('cfg-sheet').value.trim(),
      empresa:   document.getElementById('cfg-empresa').value.trim(),
      tc:        parseFloat(document.getElementById('cfg-tc').value) || null,
    };
    DB.saveSettings(settings);
    if (settings.geminiKey) document.getElementById('setup-banner').style.display = 'none';
    this.showToast('Configuración guardada.', 'success');
  },

  exportAllJSON() {
    const data = DB.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a    = document.createElement('a');
    const fecha = new Date().toLocaleDateString('es-AR').replace(/\//g,'-');
    a.href     = URL.createObjectURL(blob);
    a.download = `gadnic-comparador-backup-${fecha}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    this.showToast('Backup exportado.', 'success');
  },

  importAllJSON(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const status = document.getElementById('import-status');
      status.style.display = 'block';
      try {
        const data = JSON.parse(e.target.result);
        DB.importAll(data);
        status.style.background = '#f0fdf4';
        status.style.color = '#166534';
        status.textContent = '✅ Backup importado correctamente. Recargando…';
        input.value = '';
        setTimeout(() => location.reload(), 1200);
      } catch(err) {
        status.style.background = '#fef2f2';
        status.style.color = '#991b1b';
        status.textContent = '⚠ Error: ' + err.message;
      }
    };
    reader.readAsText(file);
  },

  clearAllData() {
    if (!confirm('¿Borrar TODO? Catálogo, comparativas y configuración. Esto no se puede deshacer.')) return;
    localStorage.clear();
    location.reload();
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILS
  // ═══════════════════════════════════════════════════════════════════════════
  closeModal(id) {
    document.getElementById(id)?.remove();
  },

  showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.getElementById('toast-area').appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
  }
};

document.addEventListener('DOMContentLoaded', () => APP.init());
