// src/logger.ts
import { createLogger, format, transports } from 'winston';

const logger = createLogger({
  level: 'info',
  // Combine multiple formatters
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), // More readable timestamp
    format.errors({ stack: true }), // Ensure errors include stack traces
    format.splat(), // Necessary for string interpolation like %s, %d
    format.colorize(), // Add colors to the output level
    // Define a custom printf format
    format.printf(({ timestamp, level, message, stack }) => {
      // If there's a stack trace, print it on a new line after the message
      if (stack) {
        // Useful for errors
        return `${timestamp} ${level}: ${message}\n${stack}`;
      }
      // Otherwise, just print the standard log message
      return `${timestamp} ${level}: ${message}`;
    }),
  ),
  transports: [
    // Log to the console
    new transports.Console(),
    // Optionally add file transports with different formats if needed
    // e.g., a JSON format for file logging
    // new transports.File({
    //   filename: 'combined.log',
    //   format: format.combine(
    //     format.timestamp(),
    //     format.json() // Use JSON format for file logs
    //   )
    // }),
    // new transports.File({
    //   filename: 'error.log',
    //   level: 'error',
    //   format: format.combine(
    //     format.timestamp(),
    //     format.json()
    //   )
    // })
  ],
});

export default logger;
