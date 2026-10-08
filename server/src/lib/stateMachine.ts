import type { Role, Status } from './domain.js';

/**
 * Incident lifecycle.
 *
 *   new -> assigned -> in_progress -> resolved -> closed
 *            ^  |          |             |          |
 *            |  +--> new   +-> assigned  +----------+--> assigned (reopen)
 *
 * - `assigned -> new` un-assigns (back to the queue).
 * - `in_progress -> assigned` hands the ticket back without losing the owner.
 * - `resolved|closed -> assigned` is a reopen and keeps the previous assignee.
 */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  new: ['assigned'],
  assigned: ['in_progress', 'new'],
  in_progress: ['resolved', 'assigned'],
  resolved: ['closed', 'assigned'],
  closed: ['assigned'],
};

export type TransitionName = 'assign' | 'unassign' | 'start' | 'handback' | 'resolve' | 'close' | 'reopen';

export function transitionName(from: Status, to: Status): TransitionName | null {
  if (!canTransition(from, to)) return null;
  if (to === 'assigned') {
    if (from === 'new') return 'assign';
    if (from === 'in_progress') return 'handback';
    return 'reopen';
  }
  if (to === 'new') return 'unassign';
  if (to === 'in_progress') return 'start';
  if (to === 'resolved') return 'resolve';
  return 'close';
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Reporters may only confirm (close) or reopen their own resolved/closed tickets. */
export function roleCanTransition(role: Role, name: TransitionName, isOwner: boolean): boolean {
  if (role === 'admin' || role === 'agent') return true;
  return isOwner && (name === 'close' || name === 'reopen');
}

export function allowedTransitions(from: Status, role: Role, isOwner: boolean): Status[] {
  return TRANSITIONS[from].filter((to) => {
    const name = transitionName(from, to);
    return name !== null && roleCanTransition(role, name, isOwner);
  });
}
