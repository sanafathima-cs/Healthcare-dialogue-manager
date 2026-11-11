
import type {
  DialogueState,
  UserIntent,
  AppointmentType,
  TimePreference,
} from "../rule_based/types.js";

import { systemClock } from "../shared/clock.js";
import type { Clock } from "../shared/clock.js";

import { getBaselinePrompt } from "../../experiments/prompts/prompt-a-baseline.js";
import { getDetailedPrompt } from "../../experiments/prompts/prompt-b-detailed.js";
import { getStrictPrompt } from "../../experiments/prompts/prompt-c-strict-json.js";

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL_NAME = "llama3.2:latest";

interface OllamaResponse {
  message?: {
    content?: string;
  };
  error?: string;
}
export type PromptVariant = 
    | "baseline"
    | "detailed"
    | "strict";
export interface LLMExtraction {
  intent: UserIntent | null;
  appointmentType: AppointmentType | null;
  preferredDate: string | null;
  preferredTime: TimePreference | null;
  preferredClockTime: string | null;
  reason: string | null;
  existingAppointmentId: string | null;
}

const VALID_INTENTS: UserIntent[] = [
  "book",
  "reschedule",
  "cancel",
];

const VALID_APPOINTMENT_TYPES: AppointmentType[] = [
  "general_consultation",
  "pediatric",
  "cardiologist",
  "follow_up",
  "nurse_appointment",
];

const VALID_TIME_PREFERENCES: TimePreference[] = [
  "morning",
  "afternoon",
  "evening",
  "specific_time",
];

function getToday(clock: Clock = systemClock): string {
  const today = clock.now();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function extractDate(
    message: string, 
    clock: Clock = systemClock,
): string | null {
  const text = message.trim().toLowerCase();
  const today = getToday(clock);

  // Handle ISO dates, e.g. 2026-11-15.
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);

  if (isoMatch && isValidDate(isoMatch[0])) {
    return isoMatch[0];
  }

  // Handle today, tomorrow and the day after tomorrow.
  const addDays = (date: string, days: number): string => {
    const parts = date.split("-").map(Number);
    const year = parts[0]!;
    const month = parts[1]!;
    const day = parts[2]!;

    const result = new Date(year, month - 1, day);
    result.setDate(result.getDate() + days);

    return [
      result.getFullYear(),
      String(result.getMonth() + 1).padStart(2, "0"),
      String(result.getDate()).padStart(2, "0"),
    ].join("-");
  };

  if (/\bday after tomorrow\b/.test(text)) {
    return addDays(today, 2);
  }

  if (/\btomorrow\b/.test(text)) {
    return addDays(today, 1);
  }

  if (/\btoday\b/.test(text)) {
    return today;
  }

  // Handle next Monday, next Tuesday, etc.
  const weekdays: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  const weekdayMatch = text.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );

  if (weekdayMatch) {
    const weekday = weekdayMatch[1]!;
    const targetDay = weekdays[weekday];

    if (targetDay === undefined) {
        return null;
    }

    const parts = today.split("-").map(Number);
    const year = parts[0]!;
    const month = parts[1]!;
    const day = parts[2]!;

    const currentDate = new Date(year, month - 1, day);

    const currentDay = currentDate.getDay();
    let daysAhead = (targetDay - currentDay + 7) % 7;

    // "Next Monday" means the following week's Monday,
    // not today if today is Monday.
    if (daysAhead === 0) {
      daysAhead = 7;
    }

    return addDays(today, daysAhead);
  }

  // Handle dates such as November 15 or November 15, 2026.
  const months: Record<string, string> = {
    january: "01", jan: "01",
    february: "02", feb: "02",
    march: "03", mar: "03",
    april: "04", apr: "04",
    may: "05",
    june: "06", jun: "06",
    july: "07", jul: "07",
    august: "08", aug: "08",
    september: "09", sep: "09", sept: "09",
    october: "10", oct: "10",
    november: "11", nov: "11",
    december: "12", dec: "12",
  };

  // Support dates such as "9 November 2026", "9 Nov", and "9 nov".
    const dayFirstMatch = text.match(
        /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|sept|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/i,
);


