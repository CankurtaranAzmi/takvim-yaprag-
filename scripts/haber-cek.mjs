// Geçmiş yılların aynı gününde Türkiye'de yayınlanmış haberleri Cumhuriyet gazetesinin arşivinden çeker.
// Cumhuriyet'in aylık site haritaları (sitemaps/posts-YYYY-M.xml) geçmişe dönük tüm haber adreslerini verir;
// o güne ait haberler başlıklarına göre önem puanıyla sıralanır, en önemlileri sayfasından okunur
// (başlık, kısa açıklama, yayın tarihi, görsel). Metin çevrilmez, kopyalanmaz; başlık + kısa açıklama + bağlantı.
//
// Kullanım:
//   node scripts/haber-cek.mjs                 -> pencere (10 gün önce / 10 gün sonra), son 15 yıl, eksik yıllar
//   node scripts/haber-cek.mjs --gun 09-27     -> tek gün (yeniden)
//   --yil-sayisi 20  --yil-basina 3

import fs from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import { gunAnahtar, gunAdi, gunPenceresi, istanbulBugun } from '../src/lib/tarih.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const UA = 'Mozilla/5.0 (compatible; TakvimYapragiBot/1.0; +https://takvimyapragi.com)';
const KAYNAK = { ad: 'Cumhuriyet', site: 'https://www.cumhuriyet.com.tr' };

const args = process.argv.slice(2);
const sayi = (ad, v) => (args.includes(ad) ? Number(args[args.indexOf(ad) + 1]) : v);
const YIL_SAYISI = sayi('--yil-sayisi', 15);
const YIL_BASINA = sayi('--yil-basina', 2);

// ——— Önem puanı (yalnızca başlıktan) ———
const ARTI = [
  [/cumhurbaskan|erdogan|basbakan|tbmm|meclis|anayasa|referandum|secim|kabine|bakanlar-kurulu/, 5],
  [/milli-takim|a-milli|sampiyon|olimpiyat|dunya-kupasi|avrupa-sampiyon|final|derbi/, 4],
  [/deprem|sel-felaketi|orman-yangini|tsunami|kasirga/, 4],
  [/merkez-bankasi|faiz|enflasyon|dolar|asgari-ucret|zam|vergi|butce|ihracat|buyume/, 4],
  [/savas|ateskes|nato|avrupa-birligi|bm-|birlesmis-milletler|zirve|anlasma|harekat/, 3],
  [/ilk-kez|tarihi|rekor|acildi|acilis|imzalandi|kabul-edildi|yasalasti|ilan-edildi|karar/, 3],
  [/koronavirus|kovid|asi|pandemi/, 2],
  [/galatasaray|fenerbahce|besiktas|trabzonspor/, 2],
  [/bakan|vali|belediye-baskani|chp|akp|ak-parti|mhp|iyi-parti|hdp|dem-parti/, 2],
  [/uzay|bilim|teknoloji|togg|nobel|oscar|odul/, 2],
];
// Olay bildiren fiiller: demeç değil, gerçekten bir şey olmuş
const OLAY = /basladi|baslad|basliyor|kazandi|secildi|imzalandi|ilan-etti|ilan-edildi|kabul-edildi|yasalasti|acildi|kapandi|hayatini-kaybetti|oldu-|rekor|sampiyon|patlama|depremi|istifa|atandi|kuruldu|firlatildi|tamamlandi/;
const DEMEC = /(chp|akp|ak-parti|mhp|hdp|iyi-parti|dem-parti|saadet)[a-z]*(den|dan|ten|tan)-|aciklama|cagri|tepki|elestir|yanit|sozleri|dedi-|iddia|sordu|uyardi|gondermesi/;
const KATEGORI = { haber: 0, turkiye: 1, siyaset: 1, ekonomi: 1, dunya: 0, spor: 0, 'bilim-teknoloji': 1, egitim: 0, saglik: 0, 'kultur-sanat': 0 };
const DUNYA_KATEGORI = new Set(['dunya']);

const EKSI = [
  // Hizmet / tık başlıkları: "Deprem mi oldu?", "Döviz fiyatları", "... ne zaman?", "İşte liste"
  /-mi-oldu|-mi-var|nerede-ne-zaman|son-depremler|fiyatlari|kac-tl|hava-durumu|ne-zaman|nasil-|nedir|kimdir|iste-|listesi|canli-izle|hangi-kanalda|mac-sonucu|puan-durumu|sonuclari-aciklandi|basvuru/,
  /esini|cinayet|bicakla|vurdu|vuruldu|intihar|taciz|istismar|gozaltina|tutuklandi|kavga|darp|dolandir/,
  /botoks|magazin|unlu-oyuncu|sevgili|ask-|evlendi|bosandi|burc|ruya|tarif|hava-durumu|nobetci/,
  /yazdi|kose|yorum|notlar|-ile-|siir|kitap-|roman|sergi|konser|dizi-|film-/,
];

function puanla(slug, kategori = 'haber') {
  let p = KATEGORI[kategori] ?? 0;
  if (OLAY.test(slug)) p += 4;
  if (DEMEC.test(slug)) p -= 4;
  for (const [re, v] of ARTI) if (re.test(slug)) p += v;
  for (const re of EKSI) if (re.test(slug)) p -= 6;
  const kelime = slug.split('-').length;
  if (kelime < 4) p -= 3; // "new-york-enerjisi" gibi köşe yazısı başlıkları
  return p;
}

// ——— Arşiv ———
const haritaOnbellek = new Map();
async function aylikHarita(yil, ay) {
  const k = `${yil}-${ay}`;
  if (!haritaOnbellek.has(k)) {
    const res = await fetch(`${KAYNAK.site}/sitemaps/posts-${yil}-${ay}.xml`, { headers: { 'User-Agent': UA } });
    const xml = res.ok ? await res.text() : '';
    const liste = [...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
      .map(([, url, tarih]) => ({ url, tarih }))
      .map((x) => ({ ...x, kategori: x.url.split('/')[3] }))
      .filter((x) => x.kategori in KATEGORI);
    haritaOnbellek.set(k, liste);
    await bekle(400);
  }
  return haritaOnbellek.get(k);
}

const meta = (html, ad) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)="${ad}"[^>]+content="([^"]*)"`, 'i'))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name|itemprop)="${ad}"`, 'i'))?.[1];

