
import type { DialogueState } from "../types.js";
import test from "node:test";
import assert from "node:assert/strict";
import { detectPreferredClockTime,
    detectExistingAppointmentId,
 } from "../logic.js";

import {
  detectIntent,
  detectAppointmentType,
  detectTimePreference,
  detectPreferredDate,
  getMissingFields,
  updateStateFromMessage,
  checkSimulatedAvailability,
  getNextQuestion,
} from "../logic.js";


const initialState: DialogueState = {
  intent: null,
  appointmentType: null,
  preferredDate: null,
  preferredTime: null,
  preferredClockTime: null,
  reason: null,
  status: "collecting_information",
  availability: "not_checked",
  existingAppointmentId: null,
};

test("detects booking intent", () => {
  assert.equal(detectIntent("I want to book an appointment"), "book");
});

test("detects cancellation intent", () => {
  assert.equal(detectIntent("I want to cancel my appointment"), "cancel");
});

test("detects rescheduling intent", () => {
  assert.equal(detectIntent("I need to reschedule my appointment"), "reschedule");
});

test("returns null for unknown intent", () => {
  assert.equal(detectIntent("Hello"), null);
});

test("detects appointment types", () => {
  assert.equal(detectAppointmentType("general consultation"), "general_consultation");
  assert.equal(detectAppointmentType("pediatric appointment"), "pediatric");
  assert.equal(detectAppointmentType("cardiology appointment"), "cardiologist");
  assert.equal(detectAppointmentType("follow-up"), "follow_up");
  assert.equal(detectAppointmentType("nurse appointment"), "nurse_appointment");
});

test("detects time preferences", () => {
  assert.equal(detectTimePreference("morning"), "morning");
  assert.equal(detectTimePreference("afternoon"), "afternoon");
  assert.equal(detectTimePreference("evening"), "evening");
  assert.equal(detectTimePreference("10:30 AM"), "specific_time");
});

test("detects an explicit date", () => {
  assert.equal(
    detectPreferredDate("Book for 2026-11-05", "2026-10-31"),
    "2026-11-05"
  );
});

test("detects tomorrow using a fixed reference date", () => {
  assert.equal(
    detectPreferredDate("I prefer tomorrow", "2026-10-31"),
    "2026-11-01"
  );
});

test("detects the next weekday", () => {
  assert.equal(
    detectPreferredDate("Next Monday", "2026-10-31"),
    "2026-11-02"
  );
});

test("identifies missing booking information", () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
  };

  assert.deepEqual(getMissingFields(state), [
    "appointmentType",
    "preferredDate",
    "preferredTime",
  ]);
});

test("identifies missing cancellation appointment ID", () => {
  const state: DialogueState = {
    ...initialState,
    intent: "cancel",
  };

  assert.deepEqual(getMissingFields(state), ["existingAppointmentId"]);
});

test("updates dialogue state from a patient message", () => {
  const updated = updateStateFromMessage(
    initialState,
    "I want to book a cardiology appointment tomorrow morning",
    "2026-10-31"
  );

  assert.equal(updated.intent, "book");
  assert.equal(updated.appointmentType, "cardiologist");
  assert.equal(updated.preferredDate, "2026-11-01");
  assert.equal(updated.preferredTime, "morning");
});

test("does not check availability for incomplete requests", () => {
  assert.equal(
    checkSimulatedAvailability(initialState),
    "not_checked"
  );
});

test("checks a complete booking request as available", () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
    appointmentType: "general_consultation",
    preferredDate: "2026-11-05",
    preferredTime: "morning",
  };

  assert.equal(checkSimulatedAvailability(state), "available");
});

test("detects 10:30 AM as 10:30", () => {
  assert.equal(detectPreferredClockTime("10:30 AM"), "10:30");
});

test("converts 2 PM to 14:00", () => {
  assert.equal(detectPreferredClockTime("2 PM"), "14:00");
});

test("converts 12 AM to 00:00", () => {
  assert.equal(detectPreferredClockTime("12 AM"), "00:00");
});

test("converts 12 PM to 12:00", () => {
  assert.equal(detectPreferredClockTime("12 PM"), "12:00");
});

test("returns null when no exact time is provided", () => {
  assert.equal(detectPreferredClockTime("tomorrow morning"), null);
});

test("identifies missing exact clock time when specific time is requested", () => {
  const state: DialogueState = {
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-05",
    preferredTime: "specific_time",
    preferredClockTime: null,
    reason: null,
    status: "collecting_information",
    availability: "not_checked",
    existingAppointmentId: null,
  };

  assert.deepEqual(getMissingFields(state), ["preferredClockTime"]);
});

test("asks for exact clock time when it is missing", () => {
  const question = getNextQuestion(["preferredClockTime"]);

  assert.equal(
    question,
    "What exact time would you prefer? For example, 10:30 AM."
  );
});

test("detects an existing appointment ID", () => {
  assert.equal(
    detectExistingAppointmentId("Cancel appointment APT-001"),
    "APT-001"
  );

  assert.equal(
    detectExistingAppointmentId("Cancel appointment apt-002"),
    "APT-002"
  );

  assert.equal(
    detectExistingAppointmentId("I want to cancel my appointment"),
    null
  );
});