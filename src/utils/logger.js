const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config/config');

// Ensure logs directory exists
const logDir = path.dirname(config.logging.file);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'paycrypt-email-server' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
    }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Email-specific logging methods
logger.emailReceived = (emailId, from, to, subject) => {
  logger.info('Email received', {
    emailId,
    from,
    to,
    subject,
    timestamp: new Date().toISOString()
  });
};

logger.emailParsed = (emailId, transactionData) => {
  logger.info('Email parsed successfully', {
    emailId,
    transactionData,
    timestamp: new Date().toISOString()
  });
};

logger.emailError = (emailId, error, context = {}) => {
  logger.error('Email processing error', {
    emailId,
    error: error.message,
    stack: error.stack,
    context,
    timestamp: new Date().toISOString()
  });
};

logger.emailSaved = (emailId, filePath) => {
  logger.info('Email saved to storage', {
    emailId,
    filePath,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;
