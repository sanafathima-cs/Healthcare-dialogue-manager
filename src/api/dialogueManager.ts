
import type {DialogueState } from "../rule_based/types.js";

export interface DialogueManager {
  processMessage(message: string): Promise<string>;

  processConfirmation(message: string): string;

  isAwaitingConfirmation(): boolean;

  getDialogueState(): DialogueState;
}
