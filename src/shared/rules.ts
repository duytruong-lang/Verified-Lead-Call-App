import { MAX_ATTEMPTS, type ContactOutcome } from './types';

export function validateOutcome(outcome: ContactOutcome, note?: string): void {
  if (outcome === 'other' && !note?.trim()) {
    throw new Error('A note is required for the “other” outcome.');
  }
}

export function nextAttemptOrdinal(completedAttempts: number): number {
  if (!Number.isInteger(completedAttempts) || completedAttempts < 0) {
    throw new Error('Completed attempt count must be a non-negative integer.');
  }
  if (completedAttempts >= MAX_ATTEMPTS) {
    throw new Error('This lead has reached the five-attempt limit.');
  }
  return completedAttempts + 1;
}

export function canMarkVerified(recording: { ready: boolean; playable: boolean; shareActive: boolean }): boolean {
  return recording.ready && recording.playable && recording.shareActive;
}
