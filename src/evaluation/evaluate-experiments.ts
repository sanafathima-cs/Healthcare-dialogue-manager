import fs from "node:fs";
import path from "node:path";

// Define the structure of one experiment result
interface ExperimentResult {
  manager: string;
  scenarioId: string;
  scenario: string;
  turns: {
    stepType: string;
    patientMessage: string;
    systemResponse: string | null;
    latencyMs: number;
    dialogueState: {
      intent: string | null;
      appointmentType: string | null;
      preferredDate: string | null;
      preferredTime: string | null;
      preferredClockTime: string | null;
      status: string;
      availability: string;
      existingAppointmentId: string | null;
    };
    awaitingConfirmation: boolean;
  }[];
  finalDialogueState: {
    status: string;
  };
  appointmentsAfterRun: {
    id: string;
    appointmentType: string;
    date: string;
    time: string;
    patientId: string;
    status: string;
  }[];
}

interface GroundTruthScenario {
  scenarioId: string;
  scenarioName: string;
  expected: Record<string, unknown>;
}

// Define the structure of the complete experiment output
interface ExperimentData {
  referenceTime: string;
  scenarios: unknown[];
  results: ExperimentResult[];
}

// Load the experiment results
const inputPath = path.resolve("results/experiment-results.json");

const rawData = fs.readFileSync(inputPath, "utf-8");

const experimentData: ExperimentData = JSON.parse(rawData);

// Load expected outcomes for each scenario
const groundTruthPath = path.resolve("data/ground-truth.json");

const groundTruthRaw = fs.readFileSync(groundTruthPath, "utf-8");

const groundTruth: GroundTruthScenario[] = JSON.parse(groundTruthRaw);

// Load expected dialogue states for each patient message.
interface ExpectedDialogueState {
  messageNumber: number;
  intent?: string | null;
  appointmentType?: string | null;
  preferredDate?: string | null;
  preferredClockTime?: string | null;
  availability?: string | null;
  existingAppointmentId?: string | null;
}

interface ExpectedDialogueStateScenario {
  scenarioId: string;
  expectedStates: ExpectedDialogueState[];
}

const expectedStatesPath = path.resolve(
  "data/expected-dialogue-states.json"
);

const expectedStatesRaw = fs.readFileSync(
  expectedStatesPath,
  "utf-8"
);

const expectedDialogueStates: {
  scenarios: ExpectedDialogueStateScenario[];
} = JSON.parse(expectedStatesRaw);

console.log("Expected dialogue states loaded successfully.");
console.log("Scenarios:", expectedDialogueStates.scenarios.length);

console.log("Ground truth loaded successfully.");
console.log("Expected scenarios:", groundTruth.length);

console.log("Experiment results loaded successfully.");
console.log("Total scenarios:", experimentData.scenarios.length);
console.log("Total experiment runs:", experimentData.results.length);


// Find the expected outcome for each experiment result
function getExpectedOutcome(scenarioId: string) {
  return groundTruth.find(
    (scenario) => scenario.scenarioId === scenarioId
  );
}

// Check that every experiment has a matching ground-truth entry
for (const result of experimentData.results) {
  const expected = getExpectedOutcome(result.scenarioId);

  if (!expected) {
    console.error(
      `Missing ground truth for ${result.scenarioId}`
    );
  }
}

console.log("\nGround-truth matching check completed.");

// Group experiment results by dialogue manager
const managers = ["Rule-based", "LLM-based"];

for (const manager of managers) {
  const managerResults = experimentData.results.filter(
    (result) => result.manager === manager
  );

  console.log(`\n${manager}`);
  console.log("-------------------------");
  console.log("Scenarios tested:", managerResults.length);
}


interface ScenarioEvaluation {
  taskSuccess: boolean;
  reason: string;
  interruptionAcknowledged?: boolean;
}

