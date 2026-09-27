// Önceden çekilmiş haberleri güncel kurallara getirir:
// - tık başlıklarını ayıklar (o yıl haber-cek ile yeniden seçilir)
// - Cumhuriyet'ten alınmış eski haber fotoğraflarını siler (görsel artık Commons'tan gelir)
//   node scripts/haber-temizle.mjs && node scripts/haber-cek.mjs

import fs from 'node:fs/promises';
import path from 'node:path';

const VERI_DIZINI = path.resolve('src/data/gunler');
const TIK = /-mi-oldu|-mi-var|nerede-ne-zaman|son-depremler|fiyatlari|kac-tl|hava-durumu|ne-zaman|nasil-|nedir|kimdir|iste-|listesi|canli-izle|hangi-kanalda|mac-sonucu|puan-durumu|sonuclari-aciklandi|basvuru/;

let silinen = 0;
let gorselSilinen = 0;
for (const f of (await fs.readdir(VERI_DIZINI)).filter((f) => f.endsWith('.json'))) {
  const dosya = path.join(VERI_DIZINI, f);
  const veri = JSON.parse(await fs.readFile(dosya, 'utf8'));
  if (!veri.haberler?.length) continue;
  const bozukYillar = new Set();
  for (const h of veri.haberler) {
    if (TIK.test(h.haberKaynagi.url.split('/').pop())) { bozukYillar.add(h.yil); silinen++; }
    if (h.gorsel?.haber || h.gorsel?.url?.includes('cumhuriyet.com.tr')) { delete h.gorsel; gorselSilinen++; }
    h.metin = h.metin.replace(/^son dakika\s*[.:!…-]*\s*/i, '');
    h.konular ??= [];
  }
  veri.haberler = veri.haberler.filter((h) => !bozukYillar.has(h.yil));
  veri.haberYillari = (veri.haberYillari ?? []).filter((y) => !bozukYillar.has(y));
  await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
  if (bozukYillar.size) console.log(`${f}: ${[...bozukYillar].join(', ')} yılları yeniden seçilecek`);
}
console.log(`\n${silinen} tık başlığı ayıklandı, ${gorselSilinen} haber fotoğrafı kaldırıldı.`);
