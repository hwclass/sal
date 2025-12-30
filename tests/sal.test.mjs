#!/usr/bin/env node

/**
 * LPX Test Suite
 * Example tests demonstrating natural language automation
 * Works with all planning modes (intent, hybrid, llm, heuristic)
 */

import { test, expect, runTests } from './lpx-test.mjs';

// ============================================================================
// Extraction Tests - Just verify the prompt works as expected
// ============================================================================

test("Log into the app and extract the first 1 item", [
  expect.toSucceed(),
  expect.toExtract({ count: 1 }),
]);

test("Log into the app and extract the first 2 items", [
  expect.toSucceed(),
  expect.toExtract({ count: 2 }),
]);

test("Log into the app and extract the first 5 items", [
  expect.toSucceed(),
  expect.toExtract({ count: 5 }),
]);

test("Log into the app and extract the items list", [
  expect.toSucceed(),
  expect.toExtract({ minCount: 1 }), // Should get all items
]);

test("Extract all available items from the items page", [
  expect.toSucceed(),
  expect.toExtract({ minCount: 1 }),
]);

// ============================================================================
// Planning Mode Verification
// ============================================================================

test("Verify planning mode is used correctly", [
  expect.toSucceed(),
  expect.toPlanWith(process.env.PLANNING_MODE || 'hybrid'),
]);

// ============================================================================
// Performance Tests
// ============================================================================

test("Complete a simple extraction within 5 seconds", [
  expect.toSucceed(),
  expect.toCompleteWithin(5000),
]);

// ============================================================================
// Run All Tests
// ============================================================================

runTests();
