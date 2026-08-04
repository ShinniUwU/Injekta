// src/logger.ts
import { createLogger, format, transports } from 'winston';
import util from 'util'; // Import the 'util' module

// Helper function to format metadata, including errors, nicely
const formatMeta = (meta: Record<PropertyKey, unknown>): string => {
  // Filter out common properties already handled (timestamp, level, message, stack)
  const metaToInspect = { ...meta };
  delete metaToInspect.timestamp;
  delete metaToInspect.level;
  delete metaToInspect.message;
  delete metaToInspect.stack;
  delete metaToInspect[Symbol.for('level')]; // Remove Winston's internal level symbol
  delete metaToInspect[Symbol.for('message')]; // Remove Winston's internal message symbol
  delete metaToInspect[Symbol.for('splat')]; // Remove Winston's internal splat symbol

  // Check if there's anything left to inspect
  if (Object.keys(metaToInspect).length === 0) {
    return '';
  }

  // Use util.inspect for potentially deep objects, enable colors for console
  // Set depth high enough to see nested properties in pgError
  const inspected = util.inspect(metaToInspect, {
    depth: 5,
    colors: true,
    compact: true,
  });

  // Only return if there's something meaningful besides an empty object representation
  if (inspected !== '{}' && inspected !== 'undefined' && inspected !== 'null') {
    return ` ${inspected}`; // Add a space before metadata
  }
  return '';
};

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }), // Keep stack traces for Error objects
    format.splat(),
    format.colorize(),
    // Updated printf format
    format.printf(({ timestamp, level, message, stack, ...meta }) => {
      let logMessage = `${timestamp} ${level}: ${message}`;

      // Append any other metadata found, using our helper function
      // This should now properly format the { pgError: ... } object
      const metaString = formatMeta(meta);
      if (metaString) {
        logMessage += metaString;
      }

      // If there's a stack trace (from format.errors), append it *after* metadata
      // Useful for application-level errors, less so for DB errors handled via meta
      if (stack) {
        logMessage += `\n${stack}`;
      }

      return logMessage;
    }),
  ),
  transports: [
    new transports.Console(),
    // Optional file transports remain commented out
  ],
});

export default logger;
