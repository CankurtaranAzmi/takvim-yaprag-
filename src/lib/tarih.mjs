// Site ve scriptlerin ortak kullandığı tarih/slug yardımcıları.

export const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

export const AY_GUN_SAYISI = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const GUNLER_HAFTA = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function slugla(metin, maxKelime = 8) {
  return metin
    .toLocaleLowerCase('tr')
    .replace(/['’`]/g, '')
    .replace(/[çğıöşüâîû]/g, (c) => TR_MAP[c] || c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, maxKelime)
    .join('-')
    .replace(/-+/g, '-');
}

/** 9, 27 -> "27-eylul" */
export function gunSlug(ay, gun) {
  return `${gun}-${slugla(AYLAR[ay - 1])}`;
}

/** 9, 27 -> "09-27" (veri dosyası adı) */
export function gunAnahtar(ay, gun) {
  return `${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
}

export function gunAdi(ay, gun) {
  return `${gun} ${AYLAR[ay - 1]}`;
}

/** Yılın tüm günleri (29 Şubat dahil, 366 gün) */
export function tumGunler() {
  const liste = [];
  AY_GUN_SAYISI.forEach((n, i) => {
    for (let g = 1; g <= n; g++) liste.push({ ay: i + 1, gun: g });
  });
  return liste;
}

/** Bir önceki / sonraki takvim günü (29 Şubat dahil döngü) */
export function komsuGun(ay, gun, yon) {
  const liste = tumGunler();
  const i = liste.findIndex((d) => d.ay === ay && d.gun === gun);
  return liste[(i + yon + liste.length) % liste.length];
}

/** İstanbul saatine göre bugünün ay/gün bilgisi */
export function istanbulBugun(tarih = new Date()) {
  const parca = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(tarih);
  const al = (t) => parca.find((p) => p.type === t).value;
  const yil = Number(al('year'));
  const ay = Number(al('month'));
  const gun = Number(al('day'));
  const haftaGunu = new Date(Date.UTC(yil, ay - 1, gun)).getUTCDay();
  return { yil, ay, gun, haftaGunu };
}

/** "MÖ 44" gibi yıllar için gösterim */
export function yilYaz(yil) {
  return yil < 0 ? `MÖ ${Math.abs(yil)}` : String(yil);
}

export function kacYilOnce(yil, buYil) {
  return buYil - yil;
}

// "27 Eylül'de", "5 Mart'ta" gibi bulunma eki (ay adının son sesine göre)
const AY_EKI = ["'ta", "'ta", "'ta", "'da", "'ta", "'da", "'da", "'ta", "'de", "'de", "'da", "'ta"];
export function gunAdiDe(ay, gun) {
  return `${gun} ${AYLAR[ay - 1]}${AY_EKI[ay - 1]}`;
}

/** Bugünden `once` gün öncesinden `sonra` gün sonrasına kadar olan günler (İstanbul saatine göre) */
export function gunPenceresi(once = 20, sonra = 10) {
  const b = istanbulBugun();
  let d = { ay: b.ay, gun: b.gun };
  for (let i = 0; i < once; i++) d = komsuGun(d.ay, d.gun, -1);
  const liste = [];
  for (let i = 0; i <= once + sonra; i++) {
    liste.push(d);
    d = komsuGun(d.ay, d.gun, 1);
  }
  return liste;
}
