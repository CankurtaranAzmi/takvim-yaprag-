# Takvim Yaprağı

"Tarihte bugün" sitesi — Astro ile statik üretilir, cPanel'e FTP ile yüklenir.

## Yapı

| Yol | Ne |
|---|---|
| `src/data/gunler/MM-DD.json` | Her günün verisi (olaylar, doğumlar, ölümler, özel günler) |
| `scripts/wiki-cek.mjs` | Vikipedi gün maddelerinden listeleri çeker (özetleri korur) |
| `scripts/haber-cek.mjs` | Geçmiş 15 yılın aynı gününde yayınlanmış haberleri Cumhuriyet'in aylık arşiv haritalarından seçer (başlık + kısa açıklama + görsel + bağlantı) |
| `scripts/gorsel.mjs` | Olayın bağlantılı Vikipedi maddelerinden Commons görseli bulur (yalnızca serbest lisans; bayrak/logo/harita elenir), en fazla 3 aday saklar |
| `scripts/ozet-yaz.mjs` | Özeti olmayan olaylara Gemini (ücretsiz) ile özgün özet + başlık + kategori yazar |
| `src/pages/[gun].astro` | `/27-eylul/` gün sayfaları |
| `src/pages/olay/[slug].astro` | `/olay/.../` olay sayfaları (yalnızca `durum: "yayinda"` olanlar) |
| `public/.htaccess` | HTTPS, eski WordPress adreslerinin yönlendirmesi, önbellek |

Görseller Wikimedia sunucusundan gösterilir (hotlink), yazar + lisans her görselin altında yazar. `ozet-yaz` adaylardan olaya en uygununu seçer ya da hiçbiri uygun değilse `gorsel: null` yapar. Bir görseli elle kapatmak için `"gorsel": null` yazın.

Olay `durum` alanı: `bekliyor` (özet yok, sadece listede görünür) · `yayinda` (olay sayfası üretilir) · `incele` (model emin değil, yayınlanmaz).

## Komutlar

```bash
npm run dev                       # http://localhost:4321
npm run cek                       # 10 gün öncesi – 10 gün sonrası
npm run cek -- --hepsi            # 366 gün
npm run ozet -- --gun 09-27       # GEMINI_API_KEY gerekir (ücretsiz)
npm run build                     # dist/ klasörü = public_html içeriği
```

## GitHub kurulumu

Secrets: `GEMINI_API_KEY` (aistudio.google.com/apikey, ücretsiz), `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`
Variables (isteğe bağlı): `GEMINI_MODEL` (varsayılan `gemini-3.1-flash-lite`), `FTP_DIZIN` (varsayılan `./` — FTP hesabı doğrudan public_html'i açıyorsa)

- **Günlük içerik** (09:00): veri çeker, özet yazar, PR açar → PR'ı birleştirmek = onay.
- **Yayınla**: main'e her birleştirmede + her gece 00:05'te derleyip FTP ile yükler.
