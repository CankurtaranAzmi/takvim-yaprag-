// Wikimedia küçük resim adresinden farklı genişlikler üretir (yalnızca orijinalden küçük olanlar).
const GENISLIKLER = [500, 960, 1280, 1920];

export function srcset(g) {
  if (!g?.url?.includes('/960px-')) return undefined;
  const max = g.orijinalGenislik ?? 960;
  return GENISLIKLER.filter((w) => w <= max)
    .map((w) => `${g.url.replace('/960px-', `/${w}px-`)} ${w}w`)
    .join(', ');
}

export function buyukUrl(g, hedef = 1280) {
  if (!g?.url?.includes('/960px-')) return g?.url;
  const max = g.orijinalGenislik ?? 960;
  const w = [...GENISLIKLER].reverse().find((x) => x <= Math.min(hedef, max)) ?? 960;
  return g.url.replace('/960px-', `/${w}px-`);
}

export function altMetin(g, yedek = '') {
  return g?.aciklama ?? g?.konu ?? yedek;
}

/** Uzun Commons yazar satırlarını kısaltır */
export function kisaYazar(g, max = 48) {
  const y = (g?.yazar ?? '').replace(/\s*\(.*$/, '').replace(/,?\s*based on.*$/i, '').trim() || g?.yazar || '';
  return y.length > max ? y.slice(0, max - 1).replace(/[\s,;]+\S*$/, '') + '…' : y;
}
