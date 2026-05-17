import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

dotenv.config();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";
const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "";
const GEMINI_FALLBACK_MODELS = ["gemini-1.5-flash-latest", "gemini-1.5-flash", "gemini-1.5-pro"];
const MAX_STORED_DOCUMENT_CHARS = 180000;
const LIGHT_PROMPT_DOCUMENT_CHARS = 18000;
const DETAILED_PROMPT_DOCUMENT_CHARS = 52000;
const MIN_CHUNK_CHARS = 1800;
const MAX_CHUNK_CHARS = 2600;
const CHUNK_OVERLAP_CHARS = 180;
const STANDARD_DOCUMENT_CHARS = 26000;
const LARGE_DOCUMENT_CHARS = 36000;
const LARGE_DOCUMENT_CHUNKS = 10;
const DOCUMENT_TTL_MS = 1000 * 60 * 60 * 4;
const documents = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NOISE_LINE_PATTERNS = [
  /^\s*\d+\s*$/,
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
  /^\s*copyright\b.*$/i,
  /^\s*all rights reserved\.?\s*$/i,
  /^\s*(?:www\.|https?:\/\/).+$/i,
  /^\s*(?:printed in|confidential|proprietary)\b.*$/i,
  /^\s*cisco\b.*(?:networking academy|systems|confidential|public|all rights reserved).*$/i
];

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain"
    ]);
    if (allowed.has(file.mimetype)) cb(null, true);
    else cb(new Error("Unsupported file type. Upload PDF, DOCX, or TXT."));
  }
});

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const clamp = (value = "", max = MAX_STORED_DOCUMENT_CHARS) => {
  const text = String(value).replace(/\u0000/g, "").trim();
  return text.length > max ? `${text.slice(0, max)}\n\n[Document truncated for length.]` : text;
};

async function extractText(file) {
  if (!file) return { text: "", status: "No file uploaded" };

  if (file.mimetype === "text/plain") {
    const cleaned = cleanExtractedText(file.buffer.toString("utf8"));
    return { text: clamp(cleaned.text), status: "TXT text extracted", pageCount: 1 };
  }

  if (file.mimetype === "application/pdf") {
    const parsed = await pdfParse(file.buffer);
    const cleaned = cleanExtractedText(parsed.text);
    return {
      text: clamp(cleaned.text),
      status: `PDF text extracted from ${parsed.numpages || "the"} page(s)`,
      pageCount: parsed.numpages || 0
    };
  }

  if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    const cleaned = cleanExtractedText(parsed.value);
    return { text: clamp(cleaned.text), status: "DOCX text extracted", pageCount: 1 };
  }

  throw new Error("Unsupported file type. Upload PDF, DOCX, or TXT.");
}

function buildSystemPrompt({ user = {}, tasks = [], notes = [] }) {
  const pending = tasks.filter((task) => !task.isCompleted).length;
  return [
    "You are Masari Buddy, an expert academic tutor inside Masari.",
    `Student: ${user.name || "Student"} (${user.level || "student"}).`,
    `Current context: ${tasks.length} tasks, ${pending} pending tasks, ${notes.length} notes.`,
    "Use only the uploaded file content when a document is available. Produce exam-focused, accurate, structured study material.",
    "Help with productivity, studying, summaries, explanations, MCQs, key points, flashcards, and study plans.",
    "When the student asks for MCQs or quiz questions and does not specify a count, generate exactly 10 questions with answers.",
    "When document content is provided, use it directly and complete the requested task immediately. Do not say you can summarize, explain, or generate questions later.",
    "Keep answers clear, warm, structured, and useful. Avoid pretending you can see files unless document text is provided.",
    "Prefer concise but complete answers in light mode. In detailed mode, provide fuller section-by-section coverage.",
    "If the user writes in Arabic, respond in clean Egyptian Arabic while preserving important academic, technical, and networking terms in English."
  ].filter(Boolean).join("\n\n");
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeNoiseLine(line) {
  return String(line || "")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}\s#]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line, counts) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;
  const normalized = normalizeNoiseLine(trimmed);
  if (!normalized) return true;
  const repeated = counts.get(normalized) || 0;
  return trimmed.length <= 90 && repeated >= 3;
}

function cleanExtractedText(text) {
  const rawLines = String(text || "").replace(/\r/g, "").split("\n");
  const counts = new Map();

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.length > 120) continue;
    const normalized = normalizeNoiseLine(trimmed);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  const keptLines = [];
  let previousMeaningful = "";
  for (const rawLine of rawLines) {
    const compact = rawLine.replace(/\s+/g, " ").trim();
    if (!compact) {
      keptLines.push("");
      continue;
    }
    if (isNoiseLine(compact, counts)) continue;
    if (compact === previousMeaningful) continue;
    keptLines.push(compact);
    previousMeaningful = compact;
  }

  const textBody = keptLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { text: textBody };
}

function cleanupDocuments() {
  const cutoff = Date.now() - DOCUMENT_TTL_MS;
  for (const [id, doc] of documents.entries()) {
    if (doc.createdAt < cutoff) documents.delete(id);
  }
}

function createDocumentRecord({ id = uid(), file, text, status, pageCount = 0 }) {
  const chunks = semanticChunkText(text);
  return {
    id,
    name: file.originalname,
    mimeType: file.mimetype,
    text,
    status,
    pageCount,
    chunks,
    artifacts: {},
    createdAt: Date.now()
  };
}

function keywords(value) {
  return String(value).toLowerCase().match(/[a-z0-9]{4,}/g) || [];
}

function normalizeParagraphs(text) {
  return String(text)
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").trim())
    .filter(Boolean);
}

function splitLargeParagraph(paragraph, maxSize = MAX_CHUNK_CHARS) {
  if (paragraph.length <= maxSize) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    const slices = [];
    for (let start = 0; start < paragraph.length; start += maxSize) {
      slices.push(paragraph.slice(start, start + maxSize));
    }
    return slices;
  }
  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxSize && current) {
      parts.push(current.trim());
      current = sentence;
    } else if (sentence.length > maxSize) {
      if (current) parts.push(current.trim());
      parts.push(...splitLargeParagraph(sentence, maxSize));
      current = "";
    } else {
      current = next;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function inferChunkTitle(paragraphs, index) {
  const heading = paragraphs.find((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    return paragraph.length <= 90 && words.length <= 12 && !/[.!?]$/.test(paragraph);
  });
  if (heading) return heading.slice(0, 80);
  const first = paragraphs[0] || `Section ${index}`;
  return first.slice(0, 80);
}

function buildChunkRecord(paragraphs, index) {
  const text = paragraphs.join("\n\n");
  const lower = text.toLowerCase();
  return {
    index,
    title: inferChunkTitle(paragraphs, index),
    text,
    chars: text.length,
    keywords: [...new Set(keywords(text))].slice(0, 14),
    definitionHits: (lower.match(/\b(is|defined as|refers to|means|definition|term)\b/g) || []).length,
    formulaHits: (lower.match(/[=+\-*/^]/g) || []).length,
    technicalHits: (lower.match(/\b(method|algorithm|equation|proof|theorem|analysis|structure|process|system|concept|command|comparison|table|protocol|rule|step|example)\b/g) || []).length,
    noiseHits: (lower.match(/\b(copyright|all rights reserved|page \d+|networking academy|confidential|proprietary)\b/g) || []).length
  };
}

function applyChunkOverlap(chunks, overlapChars = CHUNK_OVERLAP_CHARS) {
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const previous = chunks[index - 1];
    const overlap = previous.text.slice(-overlapChars).trim();
    if (!overlap) return chunk;
    const text = `${overlap}\n\n${chunk.text}`;
    return {
      ...chunk,
      text,
      chars: text.length
    };
  });
}

