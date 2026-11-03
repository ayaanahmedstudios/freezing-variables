const $ = id => document.getElementById(id);

/* Logo container naturally expands & contracts with the wave */
[...'Freezing Variables'].forEach((ch, n) => {
  const i = document.createElement('i');
  i.textContent = ch;
  i.style.setProperty('--i', n);
  $('logo').appendChild(i);
});

const PY = `
import io, json, copy, logging
logging.getLogger("fontTools").setLevel(logging.ERROR)
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT = None

def inspect(raw_bytes):
    global FONT
    FONT = TTFont(io.BytesIO(bytes(raw_bytes)))
    if 'fvar' not in FONT:
        return json.dumps({"error": "This font has no variation axes."})
    n = FONT['name']
    axes = [{"tag": a.axisTag, "name": n.getDebugName(a.axisNameID) or a.axisTag, "min": a.minValue, "def": a.defaultValue, "max": a.maxValue} for a in FONT['fvar'].axes]
    inst = [{"name": n.getDebugName(i.subfamilyNameID) or "Style", "coords": dict(i.coordinates)} for i in FONT['fvar'].instances]
    fam = n.getDebugName(16) or n.getDebugName(1) or "Untitled font"
    return json.dumps({
        "family": fam,
        "axes": axes,
        "instances": inst,
        "ext": "otf" if 'CFF2' in FONT else "ttf",
        "copyright": n.getDebugName(0) or "",
        "license": n.getDebugName(13) or "",
        "licenseUrl": n.getDebugName(14) or ""
    })

def build(coords_json, fmt):
    c = json.loads(coords_json)
    f = copy.deepcopy(FONT)
    try:
        s = instancer.instantiateVariableFont(f, c, inplace=False, updateFontNames=True)
    except Exception:
        s = instancer.instantiateVariableFont(f, c, inplace=False)
    s.flavor = 'woff2' if fmt == 'woff2' else None
    buf = io.BytesIO()
    s.save(buf)
    return buf.getvalue()
`;

function workerMain() {
  let py = null;
  onmessage = async ({ data: { id, type, a } }) => {
    try {
      if (type === 'init') {
        importScripts('https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.js');
        py = await loadPyodide({ stdout: () => {}, stderr: () => {} });
        await py.loadPackage('micropip');
        await py.runPythonAsync("import micropip\nawait micropip.install(['fonttools', 'brotli'])");
        await py.runPythonAsync(a.py);
        postMessage({ id, res: true });
      } else if (type === 'inspect') {
        postMessage({ id, res: py.globals.get('inspect')(a.bytes) });
      } else if (type === 'build') {
        const p = py.globals.get('build')(a.coords, a.fmt);
        const data = p.toJs({ create_proxies: false });
        p.destroy();
        postMessage({ id, res: data }, [data.buffer]);
      }
    } catch (e) {
      postMessage({ id, err: String((e && e.message) || e) });
    }
  };
}

/* Python runs in a background worker so the page (and the logo animation) never freezes */
const worker = new Worker(URL.createObjectURL(new Blob([`(${workerMain})()`], { type: 'text/javascript' })));
const pending = new Map();
let seq = 0;
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  data.err !== undefined ? p.rej(new Error(data.err)) : p.res(data.res);
};
worker.onerror = e => {
  pending.forEach(p => p.rej(new Error(e.message || 'Converter crashed.')));
  pending.clear();
};
const call = (type, a, tr) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  worker.postMessage({ id, type, a }, tr || []);
});
let readyP = null;
const ready = () => readyP || (readyP = call('init', { py: PY }).catch(e => {
  readyP = null;
  throw new Error('Could not start the converter. ' + e.message);
}));
ready().catch(() => {});

let srcName = '', bytes = null, info = null, insts = [], cur = {}, faceURL = null, faceStyle = null;

const msg = (t, err) => { $('msg').textContent = t || ''; $('msg').className = err ? 'err' : ''; };
const fvs = c => Object.entries(c).map(([k, v]) => `"${k}" ${v}`).join(',');
const num = v => Number.isInteger(v) ? v : +v.toFixed(2);
const cleanFam = s => s.replace(/\s+(\d+pt\s+)?(Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic|Oblique)(\s.*)?$/i, '').replace(/\s+\d+pt$/i, '').trim() || s;

