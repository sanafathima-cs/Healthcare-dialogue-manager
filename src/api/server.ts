
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { AppointmentRepository } from "../appointment/appointmentRepository.js";
import { AppointmentService } from "../appointment/appointmentService.js";

import { DialogueController as RuleBasedController } from "../rule_based/dialogueController.js";
import { LLMDialogueController } from "../llm_based/llmDialogueController.js";

import type { DialogueManager } from "./dialogueManager.js";

import { readFile, writeFile, mkdir, } from "node:fs/promises";
import path from "node:path";

import { runExperiment } from "../../experiments/first-comparison.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// --------------------------------------------------
// 1. Shared appointment repository and service
// --------------------------------------------------

const appointmentRepository = new AppointmentRepository();
const appointmentService = new AppointmentService(appointmentRepository);

// Demo patient IDs
const validPatientIds = [
  "PAT-001",
  "PAT-002",
  "PAT-003",
  "PAT-004",
];

// --------------------------------------------------
// 2. Conversation types and session storage
// --------------------------------------------------

interface ConversationMessage {
  role: "patient" | "assistant";
  content: string;
  timestamp: string;
}

interface ConversationSession {
  managerType: "rule-based" | "llm-based";
  patientId: string;
  controller: DialogueManager;
  history: ConversationMessage[];
}

interface StoredConversation {
  sessionId: string;
  managerType: "rule-based" | "llm-based";
  patientId: string;
  history: ConversationMessage[];
  controllerState:
    | {
        value: string;
        dialogue: import("../rule_based/types.js").DialogueState;
        conversationEnded: boolean;
      }
    | {
        dialogue: import("../rule_based/types.js").DialogueState;
        pendingConfirmation: "book" | "cancel" | "reschedule" | null;
      };
}

const sessions = new Map<string, ConversationSession>();

const conversationsFile = path.resolve(
  process.cwd(),
  "data",
  "conversations.json"
);

async function saveConversations(): Promise<void> {
  const conversations: StoredConversation[] = [];

  for (const [sessionId, session] of sessions.entries()) {
    const controllerState =
      session.managerType === "rule-based"
        ? (session.controller as RuleBasedController).getPersistedState()
        : (session.controller as LLMDialogueController).getPersistedState();

    conversations.push({
      sessionId,
      managerType: session.managerType,
      patientId: session.patientId,
      history: session.history,
      controllerState,
    });
  }

  await mkdir(path.dirname(conversationsFile), { recursive: true });

  await writeFile(
    conversationsFile,
    JSON.stringify(conversations, null, 2),
    "utf-8"
  );
}