function semanticChunkText(text, options = {}) {
  const minSize = options.minSize || MIN_CHUNK_CHARS;
  const maxSize = options.maxSize || MAX_CHUNK_CHARS;
  const paragraphs = normalizeParagraphs(text).flatMap((paragraph) => splitLargeParagraph(paragraph, maxSize));
  const chunks = [];
  let current = [];
  let currentSize = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push(buildChunkRecord(current, chunks.length + 1));
    current = [];
    currentSize = 0;
  };

  for (const paragraph of paragraphs) {
    const paragraphSize = paragraph.length + (current.length ? 2 : 0);
    const looksLikeHeading = paragraph.length <= 90 && paragraph.split(/\s+/).length <= 12 && !/[.!?]$/.test(paragraph);
    if (looksLikeHeading && currentSize >= minSize) flush();
    if (currentSize >= minSize && currentSize + paragraphSize > maxSize) flush();
    current.push(paragraph);
    currentSize += paragraphSize;
    if (currentSize >= maxSize) flush();
  }
  flush();
  return applyChunkOverlap(chunks);
}

function chunkText(text) {
  return semanticChunkText(text);
}

function detectDocumentTask(message) {
  const text = message.toLowerCase();
  if (/flashcard|flash card|cards/.test(text)) return "flashcards";
  if (/mcq|multiple choice|quiz|questions?/.test(text)) return "mcq";
  if (/hard|difficult|confusing|explain/.test(text)) return "hard";
  if (/study plan|schedule|plan/.test(text)) return "study-plan";
  if (/key points?|takeaways?|extract/.test(text)) return "key-points";
  if (/summar|overview/.test(text)) return "summary";
  return "general";
}

