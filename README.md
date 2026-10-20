# Spotify Canvas — Static CDN Mapping

Premium hesap zorunluluğu, datacenter IP blokları, OAuth token yenileme ve WAF
engellerini TAMAMEN ortadan kaldıran, **statik JSON tabanlı** Spotify Canvas
servisı. Harici hiçbir Spotify servisine istek atılmaz — canvas URL'leri doğrudan
`server/data/canvas-database.json` dosyasından okunur.

---

## 📁 Proje Yapısı

```
spotify-canvas/
├── server/
│   ├── index.js                       # Express sunucu
│   ├── routes/canvas.js               # /api/canvas/:trackId route'u
│   └── data/
│       ├── canvas-database.json       # trackId → mp4 URL eþleþmesi
│       └── track-meta.json            # þarký baþlýðý / sanatçý / kapak
├── public/
│   ├── index.html                     # Dikey Now Playing UI
│   ├── css/style.css                  # Glassmorphic UI
│   └── js/app.js                      # Canvas video + YouTube fallback
└── package.json
```

Veritabaný þu anda **22 doðrulanmýþ canvas** içeriyor (Billie Eilish, Ariana Grande,
SZA, The Weeknd, Harry Styles, Doja Cat, NIKI, Flume, Khruangbin, vs.).

---

## 🔌 API

### `GET /api/canvas/:trackId`

**Canvas veritabanında varsa:**
```json
{
  "success": true,
  "trackId": "3OHfY25tqY28d16oZczHc8",
  "canvasUrl": "https://canvaz.scdn.co/.../32b57cbf....cnvs.mp4",
  "fallbackToYoutube": false,
  "meta": { "title": "Kill Bill", "artist": "SZA", "cover": "https://i.scdn.co/...", "ytQuery": "..." }
}
```

**Veritabanında yoksa:**
```json
{
  "success": false,
  "canvasUrl": null,
  "fallbackToYoutube": true
}
```

**Geçersiz track ID:** HTTP 400.

### `GET /api/canvas/tracks`
Veritabanındaki tüm şarkıların kataloğunu döner (frontend seçim kutusu için).

### `POST /api/canvas/:trackId` (admin)
Yeni canvas eklemek için:
```json
{
  "canvasUrl": "https://canvaz.scdn.co/.../xxxxx.cnvs.mp4",
  "title": "Şarkı Adı",
  "artist": "Sanatçı",
  "cover": "https://i.scdn.co/...",
  "ytQuery": "Sanatçı Şarkı Adı"
}
```
JSON dosyasına otomatik olarak yazar.

---

## ➕ Yeni Canvas Ekleme

Canvas URL'lerini Charles Proxy / mitmproxy ile Spotify mobil uygulamasının trafiğini
dinleyerek `canvaz.scdn.co/upload/...cnvs.mp4` formatında elde edebilirsin. Elde
ettiğin URL'yi:

1. `POST /api/canvas/<trackId>` ile dinamik olarak ekle, **veya**
2. `server/data/canvas-database.json` dosyasını elle düzenleyip satır ekle:
   ```json
   {
     "SPOTIFY_TRACK_ID_22HANE": "https://canvaz.scdn.co/upload/.../xxxxx.cnvs.mp4"
   }
   ```
   Ve `track-meta.json` dosyasına da aynı ID ile meta bilgiyi ekle.

Sunucu development modda çalışırken JSON dosyalarındaki değişiklikler **otomatik
olarak hot-reload** edilir (restart gerekmez).

---

## 🚀 Render Deploy

Bu sürümde Spotify OAuth, `sp_dc` cookie, Premium abonelik veya residential proxy
gerekmez. Sadece:

1. Repo'yu GitHub'a pushla.
2. Render'da yeni Web Service oluştur (Node.js environment).
3. Build Command: `npm install`, Start Command: `npm start`.
4. Environment variable gerekmez — `NODE_ENV=production` yeterli.
5. Deploy et ve kullan!

Health check endpoint (`/api/health`) basit bir JSON yanıt döndürür — ağ dışına
tek bir istek çıkmadığı için sınırsız ölçekte çalışır.

### Test

```bash
# Canvas'ı olan şarkı (mp4 döner)
curl https://your-app.onrender.com/api/canvas/3OHfY25tqY28d16oZczHc8

# Canvas'ı olmayan şarkı (YouTube fallback)
curl https://your-app.onrender.com/api/canvas/0VjIjW4GlUZAMYd2vXMi3b
```

---

## 🎨 Frontend Katman Yapısı (aynı)

| Z   | Katman              | Açıklama                                                                 |
|-----|---------------------|--------------------------------------------------------------------------|
| 1   | `<video>`           | `autoplay muted loop playsinline object-fit: cover` (Canvas mp4)         |
| 2   | YouTube Iframe      | Canvas yoksa otomatik aktif; 220% scale ile dikey cover kırpma           |
| 2.5 | Cover art           | "Plak" modunda dönen albüm kapağı                                        |
| 5   | Gradient overlay    | Okunabilirlik için üst/alt koyu gradyan                                  |
| 10  | Glassmorphic UI     | Canvas↔Plak pill toggle, play/progress/like/skip kontrolleri             |

Canvas yoksa otomatik olarak YouTube arama katmanına düşer; sağ-üstteki pill
buton ile her an video ↔ plak arasında geçiş yapabilirsin.
