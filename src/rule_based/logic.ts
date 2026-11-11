import type {
    AppointmentType,
    DialogueState,
    UserIntent,
    TimePreference,
} from "./types.js";

import { systemClock } from "../shared/clock.js";



// Identify the required information that is missing.
export function getMissingFields(state: DialogueState): string[] {
  const missing: string[] = [];

  if (state.intent === "cancel") {
    if (state.existingAppointmentId === null) {
      missing.push("existingAppointmentId");
    }
    return missing;
  }

  if (state.intent === "book") {
    if (state.appointmentType === null) {
      missing.push("appointmentType");
    }

    if (state.preferredDate === null) {
      missing.push("preferredDate");
    }

    if (state.preferredTime === null) {
      missing.push("preferredTime");
    }

    if (state.preferredTime === "specific_time" &&
        state.preferredClockTime === null
    ) {
        missing.push("preferredClockTime");
    }

    return missing;
  }

  if (state.intent === "reschedule") {
    if (state.existingAppointmentId === null) {
      missing.push("existingAppointmentId");
    }

    if (state.preferredDate === null) {
      missing.push("preferredDate");
    }

    if (state.preferredTime === null) {
        missing.push("preferredTime");
    }

    if (state.preferredTime === "specific_time" &&
        state.preferredClockTime === null
    ) {
      missing.push("preferredClockTime");
    }

    return missing;
  }

  // If intent is unknown, ask the user to clarify it.
  missing.push("intent");
  return missing;
}

// 2. Choose the next question based on the missing fields.
export function getNextQuestion(
  missingFields: string[],
  state?: DialogueState
): string {
  if (state?.availability === "unavailable") {
    return "That time is unavailable in our demo schedule. Would you prefer another date or time?";
  }

  if (
    state?.availability === "available" &&
    state.status === "confirming"
  ) {
    const appointmentType =
      state.appointmentType?.replaceAll("_", " ") ?? "appointment";

    const time =
      state.preferredTime?.replaceAll("_", " ") ?? "preferred time";

    return `You requested a ${appointmentType} on ${state.preferredDate} in the ${time}. Would you like to confirm this appointment?`;
  }

  if (missingFields.includes("intent")) {
    return "Would you like to book, reschedule, or cancel an appointment?";
  }

  if (missingFields.includes("existingAppointmentId")) {
    return "Which existing appointment would you like to cancel or reschedule?";
  }

  if (missingFields.includes("appointmentType")) {
    return "What type of appointment would you like?";
  }

  if (missingFields.includes("preferredDate")) {
    return "What date would you prefer?";
  }

  if (missingFields.includes("preferredTime")) {
    return "What time of the day do you prefer?";
  }

  if (missingFields.includes("preferredClockTime")) {
    return "What exact time would you prefer? For example, 10:30 AM.";
  }

  return "All required information has been collected.";
}

// 3. Detect the user's intent from a message.
export function detectIntent(message: string): UserIntent | null {
  const text = message.toLowerCase();

  //Cancellation Intent
  if (
    text.includes("cancel") || 
    text.includes("call off")
) {
    return "cancel";
  }

  //Rescheduling Intent
  if (
    text.includes("reschedule") ||
    text.includes("change my appointment") ||
    text.includes("move my appointment")
  ) {
    return "reschedule";
  }

  //Booking Intent
  if (
    text.includes("book") ||
    text.includes("schedule") ||
    text.includes("make an appointment") ||
    text.includes("want an appointment") ||
    text.includes("want a") && text.includes("appointment") ||
    text.includes("want a") && text.includes("consultation") ||
    text.includes("need a") && text.includes("consultation") ||
    text.includes("need an appointment") ||
    text.includes("would like an appointment")
  ) {
    return "book";
  }

  return null;
}

// 4. Extract the appointment type from the user's message.
export function detectAppointmentType(
  message: string
): AppointmentType | null {
  const text = message.toLowerCase();

  if (text.includes("general consultation")) {
    return "general_consultation";
  }

  if (text.includes("pediatric") || text.includes("paediatric")) {
    return "pediatric";
  }

  if (text.includes("cardiologist") || text.includes("cardiology")) {
    return "cardiologist";
  }

  if (text.includes("follow-up") || text.includes("follow up")) {
    return "follow_up";
  }

  if (text.includes("nurse appointment")) {
    return "nurse_appointment";
  }

  return null;
}

