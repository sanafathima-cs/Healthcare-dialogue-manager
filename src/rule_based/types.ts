export type UserIntent = "book" | "reschedule" | "cancel";

export type AppointmentType = 
| "general_consultation" | "pediatric" | "cardiologist"
| "follow_up"
| "nurse_appointment";


export type TimePreference = 
| "morning"
| "afternoon"
| "evening"
| "specific_time";

export type ConversationStatus = 
| "collecting_information"
| "confirming"
| "completed";

export type AvailabilityOutcome =
| "not_checked"
| "available"
| "unavailable";

export interface DialogueState {
    intent: UserIntent | null;
    appointmentType: AppointmentType | null;
    preferredDate: string | null;
    preferredTime: TimePreference | null;
    preferredClockTime: string | null;
    reason: string | null;
    status: ConversationStatus;
    availability: AvailabilityOutcome;
    existingAppointmentId: string | null;
}