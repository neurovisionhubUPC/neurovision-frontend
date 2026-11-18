export type BackendCognitoRole = 'DOCTOR' | 'PATIENT' | 'ADMIN';
export type AppRole = 'PATIENT' | 'SPECIALIST';

export interface DecodedTokenClaims {
  sub: string | null;
  email: string | null;
  username: string | null;
  tokenUse: string | null;
  groups: BackendCognitoRole[];
  appRole: AppRole | null;
  exp: number | null;
  isExpired: boolean;
}

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  issuerUrl: string;
  domain: string;
  clientId: string;
  redirectUri: string;
  logoutUri: string;
  isConfigured: boolean;
  isPasswordAuthConfigured: boolean;
  isHostedUiConfigured: boolean;
}

export interface CognitoTokenResponse {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export type CognitoAuthSignInResult =
  | ({
      status: 'SUCCESS';
    } & CognitoTokenResponse)
  | {
      status: 'NEW_PASSWORD_REQUIRED';
      session: string;
      username: string;
      challengeParameters: Record<string, string>;
    };

const PKCE_VERIFIER_KEY = 'neurovision_pkce_verifier';
const OAUTH_STATE_KEY = 'neurovision_oauth_state';

export function getCognitoConfig(): CognitoConfig {
  const region = (import.meta.env.VITE_AWS_REGION || '').trim();
  const userPoolId = (import.meta.env.VITE_COGNITO_USER_POOL_ID || '').trim();
  const clientId = (import.meta.env.VITE_COGNITO_CLIENT_ID || '').trim();
  const issuerUrl = (
    import.meta.env.VITE_COGNITO_ISSUER_URL ||
    (region && userPoolId ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}` : '')
  ).replace(/\/+$/, '');
  const domain = (import.meta.env.VITE_COGNITO_DOMAIN || '').replace(/\/+$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${origin}/login`;
  const logoutUri = import.meta.env.VITE_COGNITO_LOGOUT_URI || `${origin}/login`;

  const isPasswordAuthConfigured = Boolean(region && clientId);
  const isHostedUiConfigured = Boolean(domain && clientId);

  return {
    region,
    userPoolId,
    issuerUrl,
    domain,
    clientId,
    redirectUri,
    logoutUri,
    isConfigured: isPasswordAuthConfigured || isHostedUiConfigured,
    isPasswordAuthConfigured,
    isHostedUiConfigured,
  };
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  return atob(padded);
}

export function parseJwtClaims(token: string): DecodedTokenClaims {
  const fallback: DecodedTokenClaims = {
    sub: null,
    email: null,
    username: null,
    tokenUse: null,
    groups: [],
    appRole: null,
    exp: null,
    isExpired: false,
  };

  try {
    const clean = token.replace(/^Bearer\s+/i, '').trim();
    const parts = clean.split('.');
    if (parts.length !== 3) return fallback;

    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const rawGroups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
    const groups = rawGroups.filter(
      (g): g is BackendCognitoRole => g === 'DOCTOR' || g === 'PATIENT' || g === 'ADMIN'
    );

    let appRole: AppRole | null = null;
    if (groups.includes('DOCTOR') || groups.includes('ADMIN')) {
      appRole = 'SPECIALIST';
    } else if (groups.includes('PATIENT')) {
      appRole = 'PATIENT';
    }

    const exp = typeof payload.exp === 'number' ? payload.exp : null;
    const nowSec = Math.floor(Date.now() / 1000);
    const isExpired = exp !== null && exp < nowSec;

    return {
      sub: typeof payload.sub === 'string' ? payload.sub : null,
      email: typeof payload.email === 'string' ? payload.email : null,
      username: typeof payload.username === 'string' ? payload.username : null,
      tokenUse: typeof payload.token_use === 'string' ? payload.token_use : null,
      groups,
      appRole,
      exp,
      isExpired,
    };
  } catch {
    return fallback;
  }
}

export function isTokenExpiringSoon(token: string | null, bufferSeconds: number = 60): boolean {
  if (!token) return true;
  const claims = parseJwtClaims(token);
  if (claims.exp === null) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return claims.exp <= nowSec + bufferSeconds;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const verifier = base64UrlEncodeBytes(randomBytes);
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = base64UrlEncodeBytes(new Uint8Array(digest));
  return { verifier, challenge };
}

export async function startCognitoLogin(): Promise<void> {
  const cfg = getCognitoConfig();
  if (!cfg.isHostedUiConfigured) {
    throw new Error(
      'Cognito Hosted UI no está configurado (define VITE_COGNITO_DOMAIN y VITE_COGNITO_CLIENT_ID en .env). Usa el acceso directo por correo y contraseña o pega un token JWT.'
    );
  }

  const { verifier, challenge } = await generatePkcePair();
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64UrlEncodeBytes(stateBytes);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: cfg.redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${cfg.domain}/oauth2/authorize?${params.toString()}`);
}

export async function exchangeCognitoCodeForTokens(code: string, returnedState: string | null): Promise<{
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
}> {
  const cfg = getCognitoConfig();
  if (!cfg.isHostedUiConfigured) {
    throw new Error('Configuración de Cognito Hosted UI ausente para intercambiar código OAuth2.');
  }

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (expectedState && returnedState && expectedState !== returnedState) {
    throw new Error('OAuth2 state inválido (posible CSRF).');
  }
  if (!verifier) {
    throw new Error('No se encontró code_verifier PKCE en sessionStorage.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cfg.clientId,
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: verifier,
  });

  const res = await fetch(`${cfg.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Error al intercambiar código Cognito (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    id_token?: string;
    refresh_token?: string;
  };

  return {
    accessToken: json.access_token,
    idToken: json.id_token,
    refreshToken: json.refresh_token,
  };
}

interface CognitoAuthenticationResultRaw {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
  TokenType?: string;
}

interface CognitoInitiateAuthRaw {
  AuthenticationResult?: CognitoAuthenticationResultRaw;
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
}

interface CognitoForgotPasswordRaw {
  CodeDeliveryDetails?: {
    Destination?: string;
    DeliveryMedium?: string;
  };
}

function mapCognitoError(errorType: string | undefined, message: string | undefined, status: number): string {
  const code = (errorType || '').split('#').pop() || '';
  switch (code) {
    case 'NotAuthorizedException':
      return message || 'Correo o contraseña incorrectos en AWS Cognito.';
    case 'UserNotFoundException':
      return 'No existe un usuario registrado con ese correo o identificador en Cognito.';
    case 'UserNotConfirmedException':
      return 'El usuario aún no está confirmado en Cognito.';
    case 'PasswordResetRequiredException':
      return 'Debes restablecer tu contraseña antes de iniciar sesión.';
    case 'InvalidPasswordException':
      return message || 'La nueva contraseña no cumple la política de seguridad de AWS Cognito (mín. 8 caracteres, mayúsculas, minúsculas y números).';
    case 'CodeMismatchException':
      return 'El código de verificación ingresado es incorrecto.';
    case 'ExpiredCodeException':
      return 'El código de verificación ha expirado. Solicita uno nuevo.';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Demasiados intentos en AWS Cognito. Espera unos segundos antes de reintentar.';
    case 'InvalidParameterException':
      return message || 'Parámetros inválidos o flujo USER_PASSWORD_AUTH no habilitado en el App Client.';
    default:
      return message || `Error de AWS Cognito (${code || status}).`;
  }
}

async function callCognitoIdp<TResponse>(action: string, payload: Record<string, unknown>): Promise<TResponse> {
  const cfg = getCognitoConfig();
  if (!cfg.isPasswordAuthConfigured) {
    throw new Error(
      'AWS Cognito directo no está configurado (define VITE_AWS_REGION y VITE_COGNITO_CLIENT_ID en .env).'
    );
  }

  const endpoint = `https://cognito-idp.${cfg.region}.amazonaws.com/`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  let parsed: Record<string, unknown> = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = { message: rawText };
    }
  }

  if (!res.ok) {
    const errorType =
      (typeof parsed.__type === 'string' && parsed.__type) ||
      res.headers.get('x-amzn-errortype') ||
      undefined;
    const message =
      (typeof parsed.message === 'string' && parsed.message) ||
      (typeof parsed.Message === 'string' && parsed.Message) ||
      undefined;
    throw new Error(mapCognitoError(errorType, message, res.status));
  }

  return parsed as unknown as TResponse;
}

function mapAuthResultToTokens(auth: CognitoAuthenticationResultRaw): CognitoTokenResponse {
  if (!auth.AccessToken) {
    throw new Error('AWS Cognito no devolvió AccessToken en AuthenticationResult.');
  }
  return {
    accessToken: auth.AccessToken,
    idToken: auth.IdToken,
    refreshToken: auth.RefreshToken,
    expiresIn: auth.ExpiresIn,
    tokenType: auth.TokenType,
  };
}

/**
 * Autenticación directa por usuario/email y contraseña contra AWS Cognito User Pool (USER_PASSWORD_AUTH).
 * Si el usuario fue creado por invitación con contraseña temporal, retorna Challenge NEW_PASSWORD_REQUIRED.
 */
export async function signInWithCognitoPassword(
  usernameOrEmail: string,
  password: string
): Promise<CognitoAuthSignInResult> {
  const cfg = getCognitoConfig();
  const cleanUser = usernameOrEmail.trim();
  const data = await callCognitoIdp<CognitoInitiateAuthRaw>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cfg.clientId,
    AuthParameters: {
      USERNAME: cleanUser,
      PASSWORD: password,
    },
  });

  if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    if (!data.Session) {
      throw new Error('AWS Cognito solicitó NEW_PASSWORD_REQUIRED pero no devolvió Session.');
    }
    return {
      status: 'NEW_PASSWORD_REQUIRED',
      session: data.Session,
      username: data.ChallengeParameters?.USER_ID_FOR_SRP || cleanUser,
      challengeParameters: data.ChallengeParameters || {},
    };
  }

  if (data.ChallengeName) {
    throw new Error(`AWS Cognito requiere un reto adicional no soportado en UI: ${data.ChallengeName}`);
  }

  if (!data.AuthenticationResult) {
    throw new Error('AWS Cognito no devolvió tokens de sesión ni reto de autenticación.');
  }

  return {
    status: 'SUCCESS',
    ...mapAuthResultToTokens(data.AuthenticationResult),
  };
}

