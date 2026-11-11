
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { AppointmentRepository } from "../appointment/appointmentRepository.js";
import { AppointmentService } from "../appointment/appointmentService.js";
import { LLMDialogueController } from "./llmDialogueController.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFixedClock } from "../shared/clock.js";

const testClock = createFixedClock("2026-11-02T08:00:00");
const originalFetch = globalThis.fetch;

function mockOllamaResponse(extractedState: Record<string, unknown>) {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify(extractedState),
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
}

const testDirectories: string[] = [];

function createTestRepository(): AppointmentRepository {
  const testDirectory = mkdtempSync(
    join(tmpdir(), "llm-dialogue-test-")
  );

  testDirectories.push(testDirectory);

  return new AppointmentRepository(
    join(testDirectory, "appointments.json")
  );
}

function createController(patientId = "PAT-004") {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);
  const controller = new LLMDialogueController(service, patientId, testClock);

  return { repository, service, controller };
}

describe("LLMDialogueController", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;

    for (const directory of testDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }

    testDirectories.length = 0;
  });

  it("asks for missing information before booking", async () => {
    const { controller } = createController();

    mockOllamaResponse({
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: null,
    });

    const response = await controller.processMessage(
      "I want to book a cardiologist appointment",
    );

    assert.equal(typeof response, "string");
    assert.ok(response.length > 0);
    assert.equal(controller.getDialogueState().intent, "book");
    assert.equal(
      controller.getDialogueState().appointmentType,
      "cardiologist",
    );
    assert.equal(
      controller.getDialogueState().status,
      "collecting_information",
    );
  });

  it("completes a booking after collecting details and confirmation", async () => {
    const { repository, controller } = createController();

    mockOllamaResponse({
      intent: "book",
      appointmentType: "general_consultation",
      preferredDate: "2026-11-09",
      preferredTime: "specific_time",
      preferredClockTime: "09:00",
      reason: null,
      existingAppointmentId: null,
    });

    const response = await controller.processMessage(
      "Book a general consultation on 9 November 2026 at 09:00",
    );

    assert.equal(typeof response, "string");
    assert.ok(response.length > 0);

    const state = controller.getDialogueState();

    assert.equal(state.intent, "book");
    assert.equal(state.appointmentType, "general_consultation");

    // If the controller has reached confirmation, confirm the booking.
    if (state.status === "confirming") {
      const confirmation = controller.processConfirmation("yes");
      assert.ok(confirmation.length > 0);
    }

    const createdAppointment = repository
      .getAll()
      .find(
        (appointment) =>
          appointment.patientId === "PAT-004" &&
          appointment.date === "2026-11-09" &&
          appointment.time === "09:00" &&
          appointment.status === "scheduled",
      );

    assert.ok(createdAppointment);
  });

  it("does not cancel an appointment owned by another patient", async () => {
    const { controller, repository } = createController("PAT-004");

    mockOllamaResponse({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-001",
    });

    await controller.processMessage("Cancel appointment APT-001");

    const appointment = repository.getById("APT-001");

    assert.equal(appointment?.status, "scheduled");
  });

  it("can cancel an appointment belonging to the patient", async () => {
    const { controller, repository } = createController("PAT-001");

    mockOllamaResponse({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-001",
    });

    const response = await controller.processMessage(
      "Cancel my appointment APT-001",
    );

    assert.ok(response.length > 0);

    if (controller.getDialogueState().status === "confirming") {
      controller.processConfirmation("yes");
    }

    assert.equal(repository.getById("APT-001")?.status, "cancelled");
  });

  it("does not change an appointment when the patient rejects confirmation", async () => {
    const { controller, repository } = createController("PAT-001");

    mockOllamaResponse({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-001",
    });

    await controller.processMessage("Cancel APT-001");

    if (controller.getDialogueState().status === "confirming") {
      controller.processConfirmation("no");
    }

    assert.equal(repository.getById("APT-001")?.status, "scheduled");
  });

  it("does not modify an appointment belonging to another patient during rescheduling", async () => {
    const { controller, repository } = createController("PAT-004");

    mockOllamaResponse({
      intent: "reschedule",
      appointmentType: null,
      preferredDate: "2026-11-09",
      preferredTime: "specific_time",
      preferredClockTime: "10:00",
      reason: null,
      existingAppointmentId: "APT-001",
    });

    await controller.processMessage(
      "Reschedule APT-001 to 9 November 2026 at 10:00",
    );

    const appointment = repository.getById("APT-001");

    assert.equal(appointment?.date, "2026-11-05");
    assert.equal(appointment?.time, "10:30");
  });

  it("handles an unknown appointment ID without changing existing appointments", async () => {
    const { controller, repository } = createController();

    mockOllamaResponse({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-999",
    });

    const before = repository.getAll();

    const response = await controller.processMessage(
      "Cancel appointment APT-999",
    );

    assert.ok(response.length > 0);
    assert.deepEqual(repository.getAll(), before);
  });


  it("successfully reschedules an existing appointment after confirmation", async () => {
    const { controller, repository } = createController("PAT-001");

    mockOllamaResponse({
      intent: "reschedule",
      appointmentType: null,
      preferredDate: "2026-11-09",
      preferredTime: "specific_time",
      preferredClockTime: "10:00",
      reason: null,
      existingAppointmentId: "APT-001",
    });

    const response = await controller.processMessage(
      "Reschedule APT-001 to 9 November 2026 at 10:00",
    );

    assert.ok(response.length > 0);
    assert.equal(controller.getDialogueState().status, "confirming");

    const confirmation = controller.processConfirmation("yes");
    assert.ok(confirmation.length > 0);

    const appointment = repository.getById("APT-001");

    assert.equal(appointment?.status, "scheduled");
    assert.equal(appointment?.date, "2026-11-09");
    assert.equal(appointment?.time, "10:00");
  });

  it("allows the patient to correct the time during booking confirmation", async () => {
    const { controller, repository } = createController("PAT-004");

    // First, the LLM extracts the original requested time.
    mockOllamaResponse({
      intent: "book",
      appointmentType: "general_consultation",
      preferredDate: "2026-11-09",
      preferredTime: "specific_time",
      preferredClockTime: "09:00",
      reason: null,
      existingAppointmentId: null,
    });

    await controller.processMessage(
      "Book a general consultation on 9 November 2026 at 09:00",
    );

    assert.equal(controller.getDialogueState().status, "confirming");
    assert.equal(
      controller.getDialogueState().preferredClockTime,
      "09:00",
    );

    // The patient changes the requested time before confirming.
    mockOllamaResponse({
      intent: null,
      appointmentType: null,
      preferredDate: null,
      preferredTime: "specific_time",
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: null,
    });

    const correctionResponse = await controller.processMessage(
      "Actually, 10:00 instead.",
    );

    assert.ok(correctionResponse.length > 0);

    assert.equal(
      controller.getDialogueState().preferredClockTime,
      "10:00",
    );
    assert.equal(controller.getDialogueState().status, "confirming");

    // Confirm the corrected appointment.
    controller.processConfirmation("yes");

    const createdAppointment = repository
      .getAll()
      .find(
        (appointment) =>
          appointment.patientId === "PAT-004" &&
          appointment.date === "2026-11-09" &&
          appointment.status === "scheduled",
      );

    assert.ok(createdAppointment);
    assert.equal(createdAppointment.time, "10:00");

    // Ensure the original time was not booked.
    assert.equal(
      repository.getAll().some(
        (appointment) =>
          appointment.patientId === "PAT-004" &&
          appointment.date === "2026-11-09" &&
          appointment.time === "09:00" &&
          appointment.status === "scheduled",
      ),
      false,
    );
  });

  it("allows the patient to switch from an incomplete booking to cancellation", async () => {
    const { controller, repository } = createController("PAT-001");

    // The patient starts a booking but has not provided a date or time.
    mockOllamaResponse({
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: null,
    });

    await controller.processMessage(
      "I want to book a cardiologist appointment",
    );

    assert.equal(controller.getDialogueState().intent, "book");
    assert.equal(
      controller.getDialogueState().appointmentType,
      "cardiologist",
    );

    // The patient changes their mind and requests cancellation.
    mockOllamaResponse({
      intent: "cancel",
      appointmentType: null,
      preferredDate: null,
      preferredTime: null,
      preferredClockTime: null,
      reason: null,
      existingAppointmentId: "APT-001",
    });

    const response = await controller.processMessage(
      "Actually, cancel appointment APT-001.",
    );

    assert.ok(response.length > 0);

    const state = controller.getDialogueState();

    assert.equal(state.intent, "cancel");
    assert.equal(state.appointmentType, null);
    assert.equal(state.preferredDate, null);
    assert.equal(state.preferredClockTime, null);
    assert.equal(state.existingAppointmentId, "APT-001");
    assert.equal(state.status, "confirming");

    // Confirm the cancellation.
    controller.processConfirmation("yes");

    assert.equal(
      repository.getById("APT-001")?.status,
      "cancelled",
    );
  });

});
