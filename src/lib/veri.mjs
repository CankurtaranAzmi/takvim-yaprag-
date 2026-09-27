// Tüm gün dosyalarını derleme zamanında yükler.
import { gunSlug, gunAnahtar, istanbulBugun } from './tarih.mjs';

const dosyalar = import.meta.glob('../data/gunler/*.json', { eager: true, import: 'default' });

const AGIR = /öldür|öldü|ölü|katliam|saldırı|suikast|idam|asıl|patlama|bomba|deprem|kaza|yangın|düştü|infaz|işkence|soykırım|terör|intihar|kasırga/i;
const TURKIYE = /Türkiye|Türk(?!men|istan)|Osmanlı|Atatürk|Ankara|İstanbul|İzmir|TBMM|Kurtuluş Savaşı/;

/**
 * Bir günün gösterilecek olayları: Vikipedi gün maddesi + yakın tarihli olaylar (Türkiye aramaları, yıl sayfaları).
 * Site görsel ağırlıklı: görseli olmayan, henüz Türkçeye çevrilmemiş ya da önemsiz bulunan olaylar gösterilmez.
 */
function gosterilecekler(g) {
  return [...g.olaylar, ...(g.yakinOlaylar ?? [])]
    .filter((o) => o.gorsel && o.metin && o.durum !== 'elendi')
    .map((o) => ({ ...o, bolge: o.bolge ?? (TURKIYE.test(o.metin) ? 'turkiye' : 'dunya') }))
    .sort((a, b) => b.yil - a.yil);
}

export const GUNLER = Object.values(dosyalar)
  .map((g) => ({
    ...g,
    olaylar: gosterilecekler(g),
    slug: gunSlug(g.ay, g.gun),
    anahtar: gunAnahtar(g.ay, g.gun),
  }))
  .sort((a, b) => a.ay - b.ay || a.gun - b.gun);

const anahtarla = new Map(GUNLER.map((g) => [g.anahtar, g]));

export function gunBul(ay, gun) {
  return anahtarla.get(gunAnahtar(ay, gun)) ?? null;
}

export function yayindakiOlaylar(g) {
  return g.olaylar.filter((o) => o.durum === 'yayinda' && o.ozet);
}

export const TUM_YAYINDAKI_OLAYLAR = GUNLER.flatMap((g) =>
  yayindakiOlaylar(g).map((o) => ({ ...o, gunVeri: g })),
);

/** Günün manşeti: onaylı, Türkiye'den, yakın tarihli ve acı içermeyen olaylar öne alınır */
export function oneCikan(g) {
  const buYil = istanbulBugun().yil;
  const adaylar = g.olaylar.filter((o) => !AGIR.test(o.metin));
  if (!adaylar.length) return null;
  const puan = (o) =>
    (o.durum === 'yayinda' && o.ozet ? 4 : 0) +
    (o.bolge === 'turkiye' ? 3 : 0) +
    (o.yil >= buYil - 30 ? 1 : 0) +
    (o.gorsel.yukseklik <= o.gorsel.genislik ? 1 : 0); // yatay görsel manşete daha iyi oturur
  return [...adaylar].sort((a, b) => puan(b) - puan(a) || b.yil - a.yil)[0];
}
