/**
 * Headless Google OAuth2 token manager for Antigravity Cloud Code API.
 * Ported from vscode-antigravity-cockpit (oauth_service.ts) for Cloudflare Workers.
 */

export const ANTIGRAVITY_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const KV_TOKEN_KEY = 'oauth:access_token';

export class AuthRevokedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRevokedError';
  }
}

/**
 * Return a valid OAuth2 access token using KV cache or refresh_token exchange.
 */
export async function getAccessToken(env) {
  const refreshToken = env.ANTIGRAVITY_REFRESH_TOKEN;
  const clientId = env.ANTIGRAVITY_CLIENT_ID;
  const clientSecret = env.ANTIGRAVITY_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      'ANTIGRAVITY_REFRESH_TOKEN, ANTIGRAVITY_CLIENT_ID, or ANTIGRAVITY_CLIENT_SECRET is not configured',
    );
  }

  const now = Date.now();
  if (env.QUOTA_KV) {
    const cached = await env.QUOTA_KV.get(KV_TOKEN_KEY, 'json');
    if (
      cached &&
      typeof cached.accessToken === 'string' &&
      typeof cached.expiresAt === 'number' &&
      cached.expiresAt - TOKEN_REFRESH_BUFFER_MS > now
    ) {
      return cached.accessToken;
    }
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // non-JSON response handled below
  }

  if (!res.ok) {
    if (data.error === 'invalid_grant' || text.includes('invalid_grant')) {
      throw new AuthRevokedError(
        `OAuth refresh token revoked or expired (${data.error_description || 'invalid_grant'})`,
      );
    }
    throw new Error(`OAuth token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  if (!data.access_token) {
    throw new Error('OAuth token response missing access_token');
  }

  const expiresInSec = Number(data.expires_in) || 3600;
  const expiresAt = now + expiresInSec * 1000;

  if (env.QUOTA_KV) {
    await env.QUOTA_KV.put(
      KV_TOKEN_KEY,
      JSON.stringify({ accessToken: data.access_token, expiresAt }),
      { expirationTtl: Math.max(60, expiresInSec - 60) },
    );
  }

  return data.access_token;
}
