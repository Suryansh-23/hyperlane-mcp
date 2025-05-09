import fs from "fs";
import os from "os";
import path from "path";
import {
    DocumentOptions,
    LineCounter,
    ParseOptions,
    SchemaOptions,
    ToJSOptions,
    parse,
    stringify as yamlStringify,
} from "yaml";

const yamlParse = (
    content: string,
    options?: ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions
) => parse(content, { maxAliasCount: -1, ...options });

export type FileFormat = "yaml" | "json";

function isFile(filepath: string) {
    if (!filepath) return false;
    try {
        return fs.existsSync(filepath) && fs.lstatSync(filepath).isFile();
    } catch {
        console.log(`Error checking for file: ${filepath}`);
        return false;
    }
}

function readFileAtPath(filepath: string) {
    if (!isFile(filepath)) {
        throw Error(`File doesn't exist at ${filepath}`);
    }
    return fs.readFileSync(filepath, "utf8");
}

function writeFileAtPath(filepath: string, value: string) {
    const dirname = path.dirname(filepath);
    if (!isFile(dirname)) {
        fs.mkdirSync(dirname, { recursive: true });
    }
    fs.writeFileSync(filepath, value);
}

function readJson<T>(filepath: string): T {
    return JSON.parse(readFileAtPath(filepath)) as T;
}

function readYaml<T>(filepath: string): T {
    return yamlParse(readFileAtPath(filepath)) as T;
}

function writeYaml(filepath: string, obj: any) {
    writeFileAtPath(
        filepath,
        yamlStringify(obj, { indent: 2, sortMapEntries: true }) + "\n"
    );
}

export function readYamlOrJson<T>(filepath: string, format?: FileFormat): T {
    return resolveYamlOrJsonFn(filepath, readJson, readYaml, format);
}

export function writeYamlOrJson(
    filepath: string,
    obj: Record<string, any>,
    format?: FileFormat
) {
    return resolveYamlOrJsonFn(
        filepath,
        (f: string) => writeJson(f, obj),
        (f: string) => writeYaml(f, obj),
        format
    );
}

function writeJson(filepath: string, obj: any) {
    writeFileAtPath(filepath, JSON.stringify(obj, null, 2) + "\n");
}

function resolveYamlOrJsonFn(
    filepath: string,
    jsonFn: any,
    yamlFn: any,
    format?: FileFormat
) {
    const fileFormat = resolveFileFormat(filepath, format);
    if (!fileFormat) {
        throw new Error(`Invalid file format for ${filepath}`);
    }

    if (fileFormat === "json") {
        return jsonFn(filepath);
    }

    return yamlFn(filepath);
}

function resolveFileFormat(
    filepath?: string,
    format?: FileFormat
): FileFormat | undefined {
    if (!filepath) {
        return format;
    }

    if (format === "json" || filepath?.endsWith(".json")) {
        return "json";
    }

    if (
        format === "yaml" ||
        filepath?.endsWith(".yaml") ||
        filepath?.endsWith(".yml")
    ) {
        return "yaml";
    }

    return undefined;
}
