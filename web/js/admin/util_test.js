import { assert, assertEquals } from "jsr:@std/assert@1";
import { addDays, csvCell, digits, normPlate, safeTerm, toCsv } from "./util.js";

Deno.test("csvCell quotes special characters", () => {
  assertEquals(csvCell("plain"), "plain");
  assertEquals(csvCell('say "hi"'), '"say ""hi"""');
  assertEquals(csvCell("a,b"), '"a,b"');
  assertEquals(csvCell("line\nbreak"), '"line\nbreak"');
  assertEquals(csvCell(null), "");
  assertEquals(csvCell(5), "5");
});

Deno.test("csvCell neutralises spreadsheet formulas", () => {
  for (const evil of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", '=HYPERLINK("http://x","y")']) {
    assert(csvCell(evil).replace(/^"/, "").startsWith("'"), evil);
  }
  assertEquals(csvCell("SMP-1001"), "SMP-1001"); // dash inside is fine
});

Deno.test("toCsv joins rows with CRLF", () => {
  assertEquals(toCsv([["a", "b"], ["1", "x,y"]]), 'a,b\r\n1,"x,y"');
});

Deno.test("safeTerm strips PostgREST filter syntax", () => {
  assertEquals(safeTerm("a,b)(c*%d"), "a b  c  d");
  assertEquals(safeTerm("  hi  "), "hi");
  assertEquals(safeTerm(null), "");
  assertEquals(safeTerm("x".repeat(100)).length, 60);
});

Deno.test("normalisers match the database", () => {
  assertEquals(normPlate("abc-123 x"), "ABC123X");
  assertEquals(digits("+63 912-345"), "63912345");
});

Deno.test("addDays crosses month and year boundaries", () => {
  assertEquals(addDays("2026-11-30", 1), "2026-12-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});
