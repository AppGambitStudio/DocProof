import { Amplify } from "aws-amplify";
import {
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  fetchAuthSession,
  getCurrentUser,
} from "aws-amplify/auth";

const USER_POOL_ID = import.meta.env.VITE_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_USER_POOL_CLIENT_ID || "";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: USER_POOL_ID,
      userPoolClientId: CLIENT_ID,
    },
  },
});

/**
 * Sign in with email + password via Amplify Auth.
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ success: true } | { success: false; error: string; newPasswordRequired?: boolean }> {
  try {
    const { nextStep } = await amplifySignIn({
      username: email,
      password,
      options: {
        authFlowType: "USER_SRP_AUTH",
      },
    });

    if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
      return {
        success: false,
        error: "Password change required. Use the seed script with --permanent flag.",
        newPasswordRequired: true,
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Authentication failed",
    };
  }
}

/**
 * Sign out — use Amplify signOut.
 */
export async function signOut(): Promise<void> {
  try {
    await amplifySignOut();
  } catch (error) {
    console.error("Error signing out", error);
  }
}

/**
 * Check if a user is currently signed in.
 */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current user's email.
 */
export async function getCurrentEmail(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user.signInDetails?.loginId || null;
  } catch {
    return null;
  }
}

/**
 * Get the current session's ID Token (JWT).
 */
export async function getToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() || null;
  } catch {
    return null;
  }
}

