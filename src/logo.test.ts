import { describe, expect, it } from "vitest";
import { printLogo, renderLogo } from "./logo.js";

describe("CLI logo", () => {
  it("renders a readable plain-text YAJM logo", () => {
    const logo = renderLogo(false);
    expect(logo).toContain("Yet Another Jellyfin Migrator");
    expect(logo).not.toContain("media stays");
    expect(logo).not.toContain("\u001B[");
  });

  it("can write the logo to a supplied output", () => {
    let output = "";
    printLogo({ write: (value) => { output += String(value); return true; } } as NodeJS.WriteStream);
    expect(output).toMatch(/YAJM|Yet Another Jellyfin Migrator/);
    expect(output.endsWith("\n\n")).toBe(true);
  });
});
