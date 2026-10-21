import { GUNLER } from '../lib/veri.mjs';
import { gunAdi, gunSlug } from '../lib/tarih.mjs';

const kac = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function GET() {
  const items = GUNLER.map((g) => {
    const link = `https://takvimyapragi.com/${gunSlug(g.ay, g.gun)}/`;
    return `<item><title>Tarihte Bugün: ${kac(gunAdi(g.ay, g.gun))}</title><link>${link}</link><guid>${link}</guid><description>${kac(`${gunAdi(g.ay, g.gun)} tarihinde yaşanan olaylar, doğanlar, ölenler ve özel günler.`)}</description></item>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Takvim Yaprağı</title><link>https://takvimyapragi.com/</link><description>Tarihte bugün: her gün için olaylar, doğumlar, ölümler ve özel günler.</description><language>tr</language>${items}</channel></rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
