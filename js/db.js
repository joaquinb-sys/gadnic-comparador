// ─── GADNIC COMPARADOR · DATA LAYER ───────────────────────────────────────────
const DB = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwflGG6FtVtOm-tLp4pxbKg8-DFhujTUx15qS4vH3ypU7gYUIfTznrqCFDhaIksQVh7/exec',
  _key: (k) => `gadnic_${k}`,

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings() {
    return JSON.parse(localStorage.getItem(this._key('settings')) || '{}');
  },
  saveSettings(s) {
    localStorage.setItem(this._key('settings'), JSON.stringify(s));
  },

  // ── Catalog ───────────────────────────────────────────────────────────────
  getCatalog(catId) {
    return JSON.parse(localStorage.getItem(this._key(`cat_${catId}`)) || '[]');
  },
  saveCatalog(catId, products) {
    localStorage.setItem(this._key(`cat_${catId}`), JSON.stringify(products));
  },
  addProduct(catId, product) {
    const list = this.getCatalog(catId);
    product.id = `${catId}_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
    product.fecha = new Date().toISOString();
    list.push(product);
    this.saveCatalog(catId, list);
    return product;
  },
  updateProduct(catId, id, data) {
    const list = this.getCatalog(catId);
    const i = list.findIndex(p => p.id === id);
    if (i >= 0) {
      list[i] = { ...list[i], ...data, fecha: new Date().toISOString() };
      this.saveCatalog(catId, list);
      return list[i];
    }
  },
  deleteProduct(catId, id) {
    const list = this.getCatalog(catId).filter(p => p.id !== id);
    this.saveCatalog(catId, list);
  },

  // ── Comparativas ──────────────────────────────────────────────────────────
  getComparativas() {
    return JSON.parse(localStorage.getItem(this._key('comparativas')) || '[]');
  },
  saveComparativa(comp) {
    const list = this.getComparativas();
    comp.id = `comp_${Date.now()}`;
    comp.fecha = new Date().toISOString();
    list.unshift(comp);
    localStorage.setItem(this._key('comparativas'), JSON.stringify(list));
    return comp;
  },
  deleteComparativa(id) {
    const list = this.getComparativas().filter(c => c.id !== id);
    localStorage.setItem(this._key('comparativas'), JSON.stringify(list));
  },
  updateComparativa(id, data) {
    const list = this.getComparativas();
    const i = list.findIndex(c => c.id === id);
    if (i >= 0) {
      list[i] = { ...list[i], ...data };
      localStorage.setItem(this._key('comparativas'), JSON.stringify(list));
    }
  },

  // ── Google Sheets Read (public sheet via gviz) ────────────────────────────
  async loadSheetTab(sheetId, sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
    try {
      const res  = await fetch(url);
      const text = await res.text();
      // Strip JSONP wrapper: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
      const raw  = text.replace(/^[^{]+/, '').replace(/\);?\s*$/, '');
      const json = JSON.parse(raw);
      if (!json.table || !json.table.rows) return [];
      const cols = json.table.cols.map(c => c.label || c.id);
      return json.table.rows
        .filter(r => r.c && r.c.some(c => c && c.v != null))
        .map(row => {
          const obj = {};
          row.c.forEach((cell, i) => {
            obj[cols[i]] = cell ? (cell.v ?? null) : null;
          });
          return obj;
        });
    } catch (e) {
      console.error('Sheets load error:', e);
      return null;
    }
  },

  // Map Sheet row → product using field IDs
  sheetRowToProduct(row, catId) {
    const cat = CONFIG.categorias[catId];
    const p   = {};
    // Standard fields (Sheet column names match exactly)
    const standardMap = {
      SKU: 'sku', Nombre: 'nombre', Nivel: 'nivel',
      FOB_USD: 'fob_usd', PVP_ARS: 'pvp_ars', Rentabilidad: 'rentabilidad',
      Diferenciadores: 'diferenciadores', Fuente: 'fuente',
      Fecha_actualizacion: 'fecha'
    };
    for (const [col, field] of Object.entries(standardMap)) {
      if (row[col] != null) p[field] = row[col];
    }
    // Dynamic category specs — Sheet column uses field.id as PascalCase
    for (const f of cat.campos) {
      // Try both snake_case and exact column header formats
      const keys = [f.id, f.id.replace(/_/g, ''), f.label];
      for (const k of keys) {
        if (row[k] != null) { p[f.id] = row[k]; break; }
      }
    }
    p.id = p.sku || `imported_${Date.now()}`;
    return p;
  }

  // ── Apps Script API ───────────────────────────────────────────────────────

  async _get(params) {
    const url = this.APPS_SCRIPT_URL + '?' + new URLSearchParams(params);
    const res = await fetch(url);
    return res.json();
  },

  async _post(body) {
    const res = await fetch(this.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    return res.json();
  },

  async pingScript() {
    try {
      const r = await this._get({ action: 'ping' });
      return r.ok === true;
    } catch { return false; }
  },

  // ── Sync catalog to Sheets ────────────────────────────────────────────────
  async pushCatalog(catId) {
    const cat      = CONFIG.categorias[catId];
    const products = this.getCatalog(catId);
    if (!products.length) return { ok: true, added: 0, updated: 0 };

    // Map products to Sheet row format
    const rows = products.map(p => {
      const row = {
        SKU:                p.sku || '',
        Nombre:             p.nombre || '',
        Nivel:              p.nivel || '',
        FOB_USD:            p.fob_usd || '',
        PVP_ARS:            p.pvp_ars || '',
        Rentabilidad:       p.rentabilidad || '',
        Diferenciadores:    p.diferenciadores || '',
        Fuente:             p.fuente || '',
        Fecha_actualizacion: p.fecha || new Date().toISOString()
      };
      // Add category-specific specs
      for (const f of cat.campos) {
        row[f.id] = p[f.id] ?? '';
      }
      return row;
    });

    return this._post({ action: 'upsert', sheet: cat.sheetName, rows });
  },

  // ── Delete product from Sheets ────────────────────────────────────────────
  async deleteFromSheet(catId, sku) {
    const cat = CONFIG.categorias[catId];
    return this._post({ action: 'delete', sheet: cat.sheetName, sku });
  },

  // ── Pull catalog from Sheets (read) ──────────────────────────────────────
  async pullCatalog(catId) {
    const cat  = CONFIG.categorias[catId];
    const data = await this._get({ action: 'read', sheet: cat.sheetName });
    if (!data.rows || !data.rows.length) return { added: 0, updated: 0 };

    const existing = this.getCatalog(catId);
    let added = 0, updated = 0;

    for (const row of data.rows) {
      if (!row['SKU'] && !row['Nombre']) continue;
      const prod = this.sheetRowToProduct(row, catId);
      const ex   = existing.find(p => p.sku === prod.sku);
      if (ex) { this.updateProduct(catId, ex.id, prod); updated++; }
      else    { this.addProduct(catId, prod); added++; }
    }
    return { added, updated };
  },

  // ── Save comparativa to Sheets ────────────────────────────────────────────
  async pushComparativa(comp) {
    return this._post({ action: 'saveComp', data: comp });
  },

  // ── Delete comparativa from Sheets ────────────────────────────────────────
  async deleteComparativaFromSheet(id) {
    return this._post({ action: 'deleteComp', id });
  },

  // ── Pull comparativas from Sheets ────────────────────────────────────────
  async pullComparativas() {
    const data = await this._get({ action: 'read', sheet: 'Comparativas' });
    if (!data.rows || !data.rows.length) return 0;

    const list = data.rows.map(row => ({
      id:       row['ID'],
      fecha:    row['Fecha'],
      catId:    row['Categoria'],
      tipo:     row['Tipo'],
      nombre:   row['Nombre'],
      formato:  row['Formato'] || 'tarjetas',
      propios:  this._parseJSON(row['Propios']),
      externos: this._parseJSON(row['Externos']),
      analisis: this._parseJSON(row['Analisis']),
    })).filter(c => c.id);

    localStorage.setItem(this._key('comparativas'), JSON.stringify(list));
    return list.length;
  },

  _parseJSON(str) {
    try { return JSON.parse(str || '[]'); } catch { return []; }
  },
};
