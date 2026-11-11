import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { AppointmentRepository } from "./appointment/appointmentRepository.js";
import { AppointmentService } from "./appointment/appointmentService.js";

import { DialogueController } from "./rule_based/dialogueController.js";
import { LLMDialogueController } from "./llm_based/llmDialogueController.js";

import type { DialogueManager } from "./api/dialogueManager.js";

async function runChat(
  manager: DialogueManager,
  managerName: string,
  isRuleBased: boolean
): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  console.log(`\n${managerName} Dialogue Manager`);
  console.log("----------------------------------------");
  console.log("You can now chat with the healthcare assistant.");
  console.log("Type 'exit' or 'quit' to end the conversation.");
  console.log("----------------------------------------\n");

  try {
    while (true) {
      const message = await rl.question("Patient: ");

      if (message.trim().toLowerCase() === "exit" ||
          message.trim().toLowerCase() === "quit") {
        console.log("\nConversation ended.");
        break;
      }

      if (!message.trim()) {
        continue;
      }

      try {
        let response: string;

        // The rule-based controller handles confirmation separately.
        if (isRuleBased && manager.isAwaitingConfirmation()) {
          response = manager.processConfirmation(message);
        } else {
          // The LLM controller handles confirmation inside processMessage.
          response = await manager.processMessage(message);
        }

        console.log(`\nAssistant: ${response}\n`);
        const normalizedMessage = message.trim().toLowerCase();
        if (
          ["no thanks", "no thank you", "goodbye", "bye", "exit", "quit", "that's all", "that is all"].includes(normalizedMessage)
        ) {
          break;
        }
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : error
        );
      }
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  console.log("\n========================================");
  console.log("   HEALTHCARE DIALOGUE MANAGER");
  console.log("========================================");
  console.log("1. Rule-based Dialogue Manager");
  console.log("2. LLM-assisted Dialogue Manager");
  console.log("3. Exit");

  try {
    const choice = await rl.question("\nChoose an option (1-3): ");

    if (choice.trim() === "3") {
      console.log("Exiting.");
      return;
    }

    if (choice.trim() !== "1" && choice.trim() !== "2") {
      console.log("Invalid choice. Please select 1, 2 or 3.");
      return;
    }

    const repository = new AppointmentRepository();
    const appointmentService = new AppointmentService(repository);

    let manager: DialogueManager;
    let managerName: string;
    let isRuleBased: boolean;

    if (choice.trim() === "1") {
      manager = new DialogueController(appointmentService);
      managerName = "Rule-based";
      isRuleBased = true;
    } else {
      manager = new LLMDialogueController(appointmentService);
      managerName = "LLM-assisted";
      isRuleBased = false;
    }

    rl.close();

    await runChat(manager, managerName, isRuleBased);
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to start terminal dialogue:", error);
  process.exitCode = 1;
});
