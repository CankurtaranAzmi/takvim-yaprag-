// Özeti olmayan olaylar için Google Gemini (ücretsiz plan) ile özgün Türkçe özet, kısa başlık ve kategori yazar.
// Vikipedi'deki ilgili maddelerin giriş paragrafları yalnızca BAĞLAM olarak verilir; metin kopyalanmaz.
//
// Kullanım:
//   node scripts/ozet-yaz.mjs                  -> verisi çekilmiş tüm günler (bugünden başlayarak)
//   node scripts/ozet-yaz.mjs --gun 09-27      -> tek gün
//   node scripts/ozet-yaz.mjs --hepsi --limit 400
//
// Gerekli: GEMINI_API_KEY (aistudio.google.com, kredi kartı gerekmez).
// Model: GEMINI_MODEL (varsayılan gemini-3.1-flash-lite; ücretsiz planda günde ~500 istek).
// Günlük kota dolarsa script hata vermeden durur; kalan olaylar ertesi gün yazılır.

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunAnahtar, gunAdi, istanbulBugun, yilYaz } from '../src/lib/tarih.mjs';
import { KATEGORILER } from '../src/lib/kategoriler.mjs';
import { gorselleriBul } from './gorsel.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const API_KEY = process.env.GEMINI_API_KEY;
const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com)';
const BEKLEME_MS = Number(process.env.GEMINI_BEKLEME_MS || 1500); // ücretsiz planın dakika sınırına takılmamak için

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
    metin: { type: 'STRING', description: 'Kaydın akıcı Türkçe tek cümlelik hali (kayıt İngilizceyse çevir).' },
    bolge: { type: 'STRING', format: 'enum', enum: ['turkiye', 'dunya'], description: 'Olay Türkiye ya da Türklerle doğrudan ilgiliyse "turkiye".' },
    onemli: { type: 'BOOLEAN', description: 'Türk okuyucu için tarihte anılmaya değer, geniş ilgi gören bir olay mı? Yerel, teknik ya da önemsiz raporlarsa false.' },
  },
  required: ['baslik', 'ozet', 'kategori', 'guven', 'gorsel', 'metin', 'bolge', 'onemli'],
  propertyOrdering: ['metin', 'baslik', 'ozet', 'kategori', 'bolge', 'onemli', 'guven', 'gorsel'],
};

// Haberler için: kaynak haberin başlığı/açıklaması kopyalanmaz, kendi cümlelerimizle yeniden yazılır
const SEMA_HABER = {
  type: 'OBJECT',
  properties: {
    baslik: { type: 'STRING', description: 'Haberi anlatan, kaynaktakinden farklı kelimelerle kurulmuş 45-80 karakterlik yeni bir Türkçe başlık. Tık tuzağı, soru, ünlem, "son dakika" yok.' },
    ozet: { type: 'STRING', description: 'Haberi kendi cümlelerinle anlatan 2-3 cümlelik (45-90 kelime) özgün özet. Kaynak metinden cümle kopyalama.' },
    kategori: { type: 'STRING', format: 'enum', enum: KATEGORILER },
    onemli: { type: 'BOOLEAN', description: 'Geniş kitleyi ilgilendiren, yıllar sonra anılmaya değer bir haber mi? Parti demeçleri, yerel asayiş, magazin, hizmet haberleri (fiyatlar, hava, maç saati) ise false.' },
    konular: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Haberin görselini bulmak için 1-3 Türkçe Vikipedi madde adı, en özelden genele: olayın kendisi (varsa), baş aktör kişi, kurum ya da yer. Ör: ["Karabağ Savaşı (2020)", "İlham Aliyev", "Azerbaycan"].',
    },
  },
  required: ['baslik', 'ozet', 'kategori', 'onemli', 'konular'],
  propertyOrdering: ['baslik', 'ozet', 'kategori', 'onemli', 'konular'],
};

