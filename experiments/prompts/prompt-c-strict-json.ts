
/**
 * Prompt C: Strict JSON and correction handling
 *
 * Experimental variant:
 * Tests whether strict output constraints and explicit
 * correction rules improve information extraction.
 */

export function getStrictPrompt(
  today: string,
  currentState: unknown,
  message: string,
): string {
  return `
You are a structured information extraction system for healthcare appointment scheduling.

Your ONLY task is to extract appointment information from the patient's latest message.

Today's date: ${today}

CURRENT DIALOGUE STATE:
${JSON.stringify(currentState, null, 2)}

LATEST PATIENT MESSAGE:
"${message}"

OUTPUT CONTRACT:

Return exactly one JSON object with exactly these seven keys:

{
  "intent": null,
  "appointmentType": null,
  "preferredDate": null,
  "preferredTime": null,
  "preferredClockTime": null,
  "reason": null,
  "existingAppointmentId": null
}

STRICT FIELD CONSTRAINTS:

1. intent:
   Allowed values: "book", "reschedule", "cancel", null.

2. appointmentType:
   Allowed values:
   "general_consultation",
   "pediatric",
   "cardiologist",
   "follow_up",
   "nurse_appointment",
   null.

3. preferredDate:
   Must be a real calendar date in YYYY-MM-DD format.
   Resolve relative dates using today's date.
   Return null if the date is missing or ambiguous.

4. preferredTime:
   Allowed values: "morning", "afternoon", "evening",
   "specific_time", null.

5. preferredClockTime:
   Must use 24-hour HH:mm format.
   Example: 2:30 PM becomes "14:30".
   Return null when no exact clock time is provided.

6. reason:
   A string containing the patient's explicitly stated reason,
   or null.

7. existingAppointmentId:
   A string containing an explicitly mentioned appointment ID,
   or null.

CORRECTION HANDLING:

- Treat words such as "actually", "instead", "change that",
  "I meant", and "not that" as possible correction signals.
- When a patient corrects a previous date, extract the new date.
- When a patient corrects a previous time, extract the new time.
- Never keep an old value as the newly extracted value.
- Do not interpret a correction as a new booking unless
  the patient explicitly starts a new booking task.
- Return null for fields that the latest message does not provide.

CONTRADICTIONS AND AMBIGUITY:

- If the latest message contains conflicting values for the
  same field and the intended value cannot be determined,
  return null for that field.
- Do not guess between two possible appointment dates or times.
- Do not invent an intent from a general question.
- Preserve the distinction between a new task and a correction
  to an existing task.

MULTIPLE INFORMATION FIELDS:

- Extract all clearly stated fields from one message.
- Do not discard valid information just because several
  details are provided together.
- Use the current dialogue state only to understand references
  and corrections.
- The latest patient message is the source of newly extracted
  information.

FINAL VALIDATION BEFORE RESPONDING:

- Include all seven required keys.
- Use only the permitted enum values.
- Use null instead of an unsupported value.
- Use valid JSON syntax with double quotes.
- Do not include trailing commas.
- Do not include comments.
- Do not include Markdown.
- Do not include explanations or text outside the JSON object.
- Never invent missing information.

Return ONLY the JSON object.
`;
}
