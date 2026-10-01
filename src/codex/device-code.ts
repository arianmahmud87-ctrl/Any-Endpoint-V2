/**
 * OpenAI Codex Device Code Authentication
 * 
 * Implements the device code flow for ChatGPT subscription access.
 * Based on OpenAI Codex CLI source code.
 */

const AUTH_BASE_URL = "https://auth.openai.com";
const CLIENT_ID = "codex-cli-client"; // OpenAI's official client ID for Codex

export interface DeviceCodeResponse {
  device_auth_id: string;
  user_code: string;
  interval: number; // Polling interval in seconds
}

export interface TokenPollResponse {
  authorization_code: string;
  code_challenge: string;
  code_verifier: string;
}

export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

export interface DeviceCodeInit {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  interval: number;
  expiresAt: Date;
}

/**
 * Step 1: Request device code from OpenAI
 */
export async function requestDeviceCode(): Promise<DeviceCodeInit> {
  const url = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Device code login is not enabled. Enable it in ChatGPT Settings > Security."
      );
    }
    throw new Error(`Device code request failed: ${response.status}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;

  return {
    verificationUrl: `${AUTH_BASE_URL}/codex/device`,
    userCode: data.user_code,
    deviceAuthId: data.device_auth_id,
    interval: data.interval || 5,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
  };
}

/**
 * Step 2: Poll for authorization (called by worker)
 * Returns authorization code when user approves in browser
 */
export async function pollForAuthorization(
  deviceAuthId: string,
  userCode: string,
  interval: number,
  onStatusChange?: (status: string) => void
): Promise<TokenPollResponse> {
  const url = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
  const maxWaitMs = 15 * 60 * 1000; // 15 minutes
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    onStatusChange?.("polling");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device_auth_id: deviceAuthId,
        user_code: userCode,
      }),
    });

    if (response.ok) {
      onStatusChange?.("authorized");
      return (await response.json()) as TokenPollResponse;
    }

    // 403/404 means still pending
    if (response.status === 403 || response.status === 404) {
      await sleep(interval * 1000);
      continue;
    }

    throw new Error(`Device auth polling failed: ${response.status}`);
  }

  throw new Error("Device auth timed out after 15 minutes");
}

/**
 * Step 3: Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  authorizationCode: string,
  codeVerifier: string,
  codeChallenge: string
): Promise<TokenExchangeResponse> {
  const redirectUri = `${AUTH_BASE_URL}/deviceauth/callback`;
  const url = `${AUTH_BASE_URL}/api/accounts/oauth/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      code_verifier: codeVerifier,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }

  return (await response.json()) as TokenExchangeResponse;
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<TokenExchangeResponse> {
  const url = `${AUTH_BASE_URL}/api/accounts/oauth/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  return (await response.json()) as TokenExchangeResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
