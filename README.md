# Takvim Yaprağı

"Tarihte bugün" sitesi: her gün için o tarihte yaşanmış tarihi olayları (Vikipedi) ve geçmiş
yıllarda aynı gün yayınlanmış haberleri (Cumhuriyet arşivi) gösterir. İçerik tamamen otomatik
toplanır, yapay zekayla özgün Türkçe metne dönüştürülür ve günlük olarak kendini günceller.

## Altyapı — neyle çalışıyor

- **[Astro](https://astro.build) 7** — statik site üretici (SSG). Sunucu tarafı çalışma zamanı
  yok; `npm run build` her sayfayı düz HTML/CSS olarak `dist/` klasörüne üretir. Bu yüzden
  barındırma için Node.js gerekmez — üretilen dosyalar herhangi bir statik hostinge (cPanel,
  Cloudflare Pages, GitHub Pages, Netlify...) doğrudan atılabilir.
- **Veri katmanı = düz JSON dosyaları.** Veritabanı yok. Her gün `src/data/gunler/MM-DD.json`
  dosyasında tutulur (olaylar, doğumlar, ölümler, özel günler, haberler). Astro bunları derleme
  anında `import.meta.glob` ile okur (`src/lib/veri.mjs`).
- **Google Gemini API** (ücretsiz plan) — kaynak metinleri özgün Türkçe başlık/özete çevirir,
  önemsiz haberleri eler, görsel seçer. Model: `gemini-3.1-flash-lite` (bkz. "Model notları").
- **Wikimedia Commons** — tüm görseller buradan **serbest lisanslı** olarak hotlink edilir
  (kendi sunucumuza hiç görsel yüklenmez). Haber fotoğrafları kaynak sitenin (Cumhuriyet)
  telifli görseli **değildir** — bilinçli bir tercih, bkz. "Neden Wikimedia görseli".
- **Fontlar** self-hosted (`@fontsource/barlow-condensed`, `@fontsource-variable/manrope`) —
  Google Fonts'a dış istek yok.
- **GitHub Actions** — günlük içerik toplama + yayına alma otomasyonu (henüz kurulmadıysa
  "GitHub Actions kurulumu" bölümüne bakın).

## Veri akışı — sırayla ne çalışıyor

```
1. scripts/wiki-cek.mjs    Vikipedi'nin "27 Eylül" gibi gün maddelerinden
                            olay/doğum/ölüm/özel-gün listelerini çeker.
                            → src/data/gunler/09-27.json içine "olaylar" yazar (durum: bekliyor)

2. scripts/haber-cek.mjs   Cumhuriyet gazetesinin aylık site haritalarından (1962'ye kadar
                            gider) geçmiş 15 yılın aynı gününde yayınlanmış, önem puanına göre
                            seçilmiş haberleri çeker (başlık + kısa açıklama + kaynak linki).
                            → aynı dosyaya "haberler" yazar (durum: haber, HENÜZ YAYINDA DEĞİL)

3. scripts/ozet-yaz.mjs    Gemini ile hem "olaylar" hem "haberler"i işler:
                            - Kendi cümleleriyle özgün başlık + 2-3 paragraf özet yazar
                              (kaynak metin kopyalanmaz)
                            - scripts/gorsel.mjs ile Wikimedia Commons'tan serbest lisanslı
                              görsel arar, en uygununu AI seçer
                            - Önemsiz haberleri eler (durum: elendi)
                            - Türkçe karakter kontrolünden geçemeyen çıktıyı otomatik
                              yeniden dener, yine geçemezse yayınlamaz (durum: incele)
                            - Başarılı olanları yayına açar (durum: yayinda / yazildi)

4. npm run build            Astro, yalnızca en az 3 tamamlanmış (tıklanabilir) kaydı olan
                            günlerin sayfasını üretir. Botun henüz işlemediği gün varsa
                            sayfası hiç oluşmaz — boş/yarım sayfa riski yok.
```

Bu 3 script birbirinden bağımsız çalışır ve **idempotent**tir: aynı günü tekrar çekmek var olan
özetleri silmez, sadece eksikleri tamamlar. Bu yüzden günlük otomasyon her gün 1-3 scripti
sırayla çalıştırıp üstüne yazabilir.

### `durum` alanı — içeriğin yaşam döngüsü

| Kayıt türü | `durum` | Anlamı | Sitede görünür mü? |
|---|---|---|---|
| Vikipedi olayı | `bekliyor` | Henüz AI'dan geçmedi, ham kayıt | Hayır |
| Vikipedi olayı | `yayinda` | Özgün özet yazıldı, onaylandı | **Evet**, `/olay/{id}/` |
| Vikipedi olayı | `incele` | AI kalitesinden emin değil (Türkçe karakter şüphesi vb.) | Hayır |
| Haber | `haber` | Cumhuriyet'ten çekildi, henüz AI'dan geçmedi | Hayır |
| Haber | `yazildi` | Özgün başlık/özet yazıldı | **Evet**, `/olay/{id}/` |
| Haber | `elendi` | AI önemsiz buldu (parti demeci, hizmet haberi vb.) | Hayır |
| Haber | `incele` | Türkçe karakter kontrolünden geçemedi | Hayır |

Bir kaydı elle düzeltmek için ilgili `src/data/gunler/MM-DD.json` dosyasını açıp `durum`u
değiştirin ya da `ozet` alanını `null` yapıp scripti tekrar çalıştırın (yeniden yazar).

### Neden Wikimedia görseli (haber fotoğrafı değil)

Haberin kendi fotoğrafı Cumhuriyet'in/ajansların telifli görseli olur — bunu kullanmak hem
telif riski hem AdSense'in "izinsiz/telifli içerik" reddi riski taşır. Bunun yerine AI, haberin
konusuyla ilgili (kişi/kurum/olay) bir Wikimedia Commons maddesini bulur ve **yalnızca serbest
lisanslı** (kamu malı, CC BY, CC BY-SA) bir görsel varsa kullanır; yoksa haber görselsiz kalır
ve **sitede hiç gösterilmez** (`scripts/gorsel.mjs`, `veri.mjs`'deki `gorsel` şartı).

### Haberler neden dış siteye değil kendi sayfamıza açılıyor

İlk sürümde haber kartları doğrudan Cumhuriyet'in sayfasına yönlendiriyordu. Bu hem trafiği
kaçırıyordu hem de AdSense/SEO açısından yanlıştı (reklam gösterilecek kendi sayfamız yok
oluyordu, sitemap'e giremiyordu). Artık her haber de Vikipedi olayları gibi kendi
`/olay/{id}/` sayfasına sahip; kaynak siteye yalnızca sayfanın altında küçük bir "Haber
kaynağı: Cumhuriyet" notu olarak bağlanılıyor (`src/pages/olay/[slug].astro`).

## Klasör yapısı

| Yol | Ne işe yarar |
|---|---|
| `src/data/gunler/MM-DD.json` | Tek doğruluk kaynağı: bir günün tüm verisi |
| `scripts/wiki-cek.mjs` | Vikipedi'den olay/doğum/ölüm listesi çeker |
| `scripts/haber-cek.mjs` | Cumhuriyet arşivinden geçmiş yılların haberlerini seçer |
| `scripts/haber-temizle.mjs` | Eski/hatalı haber kayıtlarını temizler (bkz. dosya içi yorum) |
| `scripts/ozet-yaz.mjs` | Gemini ile özgün metin yazar, görsel seçer, kalite kontrolü yapar |
| `scripts/gorsel.mjs` | Wikimedia Commons'ta serbest lisanslı görsel arama mantığı |
| `src/lib/veri.mjs` | Tüm JSON dosyalarını derleme anında okuyup filtreler (yayın kararı burada) |
| `src/lib/tarih.mjs` | Tarih/slug yardımcıları, gün penceresi hesaplama |
| `src/pages/[gun].astro` | `/27-eylul/` gün sayfası şablonu |
| `src/pages/olay/[slug].astro` | `/olay/{id}/` olay ve haber sayfası şablonu (ortak) |
| `src/pages/takvim.astro` | Tüm yılın takvim görünümü |
| `src/components/` | `GunIcerik` (manşet+kartlar), `OlayKart`, `GunSec` (gün seçici) |
| `public/.htaccess` | cPanel için HTTPS yönlendirmesi, önbellek, eski WP adresi yönlendirmeleri |
| `.github/workflows/icerik.yml` | Günlük: veri çeker + AI ile yazar + PR açar |
| `.github/workflows/yayinla.yml` | PR birleşince: derler + FTP ile cPanel'e yükler |

## Gün penceresi

Site her an yalnızca **bugünden 10 gün önce ile 10 gün sonrası** arasını kapsar (21 gün,
`gunPenceresi()` fonksiyonu, `src/lib/tarih.mjs`). Pencere her gün otomatik bir gün kayar; botun
o güne henüz sıra vermediği yeni gün, dolana kadar sitede "yakında" görünür (404 vermez,
`src/lib/veri.mjs`'deki `ASGARI_OLAY = 3` şartı sayesinde boş sayfa da hiç oluşmaz). Pencereyi
değiştirmek için `gunPenceresi(once, sonra)` çağrısındaki varsayılanları güncelleyin.

## Komutlar

```bash
npm run dev                        # yerel önizleme → http://localhost:4321
npm run cek                        # Vikipedi: gün penceresi (10 önce – 10 sonra)
npm run cek -- --hepsi             # Vikipedi: 366 günün tamamı (ilk kurulumda bir kez)
npm run cek -- --gun 09-27         # Vikipedi: tek gün
npm run haber                      # Cumhuriyet arşivi: gün penceresi
npm run haber -- --gun 09-27       # Cumhuriyet arşivi: tek gün (yeniden seçer)
npm run ozet -- --gun 09-27        # Gemini ile o günün eksik özetlerini yazar (GEMINI_API_KEY gerekir)
npm run ozet -- --limit 500        # Gemini ile tüm pencereyi işler (kota bitene kadar)
npm run build                      # dist/ üretir — bu klasörün içeriği = barındırılacak site
npm run preview                    # dist/'i yerel olarak sun (üretim davranışını test etmek için)
```

`ANTHROPIC_API_KEY`'e ihtiyaç **yoktur** — tüm AI adımları ücretsiz Gemini API kullanır.

### Model notları (Gemini ücretsiz kota)

Google'ın ücretsiz planında **her model kendi günlük kota sayacına sahiptir** (aynı API
anahtarıyla farklı modeller ayrı ayrı ~500 istek/gün hakkı verir). `gemini-flash-lite-latest`
bazı çağrılarda Türkçe özel karakterleri (ı, ğ, ş, ç, ö, ü) hiç üretmeden ASCII yazabiliyor —
`scripts/ozet-yaz.mjs` bunu tespit edip otomatik yeniden dener, 3 denemede de düzelmezse kaydı
`incele` durumuna düşürüp yayınlamaz (bkz. `turkceGecerliMi` fonksiyonu). `gemini-3.1-flash-lite`
bu sorunu göstermedi ve şu anki varsayılan model bu. Kota dolarsa `GEMINI_MODEL` ortam
değişkeniyle listedeki başka bir modele geçip devam edilebilir — kullanılabilir modelleri görmek
için:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY" \
  | grep -o '"name": "models/gemini[^"]*flash[^"]*"'
```

## GitHub Actions kurulumu

**Secrets** (Settings → Secrets and variables → Actions → New repository secret):
- `GEMINI_API_KEY` — aistudio.google.com/apikey adresinden ücretsiz alınır
- `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` — cPanel hesabının FTP bilgileri

**Variables** (aynı sayfada, Variables sekmesi — opsiyonel):
- `GEMINI_MODEL` — varsayılan `gemini-3.1-flash-lite`
- `FTP_DIZIN` — varsayılan `./` (FTP hesabı doğrudan `public_html`'i açıyorsa)

**İki iş akışı:**
1. **`icerik.yml`** (her gün 09:00 İstanbul) — pencereyi çeker, Gemini ile yazar, derler,
   bir Pull Request açar. PR'ı incelemek ve birleştirmek editör onayı yerine geçer.
2. **`yayinla.yml`** (her PR birleşiminde + her gece 00:05) — derler ve FTP ile cPanel'e yükler.

## Barındırma

Astro düz statik dosya ürettiği için Node.js çalıştıran bir sunucu **gerekmez**. `dist/`
klasörünün içeriği doğrudan `public_html`'e (ya da Cloudflare Pages / GitHub Pages / Netlify
gibi herhangi bir statik hostinge) kopyalanabilir. `public/.htaccess` cPanel/Apache'ye özel
ayarları içerir (HTTPS zorlama, eski WordPress adreslerinin yönlendirmesi, önbellek süreleri) —
başka bir hostinge geçilirse bu ayarların o platformun kendi mekanizmasına (örn. Cloudflare
Pages `_redirects` dosyası) taşınması gerekir.

## SEO / AdSense ile ilgili tasarım kararları

- Her sayfa benzersiz `<title>`, meta açıklama ve `BreadcrumbList`/`Article`/`NewsArticle`
  JSON-LD içerir (`src/layouts/Base.astro`, `src/pages/olay/[slug].astro`).
- Görselsiz ya da AI'dan geçmemiş hiçbir kayıt hiçbir ortamda (dev/prod fark etmeksizin)
  gösterilmez — tıklanamayan kart ya da kaynak-metniyle-duran içerik riski yok.
- Dış bağlantılar (`haberKaynagi.url`) `rel="noopener nofollow"` taşır.
- Çerez onay penceresi (CMP) kod tarafında hazır (`adsbygoogle.js` yüklü, `ads.txt` doğru) ama
  gerçekten görünmesi **AdSense hesabı onaylandıktan sonra panelden "Gizlilik ve mesajlaşma"
  özelliğinin açılmasına bağlıdır** — ek kod gerekmez, bu bir hesap/panel adımıdır.
- 366 günün tamamı yerine yalnızca dolu güne sahip gün penceresi yayınlanır (bkz. "Gün
  penceresi") — hiçbir zaman boş/yarım bir sayfa Google'a görünmez.
