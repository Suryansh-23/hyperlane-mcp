import fs from 'fs';
import path from 'path';

const homeDir = process.env.HOME || process.env.CACHE_DIR;

let logDir;
if (homeDir) {
  logDir = path.join(homeDir, '.hyperlane-mcp');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
}

// Set up file logging
const logFile = fs.createWriteStream(`${logDir}/run.log`, {
  flags: 'a',
});

const logger = {
  info: (message: string) => {
    const timestamp = new Date().toISOString();
    logFile.write(`[${timestamp}] INFO: ${message}\n`);
  },
  error: (message: string) => {
    const timestamp = new Date().toISOString();
    logFile.write(`[${timestamp}] ERROR: ${message}\n`);
  },
};

export default logger;