/**
 * Completa el reto NEW_PASSWORD_REQUIRED al primer inicio de sesión con contraseña temporal enviada por email.
 */
export async function completeCognitoNewPasswordChallenge(params: {
  username: string;
  newPassword: string;
  session: string;
  givenName?: string;
  familyName?: string;
}): Promise<CognitoTokenResponse> {
  const cfg = getCognitoConfig();
  const challengeResponses: Record<string, string> = {
    USERNAME: params.username.trim(),
    NEW_PASSWORD: params.newPassword,
  };

  if (params.givenName?.trim()) {
    challengeResponses['userAttributes.given_name'] = params.givenName.trim();
  }
  if (params.familyName?.trim()) {
    challengeResponses['userAttributes.family_name'] = params.familyName.trim();
  }

  const data = await callCognitoIdp<CognitoInitiateAuthRaw>('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: cfg.clientId,
    Session: params.session,
    ChallengeResponses: challengeResponses,
  });

  if (!data.AuthenticationResult) {
    throw new Error(
      data.ChallengeName
        ? `Cognito solicitó otro reto tras cambiar contraseña: ${data.ChallengeName}`
        : 'AWS Cognito no devolvió tokens tras completar el cambio de contraseña.'
    );
  }

  return mapAuthResultToTokens(data.AuthenticationResult);
}

