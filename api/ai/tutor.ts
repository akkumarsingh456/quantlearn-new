import { verifyToken } from '@clerk/backend';
import { tutorRequestSchema, tutorResponseSchema } from '@workspace/api-zod';

declare const process: { env: Record<string, string | undefined> };

type RequestLike = {
  method?: string;
  body?: unknown;
  headers?: { authorization?: string | string[] };
};

type ResponseLike = {
  status: (code: number) => ResponseLike;
  json: (body: unknown) => void;
};

function systemPrompt() {
  return [
    'You are QuantumLearn AI, a careful quantum-computing tutor. Explain concepts clearly for the learner level.',
    'The simulator is the source of truth: never invent state-vector, probability, or measurement values that are not in the supplied context.',
    'Distinguish amplitudes from probabilities, explain the Born rule, and describe phase/interference without claiming that superposition allows reading all outcomes.',
    'For Qiskit examples, use current APIs and provide self-contained snippets. Do not fabricate citations; use an empty sources array if no genuine reference is known.',
    'Return only JSON with answer (string), optional hint, nextStep, qiskitCode, quizQuestion, and sources (string array).',
  ].join(' ');
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const parsedRequest = tutorRequestSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    res.status(400).json({ error: 'Invalid tutor request.', issues: parsedRequest.error.flatten() });
    return;
  }
  const body = parsedRequest.data;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: 'Authentication is not configured on the server.' });
    return;
  }
  const authorization = req.headers?.authorization;
  const bearerToken = Array.isArray(authorization) ? authorization[0] : authorization;
  const token = bearerToken?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    res.status(401).json({ error: 'Sign in is required to use the AI Tutor.' });
    return;
  }
  try {
    await verifyToken(token, { secretKey });
  } catch {
    res.status(401).json({ error: 'Your session could not be verified. Sign in again and retry.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'AI Tutor is not configured.' });
    return;
  }

  try {
    const providerResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt() }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(body) }] }],
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
      },
    );

    if (!providerResponse.ok) {
      if (providerResponse.status === 429) {
        res.status(429).json({ error: 'AI Tutor is rate-limited. Wait briefly and retry.' });
        return;
      }
      res.status(502).json({ error: 'AI Tutor provider request failed. Check the server API key and retry.' });
      return;
    }

    const payload = await providerResponse.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!content) {
      res.status(502).json({ error: 'AI Tutor provider returned no response.' });
      return;
    }

    const parsedResponse = tutorResponseSchema.safeParse(JSON.parse(content));
    if (!parsedResponse.success) {
      res.status(502).json({ error: 'AI Tutor provider returned an invalid response.' });
      return;
    }
    res.status(200).json(parsedResponse.data);
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'AI Tutor timed out. Retry the request.' : 'AI Tutor is temporarily unavailable. Retry the request.',
    });
  }
}

export const config = { api: { bodyParser: true } };
