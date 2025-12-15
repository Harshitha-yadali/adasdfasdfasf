// src/services/edenResumeParserService.ts
// Resume Parser - Routes through Cloudflare Worker for secure API key handling
// Step 1: Extract text using Mistral OCR (via worker)
// Step 2: Parse extracted text with Chat API (via worker)

import {
  ResumeData,
  Education,
  WorkExperience,
  Project,
  Skill,
  Certification,
} from '../types/resume';
import { callCloudflareAI } from '../utils/cloudflareApi';

// Use Cloudflare Worker for OCR (same worker that handles AI chat)
const WORKER_URL = 'https://damp-haze-85c6.harshithayadali30.workers.dev';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ParsedResume extends ResumeData {
  parsedText: string;
  parsingConfidence?: number;
  rawEdenResponse?: any;
}

/**
 * Convert file to base64 for sending to worker
 */
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

/**
 * Main function: Parse resume using Mistral OCR + openai/gpt-4o-mini via Worker
 */
export const parseResumeFromFile = async (file: File): Promise<ParsedResume> => {
  let extractedText = '';

  try {
    // For text-based files, read directly
    if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      extractedText = await file.text();
    } else {
      // Use Mistral OCR via worker for PDF/DOCX
      try {
        extractedText = await extractTextWithMistralOCR(file);
      } catch (ocrError: any) {
        // Fallback: Try reading as text (for text-based PDFs)
        try {
          const textContent = await file.text();
          const readableChars = textContent.substring(0, 2000).replace(/[\x00-\x08\x0E-\x1F\x7F-\xFF]/g, '');
          if (readableChars.length > 200) {
            extractedText = textContent
              .replace(/[\x00-\x08\x0E-\x1F]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
          } else {
            throw new Error('File content is not readable text');
          }
        } catch (textError) {
          throw new Error(`OCR extraction failed. Please try a different file format (PDF, DOCX, or TXT).`);
        }
      }
    }
    
    if (!extractedText || extractedText.length < 50) {
      throw new Error('Could not extract enough text from file. Please ensure the file contains readable text.');
    }

    // Step 2: Parse text with Chat API via worker
    const parsedData = await parseTextWithChatAPI(extractedText);
    
    // Validate we got real data
    if (parsedData.name === 'John Doe' || parsedData.email === 'johndoe@example.com') {
      console.warn('⚠️ Got placeholder data');
      throw new Error('Placeholder data received');
    }
    
    return parsedData;
  } catch (error: any) {
    console.error('❌ PARSING FAILED:', error.message);
    throw new Error(`Failed to parse resume: ${error.message}`);
  }
};

/**
 * Extract text using Mistral OCR via Cloudflare Worker
 */
const extractTextWithMistralOCR = async (file: File, retryCount = 0): Promise<string> => {
  const MAX_RETRIES = 2;

  try {
    const base64File = await fileToBase64(file);

    // Call Cloudflare Worker OCR endpoint
    const response = await fetch(`${WORKER_URL}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: base64File,
        fileName: file.name,
        fileType: file.type,
        provider: 'mistral' // Use Mistral OCR
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Worker OCR Error:', response.status, errorData);

      if (response.status === 401 || response.status === 403) {
        throw new Error('EdenAI API authentication failed. Please check your API key configuration.');
      }
      if (response.status === 429) {
        throw new Error('EdenAI API rate limit exceeded. Please try again later.');
      }

      if (retryCount < MAX_RETRIES) {
        await delay(2000);
        return extractTextWithMistralOCR(file, retryCount + 1);
      }
      throw new Error(`OCR API failed: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'OCR failed');
    }

    // If async job, poll for results
    if (result.jobId) {
      return await pollAsyncOCRResult(result.jobId);
    }

    // Direct text result
    if (result.text) {
      return result.text;
    }

    throw new Error('No text extracted from OCR');
  } catch (error: any) {
    console.error('Mistral OCR Error:', error.message);
    if (retryCount < MAX_RETRIES) {
      await delay(2000);
      return extractTextWithMistralOCR(file, retryCount + 1);
    }
    throw error;
  }
};

/**
 * Poll for async OCR job results via worker
 */
