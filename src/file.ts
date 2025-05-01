import fs from "fs";
import path from "path";
import { stringify } from "yaml";

export function isFile(filepath: string) {
  if (!filepath) return false;
  try {
    return fs.existsSync(filepath) && fs.lstatSync(filepath).isFile();
  } catch {
    throw new Error(`Error checking for file: ${filepath}`);
  }
}

export function writeFileAtPath(filepath: string, value: string) {
  const dirname = path.dirname(filepath);
  if (!isFile(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
  fs.writeFileSync(filepath, value);
}

export function findFilesMatchingRegex(
  directoryPath: string,
  pattern: RegExp
): string[] {
  try {
    const entries = fs.readdirSync(directoryPath);
    return entries
      .map((entry) => path.join(directoryPath, entry))
      .filter((filepath) => {
        const stat = fs.statSync(filepath);
        return stat.isFile() && pattern.test(filepath);
      });
  } catch (error) {
    throw new Error(`Error searching directory ${directoryPath}: ${error}`);
  }
}
