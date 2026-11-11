
import { createActor } from "xstate";
import { dialogueMachine, initialDialogue } from "./dialogueMachine.js";
import { updateStateFromMessage,
    getMissingFields,
    getNextQuestion,
 } from "./logic.js";
import { AppointmentService } from "../appointment/appointmentService.js";
import type { DialogueManager } from "../api/dialogueManager.js";
import type { DialogueState } from "./types.js";

import { systemClock } from "../shared/clock.js";
import type { Clock } from "../shared/clock.js";

function isClosingMessage(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .replace(/\s+/g, " ");

  const closingMessages = [
    "no",
    "no thanks",
    "no thank you",
    "nope",
    "not now",
    "nothing else",
    "that's all",
    "that is all",
    "i'm done",
    "im done",
    "goodbye",
    "bye",
  ];

  return closingMessages.includes(normalized);
}

export class DialogueController implements DialogueManager {
  private actor = createActor(dialogueMachine);
  private conversationEnded = false;

  constructor(
  private appointmentService: AppointmentService,
  private patientId: string = "PAT-004",
  private clock: Clock = systemClock,
  savedState?: {
    value: string;
    dialogue: DialogueState;
    conversationEnded: boolean;
  }
) {
  this.actor.start();

  if (savedState) {
    this.actor.stop();

    this.actor = createActor(dialogueMachine, {
      snapshot: dialogueMachine.resolveState({
        value: savedState.value,
        context: {
          dialogue: savedState.dialogue,
        },
      }),
    });

    this.conversationEnded = savedState.conversationEnded;
    this.actor.start();
  }
}

