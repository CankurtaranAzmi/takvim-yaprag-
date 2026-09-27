// Yakın tarihli olaylar: İngilizce Vikipedi'nin yıllık "YYYY in Turkey" (Türkiye) ve "YYYY" (dünya)
// sayfalarından, pencere içindeki günlere denk gelen olayları haber kaynağıyla birlikte çeker.
// Metinler İngilizce gelir; ozet-yaz bunları Türkçeye çevirip özetler. Çevrilmeden sitede görünmezler.
//
// Kullanım:
//   node scripts/yakin-cek.mjs                     -> pencere (20 gün önce / 10 gün sonra), son 25 yıl
//   node scripts/yakin-cek.mjs --yil 2010          -> başlangıç yılını değiştir

import fs from 'node:fs/promises';
import path from 'node:path';
import { gunAnahtar, gunPenceresi, istanbulBugun, slugla } from '../src/lib/tarih.mjs';
import { gorselleriBul } from './gorsel.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com; iletisim@takvimyapragi.com)';
const AYLAR_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AY_RE = AYLAR_EN.join('|');

async function wikitext(sayfa) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(sayfa)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const j = await res.json();
  return j.parse?.wikitext ?? null;
}

/** İlk kaynak (ref) şablonundan yayın adı ve adresi */
function haberKaynagi(ham) {
  const ref = ham.match(/<ref[^>]*>([\s\S]*?)<\/ref>/);
  if (!ref) return null;
  const url = ref[1].match(/\|\s*url\s*=\s*([^|}\s]+)/)?.[1];
  if (!url) return null;
  const ad = (ref[1].match(/\|\s*(?:website|work|publisher|newspaper|agency)\s*=\s*([^|}]+)/)?.[1] ?? new URL(url).hostname.replace(/^www\./, ''))
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/'{2,}/g, '').trim();
  return { ad, url };
}

function temizle(ham) {
  const baglantilar = [];
  let s = ham.replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '');
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, hedef, gorunen) => {
    if (!/^(File|Image|Category):/i.test(hedef)) baglantilar.push(hedef.trim());
    return (gorunen ?? hedef).trim();
  });
  s = s.replace(/\[https?:\/\/\S+\s([^\]]+)\]/g, '$1').replace(/'{2,}/g, '').replace(/\s+/g, ' ').trim();
  // Tarih aralıklarında ("27 – 30 September – ...") metnin başında kalan ikinci tarihi at
  s = s.replace(new RegExp(String.raw`^(?:\d{1,2} (?:${AY_RE})|(?:${AY_RE}) \d{1,2})\s*[–—-]\s*`), '');
  return { metin: s, baglantilar };
}

/** "Events" bölümündeki tarihli maddeler: "* 27 September – ...", "* [[September 27]] – ...", alt maddeler "** ..." */
function olaylariAyikla(wt, yil) {
  const sonuc = [];
  const bolum = wt.split(/\n==\s*(?:Deaths|Births|See also|References|Notes)\s*==/)[0];
  let aktifTarih = null;
  for (const satir of bolum.split('\n')) {
    const tarihli = satir.match(new RegExp(`^\\*\\s*(?:\\[\\[)?(?:(\\d{1,2}) (${AY_RE})|(${AY_RE}) (\\d{1,2}))(?:\\]\\])?\\s*(?:[–—-]\\s*(.*))?$`));
    if (tarihli) {
      const gun = Number(tarihli[1] ?? tarihli[4]);
      const ay = AYLAR_EN.indexOf(tarihli[2] ?? tarihli[3]) + 1;
      aktifTarih = { ay, gun };
      if (tarihli[5]) sonuc.push({ ay, gun, yil, ham: tarihli[5] });
      continue;
    }
    if (/^\*\*\s*/.test(satir) && aktifTarih) {
      const ic = satir.replace(/^\*\*\s*/, '');
      // Alt madde kendi tarihini taşıyorsa ("September 30 – ...") başka güne aittir
      if (new RegExp(String.raw`^(?:\[\[)?(?:\d{1,2} (?:${AY_RE})|(?:${AY_RE}) \d{1,2})`).test(ic)) continue;
      sonuc.push({ ...aktifTarih, yil, ham: ic });
      continue;
    }
    if (/^\*[^*]/.test(satir) || /^=/.test(satir)) aktifTarih = null;
  }
  return sonuc;
}

