
import type { AppointmentType } from "../rule_based/types.js";

export type AppointmentStatus =
  | "scheduled"
  | "cancelled";

export interface Appointment {
  id: string;
  appointmentType: AppointmentType;
  date: string;
  time: string;
  patientId: string;
  status: AppointmentStatus;
}

export interface AppointmentSlot {
  appointmentType: AppointmentType;
  date: string;
  time: string;
  available: boolean;
}
