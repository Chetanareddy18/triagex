import type { Server } from 'socket.io';

/** Thin wrapper so services can emit without importing the HTTP layer (no-op in tests). */
let io: Server | null = null;

export const rooms = {
  staff: 'staff',
  user: (id: string) => `user:${id}`,
  incident: (id: string) => `incident:${id}`,
  incidentStaff: (id: string) => `incident:${id}:staff`,
};

export function setIO(server: Server | null): void {
  io = server;
}

export function emitTo(room: string | string[], event: string, payload: unknown): void {
  if (!io) return;
  io.to(room).emit(event, payload);
}

interface IncidentLike {
  _id: unknown;
  reporter: unknown;
  assignee?: unknown;
}

/** Broadcasts an incident change to staff, the reporter, the assignee and viewers. */
export function emitIncident(event: 'incident:created' | 'incident:updated', incident: IncidentLike, data: unknown): void {
  const id = String(incident._id);
  const ref = (r: unknown) => String(typeof r === 'object' && r && '_id' in r ? (r as { _id: unknown })._id : r);
  const targets = new Set<string>([rooms.staff, rooms.incident(id), rooms.user(ref(incident.reporter))]);
  if (incident.assignee) targets.add(rooms.user(ref(incident.assignee)));
  emitTo([...targets], event, data);
}
