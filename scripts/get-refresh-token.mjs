/**
 * One-time local OAuth helper to obtain ANTIGRAVITY_REFRESH_TOKEN for Cloudflare Workers.
 * Usage: node scripts/get-refresh-token.mjs
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { ANTIGRAVITY_SCOPES } from '../src/oauth.js';

const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID;
const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET env vars first.');
  process.exit(1);
}

const PORT = 11451;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const STATE = crypto.randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', ANTIGRAVITY_SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', STATE);

console.log('\n1. Buka URL berikut di browser dan login dengan akun Google Antigravity kamu:\n');
console.log(authUrl.toString());
console.log('\nMenunggu callback di ' + REDIRECT_URI + ' ...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', REDIRECT_URI);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`OAuth error: ${error}`);
    console.error('OAuth error:', error);
    server.close();
    return;
  }

  if (!code || state !== STATE) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code or invalid state.');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      throw new Error(JSON.stringify(data));
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Berhasil!</h2><p>Refresh token sudah dicetak di terminal. Kamu boleh menutup tab ini.</p>');

    console.log('=== BERHASIL! ===');
    console.log('Simpan refresh token ini ke Cloudflare Worker secret:');
    console.log('  npx wrangler secret put ANTIGRAVITY_REFRESH_TOKEN\n');
    console.log('ANTIGRAVITY_REFRESH_TOKEN=' + data.refresh_token + '\n');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange failed: ' + err.message);
    console.error('Token exchange failed:', err);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1');
