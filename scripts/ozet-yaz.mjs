// Özeti olmayan olaylar için Claude ile özgün Türkçe özet, kısa başlık ve kategori yazar.
// Vikipedi'deki ilgili maddelerin giriş paragrafları yalnızca BAĞLAM olarak verilir; metin kopyalanmaz.
//
// Kullanım:
//   node scripts/ozet-yaz.mjs                  -> bugün + önümüzdeki 7 gün
//   node scripts/ozet-yaz.mjs --gun 09-27      -> tek gün
//   node scripts/ozet-yaz.mjs --hepsi --limit 200
//
// Gerekli: ANTHROPIC_API_KEY. Model: CLAUDE_MODEL (varsayılan claude-opus-5).

import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { gunAnahtar, gunAdi, tumGunler, istanbulBugun, komsuGun, yilYaz } from '../src/lib/tarih.mjs';
import { KATEGORILER } from '../src/lib/kategoriler.mjs';

const VERI_DIZINI = path.resolve('src/data/gunler');
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com)';
const client = new Anthropic();

const Cikti = z.object({
  baslik: z.string().describe('Olayı anlatan, 50-80 karakterlik doğal bir Türkçe başlık. Yıl içermesin.'),
  ozet: z.string().describe('150-250 kelimelik, 2-3 paragraflık özgün özet. Paragraflar arasında boş satır.'),
  kategori: z.enum(KATEGORILER),
  guven: z.enum(['yuksek', 'dusuk']).describe('Olayın tarihi ve içeriğinden emin değilsen "dusuk".'),
});

const SISTEM = `Sen "Takvim Yaprağı" adlı Türkçe "tarihte bugün" sitesinin editörüsün.
Sana bir tarihte yaşanmış bir olayın tek satırlık kaydı ve ilgili Vikipedi maddelerinin giriş paragrafları verilecek.

Görevin, okuyucunun "bu gün ne oldu, neden önemli?" sorusunu yanıtlayan özgün bir yazı hazırlamak:
- İlk paragraf olayın kendisini anlatır: ne oldu, kim, nerede.
- Sonraki paragraflar arka planı ve sonuçlarını/önemini anlatır.
- Bağlam metinlerini kopyalama, cümle cümle yeniden yazma; kendi cümlelerinle anlat.
- Bağlam metni olayla ilgisizse (ör. olay bir partinin kuruluşu, bağlam şehir tanıtımı) onu kullanma.
- Emin olmadığın tarih, sayı veya isim uydurma. Bilgi yetersizse daha kısa yaz ve guven alanını "dusuk" yap.
- Tarafsız, ansiklopedik ama akıcı bir dil kullan. Siyasi ve dini konularda yorum katma.
- Markdown başlık, madde işareti veya emoji kullanma.`;

async function vikiGirisleri(basliklar) {
  if (!basliklar?.length) return [];
  const url = `https://tr.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(basliklar.slice(0, 3).join('|'))}`;
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
  const baglam = await vikiGirisleri(olay.konular);
  const istek = [
    `Tarih: ${gunAdi(ay, gun)} ${yilYaz(olay.yil)}`,
    `Kayıt: ${olay.metin}`,
    '',
    baglam.length
      ? baglam.map((b) => `<baglam baslik="${b.baslik}">\n${b.metin}\n</baglam>`).join('\n\n')
      : '(Bağlam metni yok.)',
  ].join('\n');

  const yanit = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(Cikti) },
    system: SISTEM,
    messages: [{ role: 'user', content: istek }],
  });

  if (yanit.stop_reason === 'refusal') throw new Error('model reddetti');
  if (!yanit.parsed_output) throw new Error(`çıktı ayrıştırılamadı (${yanit.stop_reason})`);
  return yanit.parsed_output;
}

function hedefGunler(args) {
  if (args.includes('--hepsi')) return tumGunler();
  const i = args.indexOf('--gun');
  if (i >= 0) {
    const [ay, gun] = args[i + 1].split('-').map(Number);
    return [{ ay, gun }];
  }
  let d = istanbulBugun();
  const liste = [{ ay: d.ay, gun: d.gun }];
  for (let k = 0; k < 7; k++) { d = komsuGun(d.ay, d.gun, 1); liste.push(d); }
  return liste;
}

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
let kalan = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
let yazilan = 0;
let hata = 0;

for (const { ay, gun } of hedefGunler(args)) {
  if (kalan <= 0) break;
  const dosya = path.join(VERI_DIZINI, `${gunAnahtar(ay, gun)}.json`);
  let veri;
  try { veri = JSON.parse(await fs.readFile(dosya, 'utf8')); } catch { continue; }

  let degisti = false;
  for (const olay of veri.olaylar) {
    if (olay.ozet || olay.durum === 'incele' || kalan <= 0) continue;
    try {
      const c = await olayYaz(ay, gun, olay);
      olay.baslik = c.baslik;
      olay.ozet = c.ozet;
      olay.kategori = c.kategori;
      // Düşük güvenli yazılar yayınlanmaz, elle incelenir
      olay.durum = c.guven === 'yuksek' ? 'yayinda' : 'incele';
      degisti = true;
      yazilan++;
      kalan--;
      console.log(`${olay.durum === 'yayinda' ? '✓' : '?'} ${gunAdi(ay, gun)} ${olay.yil}: ${c.baslik}`);
    } catch (e) {
      hata++;
      if (e instanceof Anthropic.AuthenticationError) {
        console.error('ANTHROPIC_API_KEY geçersiz ya da tanımlı değil.');
        process.exit(1);
      }
      console.error(`✗ ${gunAdi(ay, gun)} ${olay.yil}: ${e.message}`);
    }
  }
  if (degisti) await fs.writeFile(dosya, JSON.stringify(veri, null, 2) + '\n');
}

console.log(`\n${yazilan} özet yazıldı, ${hata} hata.`);
if (hata) process.exitCode = 1;