const pollAsyncOCRResult = async (jobId: string, maxAttempts = 30): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Call Cloudflare Worker GET endpoint to poll job status
      const response = await fetch(`${WORKER_URL}/ocr/${jobId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        await delay(2000);
        continue;
      }

      const result = await response.json();

      if (result.status === 'finished' && result.text) {
        return result.text;
      }

      if (result.status === 'failed') {
        throw new Error(result.error || 'OCR job failed');
      }

      // Job still processing
      await delay(2000);
    } catch (error: any) {
      await delay(2000);
    }
  }

  throw new Error('OCR job timed out');
};

/**
 * Parse text with Chat API via Cloudflare Worker
 */
const parseTextWithChatAPI = async (text: string): Promise<ParsedResume> => {
  const prompt = `Parse this resume and extract ALL information. Return ONLY valid JSON.

RESUME TEXT:
"""
${text.slice(0, 12000)}
"""

Return JSON with this exact structure:
{
  "name": "Full name from resume",
  "phone": "Phone number",
  "email": "Email address",
  "linkedin": "LinkedIn URL",
  "github": "GitHub URL",
  "location": "City, State",
  "summary": "Professional summary or objective",
  "education": [{"degree": "Degree name", "school": "School name", "year": "Year", "cgpa": "GPA if mentioned", "location": "Location"}],
  "workExperience": [{"role": "Job title", "company": "Company name", "year": "Date range", "bullets": ["Achievement 1", "Achievement 2"]}],
  "projects": [{"title": "Project name", "bullets": ["Description 1", "Description 2"], "githubUrl": "URL if any"}],
  "skills": [{"category": "Category name", "list": ["Skill1", "Skill2"]}],
  "certifications": [{"title": "Cert name", "description": "Details"}]
}

IMPORTANT: Extract ACTUAL data from the resume text. Do NOT use placeholder values like "John Doe".`;

  try {
    const content = await callCloudflareAI(prompt);
    
    if (!content) {
      throw new Error('Empty response from Chat API');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return mapToResume(parsed, text, {});
  } catch (error: any) {
    console.error('Chat API parsing error:', error);
    throw error;
  }
};

/**
 * Map parsed JSON to our resume format
 */
const mapToResume = (parsed: any, rawText: string, rawResult: any): ParsedResume => {
  const education: Education[] = (parsed.education || []).map((e: any) => ({
    degree: e.degree || '',
    school: e.school || '',
    year: e.year || '',
    cgpa: e.cgpa || '',
    location: e.location || '',
  }));

  const workExperience: WorkExperience[] = (parsed.workExperience || []).map((w: any) => ({
    role: w.role || '',
    company: w.company || '',
    year: w.year || '',
    bullets: Array.isArray(w.bullets) ? w.bullets : [],
  }));

  const projects: Project[] = (parsed.projects || []).map((p: any) => ({
    title: p.title || '',
    bullets: Array.isArray(p.bullets) ? p.bullets : [],
    githubUrl: p.githubUrl || '',
  }));

  const skills: Skill[] = (parsed.skills || []).map((s: any) => {
    if (typeof s === 'string') return { category: 'Skills', count: 1, list: [s] };
    const list = Array.isArray(s.list) ? s.list : [];
    return { category: s.category || 'Skills', count: list.length, list };
  });

  const certifications: Certification[] = (parsed.certifications || []).map((c: any) => ({
    title: c.title || '',
    description: c.description || '',
  }));

  return {
    name: parsed.name || '',
    phone: parsed.phone || '',
    email: parsed.email || '',
    linkedin: parsed.linkedin || '',
    github: parsed.github || '',
    location: parsed.location || '',
    summary: parsed.summary || '',
    careerObjective: parsed.summary || '',
    education,
    workExperience,
    projects,
    skills,
    certifications,
    parsedText: rawText,
    parsingConfidence: 0.95,
    rawEdenResponse: rawResult,
    origin: 'eden_parsed',
  };
};

export const parseResumeFromUrl = async (_: string): Promise<ParsedResume> => {
  throw new Error('URL parsing not supported');
};

export const edenResumeParserService = { parseResumeFromFile, parseResumeFromUrl };
export default edenResumeParserService;