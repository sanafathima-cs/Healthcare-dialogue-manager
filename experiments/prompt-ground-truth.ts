import type { LLMExtraction } from "../src/llm_based/llmDialogueManager.js";

export const groundTruth: Record<string, LLMExtraction> = {
  "P-001": {
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-03",
    preferredTime: null,
    preferredClockTime: "10:30",
    reason: null,
    existingAppointmentId: null,
  },

  "P-002": {
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: null,
    preferredTime: null,
    preferredClockTime: null,
    reason: null,
    existingAppointmentId: null,
  },

  "P-003": {
    intent: "book",
    appointmentType: "pediatric",
    preferredDate: "2026-11-06",
    preferredTime: "afternoon",
    preferredClockTime: null,
    reason: null,
    existingAppointmentId: null,
  },

  "P-004": {
    intent: "book",
    appointmentType: "general_consultation",
    preferredDate: "2026-11-03",
    preferredTime: "morning",
    preferredClockTime: null,
    reason: "headache",
    existingAppointmentId: null,
  },

  "P-005": {
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-04",
    preferredTime: "specific_time",
    preferredClockTime: "14:00",
    reason: null,
    existingAppointmentId: null,
  },

  "P-006": {
    intent: "book",
    appointmentType: "general_consultation",
    preferredDate: null,
    preferredTime: null,
    preferredClockTime: null,
    reason: null,
    existingAppointmentId: null,
  },

  "P-007": {
    intent: "cancel",
    appointmentType: null,
    preferredDate: null,
    preferredTime: null,
    preferredClockTime: null,
    reason: null,
    existingAppointmentId: "APT-001",
  },

  "P-008": {
    intent: "reschedule",
    appointmentType: null,
    preferredDate: "2026-11-09",
    preferredTime: "specific_time",
    preferredClockTime: "15:00",
    reason: null,
    existingAppointmentId: "APT-001",
  },
};