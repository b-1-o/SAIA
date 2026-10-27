import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchQuery, classifyTask, shouldSearch } from "./taskRouter.js";
import { parseQuizModelResponse } from "./quiz.js";
import { compactPageText, shouldUseVisualAnalysis } from "./analyzer.js";

test("removes LMS navigation while keeping focused assignment text", () => {
  const raw = [
    "Skip to Content",
    "Courses Groups Resources Grades 64",
    "ERIK GHABUZYAN",
    "Current Menu Item",
    "03.02 Theorems of Algebra",
    "According to the fundamental theorem of algebra, how many zeros does f(x) = 4x^3 - x^2 - 2x + 1 have?",
    "A. 1",
    "B. 2",
    "C. 3",
    "D. 4"
  ].join("\n");
  const compact = compactPageText(raw, 3200);
  assert.match(compact, /fundamental theorem of algebra/i);
  assert.match(compact, /A\. 1/);
  assert.doesNotMatch(compact, /ERIK GHABUZYAN/i);
  assert.doesNotMatch(compact, /Courses Groups Resources Grades/i);
});

test("caps very long pages and keeps question-relevant lines", () => {
  const raw = Array.from({ length: 90 }, (_, index) =>
    index === 45
      ? "Find the remainder when f(x) = 2x^3 - 12x^2 + 11x + 2 is divided by x - 5?"
      : "Navigation menu item and course information line " + index
  ).join("\n");
  const compact = compactPageText(raw, 1200);
  assert.ok(compact.length <= 1200);
  assert.match(compact, /Find the remainder/);
});

test("does not use vision for generic LMS chrome or image metadata", () => {
  const page = "Courses Groups Resources Grades Skip to Content Image 1: schoology logo";
  assert.equal(shouldUseVisualAnalysis("auto", "03.02 Theorems of Algebra | Schoology", page), false);
});

test("uses vision when a question explicitly refers to a graph", () => {
  assert.equal(shouldUseVisualAnalysis("auto", "Algebra II", "Look at the graph below and identify its x-intercepts."), true);
});

test("honors an explicit visual task override", () => {
  assert.equal(shouldUseVisualAnalysis("visual", "Algebra II", "Solve the equation."), true);
});

test("routes routine prose to the lightweight profile", () => {
  assert.equal(classifyTask("Read this paragraph and summarize it.").kind, "general");
});

test("routes math prompts to reasoning even when an image is attached", () => {
  assert.equal(classifyTask("Calculate the area of the triangle.", 1).kind, "math");
});

test("routes image-only questions to vision", () => {
  assert.equal(classifyTask("Read the diagram and identify the labels.", 1).kind, "visual");
});

test("keeps ordinary readable quiz text on the lightweight profile despite viewport capture", () => {
  const question = "What caused the Great Depression? Read the source paragraph carefully and choose the best explanation. " +
    "The question refers to historical causes, and the paragraph provides the relevant context and evidence needed to choose a response.";
  assert.equal(classifyTask(question, 1).kind, "research");
});

test("supports an explicit task override", () => {
  assert.equal(classifyTask("hello", 0, "reading").kind, "reading");
});

test("does not use web search for mathematics", () => {
  assert.equal(shouldSearch("What is 3 + 4? calculate", "math"), false);
});

test("removes common private details from search queries", () => {
  const query = buildSearchQuery("Name: Alex Smith\nEmail: alex@example.com\nWhat caused the Great Depression?");
  assert.equal(query.includes("alex@example.com"), false);
  assert.equal(query.includes("Alex Smith"), false);
  assert.match(query, /Great Depression/);
});
test("parses the expected compact quiz response", () => {
  const parsed = parseQuizModelResponse('{"items":[{"index":2,"suggestedResponse":"Option B","explanation":"The factor theorem applies to this polynomial.","confidence":0.7,"needsReview":true}]}');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].index, 2);
  assert.equal(parsed.items[0].suggestedResponse, "Option B");
  assert.equal(parsed.items[0].explanation, "The factor theorem applies to this polynomial.");
});

test("recovers a fenced response using alternate model field names", () => {
  const response = "Result:\\n```json\\n" +
    '{"answers":[{"question_number":3,"answer":"Choice C","reason":"Check the theorem","score":0.6}]}' +
    "\\n```";
  const parsed = parseQuizModelResponse(response);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].index, 3);
  assert.equal(parsed.items[0].suggestedResponse, "Choice C");
  assert.equal(parsed.items[0].explanation, "Check the theorem");
});

test("parses a top-level array and ignores reasoning tags", () => {
  const parsed = parseQuizModelResponse('<think>internal note</think> [{"number":1,"response":"Hint","work":"One line"}]');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].index, 1);
  assert.equal(parsed.items[0].suggestedResponse, "Hint");
  assert.equal(parsed.items[0].explanation, "One line");
});

test("returns an empty item list for completely invalid model output", () => {
  assert.deepEqual(parseQuizModelResponse("I cannot format this response."), {
    summary: "The local model did not return a recognizable JSON answer.",
    items: []
  });
});

test("rejects template placeholders instead of displaying them as quiz suggestions", () => {
  const parsed = parseQuizModelResponse(JSON.stringify({
    items: [{
      index: 1,
      suggestedResponse: "brief learning-oriented response",
      explanation: "one concise sentence",
      confidence: 0.5,
      needsReview: true
    }]
  }));
  assert.equal(parsed.items.length, 0);
});

test("keeps actual concise responses and explanations", () => {
  const parsed = parseQuizModelResponse(JSON.stringify({
    items: [{
      index: 2,
      suggestedResponse: "Evaluate the polynomial at the divisor's zero.",
      explanation: "The Remainder Theorem states that dividing by x - a leaves remainder f(a).",
      confidence: 0.75,
      needsReview: false
    }]
  }));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].suggestedResponse, "Evaluate the polynomial at the divisor's zero.");
});

