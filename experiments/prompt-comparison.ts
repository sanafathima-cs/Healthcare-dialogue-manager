import {
  extractWithPrompt,
  type PromptVariant,
  type LLMExtraction,
} from "../src/llm_based/llmDialogueManager.js";

import type { DialogueState } from "../src/rule_based/types.js";

import { createFixedClock } from "../src/shared/clock.js";

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { groundTruth } from "./prompt-ground-truth.js";

const REFERENCE_TIME = "2026-11-02T08:00:00";

interface PromptTestCase {
  id: string;
  description: string;
  message: string;
  currentState: DialogueState;
}

const emptyState: DialogueState = {
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

const testCases: PromptTestCase[] = [
  {
    id: "P-001",
    description: "Normal booking request",
    message: "I want to book a cardiologist appointment tomorrow at 10:30 AM.",
    currentState: { ...emptyState },
  },
  {
    id: "P-002",
    description: "Missing information",
    message: "I want to book an appointment with a cardiologist.",
    currentState: { ...emptyState },
  },
  {
    id: "P-003",
    description: "Out-of-order information",
    message: "Next Friday works for me, preferably in the afternoon. I need a pediatric appointment.",
    currentState: { ...emptyState },
  },
  {
    id: "P-004",
    description: "Multiple details in one message",
    message: "Book a general consultation tomorrow morning because I have a headache.",
    currentState: { ...emptyState },
  },
  {
    id: "P-005",
    description: "Correction of appointment time",
    message: "Actually, I meant 2 PM, not 10 AM.",
    currentState: {
      ...emptyState,
      intent: "book",
      appointmentType: "cardiologist",
      preferredDate: "2026-11-04",
      preferredTime: "specific_time",
      preferredClockTime: "10:00",
    },
  },
  {
    id: "P-006",
    description: "Ambiguous time preference",
    message: "I would prefer sometime around 10 or 11.",
    currentState: {
      ...emptyState,
      intent: "book",
      appointmentType: "general_consultation",
    },
  },
  {
    id: "P-007",
    description: "Cancellation request",
    message: "I want to cancel appointment APT-001.",
    currentState: { ...emptyState },
  },
  {
    id: "P-008",
    description: "Rescheduling request",
    message: "Please reschedule my appointment APT-001 to next Monday at 3 PM.",
    currentState: { ...emptyState },
  },
];

const promptVariants: PromptVariant[] = [
  "baseline",
  "detailed",
  "strict",
];

const clock = createFixedClock(REFERENCE_TIME);

async function runPromptComparison() {
  interface PromptExperimentResult {
  testCaseId: string;
  description: string;
  promptVariant: PromptVariant;
  message: string;
  extractedInformation: LLMExtraction | null;
  latencyMs: number;
  success: boolean;
  error: string | null;
}

const results: PromptExperimentResult[] = [];

  for (const testCase of testCases) {
    for (const promptVariant of promptVariants) {
      console.log(
        `Testing ${testCase.id} with ${promptVariant} prompt...`,
      );

      const startTime = Date.now();

      try {
        const extraction = await extractWithPrompt(
          testCase.message,
          testCase.currentState,
          clock,
          promptVariant,
        );

        results.push({
          testCaseId: testCase.id,
          description: testCase.description,
          promptVariant,
          message: testCase.message,
          extractedInformation: extraction,
          latencyMs: Date.now() - startTime,
          success: true,
          error: null,
        });
      } catch (error) {
        results.push({
          testCaseId: testCase.id,
          description: testCase.description,
          promptVariant,
          message: testCase.message,
          extractedInformation: null,
          latencyMs: Date.now() - startTime,
          success: false,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }
  }
  const fields: (keyof LLMExtraction)[] = [
  "intent",
  "appointmentType",
  "preferredDate",
  "preferredTime",
  "preferredClockTime",
  "reason",
  "existingAppointmentId",
];

const accuracySummary = promptVariants.map((variant) => {
  const variantResults = results.filter(
    (result) =>
      result.promptVariant === variant &&
      result.success &&
      result.extractedInformation !== null,
  );

  let correctFields = 0;
  let totalFields = 0;

  for (const result of variantResults) {
    const expected = groundTruth[result.testCaseId];

    if (!expected || !result.extractedInformation) {
      continue;
    }

    for (const field of fields) {
      totalFields++;

      if (
        result.extractedInformation[field] === expected[field]
      ) {
        correctFields++;
      }
    }
  }

  return {
    promptVariant: variant,
    correctFields,
    totalFields,
    accuracyPercentage:
      totalFields === 0
        ? 0
        : Number(((correctFields / totalFields) * 100).toFixed(2)),
  };
});

console.log("\nPROMPT COMPARISON RESULTS\n");
console.log(JSON.stringify(results, null, 2));

console.log("\nFIELD-LEVEL ACCURACY SUMMARY\n");
console.table(accuracySummary);

  const outputPath = resolve(
  "results/prompt-comparison-results.json",
);

await writeFile(
  outputPath,
  JSON.stringify(
    {
        results,
        accuracySummary,
    },
    null,
    2
  ),
  "utf8",
);

console.log(`\nResults saved to: ${outputPath}`);
}

runPromptComparison().catch(console.error);