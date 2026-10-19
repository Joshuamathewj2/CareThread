import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { db } from '../db/index.js';

export interface AuthContext {
  circleId: string;
  memberId: string;
  role: 'primary' | 'family' | 'aide' | 'viewer';
  now: string; // Injectable server clock
}

// Fallback for in-process callers (tests, scripts). HTTP requests carry the context in authInfo instead.
export const authContextStorage = new AsyncLocalStorage<AuthContext>();

declare global {
  namespace Express {
    interface Request {
      authCtx?: AuthContext;
      // Read by StreamableHTTPServerTransport and surfaced to handlers as extra.authInfo
      auth?: AuthInfo;
    }
  }
}

/**
 * Resolve the caller's care context for an MCP request handler.
 * Prefers the per-request authInfo the transport forwards; falls back to AsyncLocalStorage.
 */
export function resolveAuthContext(extra?: { authInfo?: AuthInfo }): AuthContext | undefined {
  const fromTransport = extra?.authInfo?.extra?.careContext as AuthContext | undefined;
  return fromTransport ?? authContextStorage.getStore();
}

// In a real app, this would verify a JWT or hash.
// For the MVP and hackathon, we assume the bearer token IS the member ID.
// Example: Authorization: Bearer m_priya
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.header('WWW-Authenticate', 'Bearer realm="carethread"');
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  // Find member and circle
  const member = db.prepare(`
    SELECT m.id as memberId, m.circle_id as circleId, m.role
    FROM members m
    JOIN care_circles c ON m.circle_id = c.id
    WHERE m.id = ? AND c.deleted_at IS NULL
  `).get(token) as { memberId: string, circleId: string, role: string } | undefined;

  if (!member) {
    res.status(403).json({ error: 'NO_CIRCLE' });
    return;
  }

  const careContext: AuthContext = {
    circleId: member.circleId,
    memberId: member.memberId,
    role: member.role as AuthContext['role'],
    now: new Date().toISOString()
  };

  req.authCtx = careContext;
  req.auth = {
    token,
    clientId: careContext.memberId,
    scopes: [careContext.role],
    extra: { careContext }
  };

  next();
}
