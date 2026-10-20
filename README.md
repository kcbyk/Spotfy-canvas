# Spotify Canvas Entegrasyonu

Spotify'ın resmi public API'sinde yer almayan **Canvas** özelliğini (parça başına atanmış dikey kısa videolar) Spotify'ın dahili `canvaz-cache.spotify.com` servisi üzerinden çeken **production-ready** Node.js/Express backend + dikey HTML/CSS/JS "Now Playing" ön yüz.

---

## 📁 Proje Yapısı

```
spotify-canvas/
├── server/
│   ├── index.js               # Express sunucu, CORS/helmet, statik dosya servisi
│   ├── routes/canvas.js       # GET /api/canvas/:trackId route'u
│   └── services/
│       └── spotifyCanvas.js   # Canvaz-cache API'sine istek + Protobuf kodlama/çözme
├── public/
│   ├── index.html             # Dikey Now Playing ekranı (mobil simülasyonu)
│   ├── css/style.css          # Glassmorphic UI, video/yt/cover katmanları
│   └── js/app.js              # İstemci mantığı: canvas yükleme, fallback, kontroller
├── .env.example
└── README.md
```

---

## 🚀 Kurulum & Çalıştırma

```bash
cd server
npm install

# Opsiyonel: sp_dc çerezini ayarla (daha güvenilir sonuçlar için)
cp ../.env.example ../.env
# ../.env dosyasında SPOTIFY_SP_DC= değerini doldur

node index.js
# veya npm run dev (node --watch ile otomatik yeniden başlatma)
```

Sunucu başladığında:

| URL                                  | Açıklama                           |
|--------------------------------------|------------------------------------|
| http://localhost:3000/               | Dikey "Now Playing" UI demosu      |
| http://localhost:3000/api/health     | Sağlık kontrolü                    |
| http://localhost:3000/api/canvas/:id | Canvas URL endpoint'i              |

### `sp_dc` çerezi nasıl alınır?

1. https://open.spotify.com adresine girip oturum açın.
2. DevTools (F12) → **Application** sekmesi → **Cookies** → `https://open.spotify.com`.
3. `sp_dc` isimli çerezin değerini kopyalayıp `.env` dosyasına yapıştırın.
   > ⚠️ `sp_dc` değerinize hiçbir zaman kimseyle paylaşmayın; hesabınıza erişim anahtarıdır.

`sp_dc` ayarlanmadığında sunucu Spotify'ın public "client-token" handshake akışını kullanır — çoğu parçada Canvas sonucu döndürür ama zamanla rate-limit/401 hatalarıyla karşılaşabilirsiniz. Production'da mutlaka `sp_dc` ayarlayın ve periyodik olarak yenileyin.

---

## 🔌 Backend API

### `GET /api/canvas/:trackId`

**Başarılı yanıt (Canvas mevcut):**
```json
{
  "trackId": "4cOdK2wGLETKBW3PvgPWqT",
  "trackUri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "canvasUrl": "https://canvaz.scdn.co/upload/.../xxx.mp4",
  "fallbackToYoutube": false,
  "reason": "FOUND"
}
```

**Canvas bulunamadığında (NULL / 404):**
```json
{
  "trackId": "4cOdK2wGLETKBW3PvgPWqT",
  "trackUri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
  "canvasUrl": null,
  "fallbackToYoutube": true,
  "reason": "NO_CANVAS"
}
```

**Hata durumları:**

| HTTP | error kodu             | Açıklama                                            |
|------|------------------------|-----------------------------------------------------|
| 400  | `INVALID_TRACK_ID`     | Track ID 22-karakterlik alfanümerik formatta değil  |
| 429  | `RATE_LIMITED`         | 60 istek/dakika limiti aşıldı                       |
| 503  | `AUTH_FAILED`          | Spotify auth hatası (sp_dc yenilenmesi gerekebilir) |
| 500  | `CANVAS_FETCH_FAILED`  | Genel hata                                          |

Rate-limiting: IP başına **60 req/dakika**.

### Kimlik doğrulama akışı (`services/spotifyCanvas.js`)

1. `sp_dc` çerezi varsa → `open.spotify.com/get_access_token` üzerinden **Bearer access token** alınır.
2. Yoksa → `clienttoken.spotify.com/v1/clienttoken` endpoint'inden public **client token** alınır (1 saat ömürlü, in-memory cache).
3. Alınan token ile `canvaz-cache.spotify.com/canvaz-cache/v0/canvases` endpoint'ine **Protobuf** encoded POST atılır.
4. Dönen protobuf yanıtı içindeki `.mp4` URL'leri regex ile taranır (CDN hostları: `canvaz.scdn.co`, `*.scdn.co`, `*.spotifycdn.com`).
5. Token süresi dolmuşsa (401) client token yeniden üretilip **otomatik retry** yapılır.

