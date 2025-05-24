import fs from 'fs';

// Set up file logging
const logFile = fs.createWriteStream('./run.log', {
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
