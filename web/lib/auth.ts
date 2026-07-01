// Auth.js (NextAuth v5) configuration for SSO sign-in.
//
// Providers: Google, X/Twitter, GitHub, email magic-link (Nodemailer), plus a
// DEV-ONLY credentials provider ("dev-email") so the whole pay-to-email flow is
// testable locally without registering OAuth apps or sending real mail.
//
// The JWT carries the fields the API routes need to compute a *routing identity*
// (see lib/identity/server.ts): a stable `uid`, the `provider`, whether the
// email is verified, and a social `handle` when available. The shielded wallet
// is rooted in the routing identity (email or handle), NOT in `uid` — so the
// same person reaches the same wallet whether they used Google or a magic-link.
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Twitter from "next-auth/providers/twitter";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { isEmail } from "@/lib/identity/normalize";

const devLoginAllowed =
  process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_LOGIN === "true";

const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GOOGLE_ID) providers.push(Google);
if (process.env.AUTH_TWITTER_ID) providers.push(Twitter);
if (process.env.AUTH_GITHUB_ID) providers.push(GitHub);

// Dev-only: "log in as <email>" with no external dependency. Gated hard so it
// can never silently authorize anyone in production.
if (devLoginAllowed) {
  providers.push(
    Credentials({
      id: "dev-email",
      name: "Dev email login (testing only)",
      credentials: { email: { label: "Email", type: "email" } },
      authorize: (creds) => {
        const email = String(creds?.email || "").trim().toLowerCase();
        if (!isEmail(email)) return null;
        return { id: `dev:${email}`, email, name: email.split("@")[0] };
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  trustHost: true,
  providers,
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account) {
        token.provider = account.provider;
        token.uid = `${account.provider}:${account.providerAccountId ?? user?.id ?? token.sub}`;
        // Provider-specific verification + handle extraction.
        const p = profile as Record<string, unknown> | undefined;
        token.emailVerified =
          account.provider === "dev-email" ||
          account.provider === "nodemailer" ||
          account.provider === "github" ||
          p?.email_verified === true;
        // X/Twitter v2 nests username under data; GitHub uses login.
        const tw = (p?.data as { username?: string } | undefined)?.username;
        token.handle = tw || (p?.login as string | undefined) || undefined;
      }
      return token;
    },
    async session({ session, token }) {
      const s = session as typeof session & {
        uid?: string; provider?: string; emailVerified?: boolean; handle?: string;
      };
      s.uid = token.uid as string | undefined;
      s.provider = token.provider as string | undefined;
      s.emailVerified = Boolean(token.emailVerified);
      s.handle = token.handle as string | undefined;
      return s;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
