
import test from "node:test";
import assert from "node:assert/strict";
import { createActor } from "xstate";

import { dialogueMachine } from "../dialogueMachine.js";
import type { DialogueState } from "../types.js";

function createInitialDialogue(): DialogueState {
  return {
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
}

test("starts by collecting patient information", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "collectingInformation");
  assert.equal(
    snapshot.context.dialogue.status,
    "collecting_information"
  );

  actor.stop();
});

test("does not proceed when required information is missing", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "book",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });

  assert.equal(
    actor.getSnapshot().value,
    "collectingInformation"
  );

  actor.stop();
});

test("moves to availability checking when booking information is complete", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-05",
      preferredTime: "morning",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });

  assert.equal(
    actor.getSnapshot().value,
    "checkingAvailability"
  );

  actor.stop();
});

test("moves to confirmation when the requested slot is available", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-05",
      preferredTime: "morning",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });
  actor.send({ type: "SLOT_AVAILABLE" });

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "confirming");
  assert.equal(snapshot.context.dialogue.availability, "available");
  assert.equal(snapshot.context.dialogue.status, "confirming");

  actor.stop();
});

test("returns to information collection when the slot is unavailable", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-05",
      preferredTime: "morning",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });
  actor.send({ type: "SLOT_UNAVAILABLE" });

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "collectingInformation");
  assert.equal(snapshot.context.dialogue.availability, "unavailable");

  actor.stop();
});

test("completes the dialogue after patient confirmation", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-05",
      preferredTime: "morning",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });
  actor.send({ type: "SLOT_AVAILABLE" });
  actor.send({ type: "CONFIRM" });

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "completed");
  assert.equal(snapshot.context.dialogue.status, "completed");

  actor.stop();
});


test("routes a complete cancellation directly to cancellation confirmation", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "cancel",
      existingAppointmentId: "APT-001",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "confirmingCancellation");
  assert.equal(snapshot.context.dialogue.intent, "cancel");

  actor.stop();
});

test("does not proceed with cancellation when appointment ID is missing", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "cancel",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });

  assert.equal(
    actor.getSnapshot().value,
    "collectingInformation"
  );

  actor.stop();
});

test("completes cancellation after patient confirmation", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "cancel",
      existingAppointmentId: "APT-001",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });
  actor.send({ type: "CONFIRM" });

  const snapshot = actor.getSnapshot();

  assert.equal(snapshot.value, "completed");
  assert.equal(snapshot.context.dialogue.status, "completed");

  actor.stop();
});

test("routes a complete rescheduling request to availability checking", () => {
  const actor = createActor(dialogueMachine);
  actor.start();

  actor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: {
      ...createInitialDialogue(),
      intent: "reschedule",
      existingAppointmentId: "APT-001",
      preferredDate: "2026-11-05",
      preferredTime: "morning",
    },
  });

  actor.send({ type: "INFORMATION_COMPLETE" });

  assert.equal(
    actor.getSnapshot().value,
    "checkingAvailability"
  );

  actor.stop();
});