function evaluateScenario(
  result: ExperimentResult
): ScenarioEvaluation {
  const appointments = result.appointmentsAfterRun;
  const responses = result.turns
    .map((turn) => turn.systemResponse ?? "")
    .join(" ")
    .toLowerCase();

  // Find a newly created appointment with the expected details.
  function hasNewAppointment(
    appointmentType: string,
    patientId: string,
    date: string,
    time: string
  ): boolean {
    return appointments.some(
      (appointment) =>
        appointment.id.startsWith("APT-") &&
        appointment.id !== "APT-001" &&
        appointment.id !== "APT-002" &&
        appointment.id !== "APT-003" &&
        appointment.appointmentType === appointmentType &&
        appointment.patientId === patientId &&
        appointment.date === date &&
        appointment.time === time &&
        appointment.status === "scheduled"
    );
  }

  // Check whether a new appointment was created for a patient.
  function hasNewAppointmentFor(patientId: string): boolean {
    return appointments.some(
      (appointment) =>
        appointment.id !== "APT-001" &&
        appointment.id !== "APT-002" &&
        appointment.id !== "APT-003" &&
        appointment.patientId === patientId
    );
  }

  switch (result.scenarioId) {
    case "SC-001":
      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-03",
          "10:00"
        ),
        reason: "Correct appointment booking",
      };

    case "SC-002":
      return {
        taskSuccess:
          !hasNewAppointmentFor("PAT-004") &&
          responses.includes("what type of appointment"),
        reason: "Checks whether missing information was requested",
      };

    case "SC-003":
      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-04",
          "13:00"
        ),
        reason: "Correct booking after receiving information out of order",
      };

    case "SC-004":
      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-04",
          "09:30"
        ),
        reason: "Correct booking from multiple details in one message",
      };

    case "SC-005":
      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-04",
          "11:30"
        ),
        reason: "Checks whether the corrected appointment time was applied",
      };

    case "SC-006": {
      const asksToChooseTime =
        responses.includes("10:00") &&
        responses.includes("11:00") &&
        (
          responses.includes("which") ||
          responses.includes("choose") ||
          responses.includes("prefer")
        );

      return {
        taskSuccess:
          !hasNewAppointmentFor("PAT-004") &&
          asksToChooseTime,
        reason: "Checks whether the manager asks the user to resolve the ambiguous time",
      };
    }

    case "SC-007": {
      const cancelledAppointment = appointments.find(
        (appointment) => appointment.id === "APT-001"
      );

      return {
        taskSuccess:
          cancelledAppointment?.status === "cancelled" &&
          !hasNewAppointmentFor("PAT-001"),
        reason: "Checks whether the existing appointment was cancelled without creating another",
      };
    }

    case "SC-008": {
      const alternatives = ["09:00", "09:30", "10:00", "11:30"];

      const suggestedAllAlternatives = alternatives.every(
        (time) => responses.includes(time)
      );

      const unavailable = result.turns.some(
        (turn) =>
          turn.dialogueState.availability === "unavailable"
      );

      return {
        taskSuccess:
          !hasNewAppointmentFor("PAT-004") &&
          unavailable &&
          suggestedAllAlternatives,
        reason: "Checks whether the unavailable slot was rejected and alternatives were suggested",
      };
    }

    case "SC-009": {
      const interruptionTurn = result.turns.find(
        (turn) =>
          turn.patientMessage.toLowerCase().includes("opening hours")
      );

      const interruptionResponse =
        interruptionTurn?.systemResponse?.toLowerCase() ?? "";

      const acknowledged =
        interruptionResponse.includes("opening") ||
        interruptionResponse.includes("hours");

      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-04",
          "13:00"
        ),
        reason: "Checks whether the booking context was preserved and the appointment was completed",
        interruptionAcknowledged: acknowledged,
      };
    }

    case "SC-010":
      return {
        taskSuccess: !hasNewAppointmentFor("PAT-004"),
        reason: "Checks whether the manager respected the user's rejection",
      };

    case "SC-011": {
      const rescheduledAppointment = appointments.find(
        (appointment) => appointment.id === "APT-001"
      );

      return {
        taskSuccess:
          rescheduledAppointment?.date === "2026-11-06" &&
          rescheduledAppointment?.time === "13:00" &&
          rescheduledAppointment?.status === "scheduled",
        reason: "Checks whether the existing appointment was rescheduled correctly",
      };
    }

    case "SC-012":
      return {
        taskSuccess: hasNewAppointment(
          "general_consultation",
          "PAT-004",
          "2026-11-05",
          "09:30"
        ),
        reason: "Checks whether the latest correction was applied",
      };

    default:
      return {
        taskSuccess: false,
        reason: "No evaluation rule exists for this scenario",
      };
  }
}

// Evaluate every scenario for both managers.
console.log("\n========== TASK SUCCESS EVALUATION ==========");

