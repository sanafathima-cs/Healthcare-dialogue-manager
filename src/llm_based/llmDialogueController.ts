
import type {
  DialogueState,
  UserIntent,
} from "../rule_based/types.js";

import { AppointmentService } from "../appointment/appointmentService.js";

import {
  updateDialogueStateWithLLM,
} from "./llmDialogueManager.js";

import type { DialogueManager } from "../api/dialogueManager.js";

import { systemClock } from "../shared/clock.js";
import type { Clock } from "../shared/clock.js";

type PendingConfirmation = "book" | "cancel" | "reschedule" | null;

const INITIAL_STATE: DialogueState = {
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

export class LLMDialogueController implements DialogueManager {
  private dialogue: DialogueState = { ...INITIAL_STATE };

  private pendingConfirmation: PendingConfirmation = null;

  constructor(
  private appointmentService: AppointmentService,
  private patientId: string = "PAT-004",
  private clock: Clock = systemClock,
  savedState?: {
    dialogue: DialogueState;
    pendingConfirmation: PendingConfirmation;
  },
) {
  if (savedState) {
    this.dialogue = { ...savedState.dialogue };
    this.pendingConfirmation = savedState.pendingConfirmation;
  }
}

  isAwaitingConfirmation(): boolean {
  return this.pendingConfirmation !== null;
}

  /**
   * Process a patient's message using the LLM.
   */
async processMessage(message: string): Promise<string> {
    const cleanedMessage = message.trim();

    if (!cleanedMessage) {
      return "Please enter a message.";
    }

    // Do not interpret acknowledgements as new appointment requests
    // when there is no active appointment operation.
    const neutralMessages = [
        "ok",
        "okay",
        "thanks",
        "thank you",
        "thanks!",
        "thank you!",
    ];
    
    if (
        this.dialogue.intent === null &&
        neutralMessages.includes(cleanedMessage.toLowerCase())
    ) {
        return "There is no active appointment request. Would you like to book, cancel, or reschedule an appointment?";
    }

    // If confirmation is pending, handle yes/no first.
    if (this.pendingConfirmation !== null) {
      const answer = cleanedMessage.toLowerCase();

      if (
        ["yes", "yes please", "confirm", "y"].includes(answer)
      ) {
        return this.processConfirmation("yes");
      }

      if (
        [
          "no",
          "no thanks",
          "don't confirm",
          "do not confirm",
          "nope",
          "n",
        ].includes(answer)
      ) {
        return this.processConfirmation("no");
      }

      // Any other message is treated as a correction
      // or additional information.
      this.pendingConfirmation = null;
      this.dialogue.status = "collecting_information";
      this.dialogue.availability = "not_checked";
    }


    // Handle acknowledgements and farewells when no operation is active.
    if (this.dialogue.intent === null) {
      const normalizedMessage = cleanedMessage.toLowerCase();

      const acknowledgements = [
        "ok",
        "okay",
        "thanks",
        "thank you",
        "thanks!",
        "thank you!",
        "ok thanks",
        "okay thanks",
      ];

      const farewells = [
        "no",
        "no thanks",
        "no, thanks",
        "bye",
        "goodbye",
        "that's all",
        "that is all",
        "nothing else",
      ];

      if (farewells.includes(normalizedMessage)) {
        return "You're welcome! Thank you for using our appointment service. Have a nice day.";
      }

      if (acknowledgements.includes(normalizedMessage)) {
        return "You're welcome! Is there anything else I can help you with?";
      }
    }


    try {
      // Ask Llama 3.2 to extract information.
      this.dialogue = await updateDialogueStateWithLLM(
        cleanedMessage,
        this.dialogue,
        this.clock,
      );

      return this.continueDialogue();
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Sorry, I could not understand your message. Please try again.";
    }
  }

  /**
   * Check which required information is missing.
   */
  private getMissingInformation(): string | null {
    const intent = this.dialogue.intent;

    if (intent === null) {
      return "Would you like to book, cancel, or reschedule an appointment?";
    }

    if (
      intent === "book" &&
      this.dialogue.appointmentType === null
    ) {
      return "What type of appointment would you like?";
    }

    if (
      (intent === "cancel" || intent === "reschedule") &&
      this.dialogue.existingAppointmentId === null
    ) {
      return "Please provide your existing appointment ID.";
    }

    if (
      (intent === "book" || intent === "reschedule") &&
      this.dialogue.preferredDate === null
    ) {
      return "What date would you prefer? Please use YYYY-MM-DD or tell me the date.";
    }

    if (
      (intent === "book" || intent === "reschedule") &&
      this.dialogue.preferredClockTime === null
    ) {
      return "What exact appointment time would you prefer? For example, 10:30.";
    }

    return null;
  }

  /**
   * Continue the conversation based on the detected intent.
   */
  private continueDialogue(): string {
    const missingInformation = this.getMissingInformation();

    if (missingInformation !== null) {
      return missingInformation;
    }

    switch (this.dialogue.intent) {
      case "book":
        return this.checkBookingAvailability();

      case "cancel":
        return this.prepareCancellation();

      case "reschedule":
        return this.checkReschedulingAvailability();

      default:
        return "I could not identify your appointment request. Would you like to book, cancel, or reschedule?";
    }
  }

  /**
   * Check availability for a new booking.
   */
  private checkBookingAvailability(): string {
    const {
      appointmentType,
      preferredDate,
      preferredClockTime,
    } = this.dialogue;

    if (
      appointmentType === null ||
      preferredDate === null ||
      preferredClockTime === null
    ) {
      return "Some appointment information is missing.";
    }

    try {
      const slots = this.appointmentService.getAvailableSlots(
        appointmentType,
        preferredDate,
      );

      const requestedSlot = slots.find(
        (slot) => slot.time === preferredClockTime,
      );

      if (!requestedSlot || !requestedSlot.available) {
        this.dialogue.availability = "unavailable";
        
        const alternatives = 
        this.appointmentService.getSuggestedAvailableSlots(
        appointmentType,
        preferredDate
    );

  if (alternatives.length === 0) {
    return `Sorry, no slots are available on ${preferredDate}. What other date would you prefer?`;
  }

  const suggestedTimes = alternatives
    .map((slot) => slot.time)
    .join(", ");

  return (
    `Sorry, ${preferredClockTime} is unavailable on ${preferredDate}. ` +
    `These times are available: ${suggestedTimes}. ` +
    "Which time would you prefer?"
  );
}

this.dialogue.availability = "available";
this.dialogue.status = "confirming";
this.pendingConfirmation = "book";

return (
    `The ${appointmentType} appointment is available ` +
    `on ${preferredDate} at ${preferredClockTime}. ` +
    "Would you like to confirm the booking?"
);
} catch (error) {
return error instanceof Error
? error.message
: "Could not check appointment availability.";
}
}

  /**
   * Validate an existing appointment before cancellation.
   */
  private prepareCancellation(): string {
    const appointmentId = this.dialogue.existingAppointmentId;

    if (appointmentId === null) {
      return "Please provide your existing appointment ID.";
    }

    const appointment =
      this.appointmentService.getAppointmentById(appointmentId);

    if (!appointment) {
      return "Appointment not found. Please check your appointment ID.";
    }

    if (appointment.patientId !== this.patientId) {
      return "You are not authorised to cancel this appointment.";
    }

    if (appointment.status !== "scheduled") {
      return "Only scheduled appointments can be cancelled.";
    }

    this.dialogue.status = "confirming";
    this.pendingConfirmation = "cancel";

    return (
      `You requested to cancel appointment ${appointmentId}. ` +
      "Are you sure you want to cancel it?"
    );
  }

  /**
   * Check availability for rescheduling.
   */
  private checkReschedulingAvailability(): string {
    const {
      existingAppointmentId,
      preferredDate,
      preferredClockTime,
    } = this.dialogue;

    if (
      existingAppointmentId === null ||
      preferredDate === null ||
      preferredClockTime === null
    ) {
      return "The rescheduling information is incomplete.";
    }

    const existingAppointment =
      this.appointmentService.getAppointmentById(
        existingAppointmentId,
      );

    if (!existingAppointment) {
      return "Appointment not found. Please check your appointment ID.";
    }

    if (existingAppointment.patientId !== this.patientId) {
      return "You are not authorised to reschedule this appointment.";
    }

    if (existingAppointment.status !== "scheduled") {
      return "Only scheduled appointments can be rescheduled.";
    }

    try {
      const slots = this.appointmentService.getAvailableSlots(
        existingAppointment.appointmentType,
        preferredDate,
        existingAppointmentId,
      );

      const requestedSlot = slots.find(
        (slot) => slot.time === preferredClockTime,
      );

      if (!requestedSlot || !requestedSlot.available) {
        this.dialogue.availability = "unavailable";
        
        const alternatives = 
        this.appointmentService.getSuggestedAvailableSlots(
        existingAppointment.appointmentType,
        preferredDate,
        existingAppointmentId
    );

  if (alternatives.length === 0) {
    return `Sorry, no slots are available on ${preferredDate}. What other date would you prefer?`;
  }

  const suggestedTimes = alternatives
    .map((slot) => slot.time)
    .join(", ");

  return (
    `Sorry, ${preferredClockTime} is unavailable on ${preferredDate}. ` +
    `These times are available: ${suggestedTimes}. ` +
    "Which time would you prefer?"
  );
}

this.dialogue.availability = "available";
this.dialogue.status = "confirming";
this.pendingConfirmation = "reschedule";

return (
    `The new slot is available on ${preferredDate} ` +
    `at ${preferredClockTime}. ` +
    `Would you like to confirm rescheduling appointment ${existingAppointmentId}?`
);
} catch (error) {
    return error instanceof Error
    ? error.message
    : "Could not check the new appointment slot.";
    }
  }

  /**
   * Process patient confirmation or rejection.
   */
  processConfirmation(message: string): string {
    const answer = message.trim().toLowerCase();

    if (this.pendingConfirmation === null) {
      return "We are not waiting for appointment confirmation.";
    }

    if (
      !["yes", "yes please", "confirm", "y"].includes(answer) &&
      !["no", "no thanks", "don't confirm", "do not confirm", "nope", "n"].includes(answer)
    ) {
      return "Please answer yes to confirm, or no to reject.";
    }

    if (answer === "no" || answer === "no thanks" ||
        answer === "don't confirm" || answer === "do not confirm" ||
        answer === "nope" || answer === "n") {

      const rejectedAction = this.pendingConfirmation;

      this.pendingConfirmation = null;
      this.dialogue.status = "collecting_information";
      this.dialogue.availability = "not_checked";

      if (rejectedAction === "cancel") {
        this.resetDialogue();

        return "No problem. Your appointment has not been cancelled.";
      }

      return "No problem. What other date or time would you prefer?";
    }

    const action = this.pendingConfirmation;

    try {
      if (action === "cancel") {
        return this.confirmCancellation();
      }

      if (action === "reschedule") {
        return this.confirmRescheduling();
      }

      if (action === "book") {
        return this.confirmBooking();
      }

      return "I could not identify the appointment operation.";
    } catch (error) {
      this.pendingConfirmation = null;
      this.dialogue.status = "collecting_information";

      return error instanceof Error
        ? error.message
        : "The appointment operation could not be completed.";
    }
  }

  /**
   * Confirm a new booking.
   */
  private confirmBooking(): string {
    const {
      appointmentType,
      preferredDate,
      preferredClockTime,
    } = this.dialogue;

    if (
      appointmentType === null ||
      preferredDate === null ||
      preferredClockTime === null
    ) {
      return "The booking information is incomplete.";
    }

    const appointment = this.appointmentService.bookAppointment(
      appointmentType,
      preferredDate,
      preferredClockTime,
      this.patientId,
    );

    this.resetDialogue();

    return (
      "Your appointment is confirmed. " +
      `Appointment ID: ${appointment.id}`
    );
  }

  /**
   * Confirm cancellation.
   */
  private confirmCancellation(): string {
    const appointmentId = this.dialogue.existingAppointmentId;

    if (appointmentId === null) {
      return "The appointment ID is missing.";
    }

    const appointment = this.appointmentService.cancelAppointment(
      appointmentId,
      this.patientId,
    );

    this.resetDialogue();

    return (
      `Appointment ${appointment.id} has been successfully cancelled.`
    );
  }

  /**
   * Confirm rescheduling.
   */
  private confirmRescheduling(): string {
    const {
      existingAppointmentId,
      preferredDate,
      preferredClockTime,
    } = this.dialogue;

    if (
      existingAppointmentId === null ||
      preferredDate === null ||
      preferredClockTime === null
    ) {
      return "The rescheduling information is incomplete.";
    }

    const appointment = this.appointmentService.rescheduleAppointment(
      existingAppointmentId,
      preferredDate,
      preferredClockTime,
      this.patientId,
    );

    this.resetDialogue();

    return (
      `Appointment ${appointment.id} has been successfully rescheduled ` +
      `to ${appointment.date} at ${appointment.time}.`
    );
  }

  /**
   * Reset the conversation after a completed operation.
   */
  private resetDialogue(): void {
    this.dialogue = { ...INITIAL_STATE };
    this.pendingConfirmation = null;
  }

  /**
   * Get the current dialogue state.
   * Useful for debugging and experiments.
   */
  getDialogueState(): DialogueState {
    return { ...this.dialogue };
  }

getPersistedState() {
  return {
    dialogue: { ...this.dialogue },
    pendingConfirmation: this.pendingConfirmation,
  };
}
}