['dragover', 'drop'].forEach(t => addEventListener(t, e => e.preventDefault()));

const drop = $('drop');
['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, () => drop.classList.add('over')));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', e => { const f = e.dataTransfer?.files[0]; if (f) take(f); });
$('file').addEventListener('change', e => { if (e.target.files[0]) take(e.target.files[0]); });

$('reset').onclick = () => {
  $('work').classList.remove('on');
  $('home').style.display = '';
  $('file').value = '';
  msg('');
};

async function take(file) {
  drop.classList.add('wait');
  try {
    msg('Starting converter…');
    await ready();
    msg('Reading font…');
    srcName = file.name;
    bytes = new Uint8Array(await file.arrayBuffer());
    info = JSON.parse(await call('inspect', { bytes: bytes.slice() }));
  } catch (e) {
    msg(e?.message || 'That file could not be read as a font.', true);
    drop.classList.remove('wait');
    return;
  }
  drop.classList.remove('wait');
  if (info.error) { msg(info.error, true); return; }
  info.family = cleanFam(info.family);
  msg('');
  show();
}

function show() {
  if (faceURL) URL.revokeObjectURL(faceURL);
  if (faceStyle) faceStyle.remove();
  faceURL = URL.createObjectURL(new Blob([bytes]));
  faceStyle = document.createElement('style');
  faceStyle.textContent = `@font-face{font-family:"Upload";src:url(${faceURL})}`;
  document.head.appendChild(faceStyle);

  $('family').textContent = info.family;
  $('nativeExt').textContent = info.ext.toUpperCase();
  cur = {};
  info.axes.forEach(a => cur[a.tag] = a.def);
  insts = info.instances.map(i => ({ name: i.name, coords: { ...cur, ...i.coords }, on: true }));

  renderLicense();
  drawAxes();
  drawList();
  $('home').style.display = 'none';
  $('work').classList.add('on');
}

function setCur(tag, v) {
  cur[tag] = v;
  $('sample').style.fontVariationSettings = fvs(cur);
}

function drawAxes() {
  const box = $('axes');
  box.textContent = '';
  info.axes.forEach(a => {
    const step = (a.max - a.min) > 20 ? 1 : 0.01;
    const d = document.createElement('div'); d.className = 'axis';
    const top = document.createElement('div'); top.className = 'top';
    const lab = document.createElement('span'); lab.textContent = a.name;
    const sm = document.createElement('small'); sm.textContent = a.tag; lab.appendChild(sm);

    const n = document.createElement('input');
    Object.assign(n, { type: 'number', min: a.min, max: a.max, step, value: num(cur[a.tag]) });

    const r = document.createElement('input');
    Object.assign(r, { type: 'range', min: a.min, max: a.max, step, value: cur[a.tag] });

    r.oninput = () => { n.value = num(+r.value); setCur(a.tag, +r.value); };
    n.onchange = () => {
      const v = Math.min(a.max, Math.max(a.min, +n.value || a.def));
      n.value = num(v); r.value = v; setCur(a.tag, v);
    };
    top.append(lab, n); d.append(top, r); box.appendChild(d);
  });
  $('sample').style.fontVariationSettings = fvs(cur);
}

$('resetAxes').onclick = () => {
  if (!info) return;
  info.axes.forEach(a => cur[a.tag] = a.def);
  drawAxes();
};

