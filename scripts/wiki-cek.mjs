// Türkçe Vikipedi'nin gün maddelerinden (ör. "27 Eylül") olay/doğum/ölüm/özel gün listelerini çeker
// ve src/data/gunler/MM-DD.json dosyalarına yazar. Daha önce yazılmış özet/kategori alanları korunur.
//
// Kullanım:
//   node scripts/wiki-cek.mjs                 -> 10 gün öncesi ile 10 gün sonrası arası (her gün pencere kayar)
//   node scripts/wiki-cek.mjs --once 5 --sonra 30   -> pencereyi değiştir
//   node scripts/wiki-cek.mjs --gun 09-27     -> tek gün
//   node scripts/wiki-cek.mjs --hepsi         -> 366 günün tamamı
//   --gorsel-yenile                           -> daha önce bulunmuş/bulunamamış görselleri yeniden ara

import fs from 'node:fs/promises';
import path from 'node:path';
import { gorselleriBul } from './gorsel.mjs';
import { AYLAR, gunAnahtar, gunAdi, slugla, tumGunler, gunPenceresi } from '../src/lib/tarih.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com; iletisim@takvimyapragi.com)';

const BOLUMLER = {
  'Olaylar': 'olaylar',
  'Doğumlar': 'dogumlar',
  'Ölümler': 'olumler',
  'Tatiller ve özel günler': 'ozelGunler',
};

async function wikitextGetir(sayfa) {
  const url = `https://tr.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(sayfa)}&prop=wikitext|revid&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${sayfa}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${sayfa}: ${json.error.info}`);
  return { metin: json.parse.wikitext, revid: json.parse.revid };
}

/** Wikitext satırını düz metne çevirir, iç bağlantıları ayrıca döndürür */
function temizle(satir) {
  const baglantilar = [];
  let s = satir
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<\/?nowiki>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '');
  // Şablonları iç içe olsa da sök
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, hedef, gorunen) => {
    const baslik = hedef.trim();
    if (!/^(Dosya|File|Kategori|Resim):/i.test(baslik)) baglantilar.push(baslik);
    return (gorunen ?? hedef).trim();
  });
  s = s.replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { metin: s, baglantilar };
}

function yilCoz(ham) {
  const m = ham.match(/^(MÖ|M\.Ö\.)\s*(\d+)$/i);
  if (m) return -Number(m[2]);
  const n = Number(ham.replace(/[^\d]/g, ''));
  return Number.isFinite(n) && ham.trim() !== '' ? n : null;
}

/** Olay/doğum/ölüm satırı: "* [[1529]] - metin" */
function yilliSatir(satir) {
  const { metin, baglantilar } = temizle(satir.replace(/^\*+\s*/, ''));
  const m = metin.match(/^((?:MÖ\s*)?\d{1,4})\s*[-–—]\s*(.+)$/);
  if (!m) return null;
  const yil = yilCoz(m[1]);
  if (yil === null) return null;
  // yıl ve tarih bağlantılarını ele: bunlar olayın konusu değil
  const konu = baglantilar.filter((b) => !/^\d{1,4}$/.test(b) && !/^MÖ \d+$/.test(b)
    && !new RegExp(`^\\d{1,2} (${AYLAR.join('|')})$`).test(b));
  return { yil, metin: m[2].replace(/\s+([,.;:])/g, '$1'), konular: [...new Set(konu)].slice(0, 5) };
}

function ayristir(wikitext) {
  const sonuc = { olaylar: [], dogumlar: [], olumler: [], ozelGunler: [] };
  let aktif = null;
  for (const satir of wikitext.split('\n')) {
    const baslik = satir.match(/^==\s*([^=]+?)\s*==\s*$/);
    if (baslik) { aktif = BOLUMLER[baslik[1]] ?? null; continue; }
    if (!aktif || !satir.startsWith('*')) continue;
    if (aktif === 'ozelGunler') {
      const { metin } = temizle(satir.replace(/^\*+\s*/, ''));
      if (metin) sonuc.ozelGunler.push(metin);
      continue;
    }
    const kayit = yilliSatir(satir);
    if (kayit) sonuc[aktif].push(kayit);
  }
  for (const k of ['olaylar', 'dogumlar', 'olumler']) sonuc[k].sort((a, b) => a.yil - b.yil);
  return sonuc;
}

