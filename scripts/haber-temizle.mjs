// Önceden çekilmiş haberlerde tık başlıklarını ve logolu yer tutucu görselleri ayıklar;
// ilgili yılları "işlenmedi" sayar ki haber-cek.mjs o yılları güncel filtrelerle yeniden doldursun.
//   node scripts/haber-temizle.mjs && node scripts/haber-cek.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const VERI_DIZINI = path.resolve('src/data/gunler');
const LOGO_OZET = '000000000000001100000000000000100000000000000011011011111111111011111111111111100111111111111110000000000000000000000001100000000000000000000000';
const TIK = /-mi-oldu|-mi-var|nerede-ne-zaman|son-depremler|fiyatlari|kac-tl|hava-durumu|ne-zaman|nasil-|nedir|kimdir|iste-|listesi|canli-izle|hangi-kanalda|mac-sonucu|puan-durumu|sonuclari-aciklandi|basvuru/;

async function logoMu(url) {
  try {
    const res = await fetch(url);
    const px = await sharp(Buffer.from(await res.arrayBuffer())).resize(16, 9, { fit: 'fill' }).greyscale().raw().toBuffer();
    const ort = px.reduce((a, b) => a + b, 0) / px.length;
    const ozet = [...px].map((v) => (v > ort ? '1' : '0')).join('');
    return [...ozet].filter((c, i) => c !== LOGO_OZET[i]).length <= 20;
  } catch {
    return true;
  }
}

let silinen = 0;
for (const f of (await fs.readdir(VERI_DIZINI)).filter((f) => f.endsWith('.json'))) {
  const dosya = path.join(VERI_DIZINI, f);
  const veri = JSON.parse(await fs.readFile(dosya, 'utf8'));
  if (!veri.haberler?.length) continue;
  const kalan = [];
  const bozukYillar = new Set();
  for (const h of veri.haberler) {
    const slug = h.haberKaynagi.url.split('/').pop();
    if (TIK.test(slug) || (await logoMu(h.gorsel.url))) {
      bozukYillar.add(h.yil);
      silinen++;
    } else {
      kalan.push({ ...h, metin: h.metin.replace(/^son dakika\s*[.:!…-]*\s*/i, '') });
    }
  }
  // Bozuk haberi olan yılın tamamı yeniden seçilsin (yerine uygun haber gelsin)
  veri.haberler = kalan.filter((h) => !bozukYillar.has(h.yil));
  veri.haberYillari = (veri.haberYillari ?? []).filter((y) => !bozukYillar.has(y));
  await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
  if (bozukYillar.size) console.log(`${f}: ${[...bozukYillar].join(', ')} yılları yeniden seçilecek`);
}
console.log(`\n${silinen} uygunsuz haber ayıklandı.`);
