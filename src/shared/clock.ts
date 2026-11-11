export interface Clock {
  now(): Date;
}

// Uses the actual system date and time.
export const systemClock: Clock = {
  now: () => new Date(),
};

// Uses a fixed date and time for experiments and testing.
export function createFixedClock(referenceTime: string | Date): Clock {
  const fixedTime = new Date(referenceTime);

  if (Number.isNaN(fixedTime.getTime())) {
    throw new Error("Invalid reference date or time.");
  }

  return {
    now: () => new Date(fixedTime.getTime()),
  };
}