const SISTEM_HABER = `Sen "Takvim Yaprağı" adlı Türkçe "tarihte bugün" sitesinin editörüsün.
Sana geçmiş bir yılda bu tarihte yayınlanmış bir haberin başlığı ve kısa açıklaması verilecek.
Bu haberi sitemiz için kendi cümlelerinle, tarafsız ve sade bir dille yeniden yaz:
- Kaynak başlık ve açıklamadaki cümleleri kopyalama; aynı bilgiyi farklı kelime ve cümle yapısıyla anlat.
- Yalnızca verilen bilgiyi kullan; tarih, sayı veya isim ekleme, uydurma.
- Geçmiş zaman kullan ("açıkladı", "başladı"); haberin yılını cümle içinde tekrar etme.
- Siyasi konularda yorum katma, taraf tutma. Markdown ve emoji kullanma.
- Türkçe karakterleri (ı, İ, ş, ğ, ç, ö, ü) mutlaka doğru ve eksiksiz kullan; 'ı' harfini asla 'i' ile karıştırma.`;

const SISTEM = `Sen "Takvim Yaprağı" adlı Türkçe "tarihte bugün" sitesinin editörüsün.
Sana bir tarihte yaşanmış bir olayın tek satırlık kaydı (Türkçe ya da İngilizce) ve ilgili Vikipedi maddelerinin giriş paragrafları verilecek. Her zaman Türkçe yaz.

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

async function vikiGirisleri(basliklar, dil = 'tr') {
  if (!basliklar?.length) return [];
  const url = `https://${dil}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(basliklar.slice(0, 3).join('|'))}`;
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
  const baglam = await vikiGirisleri(olay.konular, olay.metinEn && !olay.metin ? 'en' : 'tr');
  const adaylar = olay.gorselAdaylari ?? (olay.gorsel ? [olay.gorsel] : []);
  const istek = [
    `Tarih: ${gunAdi(ay, gun)} ${yilYaz(olay.yil)}`,
    olay.metin ? `Kayıt: ${olay.metin}` : `Kayıt (İngilizce): ${olay.metinEn}`,
    olay.haberKaynagi ? `Haber kaynağı: ${olay.haberKaynagi.ad}` : '',
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
  if (c._turkceSupheli) c.guven = 'dusuk';
  return { ...c, secilenGorsel: adaylar[c.gorsel - 1] ?? null };
}

async function haberYaz(ay, gun, h) {
  const istek = [
    `Tarih: ${gunAdi(ay, gun)} ${h.yil}`,
    `Kaynak başlık: ${h.metin}`,
    h.aciklama ? `Kaynak açıklama: ${h.aciklama}` : '',
  ].join('\n');
  return gemini(istek, 0, SEMA_HABER, SISTEM_HABER);
}

// Ücretsiz Gemini modelleri ara sıra Türkçe özel karakterleri (ı,ğ,ü,ş,ö,ç) hiç üretmeden
// tamamen ASCII yazabiliyor (bilinen, seyrek bir model davranışı). 30+ karakterlik bir
// başlık+özette hiç Türkçe harf yoksa çıktı şüpheli sayılır ve farklı sıcaklıkla yeniden denenir.
const TR_KARAKTER = /[ığüşöçİĞÜŞÖÇ]/;
function turkceGecerliMi(c) {
  const metin = `${c.baslik ?? ''} ${c.ozet ?? ''}`;
  return metin.length < 30 || TR_KARAKTER.test(metin);
}