function containsArabic(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function normalizeSummaryMode(value) {
  return value === "short" ? "short" : "detailed";
}

function normalizeQualityMode(value) {
  const mode = String(value || "").toLowerCase();
  if (["fast", "study", "deep"].includes(mode)) return mode;
  return "study";
}

function normalizeQuizDifficulty(value) {
  const lower = String(value || "").toLowerCase();
  if (["easy", "medium", "hard", "mixed"].includes(lower)) return lower;
  return "mixed";
}

function normalizeQuizCount(value) {
  const count = Number(value);
  if ([5, 10, 15, 20].includes(count)) return count;
  return 10;
}

function resolveProcessingMode({ document, qualityMode = "study" }) {
  if (qualityMode === "deep") return "detailed";
  if (qualityMode === "fast") return (document?.text?.length || 0) > STANDARD_DOCUMENT_CHARS ? "light" : "standard";
  if ((document?.text?.length || 0) > LARGE_DOCUMENT_CHARS || (document?.chunks?.length || 0) > LARGE_DOCUMENT_CHUNKS) return "light";
  return "standard";
}

function selectRelevantChunks(document, query, options = {}) {
  const chunks = Array.isArray(document?.chunks) && document.chunks.length ? document.chunks : semanticChunkText(document?.text || "");
  const mode = options.processingMode || "standard";
  const limitChars = options.limitChars || (mode === "detailed" ? DETAILED_PROMPT_DOCUMENT_CHARS : mode === "light" ? LIGHT_PROMPT_DOCUMENT_CHARS : STANDARD_DOCUMENT_CHARS);
  const maxChunks = options.maxChunks || (mode === "detailed" ? 8 : mode === "light" ? 4 : 6);
  const task = options.task || detectDocumentTask(query);
  const queryWords = new Set(keywords(query));
  const scored = chunks.map((chunk, chunkIndex) => {
    const lower = chunk.text.toLowerCase();
    let score = chunkIndex < 2 ? 2 - chunkIndex : 0;
    for (const word of queryWords) {
      if (lower.includes(word)) score += 3;
      if (chunk.keywords?.includes(word)) score += 2;
    }
    if (task === "flashcards") score += chunk.definitionHits * 2 + Math.min(chunk.formulaHits, 3);
    if (task === "mcq") score += chunk.technicalHits * 1.4 + chunk.definitionHits * 1.2 + Math.min(chunk.formulaHits, 2);
    if (task === "hard") score += chunk.technicalHits * 2 + Math.min(chunk.formulaHits, 4);
    if (task === "study-plan" || task === "key-points") score += chunk.definitionHits + chunk.technicalHits;
    if (/definition|formula|example|rule|theorem|summary|objective|command|comparison|table|troubleshoot|verify|configuration|output|step/.test(lower)) score += 1.2;
    if (task === "mcq" && /\b(compare|difference|versus|vs\.?|whereas|unlike|scenario|troubleshoot|verify|misconfig|command|output|configure)\b/.test(lower)) score += 2.4;
    if (task === "summary" && /\b(rule|process|workflow|step|warning|common mistake|best practice)\b/.test(lower)) score += 1.8;
    score -= (chunk.noiseHits || 0) * 5;
    return { ...chunk, score };
  });

  const selected = scored
    .filter((chunk) => (chunk.noiseHits || 0) < 3 || chunk.technicalHits > 1 || chunk.definitionHits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunks * 2)
    .sort((a, b) => a.index - b.index);

  let total = 0;
  return selected.filter((chunk) => {
    total += chunk.text.length;
    return total <= limitChars;
  }).slice(0, maxChunks);
}

function taskInstruction(task, options = {}) {
  const summaryMode = normalizeSummaryMode(options.summaryMode);
  const quizDifficulty = normalizeQuizDifficulty(options.quizDifficulty);
  const quizCount = normalizeQuizCount(options.quizCount);
  const instructions = {
    summary: `Produce a ${summaryMode === "short" ? "compact but still exam-useful" : "deep, detailed, and exam-focused"} study summary grounded only in the uploaded file. Organize it into: 1) What this lecture/file is about 2) Main topics covered 3) Key definitions 4) Important rules and concepts 5) Important comparisons 6) Commands, examples, or formulas if present 7) Step-by-step processes 8) Common mistakes 9) Exam-focused notes 10) Likely exam questions 11) Final revision checklist. Use the full cleaned document content, not just the first section.`,
    mcq: `Generate exactly ${quizCount} ${quizDifficulty === "mixed" ? "mixed medium-to-hard" : quizDifficulty} real exam-style MCQs based only on the uploaded file. Cover different parts of the file, not just one section. Mix concept reasoning, scenario-based, comparison, command/configuration, and troubleshooting questions when the source supports them. Every question must include four plausible choices on the same topic, a source topic, difficulty, the correct answer, an explanation, and brief notes on why the wrong answers are wrong. Never use filler or generic distractors.`,
    flashcards: "Generate exactly 15 high-value revision flashcards based on the document. Focus on definitions, rules, commands, differences, steps, and exam traps. Each flashcard must include a concise front, a clear back explanation, and 1-3 short tags.",
    hard: "Identify the difficult concepts in the document, explain each in simple student-friendly language, and add concrete examples.",
    "study-plan": "Create a practical study plan based on the document topics. Include priorities, sessions, review checkpoints, and practice tasks.",
    "key-points": "Extract the most important key points from the document. Group them by topic and include definitions, formulas, examples, and warnings where relevant.",
    general: "Answer using the document content. If the request is broad, give a useful structured response grounded in the file."
  };
  return `${instructions[task] || instructions.general} For long documents, synthesize the provided chunks internally first, then produce one final complete answer. Never ignore the document content.`;
}

function extractJson(value) {
  const text = String(value || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}

function formatChunksForPrompt(chunks) {
  return chunks
    .map((chunk) => `Chunk ${chunk.index}: ${chunk.title}\n${chunk.text}`)
    .join("\n\n");
}

function groupChunksForProcessing(chunks, maxGroups = 6) {
  if (!chunks.length) return [];
  const groupCount = Math.min(maxGroups, Math.max(1, Math.ceil(chunks.length / 2)));
  const perGroup = Math.ceil(chunks.length / groupCount);
  const groups = [];
  for (let index = 0; index < chunks.length; index += perGroup) {
    groups.push(chunks.slice(index, index + perGroup));
  }
  return groups;
}

function getDocumentStudyMap(document) {
  if (document?.artifacts?.studyMap) return document.artifacts.studyMap;
  const chunks = Array.isArray(document?.chunks) ? document.chunks : [];
  const sectionTitles = chunks.slice(0, 12).map((chunk) => cleanTopicLabel(chunk.title, `Section ${chunk.index}`));
  const definitions = dedupeByText(chunks.flatMap((chunk) => localDefinitions(chunk.text, 1).map((text) => ({
    topic: cleanTopicLabel(chunk.title, "Definition"),
    text
  }))), (item) => `${item.topic}:${item.text}`).slice(0, 8);
  const comparisons = dedupeByText(chunks.flatMap((chunk) => normalizeParagraphs(chunk.text)
    .filter((paragraph) => /\b(vs\.?|versus|compare|difference|unlike|whereas)\b/i.test(paragraph))
    .slice(0, 1)
    .map((text) => ({ topic: cleanTopicLabel(chunk.title, "Comparison"), text: text.slice(0, 180) }))), (item) => item.text).slice(0, 6);
  const commands = dedupeByText(chunks.flatMap((chunk) => normalizeParagraphs(chunk.text)
    .filter((paragraph) => /\b(show|configure|enable|disable|ip|router|switch|command|verify|troubleshoot)\b/i.test(paragraph))
    .slice(0, 1)
    .map((text) => ({ topic: cleanTopicLabel(chunk.title, "Command"), text: text.slice(0, 180) }))), (item) => item.text).slice(0, 6);
  const traps = dedupeByText(chunks.flatMap((chunk) => normalizeParagraphs(chunk.text)
    .filter((paragraph) => /\b(avoid|mistake|incorrect|warning|common|trap)\b/i.test(paragraph))
    .slice(0, 1)
    .map((text) => ({ topic: cleanTopicLabel(chunk.title, "Trap"), text: text.slice(0, 180) }))), (item) => item.text).slice(0, 6);
  const map = { sectionTitles, definitions, comparisons, commands, traps };
  document.artifacts = { ...(document.artifacts || {}), studyMap: map };
  return map;
}

function dedupeByText(items, pickText) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(pickText(item) || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitChunkForFallback(chunk) {
  const midpoint = Math.ceil(chunk.text.length / 2);
  const left = chunk.text.slice(0, midpoint).trim();
  const right = chunk.text.slice(Math.max(0, midpoint - CHUNK_OVERLAP_CHARS), chunk.text.length).trim();
  return [left, right]
    .filter(Boolean)
    .map((text, index) => ({
      ...chunk,
      index: `${chunk.index}.${index + 1}`,
      title: `${chunk.title} ${index + 1}`,
      text,
      chars: text.length
    }));
}

function localDefinitions(text, limit = 3) {
  return normalizeParagraphs(text)
    .filter((paragraph) => /\b(is|defined as|refers to|means|definition|term)\b/i.test(paragraph))
    .slice(0, limit)
    .map((paragraph) => paragraph.slice(0, 180));
}

function localExamples(text, limit = 2) {
  return normalizeParagraphs(text)
    .filter((paragraph) => /\b(example|for instance|for example|such as)\b/i.test(paragraph))
    .slice(0, limit)
    .map((paragraph) => paragraph.slice(0, 180));
}

function localKeyPoints(text, limit = 4) {
  return normalizeParagraphs(text)
    .slice(0, limit)
    .map((paragraph) => paragraph.slice(0, 180));
}

function cleanTopicLabel(value, fallback = "Review this concept") {
  const text = String(value || "")
    .replace(/\b(page\s+\d+(\s+of\s+\d+)?)\b/gi, " ")
    .replace(/\bcopyright\b.*$/gi, " ")
    .replace(/\bcisco\b.*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length >= 3 ? text.slice(0, 90) : fallback;
}

function localChunkSummary(chunk) {
  return {
    chunkIndex: chunk.index,
    title: chunk.title,
    summary: normalizeParagraphs(chunk.text).slice(0, 2).join(" ").slice(0, 320),
    definitions: localDefinitions(chunk.text),
    formulas: /\d|=|\+|-|\/|\*/.test(chunk.text) ? [chunk.text.slice(0, 120)] : [],
    examples: localExamples(chunk.text),
    keyPoints: localKeyPoints(chunk.text),
    comparisons: normalizeParagraphs(chunk.text).filter((paragraph) => /\b(vs\.?|versus|compare|difference|unlike|whereas)\b/i.test(paragraph)).slice(0, 2),
    commands: normalizeParagraphs(chunk.text).filter((paragraph) => /\b(show|configure|enable|disable|ip|router|switch|command)\b/i.test(paragraph)).slice(0, 2),
    steps: normalizeParagraphs(chunk.text).filter((paragraph) => /\b(first|second|third|then|next|finally|step|procedure|process)\b/i.test(paragraph)).slice(0, 3),
    mistakes: normalizeParagraphs(chunk.text).filter((paragraph) => /\b(avoid|mistake|incorrect|warning|common)\b/i.test(paragraph)).slice(0, 2),
    examQuestions: [`Explain the main idea behind ${chunk.title}.`]
  };
}

function buildLocalSummaryReply(document, chunkSummaries) {
  const topics = chunkSummaries.map((item) => `- ${item.title}: ${item.summary}`).join("\n");
  const definitions = dedupeByText(chunkSummaries.flatMap((item) => item.definitions || []), (item) => item)
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join("\n");
  const keyPoints = dedupeByText(chunkSummaries.flatMap((item) => item.keyPoints || []), (item) => item)
    .slice(0, 10)
    .map((item) => `- ${item}`)
    .join("\n");
  const examples = dedupeByText(chunkSummaries.flatMap((item) => item.examples || []), (item) => item)
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join("\n");
  const comparisons = dedupeByText(chunkSummaries.flatMap((item) => item.comparisons || []), (item) => item)
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join("\n");
  const commands = dedupeByText(chunkSummaries.flatMap((item) => item.commands || []), (item) => item)
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join("\n");
  const steps = dedupeByText(chunkSummaries.flatMap((item) => item.steps || []), (item) => item)
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join("\n");
  const mistakes = dedupeByText(chunkSummaries.flatMap((item) => item.mistakes || []), (item) => item)
    .slice(0, 6)
    .map((item) => `- ${item}`)
    .join("\n");
  const questions = chunkSummaries.slice(0, 6).map((item) => `- ${item.examQuestions?.[0] || `What should you remember about ${item.title}?`}`).join("\n");
  const overview = chunkSummaries.slice(0, 3).map((item) => `- ${item.summary}`).join("\n") || "- No clear overview was extracted.";
  const revisionChecklist = dedupeByText([
    ...chunkSummaries.flatMap((item) => item.keyPoints || []).slice(0, 6),
    ...chunkSummaries.flatMap((item) => item.mistakes || []).slice(0, 4)
  ], (item) => item).map((item) => `- ${item}`).join("\n");

  return [
    `Structured summary for ${document.name}`,
    "",
    "What this lecture/file is about",
    overview,
    "",
    "Main topics covered",
    topics || "- No clear topics were extracted.",
    "",
    "Important definitions",
    definitions || "- No formal definitions were detected.",
    "",
    "Important rules and concepts",
    keyPoints || "- No important rules or concepts were extracted.",
    "",
    "Important comparisons",
    comparisons || "- No strong comparisons were detected.",
    "",
    "Commands, examples, or formulas",
    commands || examples || "- No explicit commands, examples, or formulas were detected.",
    "",
    "Step-by-step processes",
    steps || "- No step-by-step process was clearly detected.",
    "",
    "Common mistakes",
    mistakes || "- No common mistakes were detected.",
    "",
    "Exam-focused notes",
    keyPoints || "- No exam-focused points were extracted.",
    "",
    "Likely exam questions",
    questions,
    "",
    "Final revision checklist",
    revisionChecklist || "- Review the key concepts, examples, and common mistakes from the lecture."
  ].join("\n");
}

function buildLocalQuizQuestions(sourceChunks, count = 10, difficulty = "mixed") {
  const facts = [];
  for (const chunk of sourceChunks) {
    const topic = cleanTopicLabel(chunk.title, "Document concept");
    const paragraphs = normalizeParagraphs(chunk.text)
      .filter((paragraph) => paragraph.length >= 40)
      .slice(0, 5);
    for (const paragraph of paragraphs) {
      facts.push({
        topic,
        statement: paragraph.slice(0, 180),
        cue: paragraph.split(/[.?!:]/)[0].slice(0, 90),
        kind: /\b(show|configure|command|output)\b/i.test(paragraph)
          ? "command/output"
          : /\b(compare|difference|versus|whereas|unlike|vs)\b/i.test(paragraph)
            ? "comparison"
            : /\b(if|when|suppose|scenario|case)\b/i.test(paragraph)
              ? "scenario"
              : "reasoning"
      });
    }
  }

  const uniqueFacts = dedupeByText(facts, (item) => `${item.topic}:${item.statement}`);
  const questions = [];

  for (const fact of uniqueFacts) {
    const distractors = uniqueFacts
      .filter((candidate) => candidate.statement !== fact.statement && candidate.kind === fact.kind)
      .slice(0, 2)
      .concat(uniqueFacts.filter((candidate) => candidate.topic !== fact.topic && candidate.statement !== fact.statement && candidate.kind !== fact.kind).slice(0, 2))
      .slice(0, 3)
      .map((candidate) => candidate.statement);
    if (distractors.length < 3) continue;

    questions.push({
      topic: fact.topic,
      sourceTopic: fact.topic,
      difficulty: difficulty === "mixed" ? "Medium" : difficulty[0].toUpperCase() + difficulty.slice(1),
      question: fact.kind === "comparison"
        ? `Which comparison best matches the source material about "${fact.topic}"?`
        : fact.kind === "command/output"
          ? `Which statement most accurately reflects the command or output idea discussed under "${fact.topic}"?`
          : fact.kind === "scenario"
            ? `In a scenario involving "${fact.topic}", which option best matches the file's explanation?`
            : `Which statement best reflects the reasoning presented in "${fact.topic}"?`,
      choices: {
        A: fact.statement,
        B: distractors[0],
        C: distractors[1],
        D: distractors[2]
      },
      correct: "A",
      explanation: `The source section "${fact.topic}" describes this idea directly: ${fact.cue}.`,
      wrongAnswerNotes: {
        B: "This option is plausible, but it describes a different idea from the lecture.",
        C: "This option belongs to another concept or scenario, not the target topic here.",
        D: "This option sounds relevant, but it does not match the source section closely enough."
      }
    });
    if (questions.length >= count) break;
  }

  return questions.slice(0, count);
}

function normalizeQuizPayload(payload, defaultDifficulty = "mixed") {
  const questions = Array.isArray(payload?.quiz?.questions) ? payload.quiz.questions : [];
  const bannedChoicePattern = /\b(unrelated detail|fallback|section\s+\d+)\b/i;
  return {
    quiz: {
      title: payload?.quiz?.title || "File Quiz",
      questions: questions
        .map((question) => {
          const correct = ["A", "B", "C", "D"].includes(question?.correct) ? question.correct : "A";
          const choices = {
            A: String(question?.choices?.A || "").trim(),
            B: String(question?.choices?.B || "").trim(),
            C: String(question?.choices?.C || "").trim(),
            D: String(question?.choices?.D || "").trim()
          };
          if (!choices.A || !choices.B || !choices.C || !choices.D) return null;
          if (Object.values(choices).some((choice) => bannedChoicePattern.test(choice))) return null;
          if (new Set(Object.values(choices).map((choice) => choice.toLowerCase())).size < 4) return null;
          return {
            sourceTopic: cleanTopicLabel(question?.sourceTopic || question?.topic, "Document concept"),
            topic: cleanTopicLabel(question?.topic || question?.sourceTopic, "Document concept"),
            difficulty: ["Easy", "Medium", "Hard"].includes(question?.difficulty)
              ? question.difficulty
              : defaultDifficulty === "mixed"
                ? "Medium"
                : defaultDifficulty[0].toUpperCase() + defaultDifficulty.slice(1),
            question: String(question?.question || "").trim(),
            choices,
            correct,
            explanation: String(question?.explanation || "").trim(),
            wrongAnswerNotes: {
              A: String(question?.wrongAnswerNotes?.A || "").trim(),
              B: String(question?.wrongAnswerNotes?.B || "").trim(),
              C: String(question?.wrongAnswerNotes?.C || "").trim(),
              D: String(question?.wrongAnswerNotes?.D || "").trim()
            }
          };
        })
        .filter((question) => question?.question)
    }
  };
}

function summarizeAvailableQuizQuestions(questions, documentName) {
  return questions.length
    ? `I generated ${questions.length} file-based quiz question${questions.length === 1 ? "" : "s"} from ${documentName}.`
    : `I couldn't safely build a strong quiz from ${documentName} yet, but the file remains ready for another attempt.`;
}

function buildDocumentPayload(document, options = {}) {
  if (!document) return null;
  const includeText = options.includeText !== false;
  return {
    id: document.id,
    name: document.name,
    status: document.status,
    characters: document.text.length,
    pageCount: document.pageCount || 0,
    text: includeText ? document.text : undefined,
    chunks: document.chunks.length,
    chunkMeta: document.chunks.map((chunk) => ({
      index: chunk.index,
      title: cleanTopicLabel(chunk.title, `Chunk ${chunk.index}`),
      characters: chunk.chars
    }))
  };
}

function normalizeFlashcardsPayload(payload) {
  const cards = Array.isArray(payload?.flashcards?.cards) ? payload.flashcards.cards : Array.isArray(payload?.cards) ? payload.cards : [];
  return {
    flashcards: {
      title: payload?.flashcards?.title || "Flashcards",
      cards: cards
        .map((card) => ({
          topic: cleanTopicLabel(card?.topic, "Document concept"),
          front: String(card?.front || "").trim(),
          back: String(card?.back || "").trim(),
          tags: Array.isArray(card?.tags)
            ? card.tags.map((tag) => cleanTopicLabel(tag, "")).filter(Boolean).slice(0, 3)
            : []
        }))
        .filter((card) => card.front && card.back)
    }
  };
}

function buildLocalFlashcards(sourceChunks, count = 15) {
  const cards = [];
  for (const chunk of sourceChunks) {
    const front = chunk.title;
    const back = localKeyPoints(chunk.text, 1)[0] || normalizeParagraphs(chunk.text)[0] || chunk.title;
    cards.push({ topic: chunk.title, front, back, tags: ["concept", "revision", cleanTopicLabel(chunk.title, "topic")] });
    const definitions = localDefinitions(chunk.text, 2);
    for (const definition of definitions) {
      cards.push({ topic: chunk.title, front: `Definition from ${chunk.title}`, back: definition, tags: ["definition", cleanTopicLabel(chunk.title, "topic")] });
    }
    if (cards.length >= count) break;
  }
  return dedupeByText(cards, (item) => item.front).slice(0, count);
}

async function callGeminiText({ system, messages, detailMode = false, outputTokens, temperature, qualityMode = "study" }) {
  const { reply, model } = await callGemini({ system, messages, detailMode, outputTokens, temperature, qualityMode });
  return { text: reply, model };
}

async function resilientTextGeneration({ system, messages, detailMode = false, outputTokens, temperature, shrinkMessage, qualityMode = "study" }) {
  const stages = [
    { detailMode, outputTokens, temperature },
    { detailMode, outputTokens, temperature },
    { detailMode, outputTokens: Math.max(700, Math.floor((outputTokens || 1400) * 0.8)), temperature: 0.35, shrink: true },
    { detailMode: false, outputTokens: Math.max(600, Math.floor((outputTokens || 1400) * 0.65)), temperature: 0.3, shrink: true }
  ];
  const errors = [];

  for (const [index, stage] of stages.entries()) {
    const stageMessages = stage.shrink && typeof shrinkMessage === "function"
      ? messages.map((message, index) => index === messages.length - 1 ? { ...message, content: shrinkMessage(message.content) } : message)
      : messages;
    try {
      return await callGeminiText({
        system,
        messages: stageMessages,
        detailMode: stage.detailMode,
        outputTokens: stage.outputTokens,
        temperature: stage.temperature,
        qualityMode
      });
    } catch (error) {
      errors.push(publicErrorMessage(error));
      if (index < stages.length - 1) {
        await sleep(500 * (2 ** index));
      }
    }
  }

  const fallbackError = new Error(errors[errors.length - 1] || "Gemini request failed.");
  fallbackError.attemptErrors = errors;
  throw fallbackError;
}

async function summarizeChunkGroup({ system, group, detailMode = false, qualityMode = "study" }) {
  const schemaPrompt = "Return only valid JSON with this shape: {\"items\":[{\"chunkIndex\":1,\"title\":\"string\",\"summary\":\"string\",\"definitions\":[\"string\"],\"formulas\":[\"string\"],\"examples\":[\"string\"],\"keyPoints\":[\"string\"],\"comparisons\":[\"string\"],\"commands\":[\"string\"],\"mistakes\":[\"string\"],\"examQuestions\":[\"string\"]}]}";
  const messages = [{
    role: "user",
    content: [
      "Summarize each chunk briefly and separately.",
      schemaPrompt,
      formatChunksForPrompt(group)
    ].join("\n\n")
  }];
  const result = await resilientTextGeneration({
    system: `${system}\n\nYou are compressing academic text chunk by chunk. Be specific, brief, and faithful to the provided content. Output JSON only.`,
    messages,
    detailMode,
    outputTokens: detailMode ? 1400 : 900,
    temperature: 0.35,
    shrinkMessage: (content) => content.slice(0, Math.floor(content.length * 0.7)),
    qualityMode
  });
  return { parsed: extractJson(result.text), model: result.model };
}

async function generateDocumentSummary({ system, message, document, processingMode = "standard", summaryMode = "detailed", preferArabic = false, qualityMode = "study" }) {
  const cacheKey = `summary:${qualityMode}:${processingMode}:${normalizeSummaryMode(summaryMode)}:${preferArabic ? "ar" : "en"}`;
  if (document.artifacts?.[cacheKey]) return document.artifacts[cacheKey];

  if (processingMode === "standard" && document.text.length <= STANDARD_DOCUMENT_CHARS) {
    try {
      const content = buildUserContent({ message, document, processingMode, task: "summary", options: { summaryMode, preferArabic } });
      const result = await resilientTextGeneration({
        system: `${system}\n\nYou are preparing an exam-ready tutor summary. Base every section on the uploaded file, not generic background knowledge. ${preferArabic ? "Respond in clean Egyptian Arabic and keep important technical terms in English." : "Respond in clear English."}`,
        messages: [{ role: "user", content }],
        detailMode: qualityMode === "deep",
        outputTokens: qualityMode === "fast" ? 1200 : summaryMode === "short" ? 1600 : qualityMode === "deep" ? 3200 : 2800,
        temperature: 0.45,
        shrinkMessage: (value) => value.slice(0, Math.floor(value.length * 0.75)),
        qualityMode
      });
      const artifact = { reply: result.text, model: result.model, chunkSummaries: [], partial: false };
      document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
      return artifact;
    } catch (error) {
      console.error("[summary:standard-failed]", error);
    }
  }

  const groups = groupChunksForProcessing(document.chunks || [], processingMode === "detailed" ? 7 : 5);
  const chunkSummaries = [];
  let model = GEMINI_MODEL;
  let partial = false;

  for (const group of groups) {
    try {
      const result = await summarizeChunkGroup({ system: `${system}\n\n${preferArabic ? "Respond in clean Egyptian Arabic and keep technical terms in English." : "Respond in English."}`, group, detailMode: processingMode === "detailed", qualityMode });
      model = result.model || model;
      chunkSummaries.push(...(result.parsed.items || []));
    } catch (error) {
      console.error("[summary:group-failed]", error);
      partial = true;
      for (const chunk of group) {
        try {
          const result = await summarizeChunkGroup({ system: `${system}\n\n${preferArabic ? "Respond in clean Egyptian Arabic and keep technical terms in English." : "Respond in English."}`, group: splitChunkForFallback(chunk), detailMode: false, qualityMode });
          chunkSummaries.push(...(result.parsed.items || []));
        } catch {
          chunkSummaries.push(localChunkSummary(chunk));
        }
      }
    }
  }

  let reply = "";
  let finalModel = model;
  try {
    const result = await resilientTextGeneration({
      system: `${system}\n\nYou are combining chunk summaries into one polished academic study summary. Keep the structure explicit and exam-focused, and do not lose later sections of the document.`,
      messages: [{
        role: "user",
        content: [
          "Create a final structured summary from these chunk summaries.",
          `Use this structure exactly: 1. What this lecture/file is about 2. Main topics covered 3. Key definitions 4. Important rules and concepts 5. Important comparisons 6. Commands, examples, or formulas if present 7. Step-by-step processes 8. Common mistakes 9. Exam-focused notes 10. Likely exam questions 11. Final revision checklist.`,
          summaryMode === "short"
            ? "Keep it concise but still exam-useful."
            : "Be deep, smart, and useful for studying. Cover the whole file, not just the first section.",
          preferArabic
            ? "Write the final summary in clean Egyptian Arabic while preserving important academic and networking terms in English."
            : "Write the final summary in clear English.",
          JSON.stringify({ document: document.name, chunks: chunkSummaries })
        ].join("\n\n")
      }],
      detailMode: processingMode === "detailed" || qualityMode === "deep",
      outputTokens: qualityMode === "fast" ? 1300 : summaryMode === "short" ? 1600 : processingMode === "detailed" || qualityMode === "deep" ? 3200 : 2200,
      temperature: 0.4,
      shrinkMessage: (content) => content.slice(0, Math.floor(content.length * 0.75)),
      qualityMode
    });
    reply = result.text;
    finalModel = result.model || model;
  } catch (error) {
    console.error("[summary:merge-failed]", error);
    partial = true;
    reply = buildLocalSummaryReply(document, chunkSummaries);
  }

  if (partial) reply = `Summary ready.\n\n${reply}`;
  const artifact = { reply, model: finalModel || model, chunkSummaries, partial };
  document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
  return artifact;
}

async function generateQuizTool({ system, message, document, processingMode = "standard", quizDifficulty = "mixed", quizCount = 10, qualityMode = "study" }) {
  const normalizedDifficulty = normalizeQuizDifficulty(quizDifficulty);
  const requestedCount = normalizeQuizCount(quizCount);
  const normalizedCount = qualityMode === "fast" ? Math.min(5, requestedCount) : qualityMode === "deep" ? Math.min(15, Math.max(10, requestedCount)) : Math.min(10, Math.max(5, requestedCount));
  const cacheKey = `quiz:${qualityMode}:${processingMode}:${normalizedDifficulty}:${normalizedCount}:${message.trim().toLowerCase()}`;
  if (document.artifacts?.[cacheKey]) return document.artifacts[cacheKey];

  if (processingMode === "standard" && document.text.length <= STANDARD_DOCUMENT_CHARS) {
    try {
      const prompt = [
        `Generate exactly ${normalizedCount} ${normalizedDifficulty} real exam-style MCQs from this document.`,
        "Cover the whole file, not just one section.",
        "Prefer concept reasoning, scenario-based, comparison, command/configuration, and troubleshooting questions when supported by the source.",
        "All four choices must be plausible and tied to the same topic.",
        "Return only valid JSON with this shape: {\"quiz\":{\"title\":\"string\",\"questions\":[{\"sourceTopic\":\"string\",\"topic\":\"string\",\"difficulty\":\"Easy|Medium|Hard\",\"question\":\"string\",\"choices\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"},\"correct\":\"A\",\"explanation\":\"string\",\"wrongAnswerNotes\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"}}]}}",
        buildDocumentContext({ message, document, processingMode, task: "mcq", options: { quizDifficulty: normalizedDifficulty, quizCount: normalizedCount } })
      ].join("\n\n");
      const result = await resilientTextGeneration({
        system: `${system}\n\nYou are generating rigorous academic MCQs grounded only in the uploaded file. Output JSON only.`,
        messages: [{ role: "user", content: prompt }],
        detailMode: qualityMode === "deep",
        outputTokens: qualityMode === "fast" ? 1400 : Math.min(3600, 1000 + normalizedCount * (qualityMode === "deep" ? 200 : 180)),
        temperature: 0.5,
        shrinkMessage: (value) => value.slice(0, Math.floor(value.length * 0.75)),
        qualityMode
      });
      const artifact = { parsed: normalizeQuizPayload(extractJson(result.text), normalizedDifficulty), model: result.model, partial: false };
      document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
      return artifact;
    } catch (error) {
      console.error("[quiz:standard-failed]", error);
    }
  }

  const selected = selectRelevantChunks(document, message, {
    task: "mcq",
    processingMode,
    maxChunks: Math.min(10, Math.max(5, Math.ceil(normalizedCount / 3) + 2)),
    limitChars: processingMode === "detailed" ? 18000 : 13000
  });
  const groups = groupChunksForProcessing(selected, Math.max(2, Math.ceil(normalizedCount / 3)));
  const allQuestions = [];
  let model = GEMINI_MODEL;
  let partial = false;
  const targets = [];
  let remainingQuestions = normalizedCount;
  while (remainingQuestions > 0) {
    const batchSize = Math.min(3, remainingQuestions);
    targets.push(batchSize);
    remainingQuestions -= batchSize;
  }

  for (const [groupIndex, group] of groups.entries()) {
    const wanted = targets[groupIndex] || Math.min(3, Math.max(1, normalizedCount - allQuestions.length));
    if (wanted <= 0) break;
    const prompt = [
      `Generate exactly ${wanted} ${normalizedDifficulty} real exam-style MCQs from these chunks.`,
      "Make them specific, file-based, and suitable for exam revision.",
      "Blend different question styles when the source supports them: scenario, comparison, command/configuration, troubleshooting, concept reasoning.",
      "All four choices must be plausible and closely related to the same source topic.",
      "Return only valid JSON with this shape: {\"questions\":[{\"sourceTopic\":\"string\",\"topic\":\"string\",\"difficulty\":\"Easy|Medium|Hard\",\"question\":\"string\",\"choices\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"},\"correct\":\"A\",\"explanation\":\"string\",\"wrongAnswerNotes\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"}}]}",
      formatChunksForPrompt(group)
    ].join("\n\n");
    try {
      const result = await resilientTextGeneration({
        system: `${system}\n\nYou are generating rigorous academic MCQs grounded only in the uploaded file. Output JSON only.`,
        messages: [{ role: "user", content: prompt }],
        detailMode: processingMode === "detailed" || qualityMode === "deep",
        outputTokens: qualityMode === "deep" ? 1500 : 1200,
        temperature: 0.45,
        shrinkMessage: (content) => content.slice(0, Math.floor(content.length * 0.65)),
        qualityMode
      });
      model = result.model || model;
      const parsed = normalizeQuizPayload({ quiz: { questions: extractJson(result.text).questions || [] } }, normalizedDifficulty);
      allQuestions.push(...(parsed.quiz.questions || []));
    } catch (error) {
      console.error("[quiz:batch-failed]", error);
      partial = true;
      for (const chunk of group) {
        try {
          const fallbackPrompt = [
            `Generate exactly ${Math.min(2, wanted)} real exam-style MCQs from this chunk.`,
            "Keep the questions faithful to the chunk. Prefer quality over quantity.",
            "Return only valid JSON with this shape: {\"questions\":[{\"sourceTopic\":\"string\",\"topic\":\"string\",\"difficulty\":\"Easy|Medium|Hard\",\"question\":\"string\",\"choices\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"},\"correct\":\"A\",\"explanation\":\"string\",\"wrongAnswerNotes\":{\"A\":\"string\",\"B\":\"string\",\"C\":\"string\",\"D\":\"string\"}}]}",
            formatChunksForPrompt(splitChunkForFallback(chunk))
          ].join("\n\n");
          const result = await resilientTextGeneration({
            system: `${system}\n\nYou are generating rigorous academic MCQs grounded only in the uploaded file. Output JSON only.`,
            messages: [{ role: "user", content: fallbackPrompt }],
            outputTokens: 850,
            temperature: 0.4,
            shrinkMessage: (content) => content.slice(0, Math.floor(content.length * 0.6)),
            qualityMode
          });
          const parsed = normalizeQuizPayload({ quiz: { questions: extractJson(result.text).questions || [] } }, normalizedDifficulty);
          allQuestions.push(...(parsed.quiz.questions || []));
        } catch {
          allQuestions.push(...buildLocalQuizQuestions(selected, Math.min(2, wanted), normalizedDifficulty));
        }
      }
    }
  }

  const questions = dedupeByText(allQuestions, (item) => item.question).slice(0, normalizedCount);
  const artifact = {
    parsed: {
      quiz: {
        title: `${document.name} Quiz`,
        questions
      }
    },
    model,
    partial
  };
  document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
  return artifact;
}