async function loadConversations(): Promise<void> {
  await mkdir(path.dirname(conversationsFile), { recursive: true });

  try {
    const fileContent = await readFile(conversationsFile, "utf-8");
    const conversations: StoredConversation[] = JSON.parse(fileContent);

    for (const conversation of conversations) {
      let controller: DialogueManager;

      if (conversation.managerType === "rule-based") {
        controller = new RuleBasedController(
          appointmentService,
          conversation.patientId,
          undefined,
          conversation.controllerState as Extract<
            StoredConversation["controllerState"],
            { value: string }
          >
        );
      } else {
        controller = new LLMDialogueController(
          appointmentService,
          conversation.patientId,
          undefined,
          conversation.controllerState as Extract<
            StoredConversation["controllerState"],
            { pendingConfirmation: unknown }
          >
        );
      }

      sessions.set(conversation.sessionId, {
        managerType: conversation.managerType,
        patientId: conversation.patientId,
        controller,
        history: conversation.history,
      });
    }

    console.log(`Loaded ${conversations.length} saved conversations.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.log("No saved conversations found. Starting fresh.");
      return;
    }

    throw error;
  }
}

// --------------------------------------------------
// 3. Create a conversation session
// --------------------------------------------------

function createSession(
  managerType: "rule-based" | "llm-based",
  patientId: string,
): string {
  const sessionId = randomUUID();

  let controller: DialogueManager;

  if (managerType === "rule-based") {
    controller = new RuleBasedController(
      appointmentService,
      patientId,
    );
  } else {
    controller = new LLMDialogueController(
      appointmentService,
      patientId,
    );
  }

  sessions.set(sessionId, {
    managerType,
    patientId,
    controller,
    history: [],
  });

  return sessionId;
}

// --------------------------------------------------
// 4. Read and validate JSON request bodies
// --------------------------------------------------

async function readRequestBody(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  let body = "";

  for await (const chunk of req) {
    body += chunk.toString();

    if (body.length > 1_000_000) {
      throw new Error("Request body is too large.");
    }
  }

  const parsed: unknown = JSON.parse(body);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new SyntaxError("Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

// --------------------------------------------------
// 5. Send JSON responses
// --------------------------------------------------

function sendJson(
  res: import("node:http").ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(JSON.stringify(data));
}

function sendNoContent(
  res: import("node:http").ServerResponse,
): void {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end();
}

// --------------------------------------------------
// 6. Recognize explicit confirmation answers
// --------------------------------------------------

const confirmationAnswers = new Set([
  "yes",
  "yes please",
  "yes, please",
  "confirm",
  "y",
  "no",
  "no thanks",
  "no, thanks",
  "nope",
  "n",
  "don't confirm",
  "dont confirm",
  "do not confirm",
]);

function isConfirmationAnswer(message: string): boolean {
  const normalizedMessage = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");

  return confirmationAnswers.has(normalizedMessage);
}

// --------------------------------------------------
// 7. Create the HTTP server
// --------------------------------------------------

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  const requestUrl = new URL(
    req.url ?? "/",
    "http://localhost:3001",
  );

  const pathname = requestUrl.pathname;

  try {
    // ----------------------------------------------
    // Health check
    // ----------------------------------------------

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        status: "running",
        message: "Healthcare Dialogue Manager API is running.",
      });

      return;
    }

    // ----------------------------------------------
    // Get available demo patients
    // ----------------------------------------------

    if (req.method === "GET" && pathname === "/api/patients") {
      sendJson(res, 200, {
        patients: validPatientIds,
      });

      return;
    }

    // ----------------------------------------------
    // Create a new conversation
    // ----------------------------------------------

    if (
      req.method === "POST" &&
      pathname === "/api/conversations"
    ) {
      const body = await readRequestBody(req);

      const managerType = body.managerType;
      const patientId = body.patientId;

      if (
        managerType !== "rule-based" &&
        managerType !== "llm-based"
      ) {
        sendJson(res, 400, {
          error: "Invalid dialogue manager type.",
        });

        return;
      }

      if (
        typeof patientId !== "string" ||
        !validPatientIds.includes(patientId)
      ) {
        sendJson(res, 400, {
          error: "Please provide a valid patient ID.",
          validPatientIds,
        });

        return;
      }

      const sessionId = createSession(managerType, patientId);
      await saveConversations();

      const session = sessions.get(sessionId)!;

      sendJson(res, 201, {
        sessionId,
        managerType,
        patientId,
        message: "Conversation started.",
        dialogueState: session.controller.getDialogueState(),
        history: session.history,
      });

      return;
    }

    // ----------------------------------------------
    // Get a conversation and its current state
    // ----------------------------------------------

    if (
      req.method === "GET" &&
      pathname.startsWith("/api/conversations/")
    ) {
      const sessionId = decodeURIComponent(
        pathname.slice("/api/conversations/".length),
      );

      const session = sessions.get(sessionId);

      if (!session) {
        sendJson(res, 404, {
          error: "Conversation session not found.",
        });

        return;
      }

      sendJson(res, 200, {
        sessionId,
        managerType: session.managerType,
        patientId: session.patientId,
        history: session.history,
        dialogueState: session.controller.getDialogueState(),
        isAwaitingConfirmation:
          session.controller.isAwaitingConfirmation(),
      });

      return;
    }

        // ----------------------------------------------
    // Get all conversation logs
    // ----------------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/conversations"
    ) {
      const conversations = Array.from(
        sessions.entries()
      ).map(([sessionId, session]) => ({
        sessionId,
        managerType: session.managerType,
        patientId: session.patientId,
        history: session.history,
        dialogueState: session.controller.getDialogueState(),
        isAwaitingConfirmation:
          session.controller.isAwaitingConfirmation(),
      }));

      sendJson(res, 200, { conversations });
      return;
    }

    // ----------------------------------------------
    // Send a patient message
    // ----------------------------------------------

    if (req.method === "POST" && pathname === "/api/message") {
      const body = await readRequestBody(req);

      const sessionId = body.sessionId;
      const message = body.message;

      if (
        typeof sessionId !== "string" ||
        typeof message !== "string" ||
        !message.trim()
      ) {
        sendJson(res, 400, {
          error: "sessionId and a non-empty message are required.",
        });

        return;
      }

      const session = sessions.get(sessionId);

      if (!session) {
        sendJson(res, 404, {
          error: "Conversation session not found.",
        });

        return;
      }

      // Only explicit yes/no answers are treated as confirmations.
      // Other messages are sent to processMessage(), allowing corrections.
      const awaitingConfirmation =
        session.controller.isAwaitingConfirmation();

      const isConfirmation =
        awaitingConfirmation && isConfirmationAnswer(message);

      const response = isConfirmation
        ? session.controller.processConfirmation(message)
        : await session.controller.processMessage(message);

      // Save both sides of the conversation.
      session.history.push(
        {
          role: "patient",
          content: message,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: response,
          timestamp: new Date().toISOString(),
        },
      );

      await saveConversations();

      sendJson(res, 200, {
        sessionId,
        managerType: session.managerType,
        patientId: session.patientId,
        patientMessage: message,
        assistantResponse: response,
        dialogueState: session.controller.getDialogueState(),
        isAwaitingConfirmation:
          session.controller.isAwaitingConfirmation(),
        history: session.history,
      });

      return;
    }

    // ----------------------------------------------
// Run research experiments
// ----------------------------------------------

if (
  req.method === "POST" &&
  pathname === "/api/experiments/run"
) {
  // Run both dialogue managers on all scenarios
  await runExperiment();

  // Calculate evaluation metrics
  await execFileAsync(
    "npx",
    ["tsx", "src/evaluation/evaluate-experiments.ts"]
  );

  // Read the generated evaluation summary
  const summaryRaw = await readFile(
    path.resolve("results/evaluation-summary.json"),
    "utf-8"
  );

  const evaluation = JSON.parse(summaryRaw);

  sendJson(res, 200, {
    message: "Experiments completed successfully.",
    evaluation,
  });

  return;
}

// ----------------------------------------------
// Get saved experiment results
// ----------------------------------------------

if (
  req.method === "GET" &&
  pathname === "/api/experiments/results"
) {
  const resultsRaw = await readFile(
    path.resolve("results/experiment-results.json"),
    "utf-8"
  );

  const evaluationRaw = await readFile(
    path.resolve("results/evaluation-summary.json"),
    "utf-8"
  );

  sendJson(res, 200, {
    results: JSON.parse(resultsRaw),
    evaluation: JSON.parse(evaluationRaw),
  });

  return;
}


// ----------------------------------------------
// Get saved LLM prompt comparison results
// ----------------------------------------------

if (
  req.method === "GET" &&
  pathname === "/api/prompt-comparison/results"
) {
  const resultsRaw = await readFile(
    path.resolve("results/prompt-comparison-results.json"),
    "utf-8"
  );

  const savedData = JSON.parse(resultsRaw);

  const results = savedData.results;
  const accuracySummary = savedData.accuracySummary;

  const promptVariants = [
    "baseline",
    "detailed",
    "strict",
  ];

  const latencySummary = promptVariants.map((variant) => {
    const variantResults = results.filter(
      (result: {
        promptVariant: string;
        latencyMs: number;
        success: boolean;
      }) =>
        result.promptVariant === variant &&
        result.success
    );

    const latencies = variantResults
      .map((result: { latencyMs: number }) => result.latencyMs)
      .sort((a: number, b: number) => a - b);

    const totalLatency = latencies.reduce(
      (sum: number, value: number) => sum + value,
      0
    );

    const middle = Math.floor(latencies.length / 2);

    const medianLatency =
      latencies.length === 0
        ? 0
        : latencies.length % 2 === 0
          ? (latencies[middle - 1] + latencies[middle]) / 2
          : latencies[middle];

    return {
      promptVariant: variant,
      successfulExecutions: variantResults.length,
      totalExecutions: results.filter(
        (result: { promptVariant: string }) =>
          result.promptVariant === variant
      ).length,
      averageLatencyMs:
        latencies.length === 0
          ? 0
          : Number((totalLatency / latencies.length).toFixed(2)),
      medianLatencyMs: Number(medianLatency.toFixed(2)),
    };
  });

  sendJson(res, 200, {
    results,
    accuracySummary,
    latencySummary,
  });

  return;
}

    // ----------------------------------------------
// Get research evaluation results
// ----------------------------------------------

if (
  req.method === "GET" &&
  pathname === "/api/evaluation"
) {
  const summaryPath = path.resolve(
    "results/evaluation-summary.json"
  );

  const summaryRaw = await readFile(
    summaryPath,
    "utf-8"
  );

  const evaluationSummary: unknown = JSON.parse(summaryRaw);

  sendJson(res, 200, {
    evaluation: evaluationSummary,
  });

  return;
}

    // ----------------------------------------------
    // Get appointment records
    // ----------------------------------------------

    if (
      req.method === "GET" &&
      pathname === "/api/appointments"
    ) {
      sendJson(res, 200, {
        appointments: appointmentRepository.getAll(),
      });

      return;
    }

    // ----------------------------------------------
    // Unknown endpoint
    // ----------------------------------------------

    sendJson(res, 404, {
      error: "Endpoint not found.",
    });
  } catch (error) {
    console.error("API error:", error);

    const statusCode =
      error instanceof SyntaxError ? 400 : 500;

    sendJson(res, statusCode, {
      error:
        error instanceof SyntaxError
          ? "Invalid JSON request body."
          : error instanceof Error
            ? error.message
            : "Internal server error.",
    });
  }
});

// --------------------------------------------------
// 8. Start the server
// --------------------------------------------------

const PORT = 3001;

await loadConversations();

server.listen(PORT, () => {
  console.log("--------------------------------------");
  console.log("Healthcare Dialogue Manager API");
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("--------------------------------------");
});