async function gemini(istek, deneme = 0, sema = SEMA, sistem = SISTEM) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistem }] },
      contents: [{ role: 'user', parts: [{ text: istek }] }],
      generationConfig: { temperature: deneme === 0 ? 0 : 0.6, responseMimeType: 'application/json', responseSchema: sema },
    }),
  });
  if (res.status === 429 || res.status === 503) {
    const govde = await res.text();
    // Günlük kota bittiyse beklemenin anlamı yok
    if (/per ?day|PerDay/i.test(govde) || deneme >= 3) throw new KotaDoldu(govde.slice(0, 300));
    await new Promise((r) => setTimeout(r, 20000 * (deneme + 1)));
    return gemini(istek, deneme + 1, sema, sistem);
  }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const aday = json.candidates?.[0];
  const metin = aday?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!metin) throw new Error(`boş yanıt (${aday?.finishReason ?? json.promptFeedback?.blockReason ?? 'bilinmiyor'})`);
  const sonuc = JSON.parse(metin);
  if (!turkceGecerliMi(sonuc)) {
    if (deneme < 2) return gemini(istek, deneme + 1, sema, sistem);
    sonuc._turkceSupheli = true; // 3 denemede de düzelmedi; çağıran taraf otomatik yayınlamasın
  }
  return sonuc;
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

  for (const h of (veri.haberler ?? []).filter((h) => !h.ozet && h.durum === 'haber').sort((a, b) => b.yil - a.yil)) {
    if (kalan <= 0 || kotaDoldu) break;
    try {
      const c = await haberYaz(ay, gun, h);
      h.baslik = c.baslik;
      h.ozet = c.ozet;
      h.kategori = KATEGORILER.includes(c.kategori) ? c.kategori : null;
      h.durum = !c.onemli ? 'elendi' : c._turkceSupheli ? 'incele' : 'yazildi';
      h.konular = (c.konular ?? []).slice(0, 3);
      // Görsel: yalnızca serbest lisanslı Commons görseli (haber fotoğrafı kullanılmaz)
      if (c.onemli) {
        delete h.gorsel;
        await gorselleriBul([h]);
        delete h.gorselAdaylari;
      }
      degisti = true;
      yazilan++;
      kalan--;
      console.log(`${!c.onemli ? '-' : c._turkceSupheli ? '!' : h.gorsel ? '✓' : '○'} haber ${gunAdi(ay, gun)} ${h.yil}: ${c.baslik}${c.onemli && !h.gorsel ? ' (görsel yok)' : ''}${c._turkceSupheli ? ' (TÜRKÇE KARAKTER ŞÜPHELİ)' : ''}`);
    } catch (e) {
      if (e instanceof KotaDoldu) { kotaDoldu = true; console.warn('Günlük ücretsiz kota doldu.'); break; }
      hata++;
      console.error(`✗ haber ${gunAdi(ay, gun)} ${h.yil}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, BEKLEME_MS));
  }

  const TR = /Türkiye|Türk(?!men|istan)|Osmanlı|Atatürk|Ankara|İstanbul|İzmir|TBMM|Kurtuluş Savaşı/;
  const tumu = [...veri.olaylar]
    .filter((o) => o.gorsel && !o.ozet && o.durum === 'bekliyor')
    .sort((a, b) => {
      const trA = a.bolge === 'turkiye' || TR.test(a.metin ?? '') ? 1 : 0;
      const trB = b.bolge === 'turkiye' || TR.test(b.metin ?? '') ? 1 : 0;
      return trB - trA || b.yil - a.yil;
    });
  for (const olay of tumu) {
    if (kalan <= 0 || kotaDoldu) break;
    try {
      const c = await olayYaz(ay, gun, olay);
      if (!olay.metin) olay.metin = c.metin;
      olay.baslik = c.baslik;
      olay.ozet = c.ozet;
      olay.kategori = c.kategori;
      olay.bolge = olay.bolge ?? c.bolge;
      olay.gorsel = c.secilenGorsel;
      delete olay.gorselAdaylari;
      // Önemsiz bulunanlar elenir; düşük güvenli yazılar yayınlanmaz, elle incelenir
      olay.durum = !c.onemli ? 'elendi' : c.guven === 'yuksek' ? 'yayinda' : 'incele';
      degisti = true;
      yazilan++;
      kalan--;
      console.log(`${{ yayinda: '✓', incele: '?', elendi: '-' }[olay.durum]} ${gunAdi(ay, gun)} ${olay.yil}: ${c.baslik}`);
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
