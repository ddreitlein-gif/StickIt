/**
 * Tiny check-counting test helper, matching the verify_v16.js style.
 * Each test file creates a Checks instance, calls c.ok/c.eq/..., and
 * returns c to the runner, which aggregates pass/fail counts.
 */

class Checks {
  constructor(label) {
    this.label = label;
    this.passed = 0;
    this.failed = 0;
    this.failures = [];
  }

  ok(cond, name) {
    if (cond) {
      this.passed++;
      console.log(`    ✓ ${name}`);
    } else {
      this.failed++;
      this.failures.push(name);
      console.error(`    ✗ ${name}`);
    }
    return !!cond;
  }

  eq(actual, expected, name) {
    const pass = actual === expected;
    if (!pass) {
      return this.ok(false, `${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
    }
    return this.ok(true, name);
  }

  deepEq(actual, expected, name) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      return this.ok(false, `${name}\n      expected: ${b}\n      actual:   ${a}`);
    }
    return this.ok(true, name);
  }

  close(actual, expected, eps, name) {
    return this.ok(Math.abs(actual - expected) <= eps, `${name} (expected ~${expected}, got ${actual})`);
  }

  async throws(fn, re, name) {
    try {
      await fn();
      return this.ok(false, `${name} (expected throw, none happened)`);
    } catch (e) {
      if (re && !re.test(String(e && e.message))) {
        return this.ok(false, `${name} (threw wrong error: ${e.message})`);
      }
      return this.ok(true, name);
    }
  }

  summary() {
    return { label: this.label, passed: this.passed, failed: this.failed, failures: this.failures };
  }
}

module.exports = { Checks };