const coz = (s = '') => s.replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

async function haberOku(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const baslik = coz(meta(html, 'og:title'));
  const yayin = meta(html, 'datePublished') ?? html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  if (!baslik || !yayin) return null;
  const gorselUrl = meta(html, 'og:image');
  return {
    baslik: baslik.replace(/^son dakika\s*[.:!…-]*\s*/i, ''),
    aciklama: coz(meta(html, 'og:description') ?? meta(html, 'description') ?? '').slice(0, 280),
    yayin,
    gorsel: gorselUrl
      ? { url: gorselUrl, genislik: Number(meta(html, 'og:image:width')) || 1280, yukseklik: Number(meta(html, 'og:image:height')) || 720 }
      : null,
  };
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Cumhuriyet'in fotoğrafsız haberlerde kullandığı logolu kapak görseli (16x9 ortalama-parlaklık özeti)
const LOGO_OZET = '000000000000001100000000000000100000000000000011011011111111111011111111111111100111111111111110000000000000000000000001100000000000000000000000';

async function gorselOzeti(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const px = await sharp(Buffer.from(await res.arrayBuffer())).resize(16, 9, { fit: 'fill' }).greyscale().raw().toBuffer();
  const ort = px.reduce((a, b) => a + b, 0) / px.length;
  return [...px].map((v) => (v > ort ? '1' : '0')).join('');
}

/** Gerçek fotoğraf mı, yoksa logolu yer tutucu mu? */
async function gercekFotograf(url) {
  try {
    const ozet = await gorselOzeti(url);
    if (!ozet) return false;
    const fark = [...ozet].filter((c, i) => c !== LOGO_OZET[i]).length;
    return fark > 20;
  } catch {
    return false;
  }
}

/** Bir günün bir yılı için en önemli haberler */
async function yilHaberleri(ay, gun, yil) {
  const hedef = `${yil}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
  // lastmod, yayından sonraki güne kayabildiği için ayın haritasını ve gerekirse sonraki ayı tara
  const liste = [...(await aylikHarita(yil, ay))];
  if (gun >= 28) liste.push(...(await aylikHarita(ay === 12 ? yil + 1 : yil, ay === 12 ? 1 : ay + 1)));
  const adaylar = liste
    .filter((x) => x.tarih.startsWith(hedef) || x.tarih.startsWith(ertesiGun(hedef)))
    .map((x) => {
      const slug = x.url.split('/').pop().replace(/-\d+$/, '');
      return { ...x, slug, puan: puanla(slug, x.kategori) };
    })
    .filter((x) => x.puan > 0)
    .sort((a, b) => b.puan - a.puan);

  const secilen = [];
  for (const a of adaylar.slice(0, YIL_BASINA * 4)) {
    if (secilen.length >= YIL_BASINA) break;
    // Aynı konunun ikinci haberini alma (ör. iki ayrı Karabağ haberi)
    const kelimeler = new Set(a.slug.split('-').filter((k) => k.length > 4));
    if (secilen.some((s) => s.slug.split('-').filter((k) => kelimeler.has(k)).length >= 2)) continue;
    const h = await haberOku(a.url);
    await bekle(600);
    if (!h || !h.yayin.startsWith(hedef) || !h.gorsel) continue;
    if (!(await gercekFotograf(h.gorsel.url))) continue;
    secilen.push({ ...a, ...h });
  }
  return secilen.map((h) => ({
    id: `${yil}-haber-${h.url.match(/-(\d+)$/)?.[1] ?? h.slug.slice(0, 40)}`,
    yil,
    bolge: DUNYA_KATEGORI.has(h.kategori) ? 'dunya' : 'turkiye',
    tur: 'haber',
    metin: h.baslik,
    aciklama: h.aciklama,
    haberKaynagi: { ad: KAYNAK.ad, url: h.url },
    gorsel: { ...h.gorsel, kucukUrl: h.gorsel.url, kaynak: h.url, yazar: KAYNAK.ad, lisans: 'Kaynak sitede', haber: true },
    yayin: h.yayin,
    puan: h.puan,
    durum: 'haber',
  }));
}

function ertesiGun(tarih) {
  const d = new Date(`${tarih}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ——— Ana akış ———
const buYil = istanbulBugun().yil;
const yillar = Array.from({ length: YIL_SAYISI }, (_, i) => buYil - 1 - i);
const i = args.indexOf('--gun');
const gunler = i >= 0 ? [{ ay: Number(args[i + 1].slice(0, 2)), gun: Number(args[i + 1].slice(3, 5)) }] : gunPenceresi(10, 10);
const zorla = i >= 0;

let toplam = 0;
for (const { ay, gun } of gunler) {
  const dosya = path.join(VERI_DIZINI, `${gunAnahtar(ay, gun)}.json`);
  let veri;
  try { veri = JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { continue; }
  const islenmis = new Set(zorla ? [] : veri.haberYillari ?? []);
  const eksik = yillar.filter((y) => !islenmis.has(y));
  if (!eksik.length) continue;

  const mevcut = new Map((zorla ? [] : veri.haberler ?? []).map((h) => [h.id, h]));
  let eklenen = 0;
  for (const yil of eksik) {
    try {
      for (const h of await yilHaberleri(ay, gun, yil)) {
        if (!mevcut.has(h.id)) { mevcut.set(h.id, h); eklenen++; }
      }
      islenmis.add(yil);
    } catch (e) {
      console.error(`✗ ${gunAdi(ay, gun)} ${yil}: ${e.message}`);
    }
  }
  veri.haberler = [...mevcut.values()].sort((a, b) => b.yil - a.yil || b.puan - a.puan);
  veri.haberYillari = [...islenmis].sort((a, b) => b - a);
  await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
  toplam += eklenen;
  console.log(`✓ ${gunAdi(ay, gun)}: +${eklenen} haber (toplam ${veri.haberler.length})`);
}
console.log(`\n${toplam} haber eklendi.`);