async function generateFlashcardsTool({ system, message, document, processingMode = "standard", qualityMode = "study" }) {
  const cacheKey = `flashcards:${qualityMode}:${processingMode}`;
  if (document.artifacts?.[cacheKey]) return document.artifacts[cacheKey];
  const targetCardCount = qualityMode === "fast" ? 8 : qualityMode === "deep" ? 15 : 12;

  if (processingMode === "standard" && document.text.length <= STANDARD_DOCUMENT_CHARS) {
    try {
      const prompt = [
        `Generate exactly ${targetCardCount} flashcards from this document.`,
        "Focus on definitions, rules, commands, differences, steps, and exam traps.",
        "Return only valid JSON with this shape: {\"flashcards\":{\"title\":\"string\",\"cards\":[{\"topic\":\"string\",\"front\":\"string\",\"back\":\"string\",\"tags\":[\"string\"]}]}}",
        buildDocumentContext({ message, document, processingMode, task: "flashcards" })
      ].join("\n\n");
      const result = await resilientTextGeneration({
        system: `${system}\n\nYou are generating compact academic flashcards. Output JSON only.`,
        messages: [{ role: "user", content: prompt }],
        detailMode: qualityMode === "deep",
        outputTokens: qualityMode === "fast" ? 1100 : qualityMode === "deep" ? 1900 : 1500,
        temperature: 0.4,
        shrinkMessage: (value) => value.slice(0, Math.floor(value.length * 0.75)),
        qualityMode
      });
      const artifact = { parsed: normalizeFlashcardsPayload(extractJson(result.text)), model: result.model, partial: false };
      document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
      return artifact;
    } catch (error) {
      console.error("[flashcards:standard-failed]", error);
    }
  }

  const selected = selectRelevantChunks(document, message, {
    task: "flashcards",
    processingMode,
    maxChunks: processingMode === "detailed" ? 7 : 5,
    limitChars: processingMode === "detailed" ? 15000 : 9500
  });
  const groups = groupChunksForProcessing(selected, 3);
  const allCards = [];
  let model = GEMINI_MODEL;
  let partial = false;

  for (const [groupIndex, group] of groups.entries()) {
    const wanted = Math.min(5, targetCardCount - allCards.length);
    if (wanted <= 0) break;
    const prompt = [
      `Generate exactly ${wanted} flashcards from these chunks.`,
      "Focus on definitions, rules, commands, differences, steps, and exam traps.",
      "Return only valid JSON with this shape: {\"cards\":[{\"topic\":\"string\",\"front\":\"string\",\"back\":\"string\",\"tags\":[\"string\"]}]}",
      formatChunksForPrompt(group)
    ].join("\n\n");
    try {
      const result = await resilientTextGeneration({
        system: `${system}\n\nYou are generating compact academic flashcards. Output JSON only.`,
        messages: [{ role: "user", content: prompt }],
        detailMode: processingMode === "detailed" || qualityMode === "deep",
        outputTokens: qualityMode === "deep" ? 1400 : 1000,
        temperature: 0.35,
        shrinkMessage: (content) => content.slice(0, Math.floor(content.length * 0.65)),
        qualityMode
      });
      model = result.model || model;
      const parsed = normalizeFlashcardsPayload(extractJson(result.text));
      allCards.push(...(parsed.flashcards.cards || []));
    } catch (error) {
      console.error("[flashcards:batch-failed]", error);
      partial = true;
      allCards.push(...buildLocalFlashcards(group, wanted));
    }
  }

  const cards = dedupeByText(allCards, (item) => item.front).slice(0, targetCardCount);
  const artifact = {
    parsed: {
      flashcards: {
        title: `${document.name} Flashcards`,
        cards
      }
    },
    model,
    partial
  };
  document.artifacts = { ...(document.artifacts || {}), [cacheKey]: artifact };
  return artifact;
}