if (dayFirstMatch) {
  const day = Number(dayFirstMatch[1]);
  const monthName = dayFirstMatch[2]!.toLowerCase();
  const month = months[monthName];

  if (!month) return null;

  let year = dayFirstMatch[3]
    ? Number(dayFirstMatch[3])
    : Number(today.slice(0, 4));

  let date = `${year}-${month}-${String(day).padStart(2, "0")}`;

  if (!isValidDate(date)) return null;

  if (!dayFirstMatch[3] && date < today) {
    year++;
    date = `${year}-${month}-${String(day).padStart(2, "0")}`;
  }

  return isValidDate(date) ? date : null;
}

  const monthMatch = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/,
  );

  if (!monthMatch) {
    return null;
  }

  const monthName = monthMatch[1]!;
  const month = months[monthName];
  const day = Number(monthMatch[2]);

  let year = monthMatch[3]
    ? Number(monthMatch[3])
    : Number(today.slice(0, 4));

  let date = `${year}-${month}-${String(day).padStart(2, "0")}`;

  if (!isValidDate(date)) {
    return null;
  }

  // If the patient did not specify a year and the date
  // has passed, assume the next year.
  if (!monthMatch[3] && date < today) {
    year++;
    date = `${year}-${month}-${String(day).padStart(2, "0")}`;
  }

  return isValidDate(date) ? date : null;
}


function extractReason(message: string): string | null {
  const match = message.match(
    /\b(?:because|reason is|reason:|i am experiencing|i have been experiencing)\s+(.+)/i,
  );

  if (!match?.[1]) {
    return null;
  }

  const reason = match[1]
    .trim()
    .replace(/[.!?]+$/, "");

  return reason.length > 0 ? reason : null;
}


function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidClockTime(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return false;
  }

  return true;
}


function extractClockTime(message: string): string | null {
  const text = message.trim().toLowerCase();

  // Handle 12-hour formats:
  // 9 am, 9:30 am, 2 pm, 2:30 p.m.
  const twelveHourMatch = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );

  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]);
    const minutes = Number(twelveHourMatch[2] ?? "00");
    const period = twelveHourMatch[3]!.replace(/\./g, "").toLowerCase();

    if (hours < 1 || hours > 12 || minutes > 59) {
      return null;
    }

    if (period === "am") {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  // Handle 24-hour formats: 09:00, 14:30
  const twentyFourHourMatch = text.match(
    /\b([01]?\d|2[0-3]):([0-5]\d)\b/
  );

  if (twentyFourHourMatch) {
    const hours = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  
  // Handle natural expressions:
  // morning at 9, 9 in the morning,
  // afternoon 2, 2 in afternoon,
  // evening at 6, at 2 in the afternoon

  const naturalTimeMatch =
    text.match(
      /\b(morning|afternoon|evening)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\b/
    ) ??
    text.match(
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:in\s+the\s+)?(morning|afternoon|evening)\b/
    );

  if (naturalTimeMatch) {
    const periodFirst = /^(morning|afternoon|evening)/.test(naturalTimeMatch[0]);

    const period = periodFirst
      ? naturalTimeMatch[1]
      : naturalTimeMatch[3];

    const hours = Number(
      periodFirst ? naturalTimeMatch[2] : naturalTimeMatch[1]
    );

    const minutes = Number(
      (periodFirst ? naturalTimeMatch[3] : naturalTimeMatch[2]) ?? "00"
    );

    if (hours < 1 || hours > 12 || minutes > 59) {
      return null;
    }

    let convertedHours = hours;

    if (period === "morning") {
      if (hours === 12) convertedHours = 0;
    } else if (hours !== 12) {
      convertedHours += 12;
    }

    return `${String(convertedHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return null;
}

function isValidEnum<T extends string>(
  value: unknown,
  allowedValues: T[],
): value is T {
  return (
    typeof value === "string" &&
    allowedValues.includes(value as T)
  );
}

function parseLLMResponse(content: string): LLMExtraction {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      "The LLM returned invalid JSON. Please try again.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "The LLM response must be a JSON object.",
    );
  }

  const data = parsed as Record<string, unknown>;

  const intent = isValidEnum(data.intent, VALID_INTENTS)
    ? data.intent
    : null;

  const appointmentType = isValidEnum(
    data.appointmentType,
    VALID_APPOINTMENT_TYPES,
  )
    ? data.appointmentType
    : null;

  const preferredDate = isValidDate(data.preferredDate)
    ? data.preferredDate
    : null;

  const preferredTime = isValidEnum(
    data.preferredTime,
    VALID_TIME_PREFERENCES,
  )
    ? data.preferredTime
    : null;

  const preferredClockTime = isValidClockTime(
    data.preferredClockTime,
  )
    ? data.preferredClockTime
    : null;

  const reason =
    typeof data.reason === "string"
      ? data.reason
      : null;

  const existingAppointmentId =
    typeof data.existingAppointmentId === "string" &&
    data.existingAppointmentId.trim().toLowerCase() !== "null" &&
    data.existingAppointmentId.trim() !== ""
      ? data.existingAppointmentId
      : null;

  return {
    intent,
    appointmentType,
    preferredDate,
    preferredTime,
    preferredClockTime,
    reason,
    existingAppointmentId,
  };
}

async function extractInformation(
  message: string,
  currentState: DialogueState,
  clock: Clock = systemClock,
  promptVariant: PromptVariant = "baseline",
): Promise<LLMExtraction> {
  const today = getToday(clock);

  const prompt =
  promptVariant === "detailed"
    ? getDetailedPrompt(today, currentState, message)
    : promptVariant === "strict"
      ? getStrictPrompt(today, currentState, message)
      : getBaselinePrompt(today, currentState, message);

  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      stream: false,
      format: "json",
      options: {
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama request failed: ${response.status} ${response.statusText}`,
    );
  }

  const result = (await response.json()) as OllamaResponse;

  if (result.error) {
    throw new Error(`Ollama error: ${result.error}`);
  }

  const content = result.message?.content;

  if (!content) {
    throw new Error("Ollama returned an empty response.");
  }

  return parseLLMResponse(content);
}

