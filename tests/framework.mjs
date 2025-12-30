#!/usr/bin/env node

/**
 * LPX Test Framework
 * Generic, declarative testing wrapper around sal-cli.mjs
 * Works with all planning modes: intent, hybrid, llm, heuristic
 *
 * Usage:
 *   import { test, expect, runTests } from './lpx-test.mjs';
 *
 *   test("Log into the app and extract first 2 items", [
 *     expect.toSucceed(),
 *     expect.toExtract({ count: 2 }),
 *   ]);
 *
 *   runTests();
 */

import { spawn } from 'child_process';

// Test registry
const tests = [];

// Color helpers
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

const sym = {
  pass: '✓',
  fail: '✗',
  run: '▶',
};

/**
 * Register a test case
 * @param {string} prompt - Natural language prompt to test
 * @param {Array} expectations - Array of expectation functions
 */
export function test(prompt, expectations = []) {
  tests.push({ prompt, expectations });
}

/**
 * Expectation builders - all generic, no hardcoded logic
 */
export const expect = {
  /**
   * Assert the command succeeded (exit code 0)
   */
  toSucceed() {
    return {
      name: 'succeed',
      async check({ exitCode }) {
        if (exitCode !== 0) {
          return { pass: false, message: `Expected success, got exit code ${exitCode}` };
        }
        return { pass: true };
      },
    };
  },

  /**
   * Assert extraction results
   */
  toExtract({ count, minCount, maxCount }) {
    return {
      name: 'extract',
      async check({ output }) {
        // Parse extraction output from logs
        const match = output.match(/{\s*count:\s*(\d+)/);
        if (!match) {
          return { pass: false, message: 'No extraction output found' };
        }

        const actualCount = parseInt(match[1], 10);
        const failures = [];

        if (count !== undefined && actualCount !== count) {
          failures.push(`expected ${count} items, got ${actualCount}`);
        }
        if (minCount !== undefined && actualCount < minCount) {
          failures.push(`expected at least ${minCount} items, got ${actualCount}`);
        }
        if (maxCount !== undefined && actualCount > maxCount) {
          failures.push(`expected at most ${maxCount} items, got ${actualCount}`);
        }

        if (failures.length > 0) {
          return { pass: false, message: failures.join(', ') };
        }

        return { pass: true };
      },
    };
  },

  /**
   * Assert planning mode was used
   */
  toPlanWith(mode) {
    return {
      name: 'plan_mode',
      async check({ output }) {
        const modeMatch = output.match(/\[LPX\] Planning mode: (\w+)/);
        const actualMode = modeMatch?.[1];

        if (actualMode !== mode) {
          return {
            pass: false,
            message: `expected mode "${mode}", got "${actualMode}"`,
          };
        }

        return { pass: true };
      },
    };
  },

  /**
   * Assert intent classification result
   */
  toClassifyAs({ action, target, requires_login, limit }) {
    return {
      name: 'classify',
      async check({ output }) {
        const intentMatch = output.match(/\[LPX\] Intent: ({.*})/);
        if (!intentMatch) {
          return { pass: false, message: 'No intent classification found' };
        }

        try {
          const intent = JSON.parse(intentMatch[1]);
          const failures = [];

          if (action !== undefined && intent.action !== action) {
            failures.push(`action: expected "${action}", got "${intent.action}"`);
          }
          if (target !== undefined && intent.target !== target) {
            failures.push(`target: expected "${target}", got "${intent.target}"`);
          }
          if (requires_login !== undefined && intent.requires_login !== requires_login) {
            failures.push(`requires_login: expected ${requires_login}, got ${intent.requires_login}`);
          }
          if (limit !== undefined && intent.limit !== limit) {
            failures.push(`limit: expected ${limit}, got ${intent.limit}`);
          }

          if (failures.length > 0) {
            return { pass: false, message: failures.join(', ') };
          }

          return { pass: true };
        } catch (err) {
          return { pass: false, message: `Failed to parse intent: ${err.message}` };
        }
      },
    };
  },

  /**
   * Assert plan generation
   */
  toGeneratePlan({ minSteps, maxSteps, hasAction }) {
    return {
      name: 'plan',
      async check({ output }) {
        // Parse CONCEPTUAL PLAN from output
        const planMatch = output.match(/=== CONCEPTUAL PLAN.*?\n([\s\S]*?)\n=== End Conceptual Plan ===/);
        if (!planMatch) {
          return { pass: false, message: 'No conceptual plan found' };
        }

        const planText = planMatch[1];
        const stepMatches = planText.match(/- id: \d+/g);
        const stepCount = stepMatches?.length || 0;

        const failures = [];

        if (minSteps !== undefined && stepCount < minSteps) {
          failures.push(`expected at least ${minSteps} steps, got ${stepCount}`);
        }
        if (maxSteps !== undefined && stepCount > maxSteps) {
          failures.push(`expected at most ${maxSteps} steps, got ${stepCount}`);
        }
        if (hasAction && !planText.includes(`action: ${hasAction}`)) {
          failures.push(`expected plan to include action "${hasAction}"`);
        }

        if (failures.length > 0) {
          return { pass: false, message: failures.join(', ') };
        }

        return { pass: true };
      },
    };
  },

  /**
   * Assert timing constraints
   */
  toCompleteWithin(maxMs) {
    return {
      name: 'timing',
      async check({ duration }) {
        if (duration > maxMs) {
          return {
            pass: false,
            message: `expected completion within ${maxMs}ms, took ${duration}ms`,
          };
        }
        return { pass: true };
      },
    };
  },

  /**
   * Assert output contains text
   */
  toOutput(text) {
    return {
      name: 'output',
      async check({ output }) {
        if (!output.includes(text)) {
          return {
            pass: false,
            message: `expected output to contain "${text}"`,
          };
        }
        return { pass: true };
      },
    };
  },
};

/**
 * Run a single test by invoking sal-cli.mjs as a subprocess
 */
async function runTest(testCase) {
  const startTime = Date.now();

  return new Promise((resolve) => {
    const child = spawn('node', ['sal-cli.mjs', testCase.prompt], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', async (exitCode) => {
      const duration = Date.now() - startTime;
      const output = stdout + stderr;

      // Run expectations
      const expectationResults = [];
      for (const expectation of testCase.expectations) {
        const checkResult = await expectation.check({
          exitCode,
          output,
          duration,
        });
        expectationResults.push({
          name: expectation.name,
          ...checkResult,
        });
      }

      const passed = expectationResults.every(r => r.pass);

      resolve({
        passed,
        duration,
        exitCode,
        expectations: expectationResults,
        output: output.length > 500 ? output.substring(0, 500) + '...' : output,
      });
    });

    child.on('error', (error) => {
      resolve({
        passed: false,
        duration: Date.now() - startTime,
        error: error.message,
      });
    });
  });
}

