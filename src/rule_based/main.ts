import { createActor } from "xstate";
import { dialogueMachine } from "./dialogueMachine.js";

import {
  checkSimulatedAvailability,
  updateStateFromMessage,
} from "./logic.js";

// Create the dialogue actor.
const dialogueActor = createActor(dialogueMachine);

// Monitor changes to the dialogue state.
dialogueActor.subscribe((snapshot) => {
  console.log("Current state:", snapshot.value);
  console.log("Dialogue context:", snapshot.context.dialogue);
});

// Start the dialogue actor.
dialogueActor.start();

// Process a patient's message.
function processUserMessage(message: string): void {
  // 1. Read the current dialogue state.
  const currentDialogue = dialogueActor.getSnapshot().context.dialogue;

  // 2. Extract information from the patient's message.
  const updatedDialogue = updateStateFromMessage(
    currentDialogue,
    message
  );

  // Update the XState context.
  dialogueActor.send({
    type: "UPDATE_DIALOGUE",
    dialogue: updatedDialogue,
  });

  // Check whether the required information is available.
  dialogueActor.send({
    type: "INFORMATION_COMPLETE",
  });

  // 5. Check availability only if the machine entered that state.
  if (dialogueActor.getSnapshot().value === "checkingAvailability") {
    const currentState = dialogueActor.getSnapshot().context.dialogue;

    const availability = checkSimulatedAvailability(currentState);

    if (availability === "available") {
      dialogueActor.send({ type: "SLOT_AVAILABLE" });
    } else if (availability === "unavailable") {
      dialogueActor.send({ type: "SLOT_UNAVAILABLE" });
    }
  }

  // 6. Display the updated dialogue state.
  console.log("Updated dialogue:");
  console.log(dialogueActor.getSnapshot().context.dialogue);

  console.log("Current machine state:");
  console.log(dialogueActor.getSnapshot().value);
}

// Process the patient's confirmation response.
function processConfirmation(message: string): string {
  const answer = message.trim().toLowerCase();

  // Check whether we are waiting for confirmation.
  if (dialogueActor.getSnapshot().value !== "confirming") {
    return "We are not waiting for appointment confirmation.";
  }

  // Patient accepts the appointment.
  if (["yes", "yes please", "confirm"].includes(answer)) {
    dialogueActor.send({ type: "CONFIRM" });

    return "Your demo appointment has been confirmed.";
  }

  // Patient rejects the proposed slot.
  if (
    ["no", "no thanks", "dont confirm", "don't confirm", "do not confirm"].includes(answer)
  ) {
    dialogueActor.send({ type: "REJECT" });

    return "No problem. What other date and time would you prefer?";
  }

  // Unclear response: remain in the confirming state.
  return "Please answer yes to confirm, or no to choose another time.";
}