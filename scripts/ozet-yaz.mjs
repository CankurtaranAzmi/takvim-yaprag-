// Özeti olmayan olaylar için Google Gemini (ücretsiz plan) ile özgün Türkçe özet, kısa başlık ve kategori yazar.
// Vikipedi'deki ilgili maddelerin giriş paragrafları yalnızca BAĞLAM olarak verilir; metin kopyalanmaz.
//
// Kullanım:
//   node scripts/ozet-yaz.mjs                  -> verisi çekilmiş tüm günler (bugünden başlayarak)
//   node scripts/ozet-yaz.mjs --gun 09-27      -> tek gün
//   node scripts/ozet-yaz.mjs --hepsi --limit 400
//
// Gerekli: GEMINI_API_KEY (aistudio.google.com, kredi kartı gerekmez).
// Model: GEMINI_MODEL (varsayılan gemini-flash-lite-latest; ücretsiz planda günde ~500 istek).
// Günlük kota dolarsa script hata vermeden durur; kalan olaylar ertesi gün yazılır.

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunAnahtar, gunAdi, istanbulBugun, yilYaz } from '../src/lib/tarih.mjs';
import { KATEGORILER } from '../src/lib/kategoriler.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const API_KEY = process.env.GEMINI_API_KEY;
const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com)';
const BEKLEME_MS = Number(process.env.GEMINI_BEKLEME_MS || 4500); // ücretsiz planın dakika sınırına takılmamak için

class KotaDoldu extends Error {}

// Gemini "responseSchema" (OpenAPI alt kümesi)
const SEMA = {
  type: 'OBJECT',
  properties: {
    baslik: { type: 'STRING', description: 'Olayı anlatan, 50-80 karakterlik doğal bir Türkçe başlık. Yıl içermesin.' },
    ozet: { type: 'STRING', description: '150-250 kelimelik, 2-3 paragraflık özgün özet. Paragraflar arasında boş satır.' },
    kategori: { type: 'STRING', format: 'enum', enum: KATEGORILER },
    guven: { type: 'STRING', format: 'enum', enum: ['yuksek', 'dusuk'], description: 'Olayın tarihi ve içeriğinden emin değilsen "dusuk".' },
    gorsel: { type: 'INTEGER', description: 'Aday görsellerden olayı en iyi anlatanın numarası; hiçbiri uygun değilse 0.' },
  },
  required: ['baslik', 'ozet', 'kategori', 'guven', 'gorsel'],
  propertyOrdering: ['baslik', 'ozet', 'kategori', 'guven', 'gorsel'],
};

const SISTEM = `Sen "Takvim Yaprağı" adlı Türkçe "tarihte bugün" sitesinin editörüsün.
Sana bir tarihte yaşanmış bir olayın tek satırlık kaydı ve ilgili Vikipedi maddelerinin giriş paragrafları verilecek.

Görevin, okuyucunun "bu gün ne oldu, neden önemli?" sorusunu yanıtlayan özgün bir yazı hazırlamak:
- İlk paragraf olayın kendisini anlatır: ne oldu, kim, nerede.
- Sonraki paragraflar arka planı ve sonuçlarını/önemini anlatır.
- Bağlam metinlerini kopyalama, cümle cümle yeniden yazma; kendi cümlelerinle anlat.
- Bağlam metni olayla ilgisizse (ör. olay bir partinin kuruluşu, bağlam şehir tanıtımı) onu kullanma.
- Emin olmadığın tarih, sayı veya isim uydurma. Bilgi yetersizse daha kısa yaz ve guven alanını "dusuk" yap.
- Tarafsız, ansiklopedik ama akıcı bir dil kullan. Siyasi ve dini konularda yorum katma.
- Markdown başlık, madde işareti veya emoji kullanma.

Görsel seçimi: Aday görseller numaralı verilir. Olayın kendisini, baş aktörünü ya da doğrudan ilgili bir nesneyi/yeri gösteren görseli seç.
Şunları seçme (0 ver): saldırı, katliam, afet ve ölüm olaylarında turistik şehir manzaraları; olayla ilgisi zayıf genel şehir veya bina fotoğrafları.`;