function buildDocumentContext({ message, document, processingMode = "standard", task = null }) {
  if (!document?.text) return "";
  const resolvedTask = task || detectDocumentTask(message);
  const studyMap = getDocumentStudyMap(document);
  const studyMapBlock = [
    `Sections: ${studyMap.sectionTitles.join(" | ") || "None"}`,
    `Definitions: ${studyMap.definitions.slice(0, 4).map((item) => `${item.topic}: ${item.text}`).join(" | ") || "None"}`,
    `Comparisons: ${studyMap.comparisons.slice(0, 3).map((item) => `${item.topic}: ${item.text}`).join(" | ") || "None"}`,
    `Commands or examples: ${studyMap.commands.slice(0, 3).map((item) => `${item.topic}: ${item.text}`).join(" | ") || "None"}`,
    `Exam traps: ${studyMap.traps.slice(0, 3).map((item) => `${item.topic}: ${item.text}`).join(" | ") || "None"}`
  ].join("\n");
  if (processingMode === "standard" && document.text.length <= STANDARD_DOCUMENT_CHARS) {
    return [
      `Document name: ${document.name}`,
      `Readable characters extracted: ${document.text.length}`,
      "Standard mode is enabled. The file is small enough to use normal full-context analysis.",
      "Compact study map:",
      studyMapBlock,
      document.text
    ].join("\n\n");
  }
  const chunks = selectRelevantChunks(document, message, { processingMode, task: resolvedTask });
  const chunkTextBlock = chunks.map((chunk) => `--- Chunk ${chunk.index}: ${chunk.title} ---\n${chunk.text}`).join("\n\n");
  return [
    `Document name: ${document.name}`,
    `Readable characters extracted: ${document.text.length}`,
    `Semantic chunks available: ${document.chunks?.length || chunks.length}`,
    processingMode === "detailed"
      ? "Detailed mode is enabled. Analyze the selected chunks carefully and produce a fuller answer."
      : processingMode === "light"
        ? "Light mode is enabled. Use only the selected relevant chunks and stay concise but useful."
        : "Standard mode is enabled. Use the selected chunks naturally and answer normally.",
    "Compact study map:",
    studyMapBlock,
    chunkTextBlock
  ].join("\n\n");
}