async function mevcutOku(dosya) {
  try { return JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { return null; }
}

async function gunCek(ay, gun, { gorselYenile = false } = {}) {
  const anahtar = gunAnahtar(ay, gun);
  const sayfa = gunAdi(ay, gun);
  const { metin, revid } = await wikitextGetir(sayfa);
  const yeni = ayristir(metin);
  const dosya = path.join(VERI_DIZINI, `${anahtar}.json`);
  const eski = await mevcutOku(dosya);

  // Olaylara kalıcı id (slug) ver, eski özet/kategori/onay alanlarını taşı
  const eskiOlaylar = new Map((eski?.olaylar ?? []).map((o) => [o.id, o]));
  const kullanilan = new Set();
  const olaylar = yeni.olaylar.map((o) => {
    let id = `${o.yil < 0 ? 'mo-' + Math.abs(o.yil) : o.yil}-${slugla(o.metin, 7)}`;
    while (kullanilan.has(id)) id += '-2';
    kullanilan.add(id);
    const onceki = eskiOlaylar.get(id);
    return {
      id,
      yil: o.yil,
      metin: o.metin,
      konular: o.konular,
      baslik: onceki?.baslik ?? null,
      ozet: onceki?.ozet ?? null,
      kategori: onceki?.kategori ?? null,
      ...(onceki && 'gorsel' in onceki ? { gorsel: onceki.gorsel } : {}),
      ...(onceki?.gorselAdaylari ? { gorselAdaylari: onceki.gorselAdaylari } : {}),
      durum: onceki?.durum ?? 'bekliyor', // bekliyor | yayinda | incele
    };
  });
  // Vikipedi'den kalkmış ama bizde özeti yazılmış olayları kaybetme
  for (const [id, o] of eskiOlaylar) if (!kullanilan.has(id) && o.ozet) olaylar.push(o);
  olaylar.sort((a, b) => a.yil - b.yil);
  const gorselSayisi = await gorselleriBul(olaylar, { yenile: gorselYenile });

  const veri = {
    ay, gun,
    olaylar,
    dogumlar: yeni.dogumlar.map(({ yil, metin }) => ({ yil, metin })),
    olumler: yeni.olumler.map(({ yil, metin }) => ({ yil, metin })),
    ozelGunler: yeni.ozelGunler,
    kaynak: { ad: 'Vikipedi', url: `https://tr.wikipedia.org/wiki/${encodeURIComponent(sayfa.replace(/ /g, '_'))}`, revid },
    guncelleme: new Date().toISOString(),
  };
  await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
  console.log(`✓ ${sayfa}: ${olaylar.length} olay, ${veri.dogumlar.length} doğum, ${veri.olumler.length} ölüm, ${veri.ozelGunler.length} özel gün, ${olaylar.filter((o) => o.gorsel).length} görsel (+${gorselSayisi} yeni)`);
}

function hedefGunler(args) {
  if (args.includes('--hepsi')) return tumGunler();
  const i = args.indexOf('--gun');
  if (i >= 0) {
    const [ay, gun] = args[i + 1].split('-').map(Number);
    return [{ ay, gun }];
  }
  const sayi = (ad, v) => (args.includes(ad) ? Number(args[args.indexOf(ad) + 1]) : v);
  return gunPenceresi(sayi('--once', 10), sayi('--sonra', 10));
}

await fs.mkdir(VERI_DIZINI, { recursive: true });
let hata = 0;
for (const { ay, gun } of hedefGunler(process.argv.slice(2))) {
  try {
    await gunCek(ay, gun, { gorselYenile: process.argv.includes('--gorsel-yenile') });
  } catch (e) {
    hata++;
    console.error(`✗ ${gunAdi(ay, gun)}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 300)); // Vikipedi'ye nazik ol
}
if (hata) process.exitCode = 1;
