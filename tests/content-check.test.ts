import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { contentMatchesType } from "@/lib/documents/content-check";
import { ACCEPTED } from "@/lib/documents/limits";

/**
 * The declared type is the browser's guess from the filename, so the bytes are
 * checked against it. Real files where there are real fixtures; hand-built
 * headers for the rest.
 */
const fixture = (name: string) => readFileSync(join(process.cwd(), "tests/fixtures", name));

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("IHDR")]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const XLSX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("....[Content_Types].xml....xl/workbook.xml...."),
]);
/** A Windows executable's first bytes, the thing most worth catching under a false name. */
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62), Buffer.from("This program cannot be run in DOS mode")]);
const PLAIN_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("payload.exe")]);

describe("files that are what they say", () => {
  it("accepts a real PDF and a real Word document", () => {
    assert.ok(contentMatchesType(PDF, fixture("simple-text.pdf")));
    assert.ok(contentMatchesType(PDF, fixture("graphics-heavy.pdf")));
    assert.ok(contentMatchesType(DOCX, fixture("agreement.docx")));
  });

  it("accepts a PDF with bytes before its header, as readers do", () => {
    assert.ok(contentMatchesType(PDF, Buffer.concat([Buffer.alloc(16, 0x20), Buffer.from("%PDF-1.7\n")])));
  });

  it("accepts the images and an Excel workbook", () => {
    assert.ok(contentMatchesType(XLSX, XLSX_BYTES));
    assert.ok(contentMatchesType("image/png", PNG));
    assert.ok(contentMatchesType("image/jpeg", JPEG));
  });

  it("accepts text and CSV in UTF-8, with or without a byte-order mark", () => {
    assert.ok(contentMatchesType("text/plain", Buffer.from("Schedule 2 — processing details\n")));
    assert.ok(contentMatchesType("text/csv", Buffer.from("﻿supplier,country\nAcme,Ireland\n")));
  });

  it("has a check for every accepted type", () => {
    // Nothing on the allowlist may be waved through for want of a check.
    for (const type of ACCEPTED.keys()) {
      assert.equal(contentMatchesType(type, EXE), false, `${type} accepted an executable`);
    }
  });
});

describe("files that are not", () => {
  it("refuses an executable renamed as a document or an image", () => {
    for (const type of [PDF, DOCX, XLSX, "image/png", "image/jpeg", "text/plain", "text/csv"]) {
      assert.equal(contentMatchesType(type, EXE), false, type);
    }
  });

  it("refuses a plain zip renamed .docx, and a Word document called a workbook", () => {
    assert.equal(contentMatchesType(DOCX, PLAIN_ZIP), false);
    assert.equal(contentMatchesType(XLSX, fixture("agreement.docx")), false);
    assert.equal(contentMatchesType(DOCX, XLSX_BYTES), false);
  });

  it("refuses one image named as the other, and a PDF named as a picture", () => {
    assert.equal(contentMatchesType("image/png", JPEG), false);
    assert.equal(contentMatchesType("image/jpeg", PNG), false);
    assert.equal(contentMatchesType("image/png", fixture("simple-text.pdf")), false);
  });

  it("refuses binary or non-UTF-8 bytes as text", () => {
    assert.equal(contentMatchesType("text/plain", fixture("simple-text.pdf")), false);
    assert.equal(contentMatchesType("text/csv", Buffer.from([0x61, 0x2c, 0x00, 0x62])), false);
    // Windows-1252 "café", which is not valid UTF-8.
    assert.equal(contentMatchesType("text/csv", Buffer.from([0x63, 0x61, 0x66, 0xe9])), false);
  });

  it("refuses the retired pre-2007 Office formats, even when the bytes are genuine", () => {
    assert.equal(contentMatchesType("application/msword", OLE), false);
    assert.equal(contentMatchesType("application/vnd.ms-excel", OLE), false);
    assert.equal(contentMatchesType(DOCX, OLE), false);
  });

  it("refuses a type that is not on the list at all", () => {
    assert.equal(contentMatchesType("text/html", Buffer.from("<html></html>")), false);
    assert.equal(contentMatchesType("", fixture("simple-text.pdf")), false);
  });
});
