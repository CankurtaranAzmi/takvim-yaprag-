// Türkiye'nin yakın tarihinden (son 15 yıl) o güne denk gelen olayları Gemini + Google Arama (ücretsiz plan)
// ile bulur. Vikipedi'nin yıllık Türkiye sayfaları seyrek olduğu için Türkiye ağırlığını bu script sağlar.
// Her gün dosyası için yalnızca bir kez sorgu atılır (ücretsiz kotada günde ~1 istek).
//
// Kullanım:
//   node scripts/turkiye-cek.mjs                -> penceredeki henüz sorgulanmamış günler
//   node scripts/turkiye-cek.mjs --gun 09-27    -> tek gün (yeniden sorgular)
//
// Gerekli: GEMINI_API_KEY. Model: GEMINI_ARAMA_MODEL (varsayılan gemini-2.5-flash-lite;
// ücretsiz planda Google Arama yalnızca 2.5 modellerinde açık).

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunAnahtar, gunAdi, gunPenceresi, istanbulBugun, slugla } from '../src/lib/tarih.mjs';
import { gorselleriBul } from './gorsel.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const MODEL = process.env.GEMINI_ARAMA_MODEL || 'gemini-2.5-flash-lite';
const API_KEY = process.env.GEMINI_API_KEY;
const YIL_ARALIGI = 15;

if (!API_KEY) {
  console.error('GEMINI_API_KEY tanımlı değil. https://aistudio.google.com/apikey adresinden ücretsiz alınabilir.');
  process.exit(1);
}

function istem(ay, gun, buYil) {
  return `${gunAdi(ay, gun)} tarihinde Türkiye'de ${buYil - YIL_ARALIGI} ile ${buYil - 1} yılları arasında yaşanmış önemli olayları Google'da araştır.

Kurallar:
- Yalnızca tarihi kesin olarak ${gunAdi(ay, gun)} olan olayları yaz; tarihinden emin olmadığın olayı yazma.
- Her yıldan en fazla 2, toplam en fazla 10 olay.
- Geniş kitleyi ilgilendiren olayları seç: siyaset, ekonomi, spor, bilim-teknoloji, kültür-sanat, büyük afetler, önemli açılışlar ve rekorlar.
- Her olay tek, tarafsız, Türkçe bir cümle olsun.
- "vikipedi": olayın ana konusunun Türkçe Vikipedi madde adı (kişi, kurum, yer ya da olayın kendisi); yoksa boş bırak.
- "kaynak": bilgiyi doğruladığın haber sitesinin alan adı (ör. aa.com.tr).

Yanıtı başka hiçbir metin eklemeden yalnızca şu biçimde bir JSON dizisi olarak ver:
[{"yil": 2024, "metin": "...", "vikipedi": "...", "kaynak": "..."}]`;
}

async function sorgula(ay, gun, buYil) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: istem(ay, gun, buYil) }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (res.status === 429) throw Object.assign(new Error('kota doldu'), { kota: true });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const aday = j.candidates?.[0];
  const metin = aday?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const dizi = metin.match(/\[[\s\S]*\]/)?.[0];
  if (!dizi) throw new Error(`JSON bulunamadı (${aday?.finishReason ?? 'bilinmiyor'})`);
  // Google Arama'nın gösterdiği kaynak sayfalar (alan adı -> adres)
  const kaynaklar = new Map(
    (aday.groundingMetadata?.groundingChunks ?? [])
      .filter((c) => c.web?.uri)
      .map((c) => [String(c.web.title ?? '').replace(/^www\./, ''), c.web.uri]),
  );
  return { olaylar: JSON.parse(dizi), kaynaklar };
}

function hedefGunler(args) {
  const i = args.indexOf('--gun');
  if (i >= 0) {
    const [ay, gun] = args[i + 1].split('-').map(Number);
    return { gunler: [{ ay, gun }], zorla: true };
  }
  return { gunler: gunPenceresi(20, 10), zorla: false };
}

const buYil = istanbulBugun().yil;
const { gunler, zorla } = hedefGunler(process.argv.slice(2));
let eklenen = 0;

for (const { ay, gun } of gunler) {
  const dosya = path.join(VERI_DIZINI, `${gunAnahtar(ay, gun)}.json`);
  let veri;
  try { veri = JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { continue; }
  if (veri.turkiyeSorgusu && !zorla) continue;

  try {
    const { olaylar, kaynaklar } = await sorgula(ay, gun, buYil);
    const mevcut = new Map((veri.yakinOlaylar ?? []).map((o) => [o.id, o]));
    const yeniler = [];
    for (const o of olaylar) {
      const yil = Number(o.yil);
      if (!Number.isInteger(yil) || yil < buYil - YIL_ARALIGI || yil >= buYil || !o.metin) continue;
      const id = `${yil}-tr-${slugla(o.metin, 6)}`;
      if (mevcut.has(id)) continue;
      const alan = String(o.kaynak ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const kayit = {
        id,
        yil,
        bolge: 'turkiye',
        kaynakTuru: 'arama',
        metin: o.metin.trim(),
        metinEn: null,
        konular: o.vikipedi ? [o.vikipedi] : [],
        haberKaynagi: alan ? { ad: alan, url: kaynaklar.get(alan) ?? `https://${alan}` } : null,
        baslik: null,
        ozet: null,
        kategori: null,
        durum: 'bekliyor',
      };
      mevcut.set(id, kayit);
      yeniler.push(kayit);
    }
    await gorselleriBul(yeniler, { host: 'tr.wikipedia.org' });
    veri.yakinOlaylar = [...mevcut.values()].sort((a, b) => b.yil - a.yil);
    veri.turkiyeSorgusu = new Date().toISOString();
    await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
    eklenen += yeniler.length;
    console.log(`✓ ${gunAdi(ay, gun)}: ${yeniler.length} Türkiye olayı (${yeniler.filter((o) => o.gorsel).length} görselli)`);
  } catch (e) {
    if (e.kota) { console.warn('Günlük ücretsiz kota doldu, kalan günler yarın sorgulanacak.'); break; }
    console.error(`✗ ${gunAdi(ay, gun)}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 4500));
}
console.log(`\n${eklenen} Türkiye olayı eklendi.`);
