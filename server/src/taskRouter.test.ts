import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchQuery, classifyTask, shouldSearch } from "./taskRouter.js";

test("routes routine prose to the lightweight profile", () => {
  assert.equal(classifyTask("Read this paragraph and summarize it.").kind, "general");
});

test("routes math prompts to reasoning even when an image is attached", () => {
  assert.equal(classifyTask("Calculate the area of the triangle.", 1).kind, "math");
});

test("routes image-only questions to vision", () => {
  assert.equal(classifyTask("Read the diagram and identify the labels.", 1).kind, "visual");
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