async function vikiGirisleri(basliklar) {
  if (!basliklar?.length) return [];
  const url = `https://tr.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(basliklar.slice(0, 3).join('|'))}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const json = await res.json();
    return (json.query?.pages ?? [])
      .filter((p) => p.extract)
      .map((p) => ({ baslik: p.title, metin: p.extract.slice(0, 1200) }));
  } catch {
    return [];
  }
}

async function olayYaz(ay, gun, olay) {
  const baglam = await vikiGirisleri(olay.konular);
  const adaylar = olay.gorselAdaylari ?? (olay.gorsel ? [olay.gorsel] : []);
  const istek = [
    `Tarih: ${gunAdi(ay, gun)} ${yilYaz(olay.yil)}`,
    `Kayıt: ${olay.metin}`,
    '',
    adaylar.length
      ? 'Aday görseller:\n' + adaylar.map((g, i) => `${i + 1}. "${g.konu}" maddesinin görseli: ${g.aciklama ?? decodeURIComponent(g.kaynak.split('File:')[1])}`).join('\n')
      : 'Aday görsel yok (gorsel alanına 0 ver).',
    '',
    baglam.length
      ? baglam.map((b) => `<baglam baslik="${b.baslik}">\n${b.metin}\n</baglam>`).join('\n\n')
      : '(Bağlam metni yok.)',
  ].join('\n');

  const c = await gemini(istek);
  if (!KATEGORILER.includes(c.kategori)) c.kategori = null;
  return { ...c, secilenGorsel: adaylar[c.gorsel - 1] ?? null };
}

async function gemini(istek, deneme = 0) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEM }] },
      contents: [{ role: 'user', parts: [{ text: istek }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json', responseSchema: SEMA },
    }),
  });
  if (res.status === 429 || res.status === 503) {
    const govde = await res.text();
    // Günlük kota bittiyse beklemenin anlamı yok
    if (/per ?day|PerDay/i.test(govde) || deneme >= 3) throw new KotaDoldu(govde.slice(0, 300));
    await new Promise((r) => setTimeout(r, 20000 * (deneme + 1)));
    return gemini(istek, deneme + 1);
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const aday = json.candidates?.[0];
  const metin = aday?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!metin) throw new Error(`boş yanıt (${aday?.finishReason ?? json.promptFeedback?.blockReason ?? 'bilinmiyor'})`);
  return JSON.parse(metin);
}

async function hedefGunler(args) {
  const i = args.indexOf('--gun');
  if (i >= 0) {
    const [ay, gun] = args[i + 1].split('-').map(Number);
    return [{ ay, gun }];
  }
  // Verisi çekilmiş günler; bugün ve sonrası önce, geçmiş günler sonra
  const b = istanbulBugun();
  const bugunAnahtar = gunAnahtar(b.ay, b.gun);
  const anahtarlar = (await fs.readdir(VERI_DIZINI)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 5)).sort();
  const sirali = [...anahtarlar.filter((a) => a >= bugunAnahtar), ...anahtarlar.filter((a) => a < bugunAnahtar).reverse()];
  return sirali.map((a) => ({ ay: Number(a.slice(0, 2)), gun: Number(a.slice(3, 5)) }));
}

if (!API_KEY) {
  console.error('GEMINI_API_KEY tanımlı değil. https://aistudio.google.com/apikey adresinden ücretsiz alınabilir.');
  process.exit(1);
}

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
let kalan = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
let yazilan = 0;
let hata = 0;

let kotaDoldu = false;
for (const { ay, gun } of await hedefGunler(args)) {
  if (kalan <= 0 || kotaDoldu) break;
  const dosya = path.join(VERI_DIZINI, `${gunAnahtar(ay, gun)}.json`);
  let veri;
  try { veri = JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { continue; }

  let degisti = false;
  for (const olay of veri.olaylar) {
    if (!olay.gorsel || olay.ozet || olay.durum === 'incele' || kalan <= 0 || kotaDoldu) continue;
    try {
      const c = await olayYaz(ay, gun, olay);
      olay.baslik = c.baslik;
      olay.ozet = c.ozet;
      olay.kategori = c.kategori;
      olay.gorsel = c.secilenGorsel;
      delete olay.gorselAdaylari;
      // Düşük güvenli yazılar yayınlanmaz, elle incelenir
      olay.durum = c.guven === 'yuksek' ? 'yayinda' : 'incele';
      degisti = true;
      yazilan++;
      kalan--;
      console.log(`${olay.durum === 'yayinda' ? '✓' : '?'} ${gunAdi(ay, gun)} ${olay.yil}: ${c.baslik}`);
    } catch (e) {
      if (e instanceof KotaDoldu) {
        kotaDoldu = true;
        console.warn('Günlük ücretsiz kota doldu, kalanlar sonraki çalışmada yazılacak.');
        break;
      }
      hata++;
      if (/HTTP (400|401|403)/.test(e.message) && /API key|API_KEY|permission/i.test(e.message)) {
        console.error('GEMINI_API_KEY geçersiz.');
        process.exit(1);
      }
      console.error(`✗ ${gunAdi(ay, gun)} ${olay.yil}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, BEKLEME_MS));
  }
  if (degisti) await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
}

console.log(`\n${yazilan} özet yazıldı, ${hata} hata.`);
// Tek tük hatalar PR'ı engellemesin; hepsi hatalıysa işi başarısız say
if (hata && !yazilan) process.exitCode = 1;
