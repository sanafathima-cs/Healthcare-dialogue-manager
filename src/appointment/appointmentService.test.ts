import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { AppointmentRepository } from "./appointmentRepository.js";
import { AppointmentService } from "./appointmentService.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixedClock } from "../shared/clock.js";

const testDirectories: string[] = [];

function createTestRepository(): AppointmentRepository {
  const testDirectory = mkdtempSync(
    join(tmpdir(), "appointment-test-")
  );
  testDirectories.push(testDirectory);
  return new AppointmentRepository(
    join(testDirectory, "appointments.json")
  );
}

describe("AppointmentService", () => {

    afterEach(() => {
    for (const directory of testDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }

    testDirectories.length = 0;
  });
  
  const defaultTestClock = createFixedClock("2026-11-02T08:00:00");
  let testClock = defaultTestClock;
  function setTestTime(isoDate: string) {
    testClock = createFixedClock(isoDate);
  }

  it("returns available slots for a given date", () => {
    const repository = createTestRepository();
    const service = new AppointmentService(repository, testClock);

    const slots = service.getAvailableSlots(
      "cardiologist",
      "2026-11-05"
    );

    assert.equal(slots.length, 10);

    const occupiedSlot = slots.find(
      (slot) => slot.time === "10:30"
    );

    assert.equal(occupiedSlot?.available, false);
  });


it("books an available appointment successfully", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  const appointment = service.bookAppointment(
    "cardiologist",
    "2026-11-09",
    "09:00",
    "PAT-004"
  );

  assert.equal(appointment.appointmentType, "cardiologist");
  assert.equal(appointment.date, "2026-11-09");
  assert.equal(appointment.time, "09:00");
  assert.equal(appointment.patientId, "PAT-004");
  assert.equal(appointment.status, "scheduled");

  const savedAppointment = repository.getById(appointment.id);

  assert.ok(savedAppointment);
});

it("cancels an existing appointment successfully", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  const cancelledAppointment = service.cancelAppointment("APT-001", "PAT-001");

  assert.equal(cancelledAppointment.id, "APT-001");
  assert.equal(cancelledAppointment.status, "cancelled");

  const savedAppointment = repository.getById("APT-001");

  assert.equal(savedAppointment?.status, "cancelled");
});

it("reschedules an existing appointment successfully", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  const updatedAppointment = service.rescheduleAppointment(
    "APT-001",
    "2026-11-09",
    "10:30",
    "PAT-001"
  );

  assert.equal(updatedAppointment.id, "APT-001");
  assert.equal(updatedAppointment.date, "2026-11-09");
  assert.equal(updatedAppointment.time, "10:30");
  assert.equal(updatedAppointment.status, "scheduled");

  const savedAppointment = repository.getById("APT-001");

  assert.equal(savedAppointment?.date, "2026-11-09");
  assert.equal(savedAppointment?.time, "10:30");
});

//Reject booking an occupied slot
it("rejects booking an occupied slot", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  assert.throws(
    () => service.bookAppointment(
      "cardiologist",
      "2026-11-05",
      "10:30",
      "PAT-001"
    ),
    /unavailable/
  );
});

//Reject cancelling an appointment twice
it("rejects cancelling an already cancelled appointment", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  service.cancelAppointment("APT-001", "PAT-001");

  assert.throws(
    () => service.cancelAppointment("APT-001", "PAT-001"),
    /already been cancelled/
  );
});

//Reject rescheduling to an occupied slot
it("rejects rescheduling to an occupied slot", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  assert.throws(
    () => service.rescheduleAppointment(
      "APT-003",
      "2026-11-05",
      "11:00",
      "PAT-003"
    ),
    /unavailable/
  );
});

it("rejects cancellation by a different patient", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  assert.throws(
    () => service.cancelAppointment("APT-001", "PAT-004"),
    /not authorised/
  );

  const appointment = repository.getById("APT-001");

  assert.equal(appointment?.status, "scheduled");
});

it("rejects rescheduling by a different patient", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  assert.throws(
    () => service.rescheduleAppointment(
      "APT-001",
      "2026-11-09",
      "13:00",
      "PAT-004"
    ),
    /not authorised/
  );

  const appointment = repository.getById("APT-001");

  assert.equal(appointment?.date, "2026-11-05");
  assert.equal(appointment?.time, "10:30");
  assert.equal(appointment?.status, "scheduled");
});

it("allows rescheduling an appointment to its existing date and time", () => {
  const repository = createTestRepository();
  const service = new AppointmentService(repository, testClock);

  const appointment = service.rescheduleAppointment(
    "APT-001",
    "2026-11-05",
    "10:30",
    "PAT-001"
  );

  assert.equal(appointment.date, "2026-11-05");
  assert.equal(appointment.time, "10:30");
  assert.equal(appointment.status, "scheduled");
});

  it("marks past appointment times today as unavailable", () => {
    setTestTime("2026-11-02T11:00:00");

    try {
      const repository = createTestRepository();
      const service = new AppointmentService(repository, testClock);

      const slots = service.getAvailableSlots(
        "follow_up",
        "2026-11-02"
      );

      const pastSlot = slots.find(
        (slot) => slot.time === "09:00"
      );

      assert.equal(pastSlot?.available, false);
    } finally {
      testClock = defaultTestClock;
    }
  });

  it("keeps future appointment times today available", () => {
    setTestTime("2026-11-02T11:00:00");

    try {
      const repository = createTestRepository();
      const service = new AppointmentService(repository, testClock);

      const slots = service.getAvailableSlots(
        "follow_up",
        "2026-11-02"
      );

      const futureSlot = slots.find(
        (slot) => slot.time === "13:00"
      );

      assert.equal(futureSlot?.available, true);
    } finally {
      testClock = defaultTestClock;
    }
  });

  it("keeps morning slots available on a future date", () => {
    setTestTime("2026-11-02T11:00:00");

    try {
      const repository = createTestRepository();
      const service = new AppointmentService(repository, testClock);

      const slots = service.getAvailableSlots(
        "follow_up",
        "2026-11-09"
      );

      const morningSlot = slots.find(
        (slot) => slot.time === "09:00"
      );

      assert.equal(morningSlot?.available, true);
    } finally {
      testClock = defaultTestClock;
    }
  });

});