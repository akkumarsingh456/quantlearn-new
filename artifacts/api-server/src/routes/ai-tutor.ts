import { Router, type IRouter, type Request } from 'express';
import { tutorRequestSchema, tutorResponseSchema } from '@workspace/api-zod';
import { logger } from '../lib/logger';

const router: IRouter = Router();
type ClerkRequest = Request & { auth?: () => { userId?: string | null } };

function systemPrompt() {
  return [
    'You are QuantumLearn AI, a careful quantum-computing tutor.',
    'The simulator is the source of truth. Never invent, alter, or infer state-vector, probability, or measurement values not present in the context.',
    'Teach quantum computing accurately: distinguish amplitudes from probabilities, explain the Born rule, and describe phase/interference without claiming that superposition allows reading all outcomes.',
    'When the learner asks outside quantum computing, briefly say what is in scope and connect the answer to a relevant quantum concept if possible.',
    'Use the learner level and requested mode. Prefer hints before solutions for give-hint, debug-circuit, and quiz-me.',
    'For Qiskit examples, use current Qiskit APIs and make snippets self-contained; do not invent package APIs.',
    'Use sources only for genuine references you can identify; otherwise return an empty array rather than fabricate citations.',
    'Return only valid JSON matching: { answer: string, hint?: string, nextStep?: string, qiskitCode?: string, quizQuestion?: string, sources: string[] }.',
    'State clearly when the provided context is insufficient. Do not claim real hardware execution.',
  ].join(' ');
}

router.post('/tutor', async (req, res) => {
  const parsed = tutorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid tutor request.', issues: parsed.error.flatten() });
    return;
  }
  const userId = (req as ClerkRequest).auth?.().userId || null;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'AI Tutor is not configured.' });
      return;
    }

    const providerResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(parsed.data) }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              answer: { type: 'STRING' },
              hint: { type: 'STRING', nullable: true },
              nextStep: { type: 'STRING', nullable: true },
              qiskitCode: { type: 'STRING', nullable: true },
              quizQuestion: { type: 'STRING', nullable: true },
              sources: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['answer', 'sources'],
          },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!providerResponse.ok) {
      if (providerResponse.status === 429) {
        res.status(429).json({ error: 'AI Tutor is rate-limited. Wait briefly and retry.' });
        return;
      }
      if ([400, 401, 403].includes(providerResponse.status)) {
        logger.error({ status: providerResponse.status }, 'AI Tutor provider rejected the request; check the server API key and request configuration');
        res.status(502).json({ error: 'AI Tutor provider rejected the request. Check the server API key and try again.' });
        return;
      }
      logger.error({ status: providerResponse.status }, 'AI Tutor provider request failed');
      res.status(502).json({ error: 'AI Tutor provider request failed. Retry shortly.' });
      return;
    }
    const payload = await providerResponse.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!content) {
      res.status(502).json({ error: 'AI Tutor provider returned no response.' });
      return;
    }
    const response = tutorResponseSchema.safeParse(JSON.parse(content));
    if (!response.success) {
      res.status(502).json({ error: 'AI Tutor provider returned an invalid response.' });
      return;
    }
    res.json(response.data);
  } catch (error) {
    logger.error({ errorName: error instanceof Error ? error.name : 'unknown' }, 'AI Tutor request failed');
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'AI Tutor timed out. Retry the request.' : 'AI Tutor is temporarily unavailable. Retry the request.',
    });
  }
});

export default router;
