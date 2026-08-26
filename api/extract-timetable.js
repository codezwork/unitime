import fs from 'fs';
import path from 'path';

function getApiKey() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  // Local fallback: read from .env.local or .env if running locally without injected process.env
  try {
    const candidates = ['.env.local', '.env', '.env.development.local'];
    for (const file of candidates) {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/^GEMINI_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    }
  } catch (err) {
    console.warn('Could not read local env file:', err.message);
  }
  return null;
}

export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY environment variable is not configured.' });
  }

  const { image } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid image in request body.' });
  }

  try {
    // 2. Parse MIME type and clean base64 data
    let mimeType = 'image/jpeg';
    let base64Data = image;

    if (image.includes(',')) {
      const parts = image.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) {
        mimeType = match[1];
      }
      base64Data = parts[1];
    }

    // 3. Prepare prompt and payload for Gemini REST API
    const systemPrompt = `You are a data extractor for IIT Madras semester course tables and registration cards.
Extract all enrolled or registered courses from the provided timetable/course screenshot.

For each course, extract:
- "code": The slot letter. Valid slots are standard lecture slots (A, B, C, D, E, F, G), lab slots (P, Q, R, S, T), or split slots (H, M, J, K, L). Use uppercase single letter.
- "courseCode": Course ID/code (e.g. CS1100, MA1101, EE2001, PH1010). Use uppercase without spaces.
- "name": Clean full course title (e.g. "Computational Engineering", "Differential Equations").

Return ONLY a raw, stringified JSON array of course objects. Do not include markdown code block formatting or backticks.
Schema:
[
  { "code": "A", "courseCode": "CS1100", "name": "Computational Engineering" }
]`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1
        }
      })
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text();
      console.error('Gemini API Error:', errorData);
      return res.status(geminiResponse.status).json({
        error: 'Failed to process image with Gemini AI',
        details: errorData
      });
    }

    const data = await geminiResponse.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return res.status(500).json({ error: 'No content received from Gemini model.' });
    }

    // 4. Clean potential markdown formatting just in case and parse JSON
    const cleanedText = candidateText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsedCourses = JSON.parse(cleanedText);

    if (!Array.isArray(parsedCourses)) {
      return res.status(500).json({ error: 'Invalid response format from Gemini model. Expected an array.' });
    }

    // 5. Sanitize and validate courses
    const validSlots = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'P', 'Q', 'R', 'S', 'T', 'H', 'M', 'J', 'K', 'L']);
    const sanitizedCourses = parsedCourses.map(course => {
      let code = (course.code || '').toString().trim().toUpperCase();
      if (!validSlots.has(code)) {
        // If slot extracted contains extra chars like "Slot A", find valid slot
        const slotMatch = code.match(/[A-G|P-T|H|M|J|K|L]/);
        code = slotMatch ? slotMatch[0] : code;
      }
      return {
        code: code,
        courseCode: (course.courseCode || course.codeId || '').toString().trim().toUpperCase(),
        name: (course.name || course.title || '').toString().trim()
      };
    }).filter(c => c.courseCode || c.code);

    return res.status(200).json(sanitizedCourses);

  } catch (error) {
    console.error('Server error in extract-timetable:', error);
    return res.status(500).json({
      error: 'An error occurred while processing the timetable image.',
      message: error.message
    });
  }
}