function buildUserContent({ message, document, processingMode = "standard", task = null, options = {} }) {
  if (!document?.text) return message;
  const resolvedTask = task || detectDocumentTask(message);
  const context = buildDocumentContext({ message, document, processingMode, task: resolvedTask });
  return [
    message,
    "Document task instruction:",
    taskInstruction(resolvedTask, options),
    "Document context:",
    context
  ].join("\n\n");
}

function isModelNotFound(error) {
  const message = error.message || "";
  return message.includes("NOT_FOUND") || message.includes("not found for API version");
}

function publicErrorMessage(error) {
  const message = error.message || "";
  if (error.isFriendly) return message;
  if (message === "fetch failed" || message.includes("ECONNRESET") || message.includes("ENOTFOUND")) {
    return "Gemini is temporarily unreachable. Please check your connection and try again.";
  }
  try {
    const parsed = JSON.parse(message);
    const geminiMessage = parsed?.error?.message || "";
    const geminiStatus = parsed?.error?.status || "";
    if (parsed?.error?.code === 429 || geminiStatus === "RESOURCE_EXHAUSTED" || /quota|rate limit|rate-limit/i.test(geminiMessage)) {
      return "Daily AI limit reached. Try again later.";
    }
    return parsed?.error?.message || "Gemini request failed.";
  } catch {
    if (/quota|rate limit|rate-limit|RESOURCE_EXHAUSTED|429/i.test(message)) {
      return "Daily AI limit reached. Try again later.";
    }
    return message || "Gemini request failed.";
  }
}

