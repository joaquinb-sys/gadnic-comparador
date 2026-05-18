// ─── GADNIC COMPARADOR · AI (Groq) ────────────────────────────────────────────
const GEMINI = {
  MODEL: 'llama-3.3-70b-versatile',
  ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions',

  async _call(prompt) {
    const { geminiKey } = DB.getSettings();
    if (!geminiKey) throw new Error('API key no configurada. Ir a ⚙️ Config.');
    const res = await fetch(this.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${geminiKey}`
      },
      body: JSON.stringify({
        model: this.MODEL,
        temperature: 0.2,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `Error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  },

  _parseJSON(text) {
    const clean = text.replace(/```json\n?|\n?```|```/g, '').trim();
    try { return JSON.parse(clean); }
    catch { throw new Error('No se pudo parsear la respuesta de IA'); }
  },

  // ── Extract product specs from a URL ──────────────────────────────────────
  async extractFromURL(url, catId) {
    const cat    = CONFIG.categorias[catId];
    const campos = cat.campos.map(c => `"${c.id}": null  // ${c.label}${c.unidad ? ' en ' + c.unidad : ''}`).join('\n  ');

    const prompt = `Sos un analista de productos para Argentina.
Analizá el contenido del siguiente link de producto y extraé las specs técnicas.
URL: ${url}
Categoría del producto: ${cat.nombre}

Respondé SOLO con JSON válido, sin texto adicional ni backticks:
{
  "nombre": "",
  "sku": "",
  "precio_ars": null,
  "imagen_url": "",
  "nivel": "",
  "fuente": "${url}",
  ${campos},
  "diferenciadores": ""
}

Si un campo no está disponible o no aplica, usá null.
Para booleanos usá true o false.
Para "nivel" estimá: Entry / Mid / High / Premium según precio y specs.`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Analyze comparison and generate insights ──────────────────────────────
  async analyzeComparativa(propios, externos, tipo, catId) {
    const cat     = CONFIG.categorias[catId];
    const tipoObj = CONFIG.tipos.find(t => t.id === tipo);

    const prompt = `Sos un analista de producto senior para Gadnic/Bidcom Argentina.
Analizá esta comparativa de productos en la categoría "${cat.nombre}".
Tipo de análisis: ${tipoObj.label}

PRODUCTOS PROPIOS (Gadnic/Bidcom):
${JSON.stringify(propios.map(p => ({ sku: p.sku, nombre: p.nombre, ...Object.fromEntries(cat.campos.map(f => [f.label, p[f.id]])), pvp: p.pvp_ars, fob: p.fob_usd })), null, 2)}

PRODUCTOS EXTERNOS:
${JSON.stringify(externos.map(p => ({ nombre: p.nombre, ...Object.fromEntries(cat.campos.map(f => [f.label, p[f.id]])), precio: p.precio_ars || p.pvp_ars, fuente: p.fuente })), null, 2)}

Respondé SOLO con JSON válido, sin texto adicional ni backticks:
{
  "resumen": "1-2 frases del panorama general",
  "ventajas_propias": [
    { "titulo": "", "descripcion": "" }
  ],
  "gaps_criticos": [
    { "titulo": "", "descripcion": "", "urgencia": "alta|media|baja" }
  ],
  "recomendaciones": [
    { "titulo": "", "descripcion": "" }
  ],
  "posiciones": [
    { "nombre_externo": "", "vs_propio": "", "evaluacion": "entra|no_entra|gap_critico|par", "nota": "" }
  ]
}`;

    const text = await this._call(prompt);
    return this._parseJSON(text);
  },

  // ── Fill missing specs using AI ────────────────────────────────────────────
  async fillMissingSpecs(product, catId) {
    const cat     = CONFIG.categorias[catId];
    const missing = cat.campos.filter(f => !product[f.id] && f.req).map(f => f.label);
    if (!missing.length) return product;

    const prompt = `Sos un experto en electrónica de consumo.
Tenés este producto: "${product.nombre || product.sku}"
Categoría: ${cat.nombre}
Specs conocidas: ${JSON.stringify(Object.fromEntries(cat.campos.filter(f => product[f.id]).map(f => [f.label, product[f.id]])))}
Specs faltantes: ${missing.join(', ')}

Estimá los valores faltantes basándote en el nombre del modelo y las specs conocidas.
Respondé SOLO con JSON sin backticks con los campos faltantes (ids exactos):
{ ${cat.campos.filter(f => !product[f.id] && f.req).map(f => `"${f.id}": null`).join(', ')} }`;

    try {
      const text   = await this._call(prompt);
      const filled = this._parseJSON(text);
      return { ...product, ...filled, _ai_filled: true };
    } catch {
      return product;
    }
  }
};
