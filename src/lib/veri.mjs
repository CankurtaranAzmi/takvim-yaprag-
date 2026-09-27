// Tüm gün dosyalarını derleme zamanında yükler.
import { gunSlug, gunAnahtar } from './tarih.mjs';

const dosyalar = import.meta.glob('../data/gunler/*.json', { eager: true, import: 'default' });

export const GUNLER = Object.values(dosyalar)
  .map((g) => ({ ...g, slug: gunSlug(g.ay, g.gun), anahtar: gunAnahtar(g.ay, g.gun) }))
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

/** Günün görselli öne çıkan olayı: onaylı, Türkiye ile ilgili ve acı içermeyen olaylar öne alınır */
const AGIR = /öldür|öldü|ölü|katliam|saldırı|suikast|idam|asıl|patlama|bomba|deprem|kaza|yangın|düştü|infaz|işkence|soykırım|terör|intihar/i;
const TURKIYE = /Türk|Osmanlı|Atatürk|Ankara|İstanbul|İzmir|TBMM|Cumhuriyet|Kurtuluş Savaşı/;

export function oneCikan(g) {
  const gorselli = g.olaylar.filter((o) => o.gorsel && !AGIR.test(o.metin));
  if (!gorselli.length) return null;
  const puan = (o) =>
    (o.durum === 'yayinda' && o.ozet ? 4 : 0) +
    (TURKIYE.test(o.metin) ? 2 : 0) +
    (o.gorsel.yukseklik <= o.gorsel.genislik ? 1 : 0); // yatay görsel manşete daha iyi oturur
  return [...gorselli].sort((a, b) => puan(b) - puan(a) || b.yil - a.yil)[0];
}
