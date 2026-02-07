import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";

// X API v2 OAuth 2.0 with PKCE
// https://docs.x.com/resources/fundamentals/authentication

const SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "follows.read",
  "follows.write",
  "like.read",
  "like.write",
  "list.read",
  "list.write",
  "bookmark.read",
  "bookmark.write",
  "offline.access", // enables refresh tokens
].join(" ");

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface OAuthFlowResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string;
}

/**
 * Run the OAuth 2.0 PKCE flow:
 * 1. Start a local HTTP server to receive the callback
 * 2. Open the browser to X's authorize URL
 * 3. Exchange the authorization code for tokens
 */
export async function runOAuthFlow(params: {
  clientId: string;
  port?: number;
  onOpenUrl: (url: string) => void | Promise<void>;
}): Promise<OAuthFlowResult> {
  const { clientId, port = 3391 } = params;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Build authorization URL
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Wait for callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const receivedState = url.searchParams.get("state");
      const receivedCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body><h1>Authorization failed</h1><p>You can close this window.</p></body></html>",
        );
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (receivedState !== state) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h1>State mismatch</h1></body></html>");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }

      if (!receivedCode) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h1>No code received</h1></body></html>");
        server.close();
        reject(new Error("No authorization code received"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #15202b; color: #e7e9ea;">
          <div style="text-align: center;">
            <h1>✓ Authorized</h1>
            <p>You can close this window and return to your terminal.</p>
          </div>
        </body></html>`,
      );
      server.close();
      resolve(receivedCode);
    });

    server.listen(port, "127.0.0.1", () => {
      params.onOpenUrl(authUrl.toString());
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error("OAuth flow timed out (2 minutes)"));
    }, 120_000);
  });

  // Exchange code for tokens
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${body}`);
  }

  const tokens = (await tokenResponse.json()) as OAuthTokenResponse;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes: tokens.scope,
  };
}

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(params: {
  clientId: string;
  refreshToken: string;
}): Promise<OAuthFlowResult> {
  const { clientId, refreshToken } = params;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${body}`);
  }

  const tokens = (await response.json()) as OAuthTokenResponse;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes: tokens.scope,
  };
}
