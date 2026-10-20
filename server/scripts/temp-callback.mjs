// Lightweight temporary callback server — no `open` dep, no readline prompts.
// Exchanges the ?code= query parameter for an access_token + refresh_token.
import http from 'node:http';
import { URL } from 'node:url';
import fetch from 'node-fetch';

const PORT = 8888;
const HOST = '127.0.0.1';
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = `http://${HOST}:${PORT}/callback`;

const SCOPES = ['user-read-email','user-read-private','streaming'].join(' ');

const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  scope: SCOPES,
  redirect_uri: REDIRECT_URI,
  show_dialog: 'true'
}).toString();

console.log('AUTH_URL=' + authUrl);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    if (!code) {
      res.writeHead(400, {'Content-Type':'text/html; charset=utf-8'});
      res.end(`<h2>Hata: ${err || 'code yok'}</h2>`);
      server.close();
      process.exit(1);
    }
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });
    const tokens = await tokenRes.json();
    if (tokens.refresh_token) {
      console.log('SPOTIFY_REFRESH_TOKEN=' + tokens.refresh_token);
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end('<h1 style="font-family:sans-serif;color:green">✓ Başarılı! Bu pencereyi kapatıp Arena\'ya dönebilirsin.</h1>');
    } else {
      console.log('ERROR=' + JSON.stringify(tokens));
      res.writeHead(500, {'Content-Type':'text/html; charset=utf-8'});
      res.end('<h2>Taken alınamadı, konsolu kontrol et.</h2>');
    }
    server.close(() => process.exit(0));
  } else {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CALLBACK_SERVER_READY http://${HOST}:${PORT}`);
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 180_000);
