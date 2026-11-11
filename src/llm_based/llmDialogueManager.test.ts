
import { test } from "node:test";
import assert from "node:assert/strict";

import { updateDialogueStateWithLLM } from "./llmDialogueManager.js";
import type { DialogueState } from "../rule_based/types.js";
import { createFixedClock } from "../shared/clock.js";

const testClock = createFixedClock("2026-11-02T08:00:00");
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

function mockOllamaResponse(content: string, status = 200) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        message: {
          content,
        },
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("extracts booking information correctly", async () => {
  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-09",
      preferredTime: "specific_time",
      preferredClockTime: "10:30",
      reason: null,
      existingAppointmentId: null,
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "I want a cardiologist appointment on November 9 at 10:30 AM.",
      initialState,
      testClock,
    );

    assert.equal(result.intent, "book");
    assert.equal(result.appointmentType, "cardiologist");
    assert.equal(result.preferredDate, "2026-11-09");
    assert.equal(result.preferredTime, "specific_time");
    assert.equal(result.preferredClockTime, "10:30");
  } finally {
    restoreFetch();
  }
});

test("preserves previously collected information", async () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-09",
  };

  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: null,
      appointmentType: null,
      preferredDate: null,
      preferredTime: "specific_time",
      preferredClockTime: "10:30",
      reason: null,
      existingAppointmentId: null,
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "I prefer 10:30 AM.",
      state,
    );

    assert.equal(result.intent, "book");
    assert.equal(result.appointmentType, "cardiologist");
    assert.equal(result.preferredDate, "2026-11-09");
    assert.equal(result.preferredClockTime, "10:30");
  } finally {
    restoreFetch();
  }
});

test("ignores invalid appointment types and dates", async () => {
  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: "book",
      appointmentType: "dentist",
      preferredDate: "not-a-date",
      preferredTime: "specific_time",
      preferredClockTime: "10:30",
      reason: null,
      existingAppointmentId: null,
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "I want an appointment.",
      initialState,
    );

    assert.equal(result.intent, "book");
    assert.equal(result.appointmentType, null);
    assert.equal(result.preferredDate, null);
    assert.equal(result.preferredClockTime, "10:30");
  } finally {
    restoreFetch();
  }
});

test("rejects invalid JSON returned by the LLM", async () => {
  const restoreFetch = mockOllamaResponse(
    "This is not valid JSON",
  );

  try {
    await assert.rejects(
      updateDialogueStateWithLLM(
        "I want an appointment.",
        initialState,
      ),
      /invalid JSON/i,
    );
  } finally {
    restoreFetch();
  }
});

test("rejects failed Ollama requests", async () => {
  const restoreFetch = mockOllamaResponse(
    "Server error",
    500,
  );

  try {
    await assert.rejects(
      updateDialogueStateWithLLM(
        "I want an appointment.",
        initialState,
      ),
      /Ollama request failed: 500/i,
    );
  } finally {
    restoreFetch();
  }
});

test("rejects an empty patient message", async () => {
  await assert.rejects(
    updateDialogueStateWithLLM("   ", initialState),
    /cannot be empty/i,
  );
});

test("replaces a previously collected date when the patient corrects it", async () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-09",
  };

  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: null,
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: null,
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "Actually, November 10.",
      state,
    );

    assert.equal(result.preferredDate, "2026-11-10");
  } finally {
    restoreFetch();
  }
});

test("replaces a previously collected time when the patient corrects it", async () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-09",
    preferredClockTime: "10:30",
  };

  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: null,
      appointmentType: null,
      preferredDate: null,
      preferredTime: "specific_time",
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: null,
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "Actually, 2 PM.",
      state,
    );

    assert.equal(result.preferredClockTime, "14:00");
  } finally {
    restoreFetch();
  }
});

test("clears operation-specific information when the patient changes intent", async () => {
  const state: DialogueState = {
    ...initialState,
    intent: "book",
    appointmentType: "cardiologist",
    preferredDate: "2026-11-09",
    preferredClockTime: "10:30",
    preferredTime: "specific_time",
  };

  const restoreFetch = mockOllamaResponse(
    JSON.stringify({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-001",
    }),
  );

  try {
    const result = await updateDialogueStateWithLLM(
      "Actually, cancel appointment APT-001.",
      state,
    );

    assert.equal(result.intent, "cancel");
    assert.equal(result.appointmentType, null);
    assert.equal(result.preferredDate, null);
    assert.equal(result.preferredClockTime, null);
    assert.equal(result.existingAppointmentId, "APT-001");
  } finally {
    restoreFetch();
  }
});