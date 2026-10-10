import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';

export interface AuthContext {
  circleId: string;
  memberId: string;
  role: 'primary' | 'family' | 'aide' | 'viewer';
  now: string; // Injectable server clock
}

declare global {
  namespace Express {
    interface Request {
      authCtx?: AuthContext;
    }
  }
}

// In a real app, this would verify a JWT or hash.
// For the MVP and hackathon, we assume the bearer token IS the member ID.
// Example: Authorization: Bearer m_priya
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
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

  req.authCtx = {
    circleId: member.circleId,
    memberId: member.memberId,
    role: member.role as 'primary' | 'family' | 'aide' | 'viewer',
    now: new Date().toISOString()
  };

  next();
}
