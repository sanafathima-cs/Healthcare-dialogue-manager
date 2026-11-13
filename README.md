Healthcare Appointment Dialogue Manager

Project overview
This project implements and compares two dialogue management approaches for healthcare appointment scheduling.

Rule-based Dialogue Manager - uses predefined rules and dialogue states to understand patient requests and manage conversations.
LLM-based Dialogue Manager - uses a locally running Large Language Model (Llama 3.2 through Ollama) to extract information from patient messages and return structured JSON. The Typescript application manages dialogue state, validation, appointment operations, and confirmations.

Both approaches use the same appointment service and appointment data.

Installation
Clone or download the project and navigate to its root directory

Install dependencies:
npm install

For the LLM-assisted dialogue manager, make sure Ollama is installed and the Llama 3.2 model is available.
ollama pull llama3.2

Ensure the Ollama service is running before selecting the LLm-based option

Running the Application

Start the terminal application:
npx tsx src/terminal.ts

Running Tests
npm test

Check Typescript compilation
npm run typecheck

Running Experiments :-

Run the first comparison experiment :- 
npx tsx experiments/first-comparison.ts

Run the second prompt comparison Experiment :-
npx tsx experiments/prompt-comparison.ts

The experiment results are stored in the results/ directory.

Latency Evaluation:-
npx tsx src/evaluation/evaluate-experiments.ts