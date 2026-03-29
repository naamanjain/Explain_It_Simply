const https = require('https');

async function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${responseData}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function buildPrompt(input, isCode, lang, fileName) {
  const subject = isCode
    ? `the following ${lang || 'code'}${fileName ? ` from file "${fileName}"` : ''}:\n\`\`\`${lang || ''}\n${input}\n\`\`\``
    : `the following topic or question: "${input}"`;

  return `You are "Explain It Simply" — an AI assistant that explains things at two levels.

Explain ${subject}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "title": "short descriptive title (max 8 words)",
  "eli5": {
    "heading": "Explain Like I'm 5",
    "content": "Simple, friendly explanation using everyday analogies. No jargon. 3-5 sentences max. Make it fun and accessible."
  },
  "technical": {
    "heading": "Technical Breakdown",
    "content": "Detailed technical explanation with proper terminology. Cover how it works, key concepts, and important details. Use bullet points where helpful (use \\n• for bullets)."
  },
  "keyTakeaway": "One crisp sentence summarizing the most important thing to understand."
}`;
}

async function callOpenAI(apiKey, model, prompt) {
  const res = await httpPost('api.openai.com', '/v1/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500,
  });

  if (res.status !== 200) {
    throw new Error(`OpenAI API error ${res.status}: ${res.data.error?.message || JSON.stringify(res.data)}`);
  }
  return res.data.choices[0].message.content;
}

async function callAnthropic(apiKey, model, prompt) {
  const res = await httpPost('api.anthropic.com', '/v1/messages', {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }, {
    model,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  if (res.status !== 200) {
    throw new Error(`Anthropic API error ${res.status}: ${res.data.error?.message || JSON.stringify(res.data)}`);
  }
  return res.data.content[0].text;
}

async function callGoogle(apiKey, model, prompt) {
  const res = await httpPost('generativelanguage.googleapis.com',
    `/v1beta/models/${model}:generateContent?key=${apiKey}`, {}, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
  });

  if (res.status !== 200) {
    throw new Error(`Google API error ${res.status}: ${res.data.error?.message || JSON.stringify(res.data)}`);
  }
  return res.data.candidates[0].content.parts[0].text;
}

async function callGroq(apiKey, model, prompt) {
  const res = await httpPost('api.groq.com', '/openai/v1/chat/completions', {
    'Authorization': `Bearer ${apiKey}`,
  }, {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1500,
  });

  if (res.status !== 200) {
    throw new Error(`Groq API error ${res.status}: ${res.data.error?.message || JSON.stringify(res.data)}`);
  }
  return res.data.choices[0].message.content;
}

async function getExplanation(settings, input, isCode = false, lang = '', fileName = '') {
  const { apiKey, provider, model } = settings;
  const prompt = buildPrompt(input, isCode, lang, fileName);

  let rawText;
  switch (provider) {
    case 'openai': rawText = await callOpenAI(apiKey, model, prompt); break;
    case 'anthropic': rawText = await callAnthropic(apiKey, model, prompt); break;
    case 'google': rawText = await callGoogle(apiKey, model, prompt); break;
    case 'groq': rawText = await callGroq(apiKey, model, prompt); break;
    default: throw new Error(`Unknown provider: ${provider}`);
  }

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Failed to parse AI response as JSON. Raw: ${rawText.substring(0, 200)}`);
  }
}

module.exports = { getExplanation };
