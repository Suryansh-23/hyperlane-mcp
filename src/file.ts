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

export function writeYaml(filepath: string, obj: any) {
  writeFileAtPath(
    filepath,
    stringify(obj, { indent: 2, sortMapEntries: true }) + "\n"
  );
}