for (const manager of managers) {
  const managerResults = experimentData.results.filter(
    (result) => result.manager === manager
  );

  let successfulTasks = 0;

  console.log(`\n${manager}`);
  console.log("---------------------------------------------");

  for (const result of managerResults) {
    const evaluation = evaluateScenario(result);

    if (evaluation.taskSuccess) {
      successfulTasks++;
    }

    console.log(
      `${result.scenarioId}: ${
        evaluation.taskSuccess ? "PASS" : "FAIL"
      }`
    );

    console.log(`Reason: ${evaluation.reason}`);

    if (evaluation.interruptionAcknowledged !== undefined) {
      console.log(
        `Unrelated question acknowledged: ${
          evaluation.interruptionAcknowledged ? "YES" : "NO"
        }`
      );
    }
  }

  const successRate =
    (successfulTasks / managerResults.length) * 100;

  console.log("---------------------------------------------");
  console.log(
    `Successful tasks: ${successfulTasks}/${managerResults.length}`
  );
  console.log(`Task success rate: ${successRate.toFixed(2)}%`);
}


// Calculate the median of a list of numbers.
function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
  const left = sorted[middle - 1];
  const right = sorted[middle];

  if (left === undefined || right === undefined) {
    return 0;
  }

  return (left + right) / 2;
}

  return sorted[middle] ?? 0;
}

// Evaluate response latency for both managers.
console.log("\n========== RESPONSE LATENCY EVALUATION ==========");

for (const manager of managers) {
  const managerResults = experimentData.results.filter(
    (result) => result.manager === manager
  );

  // Include only ordinary patient-message turns.
  const messageLatencies = managerResults.flatMap((result) =>
    result.turns
      .filter((turn) => turn.stepType === "message")
      .map((turn) => turn.latencyMs)
      .filter((latency) => Number.isFinite(latency))
  );

  const averageLatency =
    messageLatencies.length > 0
      ? messageLatencies.reduce((sum, latency) => sum + latency, 0) /
        messageLatencies.length
      : 0;

  const medianLatency = calculateMedian(messageLatencies);

  console.log(`\n${manager}`);
  console.log("---------------------------------------------");
  console.log("Messages measured:", messageLatencies.length);
  console.log(`Average latency: ${averageLatency.toFixed(2)} ms`);
  console.log(`Median latency: ${medianLatency.toFixed(2)} ms`);
}


interface StateAccuracyResult {
  checkedFields: number;
  correctFields: number;
  accuracy: number;
  missingTurns: number;
  unexpectedMessageTurns: number;
}

// Find expected dialogue states for a scenario.
function getExpectedDialogueStates(scenarioId: string) {
  return expectedDialogueStates.scenarios.find(
    (scenario) => scenario.scenarioId === scenarioId
  );
}

// Compare the manager's state after each normal patient message.
function evaluateStateAccuracy(
  result: ExperimentResult,
  expectedStates: ExpectedDialogueState[]
): StateAccuracyResult {

  // Confirmation messages such as "yes" and "no" are excluded.
  const messageTurns = result.turns.filter(
    (turn) => turn.stepType === "message"
  );

  let checkedFields = 0;
  let correctFields = 0;
  let missingTurns = 0;

  for (const expectedState of expectedStates) {

    // Message numbers refer only to normal patient messages.
    const actualTurn = messageTurns[expectedState.messageNumber - 1];

    const expectedFields = Object.entries(expectedState).filter(
      ([field]) => field !== "messageNumber"
    );

    // A missing message turn means its expected fields are incorrect.
    if (!actualTurn) {
      missingTurns++;
      checkedFields += expectedFields.length;
      continue;
    }

    for (const [field, expectedValue] of expectedFields) {
      checkedFields++;

      const actualValue = (
        actualTurn.dialogueState as unknown as Record<string, unknown>
      )[field];

      // Explicit null values are also evaluated.
      if (actualValue === expectedValue) {
        correctFields++;
      }
    }
  }

  const accuracy =
    checkedFields > 0
      ? (correctFields / checkedFields) * 100
      : 0;

  return {
    checkedFields,
    correctFields,
    accuracy,
    missingTurns,
    unexpectedMessageTurns: Math.max(
      0,
      messageTurns.length - expectedStates.length
    ),
  };
}

// Evaluate dialogue-state accuracy for both managers.
console.log("\n========== DIALOGUE-STATE ACCURACY ==========");

