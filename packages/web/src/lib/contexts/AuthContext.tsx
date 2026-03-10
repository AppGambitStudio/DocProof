import React, { createContext, useContext, useState, useEffect } from "react";
import { isAuthenticated as checkAuth, getCurrentEmail as getEmail, signOut as authSignOut } from "../auth";

interface AuthContextType {
    authenticated: boolean | null; // null means loading
    email: string | null;
    logout: () => Promise<void>;
    refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [authenticated, setAuthenticated] = useState<boolean | null>(null);
    const [email, setEmail] = useState<string | null>(null);

    const refreshAuth = async () => {
        const isAuth = await checkAuth();
        setAuthenticated(isAuth);
        if (isAuth) {
            const emailValue = await getEmail();
            setEmail(emailValue);
        } else {
            setEmail(null);
        }
    };

    useEffect(() => {
        refreshAuth();
    }, []);

    const logout = async () => {
        await authSignOut();
        setAuthenticated(false);
        setEmail(null);
    };

    return (
        <AuthContext.Provider value={{ authenticated, email, logout, refreshAuth }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
