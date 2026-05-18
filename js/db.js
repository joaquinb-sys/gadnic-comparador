// ─── GADNIC COMPARADOR · DATA LAYER ───────────────────────────────────────────
const DB = {
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

  // ── Export / Import ALL ───────────────────────────────────────────────────
  exportAll() {
    const data = {
      version: 1,
      fecha: new Date().toISOString(),
      settings: this.getSettings(),
      catalogos: {},
      comparativas: this.getComparativas(),
    };
    for (const catId of Object.keys(CONFIG.categorias)) {
      data.catalogos[catId] = this.getCatalog(catId);
    }
    return data;
  },

  importAll(data) {
    if (!data.version || !data.catalogos) throw new Error('Formato inválido.');
    if (data.settings) this.saveSettings(data.settings);
    for (const [catId, prods] of Object.entries(data.catalogos)) {
      if (CONFIG.categorias[catId]) this.saveCatalog(catId, prods);
    }
    if (data.comparativas) {
      localStorage.setItem(this._key('comparativas'), JSON.stringify(data.comparativas));
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
};
