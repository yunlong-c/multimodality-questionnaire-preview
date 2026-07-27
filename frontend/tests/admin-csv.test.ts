import assert from "node:assert/strict";
import test from "node:test";
import {
  csvCell,
  csvDocument,
  neutralizeSpreadsheetFormula,
} from "../src/adminCsv";

test("admin CSV neutralizes spreadsheet formula and control prefixes", () => {
  for (const dangerous of [
    "=2+2",
    "+cmd",
    "-2+3",
    "@SUM(A1:A2)",
    "\t=2+2",
    "\r=2+2",
    "\n=2+2",
    "\u0000=2+2",
    "\u001F=2+2",
    "\u007F=2+2",
    "\u0085=2+2",
  ]) {
    assert.equal(
      neutralizeSpreadsheetFormula(dangerous),
      `'${dangerous}`,
    );
  }
});

test("admin CSV preserves strict negative numbers and ordinary text", () => {
  for (const safe of [
    "-3",
    "-3.50",
    "-3.",
    "-.5",
    "-1e3",
    "-1.2E-3",
    "ordinary text",
    "0",
  ]) {
    assert.equal(neutralizeSpreadsheetFormula(safe), safe);
  }

  for (const unsafeMinusText of [
    "-3+2",
    "--3",
    "-@SUM(A1:A2)",
    "-Infinity",
    "-3\t=2+2",
  ]) {
    assert.equal(
      neutralizeSpreadsheetFormula(unsafeMinusText),
      `'${unsafeMinusText}`,
    );
  }
});

test("admin CSV applies safety before RFC-style quoting", () => {
  assert.equal(csvCell("=2+2"), "\"'=2+2\"");
  assert.equal(csvCell("-3.5"), "\"-3.5\"");
  assert.equal(csvCell(-3.5), "\"-3.5\"");
  assert.equal(csvCell('normal "quoted" text'), '"normal ""quoted"" text"');
  assert.equal(csvCell(null), "");

  const csv = csvDocument(
    ["participant_id", "prediction"],
    [
      {
        participant_id: "+formula",
        prediction: -42,
      },
    ],
  );
  assert.equal(
    csv,
    '"participant_id","prediction"\r\n"\'+formula","-42"',
  );
});