/**
 * Envía código de recuperación de contraseña al correo registrado en Cognito.
 */
export async function requestCognitoPasswordReset(
  usernameOrEmail: string
): Promise<{ destination?: string; deliveryMedium?: string }> {
  const cfg = getCognitoConfig();
  const data = await callCognitoIdp<CognitoForgotPasswordRaw>('ForgotPassword', {
    ClientId: cfg.clientId,
    Username: usernameOrEmail.trim(),
  });
  return {
    destination: data.CodeDeliveryDetails?.Destination,
    deliveryMedium: data.CodeDeliveryDetails?.DeliveryMedium,
  };
}

/**
 * Confirma el código recibido y actualiza la contraseña en Cognito.
 */
export async function confirmCognitoPasswordReset(params: {
  username: string;
  confirmationCode: string;
  newPassword: string;
}): Promise<void> {
  const cfg = getCognitoConfig();
  await callCognitoIdp<Record<string, unknown>>('ConfirmForgotPassword', {
    ClientId: cfg.clientId,
    Username: params.username.trim(),
    ConfirmationCode: params.confirmationCode.trim(),
    Password: params.newPassword,
  });
}

/**
 * Renueva silenciosamente el AccessToken usando el RefreshToken de AWS Cognito (REFRESH_TOKEN_AUTH).
 */
export async function refreshCognitoAccessToken(
  refreshToken: string
): Promise<CognitoTokenResponse> {
  const cfg = getCognitoConfig();
  const cleanRefresh = refreshToken.trim();
  if (!cleanRefresh) {
    throw new Error('No hay RefreshToken disponible para renovar la sesión.');
  }

  const data = await callCognitoIdp<CognitoInitiateAuthRaw>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: cfg.clientId,
    AuthParameters: {
      REFRESH_TOKEN: cleanRefresh,
    },
  });

  if (!data.AuthenticationResult) {
    throw new Error('AWS Cognito no devolvió nuevos tokens al ejecutar REFRESH_TOKEN_AUTH.');
  }

  const tokens = mapAuthResultToTokens(data.AuthenticationResult);
  return {
    ...tokens,
    refreshToken: tokens.refreshToken || cleanRefresh,
  };
}
