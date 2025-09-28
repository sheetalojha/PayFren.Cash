#!/usr/bin/env node

// Load environment variables
require('dotenv').config();

const PayCryptEmailServer = require('./services/PayCryptEmailServer');
const logger = require('./utils/logger');
const config = require('./config/config');

class PayCryptServer {
  constructor() {
    this.emailServer = new PayCryptEmailServer();
    this.isShuttingDown = false;
  }

  /**
   * Start the PayCrypt server
   */
  async start() {
    try {
      logger.info('Starting PayCrypt Email Server...');
      
      // Start SMTP server
      await this.emailServer.start();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      logger.info('PayCrypt Email Server started successfully', {
        smtp: {
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure
        },
        storage: {
          path: config.storage.emlPath
        }
      });

    } catch (error) {
      logger.error('Failed to start PayCrypt server', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        logger.warn('Forced shutdown initiated');
        process.exit(1);
      }

      this.isShuttingDown = true;
      logger.info(`Received ${signal}, starting graceful shutdown...`);

      try {
        // Stop email server
        await this.emailServer.stop();
        
        logger.info('PayCrypt server shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error: error.message });
        process.exit(1);
      }
    };

    // Handle different termination signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
      shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', { reason, promise });
      shutdown('unhandledRejection');
    });
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      status: this.isShuttingDown ? 'shutting_down' : 'running',
      uptime: process.uptime(),
      stats: this.emailServer.getStats(),
      config: {
        smtp: {
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure
        },
        storage: {
          path: config.storage.emlPath
        }
      }
    };
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new PayCryptServer();
  server.start();
}

module.exports = PayCryptServer;
