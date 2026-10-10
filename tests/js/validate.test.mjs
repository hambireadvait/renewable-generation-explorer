import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNumber, checkYears, parsePowerCurve, setPath, getPath } from "../../static/js/validate.js";

test("parsePowerCurve accepts header, comments and separators", () => {
  const { points, errors } = parsePowerCurve("speed,power\n3, 0\n4;100 # comment\n5\t300\n\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(points, [[3, 0], [4, 100], [5, 300]]);
});

test("parsePowerCurve rejects non-increasing and short curves", () => {
  assert.ok(parsePowerCurve("3,0\n2,5\n4,9").errors.some((e) => e.includes("increasing")));
  assert.ok(parsePowerCurve("3,0\n4,5").errors.some((e) => e.includes("3 points")));
  assert.ok(parsePowerCurve("3,0\n4,-5\n5,9").errors.length > 0);
  assert.ok(parsePowerCurve("3,0\nfoo,bar\n5,9").errors.length > 0);
});

test("checkNumber rules", () => {
  assert.equal(checkNumber("", { required: true }), "Required");
  assert.equal(checkNumber("", {}), null);
  assert.equal(checkNumber("abc", {}), "Must be a number");
  assert.equal(checkNumber("0", { exclusiveMin: 0 }), "Must be greater than 0");
  assert.equal(checkNumber("1.5", { integer: true }), "Must be a whole number");
  assert.equal(checkNumber("91", { max: 90 }), "Must be ≤ 90");
  assert.equal(checkNumber("45", { min: -90, max: 90 }), null);
});

test("checkYears", () => {
  assert.equal(checkYears(2021, 2025, 2001, 2025), null);
  assert.match(checkYears(1999, 2005, 2001, 2025), /starts in 2001/);
  assert.match(checkYears(2021, 2026, 2001, 2025), /complete past year/);
  assert.match(checkYears(2000, 2025, 1950, 2025), /20 years/);
});

test("setPath / getPath", () => {
  const o = {};
  setPath(o, "finance.solar.capex_per_kw", 5);
  assert.equal(getPath(o, "finance.solar.capex_per_kw"), 5);
  assert.equal(getPath(o, "finance.wind.capex_per_kw"), undefined);
});