// Detect the preferred time of day.
export function detectTimePreference(
  message: string
): TimePreference | null {
  const text = message.toLowerCase();

  if (text.includes("morning")) {
    return "morning";
  }

  if (text.includes("afternoon")) {
    return "afternoon";
  }

  if (text.includes("evening")) {
    return "evening";
  }

  if (
    /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/.test(text) ||
    /\b\d{1,2}:\d{2}\b/.test(text)
  ) {
    return "specific_time";
  }

  return null;
}

// Detect the exact clock time from a message.

export function detectPreferredClockTime(
  message: string
): string | null {
  const text = message.toLowerCase();

  // 1. First recognise times with AM/PM.
  const amPmMatch = text.match(
    /(?<![\d-])(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/
  );

  if (amPmMatch) {
    let hours = Number(amPmMatch[1]);
    const minutes = Number(amPmMatch[2] ?? "0");
    const period = amPmMatch[3];

    if (hours < 1 || hours > 12 || minutes > 59) {
      return null;
    }

    if (period === "pm" && hours !== 12) {
      hours += 12;
    }

    if (period === "am" && hours === 12) {
      hours = 0;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  // 2. Recognise exact 24-hour times such as 09:00 or 14:30.
  const exactMatch = text.match(
    /(?<![\d-])(\d{1,2}):(\d{2})(?![\d-])/
  );

  if (exactMatch) {
    const hours = Number(exactMatch[1]);
    const minutes = Number(exactMatch[2]);

    if (hours > 23 || minutes > 59) {
      return null;
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  // 3. Recognise an hour without minutes when context makes it clear.
  const bareHourMatch = text.match(
    /\b(morning|afternoon|evening)\s+(?:at\s+)?(\d{1,2})\b|\bat\s+(\d{1,2})\b/
  );

  if (bareHourMatch) {
    let hours = Number(bareHourMatch[2] ?? bareHourMatch[3]);

    if (hours < 1 || hours > 12) {
      return null;
    }

    const period = bareHourMatch[1];

    if (
      (period === "afternoon" || period === "evening") &&
      hours !== 12
    ) {
      hours += 12;
    }

    if (hours === 12 && period === "morning") {
      hours = 0;
    }

    return `${String(hours).padStart(2, "0")}:00`;
  }

  return null;
}



//  Detect the preferred date.
export function detectPreferredDate(
  message: string,
  referenceDate: string
): string | null {
  const text = message.toLowerCase();

  // Validate the reference date.
  const reference = new Date(`${referenceDate}T00:00:00.000Z`);

  if (
    Number.isNaN(reference.getTime()) ||
    reference.toISOString().slice(0, 10) !== referenceDate
  ) {
    return null;
  }

  // Explicit ISO dates.
  const match = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);

  if (match !== null && match[1] !== undefined) {
    const date = match[1];
    const parsed = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      return null;
    }

    return date;
  }

  // Tomorrow.
  if (/\btomorrow\b/.test(text)) {
    reference.setUTCDate(reference.getUTCDate() + 1);
    return reference.toISOString().slice(0, 10);
  }

  // Weekdays: "next Monday", "next Friday", etc.
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
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );

  if (weekdayMatch !== null && weekdayMatch[1] !== undefined) {
    const targetDay = weekdays[weekdayMatch[1]];

    if (targetDay === undefined) {
      return null;
    }

    const currentDay = reference.getUTCDay();
    let daysUntil = (targetDay - currentDay + 7) % 7;

    // "Next Monday" means the following week's Monday.
    if (daysUntil === 0) {
      daysUntil = 7;
    }

    reference.setUTCDate(reference.getUTCDate() + daysUntil);
    return reference.toISOString().slice(0, 10);
  }


  // Month-name dates: "November 7", "Nov 7", "November 7, 2026".
  const months: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  const monthMatch = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/
  );

  if (monthMatch) {
    const monthName = monthMatch[1];
    const day = Number(monthMatch[2]);
    const year = Number(monthMatch[3] ?? reference.getUTCFullYear());

    if (monthName === undefined) {
      return null;
    }

    const month = months[monthName];

    if (month === undefined) {
      return null;
    }

    const parsed = new Date(Date.UTC(year, month, day));

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month ||
      parsed.getUTCDate() !== day
    ) {
      return null;
    }

    // If no year is provided and the date has already passed,
    // assume the patient means that date next year.
    if (
      monthMatch[3] === undefined &&
      parsed < reference
    ) {
      parsed.setUTCFullYear(year + 1);
    }

    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

// Simulate appointment availability.
export function checkSimulatedAvailability(
  state: DialogueState
): "not_checked" | "available" | "unavailable" {
  // We can only check complete booking requests.
  if (
    state.intent !== "book" ||
    state.appointmentType === null ||
    state.preferredDate === null ||
    state.preferredTime === null
  ) {
    return "not_checked";
  }

  // Demo data only: this slot is deliberately unavailable.
  const unavailableSlots = new Set([
    "2026-10-17|morning",
  ]);

  const requestedSlot =
    `${state.preferredDate}|${state.preferredTime}`;

  if (unavailableSlots.has(requestedSlot)) {
    return "unavailable";
  }

  // All other complete slots are available in this simulation.
  return "available";
}

// Update the dialogue state based on simulated availability.
export function checkAvailabilityAndUpdateState(
  state: DialogueState
): DialogueState {
  const result = checkSimulatedAvailability(state);

  if (result === "available") {
    return {
      ...state,
      availability: "available",
      status: "confirming",
    };
  }

  if (result === "unavailable") {
    return {
      ...state,
      availability: "unavailable",
      status: "collecting_information",
    };
  }

  return {
    ...state,
    availability: "not_checked",
  };
}

// Handle confirmation as a standalone state update.
export function handleConfirmation(
  state: DialogueState,
  message: string
): { state: DialogueState; response: string } {
  const answer = message.trim().toLowerCase();

  if (state.status !== "confirming") {
    return {
      state,
      response: "We are not waiting for appointment confirmation.",
    };
  }

  if (["yes", "yes please", "confirm"].includes(answer)) {
    const updatedState: DialogueState = {
      ...state,
      status: "completed",
    };

    return {
      state: updatedState,
      response: "Your demo appointment has been confirmed.",
    };
  }

  if (
    ["no", "no thanks", "don't confirm", "do not confirm"].includes(answer)
  ) {
    const updatedState: DialogueState = {
      ...state,
      status: "collecting_information",
      availability: "not_checked",
      preferredDate: null,
      preferredTime: null,
    };

    return {
      state: updatedState,
      response: "No problem. What other date and time would you prefer?",
    };
  }

  return {
    state,
    response: "Please answer yes to confirm, or no to choose another time.",
  };
}

// Detect an existing appointment ID from the user's message.
export function detectExistingAppointmentId(
  message: string
): string | null {
  const match = message.match(/\bAPT-\d+\b/i);

  return match ? match[0].toUpperCase() : null;
}

// Update the dialogue state with information detected in a message.
export function updateStateFromMessage(
  state: DialogueState,
  message: string,
  referenceDateOverride: string = systemClock.now().toISOString().slice(0, 10)
): DialogueState {
  const detectedIntent = detectIntent(message);
  const detectedAppointmentType = detectAppointmentType(message);
  const detectedTimePreference = detectTimePreference(message);
  const detectedDate = detectPreferredDate(message, referenceDateOverride);
  const detectedClockTime = detectPreferredClockTime(message);
  const detectedAppointmentId = detectExistingAppointmentId(message);

  return {
    ...state,
    intent: detectedIntent ?? state.intent,
    appointmentType: detectedAppointmentType ?? state.appointmentType,
    preferredTime: detectedTimePreference ?? state.preferredTime,
    preferredClockTime: detectedClockTime ?? state.preferredClockTime,
    preferredDate: detectedDate ?? state.preferredDate,
    existingAppointmentId: detectedAppointmentId ?? state.existingAppointmentId,
  };
}