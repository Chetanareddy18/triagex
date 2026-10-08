import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { clientOrigins } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Incident } from '../models/Incident.js';
import { verifyAccessToken } from '../services/auth.js';
import { rooms, setIO } from '../services/realtime.js';

/**
 * Socket.IO with JWT handshake auth.
 * Rooms: `user:<id>` (notifications), `staff` (live queue/dashboard),
 * `incident:<id>` (+ `incident:<id>:staff` for internal notes).
 */
export function attachSockets(server: HttpServer) {
  const io = new Server(server, { cors: { origin: clientOrigins, credentials: true }, path: '/socket.io' });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const claims = verifyAccessToken(token);
      socket.data.user = { id: claims.sub, role: claims.role, name: claims.name };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; role: string; name: string };
    socket.join(rooms.user(user.id));
    const staff = user.role === 'agent' || user.role === 'admin';
    if (staff) socket.join(rooms.staff);

    socket.on('incident:subscribe', async (incidentId: unknown, ack?: (ok: boolean) => void) => {
      try {
        if (typeof incidentId !== 'string' || !/^[a-f\d]{24}$/i.test(incidentId)) return ack?.(false);
        if (!staff) {
          const visible = await Incident.exists({ _id: incidentId, reporter: user.id });
          if (!visible) return ack?.(false);
        }
        socket.join(rooms.incident(incidentId));
        if (staff) socket.join(rooms.incidentStaff(incidentId));
        ack?.(true);
      } catch (err) {
        logger.warn({ err }, 'subscribe failed');
        ack?.(false);
      }
    });

    socket.on('incident:unsubscribe', (incidentId: unknown) => {
      if (typeof incidentId !== 'string') return;
      socket.leave(rooms.incident(incidentId));
      socket.leave(rooms.incidentStaff(incidentId));
    });
  });

  setIO(io);
  return io;
}
