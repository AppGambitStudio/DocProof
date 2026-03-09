const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_USER_POOL_CLIENT_ID || "";

const TOKEN_KEY = "docproof_token";
const REFRESH_KEY = "docproof_refresh";
const EMAIL_KEY = "docproof_email";

function cognitoEndpoint(): string {
  const region = USER_POOL_ID.split("_")[0];
  return `https://cognito-idp.${region}.amazonaws.com`;
}

interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface CognitoError {
  __type: string;
  message: string;
}

/**
 * Sign in with email + password via Cognito USER_PASSWORD_AUTH flow.
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ success: true } | { success: false; error: string; newPasswordRequired?: boolean }> {
  const res = await fetch(cognitoEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const err = data as CognitoError;
    return { success: false, error: err.message || "Authentication failed" };
  }

  // Handle NEW_PASSWORD_REQUIRED challenge (first login with temp password)
  if (data.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    return {
      success: false,
      error: "Password change required. Use the seed script with --permanent flag.",
      newPasswordRequired: true,
    };
  }

  const result = data.AuthenticationResult;
  if (!result?.IdToken) {
    return { success: false, error: "Unexpected response from Cognito" };
  }

  localStorage.setItem(TOKEN_KEY, result.IdToken);
  localStorage.setItem(REFRESH_KEY, result.RefreshToken || "");
  localStorage.setItem(EMAIL_KEY, email);

  return { success: true };
}

/**
 * Sign out — clear stored tokens.
 */
export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

/**
 * Check if a user is currently signed in (has a stored token).
 */
export function isAuthenticated(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * Get the current user's email.
 */
export function getCurrentEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}
