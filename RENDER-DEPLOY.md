# Render / Vercel / Heroku Deployment Guide

## Neden Peak.fo işe yaramaz?

Karşılaştığımız 403 hatası **Cloudflare Turnstile/CAPTCHA değil**, Spotify'ın Fastly Varnish katmanındaki (Error 54113) **datacenter IP kara listesidir**. Peak.fo ve benzeri CAPTCHA solver'lar bu engeli **aşamaz** çünkü ortada çözülecek bir meydan okuma yok — istek doğrudan IP ASN bazlı reddediliyor.

## Render'da ÇALIŞACAK Yöntem: OAuth Refresh Token

Spotify'ın **`accounts.spotify.com`** endpoint'i Fastly tarafından engellenmiyor. OAuth Authorization Code flow ile alacağınız **refresh_token**'ı sunucunuza koyduğunuzda datacenter IP'den bile sorunsuz access token üretip canvaz-cache'e erişebilirsiniz.

### Adım adım kurulum

#### 1. Spotify Developer Dashboard'dan App oluştur
1. https://developer.spotify.com/dashboard adresine git
2. "Create app" → Redirect URI olarak **`http://localhost:8888/callback`** ekle
3. Oluşturduktan sonra **Client ID** ve **Client Secret**'i kopyala

#### 2. Refresh token üret (tek seferlik)
Lokalinde şu komutu çalıştır:
```bash
cd server
npm install
node scripts/generate-refresh-token.mjs
```
- Script senin Client ID / Secret'ını soracak
- Tarayıcını Spotify login sayfası açacak
- Giriş yapıp yetkilendir
- Terminalde `SPOTIFY_REFRESH_TOKEN=...` çıktısını göreceksin

#### 3. Render environment variables'ı ayarla
Render Dashboard → Service → **Environment** bölümüne şu değişkenleri ekle:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SPOTIFY_CLIENT_ID` | Dashboard'dan kopyaladığın Client ID |
| `SPOTIFY_CLIENT_SECRET` | Client Secret |
| `SPOTIFY_REFRESH_TOKEN` | Script'ten çıkan refresh_token |
| `SPOTIFY_SP_DC` | *(opsiyonel, ev IP'de çalışıyorsan kullanabilirsin)* |

> `sp_dc` çerezini Render'da KULLANMA — `open.spotify.com/get_access_token` datacenter IP'lerden 403 döner. Refresh token metodu her zaman çalışır.

#### 4. Deploy et
```
Build command:  cd server && npm install
Start command:  node server/index.js
```

## Alternatif: Residential Proxy (eğer refresh token kullanmak istemiyorsan)

BrightData, Oxylabs veya Smartproxy gibi residential proxy servislerinden bir proxy URL al ve `.env`'ye ekle:
```
HTTPS_PROXY=http://user:pass@gate.smartproxy.com:7000
```
Sunucu otomatik olarak `sp_dc` cookie değişimini bu proxy üzerinden yapacaktır. Bu seçenek aylık ek maliyet getirir, **refresh token metodu ücretsizdir**.

## Hangi auth metodu hangi ortamda çalışır?

| Yöntem | Lokal (ev interneti) | Render/Vercel/AWS | Açıklama |
|---|---|---|---|
| OAuth Refresh Token | ✅ | ✅ | **Tavsiye edilen**, ücretsiz, kalıcı |
| sp_dc cookie (doğrudan) | ✅ | ❌ 403 Fastly | Sadece residential IP'de |
| sp_dc + Residential Proxy | ✅ | ✅ | Proxy ücreti gerekir |
| Client-token only | ✅ | ✅ | canvaz-cache için **yetersiz** (401 döner) |
| Peak.fo (CAPTCHA solver) | ❌ | ❌ | Cloudflare çözücüsü; Fastly 54113 için işe yaramaz |

## Doğrulama

Deploy sonrası health endpoint'ine bak:
```bash
curl https://your-app.onrender.com/api/health
```
Şu yanıtı görmelisin:
```json
{
  "status": "ok",
  "auth": {
    "oauth_refresh_token": true,
    "sp_dc_cookie": false,
    "https_proxy": false
  }
}
```
Canvas endpoint'i artık tüm şarkılar için gerçek `.mp4` URL'si döndürecektir.
