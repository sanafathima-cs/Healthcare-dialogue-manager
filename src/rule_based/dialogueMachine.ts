
import { assign, setup } from "xstate";
import type { DialogueState } from "./types.js";

interface DialogueContext {
  dialogue: DialogueState;
}

type DialogueEvent =
  | { type: "UPDATE_DIALOGUE"; dialogue: DialogueState }
  | { type: "INFORMATION_COMPLETE" }
  | { type: "SLOT_AVAILABLE" }
  | { type: "SLOT_UNAVAILABLE" }
  | { type: "CONFIRM" }
  | { type: "REJECT" };

export const initialDialogue: DialogueState = {
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

function hasRequiredInformation(dialogue: DialogueState): boolean {
  if (dialogue.intent === null) {
    return false;
  }

  switch (dialogue.intent) {
    case "book":
      return (
        dialogue.appointmentType !== null &&
        dialogue.preferredDate !== null &&
        dialogue.preferredTime !== null &&
        (
          dialogue.preferredTime !== "specific_time" ||
          dialogue.preferredClockTime !== null
        )
      );

    case "cancel":
      return dialogue.existingAppointmentId !== null;

    case "reschedule":
      return (
        dialogue.existingAppointmentId !== null &&
        dialogue.preferredDate !== null &&
        dialogue.preferredTime !== null &&
        (
          dialogue.preferredTime !== "specific_time" ||
          dialogue.preferredClockTime !== null
        )
      );
  }
}

export const dialogueMachine = setup({
  types: {} as {
    context: DialogueContext;
    events: DialogueEvent;
  },

  guards: {
    hasRequiredInformation: ({ context }) =>
      hasRequiredInformation(context.dialogue),

    isCancellation: ({ context }) =>
      context.dialogue.intent === "cancel",
  },
}).createMachine({
  id: "healthcareDialogue",
  initial: "collectingInformation",

  context: {
    dialogue: initialDialogue,
  },

  states: {
    collectingInformation: {
      entry: assign({
        dialogue: ({ context }) => ({
          ...context.dialogue,
          status: "collecting_information",
        }),
      }),

      on: {
        UPDATE_DIALOGUE: {
          actions: assign({
            dialogue: ({ event }) => event.dialogue,
          }),
        },

        INFORMATION_COMPLETE: [
          {
            guard: ({ context }) =>
              hasRequiredInformation(context.dialogue) &&
              context.dialogue.intent === "cancel",
            target: "confirmingCancellation",
          },
          {
            guard: "hasRequiredInformation",
            target: "checkingAvailability",
          },
        ],
      },
    },

    checkingAvailability: {
      on: {
        UPDATE_DIALOGUE: {
          target: "collectingInformation",
          actions: assign({
          dialogue: ({ event }) => event.dialogue,
        }),
      },

        SLOT_AVAILABLE: {
          target: "confirming",
          actions: assign({
            dialogue: ({ context }) => ({
              ...context.dialogue,
              availability: "available",
            }),
          }),
        },

        SLOT_UNAVAILABLE: {
          target: "collectingInformation",
          actions: assign({
            dialogue: ({ context }) => ({
              ...context.dialogue,
              availability: "unavailable",
              status: "collecting_information",
            }),
          }),
        },
      },
    },

    confirming: {
      entry: assign({
        dialogue: ({ context }) => ({
          ...context.dialogue,
          status: "confirming",
        }),
      }),

      on: {
        UPDATE_DIALOGUE: {
          target: "collectingInformation",
          actions: assign({
            dialogue: ({ event }) => event.dialogue,
          }),
        },
        CONFIRM: {
          target: "completed",
        },

        REJECT: {
          target: "collectingInformation",
          actions: assign({
            dialogue: ({ context }) => ({
              ...context.dialogue,
              availability: "not_checked",
              preferredDate: null,
              preferredTime: null,
              preferredClockTime: null,
              status: "collecting_information",
            }),
          }),
        },
      },
    },

    confirmingCancellation: {
      entry: assign({
        dialogue: ({ context }) => ({
          ...context.dialogue,
          status: "confirming",
        }),
      }),

      on: {
        CONFIRM: {
          target: "completed",
        },

        REJECT: {
          target: "collectingInformation",
        },
      },
    },

    completed: {
      entry: assign({
        dialogue: ({ context }) => ({
          ...context.dialogue,
          status: "completed",
        }),
      }),

      on: {
        UPDATE_DIALOGUE: {
          target: "collectingInformation",
          actions: assign({
            dialogue: ({ event }) => event.dialogue,
          }),
        },
      },
    },
  },
});