/**
 * Run all registered tests
 */
export async function runTests() {
  console.log(`\n${c.bright}${c.cyan}LPX Test Runner${c.reset}\n`);

  const startTime = Date.now();
  const results = [];

  for (let i = 0; i < tests.length; i++) {
    const testCase = tests[i];
    const prompt = testCase.prompt.length > 60
      ? testCase.prompt.substring(0, 57) + '...'
      : testCase.prompt;

    process.stdout.write(`${c.dim}[${i + 1}/${tests.length}]${c.reset} ${sym.run} ${prompt}...`);

    const result = await runTest(testCase);
    results.push({ testCase, result });

    // Clear line and print result
    process.stdout.write('\r\x1b[K');
    const symbol = result.passed ? c.green + sym.pass : c.red + sym.fail;
    const duration = c.dim + `${result.duration}ms` + c.reset;
    console.log(`${symbol}${c.reset} ${prompt} ${duration}`);

    // Show failures
    if (!result.passed) {
      if (result.error) {
        console.log(`  ${c.red}Error: ${result.error}${c.reset}`);
      } else {
        result.expectations
          .filter(e => !e.pass)
          .forEach(e => {
            console.log(`  ${c.red}${e.name}: ${e.message}${c.reset}`);
          });
      }
    }
  }

  // Summary
  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.result.passed).length;
  const failed = results.length - passed;
  const percentage = Math.round((passed / results.length) * 100);

  // Format total duration for display
  const totalSeconds = (totalDuration / 1000).toFixed(2);
  const totalTimeStr = totalDuration >= 1000
    ? `${totalSeconds}s (${totalDuration}ms)`
    : `${totalDuration}ms`;

  console.log(`\n${c.dim}${'─'.repeat(60)}${c.reset}`);

  if (failed === 0) {
    console.log(`${c.green}${c.bright}✓ ${percentage}% passed${c.reset} ${c.dim}(${passed}/${results.length} tests)${c.reset}`);
  } else {
    console.log(`${c.red}${c.bright}${percentage}% passed${c.reset} ${c.dim}(${passed}/${results.length} tests, ${failed} failed)${c.reset}`);

    // List failed tests
    console.log(`\n${c.red}Failed tests:${c.reset}`);
    results
      .filter(r => !r.result.passed)
      .forEach(({ testCase }) => {
        console.log(`  ${c.red}${sym.fail}${c.reset} ${testCase.prompt}`);
      });
  }

  // Total time at the end
  console.log(`${c.dim}Total time: ${c.reset}${c.bright}${totalTimeStr}${c.reset}`);
  console.log();

  process.exit(failed > 0 ? 1 : 0);
}
