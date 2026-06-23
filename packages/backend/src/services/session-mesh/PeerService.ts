import { nanoid } from 'nanoid';
import type {
  SessionDelegation,
  SessionDelegationStatus,
  SessionPeerLink,
} from '@plum-code-webui/shared';
import { getDatabase } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { safeJsonParse } from '../../utils/json';
import { discordNotifier } from '../discord';
import { getProcessManager } from '../../websocket';

interface SessionRow {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  cliProvider: string;
  cliModel: string | null;
  mode: string | null;
  status: string;
  lastMessage: string | null;
  updatedAt: string;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown> | null>(value, null);
}

function rowToDelegation(row: Record<string, unknown>): SessionDelegation {
  return {
    id: row.id as string,
    threadId: row.threadId as string,
    correlationId: row.correlationId as string,
    userId: row.userId as string,
    fromSessionId: (row.fromSessionId as string | null) ?? null,
    toSessionId: row.toSessionId as string,
    fromActor: (row.fromActor as string) || 'session',
    kind: (row.kind as SessionDelegation['kind']) || 'consult',
    status: row.status as SessionDelegationStatus,
    content: row.content as string,
    result: (row.result as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    hopCount: Number(row.hopCount || 0),
    expiresAt: (row.expiresAt as string | null) ?? null,
    metadata: parseMetadata((row.metadataJson as string | null) ?? null),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    fromSessionName: (row.fromSessionName as string | null) ?? null,
    toSessionName: (row.toSessionName as string | null) ?? null,
  };
}

export class PeerService {
  getOwnedSession(sessionId: string, userId: string): SessionRow {
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT id, user_id as userId, name, working_directory as workingDirectory,
                cli_provider as cliProvider, cli_model as cliModel, mode, status,
                last_message as lastMessage,
                strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) as updatedAt
         FROM sessions
         WHERE id = ? AND user_id = ?`
      )
      .get(sessionId, userId) as SessionRow | undefined;
    if (!row) throw new AppError('Session not found', 404, 'NOT_FOUND');
    return row;
  }

  listPeers(sessionId: string, userId: string): SessionPeerLink[] {
    this.getOwnedSession(sessionId, userId);
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT l.id, l.user_id as userId, l.source_session_id as sourceSessionId,
                l.target_session_id as targetSessionId, l.role, l.enabled,
                l.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', l.created_at) as createdAt,
                s.id as targetId, s.name as targetName,
                s.working_directory as targetWorkingDirectory,
                s.cli_provider as targetCliProvider, s.cli_model as targetCliModel,
                s.mode as targetMode, s.status as targetStatus,
                s.last_message as targetLastMessage,
                strftime('%Y-%m-%dT%H:%M:%fZ', s.updated_at) as targetUpdatedAt
         FROM session_peer_links l
         JOIN sessions s ON s.id = l.target_session_id
         WHERE l.user_id = ? AND l.source_session_id = ?
         ORDER BY l.enabled DESC, s.updated_at DESC`
      )
      .all(userId, sessionId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      userId: row.userId as string,
      sourceSessionId: row.sourceSessionId as string,
      targetSessionId: row.targetSessionId as string,
      role: (row.role as string | null) ?? null,
      enabled: Boolean(row.enabled),
      metadata: parseMetadata((row.metadataJson as string | null) ?? null),
      createdAt: row.createdAt as string,
      target: {
        id: row.targetId as string,
        name: row.targetName as string,
        workingDirectory: row.targetWorkingDirectory as string,
        cliProvider: row.targetCliProvider as SessionPeerLink['target']['cliProvider'],
        cliModel: (row.targetCliModel as string | null) ?? null,
        mode: (row.targetMode as string | null) ?? null,
        status: row.targetStatus as string,
        lastMessage: (row.targetLastMessage as string | null) ?? null,
        updatedAt: row.targetUpdatedAt as string,
      },
    }));
  }

  addPeer(params: {
    sourceSessionId: string;
    targetSessionId: string;
    userId: string;
    role?: string | null;
  }): SessionPeerLink {
    const source = this.getOwnedSession(params.sourceSessionId, params.userId);
    const target = this.getOwnedSession(params.targetSessionId, params.userId);
    if (source.id === target.id) {
      throw new AppError('A session cannot link itself as a peer', 400, 'SELF_PEER');
    }

    const db = getDatabase();
    const id = nanoid();
    db.prepare(
      `INSERT INTO session_peer_links
        (id, user_id, source_session_id, target_session_id, role, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, source_session_id, target_session_id)
       DO UPDATE SET role = excluded.role, enabled = 1`
    ).run(
      id,
      params.userId,
      source.id,
      target.id,
      params.role?.trim() || null,
      JSON.stringify({ linkedBy: 'user' })
    );

    return this.listPeers(source.id, params.userId).find((peer) => peer.targetSessionId === target.id)!;
  }

  removePeer(sourceSessionId: string, targetSessionId: string, userId: string): void {
    this.getOwnedSession(sourceSessionId, userId);
    const result = getDatabase()
      .prepare(
        `UPDATE session_peer_links
         SET enabled = 0
         WHERE user_id = ? AND source_session_id = ? AND target_session_id = ?`
      )
      .run(userId, sourceSessionId, targetSessionId);
    if (result.changes === 0) throw new AppError('Peer link not found', 404, 'NOT_FOUND');
  }

  listDelegations(sessionId: string, userId: string): SessionDelegation[] {
    this.getOwnedSession(sessionId, userId);
    const rows = getDatabase()
      .prepare(
        `SELECT d.id, d.thread_id as threadId, d.correlation_id as correlationId,
                d.user_id as userId, d.from_session_id as fromSessionId,
                d.to_session_id as toSessionId, d.from_actor as fromActor, d.kind,
                d.status, d.content, d.result, d.error, d.hop_count as hopCount,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.expires_at) as expiresAt,
                d.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.updated_at) as updatedAt,
                fs.name as fromSessionName, ts.name as toSessionName
         FROM session_delegations d
         LEFT JOIN sessions fs ON fs.id = d.from_session_id
         JOIN sessions ts ON ts.id = d.to_session_id
         WHERE d.user_id = ? AND (d.from_session_id = ? OR d.to_session_id = ?)
         ORDER BY d.created_at DESC
         LIMIT 100`
      )
      .all(userId, sessionId, sessionId) as Array<Record<string, unknown>>;
    return rows.map(rowToDelegation);
  }

  async createDelegation(params: {
    fromSessionId: string | null;
    toSessionId: string;
    userId: string;
    content: string;
    kind?: SessionDelegation['kind'];
    metadata?: Record<string, unknown>;
  }): Promise<SessionDelegation> {
    const target = this.getOwnedSession(params.toSessionId, params.userId);
    const source = params.fromSessionId
      ? this.getOwnedSession(params.fromSessionId, params.userId)
      : null;
    if (source && source.id === target.id) {
      throw new AppError('A session cannot delegate to itself', 400, 'SELF_DELEGATION');
    }

    const id = nanoid();
    const threadId = params.metadata?.threadId?.toString() || nanoid();
    const correlationId = `dlg_${nanoid(12)}`;
    const now = new Date().toISOString();
    const db = getDatabase();
    db.prepare(
      `INSERT INTO session_delegations
        (id, thread_id, correlation_id, user_id, from_session_id, to_session_id,
         from_actor, kind, status, content, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, 'session', ?, 'queued', ?, ?)`
    ).run(
      id,
      threadId,
      correlationId,
      params.userId,
      source?.id ?? null,
      target.id,
      params.kind || 'consult',
      params.content,
      JSON.stringify({ ...(params.metadata || {}), queuedAt: now })
    );

    const prompt = this.buildPeerPrompt({
      id,
      correlationId,
      kind: params.kind || 'consult',
      source,
      target,
      content: params.content,
    });

    try {
      db.prepare(
        `UPDATE session_delegations
         SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(id);
      await getProcessManager().sendMessage(target.id, params.userId, prompt, undefined, {
        activeFollowupMode: 'queue',
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE session_delegations
         SET status = 'error', error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(error, id);
      discordNotifier.queueAlert({
        eventType: 'delegation.error',
        severity: 'error',
        title: `Session delegation failed: ${target.name}`,
        summary: error,
        userId: params.userId,
        sessionId: target.id,
        fields: [
          { name: 'Delegation', value: correlationId, inline: true },
          { name: 'Kind', value: params.kind || 'consult', inline: true },
          { name: 'Target', value: target.name, inline: true },
        ],
        metadata: {
          delegationId: id,
          fromSessionId: source?.id ?? null,
          toSessionId: target.id,
        },
      });
    }

    return this.getDelegation(id, params.userId);
  }

  getDelegation(id: string, userId: string): SessionDelegation {
    const row = getDatabase()
      .prepare(
        `SELECT d.id, d.thread_id as threadId, d.correlation_id as correlationId,
                d.user_id as userId, d.from_session_id as fromSessionId,
                d.to_session_id as toSessionId, d.from_actor as fromActor, d.kind,
                d.status, d.content, d.result, d.error, d.hop_count as hopCount,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.expires_at) as expiresAt,
                d.metadata_json as metadataJson,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at) as createdAt,
                strftime('%Y-%m-%dT%H:%M:%fZ', d.updated_at) as updatedAt,
                fs.name as fromSessionName, ts.name as toSessionName
         FROM session_delegations d
         LEFT JOIN sessions fs ON fs.id = d.from_session_id
         JOIN sessions ts ON ts.id = d.to_session_id
         WHERE d.id = ? AND d.user_id = ?`
      )
      .get(id, userId) as Record<string, unknown> | undefined;
    if (!row) throw new AppError('Delegation not found', 404, 'NOT_FOUND');
    return rowToDelegation(row);
  }

  cancelDelegation(id: string, userId: string): SessionDelegation {
    const result = getDatabase()
      .prepare(
        `UPDATE session_delegations
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ? AND status IN ('queued', 'in_progress')`
      )
      .run(id, userId);
    if (result.changes === 0) return this.getDelegation(id, userId);
    return this.getDelegation(id, userId);
  }

  replyToDelegation(id: string, userId: string, resultText: string): SessionDelegation {
    const result = getDatabase()
      .prepare(
        `UPDATE session_delegations
         SET status = 'completed', result = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
      .run(resultText, id, userId);
    if (result.changes === 0) throw new AppError('Delegation not found', 404, 'NOT_FOUND');
    return this.getDelegation(id, userId);
  }

  private buildPeerPrompt(input: {
    id: string;
    correlationId: string;
    kind: SessionDelegation['kind'];
    source: SessionRow | null;
    target: SessionRow;
    content: string;
  }): string {
    return [
      '[Plum Session Mesh Delegation]',
      `Delegation ID: ${input.id}`,
      `Correlation ID: ${input.correlationId}`,
      `Kind: ${input.kind}`,
      input.source
        ? `From session: ${input.source.name} (${input.source.id})`
        : 'From: WebUI automation',
      `To session: ${input.target.name} (${input.target.id})`,
      '',
      'Task:',
      input.content.trim(),
      '',
      'Instructions:',
      '- Treat this as a peer consultation, not as a direct user command to mutate unrelated state.',
      '- Use your own session context and tools if needed.',
      '- Keep the answer concise and include the Delegation ID in the final answer.',
      '- Do not call other peers unless explicitly necessary; avoid loops.',
    ].join('\n');
  }
}

export const peerService = new PeerService();