---

## 🎨 Frontend — Dikey "Now Playing" Ekranı

### Z-Index Katman Sırası

| Katman | Z  | İçerik                                                                 |
|--------|----|------------------------------------------------------------------------|
| 1      | 1  | `<video>` Canvas mp4 (autoplay, muted, loop, playsinline, object-fit: cover) |
| 2      | 2  | YouTube Iframe fallback (220% scale ile dikey `cover` kırpma)          |
| 2.5    | 2  | Album cover (Plak modu, döner animasyon)                               |
| Gradient overlay | 5 | Üst/alt koyu gradyan (okunabilirlik)                                   |
| 3      | 10 | Glassmorphic UI kontroller (backdrop-filter blur, pill buton)          |

### Pill Toggle Butonu (Canvas ↔ Plak)

Sağ-üstteki cam-efektli "Canvas" / "Plak" butonuyla kullanıcı video katmanı ile döner albüm kapağı arasında geçiş yapabilir. Butonun ikonu döner animasyonla değişir.

### YouTube Fallback Mantığı

`/api/canvas/:trackId` yanıtında `fallbackToYoutube: true` dönerse:

1. Canvas video layer otomatik olarak gizlenir.
2. YouTube iframe `listType=search&list=<şarkı+sanatı>` ile yüklenir (otoplay, sesiz, loop, kontrolsüz).
3. Iframe 220% × 125% ölçeklenip ortalanarak `object-fit: cover` etkisi yaratılır (dikey viewport'a kırpılır).
4. Toast bildirimi ile kullanıcıya "Canvas bulunamadı · YouTube fallback aktif" mesajı gösterilir.

### Kontroller

- ▶️/⏸ Play-Pause: Canvas videoyu oynatır/duraklatır ve 3:38'lik sahte progress bar'ı çalıştırır.
- ⏭⏮ Önceki/Sonraki (demo amaçlı)
- ❤️ Beğen/Beğenmekten vazgeç (yeşil kalp animasyonu)
- 🔀 Karıştır / 🔁 Tekrar / 📱 Cihaz / 📋 Kuyruk / ↗ Paylaş ikonları

---

## 🔒 Güvenlik & Production Notları

- **Helmet.js** ile CSP header'ları ayarlı (sadece Spotify/YouTube CDN'lerinden medya yüklenir).
- **CORS** production'da `ALLOWED_ORIGIN` ile kısıtlanabilir.
- **Rate limiting** (express-rate-limit) ile istismar önlenmiş.
- `sp_dc` çerezi **asla** istemciye gönderilmez; sadece sunucu tarafında token değişimi için kullanılır.
- Frontend herhangi bir Spotify anahtarı içermez — tüm auth backend'de yapılır.
- YouTube iframe `referrerpolicy=no-referrer` ile yüklenir.
- `NODE_ENV=production` ikonik hata mesajları kullanıcıya detay sızdırmaz.

### Production için öneriler

1. `sp_dc` çerezini bir Redis/database katmanında birden fazla hesap arasında döndürerek kullanın (rate limit aşmamak için).
2. Canvas URL'lerini **CDN/cache** katmanında (Redis, Cloudflare vs.) en az 1 saat önbellekleyin — mükerrer istek atmayın.
3. YouTube fallback için YouTube Data API v3 kullanarak arama yerine direkt video ID cache'leyebilirsiniz (daha hızlı yükleme).
4. Loglama için Pino/Winston ekleyin; `morgan('combined')` production'da yeterli olmayabilir.

---

## 🧪 Test

```bash
# Sunucuyu başlattıktan sonra farklı track ID'ler ile test edin:

curl http://localhost:3000/api/canvas/4cOdK2wGLETKBW3PvgPWqT
# Blinding Lights - The Weeknd (Canvas'ı var)

curl http://localhost:3000/api/canvas/0VjIjW4GlUZAMYd2vXMi3b
# Shape of You - Ed Sheeran
```

Tarayıcıdan http://localhost:3000 adresine gidip sağ-üstteki demo bar'dan istediğiniz track ID'yi girip **Yükle** butonuna basabilirsiniz.

---

## ⚠️ Yasal Uyarı

Spotify'ın dahili Canvas API'si resmi olarak dökümante edilmemiştir ve Spotify'ın Kullanım Şartları'na tabidir. Bu kod yalnızca **eğitim amaçlıdır** ve kişisel/kurumsal hesaplarınızla kullanırken Spotify'ın hizmet şartlarını gözden geçirmeniz önerilir. Ticari kullanım için Spotify'ın resmi partner programlarına başvurmanız gerekebilir.
