
import { AppointmentRepository } from "../src/appointment/appointmentRepository.js";
import { AppointmentService } from "../src/appointment/appointmentService.js";

import { DialogueController } from "../src/rule_based/dialogueController.js";
import { LLMDialogueController } from "../src/llm_based/llmDialogueController.js";

import type { DialogueManager } from "../src/api/dialogueManager.js";

import { createFixedClock } from "../src/shared/clock.js";

import { mkdir, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REFERENCE_TIME = "2026-11-02T08:00:00";

type ScenarioStep =
  | { type: "message"; content: string }
  | { type: "confirmation"; content: string };

interface Scenario {
  id: string;
  name: string;
  patientId: string;
  steps: ScenarioStep[];
}

const scenarios: Scenario[] = [
  {
    id: "SC-001",
    name: "Normal appointment booking",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "I want to book a general consultation on 2026-11-03 at 10:00.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-002",
    name: "Missing information",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content: "I want to book an appointment.",
      },
    ],
  },
  {
    id: "SC-003",
    name: "Out-of-order information",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content: "I need an appointment on 2026-11-04.",
      },
      {
        type: "message",
        content: "Make it at 13:00.",
      },
      {
        type: "message",
        content: "I want a general consultation.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-004",
    name: "Multiple details in one message",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "Book a general consultation for 2026-11-04 at 09:30.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-005",
    name: "Correcting appointment time",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "Book a general consultation on 2026-11-04 at 10:00.",
      },
      {
        type: "message",
        content: "Actually, change the time to 11:30.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-006",
    name: "Ambiguous time preference",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "I want a general consultation on 2026-11-04, but I am not sure whether I prefer 10:00 or 11:00.",
      },
    ],
  },
  {
    id: "SC-007",
    name: "Switching from booking to cancellation",
    patientId: "PAT-001",
    steps: [
      {
        type: "message",
        content:
          "I want to book a general consultation on 2026-11-04 at 13:00.",
      },
      {
        type: "message",
        content: "Actually, I want to cancel my existing appointment APT-001 instead.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-008",
    name: "Unavailable appointment slot",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "Book a general consultation on 2026-11-05 at 10:30.",
      },
    ],
  },
  {
    id: "SC-009",
    name: "Unrelated topic interruption",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content: "I want to book an appointment on 2026-11-04.",
      },
      {
        type: "message",
        content: "By the way, can you tell me what your opening hours are?",
      },
      {
        type: "message",
        content: "I want a general consultation at 13:00.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-010",
    name: "Rejecting appointment confirmation",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "Book a general consultation on 2026-11-04 at 14:00.",
      },
      { type: "confirmation", content: "no" },
    ],
  },
  {
    id: "SC-011",
    name: "Rescheduling an existing appointment",
    patientId: "PAT-001",
    steps: [
      {
        type: "message",
        content:
          "Please reschedule my appointment APT-001 to 2026-11-06 at 13:00.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
  {
    id: "SC-012",
    name: "Contradictory information and correction",
    patientId: "PAT-004",
    steps: [
      {
        type: "message",
        content:
          "I want a general consultation on 2026-11-04 at 10:00. Actually, make that 2026-11-05 at 09:30.",
      },
      { type: "confirmation", content: "yes" },
    ],
  },
];


const experimentBaseline = [
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

function createManager(
  managerName: "Rule-based" | "LLM-based",
  patientId: string,
  scenarioId: string,
) {
  const clock = createFixedClock(REFERENCE_TIME);

  const experimentDirectory = path.resolve(
    "results",
    "experiment-data",
  );

  mkdirSync(experimentDirectory, { recursive: true });

  const safeManagerName = managerName.toLowerCase().replace("-", "_");

  const experimentFile = path.join(
    experimentDirectory,
    `${scenarioId}-${safeManagerName}.json`,
  );

  writeFileSync(
    experimentFile,
    JSON.stringify(experimentBaseline, null, 2),
    "utf-8",
  );

  const repository = new AppointmentRepository(experimentFile);
  const service = new AppointmentService(repository, clock);

  const manager: DialogueManager =
    managerName === "Rule-based"
      ? new DialogueController(service, patientId, clock)
      : new LLMDialogueController(service, patientId, clock);

  return { manager, repository };
}


async function runManager(
  managerName: "Rule-based" | "LLM-based",
  scenario: Scenario,
) {
  // Each scenario and manager gets an independent repository.
  const { manager, repository } = createManager(
    managerName,
    scenario.patientId,
    scenario.id,
  );

  const turns = [];

  for (const step of scenario.steps) {
    let response: string;

    const start = Date.now();

    if (step.type === "message") {
      response = await manager.processMessage(step.content);
    } else {
      if (!manager.isAwaitingConfirmation()) {
        turns.push({
          stepType: step.type,
          patientMessage: step.content,
          systemResponse: null,
          latencyMs: 0,
          dialogueState: manager.getDialogueState(),
          awaitingConfirmation: false,
          error: "Manager was not awaiting confirmation.",
        });

        break;
      }

      response = manager.processConfirmation(step.content);
    }

    const latencyMs = Date.now() - start;

    turns.push({
      stepType: step.type,
      patientMessage: step.content,
      systemResponse: response,
      latencyMs,
      dialogueState: manager.getDialogueState(),
      awaitingConfirmation: manager.isAwaitingConfirmation(),
    });
  }

  return {
    manager: managerName,
    scenarioId: scenario.id,
    scenario: scenario.name,
    turns,
    finalDialogueState: manager.getDialogueState(),
    appointmentsAfterRun: repository.getAll(),
  };
}

export async function runExperiment() {
  const allResults = [];

  for (const scenario of scenarios) {
    console.log(`\nRunning ${scenario.id}: ${scenario.name}`);

    const ruleResult = await runManager("Rule-based", scenario);
    const llmResult = await runManager("LLM-based", scenario);

    allResults.push(ruleResult, llmResult);
  }

  const experimentData = {
    referenceTime: REFERENCE_TIME,
    scenarios,
    results: allResults,
  };

  const resultsDirectory = path.resolve("results");

  await mkdir(resultsDirectory, { recursive: true });

  const outputPath = path.join(
    resultsDirectory,
    "experiment-results.json",
  );

  await writeFile(
    outputPath,
    JSON.stringify(experimentData, null, 2),
    "utf-8",
  );

  console.log(`\nExperiment results saved to: ${outputPath}`);

  return experimentData;
}

// Run automatically only when this file is executed directly.
const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  runExperiment().catch((error) => {
    console.error("Experiment failed:", error);
    process.exitCode = 1;
  });
}