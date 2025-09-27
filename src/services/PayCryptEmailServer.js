const { SMTPServer } = require('smtp-server');
const config = require('../config/config');
const logger = require('../utils/logger');
const EmailParser = require('./EmailParser');
const EMLStorageService = require('./EMLStorageService');

class PayCryptEmailServer {
  constructor() {
    this.emailParser = new EmailParser();
    this.emlStorage = new EMLStorageService();
    this.rateLimiter = new Map();
    this.connectionCounts = new Map();
    
    this.server = new SMTPServer({
      port: config.smtp.port,
      host: config.smtp.host,
      secure: config.smtp.secure,
      authOptional: config.smtp.authOptional,
      logger: config.smtp.logger,
      banner: config.smtp.banner,
      disabledCommands: config.smtp.disabledCommands,
      size: config.smtp.size,
      
      onConnect: this.onConnect.bind(this),
      onMailFrom: this.onMailFrom.bind(this),
      onRcptTo: this.onRcptTo.bind(this),
      onData: this.onData.bind(this),
      onClose: this.onClose.bind(this),
      onError: this.onError.bind(this),
    });
  }

  /**
   * Handle new SMTP connection
   * @param {Object} session - SMTP session
   * @param {Function} callback - Callback function
   */
  onConnect(session, callback) {
    const clientIP = session.remoteAddress;
    
    if (this.isRateLimited(clientIP)) {
      logger.warn('Connection rate limited', { clientIP });
      return callback(new Error('Rate limit exceeded'));
    }

    if (this.isConnectionLimitExceeded(clientIP)) {
      logger.warn('Connection limit exceeded', { clientIP });
      return callback(new Error('Too many connections from this IP'));
    }

    this.incrementConnectionCount(clientIP);
    
    logger.info('New SMTP connection', { 
      clientIP, 
      hostname: session.hostname,
      connectionCount: this.connectionCounts.get(clientIP) || 0
    });

    callback();
  }

  /**
   * Handle MAIL FROM command
   * @param {Object} address - Sender address
   * @param {Object} session - SMTP session
   * @param {Function} callback - Callback function
   */
  onMailFrom(address, session, callback) {
    const senderEmail = address.address.toLowerCase();
    
    if (!this.emailParser.isValidEmail(senderEmail)) {
      logger.warn('Invalid sender email format', { senderEmail });
      return callback(new Error('Invalid sender email format'));
    }

    // Check if sender domain is allowed (if configured)
    // if (config.email.allowedDomains.length > 0) {
    //   const senderDomain = senderEmail.split('@')[1];
    //   if (!config.email.allowedDomains.includes(senderDomain)) {
    //     logger.warn('Sender domain not allowed', { senderEmail, senderDomain });
    //     return callback(new Error('Sender domain not allowed'));
    //   }
    // }

    logger.info('MAIL FROM accepted', { senderEmail });
    callback();
  }

  /**
   * Handle RCPT TO command
   * @param {Object} address - Recipient address
   * @param {Object} session - SMTP session
   * @param {Function} callback - Callback function
   */
  onRcptTo(address, session, callback) {
    const recipientEmail = address.address.toLowerCase();
    
    if (!this.emailParser.isValidEmail(recipientEmail)) {
      logger.warn('Invalid recipient email format', { recipientEmail });
      return callback(new Error('Invalid recipient email format'));
    }

    logger.info('RCPT TO accepted', { recipientEmail });
    callback();
  }

  /**
   * Handle email data
   * @param {Object} stream - Email data stream
   * @param {Object} session - SMTP session
   * @param {Function} callback - Callback function
   */
  async onData(stream, session, callback) {
    try {
      let emailBuffer = Buffer.alloc(0);
      
      stream.on('data', (chunk) => {
        emailBuffer = Buffer.concat([emailBuffer, chunk]);
      });

      stream.on('end', async () => {
        try {
          await this.processEmail(emailBuffer, session);
          logger.info('Email processed successfully', { 
            clientIP: session.remoteAddress,
            size: emailBuffer.length 
          });
          callback();
        } catch (error) {
          logger.error('Email processing failed', { 
            error: error.message,
            clientIP: session.remoteAddress 
          });
          callback(error);
        }
      });

      stream.on('error', (error) => {
        logger.error('Email stream error', { 
          error: error.message,
          clientIP: session.remoteAddress 
        });
        callback(error);
      });

    } catch (error) {
      logger.error('Error in onData handler', { error: error.message });
      callback(error);
    }
  }

