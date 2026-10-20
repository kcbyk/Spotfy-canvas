#!/usr/bin/env node
/**
 * ONE-TIME setup helper: obtain a Spotify OAuth REFRESH_TOKEN that you can put
 * in your .env file (SPOTIFY_REFRESH_TOKEN).
 *
 * WHY? Render / Vercel / AWS / any datacenter IP is blocked by Fastly when you
 * try to hit open.spotify.com/get_access_token with sp_dc cookie (Error 54113).
 * The OFFICIAL accounts.spotify.com OAuth endpoint is NOT blocked and works
 * perfectly from any IP, but it requires a refresh_token from a one-time
 * Authorization Code grant.
 *
 * Usage:
 *   1. Go to https://developer.spotify.com/dashboard and create an app.
 *      Set redirect URI to: http://localhost:8888/callback
 *   2. Run this script:  node scripts/generate-refresh-token.mjs
 *   3. Paste Client ID and Client Secret when prompted.
 *   4. Visit the printed URL in your browser, log in and authorize.
 *   5. Script will output REFRESH_TOKEN — put it in your .env.
 */

import http from 'node:http';
import { URL } from 'node:url';
import open from 'node:open';
import fetch from 'node-fetch';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PORT = 8888;
const HOST = '127.0.0.1'; // Spotify 2025: "localhost" not-secure, "127.0.0.1" IS accepted as secure loopback
const SCOPES = [
  'user-read-email',
  'user-read-private',
  'streaming',
].join(' ');

async function main() {
  const rl = readline.createInterface({ input, output });
  const clientId     = process.env.SPOTIFY_CLIENT_ID     || (await rl.question('Client ID: '));
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || (await rl.question('Client Secret: '));
  rl.close();

  const server = http.createServer();
  await new Promise(resolve => server.listen(PORT, HOST, resolve));

  const authUrl =
    `https://accounts.spotify.com/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: `http://${HOST}:${PORT}/callback`,
      show_dialog: 'true'
    }).toString();

  console.log('\n▶ Tarayıcıda şu URL\'yi açın (otomatik açılmazsa elle kopyalayın):');
  console.log('\n\x1b[36m' + authUrl + '\x1b[0m\n');
  console.log('   ⚠️  Spotify Dashboard → Settings → Redirect URIs bölümüne ŞUNU ekleyin:');
  console.log('   \x1b[33mhttp://127.0.0.1:8888/callback\x1b[0m  (localhost yerine 127.0.0.1 kullanın!)\n');
  try { await open(authUrl); } catch { /* tarayıcı yoksa yukarıdaki URL'yi kullanıcı açsın */ }

  const code = await new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname === '/callback') {
        const c = url.searchParams.get('code');
        const err = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (c) {
          res.end('<h2 style="font-family:sans-serif">✓ Yetkilendirme başarılı. Bu pencereyi kapatabilirsiniz.</h2>');
          resolve(c);
        } else {
          res.end(`<h2 style="font-family:sans-serif;color:red">Hata: ${err || 'code yok'}</h2>`);
          reject(new Error(err || 'No code returned'));
        }
        server.close();
      }
    });
    setTimeout(() => reject(new Error('Timeout: 120 saniyede callback alınamadı')), 120_000);
  });

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://${HOST}:${PORT}/callback`
    })
  });

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error('\n❌ Refresh token alınamadı:', tokens);
    process.exit(1);
  }

  console.log('\n────────────────────────────────────────────');
  console.log('✅ Aşağıdaki değerleri .env dosyanıza yazın:');
  console.log('────────────────────────────────────────────');
  console.log(`SPOTIFY_CLIENT_ID=${clientId}`);
  console.log(`SPOTIFY_CLIENT_SECRET=${clientSecret}`);
  console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('────────────────────────────────────────────\n');
  console.log('Access token expires in', tokens.expires_in, 'saniye, refresh_token kalıcıdır.');
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
