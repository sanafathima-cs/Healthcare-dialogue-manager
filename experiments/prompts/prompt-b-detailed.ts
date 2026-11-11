
/**
 * Prompt B: Detailed instructions with examples
 *
 * Experimental variant:
 * Tests whether detailed instructions and examples
 * improve LLM information extraction.
 */

export function getDetailedPrompt(
  today: string,
  currentState: unknown,
  message: string,
): string {
    const tomorrowDate = new Date(`${today}T00:00:00`);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);

    const tomorrow = [
        tomorrowDate.getFullYear(),
        String(tomorrowDate.getMonth() + 1).padStart(2, "0"),
        String(tomorrowDate.getDate()).padStart(2, "0"),
        ].join("-");
        return `
You are an information extraction component for a healthcare appointment scheduling system.

Your task is to extract information from the patient's LATEST message and return the updated information as JSON.

Today's date is ${today}.

CURRENT CONVERSATION INFORMATION:
${JSON.stringify(currentState, null, 2)}

LATEST PATIENT MESSAGE:
"${message}"

Return ONLY one valid JSON object with exactly these fields:

{
  "intent": null,
  "appointmentType": null,
  "preferredDate": null,
  "preferredTime": null,
  "preferredClockTime": null,
  "reason": null,
  "existingAppointmentId": null
}

FIELD RULES:

1. intent:
   Must be "book", "reschedule", "cancel", or null.

2. appointmentType:
   Must be one of:
   "general_consultation",
   "pediatric",
   "cardiologist",
   "follow_up",
   "nurse_appointment",
   or null.

3. preferredDate:
   Use YYYY-MM-DD format.
   Resolve dates such as tomorrow, next Monday, or November 15
   using today's date.
   Do not invent dates.

4. preferredTime:
   Must be "morning", "afternoon", "evening",
   "specific_time", or null.

5. preferredClockTime:
   Use 24-hour HH:mm format.
   For example, 2 PM becomes "14:00".
   Return null if no exact clock time is provided.

6. reason:
   Extract the reason stated by the patient.
   Otherwise return null.

7. existingAppointmentId:
   Extract the appointment ID if explicitly mentioned.
   Otherwise return null.

IMPORTANT CONVERSATION RULES:

- Use the latest patient message to identify new information.
- Consider the current conversation information when interpreting
  corrections or references to previously provided details.
- If the patient corrects a previously provided date or time,
  extract the corrected value.
- If the patient provides several details in one message,
  extract all the details.
- If the patient provides only one missing detail,
  extract that detail and return null for fields not mentioned.
- If the patient's message is ambiguous, do not guess.
- Do not interpret a question or unrelated statement as a new
  appointment request unless the patient clearly expresses that intent.
- Do not invent missing information.

EXAMPLES:

Example 1:
Patient message: "I want to book a cardiologist appointment tomorrow morning."

Expected extraction:
{
  "intent": "book",
  "appointmentType": "cardiologist",
  "preferredDate": "${tomorrow}",
  "preferredTime": "morning",
  "preferredClockTime": null,
  "reason": null,
  "existingAppointmentId": null
}

Example 2:
Patient message: "Actually, make it 2 PM instead."

Expected extraction:
{
  "intent": null,
  "appointmentType": null,
  "preferredDate": null,
  "preferredTime": "specific_time",
  "preferredClockTime": "14:00",
  "reason": null,
  "existingAppointmentId": null
}

Example 3:
Patient message: "I need a general consultation because I have a headache."

Expected extraction:
{
  "intent": null,
  "appointmentType": "general_consultation",
  "preferredDate": null,
  "preferredTime": null,
  "preferredClockTime": null,
  "reason": "I have a headache",
  "existingAppointmentId": null
}

Example 4:
Patient message: "Cancel appointment APT-001."

Expected extraction:
{
  "intent": "cancel",
  "appointmentType": null,
  "preferredDate": null,
  "preferredTime": null,
  "preferredClockTime": null,
  "reason": null,
  "existingAppointmentId": "APT-001"
}

OUTPUT REQUIREMENTS:

- Return exactly one valid JSON object.
- Include all seven fields.
- Use only the allowed enum values.
- Use null when information is unavailable.
- Do not include Markdown, explanations, or text outside JSON.
`;
}
