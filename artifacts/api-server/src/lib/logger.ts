import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
// Pretty output is for a developer's terminal; a unit suite bundles this module and has no worker to hand it to.
const prettyOutput = !isProduction && process.env.NODE_ENV !== "test";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(!prettyOutput
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
