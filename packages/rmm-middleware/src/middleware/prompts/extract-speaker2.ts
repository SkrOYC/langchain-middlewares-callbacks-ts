import { z } from "zod";

/**
 * Memory extraction prompt for SPEAKER_2 (Appendix D.1.1)
 *
 * Built-in, non-configurable prompt template that extracts personal summaries
 * from session dialogue for a single target speaker.
 */

/**
 * Output schema for extraction prompt (Appendix D.1.1)
 */
export const ExtractionOutputSchema = z.union([
  z.object({
    extracted_memories: z.array(
      z.object({
        summary: z.string().min(1),
        reference: z.array(z.number().int().nonnegative()),
      })
    ),
  }),
  z.literal("NO_TRAIT"),
]);

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

/**
 * Build the SPEAKER_2 extraction prompt
 *
 * @param dialogueSession - Complete session dialogue with turns marked by speaker
 * @returns Formatted prompt string ready for LLM invocation
 */
export function extractSpeaker2(dialogueSession: string): string {
  const prompt = `Task Description: Given a session of dialogue between SPEAKER_1 and SPEAKER_2, extract the
personal summaries of SPEAKER_2, with references to the corresponding turn IDs. Ensure
the output adheres to the following rules:

* Output results in JSON format. The top-level key is "extracted_memories". The value
  should be a list of dictionaries, where each dictionary has the keys "summary" and
  "reference":
  – summary: A concise personal summary, which captures relevant information about
    SPEAKER_2's experiences, preferences, and background, across multiple turns.
  – reference: A list of references, each in the format of [turn_id] indicating
    where the information appears.
* If no personal summary can be extracted, return NO_TRAIT.

Example:
INPUT:
* Turn 0:
  – SPEAKER_1: Did you manage to go out on a run today?
  – SPEAKER_2: Yes, I actually was able to. I am considering joining the local gym.
    Do you prefer going to the gym?
* Turn 1:
  – SPEAKER_1: I do actually. I like the controlled environment. I don't want to
    have to depend on the weather considering where I live.
  – SPEAKER_2: That's why I am thinking about it. I hate to have to run when it's
    raining, and I feel like it rains here all the time.
* Turn 2:
  – SPEAKER_1: A lot of gyms have tracks so that you can run indoors. Hey, have you
    thought about maybe buying a treadmill and using that at home?
  – SPEAKER_2: I am definitely considering getting one. I'm just trying to figure
    out what I would do more—go to the gym and actually do more than just running,
    or stick to what I know and get a treadmill.
* Turn 3:
  – SPEAKER_1: Oh, that's true. I hadn't thought about all of that. You're right.
    With a gym, there are a whole lot of options for what you can do. Do you have
    some good gyms near you?
  – SPEAKER_2: They just built one in the small town really close to me, and it
    looks pretty decent. Before that, it was like an hour drive.
* Turn 4:
  – SPEAKER_1: With you not owning a car, going to any others would probably be
    difficult. Well, do you have any good parks and running trails nearby?
  – SPEAKER_2: Yeah, exactly. There is a super nice little running trail that is
    pretty decent.
* Turn 5:
  – SPEAKER_1: Hey, do you run with anyone? I mean, have you joined a club, or will
    you if you haven't?
  – SPEAKER_2: There isn't any around here; maybe I could start one. Thank you for
    that idea.

OUTPUT:
{
  "extracted_memories": [
    {
      "summary": "SPEAKER_2 is considering joining a local gym due to frequent rain affecting outdoor runs.",
      "reference": [0, 1]
    },
    {
      "summary": "SPEAKER_2 is debating between buying a treadmill for home use or going to the gym for more workout variety.",
      "reference": [2]
    },
    {
      "summary": "A new gym was recently built nearby SPEAKER_2, replacing a previous one that was an hour away.",
      "reference": [3]
    },
    {
      "summary": "SPEAKER_2 has access to a nice local running trail.",
      "reference": [4]
    },
    {
      "summary": "SPEAKER_2 notices there is no local running club but is considering starting one.",
      "reference": [5]
    }
  ]
}

Task: Follow the JSON format demonstrated in the example above and extract the personal
summaries for SPEAKER_2 from the following dialogue session.
Input: ${dialogueSession}
Output:
`;

  return prompt;
}
