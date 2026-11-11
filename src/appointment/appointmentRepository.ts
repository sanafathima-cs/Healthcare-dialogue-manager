
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Appointment } from "./types.js";

export class AppointmentRepository {
  private appointments: Appointment[];
  private nextAppointmentNumber = 1001;
  private readonly filePath: string;

  constructor(filePath = resolve(process.cwd(), "data/appointments.json")) {
    this.filePath = filePath;

    // Ensure the directory exists.
    mkdirSync(dirname(this.filePath), { recursive: true });

    // Load appointments from JSON when the repository starts.
    this.appointments = this.loadAppointments();

    // Continue generating IDs after the highest existing appointment ID.
    this.updateNextAppointmentNumber();
  }

  private loadAppointments(): Appointment[] {
    try {
      const data = readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(data);

      if (!Array.isArray(parsed)) {
        throw new Error("Appointment JSON must contain an array.");
      }

      return parsed as Appointment[];
    } catch (error) {
      // Do not silently overwrite an existing but invalid file.
      if (
        error instanceof Error &&
        "code" in error &&
        error.code !== "ENOENT"
      ) {
        throw error;
      }

      // Create the initial file if it does not exist.
      const initialAppointments: Appointment[] = [
        {
          id: "APT-001",
          appointmentType: "cardiologist",
          date: "2026-11-05",
          time: "10:30",
          patientId: "PAT-001",
          status: "scheduled",
        },
        {
          id: "APT-002",
          appointmentType: "general_consultation",
          date: "2026-11-05",
          time: "11:00",
          patientId: "PAT-002",
          status: "scheduled",
        },
        {
          id: "APT-003",
          appointmentType: "pediatric",
          date: "2026-11-06",
          time: "09:00",
          patientId: "PAT-003",
          status: "scheduled",
        },
      ];

      this.appointments = initialAppointments;
      this.saveAppointments();

      return initialAppointments;
    }
  }

  private saveAppointments(): void {
    writeFileSync(
      this.filePath,
      JSON.stringify(this.appointments, null, 2),
      "utf-8"
    );
  }

  private updateNextAppointmentNumber(): void {
    const highestNumber = this.appointments.reduce((highest, appointment) => {
      const match = appointment.id.match(/^APT-(\d+)$/);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 1000);

    this.nextAppointmentNumber = highestNumber + 1;
  }

  private generateAppointmentId(): string {
    const id = `APT-${this.nextAppointmentNumber}`;
    this.nextAppointmentNumber++;
    return id;
  }

  getAll(): Appointment[] {
    return this.appointments.map((appointment) => ({ ...appointment }));
  }

  getById(id: string): Appointment | undefined {
    const appointment = this.appointments.find((item) => item.id === id);
    return appointment ? { ...appointment } : undefined;
  }

  create(appointment: Appointment): Appointment {
    const newAppointment: Appointment = {
      ...appointment,
      id: this.generateAppointmentId(),
    };

    this.appointments.push(newAppointment);
    this.saveAppointments();

    return { ...newAppointment };
  }

  update(
    id: string,
    changes: Partial<Appointment>
  ): Appointment | undefined {
    const index = this.appointments.findIndex((item) => item.id === id);

    if (index === -1) {
      return undefined;
    }

    const updatedAppointment: Appointment = {
      ...this.appointments[index]!,
      ...changes,
      id,
    };

    this.appointments[index] = updatedAppointment;
    this.saveAppointments();

    return { ...updatedAppointment };
  }
}