const args = process.argv.slice(2);
const buYil = istanbulBugun().yil;
const ilkYil = args.includes('--yil') ? Number(args[args.indexOf('--yil') + 1]) : buYil - 25;
const pencere = new Map(gunPenceresi(20, 10).map((d) => [gunAnahtar(d.ay, d.gun), d]));

// Yıl sayfalarını çek, penceredeki günlere dağıt
const gunlere = new Map(); // anahtar -> olay listesi
for (let yil = ilkYil; yil <= buYil; yil++) {
  for (const [sayfa, bolge] of [[`${yil} in Turkey`, 'turkiye'], [String(yil), 'dunya']]) {
    const wt = await wikitext(sayfa);
    if (!wt) { console.warn(`- ${sayfa}: sayfa yok`); continue; }
    let n = 0;
    for (const o of olaylariAyikla(wt, yil)) {
      const anahtar = gunAnahtar(o.ay, o.gun);
      if (!pencere.has(anahtar)) continue;
      // Bu yılın henüz yaşanmamış günleri olmaz; bugünden sonrası atlanır
      if (yil === buYil) continue;
      const { metin, baglantilar } = temizle(o.ham);
      if (metin.length < 25) continue;
      // Dünya sayfasındaki Türkiye olayları Türkiye sayılır
      const b = bolge === 'dunya' && /Turk|Istanbul|Ankara|Erdoğan|Erdogan/i.test(metin) ? 'turkiye' : bolge;
      const liste = gunlere.get(anahtar) ?? [];
      liste.push({
        id: `${yil}-${b === 'turkiye' ? 'tr' : 'dn'}-${slugla(metin, 6)}`,
        yil,
        bolge: b,
        metinEn: metin,
        konular: [...new Set(baglantilar)].filter((k) => !/^\d{4}$/.test(k)).slice(0, 5),
        haberKaynagi: haberKaynagi(o.ham),
      });
      gunlere.set(anahtar, liste);
      n++;
    }
    if (n) console.log(`✓ ${sayfa}: ${n} olay`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

// Gün dosyalarına yaz (özet/çeviri/görsel alanlarını koru)
let toplam = 0;
for (const [anahtar, liste] of gunlere) {
  const dosya = path.join(VERI_DIZINI, `${anahtar}.json`);
  let veri;
  try { veri = JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { continue; }
  const eski = new Map((veri.yakinOlaylar ?? []).map((o) => [o.id, o]));
  const tekil = new Map();
  for (const o of liste) if (!tekil.has(o.id)) tekil.set(o.id, o);
  const yeni = [...tekil.values()].map((o) => {
    const e = eski.get(o.id);
    return {
      ...o,
      metin: e?.metin ?? null, // Türkçe metin (ozet-yaz doldurur)
      baslik: e?.baslik ?? null,
      ozet: e?.ozet ?? null,
      kategori: e?.kategori ?? null,
      ...(e && 'gorsel' in e ? { gorsel: e.gorsel } : {}),
      ...(e?.gorselAdaylari ? { gorselAdaylari: e.gorselAdaylari } : {}),
      durum: e?.durum ?? 'bekliyor',
    };
  });
  await gorselleriBul(yeni, { host: 'en.wikipedia.org' });
  veri.yakinOlaylar = yeni.sort((a, b) => b.yil - a.yil);
  await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
  toplam += yeni.length;
  console.log(`  ${anahtar}: ${yeni.length} yakın olay (${yeni.filter((o) => o.bolge === 'turkiye').length} Türkiye, ${yeni.filter((o) => o.gorsel).length} görselli)`);
}
console.log(`\nToplam ${toplam} yakın tarihli olay.`);
