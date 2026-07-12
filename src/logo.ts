const LOGO_LINES = [
  "       *         .                         .         *",
  "           __   __   _        _   __  __",
  "           \\ \\ / /  / \\      | | |  \\/  |",
  "            \\ V /  / _ \\  _  | | | |\\/| |",
  "             | |  / ___ \\| |_| | | |  | |",
  "             |_| /_/   \\_\\____/  |_|  |_|",
  " .          Yet Another Jellyfin Migrator          .",
  "  *                       .                       *"
] as const;

const COLORS = [201, 207, 213, 219, 225, 219, 213, 207] as const;

export function renderLogo(color = supportsColor()): string {
  if (!color) return LOGO_LINES.join("\n");
  return LOGO_LINES.map((line, index) => `\u001B[1;38;5;${COLORS[index]}m${line}\u001B[0m`).join("\n");
}

export function printLogo(output: Pick<NodeJS.WriteStream, "write"> = process.stdout): void {
  output.write(`${renderLogo(output === process.stdout && supportsColor())}\n\n`);
}

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
}
