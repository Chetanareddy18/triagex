import Anthropic from '@anthropic-ai/sdk';
import { env, llmEnabled } from '../config/env.js';
import { PRIORITY_LABEL } from '../lib/domain.js';
import { logger } from '../lib/logger.js';
import type { IIncident } from '../models/Incident.js';
import type { IComment } from '../models/misc.js';

/**
 * Postmortem drafting. Provider-agnostic and optional:
 *   LLM_PROVIDER=openai     -> any OpenAI-compatible /chat/completions endpoint (LLM_BASE_URL)
 *   LLM_PROVIDER=anthropic  -> Anthropic Messages API via @anthropic-ai/sdk (default model claude-opus-5-5)
 *   LLM_PROVIDER=none (default) or no LLM_API_KEY -> deterministic template from the timeline
 */
export async function draftPostmortem(inc: IIncident, comments: Pick<IComment, 'body' | 'internal' | 'createdAt'>[]) {
  const template = templateDraft(inc, comments);
  if (!llmEnabled) return { draft: template, provider: 'template' };
  try {
    const prompt = [
      'Write a concise, blameless incident postmortem in Markdown with sections:',
      'Summary, Impact, Timeline (UTC), Root cause (state if unknown), Resolution, Follow-up actions.',
      'Use only the facts below; do not invent systems, people or numbers.',
      '',
      template,
    ].join('\n');
    const text = env.LLM_PROVIDER === 'anthropic' ? await callAnthropic(prompt) : await callOpenAICompatible(prompt);
    return { draft: text.trim() || template, provider: env.LLM_PROVIDER };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'LLM postmortem failed; using template');
    return { draft: template, provider: 'template' };
  }
}

async function callOpenAICompatible(prompt: string): Promise<string> {
  const base = env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: env.LLM_MODEL ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

let anthropic: Anthropic | null = null;

/** Anthropic via the official SDK. Default model is Claude Opus 5.5; override with LLM_MODEL. */
async function callAnthropic(prompt: string): Promise<string> {
  anthropic ??= new Anthropic({ apiKey: env.LLM_API_KEY, baseURL: env.LLM_BASE_URL, timeout: 60_000, maxRetries: 2 });
  const message = await anthropic.beta.messages.create({
    model: env.LLM_MODEL ?? 'claude-opus-5-5',
    max_tokens: 16000,
    // Server-side refusal fallback: the API re-routes a declined request itself.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' }, // short, factual summarisation
    messages: [{ role: 'user', content: prompt }],
  });
  if (message.stop_reason === 'refusal') throw new Error('LLM declined the request');
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

const iso = (d?: Date | null) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : 'n/a');

function hours(from: Date, to?: Date | null) {
  if (!to) return 'n/a';
  return `${((new Date(to).getTime() - new Date(from).getTime()) / 3_600_000).toFixed(1)} h`;
}

export function templateDraft(inc: IIncident, comments: Pick<IComment, 'body' | 'internal' | 'createdAt'>[]): string {
  const timeline = inc.timeline
    .map((t) => `- ${iso(t.at)} - ${t.message}${t.actorName ? ` (${t.actorName})` : ''}`)
    .join('\n');
  const discussion = comments
    .slice(-8)
    .map((c) => `- ${iso(c.createdAt)}${c.internal ? ' [internal]' : ''}: ${c.body.replace(/\s+/g, ' ').slice(0, 240)}`)
    .join('\n');
  return [
    `# Postmortem: ${inc.number} - ${inc.title}`,
    '',
    '## Summary',
    inc.description || '_No description provided._',
    '',
    '## Impact',
    `- Priority: P${inc.priority} (${PRIORITY_LABEL[inc.priority]}); impact ${inc.impact}, urgency ${inc.urgency}`,
    `- Category: ${inc.category}; channel: ${inc.channel}`,
    `- Time to resolve: ${hours(inc.createdAt, inc.resolution?.resolvedAt)}; SLA: ${inc.sla.state}`,
    inc.occurrences > 1 ? `- Duplicate alerts folded into this incident: ${inc.occurrences - 1}` : '',
    '',
    '## Timeline (UTC)',
    timeline,
    '',
    '## Resolution',
    inc.resolution?.summary ?? '_Not resolved yet._',
    '',
    '## Discussion highlights',
    discussion || '_No comments._',
    '',
    '## Root cause',
    '_To be confirmed by the incident owner._',
    '',
    '## Follow-up actions',
    '- [ ] Confirm root cause',
    '- [ ] Add monitoring / alerting for early detection',
    '- [ ] Document the fix in the knowledge base',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\n## /g, '\n\n## ');
}
