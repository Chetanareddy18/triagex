import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getToken, onTokenChange } from '../lib/api';
import type { Notification } from '../lib/types';
import { useAuth } from './AuthContext';

interface RealtimeState {
  socket: Socket | null;
  connected: boolean;
}
const RealtimeContext = createContext<RealtimeState>({ socket: null, connected: false });

// Sockets can connect straight to the API host (token auth, no cookies needed),
// while REST calls may go through a same-origin rewrite.
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL) as string | undefined;

/**
 * Keeps one Socket.IO connection per session and turns server events into
 * TanStack Query invalidations, so lists, dashboards and the bell update live.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    const s = io(SOCKET_URL ?? window.location.origin, {
      path: '/socket.io',
      auth: (cb) => cb({ token: getToken() }),
      transports: ['websocket', 'polling'],
    });
    setSocket(s);

    // Coalesce bursts (e.g. bulk auto-assign) into a single refetch.
    const invalidateLists = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['incidents'] });
        void qc.invalidateQueries({ queryKey: ['dashboard'] });
      }, 250);
    };

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('incident:created', invalidateLists);
    s.on('incident:updated', (p: { id: string }) => {
      invalidateLists();
      void qc.invalidateQueries({ queryKey: ['incident', p.id] });
    });
    s.on('comment:created', (p: { incidentId: string }) => void qc.invalidateQueries({ queryKey: ['comments', p.incidentId] }));
    s.on('notification:new', (n: Notification) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      const tone = n.type === 'sla_breached' ? toast.error : n.type === 'sla_at_risk' ? toast.warning : toast;
      tone(n.title, { description: n.body });
    });

    // Reconnect with the fresh token after a refresh.
    const off = onTokenChange((token) => {
      if (token && s.disconnected) s.connect();
    });
    return () => {
      off();
      window.clearTimeout(timer.current);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user, qc]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Joins the incident room while a detail page is open. */
export function useIncidentRoom(incidentId: string | undefined) {
  const { socket, connected } = useRealtime();
  useEffect(() => {
    if (!socket || !connected || !incidentId) return;
    socket.emit('incident:subscribe', incidentId);
    return () => {
      socket.emit('incident:unsubscribe', incidentId);
    };
  }, [socket, connected, incidentId]);
}
