# Takvim Yaprağı

"Tarihte bugün" sitesi — Astro ile statik üretilir, cPanel'e FTP ile yüklenir.

## Yapı

| Yol | Ne |
|---|---|
| `src/data/gunler/MM-DD.json` | Her günün verisi (olaylar, doğumlar, ölümler, özel günler) |
| `scripts/wiki-cek.mjs` | Vikipedi gün maddelerinden listeleri çeker (özetleri korur) |
| `scripts/ozet-yaz.mjs` | Özeti olmayan olaylara Claude ile özgün özet + başlık + kategori yazar |
| `src/pages/[gun].astro` | `/27-eylul/` gün sayfaları |
| `src/pages/olay/[slug].astro` | `/olay/.../` olay sayfaları (yalnızca `durum: "yayinda"` olanlar) |
| `public/.htaccess` | HTTPS, eski WordPress adreslerinin yönlendirmesi, önbellek |

Olay `durum` alanı: `bekliyor` (özet yok, sadece listede görünür) · `yayinda` (olay sayfası üretilir) · `incele` (model emin değil, yayınlanmaz).

## Komutlar

```bash
npm run dev                       # http://localhost:4321
npm run cek                       # bugün + 7 gün
npm run cek -- --hepsi            # 366 gün
npm run ozet -- --gun 09-27       # ANTHROPIC_API_KEY gerekir
npm run build                     # dist/ klasörü = public_html içeriği
```

## GitHub kurulumu

Secrets: `ANTHROPIC_API_KEY`, `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`
Variables (isteğe bağlı): `CLAUDE_MODEL` (varsayılan `claude-opus-5`), `FTP_DIZIN` (varsayılan `./` — FTP hesabı doğrudan public_html'i açıyorsa)

- **Günlük içerik** (09:00): veri çeker, özet yazar, PR açar → PR'ı birleştirmek = onay.
- **Yayınla**: main'e her birleştirmede + her gece 00:05'te derleyip FTP ile yükler.