  /**
   * Process incoming email
   * @param {Buffer} emailBuffer - Raw email buffer
   * @param {Object} session - SMTP session
   */
  async processEmail(emailBuffer, session) {
    let emailData = null;
    
    try {
      emailData = await this.emailParser.parseEmail(emailBuffer);
      
      logger.emailReceived(
        emailData.id,
        emailData.from,
        emailData.to,
        emailData.subject
      );

      // Save EML file
      const emlPath = await this.emlStorage.saveEML(emailData.id, emailBuffer, {
        from: emailData.from,
        to: emailData.to,
        cc: emailData.cc,
        bcc: emailData.bcc,
        subject: emailData.subject,
        date: emailData.date,
        messageId: emailData.messageId,
        clientIP: session.remoteAddress,
        hostname: session.hostname
      });

      if (emailData.isValidTransaction) {
        logger.emailParsed(emailData.id, emailData.transactionData);
        
        // TODO: Queue the transaction for processing
        // TODO: Generate zero-knowledge proof
        // TODO: Submit to blockchain
        // TODO: Send notification emails

        logger.info('Valid PayCrypt transaction detected', {
          emailId: emailData.id,
          transactionData: emailData.transactionData,
          emlPath
        });
      } else {
        logger.info('Email received but no valid transaction found', {
          emailId: emailData.id,
          emlPath
        });
      }

    } catch (error) {
      logger.emailError(emailData?.id || 'unknown', error, { 
        context: 'email_processing',
        clientIP: session.remoteAddress 
      });
      throw error;
    }
  }

  /**
   * Handle connection close
   * @param {Object} session - SMTP session
   */
  onClose(session) {
    const clientIP = session.remoteAddress;
    this.decrementConnectionCount(clientIP);
    
    logger.info('SMTP connection closed', { clientIP });
  }

  /**
   * Handle server errors
   * @param {Error} error - Error object
   */
  onError(error) {
    logger.error('SMTP server error', { error: error.message, stack: error.stack });
  }

  /**
   * Check if IP is rate limited
   * @param {String} clientIP - Client IP address
   * @returns {Boolean} True if rate limited
   */
  isRateLimited(clientIP) {
    const now = Date.now();
    const windowStart = now - config.security.rateLimitWindow;
    
    if (!this.rateLimiter.has(clientIP)) {
      this.rateLimiter.set(clientIP, []);
    }
    
    const requests = this.rateLimiter.get(clientIP);
    
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    this.rateLimiter.set(clientIP, validRequests);
    
    if (validRequests.length >= config.email.maxEmailsPerMinute) {
      return true;
    }
    
    // Add current request
    validRequests.push(now);
    return false;
  }

  /**
   * Check if connection limit exceeded
   * @param {String} clientIP - Client IP address
   * @returns {Boolean} True if limit exceeded
   */
  isConnectionLimitExceeded(clientIP) {
    const connectionCount = this.connectionCounts.get(clientIP) || 0;
    return connectionCount >= config.security.maxConnectionsPerIP;
  }

  /**
   * Increment connection count for IP
   * @param {String} clientIP - Client IP address
   */
  incrementConnectionCount(clientIP) {
    const count = this.connectionCounts.get(clientIP) || 0;
    this.connectionCounts.set(clientIP, count + 1);
  }

  /**
   * Decrement connection count for IP
   * @param {String} clientIP - Client IP address
   */
  decrementConnectionCount(clientIP) {
    const count = this.connectionCounts.get(clientIP) || 0;
    if (count > 0) {
      this.connectionCounts.set(clientIP, count - 1);
    }
  }

  /**
   * Start the SMTP server
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(config.smtp.port, config.smtp.host, (error) => {
        if (error) {
          logger.error('Failed to start SMTP server', { error: error.message });
          reject(error);
        } else {
          logger.info('PayCrypt SMTP server started', {
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure
          });
          resolve();
        }
      });
    });
  }

  /**
   * Stop the SMTP server
   */
  stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('PayCrypt SMTP server stopped');
        resolve();
      });
    });
  }

  /**
   * Get server statistics
   * @returns {Object} Server statistics
   */
  getStats() {
    return {
      activeConnections: Array.from(this.connectionCounts.values()).reduce((sum, count) => sum + count, 0),
      rateLimitedIPs: Array.from(this.rateLimiter.keys()).length,
      connectionCounts: Object.fromEntries(this.connectionCounts),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }
  async processIncomingEmail(emailBuffer, clientInfo = {}) {
    // clientInfo can contain {remoteAddress, hostname} for logging
    const fakeSession = {
      remoteAddress: clientInfo.remoteAddress || 'mailgun-inbound',
      hostname: clientInfo.hostname || 'mailgun',
    };
  
    return this.processEmail(emailBuffer, fakeSession);
  }
}

module.exports = PayCryptEmailServer;