/**
 * Uses Llama 3.2 through Ollama to extract information
 * and update the existing DialogueState.
 *
 * This function only extracts information.
 * It does not check availability or perform appointments.
 */

export async function extractWithPrompt(
  message: string,
  currentState: DialogueState,
  clock: Clock,
  promptVariant: PromptVariant,
): Promise<LLMExtraction> {
  return extractInformation(message, currentState, clock, promptVariant);
}


export async function updateDialogueStateWithLLM(
  message: string,
  currentState: DialogueState,
  clock: Clock = systemClock,
): Promise<DialogueState> {
  if (!message.trim()) {
    throw new Error("The patient's message cannot be empty.");
  }

  const extracted = await extractInformation(
    message,
    currentState,
    clock,
  );

  const detectedDate = extractDate(message, clock);



  // Determine whether the patient has started a different task.
  const intentChanged =
    extracted.intent !== null &&
    extracted.intent !== currentState.intent;

  // Clear information belonging to the previous task if the intent changes.
  const baseState: DialogueState = intentChanged
    ? {
        intent: extracted.intent,
        appointmentType: null,
        preferredDate: null,
        preferredTime: null,
        preferredClockTime: null,
        reason: null,
        status: "collecting_information",
        availability: "not_checked",
        existingAppointmentId: null,
      }
    : currentState;

  return {
    ...baseState,

    intent: extracted.intent ?? baseState.intent,

    appointmentType:
      extracted.appointmentType ??
      baseState.appointmentType,

    preferredDate:
      detectedDate ??
      baseState.preferredDate,

    preferredTime:
      extracted.preferredTime ??
      baseState.preferredTime,

    preferredClockTime:
      extractClockTime(message) ??
      extracted.preferredClockTime ??
      baseState.preferredClockTime,

    reason: extractReason(message) ?? baseState.reason,

    existingAppointmentId:
      extracted.existingAppointmentId ??
      baseState.existingAppointmentId,
  };
}