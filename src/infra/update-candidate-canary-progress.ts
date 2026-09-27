/** Private stderr contract between the candidate Gateway and its updater. */
export const UPDATE_CANARY_PROGRESS_PREFIX = "openclaw-update-canary-progress: ";

export type UpdateCanaryStartupProgress = { milestone: string; completedAt: number };
