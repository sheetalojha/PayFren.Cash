const nodemailer = require('nodemailer');
const config = require('../config/config');
const logger = require('../utils/logger');

class EmailReplyService {
  constructor() {
    this.transporter = null;
    this.isInitialized = false;
    this.initializePromise = this.initialize();
  }

  /**
   * Initialize the email reply service
   */
  async initialize() {
    try {
      if (!config.outgoingEmail.auth.user || !config.outgoingEmail.auth.pass) {
        logger.warn('EmailReplyService not initialized - missing SMTP credentials');
        return;
      }

      this.transporter = nodemailer.createTransport({
        host: config.outgoingEmail.host,
        port: config.outgoingEmail.port,
        secure: config.outgoingEmail.secure,
        auth: config.outgoingEmail.auth,
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection
      await this.transporter.verify();
      this.isInitialized = true;
      
      logger.info('EmailReplyService initialized successfully', {
        host: config.outgoingEmail.host,
        port: config.outgoingEmail.port,
        from: config.outgoingEmail.from
      });

    } catch (error) {
      logger.error('Failed to initialize EmailReplyService', { 
        error: error.message 
      });
      this.isInitialized = false;
    }
  }

  /**
   * Wait for service initialization to complete
   * @returns {Promise<void>}
   */
  async waitForInitialization() {
    if (this.initializePromise) {
      await this.initializePromise;
    }
  }

  /**
   * Send transaction confirmation email
   * @param {Object} options - Email options
   * @returns {Promise<Object>} Send result
   */
  async sendTransactionConfirmation(options) {
    try {
      if (!this.isInitialized) {
        throw new Error('EmailReplyService not initialized');
      }

      const {
        to,
        originalMessageId,
        originalSubject,
        transactionResult,
        originalEmail
      } = options;

      const subject = `Re: ${originalSubject} - Transaction ${transactionResult.success ? 'Processed' : 'Status'}`;
      
      let emailBody = this.generateTransactionEmailBody(transactionResult, originalEmail);
      
      const mailOptions = {
        from: config.outgoingEmail.from,
        to: to,
        subject: subject,
        html: emailBody,
        text: this.stripHtml(emailBody),
        inReplyTo: originalMessageId,
        references: originalMessageId
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };

    } catch (error) {
      logger.error('Error sending transaction confirmation email', {
        to: options.to,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send notification email to recipient
   * @param {Object} options - Email options
   * @returns {Promise<Object>} Send result
   */
  async sendRecipientNotification(options) {
    try {
      if (!this.isInitialized) {
        throw new Error('EmailReplyService not initialized');
      }

      const {
        to,
        senderEmail,
        transactionResult,
        originalEmail
      } = options;

      const subject = `Payment Notification - ${transactionResult.success ? 'Received' : 'Pending'}`;
      
      let emailBody = this.generateRecipientNotificationBody(senderEmail, transactionResult, originalEmail);
      
      const mailOptions = {
        from: config.outgoingEmail.from,
        to: to,
        subject: subject,
        html: emailBody,
        text: this.stripHtml(emailBody)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };

    } catch (error) {
      logger.error('Error sending recipient notification email', {
        to: options.to,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate transaction confirmation email body
   * @param {Object} transactionResult - Transaction result
   * @param {Object} originalEmail - Original email data
   * @returns {string} HTML email body
   */
  generateTransactionEmailBody(transactionResult, originalEmail) {
    const { success, action, message, txHash, walletAddress, amount, recipientEmail } = transactionResult;
    
    let statusColor = success ? '#28a745' : '#dc3545';
    let statusText = success ? 'Success' : 'Failed';
    
    if (action === 'wallet_created') {
      statusColor = '#ffc107';
      statusText = 'Wallet Created';
    } else if (action === 'insufficient_funds') {
      statusColor = '#fd7e14';
      statusText = 'Insufficient Funds';
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PayCrypt Transaction ${statusText}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .status { background: ${statusColor}; color: white; padding: 10px; border-radius: 4px; text-align: center; font-weight: bold; margin: 20px 0; }
          .details { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }
          .tx-hash { font-family: monospace; background: #e9ecef; padding: 8px; border-radius: 4px; word-break: break-all; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>PayCrypt Transaction ${statusText}</h2>
            <p>Your transaction has been ${success ? 'processed' : 'processed with issues'}.</p>
          </div>
          
          <div class="status">
            ${statusText.toUpperCase()}
          </div>
          
          <div class="details">
            <h3>Transaction Details</h3>
            <p><strong>Status:</strong> ${message}</p>
            ${amount ? `<p><strong>Amount:</strong> ${amount} ETH</p>` : ''}
            ${recipientEmail ? `<p><strong>Recipient:</strong> ${recipientEmail}</p>` : ''}
            ${walletAddress ? `<p><strong>Wallet Address:</strong> <span class="tx-hash">${walletAddress}</span></p>` : ''}
            ${txHash ? `<p><strong>Transaction Hash:</strong> <span class="tx-hash">${txHash}</span></p>` : ''}
          </div>
          
          ${txHash ? `
          <div class="details">
            <h3>Blockchain Explorer</h3>
            <p>You can view your transaction on the blockchain explorer:</p>
            <p><a href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank">View on Etherscan</a></p>
          </div>
          ` : ''}
          
          <div class="footer">
            <p>This is an automated message from PayCrypt. Please do not reply to this email.</p>
            <p>For support, contact us at ${config.outgoingEmail.replyTo}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generate recipient notification email body
   * @param {string} senderEmail - Sender email address
   * @param {Object} transactionResult - Transaction result
   * @param {Object} originalEmail - Original email data
   * @returns {string} HTML email body
   */
  generateRecipientNotificationBody(senderEmail, transactionResult, originalEmail) {
    const { success, action, message, txHash, amount, walletAddress } = transactionResult;
    
    let statusColor = success ? '#28a745' : '#dc3545';
    let statusText = success ? 'Payment Received' : 'Payment Pending';
    
    if (action === 'wallet_created') {
      statusColor = '#ffc107';
      statusText = 'Payment Pending - Wallet Creation';
    } else if (action === 'insufficient_funds') {
      statusColor = '#fd7e14';
      statusText = 'Payment Pending - Insufficient Funds';
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>PayCrypt Payment Notification</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
          .status { background: ${statusColor}; color: white; padding: 10px; border-radius: 4px; text-align: center; font-weight: bold; margin: 20px 0; }
          .details { background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0; }
          .tx-hash { font-family: monospace; background: #e9ecef; padding: 8px; border-radius: 4px; word-break: break-all; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #dee2e6; font-size: 12px; color: #6c757d; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>PayCrypt Payment Notification</h2>
            <p>You have received a payment notification from ${senderEmail}.</p>
          </div>
          
          <div class="status">
            ${statusText.toUpperCase()}
          </div>
          
          <div class="details">
            <h3>Payment Details</h3>
            <p><strong>From:</strong> ${senderEmail}</p>
            <p><strong>Status:</strong> ${message}</p>
            ${amount ? `<p><strong>Amount:</strong> ${amount} ETH</p>` : ''}
            ${walletAddress ? `<p><strong>Sender Wallet:</strong> <span class="tx-hash">${walletAddress}</span></p>` : ''}
            ${txHash ? `<p><strong>Transaction Hash:</strong> <span class="tx-hash">${txHash}</span></p>` : ''}
          </div>
          
          ${txHash ? `
          <div class="details">
            <h3>Blockchain Explorer</h3>
            <p>You can view this transaction on the blockchain explorer:</p>
            <p><a href="https://sepolia.etherscan.io/tx/${txHash}" target="_blank">View on Etherscan</a></p>
          </div>
          ` : ''}
          
          <div class="footer">
            <p>This is an automated notification from PayCrypt. Please do not reply to this email.</p>
            <p>For support, contact us at ${config.outgoingEmail.replyTo}</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Strip HTML tags from content for plain text version
   * @param {string} html - HTML content
   * @returns {string} Plain text content
   */
  stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Send custom email
   * @param {Object} options - Email options
   * @returns {Promise<Object>} Send result
   */
  async sendCustomEmail(options) {
    try {
      if (!this.isInitialized) {
        throw new Error('EmailReplyService not initialized');
      }

      const {
        to,
        subject,
        htmlBody,
        textBody,
        transactionData = null
      } = options;

      const mailOptions = {
        from: config.outgoingEmail.from,
        to: to,
        subject: subject,
        html: htmlBody,
        text: textBody || this.stripHtml(htmlBody)
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };

    } catch (error) {
      logger.error('Error sending custom email', {
        to: options.to,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get service status
   * @returns {Object} Service status
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      hasTransporter: !!this.transporter,
      outgoingConfig: {
        host: config.outgoingEmail.host,
        port: config.outgoingEmail.port,
        from: config.outgoingEmail.from
      }
    };
  }
}

module.exports = EmailReplyService;