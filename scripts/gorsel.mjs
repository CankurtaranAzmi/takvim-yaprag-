// Olaylar için Wikimedia Commons'tan serbest lisanslı görsel bulur.
// Olayın bağlantılı Vikipedi maddelerinin ana görsellerine bakar, bayrak/logo/harita gibi
// temsili olmayan görselleri eler, lisans ve yazar bilgisini kaydeder.

const UA = 'TakvimYapragiBot/1.0 (https://takvimyapragi.com; iletisim@takvimyapragi.com)';

// Olayı anlatmayan, sadece "konu"yu simgeleyen görseller
const ELE = /\.svg$|flag|bayra[ğg]|coat[_ ]of[_ ]arms|(?:^|[_ -])armas[ıi](?:[_ .-]|$)|emblem|amblem|seal[_ ]of|logo|icon|favicon|locator|location[_ ]map|harita|map[_ .]|signature|imza/i;

async function api(host, params) {
  const url = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
  return res.json();
}

function parcala(dizi, n) {
  const out = [];
  for (let i = 0; i < dizi.length; i += n) out.push(dizi.slice(i, i + n));
  return out;
}

function htmlSok(s = '') {
  return s
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Madde başlığı -> ana görsel dosya adı (yalnızca serbest lisanslı) */
async function maddeGorselleri(basliklar) {
  const sonuc = new Map();
  for (const grup of parcala([...new Set(basliklar)], 50)) {
    const j = await api('tr.wikipedia.org', {
      action: 'query', prop: 'pageimages', piprop: 'name', pilicense: 'free', redirects: '1', titles: grup.join('|'),
    });
    const yonlendirme = new Map();
    for (const r of j.query?.normalized ?? []) yonlendirme.set(r.to, r.from);
    for (const r of j.query?.redirects ?? []) yonlendirme.set(r.to, yonlendirme.get(r.from) ?? r.from);
    for (const p of j.query?.pages ?? []) {
      if (!p.pageimage) continue;
      sonuc.set(yonlendirme.get(p.title) ?? p.title, p.pageimage);
    }
  }
  return sonuc;
}

/** Commons dosya adı -> { url, kucukUrl, genislik, yukseklik, yazar, lisans, lisansUrl, kaynak, aciklama } */
async function dosyaBilgileri(dosyalar) {
  const sonuc = new Map();
  for (const grup of parcala([...new Set(dosyalar)], 50)) {
    const j = await api('commons.wikimedia.org', {
      action: 'query', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '960',
      iiextmetadatafilter: 'LicenseShortName|Artist|LicenseUrl|ImageDescription|NonFree',
      titles: grup.map((d) => `File:${d}`).join('|'),
    });
    const ad = new Map((j.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of j.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue; // Commons'ta değil (yerel yüklenmiş) -> kullanma
      const m = ii.extmetadata ?? {};
      if (m.NonFree?.value === 'true' || !m.LicenseShortName) continue;
      if (ii.width < 400) continue;
      const temiz = (u) => u?.split('?')[0];
      const url = temiz(ii.thumburl ?? ii.url);
      const genislik = Math.min(ii.width, 960);
      const yukseklik = Math.round((ii.height / ii.width) * genislik);
      if (yukseklik / genislik > 2.2 || genislik / yukseklik > 3) continue; // çok uzun şeritler
      const dosya = (ad.get(p.title) ?? p.title).replace(/^File:/, '');
      let yazar = htmlSok(m.Artist?.value);
      if (!yazar || /^unknown( author)?$/i.test(yazar)) yazar = 'Bilinmeyen yazar';
      sonuc.set(dosya.replace(/ /g, '_'), {
        url,
        kucukUrl: url.includes('/960px-') ? url.replace('/960px-', '/500px-') : url,
        genislik,
        yukseklik,
        orijinalGenislik: ii.width,
        yazar: yazar.slice(0, 140),
        lisans: m.LicenseShortName.value,
        lisansUrl: m.LicenseUrl?.value ?? null,
        kaynak: ii.descriptionurl,
        aciklama: htmlSok(m.ImageDescription?.value).slice(0, 200) || null,
      });
    }
  }
  return sonuc;
}

/**
 * gorsel alanı hiç tanımlı olmayan olaylara görsel arar.
 * gorsel: null  -> aranmış, bulunamamış (ya da elle kapatılmış), tekrar aranmaz.
 */
export async function gorselleriBul(olaylar, { yenile = false } = {}) {
  const hedef = olaylar.filter((o) => yenile || o.gorsel === undefined);
  if (!hedef.length) return 0;

  const maddeler = await maddeGorselleri(hedef.flatMap((o) => o.konular ?? []));
  const adaylar = new Map(); // olay -> [{ dosya, konu }]
  for (const o of hedef) {
    const d = (o.konular ?? [])
      .map((konu) => ({ konu, dosya: maddeler.get(konu) }))
      .filter((x) => x.dosya && !ELE.test(x.dosya));
    adaylar.set(o, d.filter((x, i) => d.findIndex((y) => y.dosya === x.dosya) === i));
  }
  const bilgiler = await dosyaBilgileri([...adaylar.values()].flat().map((x) => x.dosya));

  let bulunan = 0;
  const kullanilan = new Set(olaylar.filter((o) => !hedef.includes(o) && o.gorsel).map((o) => o.gorsel.kaynak));
  for (const [o, liste] of adaylar) {
    // Aynı günde aynı görseli iki olayda tekrar etme
    const uygun = liste
      .map(({ konu, dosya }) => {
        const b = bilgiler.get(dosya.replace(/ /g, '_'));
        return b && { ...b, konu };
      })
      .filter((b) => b && !kullanilan.has(b.kaynak))
      .slice(0, 3);
    o.gorsel = uygun[0] ?? null;
    // Özeti henüz yazılmamış olaylarda adaylar saklanır; ozet-yaz en uygununu seçip listeyi siler
    if (uygun.length > 1 && !o.ozet) o.gorselAdaylari = uygun;
    else delete o.gorselAdaylari;
    if (o.gorsel) { kullanilan.add(o.gorsel.kaynak); bulunan++; }
  }
  return bulunan;
}
