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