function withTimeout(promise, ms = 60000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Gemini request timed out.")), ms);
    })
  ]);
}

async function generateWithGemini({ ai, model, system, messages, detailMode = false, outputTokens, temperature }) {
  const geminiMessages = [...messages];
  if (geminiMessages[0]) {
    geminiMessages[0] = {
      ...geminiMessages[0],
      content: `Instructions:\n${system}\n\nStudent request:\n${geminiMessages[0].content}`
    };
  }
  const contents = geminiMessages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  const generativeModel = ai.getGenerativeModel({
    model,
    generationConfig: {
      maxOutputTokens: outputTokens || (detailMode ? 3600 : 1800),
      temperature: temperature ?? 0.7
    },
    systemInstruction: system
  });
  const response = await withTimeout(generativeModel.generateContent({ contents }), detailMode ? 90000 : 60000);
  const text = response.response.text();

  return {
    reply: text?.trim() || "I could not generate a response this time.",
    model
  };
}

function resolveGeminiModels(qualityMode = "study") {
  const primary = GEMINI_MODEL || "gemini-1.5-flash-latest";
  const fallback = GEMINI_FALLBACK_MODELS.filter(Boolean);
  if (qualityMode === "deep") {
    return [...new Set([GEMINI_PRO_MODEL || primary, primary, ...fallback])];
  }
  return [...new Set([primary, ...fallback])];
}

