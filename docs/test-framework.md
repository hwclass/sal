# SAL Test Framework

Modern, declarative testing framework for AI-driven browser automation.

## Features

✅ **Zero Configuration** - Works out of the box with all planning modes
✅ **Natural Language** - Tests use the same prompts as production
✅ **Beautiful Output** - Color-coded results with progress indicators
✅ **Flexible Assertions** - Generic expectations that work with any app
✅ **Fast Feedback** - Percentage-based summary with clear failure reporting

## Quick Start

```javascript
import { test, expect, runTests } from './sal-test.mjs';

// Define test cases
test("Log into the app and extract the first 2 items", [
  expect.toSucceed(),
  expect.toExtract({ count: 2 }),
]);

// Run all tests
runTests();
```

Run tests:
```bash
npm test
```

## Expectation API

### `expect.toSucceed()`
Asserts the SAL command completed successfully (exit code 0).

```javascript
test("Basic login workflow", [
  expect.toSucceed(),
]);
```

### `expect.toExtract({ count?, minCount?, maxCount? })`
Asserts extraction results match expectations.

```javascript
test("Extract exactly 5 items", [
  expect.toExtract({ count: 5 }),
]);

test("Extract at least 1 item", [
  expect.toExtract({ minCount: 1 }),
]);

test("Extract between 1-10 items", [
  expect.toExtract({ minCount: 1, maxCount: 10 }),
]);
```

### `expect.toClassifyAs({ action?, target?, requires_login?, limit? })`
Asserts intent classification results (only works in `intent` planning mode).

```javascript
test("Classification test", [
  expect.toClassifyAs({
    action: "extract",
    target: "items",
    requires_login: true,
  }),
]);
```

### `expect.toPlanWith(mode)`
Asserts the expected planning mode was used.

```javascript
test("Verify planning mode", [
  expect.toPlanWith("intent"),
]);
```

### `expect.toCompleteWithin(maxMs)`
Asserts execution completes within time limit.

```javascript
test("Performance test", [
  expect.toCompleteWithin(5000), // 5 seconds max
]);
```

### `expect.toOutput(text)`
Asserts output contains specific text.

```javascript
test("Check output", [
  expect.toOutput("CONCEPTUAL PLAN"),
]);
```

## Example Test Suite

```javascript
import { test, expect, runTests } from './sal-test.mjs';

// Extraction tests
test("Extract first 1 item", [
  expect.toSucceed(),
  expect.toExtract({ count: 1 }),
]);

test("Extract all items", [
  expect.toSucceed(),
  expect.toExtract({ minCount: 1 }),
]);

// Performance test
test("Complete within 5 seconds", [
  expect.toSucceed(),
  expect.toCompleteWithin(5000),
]);

// Planning mode test
test("Verify intent planning", [
  expect.toSucceed(),
  expect.toPlanWith("intent"),
]);

runTests();
```

## Output Example

```
SAL Test Runner

✓ Log into the app and extract the first 1 item 4496ms
✓ Log into the app and extract the first 2 items 3152ms
✓ Log into the app and extract the first 5 items 3089ms
✓ Log into the app and extract the items list 3102ms
✓ Extract all available items from the items page 2876ms
✓ Verify planning mode is used correctly 3060ms
✓ Complete a simple extraction within 5 seconds 2856ms

────────────────────────────────────────────────────────────
✓ 100% passed (7/7 tests, 22634ms)
```

## Failure Reporting

When tests fail, you get clear diagnostics:

```
SAL Test Runner

✓ Test that passes 2500ms
✗ Test that fails 3200ms
  extract: expected 5 items, got 3
  timing: expected completion within 2000ms, took 3200ms

────────────────────────────────────────────────────────────
71% passed (5/7 tests, 2 failed, 18500ms)

Failed tests:
  ✗ Test that fails
  ✗ Another failed test
```

## Running Tests with Different Planning Modes

```bash
# Test with intent mode (default)
PLANNING_MODE=intent npm test

# Test with hybrid mode
PLANNING_MODE=hybrid npm test

# Test with heuristic mode (no LLM)
PLANNING_MODE=heuristic npm test

# Test with LLM mode
PLANNING_MODE=llm npm test
```

## Best Practices

1. **Use Natural Language**: Tests should read like user stories
   ```javascript
   // ✅ Good
   test("Log into the app and extract the first 5 items", [...]);

   // ❌ Bad
   test("login_extract_5", [...]);
   ```

2. **Focus on Outcomes**: Assert what matters, not implementation details
   ```javascript
   // ✅ Good
   expect.toExtract({ count: 5 })

   // ❌ Bad
   expect.toGeneratePlan({ hasAction: "fill_field" })
   ```

3. **Keep Tests Simple**: One test per user scenario
   ```javascript
   // ✅ Good
   test("Extract 2 items", [expect.toExtract({ count: 2 })]);

   // ❌ Bad
   test("Complex multi-assertion test", [/* 10 expectations */]);
   ```

4. **Use Flexible Assertions**: Prefer ranges over exact values when appropriate
   ```javascript
   // ✅ Good - works with any number of items
   expect.toExtract({ minCount: 1 })

   // ❌ Bad - brittle if data changes
   expect.toExtract({ count: 42 })
   ```

## Integration with CI/CD

The test framework exits with code 1 on failure, making it perfect for CI:

```yaml
# .github/workflows/test.yml
- name: Run SAL Tests
  run: docker compose exec automation npm test
```

## Architecture

The framework is a thin wrapper around `sal-cli.mjs`:

1. Spawns `sal-cli.mjs` as subprocess for each test
2. Captures stdout/stderr output
3. Parses output to extract relevant data (intent, extraction counts, etc.)
4. Runs expectations against parsed data
5. Reports results with beautiful formatting

This design ensures:
- **Zero Coupling**: Framework doesn't depend on internal implementation
- **Works Everywhere**: Same tests work across all planning modes
- **Easy to Extend**: Add new expectations by parsing output
- **Real-World Testing**: Tests run the actual CLI, not mocked versions

## Contributing

To add new expectation types:

1. Add a new method to the `expect` object in `sal-test.mjs`
2. Parse relevant data from the output
3. Return `{ pass: boolean, message?: string }`

Example:

```javascript
export const expect = {
  // ... existing expectations

  toNavigateToUrl(expectedUrl) {
    return {
      name: 'navigation',
      async check({ output }) {
        const match = output.match(/Current URL: (https?:\/\/[^\s]+)/);
        const actualUrl = match?.[1];

        if (actualUrl !== expectedUrl) {
          return {
            pass: false,
            message: `expected "${expectedUrl}", got "${actualUrl}"`,
          };
        }

        return { pass: true };
      },
    };
  },
};
```

## License

Same as sal-demo project.
