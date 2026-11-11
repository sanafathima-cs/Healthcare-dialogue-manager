
import test from "node:test";
import assert from "node:assert/strict";

import { AppointmentRepository } from "../../appointment/appointmentRepository.js";
import { AppointmentService } from "../../appointment/appointmentService.js";
import { DialogueController } from "../dialogueController.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "node:test";
import { createFixedClock } from "../../shared/clock.js";

const testDirectories: string[] = [];
const defaultTestClock = createFixedClock("2026-11-02T08:00:00");
let testClock = defaultTestClock;

afterEach(() => {
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }

  testDirectories.length = 0;
});

// Create a fresh test environment for every test.
function createTestEnvironment(patientId = "PAT-004") {
  const testDirectory = mkdtempSync(
  join(tmpdir(), "rule-dialogue-test-")
);

testDirectories.push(testDirectory);

const repository = new AppointmentRepository(
  join(testDirectory, "appointments.json")
);

  const appointmentService = new AppointmentService(repository, testClock);
  const controller = new DialogueController(
    appointmentService,
    patientId,
    testClock
  );

  return {
    repository,
    appointmentService,
    controller,
  };
}

// TEST 1: Booking an appointment

test("books an appointment through the dialogue controller", async () => {
  const { repository, controller } =
    createTestEnvironment("PAT-001");

  const response = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(response, /slot is available/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /appointment is confirmed/i);

  const appointments = repository.getAll();

  assert.equal(appointments.length, 4);

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.date === "2026-11-09" &&
      appointment.time === "10:30"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.appointmentType, "cardiologist");
  assert.equal(newAppointment.patientId, "PAT-001");
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 2: Collecting information across multiple messages

test("collects appointment information across multiple messages", async () => {
  const { repository, controller } = createTestEnvironment();

  const response1 = await controller.processMessage(
    "I want a cardiologist appointment"
  );

  assert.match(response1, /date/i);

  const response2 = await controller.processMessage("November 9");

  assert.match(response2, /time/i);

  const response3 = await controller.processMessage("10:30 AM");

  assert.match(response3, /slot is available/i);

  const response4 = controller.processConfirmation("yes");

  assert.match(response4, /appointment is confirmed/i);

  const appointments = repository.getAll();

  assert.equal(appointments.length, 4);

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.date === "2026-11-09" &&
      appointment.time === "10:30"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.appointmentType, "cardiologist");
  assert.equal(newAppointment.patientId, "PAT-004");
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 3: Cancelling an appointment

test("cancels an appointment through the dialogue controller", async () => {
  const { repository, controller } =
    createTestEnvironment("PAT-001");

  const appointmentBefore = repository.getById("APT-001");

  assert.ok(appointmentBefore);
  assert.equal(appointmentBefore.status, "scheduled");

  const response = await controller.processMessage(
    "Cancel appointment APT-001"
  );

  assert.match(response, /are you sure/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /successfully cancelled/i);

  const appointmentAfter = repository.getById("APT-001");

  assert.ok(appointmentAfter);
  assert.equal(appointmentAfter.status, "cancelled");
});

// TEST 4: Rescheduling an appointment

test("reschedules an appointment through the dialogue controller", async () => {
  const { repository, controller } =
    createTestEnvironment("PAT-001");

  const appointmentBefore = repository.getById("APT-001");

  assert.ok(appointmentBefore);
  assert.equal(appointmentBefore.date, "2026-11-05");
  assert.equal(appointmentBefore.time, "10:30");
  assert.equal(appointmentBefore.status, "scheduled");

  const response = await controller.processMessage(
    "Reschedule appointment APT-001 to November 9 at 13:00"
  );

  assert.match(response, /slot is available/i);
  assert.match(response, /confirm rescheduling/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /successfully rescheduled/i);

  const appointmentAfter = repository.getById("APT-001");

  assert.ok(appointmentAfter);
  assert.equal(appointmentAfter.date, "2026-11-09");
  assert.equal(appointmentAfter.time, "13:00");
  assert.equal(appointmentAfter.patientId, "PAT-001");
  assert.equal(appointmentAfter.status, "scheduled");
});

// TEST 5: Recovering from an unavailable appointment slot

test("recovers when the requested appointment slot is unavailable", async () => {
  const { repository, controller } = createTestEnvironment("PAT-004");

  const response1 = await controller.processMessage(
    "I want a cardiologist appointment on November 5 at 10:30 AM"
  );

  assert.match(response1, /10:30 is unavailable/i);
  assert.match(response1, /09:00/);
  assert.match(response1, /09:30/);
  assert.match(response1, /10:00/);
  assert.match(response1, /11:30/);

  const response2 = await controller.processMessage(
    "November 9 at 13:00"
  );

  assert.match(response2, /slot is available/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /appointment is confirmed/i);

  const appointments = repository.getAll();

  assert.equal(appointments.length, 4);

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.date === "2026-11-09" &&
      appointment.time === "13:00"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.appointmentType, "cardiologist");
  assert.equal(newAppointment.patientId, "PAT-004");
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 6: Correcting appointment time while confirming

test("allows the user to correct the appointment time while confirming", async () => {
  const { repository, controller } = createTestEnvironment("PAT-004");

  const response1 = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 13:00"
  );

  assert.match(response1, /13:00/);
  assert.match(response1, /confirm/i);

  const response2 = await controller.processMessage(
    "Actually, I meant 14:00"
  );

  assert.match(response2, /14:00/);
  assert.match(response2, /confirm/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /appointment is confirmed/i);

  const appointments = repository.getAll();

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.patientId === "PAT-004" &&
      appointment.date === "2026-11-09"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.time, "14:00");
  assert.equal(newAppointment.appointmentType, "cardiologist");
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 7: Correcting an unavailable appointment slot

test("allows the user to correct an unavailable appointment slot", async () => {
  const { repository, controller } = createTestEnvironment("PAT-004");

  const response1 = await controller.processMessage(
    "I want a cardiologist appointment on November 5 at 10:30 AM"
  );

  assert.match(response1, /unavailable/i);

  const response2 = await controller.processMessage(
    "Actually, November 9 at 14:00"
  );

  assert.match(response2, /14:00/);
  assert.match(response2, /available/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /appointment is confirmed/i);

  const appointments = repository.getAll();

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.patientId === "PAT-004" &&
      appointment.date === "2026-11-09"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.time, "14:00");
  assert.equal(newAppointment.appointmentType, "cardiologist");
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 8: Rejecting cancellation

test("keeps the appointment when the patient rejects cancellation", async () => {
  const { repository, controller } = createTestEnvironment("PAT-001");

  const response1 = await controller.processMessage(
    "I want to cancel appointment APT-001"
  );

  assert.match(response1, /sure you want to cancel/i);

  const response2 = controller.processConfirmation("no");

  assert.match(response2, /not been cancelled/i);

  const appointment = repository.getAll().find(
    (item) => item.id === "APT-001"
  );

  assert.ok(appointment);
  assert.equal(appointment.status, "scheduled");
});

// TEST 9: Acknowledging a completed appointment

test("responds politely when the patient says ok thanks after booking", async () => {
  const { controller } = createTestEnvironment("PAT-004");

  const response = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(response, /slot is available/i);

  const confirmation = controller.processConfirmation("yes");

  assert.match(confirmation, /appointment is confirmed/i);

  const acknowledgement = await controller.processMessage("ok thanks");

  assert.match(acknowledgement, /you're welcome/i);
});

// TEST 10: Starting a second appointment after completing the first

test("allows the patient to book a second appointment in the same conversation", async () => {
  const { repository, controller } = createTestEnvironment("PAT-004");

  // First appointment
  const firstResponse = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(firstResponse, /slot is available/i);

  const firstConfirmation = controller.processConfirmation("yes");

  assert.match(firstConfirmation, /appointment is confirmed/i);

  // Second appointment
  const secondResponse = await controller.processMessage(
    "I want a general consultation on November 10 at 11:00 AM"
  );

  assert.match(secondResponse, /slot is available/i);

  const secondConfirmation = controller.processConfirmation("yes");

  assert.match(secondConfirmation, /appointment is confirmed/i);

  // Verify both appointments exist.
  const appointments = repository.getAll();

  assert.equal(appointments.length, 5);

  const patientAppointments = appointments.filter(
    (appointment) =>
      appointment.patientId === "PAT-004" &&
      appointment.status === "scheduled"
  );

  assert.equal(patientAppointments.length, 2);
});

// TEST 11: Starting cancellation after completing a booking

test("allows the patient to cancel an appointment after completing a booking", async () => {
  const { repository, controller } = createTestEnvironment("PAT-001");

  // First, book a new appointment.
  const bookingResponse = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(bookingResponse, /slot is available/i);

  const bookingConfirmation = controller.processConfirmation("yes");

  assert.match(bookingConfirmation, /appointment is confirmed/i);

  // Next, start a cancellation task.
  const cancellationResponse = await controller.processMessage(
    "Cancel appointment APT-001"
  );

  assert.match(cancellationResponse, /are you sure/i);

  const cancellationConfirmation =
    controller.processConfirmation("yes");

  assert.match(cancellationConfirmation, /successfully cancelled/i);

  // Verify that the existing appointment was cancelled.
  const cancelledAppointment = repository.getById("APT-001");

  assert.ok(cancelledAppointment);
  assert.equal(cancelledAppointment.status, "cancelled");

  // Verify that the newly booked appointment still exists.
  const appointments = repository.getAll();

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.patientId === "PAT-001" &&
      appointment.date === "2026-11-09" &&
      appointment.time === "10:30"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 12: Starting rescheduling after completing a booking

test("allows the patient to reschedule an appointment after completing a booking", async () => {
  const { repository, controller } = createTestEnvironment("PAT-001");

  // First, book a new appointment.
  const bookingResponse = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(bookingResponse, /slot is available/i);

  const bookingConfirmation = controller.processConfirmation("yes");

  assert.match(bookingConfirmation, /appointment is confirmed/i);

  // Next, start a rescheduling task.
  const rescheduleResponse = await controller.processMessage(
    "Reschedule appointment APT-001 to November 10 at 1:00 PM"
  );

  assert.match(rescheduleResponse, /confirm/i);

  const rescheduleConfirmation = controller.processConfirmation("yes");

  assert.match(rescheduleConfirmation, /successfully rescheduled/i);

  // Verify that the existing appointment was rescheduled.
  const rescheduledAppointment = repository.getById("APT-001");

  assert.ok(rescheduledAppointment);
  assert.equal(rescheduledAppointment.status, "scheduled");
  assert.equal(rescheduledAppointment.date, "2026-11-10");
  assert.equal(rescheduledAppointment.time, "13:00");

  // Verify that the newly booked appointment still exists.
  const appointments = repository.getAll();

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.patientId === "PAT-001" &&
      appointment.date === "2026-11-09" &&
      appointment.time === "10:30"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 13: Starting a booking after completing a cancellation

test("allows the patient to book an appointment after completing a cancellation", async () => {
  const { repository, controller } = createTestEnvironment("PAT-001");

  // First, cancel an existing appointment.
  const cancellationResponse = await controller.processMessage(
    "Cancel appointment APT-001"
  );

  assert.match(cancellationResponse, /are you sure/i);

  const cancellationConfirmation =
    controller.processConfirmation("yes");

  assert.match(cancellationConfirmation, /successfully cancelled/i);

  // Next, start a new booking task.
  const bookingResponse = await controller.processMessage(
    "I want a cardiologist appointment on November 9 at 10:30 AM"
  );

  assert.match(bookingResponse, /slot is available/i);

  const bookingConfirmation = controller.processConfirmation("yes");

  assert.match(bookingConfirmation, /appointment is confirmed/i);

  // Verify the original appointment remains cancelled.
  const cancelledAppointment = repository.getById("APT-001");

  assert.ok(cancelledAppointment);
  assert.equal(cancelledAppointment.status, "cancelled");

  // Verify the new appointment was booked.
  const appointments = repository.getAll();

  const newAppointment = appointments.find(
    (appointment) =>
      appointment.patientId === "PAT-001" &&
      appointment.date === "2026-11-09" &&
      appointment.time === "10:30"
  );

  assert.ok(newAppointment);
  assert.equal(newAppointment.status, "scheduled");
});

// TEST 14: Ending the conversation politely

for (const closingMessage of [
  "no thanks",
  "no thank you",
  "that's all",
  "goodbye",
]) {
  test(`ends the conversation when the patient says "${closingMessage}"`, async () => {
    const { controller } = createTestEnvironment("PAT-004");

    // Complete a booking.
    const bookingResponse = await controller.processMessage(
      "I want a cardiologist appointment on November 9 at 10:30 AM"
    );

    assert.match(bookingResponse, /slot is available/i);

    const confirmation = controller.processConfirmation("yes");

    assert.match(confirmation, /appointment is confirmed/i);

    // Acknowledge the completed booking.
    const acknowledgement = await controller.processMessage("ok thanks");

    assert.match(acknowledgement, /you're welcome/i);

    // Patient ends the conversation.
    const closingResponse = await controller.processMessage(
      closingMessage
    );

    assert.match(closingResponse, /thank you for using our appointment service/i);

    // Verify that the conversation cannot start another task.
    const nextResponse = await controller.processMessage(
      "I want another appointment"
    );

    assert.match(nextResponse, /conversation has ended/i);
  });
}