async function callGemini({ system, messages, detailMode = false, outputTokens, temperature, qualityMode = "study" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const ai = new GoogleGenerativeAI(apiKey);
  const models = resolveGeminiModels(qualityMode);
  const failures = [];

  for (const model of models) {
    try {
      return await generateWithGemini({ ai, model, system, messages, detailMode, outputTokens, temperature });
    } catch (error) {
      failures.push(`${model}: ${publicErrorMessage(error)}`);
      if (!isModelNotFound(error)) {
        if (/quota|rate limit|Daily AI limit/i.test(publicErrorMessage(error))) {
          const friendly = new Error("Daily AI limit reached. Try again later.");
          friendly.isFriendly = true;
          throw friendly;
        }
        continue;
      }
    }
  }

  console.error("[gemini:models-failed]", failures.join(" | "));
  throw new Error("Gemini is unavailable right now. Please try again in a bit.");
}

function normalizeMessages(messages) {
  const normalized = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = String(message.content || "").trim();
    if (!content) continue;
    if (normalized.length === 0 && role !== "user") continue;
    if (normalized.at(-1)?.role === role) {
      normalized[normalized.length - 1].content += `\n\n${content}`;
    } else {
      normalized.push({ role, content });
    }
  }
  return normalized;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "masari-api",
    aiProvider: "gemini",
    model: GEMINI_MODEL,
    proModel: GEMINI_PRO_MODEL || null,
    fallbackModels: GEMINI_FALLBACK_MODELS
  });
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    cleanupDocuments();
    const { text, status, pageCount } = await extractText(req.file);
    if (!req.file) return res.status(400).json({ error: "File is required." });
    if (!text || text.length < 20) {
      return res.status(400).json({ error: "Could not extract enough readable text from this file." });
    }
    const document = createDocumentRecord({ file: req.file, text, status, pageCount });
    documents.set(document.id, document);
    console.info(`[upload] ${document.name} stored as ${document.id}. chars=${text.length}`);
    res.json({
      document: buildDocumentPayload(document, { includeText: true }),
      statusLabel: "File ready for analysis"
    });
  } catch (error) {
    const message = publicErrorMessage(error);
    console.error("[upload:error]", message);
    const status = message.includes("Daily AI limit reached") ? 429 : message.includes("Unsupported file type") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

app.post("/api/chat", upload.single("file"), async (req, res) => {
  try {
    cleanupDocuments();
    let payload = {};
    try {
      payload = JSON.parse(req.body.payload || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid chat payload." });
    }
    let fileResult = null;
    let document = payload.documentId ? documents.get(payload.documentId) : null;
    if (req.file) {
      const { text, status, pageCount } = await extractText(req.file);
      document = createDocumentRecord({ file: req.file, text, status, pageCount });
      documents.set(document.id, document);
      fileResult = buildDocumentPayload(document, { includeText: true });
      console.info(`[chat:file] ${document.name} stored as ${document.id}. chars=${text.length}`);
    }
    const history = Array.isArray(payload.messages) ? payload.messages : [];
    const latestMessage = String(payload.message || "").trim();

    if (!latestMessage) {
      return res.status(400).json({ error: "Message is required." });
    }

    const system = buildSystemPrompt({
      user: payload.user,
      tasks: payload.tasks,
      notes: payload.notes
    });
    const qualityMode = normalizeQualityMode(payload.qualityMode);
    const processingMode = resolveProcessingMode({ document, qualityMode });
    const requestedTask = payload.task || detectDocumentTask(latestMessage);
    const preferArabic = containsArabic(latestMessage);
    const summaryMode = normalizeSummaryMode(payload.summaryMode);
    const quizDifficulty = normalizeQuizDifficulty(payload.quizDifficulty);
    const quizCount = normalizeQuizCount(payload.quizCount);
    if (requestedTask === "summary" && document) {
      console.info(`[chat:summary] mode=${processingMode} doc=${document.id} chars=${document.text.length} chunks=${document.chunks.length}`);
      const summary = await generateDocumentSummary({ system, message: latestMessage, document, processingMode, summaryMode, preferArabic, qualityMode });
      return res.json({
        reply: summary.reply,
        model: summary.model,
        statusLabel: "Summary ready",
        file: buildDocumentPayload(document, { includeText: false })
      });
    }
    if ((requestedTask === "quiz" || requestedTask === "mcq") && document) {
      console.info(`[chat:quiz] mode=${processingMode} doc=${document.id} chars=${document.text.length} chunks=${document.chunks.length}`);
      const { parsed, model } = await generateQuizTool({ system, message: latestMessage, document, processingMode, quizDifficulty, quizCount, qualityMode });
      const questionCount = parsed?.quiz?.questions?.length || 0;
      return res.json({
        reply: summarizeAvailableQuizQuestions(parsed?.quiz?.questions || [], document.name),
        model,
        quiz: parsed.quiz || null,
        flashcards: null,
        partial: Boolean(questionCount > 0 && questionCount < 10),
        statusLabel: questionCount ? "Quiz ready" : "File ready for analysis",
        file: buildDocumentPayload(document, { includeText: false })
      });
    }
    if (requestedTask === "flashcards" && document) {
      console.info(`[chat:flashcards] mode=${processingMode} doc=${document.id} chars=${document.text.length} chunks=${document.chunks.length}`);
      const { parsed, model } = await generateFlashcardsTool({ system, message: latestMessage, document, processingMode, qualityMode });
      return res.json({
        reply: parsed?.flashcards?.cards?.length
          ? `I generated ${parsed.flashcards.cards.length} flashcards from ${document.name}.`
          : `I couldn't safely build strong flashcards from ${document.name} yet, but the file remains ready for another attempt.`,
        model,
        quiz: null,
        flashcards: parsed.flashcards || null,
        partial: Boolean((parsed?.flashcards?.cards?.length || 0) > 0 && parsed?.flashcards?.cards?.length < 15),
        statusLabel: parsed?.flashcards?.cards?.length ? "Flashcards ready" : "File ready for analysis",
        file: buildDocumentPayload(document, { includeText: false })
      });
    }
    const userContent = buildUserContent({
      message: latestMessage,
      document,
      processingMode,
      task: requestedTask,
      options: { summaryMode, quizDifficulty, quizCount, preferArabic, qualityMode }
    });

    const messages = normalizeMessages([
      ...history.slice(document ? -4 : -6).map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: String(message.text || "")
      })),
      { role: "user", content: userContent }
    ]);

    console.info(`[chat] model=${GEMINI_MODEL} quality=${qualityMode} mode=${processingMode} doc=${document?.id || "none"} chars=${document?.text?.length || 0} message="${latestMessage.slice(0, 80)}"`);
    try {
      const { reply, model } = await callGemini({ system, messages, detailMode: processingMode === "detailed", qualityMode });
      return res.json({
        reply,
        model,
        statusLabel: requestedTask === "hard"
          ? "Explanation ready"
          : requestedTask === "study-plan"
            ? "Study plan ready"
            : requestedTask === "key-points"
              ? "Key points ready"
              : fileResult || document
                ? "File ready for analysis"
                : "Reply ready",
        file: fileResult || buildDocumentPayload(document, { includeText: false })
      });
    } catch (error) {
      console.error("[chat:general-failed]", error);
      if (document) {
        const selected = selectRelevantChunks(document, latestMessage, { processingMode, task: requestedTask });
        const partialReply = buildLocalSummaryReply(document, selected.map((chunk) => localChunkSummary(chunk)));
        return res.json({
          reply: partialReply,
          model: GEMINI_MODEL,
          partial: true,
          statusLabel: requestedTask === "summary" ? "Summary ready" : "File ready for analysis",
          file: fileResult || buildDocumentPayload(document, { includeText: false })
        });
      }
      throw error;
    }
  } catch (error) {
    const message = publicErrorMessage(error);
    console.error("[chat:error]", error);
    const status = message.includes("Daily AI limit reached") ? 429 : message.includes("Unsupported file type") || message.includes("Message is required") ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

const savedQuizzes = new Map();
const savedFlashcardDecks = new Map();

app.post("/api/save-quiz", express.json(), async (req, res) => {
  try {
    const { userId, quiz, fileName } = req.body;
    if (!userId || !quiz) {
      return res.status(400).json({ error: "userId and quiz are required." });
    }
    const quizId = `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const savedQuiz = { id: quizId, ...quiz, fileName, savedAt: new Date().toISOString(), userId };
    if (!savedQuizzes.has(userId)) savedQuizzes.set(userId, []);
    savedQuizzes.get(userId).push(savedQuiz);
    res.json({ id: quizId, message: "Quiz saved successfully" });
  } catch (error) {
    console.error("[save-quiz:error]", error);
    res.status(500).json({ error: "Failed to save quiz." });
  }
});

app.get("/api/quizzes/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const quizzes = savedQuizzes.get(userId) || [];
    res.json({ quizzes });
  } catch (error) {
    console.error("[get-quizzes:error]", error);
    res.status(500).json({ error: "Failed to retrieve quizzes." });
  }
});

app.post("/api/save-flashcards", express.json(), async (req, res) => {
  try {
    const { userId, flashcards, deckName } = req.body;
    if (!userId || !flashcards) {
      return res.status(400).json({ error: "userId and flashcards are required." });
    }
    const deckId = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const savedDeck = { id: deckId, ...flashcards, deckName, savedAt: new Date().toISOString(), userId };
    if (!savedFlashcardDecks.has(userId)) savedFlashcardDecks.set(userId, []);
    savedFlashcardDecks.get(userId).push(savedDeck);
    res.json({ id: deckId, message: "Flashcard deck saved successfully" });
  } catch (error) {
    console.error("[save-flashcards:error]", error);
    res.status(500).json({ error: "Failed to save flashcards." });
  }
});

app.get("/api/flashcards/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const decks = savedFlashcardDecks.get(userId) || [];
    res.json({ decks });
  } catch (error) {
    console.error("[get-flashcards:error]", error);
    res.status(500).json({ error: "Failed to retrieve flashcards." });
  }
});

app.use((error, _req, res, _next) => {
  const message = error.message || "Request failed.";
  const status = message.includes("Unsupported file type") ? 400 : 500;
  res.status(status).json({ error: message });
});

export default app;