  isAwaitingConfirmation(): boolean {
  const currentState = this.actor.getSnapshot().value;

  return (
    currentState === "confirming" ||
    currentState === "confirmingCancellation"
  );
}

getDialogueState(): DialogueState {
  const dialogue = this.actor.getSnapshot().context.dialogue;

  return { ...dialogue };
}

getPersistedState() {
  const snapshot = this.actor.getSnapshot();

  return {
    value: snapshot.value as string,
    dialogue: { ...snapshot.context.dialogue },
    conversationEnded: this.conversationEnded,
  };
}

async processMessage(message: string): Promise<string> {
    
    // Handle messages after the appointment task is completed.
    const initialSnapshot = this.actor.getSnapshot();


    // Do not continue processing after the conversation has ended.
    if (this.conversationEnded) {
        return "This conversation has ended. Please start a new conversation if you need another appointment.";
    }

    if (initialSnapshot.value === "completed") {
        const normalizedMessage = message.trim().toLowerCase();

        // Handle the patient's refusal to start another appointment.
        if (isClosingMessage(message)) {
            this.conversationEnded = true;

            return "You're welcome! Thank you for using our appointment service. Have a nice day.";
        }
        
        //Respond naturally to acknowledgements
        if (/^(ok|okay|thanks|thank you|thanks a lot|thank you so much|ok thanks|okay thanks|thanks a lot)[.! ]*$/.test(normalizedMessage)) {
            return "You're welcome! Your appointment is confirmed. Is there anything else I can help you with?";
        }

        //Reset the dialogue when the patient starts a new task
        const newDialogue = updateStateFromMessage(
            initialDialogue, 
            message,
            this.clock.now().toISOString().slice(0, 10)
        );

        if (newDialogue.intent === null) {
            return "Your previous appointment task is completed. Would you like to book, cancel, or reschedule another appointment?";
        }
        
        this.actor.send({
            type: "UPDATE_DIALOGUE",
            dialogue: newDialogue,
        });
        
    }
    
    const currentDialogue =
      this.actor.getSnapshot().context.dialogue;


    const updatedDialogue = updateStateFromMessage(
      currentDialogue,
      message,
      this.clock.now().toISOString().slice(0, 10)
    );

    this.actor.send({
      type: "UPDATE_DIALOGUE",
      dialogue: updatedDialogue,
    });

    this.actor.send({
      type: "INFORMATION_COMPLETE",
    });

    const snapshot = this.actor.getSnapshot();


    if (snapshot.value === "confirmingCancellation") {
        const appointmentId = snapshot.context.dialogue.existingAppointmentId;

        if (appointmentId === null) {
            return "Which existing appointment world you like to cancel?";
        }
        
        return `You requested to cancel appointment ${appointmentId}. Are you sure you want to cancel it?`;
    }

    if (snapshot.value === "confirming") {
        const dialogue = snapshot.context.dialogue;

        if (dialogue.intent === "reschedule") {
            return `The ${dialogue.preferredClockTime} slot is available. Would you like to confirm rescheduling appointment ${dialogue.existingAppointmentId}?`;
        }
    }
    
    if (snapshot.value === "checkingAvailability") {
        const dialogue = snapshot.context.dialogue;

        if (
            dialogue.preferredDate === null ||
            dialogue.preferredClockTime === null
        ) {
            return "Please provide an exact appointment time.";
        }
        
        let appointmentType = dialogue.appointmentType;
        
        // For rescheduling, retrieve the existing appointment type.
        if (dialogue.intent === "reschedule") {
            const appointmentId = dialogue.existingAppointmentId;

            if (appointmentId === null) {
                return "Please provide your existing appointment ID.";
            }

            const existingAppointment = this.appointmentService.getAppointmentById(appointmentId);
            
            if (!existingAppointment) {
                return "Appointment not found.";
            }
            
            appointmentType = existingAppointment.appointmentType;
        }
        
        if (appointmentType === null) {
            return "Please provide an appointment type.";
        }
        
        /*const slots = this.appointmentService.getAvailableSlots(
            appointmentType,
            dialogue.preferredDate
        ); */

        let slots;
        
        try { 
            slots = this.appointmentService.getAvailableSlots(
            appointmentType,
            dialogue.preferredDate
        );
    } catch (error) {
        return error instanceof Error
        ? error.message
        : "Could not check appointment availability.";
    }
        
        const requestedSlot = slots.find(
            (slot) => slot.time === dialogue.preferredClockTime
        );
        
        if (requestedSlot?.available) {
            this.actor.send({ type: "SLOT_AVAILABLE" });
            
            if (dialogue.intent === "reschedule") {
                return `The ${dialogue.preferredClockTime} slot is available. Would you like to confirm rescheduling appointment ${dialogue.existingAppointmentId}?`;
            }
            
            return `The ${dialogue.preferredClockTime} slot is available. Would you like to confirm?`;
        }
        
        this.actor.send({ type: "SLOT_UNAVAILABLE" });
        
        // Find alternative available slots for the same date.
        const alternativeSlots =
        this.appointmentService.getSuggestedAvailableSlots(
        appointmentType,
        dialogue.preferredDate,
        dialogue.intent === "reschedule"
            ? dialogue.existingAppointmentId ?? undefined
            : undefined, 4
        );

        if (alternativeSlots.length === 0) {
            return "Sorry, that slot is unavailable, and there are no other available slots on this date. Would you like to choose another date?";
        }

        const suggestedTimes = alternativeSlots
        .map((slot) => slot.time)
        .join(", ");
        
        return `Sorry, ${dialogue.preferredClockTime} is unavailable. The available times on ${dialogue.preferredDate} are: ${suggestedTimes}. Which would you prefer?`;
    }

    const dialogue = snapshot.context.dialogue;
    
    const missingFields = getMissingFields(dialogue);
    
    return getNextQuestion(missingFields, dialogue);
  }


processConfirmation(message: string): string {
  const answer = message.trim().toLowerCase();
  const snapshot = this.actor.getSnapshot();

  if (
    snapshot.value !== "confirming" &&
    snapshot.value !== "confirmingCancellation"
  ) {
    return "We are not waiting for appointment confirmation.";
  }

  if (
    ["yes", "yes please", "yes, please", "confirm", "y"].includes(answer)
) {
    const dialogue = snapshot.context.dialogue;

    
    // Handle cancellation confirmation.
    if (snapshot.value === "confirmingCancellation") {
      const appointmentId = dialogue.existingAppointmentId;

      if (appointmentId === null) {
        return "The appointment ID is missing.";
      }

      try {
        const cancelledAppointment =
          this.appointmentService.cancelAppointment(appointmentId,
            this.patientId
          );

        this.actor.send({ type: "CONFIRM" });

        return `Appointment ${cancelledAppointment.id} has been successfully cancelled.`;
      } catch (error) {
        return error instanceof Error
          ? error.message
          : "Could not cancel the appointment.";
      }
    }

    // Handle rescheduling confirmation.
    if (dialogue.intent === "reschedule") {
        const appointmentId = dialogue.existingAppointmentId;

        if (
            appointmentId === null ||
            dialogue.preferredDate === null ||
            dialogue.preferredClockTime === null
        ) {
            return "The rescheduling information is incomplete.";
        }
        
        try {
            const appointment = this.appointmentService.rescheduleAppointment(
                appointmentId,
                dialogue.preferredDate,
                dialogue.preferredClockTime,
                this.patientId
            );
            
            this.actor.send({ type: "CONFIRM" });

            
            return `Appointment ${appointment.id} has been successfully rescheduled to ${appointment.date} at ${appointment.time}.`;
        } catch (error) {
            return error instanceof Error
            ? error.message
            : "Could not reschedule the appointment.";
        }
    }

    // Handle booking confirmation.
    if (
        dialogue.intent !== "book" ||
        dialogue.appointmentType === null ||
        dialogue.preferredDate === null ||
        dialogue.preferredClockTime === null
    ) {
        return "The appointment information is incomplete.";
    }
    
    try {
        const appointment = this.appointmentService.bookAppointment(
            dialogue.appointmentType,
            dialogue.preferredDate,
            dialogue.preferredClockTime,
            this.patientId
        );
        
        this.actor.send({ type: "CONFIRM" });
        
        return `Your appointment is confirmed. Appointment ID: ${appointment.id}`;
    } catch (error) {
        return error instanceof Error
        ? error.message
        : "Could not book the appointment.";
    }
}

  // Handle rejection.
if (
  [
    "no",
    "no thanks",
    "no, thanks",
    "nope",
    "n",
    "don't confirm",
    "dont confirm",
    "do not confirm",
  ].includes(answer)
) {
    const isCancellation = snapshot.value === "confirmingCancellation";
        
    this.actor.send({ type: "REJECT" });
        
    if (isCancellation) {
        return "No problem. Your appointment has not been cancelled.";
    }
        
    return "No problem. What other date and time would you prefer?";
}
    
return "Please answer yes to confirm, or no to choose another time.";
}
}


