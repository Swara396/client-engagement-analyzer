import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Start the server and assign it to a variable to tweak configuration properties
const server = app.listen(port, "0.0.0.0", (err?: any) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Give heavy CPU tasks (like large audio diarization) up to 15 minutes to finish
if (server) {
  server.timeout = 900000; // 15 minutes in milliseconds
}