for (const manager of managers) {
  const managerResults = experimentData.results.filter(
    (result) => result.manager === manager
  );

  let totalCorrectFields = 0;
  let totalCheckedFields = 0;

  console.log(`\n${manager}`);
  console.log("---------------------------------------------");

  for (const result of managerResults) {
    const expectedScenario = getExpectedDialogueStates(
      result.scenarioId
    );

    if (!expectedScenario) {
      console.error(
        `Missing expected dialogue states for ${result.scenarioId}`
      );
      continue;
    }

    const evaluation = evaluateStateAccuracy(
      result,
      expectedScenario.expectedStates
    );

    totalCorrectFields += evaluation.correctFields;
    totalCheckedFields += evaluation.checkedFields;

    console.log(
      `${result.scenarioId}: ${evaluation.correctFields}/${evaluation.checkedFields} correct`
    );

    if (
      evaluation.missingTurns > 0 ||
      evaluation.unexpectedMessageTurns > 0
    ) {
      console.log(
        `Turn mismatch: ${evaluation.missingTurns} missing, ` +
        `${evaluation.unexpectedMessageTurns} unexpected`
      );
    }
  }

  const overallAccuracy =
    totalCheckedFields > 0
      ? (totalCorrectFields / totalCheckedFields) * 100
      : 0;

  console.log("---------------------------------------------");
  console.log(
    `Correct fields: ${totalCorrectFields}/${totalCheckedFields}`
  );
  console.log(`State accuracy: ${overallAccuracy.toFixed(2)}%`);
}


// --------------------------------------------------
// Save evaluation results for the web dashboard
// --------------------------------------------------

const evaluationSummary = {
  referenceTime: experimentData.referenceTime,
  scenariosTested: experimentData.scenarios.length,

  managers: managers.map((manager) => {
    const managerResults = experimentData.results.filter(
      (result) => result.manager === manager
    );

    // Task success
    const scenarioEvaluations = managerResults.map((result) => {
      const evaluation = evaluateScenario(result);

      return {
        scenarioId: result.scenarioId,
        scenario: result.scenario,
        taskSuccess: evaluation.taskSuccess,
        reason: evaluation.reason,
        interruptionAcknowledged:
          evaluation.interruptionAcknowledged ?? null,
      };
    });

    const successfulTasks = scenarioEvaluations.filter(
      (item) => item.taskSuccess
    ).length;

    // Average dialogue turns per scenario
    const totalTurns = managerResults.reduce(
        (sum, result) => sum + result.turns.length,
        0
    );
    
    const averageTurns = managerResults.length > 0 
    ? totalTurns / managerResults.length
    : 0;    

    // Response latency: normal patient messages only
    const latencies = managerResults.flatMap((result) =>
      result.turns
        .filter((turn) => turn.stepType === "message")
        .map((turn) => turn.latencyMs)
        .filter((latency) => Number.isFinite(latency))
    );

    const averageLatency =
      latencies.length > 0
        ? latencies.reduce((sum, value) => sum + value, 0) /
          latencies.length
        : 0;

    // Dialogue-state accuracy
    let correctFields = 0;
    let checkedFields = 0;

    const stateEvaluations = managerResults.map((result) => {
      const expectedScenario = getExpectedDialogueStates(
        result.scenarioId
      );

      if (!expectedScenario) {
        return null;
      }

      const evaluation = evaluateStateAccuracy(
        result,
        expectedScenario.expectedStates
      );

      correctFields += evaluation.correctFields;
      checkedFields += evaluation.checkedFields;

      return {
        scenarioId: result.scenarioId,
        correctFields: evaluation.correctFields,
        checkedFields: evaluation.checkedFields,
        accuracy: evaluation.accuracy,
      };
    }).filter((item) => item !== null);

    return {
      manager,
      scenariosTested: managerResults.length,

      taskSuccess: {
        successful: successfulTasks,
        total: scenarioEvaluations.length,
        rate:
          scenarioEvaluations.length > 0
            ? (successfulTasks / scenarioEvaluations.length) * 100
            : 0,
      },
      dialogueTurns: {
        totalTurns,
        averageTurns,
      },

      dialogueStateAccuracy: {
        correctFields,
        totalFields: checkedFields,
        accuracy:
          checkedFields > 0
            ? (correctFields / checkedFields) * 100
            : 0,
        scenarios: stateEvaluations,
      },

      latency: {
        messagesMeasured: latencies.length,
        averageMs: averageLatency,
        medianMs: calculateMedian(latencies),
      },

      scenarios: scenarioEvaluations,
    };
  }),
};

const summaryPath = path.resolve(
  "results/evaluation-summary.json"
);

fs.writeFileSync(
  summaryPath,
  JSON.stringify(evaluationSummary, null, 2),
  "utf-8"
);

console.log("\nEvaluation summary saved successfully.");
console.log(summaryPath);
