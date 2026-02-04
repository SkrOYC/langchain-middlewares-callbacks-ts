/**
 * Generate with citations prompt (Appendix D.2)
 *
 * Built-in, non-configurable prompt template for generating responses
 * with citation markers.
 */

/**
 * Parse citations from LLM response
 *
 * @param response - Raw LLM response containing citation markers
 * @param maxIndex - Maximum valid citation index (default: 1000)
 * @returns Array of cited memory indices
 */
export function parseCitations(response: string, maxIndex = 1000): number[] {
  if (!response.trim()) {
    return [];
  }

  // Check for NO_CITE special case
  if (response.includes("[NO_CITE]")) {
    return [];
  }

  // Match citation pattern [i, j, k] or [i]
  const citationRegex = /\[([^\]]+)\]/g;
  const matches = response.matchAll(citationRegex);

  const citations: number[] = [];
  for (const match of matches) {
    const content = match[1]?.trim();
    // Skip NO_CITE
    if (content === undefined || content === "NO_CITE") {
      continue;
    }

    // Parse indices (handle spaces around commas)
    const indices = content
      .split(",")
      .map((s) => {
        const trimmed = s.trim();
        return Number.parseInt(trimmed, 10);
      })
      .filter((n) => !Number.isNaN(n) && n >= 0 && n <= maxIndex);

    citations.push(...indices);
  }

  return citations;
}

/**
 * Format example response with citations
 *
 * @param responseText - The response text
 * @param citations - Array of memory indices to cite
 * @returns Formatted response with citations
 */
export function formatExampleResponse(
  responseText: string,
  citations: number[]
): string {
  if (citations.length === 0) {
    return `${responseText} [NO_CITE]`;
  }
  return `${responseText} [${citations.join(", ")}]`;
}

/**
 * Build the generate with citations prompt
 *
 * @param userQuery - The user's query
 * @param memoriesBlock - Formatted memories block with topic summaries and original dialogue
 * @returns Formatted prompt string ready for LLM invocation
 */
export function generateWithCitations(
  userQuery: string,
  memoriesBlock: string
): string {
  const prompt = `Task Description: Given a user query and a list of memories consisting of personal
summaries with their corresponding original turns, generate a natural and fluent response
while adhering to the following guidelines:

* Cite useful memories using [i], where i corresponds to the index of the cited memory.
* Do not cite memories that are not useful. If no useful memory exist, output [NO_CITE].
* Each memory is independent and may repeat or contradict others. The response must
  be directly supported by cited memories.
* If the response relies on multiple memories, list all corresponding indices, e.g.,
  [i, j, k].
* The citation is evaluated based on whether the response references the original turns,
  not the summaries.

Examples:
Case 1: Useful Memories Found
INPUT:
* User Query: SPEAKER_1: What hobbies do I enjoy?
* Memories:
  – Memory [0]: SPEAKER_1 enjoys hiking and often goes on weekend trips.
    * Speaker 1: I love spending my weekends hiking in the mountains.
      Speaker 2: That sounds amazing! Do you go alone or with friends?
    * Speaker 1: Last month, I hiked a new trail and it was amazing.
      Speaker 2: Nice! Which trail was it?
  – Memory [1]: SPEAKER_1 plays the guitar and occasionally performs at open mics.
    * Speaker 1: I've been practicing guitar for years and love playing at open mics.
      Speaker 2: That's awesome! What songs do you usually play?
    * Speaker 1: I performed at a local cafe last week and had a great time.
      Speaker 2: That must have been fun! Were there a lot of people?
  – Memory [2]: SPEAKER_1 is interested in astronomy and enjoys stargazing.
    * Speaker 1: I recently bought a telescope to get a closer look at planets.
      Speaker 2: That's so cool! What have you seen so far?
    * Speaker 1: I love stargazing, especially when there's a meteor shower.
      Speaker 2: I'd love to do that sometime. When's the next one?

Output: You enjoy hiking, playing guitar, and stargazing. [0, 1, 2]

Case 2: No Useful Memories
INPUT:
* User Query: SPEAKER_1: What countries did I go to last summer?
* Memories:
  – Memory [0]: SPEAKER_1 enjoys hiking and often goes on weekend trips.
    * Speaker 1: I love spending my weekends hiking in the mountains.
      Speaker 2: That sounds amazing! Do you go alone or with friends?
    * Speaker 1: Last month, I hiked a new trail and it was amazing.
      Speaker 2: Nice! Which trail was it?
  – Memory [1]: SPEAKER_1 plays the guitar and occasionally performs at open mics.
    * Speaker 1: I've been practicing guitar for years and love playing at open mics.
      Speaker 2: That's awesome! What songs do you usually play?
    * Speaker 1: I performed at a local cafe last week and had a great time.
      Speaker 2: That must have been fun! Were there a lot of people?
  – Memory [2]: SPEAKER_1 is interested in astronomy and enjoys stargazing.
    * Speaker 1: I recently bought a telescope to get a closer look at planets.
      Speaker 2: That's so cool! What have you seen so far?
    * Speaker 1: I love stargazing, especially when there's a meteor shower.
      Speaker 2: I'd love to do that sometime. When's the next one?

Output: I don't have enough information to answer that. [NO_CITE]

Additional Instructions:
* Ensure the response is fluent and directly answers the user's query.
* Always cite the useful memory indices explicitly.
* The citation is evaluated based on whether the response references the original turns,
  not the summaries.
* Follow the format of the examples provided above.

Input:
* User Query: ${userQuery}
* Memories: ${memoriesBlock}

Output:
`;

  return prompt;
}
