/**
 * Generate a short first-guess overtime note using AI (OpenAI) from the day's context.
 * Returns null if OPENAI_API_KEY is not set or the request fails.
 * Set OPENAI_API_KEY in .env.local to enable; otherwise the day API falls back to a generic note.
 */

export interface DayContext {
  date: string;
  totalMinutes: number;
  byCategory: Record<string, number>;
  tasks: { taskTitle: string; category: string; durationMinutes: number }[];
}

export async function generateOvertimeNoteFromContext(
  context: DayContext
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;

  const activityLines = context.tasks.length > 0
    ? context.tasks
        .slice(0, 15)
        .map(
          (t) =>
            `- ${t.taskTitle} (${t.category}): ${Math.round(t.durationMinutes / 60 * 10) / 10}h`
        )
        .join('\n')
    : Object.entries(context.byCategory)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(
          ([cat, mins]) =>
            `- ${cat}: ${Math.round(mins / 60 * 10) / 10}h`
        )
        .join('\n');

  const prompt = `Given this work day, write one short sentence (max 20 words) explaining why there was overtime. Be specific to the activities. Do not use quotes or preamble.

Date: ${context.date}
Total: ${Math.round(context.totalMinutes / 60 * 10) / 10}h

Activities:
${activityLines || 'No activity names.'}

Reply with only the single sentence.`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80,
        temperature: 0.3,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 && text.length <= 300 ? text : null;
  } catch {
    return null;
  }
}
