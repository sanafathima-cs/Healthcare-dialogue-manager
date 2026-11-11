
import { AppointmentRepository } from "./appointmentRepository.js";

import type {
  Appointment,
  AppointmentSlot,
} from "./types.js";

import type { AppointmentType } from "../rule_based/types.js";
import { systemClock } from "../shared/clock.js";
import type { Clock } from "../shared/clock.js";

//import { randomUUID } from "node:crypto";

function validateAppointmentDate(date: string, clock: Clock): void {
  // Check YYYY-MM-DD format.
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!datePattern.test(date)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }

  // Parse the date using UTC to avoid timezone shifts.
  const parsedDate = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Invalid calendar date.");
  }

  // Get today's date in the local timezone.
  const today = clock.now();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  if (date < todayString) {
    throw new Error("Cannot book an appointment in the past.");
  }

  // Check weekday using UTC.
  const day = parsedDate.getUTCDay();

  if (day === 0 || day === 6) {
    throw new Error(
      "Appointments are only available Monday to Friday."
    );
  }
}
export class AppointmentService {
  constructor(
    private repository: AppointmentRepository,
    private clock: Clock = systemClock
  ) {}

  // 1. Retrieve available appointment slots.
  getAvailableSlots(
    appointmentType: AppointmentType,
    date: string,
    excludeAppointmentId?: string
  ): AppointmentSlot[] {
    validateAppointmentDate(date, this.clock);

    const possibleTimes = [
      "09:00",
      "09:30",
      "10:00",
      "10:30",
      "11:00",
      "11:30",
      "13:00",
      "13:30",
      "14:00",
      "14:30",
    ];

    const appointments = this.repository.getAll();

    const now = this.clock.now();

  const todayString = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    ].join("-");

    return possibleTimes.map((time) => {
      const occupied = appointments.some(
        (appointment: Appointment) =>
          appointment.date === date &&
          appointment.time === time &&
          appointment.status === "scheduled" &&
          appointment.id !== excludeAppointmentId
      );

      //check whether this time has already passed today
      let timeHasPassed = false;

      if (date === todayString) {
        const [hours = 0, minutes = 0] = time.split(":").map(Number);

        const requestedTime = new Date(now);
        requestedTime.setHours(hours, minutes, 0, 0);

        timeHasPassed = requestedTime <= now;
      }

      /*console.log("PAST-TIME CHECK:", {
        date,
        time,
        todayString,
        currentTIme: now.toLocaleTimeString(),
        timeHasPassed,
        //available: !occupied && !timeHasPassed,
      }); */

      return {
        appointmentType,
        date,
        time,
        available: !occupied && !timeHasPassed,
      };
    });
  }

  getSuggestedAvailableSlots(
    appointmentType: AppointmentType,
    date: string,
    excludeAppointmentId?: string,
    limit: number = 4
  ): AppointmentSlot[] {
    return this.getAvailableSlots(
    appointmentType,
    date,
    excludeAppointmentId
  )
    .filter((slot) => slot.available)
    .slice(0, limit);
  }

  // 2. Create a new appointment.
  bookAppointment(
    appointmentType: AppointmentType,
    date: string,
    time: string,
    patientId: string
  ): Appointment {
    // Validate the requested appointment date.
    validateAppointmentDate(date, this.clock);

    const availableSlots = this.getAvailableSlots(
      appointmentType,
      date
    );

    const requestedSlot = availableSlots.find(
      (slot) => slot.time === time
    );

    if (!requestedSlot || !requestedSlot.available) {
      throw new Error("The requested appointment slot is unavailable.");
    }

    const appointment: Appointment = {
      id: "",
      appointmentType,
      date,
      time,
      patientId,
      status: "scheduled",
    };

    return this.repository.create(appointment);
  }

  // Retrieve an existing appointment by ID.
  getAppointmentById(id: string): Appointment | undefined {
    return this.repository.getById(id);
}

  // 3. Cancel an existing appointment.
  cancelAppointment(
  id: string,
  patientId: string
): Appointment {
  const existing = this.repository.getById(id);

  if (!existing) {
    throw new Error("Appointment not found.");
  }

  if (existing.patientId !== patientId) {
    throw new Error("You are not authorised to cancel this appointment.");
  }

  if (existing.status === "cancelled") {
    throw new Error("This appointment has already been cancelled.");
  }

  const updated = this.repository.update(id, {
    status: "cancelled",
  });

  if (!updated) {
    throw new Error("Could not cancel the appointment.");
  }

  return updated;
}

  // 4. Reschedule an existing appointment.
  
rescheduleAppointment(
  id: string,
  newDate: string,
  newTime: string,
  patientId: string
): Appointment {
  validateAppointmentDate(newDate, this.clock);

  const existing = this.repository.getById(id);

  if (!existing) {
    throw new Error("Appointment not found.");
  }

  if (existing.patientId !== patientId) {
    throw new Error("You are not authorised to reschedule this appointment.");
  }

  if (existing.status !== "scheduled") {
    throw new Error("Only scheduled appointments can be rescheduled.");
  }

  const availableSlots = this.getAvailableSlots(
    existing.appointmentType,
    newDate,
    existing.id
  );

  const requestedSlot = availableSlots.find(
    (slot) => slot.time === newTime
  );

  if (!requestedSlot || !requestedSlot.available) {
    throw new Error("The requested new slot is unavailable.");
  }

  const updated = this.repository.update(id, {
    date: newDate,
    time: newTime,
  });

  if (!updated) {
    throw new Error("Could not reschedule the appointment.");
  }

  return updated;
}
}