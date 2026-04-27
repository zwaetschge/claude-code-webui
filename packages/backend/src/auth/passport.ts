import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { getDatabase } from '../db';
import type { User } from '@claude-code-webui/shared';

// Explicit column list excludes password_hash and api_key_encrypted so auth flows never
// accidentally serialize sensitive columns into the session or OAuth profile responses.
const USER_PUBLIC_COLUMNS = `
  id, email, name, avatar_url, provider, provider_id, created_at, updated_at
`;

interface OAuthProfile {
  id: string;
  emails?: Array<{ value: string }>;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

class OAuthEmailCollisionError extends Error {
  constructor(
    public readonly email: string,
    public readonly existingProvider: string,
    public readonly incomingProvider: string
  ) {
    super(
      `Email ${email} is already linked to ${existingProvider}; sign in with that provider first to link accounts`
    );
    this.name = 'OAuthEmailCollisionError';
  }
}

class EmailNotAllowedError extends Error {
  constructor(public readonly email: string) {
    super(`Email ${email} is not on the AUTH_ALLOWED_EMAILS allowlist`);
    this.name = 'EmailNotAllowedError';
  }
}

function isEmailAllowed(email: string): boolean {
  if (config.auth.allowedEmails.length === 0) return true;
  return config.auth.allowedEmails.includes(email.trim().toLowerCase());
}

function findOrCreateUser(
  provider: 'github' | 'google',
  profile: OAuthProfile
): User {
  const db = getDatabase();
  const profileEmail = profile.emails?.[0]?.value;
  // Use a provider-namespaced synthetic email when the profile has none, so we never
  // collide with another user's real email.
  const email = profileEmail || `${profile.id}@${provider}.local`;

  if (!isEmailAllowed(email)) {
    throw new EmailNotAllowedError(email);
  }

  // Try to find existing user for this (provider, providerId) tuple
  const existingUser = db
    .prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE provider = ? AND provider_id = ?`)
    .get(provider, profile.id) as User | undefined;

  if (existingUser) {
    // Guard: if the profile's current email now matches a DIFFERENT user's email
    // (e.g. email changed at the provider), skip the email update to avoid
    // violating UNIQUE(email). Name/avatar are still refreshed.
    const conflictingEmailOwner = db
      .prepare(`SELECT id FROM users WHERE email = ? AND id != ?`)
      .get(email, existingUser.id) as { id: string } | undefined;

    if (conflictingEmailOwner) {
      db.prepare(
        `UPDATE users SET
          name = ?,
          avatar_url = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(
        profile.displayName || null,
        profile.photos?.[0]?.value || null,
        existingUser.id
      );
    } else {
      db.prepare(
        `UPDATE users SET
          name = ?,
          avatar_url = ?,
          email = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(
        profile.displayName || null,
        profile.photos?.[0]?.value || null,
        email,
        existingUser.id
      );
    }

    return {
      ...existingUser,
      name: profile.displayName || existingUser.name,
      avatarUrl: profile.photos?.[0]?.value || existingUser.avatarUrl,
    };
  }

  // New signup: fail closed if the email already belongs to a different provider.
  // Silent auto-linking would allow a hostile OAuth provider that returns a victim's
  // email to take over the account.
  const emailOwner = db
    .prepare(`SELECT id, provider FROM users WHERE email = ?`)
    .get(email) as { id: string; provider: string } | undefined;

  if (emailOwner) {
    throw new OAuthEmailCollisionError(email, emailOwner.provider, provider);
  }

  // Create new user
  const userId = nanoid();
  try {
    db.prepare(
      `INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      email,
      profile.displayName || null,
      profile.photos?.[0]?.value || null,
      provider,
      profile.id
    );
  } catch (err) {
    // Defense in depth: race condition between the check above and the insert.
    const errMessage = err instanceof Error ? err.message : String(err);
    if (errMessage.includes('UNIQUE') && errMessage.includes('users.email')) {
      throw new OAuthEmailCollisionError(email, 'unknown', provider);
    }
    throw err;
  }

  // Create default settings
  db.prepare(
    `INSERT INTO user_settings (user_id, theme, allowed_tools)
     VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
  ).run(userId);

  return {
    id: userId,
    email,
    name: profile.displayName || null,
    avatarUrl: profile.photos?.[0]?.value || null,
    provider,
    providerId: profile.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export { OAuthEmailCollisionError, EmailNotAllowedError, isEmailAllowed };

export function setupPassport(): void {
  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  // Deserialize user from session
  passport.deserializeUser((id: string, done) => {
    try {
      const db = getDatabase();
      const user = db
        .prepare(`SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = ?`)
        .get(id);
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });

  // GitHub Strategy
  if (config.github.clientId && config.github.clientSecret && config.github.callbackUrl) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.github.clientId,
          clientSecret: config.github.clientSecret,
          callbackURL: config.github.callbackUrl,
          scope: ['user:email'],
        },
        (
          _accessToken: string,
          _refreshToken: string,
          profile: OAuthProfile,
          done: (err: Error | null, user?: User) => void
        ) => {
          try {
            const user = findOrCreateUser('github', profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }

  // Google Strategy
  if (config.google.clientId && config.google.clientSecret && config.google.callbackUrl) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl,
          scope: ['profile', 'email'],
        },
        (
          _accessToken: string,
          _refreshToken: string,
          profile: OAuthProfile,
          done: (err: Error | null, user?: User) => void
        ) => {
          try {
            const user = findOrCreateUser('google', profile);
            done(null, user);
          } catch (err) {
            done(err as Error);
          }
        }
      )
    );
  }
}
