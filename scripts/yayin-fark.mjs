// Derlenmiş dist/ klasörünü sunucudaki son yayının parmak iziyle (yayin-manifest.json) karşılaştırır,
// yalnızca değişen dosyalar için lftp komutları yazar. Böylece her gece 470 dosya yerine birkaçı yüklenir.
//   node scripts/yayin-fark.mjs <komut-dosyasi> [uzak-dizin]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [komutDosyasi, uzakKok = '.'] = process.argv.slice(2);
const DIST = path.resolve('dist');
const MANIFEST = 'yayin-manifest.json';

function* tara(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* tara(p);
    else yield p;
  }
}

const yeni = {};
for (const p of tara(DIST)) {
  const rel = path.relative(DIST, p).split(path.sep).join('/');
  if (rel === MANIFEST) continue;
  yeni[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let eski = {};
try {
  const r = await fetch(`https://takvimyapragi.com/${MANIFEST}?t=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (r.ok) eski = await r.json();
} catch {}

const degisen = Object.keys(yeni).filter((k) => eski[k] !== yeni[k]);
console.log(`Toplam ${Object.keys(yeni).length} dosya, değişen/yeni: ${degisen.length}${Object.keys(eski).length ? '' : ' (manifest yok, tam yükleme)'}`);

const q = (s) => `"${s.replace(/"/g, '\\"')}"`;
const dizinler = new Set();
const satirlar = [];
for (const rel of degisen) {
  const d = path.posix.dirname(rel);
  const uzakDizin = d === '.' ? uzakKok : `${uzakKok}/${d}`;
  if (d !== '.' && !dizinler.has(d)) { dizinler.add(d); satirlar.push(`mkdir -p -f ${q(uzakDizin)}`); }
  satirlar.push(`put -O ${q(uzakDizin)} ${q(path.join(DIST, rel))}`);
}
// Manifest en sona: yarım kalan yüklemede bir sonraki deneme aynı farkı yeniden bulur.
fs.writeFileSync(path.join(DIST, MANIFEST), JSON.stringify(yeni));
satirlar.push(`put -O ${q(uzakKok)} ${q(path.join(DIST, MANIFEST))}`);
fs.writeFileSync(komutDosyasi, satirlar.join('\n') + '\n');