function drawList() {
  const L = $('list');
  L.textContent = '';
  if (!insts.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No named styles. Set the axes and save one.';
    L.appendChild(p);
  }
  insts.forEach((it, i) => {
    const r = document.createElement('div');
    r.className = 'row' + (it.on ? '' : ' off');
    const coordStr = Object.entries(it.coords).map(([k, v]) => `${k} ${num(v)}`).join(', ');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = it.on;

    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = it.name;
    nm.style.fontVariationSettings = fvs(it.coords);

    const coords = document.createElement('span');
    coords.className = 'coords';
    coords.textContent = coordStr;

    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×';

    cb.onclick = e => e.stopPropagation();
    cb.onchange = () => { it.on = cb.checked; r.classList.toggle('off', !it.on); sync(); };
    x.onclick = e => { e.stopPropagation(); insts.splice(i, 1); drawList(); };
    r.onclick = () => { cur = { ...it.coords }; drawAxes(); };

    r.append(cb, nm, coords, x);
    L.appendChild(r);
  });
  sync();
}

const sync = () => {
  const count = insts.filter(i => i.on).length;
  const hasFmt = $('fNative').checked || $('fW2').checked;
  $('go').textContent = count ? `Export (${count})` : 'Export';
  $('go').disabled = !(count && hasFmt && $('agree').checked);
};

$('agree').onchange = sync;
$('fNative').onchange = sync;
$('fW2').onchange = sync;
$('selAll').onclick = () => { insts.forEach(i => i.on = true); drawList(); };
$('selNone').onclick = () => { insts.forEach(i => i.on = false); drawList(); };

function renderLicense() {
  $('agree').checked = false;
  const lic = $('lic'); lic.textContent = '';
  const parts = [info.license, info.copyright].filter(Boolean).join(' · ');
  lic.textContent = parts ? (parts.length > 140 ? parts.slice(0, 140) + '…' : parts) : 'No license metadata in this font.';
  if (info.licenseUrl && /^https?:\/\//i.test(info.licenseUrl)) {
    const a = document.createElement('a');
    a.href = info.licenseUrl; a.textContent = ' License link ↗'; a.target = '_blank'; a.rel = 'noopener';
    lic.appendChild(a);
  }

  const w = $('licwarn'); w.textContent = '';
  const warn = t => { const d = document.createElement('div'); d.className = 'warn'; d.textContent = t; w.appendChild(d); };
  const all = info.copyright + ' ' + info.license + ' ' + info.licenseUrl;
  if (parts && !/open font license|\bOFL\b|apache|\bMIT\b|public domain|ubuntu font/i.test(all)) {
    warn('Doesn’t look like an open license. Commercial fonts usually forbid modification.');
  }
  if (/reserved font name/i.test(all)) {
    warn('Reserved Font Name declared. Rename files before sharing.');
  }
}

const readme = ch => `Static fonts from "${info.family}" (${srcName}), made with Freezing Variables.\n\nStyles: ${ch.map(i => i.name).join(', ')}\nCopyright: ${info.copyright || 'not stated'}\nLicense: ${info.license || 'not stated'}\nLink: ${info.licenseUrl || 'not stated'}\n`;

$('add').onclick = () => {
  const name = $('newname').value.trim() || Object.entries(cur).map(([k, v]) => k + num(v)).join('-');
  insts.push({ name, coords: { ...cur }, on: true });
  $('newname').value = '';
  drawList();
};

$('go').onclick = async () => {
  const chosen = insts.filter(i => i.on), fmts = [];
  if ($('fNative').checked) fmts.push(info.ext);
  if ($('fW2').checked) fmts.push('woff2');
  if (!fmts.length) return;

  $('go').disabled = true;
  const out = [], total = chosen.length * fmts.length;
  try {
    for (const it of chosen) {
      for (const f of fmts) {
        $('go').textContent = `${out.length + 1}/${total}…`;
        const data = await call('build', { coords: JSON.stringify(it.coords), fmt: f });
        out.push({
          name: (info.family + '-' + it.name).replace(/[^\w.-]+/g, '') + '.' + f,
          data
        });
      }
    }
    let blob, name;
    if (out.length === 1) {
      blob = new Blob([out[0].data]);
      name = out[0].name;
    } else {
      const z = new JSZip();
      out.forEach(o => z.file(o.name, o.data));
      z.file('README.txt', readme(chosen));
      blob = await z.generateAsync({ type: 'blob' });
      name = info.family.replace(/\W+/g, '') + '-static.zip';
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    msg('Export failed: ' + (e?.message || e), true);
  }
  sync();
};
