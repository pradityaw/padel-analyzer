const STORAGE_KEY = "padel-onboarding-v1";

type OnboardingState = {
  tourComplete?: boolean;
  scoreRevealShown?: boolean;
};

function read(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return {};
  }
}

function write(state: OnboardingState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

export function hasSeenTour(): boolean {
  return read().tourComplete === true;
}

export function markTourComplete(): void {
  write({ ...read(), tourComplete: true });
}

export function hasScoreRevealShown(): boolean {
  return read().scoreRevealShown === true;
}

export function markScoreRevealShown(): void {
  write({ ...read(), scoreRevealShown: true });
}

export function resetOnboardingForDev(): void {
  localStorage.removeItem(STORAGE_KEY);
}
