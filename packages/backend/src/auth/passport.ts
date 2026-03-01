import passport from 'passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { nanoid } from 'nanoid';
import { config } from '../config';
import { getDatabase } from '../db';
import type { User } from '@claude-code-webui/shared';

interface OAuthProfile {
  id: string;
  emails?: Array<{ value: string }>;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

function findOrCreateUser(
  provider: 'github' | 'google',
  profile: OAuthProfile
): User {
  const db = getDatabase();
  const email = profile.emails?.[0]?.value || `${profile.id}@${provider}.local`;

  // Try to find existing user
  const existingUser = db
    .prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
    .get(provider, profile.id) as User | undefined;

  if (existingUser) {
    // Update user info
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

    return {
      ...existingUser,
      name: profile.displayName || existingUser.name,
      avatarUrl: profile.photos?.[0]?.value || existingUser.avatarUrl,
    };
  }

  // Create new user
  const userId = nanoid();
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

export function setupPassport(): void {
  // Serialize user to session
  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  // Deserialize user from session
  passport.deserializeUser((id: string, done) => {
    try {
      const db = getDatabase();
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
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
